import { BadRequestException } from '@nestjs/common';
import { RopeStyle } from '@prisma/client';

/**
 * Cordas multicoloridas (SSOT): estilo + 1 a 3 cores por nível de graduação.
 *  - SOLID   : exatamente 1 cor;
 *  - SPLIT   : "dividida" (listras verticais), 2 ou 3 cores;
 *  - BRAIDED : "trançada" (listras diagonais), 2 ou 3 cores.
 * `color` continua existindo como cor PRIMÁRIA (= colors[0]) para compatibilidade com clientes antigos.
 */

/** Anti-fraude/abuso: máximo de níveis por sistema de graduação. */
export const MAX_LEVELS_PER_SYSTEM = 30;
/** Cor usada quando nenhuma é informada (ou o dado legado não tem cor válida). */
export const DEFAULT_ROPE_COLOR = '#9CA3AF';
export const MAX_ROPE_COLORS = 3;

/** #RRGGBB (o formato canônico gravado) e #RGB (aceito na entrada e expandido). */
export const HEX_COLOR_RE = /^#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/;
const HEX6_RE = /^#[0-9A-Fa-f]{6}$/;

/** Forma pública de um nível/corda, devolvida em TODO lugar onde aparece a corda. */
export interface RopeFields {
  color: string;
  style: RopeStyle;
  colors: string[];
}

export interface LevelView extends RopeFields {
  id: number;
  name: string;
  order: number;
}

/** Normaliza um hex para #RRGGBB maiúsculo; `null` se inválido. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!HEX_COLOR_RE.test(v)) return null;
  if (HEX6_RE.test(v)) return v.toUpperCase();
  const [, r, g, b] = v;
  return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
}

export interface RopeInput {
  style?: RopeStyle;
  colors?: string[];
  color?: string | null;
}

/**
 * Valida e normaliza uma corda. Regras:
 *  - `colors` (se vier) vence `color`; se só `color` vier, vira SOLID com [color];
 *  - estilo ausente = SOLID (na edição, `current` fornece o estilo/cores atuais quando só uma das partes é enviada);
 *  - SOLID exige exatamente 1 cor; SPLIT/BRAIDED aceitam 2 ou 3;
 *  - hex válido (#RRGGBB ou #RGB); sem cores CONSECUTIVAS idênticas (a mesma cor em posições não vizinhas pode).
 * Lança 400 com mensagem clara. Devolve {style, colors, color} prontos para gravar.
 */
export function resolveRope(input: RopeInput, current?: RopeFields): RopeFields {
  const rawColors = input.colors;
  const onlyLegacyColor = rawColors === undefined && input.color !== undefined && input.color !== null;
  // Só `color` => SOLID (a menos que o cliente peça outro estilo, o que dá 400 por faltar cores).
  const style: RopeStyle = input.style ?? (onlyLegacyColor ? RopeStyle.SOLID : (current?.style ?? RopeStyle.SOLID));

  let list: unknown[];
  if (rawColors !== undefined) list = rawColors;
  else if (onlyLegacyColor) list = [input.color];
  else list = current ? current.colors : [DEFAULT_ROPE_COLOR];

  if (style === RopeStyle.SOLID && list.length !== 1) {
    throw new BadRequestException('Corda SOLID exige exatamente 1 cor.');
  }
  if (style !== RopeStyle.SOLID && (list.length < 2 || list.length > MAX_ROPE_COLORS)) {
    throw new BadRequestException(`Corda ${style} exige 2 ou 3 cores.`);
  }
  const colors: string[] = [];
  for (const entry of list) {
    const hex = normalizeHex(entry);
    if (!hex) throw new BadRequestException('Cor inválida: use o formato hexadecimal #RRGGBB.');
    colors.push(hex);
  }
  for (let i = 1; i < colors.length; i++) {
    if (colors[i] === colors[i - 1]) {
      throw new BadRequestException('Cores consecutivas idênticas não são permitidas na corda.');
    }
  }
  return { style, colors, color: colors[0] };
}

/**
 * Objeto de nível no contrato público. Tolera linhas antigas/criadas direto no banco sem `colors`
 * (deriva do `color` legado, ou do cinza neutro) e sempre devolve color = colors[0].
 * Mantém os demais campos do registro (ex.: graduationSystemId) — o contrato é um superconjunto.
 */
export function withRope<T extends { color: string | null; style?: RopeStyle | null; colors?: string[] | null }>(
  level: T,
): Omit<T, 'color' | 'style' | 'colors'> & RopeFields {
  const stored = (level.colors ?? []).map((c) => normalizeHex(c)).filter((c): c is string => c !== null);
  const legacy = normalizeHex(level.color);
  const colors = stored.length > 0 ? stored : [legacy ?? DEFAULT_ROPE_COLOR];
  const { color: _color, style: _style, colors: _colors, ...rest } = level;
  void _color;
  void _style;
  void _colors;
  return { ...rest, color: colors[0], style: level.style ?? RopeStyle.SOLID, colors };
}

/** Recorte mínimo {id, name, order, color, style, colors} do contrato de leitura. */
export function levelView(level: {
  id: number;
  name: string;
  order: number;
  color: string | null;
  style?: RopeStyle | null;
  colors?: string[] | null;
}): LevelView {
  const r = withRope(level);
  return { id: r.id, name: r.name, order: r.order, color: r.color, style: r.style, colors: r.colors };
}

/** Só a parte de corda ({color, style, colors}) de um nível/linha. */
export function ropeOf(level: { color: string | null; style?: RopeStyle | null; colors?: string[] | null }): RopeFields {
  const r = withRope(level);
  return { color: r.color, style: r.style, colors: r.colors };
}

/** `select` do Prisma com exatamente os campos do contrato (reuso em includes/selects). */
export const LEVEL_SELECT = { id: true, name: true, order: true, color: true, style: true, colors: true } as const;
