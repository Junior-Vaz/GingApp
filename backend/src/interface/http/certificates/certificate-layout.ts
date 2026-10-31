/**
 * Desenho do certificado (docs/CONTRATO_CERTIFICADOS_MODELOS.md secoes 2, 3 e 4): tipos, listas SSOT (fontes, usos,
 * variaveis), validacao/normalizacao PURA (sem banco) e substituicao de variaveis. Testado em
 * test/certificate-templates.spec.ts. A validacao de PROPRIEDADE das imagens (upload do proprio grupo) fica no service.
 */
import { UPLOAD_URL_PREFIX, isUploadPath, uploadFilenameOf } from '../../../shared/uploads/image-ref';
import { normalizeUserText } from '../feed/feed-text';

// ---------------------------------------------------------------------------------------------------------------
// Tipos (contrato secao 2)
// ---------------------------------------------------------------------------------------------------------------

/** SSOT das fontes (contrato secao 4). `helvetica` = fonte padrao embutida do PDF. */
export const FONT_KEYS = ['helvetica', 'playfair', 'cinzel', 'lora', 'montserrat', 'greatvibes'] as const;
export type FontKey = (typeof FONT_KEYS)[number];

/** Variantes que cada fonte tem: flag que a fonte nao tem e ignorada no PDF (o editor a desabilita). */
export const FONT_VARIANTS: Record<FontKey, { bold: boolean; italic: boolean }> = {
  helvetica: { bold: true, italic: true },
  playfair: { bold: true, italic: true },
  cinzel: { bold: true, italic: false },
  lora: { bold: true, italic: true },
  montserrat: { bold: true, italic: true },
  greatvibes: { bold: false, italic: false },
};

/** Usos do modelo (contrato secao 5); espelha o enum CertificatePurpose do Prisma. */
export const CERTIFICATE_PURPOSES = ['GRADUACAO', 'BATIZADO', 'EVENTO', 'PARTICIPACAO', 'OUTRO'] as const;
export type CertificatePurposeKey = (typeof CERTIFICATE_PURPOSES)[number];

/** Variaveis de texto (contrato secao 3). Painel e backend usam EXATAMENTE esta lista. */
export const CERTIFICATE_VARIABLES = ['aluno', 'grupo', 'titulo', 'graduacao', 'data', 'dataExtenso', 'codigo', 'link'] as const;
export type CertificateVariable = (typeof CERTIFICATE_VARIABLES)[number];
export type CertificateVariables = Partial<Record<CertificateVariable, string | null | undefined>>;

export type Orientation = 'landscape' | 'portrait';

export interface CertificateLayout {
  version: 1;
  page: {
    orientation: Orientation;
    background: { color: string; imageRef: string | null; imageFit: 'cover' | 'contain' };
  };
  elements: CertificateElement[];
}

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextElement extends Box {
  type: 'text';
  text: string;
  fontKey: FontKey;
  size: number;
  color: string;
  align: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle' | 'bottom';
  bold: boolean;
  italic: boolean;
  uppercase: boolean;
  letterSpacing: number;
  lineHeight: number;
}

export interface ImageElement extends Box {
  type: 'image';
  ref: string | null;
  useGroupLogo: boolean;
  fit: 'contain' | 'cover';
  opacity: number;
}

export interface RectElement extends Box {
  type: 'rect';
  fill: string | null;
  fillOpacity: number;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
}

export interface QrElement {
  id: string;
  type: 'qr';
  x: number;
  y: number;
  size: number;
  fg: string;
}

export type CertificateElement = TextElement | ImageElement | RectElement | QrElement;

// ---------------------------------------------------------------------------------------------------------------
// Limites (contrato secoes 2 e 8)
// ---------------------------------------------------------------------------------------------------------------

/** A4 em pt (o mesmo tamanho que o pdfkit usa para 'A4'). */
export const A4 = { width: 841.89, height: 595.28 } as const;

export function pageSize(orientation: Orientation): { width: number; height: number } {
  return orientation === 'landscape' ? { width: A4.width, height: A4.height } : { width: A4.height, height: A4.width };
}

export const LAYOUT_LIMITS = {
  maxElements: 40,
  maxImages: 8,
  maxBytes: 64 * 1024,
  maxTextLength: 500,
  minQrSize: 56,
  maxQrSize: 220,
  /** Luminancia relativa maxima da cor do QR (escuro sobre a placa branca). */
  maxQrLuminance: 0.45,
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Validacao
// ---------------------------------------------------------------------------------------------------------------

/** Erro de validacao do desenho: a mensagem (portugues) vai no 400. */
export class CertificateLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CertificateLayoutError';
  }
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const ELEMENT_ID = /^[a-z0-9-]{1,40}$/;
const VARIABLE_TOKEN = /\{([^{}]*)\}/g;
/** Folga para arredondamento de ponto flutuante (x + w <= 100). */
const EPS = 1e-6;

const ELEMENT_KEYS: Record<CertificateElement['type'], { required: readonly string[]; optional: readonly string[] }> = {
  text: {
    required: ['id', 'type', 'x', 'y', 'w', 'h', 'text', 'fontKey', 'size', 'color', 'align', 'vAlign', 'bold', 'italic', 'uppercase', 'letterSpacing', 'lineHeight'],
    optional: [],
  },
  image: { required: ['id', 'type', 'x', 'y', 'w', 'h', 'useGroupLogo', 'fit', 'opacity'], optional: ['ref'] },
  rect: { required: ['id', 'type', 'x', 'y', 'w', 'h', 'fill', 'fillOpacity', 'stroke', 'strokeWidth', 'radius'], optional: [] },
  qr: { required: ['id', 'type', 'x', 'y', 'size', 'fg'], optional: [] },
};

const TYPE_LABEL: Record<CertificateElement['type'], string> = { text: 'texto', image: 'imagem', rect: 'retângulo', qr: 'QR Code' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkKeys(obj: Record<string, unknown>, required: readonly string[], optional: readonly string[], where: string): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) throw new CertificateLayoutError(`${where}: campo desconhecido "${key}".`);
  }
  for (const key of required) {
    if (!(key in obj) || obj[key] === undefined) throw new CertificateLayoutError(`${where}: campo "${key}" é obrigatório.`);
  }
}

function num(obj: Record<string, unknown>, key: string, min: number, max: number, where: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new CertificateLayoutError(`${where}: "${key}" deve ser um número.`);
  if (v < min || v > max) throw new CertificateLayoutError(`${where}: "${key}" deve estar entre ${min} e ${max}.`);
  return v;
}

function bool(obj: Record<string, unknown>, key: string, where: string): boolean {
  const v = obj[key];
  if (typeof v !== 'boolean') throw new CertificateLayoutError(`${where}: "${key}" deve ser verdadeiro ou falso.`);
  return v;
}

function oneOf<T extends string>(obj: Record<string, unknown>, key: string, values: readonly T[], where: string): T {
  const v = obj[key];
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) {
    throw new CertificateLayoutError(`${where}: "${key}" deve ser um de: ${values.join(', ')}.`);
  }
  return v as T;
}

function color(obj: Record<string, unknown>, key: string, where: string, nullable = false): string | null {
  const v = obj[key];
  if (nullable && v === null) return null;
  if (typeof v !== 'string' || !HEX_COLOR.test(v)) {
    throw new CertificateLayoutError(`${where}: "${key}" deve ser uma cor no formato #RRGGBB${nullable ? ' ou null' : ''}.`);
  }
  return v.toUpperCase();
}

function imageRef(obj: Record<string, unknown>, key: string, where: string): string | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (!isUploadPath(v)) {
    throw new CertificateLayoutError(`${where}: "${key}" deve ser o caminho devolvido por POST /uploads (/api/uploads/<arquivo>).`);
  }
  return v;
}

/** Luminancia relativa (WCAG) de '#RRGGBB': 0 = preto, 1 = branco. */
export function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * Confere as variaveis de um texto: toda `{palavra}` precisa estar na lista do contrato e nao pode sobrar `{`/`}` solto.
 * Devolve o motivo da recusa ou null.
 */
export function textVariablesProblem(text: string): string | null {
  for (const match of text.matchAll(VARIABLE_TOKEN)) {
    if (!(CERTIFICATE_VARIABLES as readonly string[]).includes(match[1])) return `variável desconhecida {${match[1]}}`;
  }
  const rest = text.replace(VARIABLE_TOKEN, '');
  if (rest.includes('{') || rest.includes('}')) return 'chave { ou } solta sem variável válida';
  return null;
}

/** Texto do elemento: normalizado como o feed (NFC, sem controle/invisiveis, espacos repetidos colapsados), 1..500. */
function elementText(obj: Record<string, unknown>, where: string): string {
  const raw = obj.text;
  if (typeof raw !== 'string') throw new CertificateLayoutError(`${where}: "text" deve ser um texto.`);
  if (raw.length > LAYOUT_LIMITS.maxTextLength * 2) {
    throw new CertificateLayoutError(`${where}: "text" deve ter no máximo ${LAYOUT_LIMITS.maxTextLength} caracteres.`);
  }
  const text = normalizeUserText(raw, true);
  if (!text) throw new CertificateLayoutError(`${where}: "text" não pode ficar vazio.`);
  if (text.length > LAYOUT_LIMITS.maxTextLength) {
    throw new CertificateLayoutError(`${where}: "text" deve ter no máximo ${LAYOUT_LIMITS.maxTextLength} caracteres.`);
  }
  const problem = textVariablesProblem(text);
  if (problem) throw new CertificateLayoutError(`${where}: ${problem}. Use só: ${CERTIFICATE_VARIABLES.map((v) => `{${v}}`).join(' ')}.`);
  return text;
}

function box(obj: Record<string, unknown>, where: string): { x: number; y: number; w: number; h: number } {
  const x = num(obj, 'x', 0, 100, where);
  const y = num(obj, 'y', 0, 100, where);
  const w = num(obj, 'w', 1, 100, where);
  const h = num(obj, 'h', 1, 100, where);
  if (x + w > 100 + EPS) throw new CertificateLayoutError(`${where}: x + w passa da largura da página (máx. 100%).`);
  if (y + h > 100 + EPS) throw new CertificateLayoutError(`${where}: y + h passa da altura da página (máx. 100%).`);
  return { x, y, w, h };
}

function parseElement(raw: unknown, index: number, orientation: Orientation): CertificateElement {
  const at = `Elemento ${index + 1}`;
  if (!isPlainObject(raw)) throw new CertificateLayoutError(`${at}: deve ser um objeto.`);
  const type = raw.type;
  if (type !== 'text' && type !== 'image' && type !== 'rect' && type !== 'qr') {
    throw new CertificateLayoutError(`${at}: "type" deve ser um de: text, image, rect, qr.`);
  }
  const idRaw = raw.id;
  const where = typeof idRaw === 'string' && ELEMENT_ID.test(idRaw) ? `Elemento "${idRaw}" (${TYPE_LABEL[type]})` : `${at} (${TYPE_LABEL[type]})`;
  checkKeys(raw, ELEMENT_KEYS[type].required, ELEMENT_KEYS[type].optional, where);
  if (typeof idRaw !== 'string' || !ELEMENT_ID.test(idRaw)) {
    throw new CertificateLayoutError(`${where}: "id" deve ter de 1 a 40 caracteres entre a-z, 0-9 e "-".`);
  }
  const id = idRaw;

  switch (type) {
    case 'text':
      return {
        id,
        type,
        ...box(raw, where),
        text: elementText(raw, where),
        fontKey: oneOf(raw, 'fontKey', FONT_KEYS, where),
        size: num(raw, 'size', 6, 160, where),
        color: color(raw, 'color', where) as string,
        align: oneOf(raw, 'align', ['left', 'center', 'right'] as const, where),
        vAlign: oneOf(raw, 'vAlign', ['top', 'middle', 'bottom'] as const, where),
        bold: bool(raw, 'bold', where),
        italic: bool(raw, 'italic', where),
        uppercase: bool(raw, 'uppercase', where),
        letterSpacing: num(raw, 'letterSpacing', 0, 30, where),
        lineHeight: num(raw, 'lineHeight', 0.8, 2.5, where),
      };
    case 'image':
      return {
        id,
        type,
        ...box(raw, where),
        ref: imageRef(raw, 'ref', where),
        useGroupLogo: bool(raw, 'useGroupLogo', where),
        fit: oneOf(raw, 'fit', ['contain', 'cover'] as const, where),
        opacity: num(raw, 'opacity', 0, 1, where),
      };
    case 'rect':
      return {
        id,
        type,
        ...box(raw, where),
        fill: color(raw, 'fill', where, true),
        fillOpacity: num(raw, 'fillOpacity', 0, 1, where),
        stroke: color(raw, 'stroke', where, true),
        strokeWidth: num(raw, 'strokeWidth', 0, 20, where),
        radius: num(raw, 'radius', 0, 200, where),
      };
    case 'qr': {
      const x = num(raw, 'x', 0, 100, where);
      const y = num(raw, 'y', 0, 100, where);
      const size = num(raw, 'size', LAYOUT_LIMITS.minQrSize, LAYOUT_LIMITS.maxQrSize, where);
      const page = pageSize(orientation);
      if ((x / 100) * page.width + size > page.width + EPS || (y / 100) * page.height + size > page.height + EPS) {
        throw new CertificateLayoutError(`${where}: o QR Code precisa caber inteiro na página.`);
      }
      const fg = color(raw, 'fg', where) as string;
      if (relativeLuminance(fg) > LAYOUT_LIMITS.maxQrLuminance) {
        throw new CertificateLayoutError(`${where}: a cor do QR Code ("fg") precisa ser escura para a leitura funcionar.`);
      }
      return { id, type, x, y, size, fg };
    }
  }
}

/**
 * Valida e NORMALIZA um desenho vindo do cliente (ou do banco). Lanca CertificateLayoutError (mensagem em portugues,
 * indicando o elemento/campo) em qualquer violacao das regras do contrato secao 2. Saida: cores em maiusculo, texto
 * normalizado, `background.imageRef`/`imageFit` e `image.ref` sempre presentes (null / 'cover').
 */
export function validateCertificateLayout(raw: unknown): CertificateLayout {
  if (!isPlainObject(raw)) throw new CertificateLayoutError('O desenho (layout) deve ser um objeto.');
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(raw), 'utf8');
  } catch {
    throw new CertificateLayoutError('O desenho (layout) não é um JSON válido.');
  }
  if (size > LAYOUT_LIMITS.maxBytes) throw new CertificateLayoutError('O desenho passa do limite de 64 KB.');

  checkKeys(raw, ['version', 'page', 'elements'], [], 'Desenho');
  if (raw.version !== 1) throw new CertificateLayoutError('Desenho: "version" deve ser 1.');

  const pageRaw = raw.page;
  if (!isPlainObject(pageRaw)) throw new CertificateLayoutError('Página: deve ser um objeto.');
  checkKeys(pageRaw, ['orientation', 'background'], [], 'Página');
  const orientation = oneOf(pageRaw, 'orientation', ['landscape', 'portrait'] as const, 'Página');
  const bgRaw = pageRaw.background;
  if (!isPlainObject(bgRaw)) throw new CertificateLayoutError('Fundo: deve ser um objeto.');
  checkKeys(bgRaw, ['color'], ['imageRef', 'imageFit'], 'Fundo');
  const background = {
    color: color(bgRaw, 'color', 'Fundo') as string,
    imageRef: imageRef(bgRaw, 'imageRef', 'Fundo'),
    imageFit: bgRaw.imageFit === undefined ? ('cover' as const) : oneOf(bgRaw, 'imageFit', ['cover', 'contain'] as const, 'Fundo'),
  };

  const elementsRaw = raw.elements;
  if (!Array.isArray(elementsRaw)) throw new CertificateLayoutError('Desenho: "elements" deve ser uma lista.');
  if (elementsRaw.length < 1 || elementsRaw.length > LAYOUT_LIMITS.maxElements) {
    throw new CertificateLayoutError(`Desenho: deve ter de 1 a ${LAYOUT_LIMITS.maxElements} elementos.`);
  }
  const elements = elementsRaw.map((el, i) => parseElement(el, i, orientation));

  const seen = new Set<string>();
  for (const el of elements) {
    if (seen.has(el.id)) throw new CertificateLayoutError(`Elemento "${el.id}": id repetido (cada elemento precisa de um id único).`);
    seen.add(el.id);
  }
  const qrCount = elements.filter((el) => el.type === 'qr').length;
  if (qrCount !== 1) throw new CertificateLayoutError('O desenho precisa ter exatamente 1 QR Code (ele não pode ser removido).');
  const hasCode = elements.some((el) => el.type === 'text' && (el.text.includes('{codigo}') || el.text.includes('{link}')));
  if (!hasCode) throw new CertificateLayoutError('O desenho precisa de ao menos 1 texto com {codigo} ou {link} (verificação do certificado).');
  const images = elements.filter((el) => el.type === 'image').length + (background.imageRef ? 1 : 0);
  if (images > LAYOUT_LIMITS.maxImages) {
    throw new CertificateLayoutError(`O desenho pode ter no máximo ${LAYOUT_LIMITS.maxImages} imagens (contando o fundo).`);
  }

  return { version: 1, page: { orientation, background }, elements };
}

/** Nomes de arquivo (`<uuid>.<ext>`) das imagens de upload citadas no desenho (fundo + elementos com `ref`). */
export function layoutUploadRefs(layout: CertificateLayout): string[] {
  const refs = new Set<string>();
  if (layout.page.background.imageRef) refs.add(layout.page.background.imageRef);
  for (const el of layout.elements) {
    if (el.type === 'image' && !el.useGroupLogo && el.ref) refs.add(el.ref);
  }
  return [...refs];
}

// ---------------------------------------------------------------------------------------------------------------
// Logo do grupo e variaveis
// ---------------------------------------------------------------------------------------------------------------

/**
 * Referencia `/api/uploads/<arquivo>` do logo do grupo (Organization.logo pode estar gravado como caminho ou como URL
 * absoluta do proprio backend). Logo ausente ou URL externa = null: o elemento `useGroupLogo` sai do desenho (o PDF nunca
 * busca imagem fora do diretorio de uploads).
 */
export function logoRefOf(logo: string | null | undefined): string | null {
  const filename = uploadFilenameOf(logo);
  return filename ? `${UPLOAD_URL_PREFIX}${filename}` : null;
}

/**
 * Troca `useGroupLogo` pela referencia CONCRETA do logo do grupo (contrato secao 7, item 3). `logoRef` = caminho
 * `/api/uploads/<arquivo>` do logo, ou null (grupo sem logo / logo fora do upload): o elemento SAI do desenho.
 * Copia profunda (nunca altera o desenho recebido).
 */
export function resolveGroupLogo(layout: CertificateLayout, logoRef: string | null): CertificateLayout {
  const copy = JSON.parse(JSON.stringify(layout)) as CertificateLayout;
  copy.elements = copy.elements.flatMap((el): CertificateElement[] => {
    if (el.type !== 'image' || !el.useGroupLogo) return [el];
    return logoRef ? [{ ...el, useGroupLogo: false, ref: logoRef }] : [];
  });
  return copy;
}

const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "12 de março de 2026" (campos UTC, mesma convencao de formatCivilDateBR). */
export function formatLongDateBR(date: Date): string {
  return `${date.getUTCDate()} de ${MONTHS_PT[date.getUTCMonth()]} de ${date.getUTCFullYear()}`;
}

/** Substituicao simples (sem expressoes): `{variavel}` da lista -> valor; ausente = string vazia. */
export function substituteVariables(text: string, vars: CertificateVariables): string {
  return text.replace(VARIABLE_TOKEN, (token, name: string) =>
    (CERTIFICATE_VARIABLES as readonly string[]).includes(name) ? (vars[name as CertificateVariable] ?? '') : token,
  );
}
