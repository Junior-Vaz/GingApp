/**
 * Modelos PRONTOS de certificado (docs/CONTRATO_CERTIFICADOS_MODELOS.md secao 5): vivem no CODIGO, sem imagens de upload
 * (o logo entra so por `useGroupLogo`). Todos passam por validateCertificateLayout e ja estao NORMALIZADOS (provado em
 * test/certificate-templates.spec.ts). O `classico` (CLASSIC_LAYOUT) reproduz o PDF fixo anterior e e o desenho usado
 * para certificados antigos (sem layoutSnapshot) e quando o grupo nao tem modelo padrao.
 */
import {
  A4,
  CertificateLayout,
  CertificatePurposeKey,
  FontKey,
  ImageElement,
  QrElement,
  RectElement,
  TextElement,
} from './certificate-layout';

export interface CertificatePreset {
  key: string;
  name: string;
  /** Uso sugerido (o painel pode trocar ao criar a copia). */
  purpose: CertificatePurposeKey;
  layout: CertificateLayout;
}

/** Arredonda PARA BAIXO em 2 casas: garante x + w <= 100 depois da conversao. */
const floor2 = (v: number): number => Math.floor(v * 100) / 100;

/** Caixa em pt (A4 paisagem) -> porcentagem da pagina. */
function landscapeBox(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  return { x: floor2((x / A4.width) * 100), y: floor2((y / A4.height) * 100), w: floor2((w / A4.width) * 100), h: floor2((h / A4.height) * 100) };
}

type TextOpts = Partial<Omit<TextElement, 'id' | 'type' | 'x' | 'y' | 'w' | 'h' | 'text'>> & { fontKey?: FontKey };

function text(id: string, value: string, b: { x: number; y: number; w: number; h: number }, opts: TextOpts = {}): TextElement {
  return {
    id,
    type: 'text',
    ...b,
    text: value,
    fontKey: opts.fontKey ?? 'helvetica',
    size: opts.size ?? 14,
    color: opts.color ?? '#1F2933',
    align: opts.align ?? 'center',
    vAlign: opts.vAlign ?? 'top',
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    uppercase: opts.uppercase ?? false,
    letterSpacing: opts.letterSpacing ?? 0,
    lineHeight: opts.lineHeight ?? 1.15,
  };
}

function rect(id: string, b: { x: number; y: number; w: number; h: number }, opts: Partial<Omit<RectElement, 'id' | 'type'>> = {}): RectElement {
  return {
    id,
    type: 'rect',
    ...b,
    fill: opts.fill ?? null,
    fillOpacity: opts.fillOpacity ?? 1,
    stroke: opts.stroke ?? null,
    strokeWidth: opts.strokeWidth ?? 0,
    radius: opts.radius ?? 0,
  };
}

function logo(id: string, b: { x: number; y: number; w: number; h: number }): ImageElement {
  return { id, type: 'image', ...b, ref: null, useGroupLogo: true, fit: 'contain', opacity: 1 };
}

function qr(id: string, x: number, y: number, size: number, fg: string): QrElement {
  return { id, type: 'qr', x, y, size, fg };
}

function page(orientation: 'landscape' | 'portrait', color: string): CertificateLayout['page'] {
  return { orientation, background: { color, imageRef: null, imageFit: 'cover' } };
}

// ---------------------------------------------------------------------------------------------------------------
// Classico: o desenho fixo anterior (moldura dupla laranja, Helvetica), agora como layout.
// ---------------------------------------------------------------------------------------------------------------

const INK = '#1F2933';
const MUTED = '#52606D';
const ACCENT = '#B4531A';
const LEFT = 70;
const TEXT_W = A4.width - LEFT * 2;
const FOOTER_TOP = A4.height - 150;

export const CLASSIC_LAYOUT: CertificateLayout = {
  version: 1,
  page: page('landscape', '#FFFFFF'),
  elements: [
    rect('moldura-externa', landscapeBox(24, 24, A4.width - 48, A4.height - 48), { stroke: ACCENT, strokeWidth: 3 }),
    rect('moldura-interna', landscapeBox(32, 32, A4.width - 64, A4.height - 64), { stroke: ACCENT, strokeWidth: 0.8 }),
    text('grupo', '{grupo}', landscapeBox(LEFT, 70, TEXT_W, 22), { size: 13, color: MUTED, uppercase: true, letterSpacing: 1.5 }),
    text('cabecalho', 'CERTIFICADO', landscapeBox(LEFT, 100, TEXT_W, 54), { size: 40, color: ACCENT, bold: true, letterSpacing: 4 }),
    text('certificamos', 'Certificamos que', landscapeBox(LEFT, 175, TEXT_W, 22), { size: 14, color: MUTED }),
    text('aluno', '{aluno}', landscapeBox(LEFT, 196, TEXT_W, 74), { size: 30, color: INK, bold: true, vAlign: 'middle' }),
    text('recebeu', 'recebeu o certificado', landscapeBox(LEFT, 272, TEXT_W, 22), { size: 14, color: MUTED }),
    text('titulo', '{titulo}', landscapeBox(LEFT, 296, TEXT_W, 56), { size: 22, color: INK, bold: true }),
    text('graduacao', '{graduacao}', landscapeBox(LEFT, 354, TEXT_W, 22), { size: 14, color: MUTED }),
    text('emitido', 'Emitido em {data}', landscapeBox(LEFT, FOOTER_TOP, 360, 18), { size: 12, color: INK, align: 'left' }),
    text('codigo', 'Código de verificação: {codigo}', landscapeBox(LEFT, FOOTER_TOP + 22, 420, 14), { size: 10, color: MUTED, align: 'left' }),
    text('confira', 'Confira a autenticidade lendo o QR Code ou acessando:', landscapeBox(LEFT, FOOTER_TOP + 40, 420, 14), {
      size: 10,
      color: MUTED,
      align: 'left',
    }),
    text('link', '{link}', landscapeBox(LEFT, FOOTER_TOP + 54, 420, 28), { size: 10, color: ACCENT, align: 'left' }),
    qr('qr', floor2(((A4.width - LEFT - 90) / A4.width) * 100), floor2(((FOOTER_TOP - 20) / A4.height) * 100), 90, INK),
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Moderno: faixa lateral escura com logo e QR, tipografia Montserrat/Playfair.
// ---------------------------------------------------------------------------------------------------------------

const MODERN_LAYOUT: CertificateLayout = {
  version: 1,
  page: page('landscape', '#FFFFFF'),
  elements: [
    rect('faixa', { x: 0, y: 0, w: 30, h: 100 }, { fill: '#1E293B' }),
    rect('filete', { x: 30, y: 0, w: 1, h: 100 }, { fill: '#F59E0B' }),
    logo('logo', { x: 7, y: 9, w: 16, h: 22 }),
    text('grupo', '{grupo}', { x: 3, y: 34, w: 24, h: 12 }, { fontKey: 'montserrat', size: 13, color: '#FFFFFF', bold: true, uppercase: true, letterSpacing: 2, lineHeight: 1.3 }),
    qr('qr', 8.46, 70, 110, '#1E293B'),
    text('codigo', '{codigo}', { x: 3, y: 90.5, w: 24, h: 5 }, { fontKey: 'montserrat', size: 8, color: '#CBD5E1' }),
    text('cabecalho', 'CERTIFICADO', { x: 36, y: 13, w: 60, h: 12 }, { fontKey: 'montserrat', size: 44, color: '#1E293B', bold: true, align: 'left', letterSpacing: 6 }),
    text('titulo', '{titulo}', { x: 36, y: 26, w: 60, h: 10 }, { fontKey: 'montserrat', size: 18, color: '#D97706', align: 'left', lineHeight: 1.2 }),
    text('conferido', 'Conferido a', { x: 36, y: 40, w: 60, h: 5 }, { fontKey: 'montserrat', size: 12, color: '#64748B', align: 'left' }),
    text('aluno', '{aluno}', { x: 36, y: 45, w: 60, h: 15 }, { fontKey: 'playfair', size: 34, color: '#0F172A', bold: true, align: 'left', vAlign: 'middle' }),
    rect('destaque', { x: 36, y: 61.5, w: 12, h: 1 }, { fill: '#F59E0B' }),
    text('graduacao', '{graduacao}', { x: 36, y: 65, w: 60, h: 6 }, { fontKey: 'montserrat', size: 13, color: '#334155', align: 'left' }),
    text('emitido', 'Emitido em {dataExtenso}', { x: 36, y: 83, w: 50, h: 5 }, { fontKey: 'montserrat', size: 11, color: '#475569', align: 'left' }),
    text('link', 'Verifique a autenticidade em {link}', { x: 36, y: 88, w: 60, h: 7 }, { fontKey: 'montserrat', size: 9, color: '#64748B', align: 'left' }),
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Batizado: creme, moldura verde e amarela, Cinzel + Great Vibes no nome.
// ---------------------------------------------------------------------------------------------------------------

const BAPTISM_LAYOUT: CertificateLayout = {
  version: 1,
  page: page('landscape', '#FBF6EC'),
  elements: [
    rect('moldura-externa', { x: 2, y: 3, w: 96, h: 94 }, { stroke: '#1B5E20', strokeWidth: 2.5, radius: 12 }),
    rect('moldura-interna', { x: 3.2, y: 4.7, w: 93.6, h: 90.6 }, { stroke: '#F2C230', strokeWidth: 1, radius: 8 }),
    logo('logo', { x: 45, y: 8, w: 10, h: 14 }),
    text('grupo', '{grupo}', { x: 10, y: 23, w: 80, h: 5 }, { fontKey: 'cinzel', size: 14, color: '#1B5E20', uppercase: true, letterSpacing: 3 }),
    text('cabecalho', 'Certificado de Batizado', { x: 10, y: 29.5, w: 80, h: 10 }, { fontKey: 'cinzel', size: 34, color: '#1B5E20', bold: true }),
    text('certificamos', 'Certificamos que', { x: 10, y: 42, w: 80, h: 5 }, { fontKey: 'lora', size: 15, color: '#5D4037', italic: true }),
    text('aluno', '{aluno}', { x: 8, y: 47.5, w: 84, h: 15 }, { fontKey: 'greatvibes', size: 48, color: '#3E2723', vAlign: 'middle', lineHeight: 1 }),
    text('titulo', '{titulo}', { x: 10, y: 64, w: 80, h: 6 }, { fontKey: 'lora', size: 16, color: '#1B5E20', bold: true }),
    text('graduacao', '{graduacao}', { x: 10, y: 70.5, w: 80, h: 5 }, { fontKey: 'lora', size: 14, color: '#5D4037' }),
    text('emitido', '{dataExtenso}', { x: 8, y: 83, w: 40, h: 4.5 }, { fontKey: 'lora', size: 12, color: '#3E2723', align: 'left' }),
    text('codigo', 'Código de verificação: {codigo}', { x: 8, y: 88, w: 50, h: 4 }, { fontKey: 'lora', size: 10, color: '#6D4C41', align: 'left' }),
    qr('qr', 83, 79, 72, '#1B5E20'),
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Evento: faixa superior com o nome do evento (titulo), Montserrat.
// ---------------------------------------------------------------------------------------------------------------

const EVENT_LAYOUT: CertificateLayout = {
  version: 1,
  page: page('landscape', '#FFFFFF'),
  elements: [
    rect('faixa', { x: 0, y: 0, w: 100, h: 28 }, { fill: '#7C2D12' }),
    rect('filete', { x: 0, y: 28, w: 100, h: 1.2 }, { fill: '#FB923C' }),
    logo('logo', { x: 4, y: 5, w: 12, h: 18 }),
    text('grupo', '{grupo}', { x: 18, y: 6.5, w: 76, h: 5 }, { fontKey: 'montserrat', size: 13, color: '#FED7AA', bold: true, align: 'left', uppercase: true, letterSpacing: 2 }),
    text('cabecalho', 'Certificado de participação', { x: 18, y: 12, w: 78, h: 8.5 }, { fontKey: 'montserrat', size: 26, color: '#FFFFFF', bold: true, align: 'left', uppercase: true }),
    text('titulo', '{titulo}', { x: 18, y: 20.5, w: 78, h: 6 }, { fontKey: 'montserrat', size: 16, color: '#FFEDD5', align: 'left' }),
    text('certificamos', 'Certificamos que', { x: 10, y: 36, w: 80, h: 5 }, { fontKey: 'montserrat', size: 13, color: '#57534E' }),
    text('aluno', '{aluno}', { x: 8, y: 42, w: 84, h: 14 }, { fontKey: 'playfair', size: 36, color: '#1C1917', bold: true, vAlign: 'middle' }),
    text('participou', 'participou do evento acima, promovido pelo grupo {grupo}.', { x: 10, y: 58, w: 80, h: 10 }, {
      fontKey: 'montserrat',
      size: 13,
      color: '#57534E',
      lineHeight: 1.3,
    }),
    text('emitido', 'Emitido em {data}', { x: 6, y: 84, w: 40, h: 4.5 }, { fontKey: 'montserrat', size: 11, color: '#44403C', align: 'left' }),
    text('codigo', 'Código de verificação: {codigo}', { x: 6, y: 89, w: 60, h: 4 }, { fontKey: 'montserrat', size: 9, color: '#78716C', align: 'left' }),
    qr('qr', 86, 80, 80, '#7C2D12'),
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Minimalista: A4 retrato, branco, Lora, QR centralizado.
// ---------------------------------------------------------------------------------------------------------------

const MINIMAL_LAYOUT: CertificateLayout = {
  version: 1,
  page: page('portrait', '#FFFFFF'),
  elements: [
    text('grupo', '{grupo}', { x: 10, y: 9, w: 80, h: 3 }, { fontKey: 'lora', size: 12, color: '#6B7280', uppercase: true, letterSpacing: 3 }),
    rect('detalhe', { x: 46, y: 14.5, w: 8, h: 1 }, { fill: '#111827', radius: 4 }),
    text('cabecalho', 'Certificado', { x: 10, y: 20, w: 80, h: 7 }, { fontKey: 'lora', size: 44, color: '#111827' }),
    text('titulo', '{titulo}', { x: 10, y: 28.5, w: 80, h: 6 }, { fontKey: 'lora', size: 16, color: '#4B5563', italic: true, lineHeight: 1.3 }),
    text('concedido', 'concedido a', { x: 10, y: 40, w: 80, h: 3 }, { fontKey: 'lora', size: 12, color: '#6B7280', uppercase: true, letterSpacing: 2 }),
    text('aluno', '{aluno}', { x: 8, y: 44, w: 84, h: 10 }, { fontKey: 'lora', size: 30, color: '#111827', bold: true, vAlign: 'middle' }),
    text('graduacao', '{graduacao}', { x: 10, y: 55.5, w: 80, h: 3 }, { fontKey: 'lora', size: 13, color: '#4B5563' }),
    text('emitido', '{dataExtenso}', { x: 10, y: 64, w: 80, h: 3 }, { fontKey: 'lora', size: 12, color: '#374151' }),
    qr('qr', 41.6, 73, 100, '#111827'),
    text('codigo', 'Código {codigo}', { x: 10, y: 86.5, w: 80, h: 2.5 }, { fontKey: 'lora', size: 9, color: '#6B7280' }),
    text('link', '{link}', { x: 10, y: 89.5, w: 80, h: 4 }, { fontKey: 'lora', size: 8, color: '#9CA3AF' }),
  ],
};

/** Modelos prontos, na ordem em que o painel os lista. */
export const CERTIFICATE_PRESETS: readonly CertificatePreset[] = [
  { key: 'classico', name: 'Clássico', purpose: 'GRADUACAO', layout: CLASSIC_LAYOUT },
  { key: 'moderno', name: 'Moderno', purpose: 'PARTICIPACAO', layout: MODERN_LAYOUT },
  { key: 'batizado', name: 'Batizado', purpose: 'BATIZADO', layout: BAPTISM_LAYOUT },
  { key: 'evento', name: 'Evento', purpose: 'EVENTO', layout: EVENT_LAYOUT },
  { key: 'minimalista', name: 'Minimalista', purpose: 'OUTRO', layout: MINIMAL_LAYOUT },
];

export const CERTIFICATE_PRESET_KEYS: readonly string[] = CERTIFICATE_PRESETS.map((p) => p.key);

export function findPreset(key: string): CertificatePreset | undefined {
  return CERTIFICATE_PRESETS.find((p) => p.key === key);
}
