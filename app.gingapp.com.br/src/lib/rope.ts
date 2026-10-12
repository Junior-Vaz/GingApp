/** Lógica pura das cordas (estilo, cores, descrição falada); o desenho SVG vive em components/gingapp/rope.tsx. */
export type RopeStyle = "SOLID" | "SPLIT" | "BRAIDED";

/** Dados mínimos para desenhar uma corda (campos novos do backend são opcionais: sem eles cai na cor única). */
export interface RopeSpec {
  style?: RopeStyle | string | null | undefined;
  colors?: readonly string[] | null | undefined;
  color?: string | null | undefined;
}

export interface NormalizedRope {
  style: RopeStyle;
  colors: string[];
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** Cinza neutro usado quando a corda não tem cor nenhuma (sistema sem cores definidas). */
export const ROPE_NEUTRAL = "#b9c0bb";

function fullHex(hex: string): string {
  return hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
}

/**
 * Normaliza o que veio do servidor: `colors` (1..3 hex válidos) manda; sem ele usa `color`; sem nenhum, cinza.
 * Com menos de 2 cores o estilo vira SOLID (SPLIT/BRAIDED precisam de 2 ou 3).
 */
export function normalizeRope(spec: RopeSpec | null | undefined): NormalizedRope {
  const fromList = (spec?.colors ?? []).filter((c) => typeof c === "string" && HEX.test(c.trim())).map((c) => fullHex(c.trim())).slice(0, 3);
  const single = spec?.color && HEX.test(spec.color.trim()) ? [fullHex(spec.color.trim())] : [];
  const colors = fromList.length > 0 ? fromList : single.length > 0 ? single : [ROPE_NEUTRAL];
  const wanted = spec?.style === "SPLIT" || spec?.style === "BRAIDED" ? spec.style : "SOLID";
  return { style: colors.length < 2 ? "SOLID" : wanted, colors };
}

/** Nome da cor em pt-BR (feminino, concorda com "corda"), pela matiz/luminosidade. */
export function colorName(hex: string): string {
  const clean = fullHex(hex).slice(1);
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l > 0.9 && s < 0.4) return "crua";
  if (l < 0.14) return "preta";
  if (s < 0.14) return l > 0.78 ? "branca" : "cinza";
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  if (h < 15 || h >= 345) return l > 0.75 ? "rosa" : "vermelha";
  if (h < 40) return l < 0.4 ? "marrom" : "laranja";
  if (h < 70) return "amarela";
  if (h < 165) return "verde";
  if (h < 200) return "turquesa";
  if (h < 255) return "azul";
  if (h < 290) return "roxa";
  if (h < 345) return "rosa";
  return "vermelha";
}

function joinNames(names: string[]): string {
  const unique = names.filter((n, i) => names.indexOf(n) === i);
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique.slice(0, -1).join(", ")} e ${unique[unique.length - 1]}`;
}

/** Descrição falada da corda: "Corda verde", "Corda dividida verde e azul", "Corda trançada verde, amarela e azul". */
export function ropeLabel(spec: RopeSpec | null | undefined): string {
  const { style, colors } = normalizeRope(spec);
  const names = joinNames(colors.map(colorName));
  if (style === "SOLID") return `Corda ${names}`;
  return `Corda ${style === "SPLIT" ? "dividida" : "trançada"} ${names}`;
}
