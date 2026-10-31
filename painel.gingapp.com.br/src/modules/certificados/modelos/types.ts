/**
 * Modelos de certificado — tipos e constantes.
 * FONTE ÚNICA: docs/CONTRATO_CERTIFICADOS_MODELOS.md (§2 desenho, §3 variáveis, §4 fontes, §5 tipos).
 * O backend usa as MESMAS listas; há teste de conformidade (src/test/certificados-modelos-contrato.test.ts).
 */

// ------------------------------------------------------------------ fontes (§4)

export type FontKey = "helvetica" | "playfair" | "cinzel" | "lora" | "montserrat" | "greatvibes";

export interface FontDef {
  key: FontKey;
  /** Rótulo na interface. */
  label: string;
  /** Pilha CSS usada na pré-visualização do canvas (as mesmas famílias do PDF). */
  css: string;
  /** A fonte tem versão em negrito? Sem ela, a flag `bold` é ignorada no PDF (e o editor a desabilita). */
  bold: boolean;
  italic: boolean;
}

export const FONTS: readonly FontDef[] = [
  { key: "helvetica", label: "Padrão (Helvetica)", css: 'Helvetica, Arial, "Liberation Sans", sans-serif', bold: true, italic: true },
  { key: "playfair", label: "Playfair Display", css: '"Playfair Display", Georgia, serif', bold: true, italic: true },
  { key: "cinzel", label: "Cinzel", css: 'Cinzel, "Trajan Pro", Georgia, serif', bold: true, italic: false },
  { key: "lora", label: "Lora", css: "Lora, Georgia, serif", bold: true, italic: true },
  { key: "montserrat", label: "Montserrat", css: "Montserrat, Arial, sans-serif", bold: true, italic: true },
  { key: "greatvibes", label: "Great Vibes (manuscrita)", css: '"Great Vibes", cursive', bold: false, italic: false },
];

export const FONT_KEYS: readonly FontKey[] = FONTS.map((f) => f.key);

export function fontDef(key: string): FontDef {
  return FONTS.find((f) => f.key === key) ?? FONTS[0]!;
}

// ------------------------------------------------------------------ variáveis (§3)

export type VariableKey =
  | "aluno"
  | "grupo"
  | "titulo"
  | "graduacao"
  | "data"
  | "dataExtenso"
  | "codigo"
  | "link";

export interface VariableDef {
  key: VariableKey;
  /** Como aparece no texto: `{aluno}`. */
  token: string;
  label: string;
}

export const VARIABLES: readonly VariableDef[] = [
  { key: "aluno", token: "{aluno}", label: "Nome do aluno" },
  { key: "grupo", token: "{grupo}", label: "Nome do grupo" },
  { key: "titulo", token: "{titulo}", label: "Título do certificado" },
  { key: "graduacao", token: "{graduacao}", label: "Graduação (nível vinculado)" },
  { key: "data", token: "{data}", label: "Data de emissão (dd/mm/aaaa)" },
  { key: "dataExtenso", token: "{dataExtenso}", label: "Data por extenso" },
  { key: "codigo", token: "{codigo}", label: "Código de verificação" },
  { key: "link", token: "{link}", label: "Link de verificação" },
];

export const VARIABLE_KEYS: readonly string[] = VARIABLES.map((v) => v.key);

/** O texto precisa de uma destas variáveis para o certificado poder ser conferido (regra do §2). */
export const VERIFICATION_TOKENS: readonly string[] = ["{codigo}", "{link}"];

// ------------------------------------------------------------------ desenho (§2)

export type Orientation = "landscape" | "portrait";
export type Align = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";
export type ImageFit = "cover" | "contain";

export interface PageBackground {
  /** '#RRGGBB' (maiúsculo). */
  color: string;
  imageRef?: string | null;
  imageFit?: ImageFit;
}

export interface CertificateLayout {
  version: 1;
  page: { orientation: Orientation; background: PageBackground };
  /** A ordem é o z-order: o último fica por cima. 1..40 itens. */
  elements: CertificateElement[];
}

export interface BaseEl {
  id: string;
}

export interface TextEl extends BaseEl {
  type: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontKey: FontKey;
  size: number;
  color: string;
  align: Align;
  vAlign: VAlign;
  bold: boolean;
  italic: boolean;
  uppercase: boolean;
  letterSpacing: number;
  lineHeight: number;
}

export interface ImageEl extends BaseEl {
  type: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  ref?: string | null;
  useGroupLogo: boolean;
  fit: "contain" | "cover";
  opacity: number;
}

export interface RectEl extends BaseEl {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string | null;
  fillOpacity: number;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
}

export type LineOrientation = "horizontal" | "vertical";
export type LineStyle = "solid" | "dashed" | "dotted";

/**
 * Linha reta (ex.: espaço de assinatura). Conta nos 40 elementos (contrato §2 e §8.1).
 * `x`,`y` = extremidade inicial (esquerda se horizontal, de cima se vertical), em % da página.
 * `length` em %: horizontal = % da LARGURA da página; vertical = % da ALTURA. Regra de caber:
 * horizontal => x + length <= 100; vertical => y + length <= 100.
 */
export interface LineEl extends BaseEl {
  type: "line";
  x: number;
  y: number;
  /** % (1..100). */
  length: number;
  orientation: LineOrientation;
  /** '#RRGGBB'. */
  color: string;
  /** pt (0.5..10). */
  thickness: number;
  lineStyle: LineStyle;
}

export interface QrEl extends BaseEl {
  type: "qr";
  x: number;
  y: number;
  /** Lado em pt (56..220). */
  size: number;
  /** '#RRGGBB' ESCURO (luminância relativa <= 0.45). */
  fg: string;
}

export type CertificateElement = TextEl | ImageEl | RectEl | LineEl | QrEl;
export type ElementType = CertificateElement["type"];

export const ELEMENT_TYPE_LABEL: Record<ElementType, string> = {
  text: "Texto",
  image: "Imagem",
  rect: "Retângulo",
  line: "Linha",
  qr: "QR Code",
};

export const LINE_ORIENTATION_LABEL: Record<LineOrientation, string> = {
  horizontal: "Horizontal",
  vertical: "Vertical",
};

export const LINE_STYLE_LABEL: Record<LineStyle, string> = {
  solid: "Sólida",
  dashed: "Tracejada",
  dotted: "Pontilhada",
};

// ------------------------------------------------------------------ modelo salvo (§5)

export type CertificatePurpose = "GRADUACAO" | "BATIZADO" | "EVENTO" | "PARTICIPACAO" | "OUTRO";

export const PURPOSES: readonly { value: CertificatePurpose; label: string }[] = [
  { value: "GRADUACAO", label: "Graduação" },
  { value: "BATIZADO", label: "Batizado" },
  { value: "EVENTO", label: "Evento" },
  { value: "PARTICIPACAO", label: "Participação" },
  { value: "OUTRO", label: "Outro" },
];

export const PURPOSE_LABEL: Record<CertificatePurpose, string> = Object.fromEntries(
  PURPOSES.map((p) => [p.value, p.label]),
) as Record<CertificatePurpose, string>;

export interface CertificateTemplate {
  id: number;
  name: string;
  purpose: CertificatePurpose;
  isDefault: boolean;
  layout: CertificateLayout;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateTemplateSummary {
  id: number;
  name: string;
  purpose: CertificatePurpose;
  isDefault: boolean;
  orientation: Orientation;
  updatedAt: string;
}

/** Item de GET /certificate-templates/presets. */
export interface CertificatePreset {
  key: string;
  name: string;
  purpose: CertificatePurpose;
  layout: CertificateLayout;
}

/** Corpo de POST /certificate-templates: layout OU presetKey. */
export type CreateTemplatePayload =
  | { name: string; purpose: CertificatePurpose; layout: CertificateLayout }
  | { name: string; purpose?: CertificatePurpose; presetKey: string };

// ------------------------------------------------------------------ limites (§2, §5)

export const LIMITS = {
  maxElements: 40,
  /** Contando o fundo. */
  maxImages: 8,
  maxText: 500,
  maxLayoutBytes: 64 * 1024,
  maxTemplates: 30,
  nameMax: 60,
  idMax: 40,
  /** w e h mínimos (% da página) segundo o contrato. */
  minBox: 1,
  fontSize: { min: 6, max: 160 },
  letterSpacing: { min: 0, max: 30 },
  lineHeight: { min: 0.8, max: 2.5 },
  strokeWidth: { min: 0, max: 20 },
  radius: { min: 0, max: 200 },
  /** Linha (contrato §2): comprimento em % da página (largura se horizontal, altura se vertical). */
  lineLength: { min: 1, max: 100 },
  /** Linha: espessura em pt. */
  lineThickness: { min: 0.5, max: 10 },
  qrSize: { min: 56, max: 220 },
  /** Luminância relativa máxima da cor do QR (precisa ser escura). */
  qrMaxLuminance: 0.45,
} as const;

/** Página de referência A4 em pt. */
export const PAGE_PT: Record<Orientation, { w: number; h: number }> = {
  landscape: { w: 842, h: 595 },
  portrait: { w: 595, h: 842 },
};

export const ORIENTATION_LABEL: Record<Orientation, string> = {
  landscape: "Paisagem",
  portrait: "Retrato",
};

export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
export const ELEMENT_ID = /^[a-z0-9-]{1,40}$/;
