// Modelo de corda de graduação (estilo + cores): tipos, paleta e descrição acessível.
export type RopeStyle = "SOLID" | "SPLIT" | "BRAIDED";

export interface RopeSpec {
  style: RopeStyle;
  colors: string[];
  /** Corda com pontas: cor (#RRGGBB) da ponta de CIMA/primeira; ausente/null = sem ponta. */
  tipStart?: string | null | undefined;
  /** Corda com pontas: cor (#RRGGBB) da ponta de BAIXO/última; ausente/null = sem ponta. */
  tipEnd?: string | null | undefined;
}

/** Cada ponta ocupa ~20% do comprimento da corda (mesma constante do app). */
export const TIP_RATIO = 0.2;

/** Paleta rápida de cores típicas de cordas (hex = cor "real" da corda). */
export const ROPE_PALETTE: { name: string; hex: string }[] = [
  { name: "Branca (crua)", hex: "#f5f1e6" },
  { name: "Amarela", hex: "#facc15" },
  { name: "Laranja", hex: "#f97316" },
  { name: "Azul", hex: "#2563eb" },
  { name: "Verde", hex: "#16a34a" },
  { name: "Roxa", hex: "#7c3aed" },
  { name: "Marrom", hex: "#78350f" },
  { name: "Vermelha", hex: "#dc2626" },
  { name: "Preta", hex: "#111111" },
  { name: "Cinza", hex: "#9ca3af" },
];

/** Nomes usados só para descrever (aria-label) cores fora da paleta. */
const EXTRA_NAMES = [{ name: "Rosa", hex: "#ec4899" }];

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const NO_COLOR = "#d4d4d8";

const toRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Nome (feminino, para "corda") da cor da paleta mais próxima do hex. */
export function colorName(hex: string): string {
  if (!HEX_COLOR.test(hex)) return "sem cor";
  const [r, g, b] = toRgb(hex);
  let best = ROPE_PALETTE[0]!;
  let bestDistance = Infinity;
  for (const candidate of [...ROPE_PALETTE, ...EXTRA_NAMES]) {
    const [cr, cg, cb] = toRgb(candidate.hex);
    const distance = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best.name.replace(/ \(.*\)$/, "").toLowerCase();
}

const joinNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;

const STYLE_WORD: Record<RopeStyle, string> = { SOLID: "sólida", SPLIT: "dividida", BRAIDED: "trançada" };

/** Cor de ponta válida (hex #RRGGBB) ou null. */
export const validTip = (tip: string | null | undefined): string | null => (tip && HEX_COLOR.test(tip) ? tip : null);

/**
 * "Corda trançada verde, amarela e azul". Com pontas: "Corda cinza com ponta amarela e ponta azul" (corpo sólido
 * não diz "sólida"); uma ponta só diz o lado: "Corda crua com ponta de cima verde".
 */
export function ropeLabel({ style, colors, tipStart, tipEnd }: RopeSpec): string {
  const valid = colors.filter((c) => HEX_COLOR.test(c));
  const start = validTip(tipStart);
  const end = validTip(tipEnd);
  const names = valid.map(colorName);
  const solidBody = style === "SOLID" || valid.length === 1;
  let body: string;
  if (valid.length === 0) body = "Corda sem cor definida";
  else if (start || end) body = solidBody ? `Corda ${names[0]}` : `Corda ${STYLE_WORD[style]} ${joinNames(names)}`;
  else if (solidBody) body = `Corda ${style === "SOLID" ? "sólida" : STYLE_WORD[style]} ${names[0]}`;
  else body = `Corda ${STYLE_WORD[style]} ${joinNames(names)}`;
  if (start && end) return `${body} com ponta ${colorName(start)} e ponta ${colorName(end)}`;
  if (start) return `${body} com ponta de cima ${colorName(start)}`;
  if (end) return `${body} com ponta de baixo ${colorName(end)}`;
  return body;
}

/** Converte um nível do backend (novo `style/colors` ou legado `color`) na especificação da corda. */
export function ropeOf(source: {
  style?: RopeStyle | null | undefined;
  colors?: string[] | null | undefined;
  color?: string | null | undefined;
  tipStart?: string | null | undefined;
  tipEnd?: string | null | undefined;
}): RopeSpec {
  const colors = source.colors?.length ? source.colors : source.color ? [source.color] : [];
  const tipStart = validTip(source.tipStart);
  const tipEnd = validTip(source.tipEnd);
  return { style: source.style ?? "SOLID", colors, ...(tipStart ? { tipStart } : {}), ...(tipEnd ? { tipEnd } : {}) };
}

