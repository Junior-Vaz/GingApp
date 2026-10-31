import { Logger } from '@nestjs/common';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import * as path from 'node:path';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { formatCivilDateBR } from '../../../shared/dates/format-br';
import { UPLOAD_FILENAME_REGEX, UPLOAD_URL_PREFIX } from '../../../shared/uploads/image-ref';
import { detectImageType } from '../../../shared/uploads/image-signature';
import { resolveUploadsDir } from '../../../shared/uploads/uploads-dir';
import {
  CertificateLayout,
  CertificateVariables,
  FONT_VARIANTS,
  FontKey,
  ImageElement,
  LAYOUT_LIMITS,
  QrElement,
  RectElement,
  TextElement,
  formatLongDateBR,
  layoutUploadRefs,
  substituteVariables,
} from './certificate-layout';
import { CLASSIC_LAYOUT } from './certificate-presets';

/** Dados do certificado impresso. Nada além do que a verificação pública já mostraria (+ graduação, só na rota autenticada). */
export interface CertificatePdfData {
  organizationName: string;
  studentName: string;
  title: string;
  /** Nome do nível de graduação vinculado (opcional). */
  graduationName?: string | null;
  issuedAt: Date;
  verificationCode: string;
  /** URL pública de verificação (APP_URL/verificar/<código>); sem ela o QR leva só o código. */
  verificationUrl?: string | null;
}

/** Pontos de injeção para os testes (diretórios temporários / fonte inexistente). A produção não os passa. */
export interface CertificateRenderOptions {
  uploadsDir?: string;
  fontsDir?: string;
}

const logger = new Logger('CertificatePdf');

/** Imagem de upload lida para o PDF: teto por arquivo (os uploads são reprocessados para <= 1600 px; isto é só defesa). */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------------------------
// Fontes (contrato secao 4): arquivos OFL em backend/assets/fonts (subset latin do @fontsource, .woff lido pelo fontkit)
// ---------------------------------------------------------------------------------------------------------------

type Variant = 'regular' | 'bold' | 'italic' | 'boldItalic';

const FONT_FILES: Record<Exclude<FontKey, 'helvetica'>, Partial<Record<Variant, string>>> = {
  playfair: {
    regular: 'playfair-display-latin-400-normal.woff',
    bold: 'playfair-display-latin-700-normal.woff',
    italic: 'playfair-display-latin-400-italic.woff',
    boldItalic: 'playfair-display-latin-700-italic.woff',
  },
  cinzel: { regular: 'cinzel-latin-400-normal.woff', bold: 'cinzel-latin-700-normal.woff' },
  lora: {
    regular: 'lora-latin-400-normal.woff',
    bold: 'lora-latin-700-normal.woff',
    italic: 'lora-latin-400-italic.woff',
    boldItalic: 'lora-latin-700-italic.woff',
  },
  montserrat: {
    regular: 'montserrat-latin-400-normal.woff',
    bold: 'montserrat-latin-700-normal.woff',
    italic: 'montserrat-latin-400-italic.woff',
    boldItalic: 'montserrat-latin-700-italic.woff',
  },
  greatvibes: { regular: 'great-vibes-latin-400-normal.woff' },
};

const HELVETICA: Record<Variant, string> = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
  boldItalic: 'Helvetica-BoldOblique',
};

/**
 * Diretório das fontes: `dist/assets/fonts` (copiado pelo nest-cli.json) quando roda compilado; `backend/assets/fonts`
 * quando roda pelo ts-node (src/). Os dois ficam a 3 e 4 níveis deste arquivo.
 */
export function defaultFontsDir(): string {
  const candidates = [path.resolve(__dirname, '..', '..', '..', 'assets', 'fonts'), path.resolve(__dirname, '..', '..', '..', '..', 'assets', 'fonts')];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[candidates.length - 1];
}

/** Cache dos arquivos de fonte (lidos uma vez por processo; null = ausente/ilegível). */
const fontBufferCache = new Map<string, Buffer | null>();

function readFontFile(file: string): Buffer | null {
  if (!fontBufferCache.has(file)) {
    try {
      fontBufferCache.set(file, readFileSync(file));
    } catch {
      fontBufferCache.set(file, null);
    }
  }
  return fontBufferCache.get(file) ?? null;
}

function variantOf(bold: boolean, italic: boolean): Variant {
  return bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
}

/**
 * Seleciona a fonte do elemento no documento. Flag que a fonte não tem é ignorada; fonte que falhar ao carregar (arquivo
 * ausente, formato inválido) cai na Helvetica — nunca derruba o PDF.
 */
class FontSelector {
  private readonly registered = new Set<string>();
  private readonly failed = new Set<string>();
  private warned = false;

  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly fontsDir: string,
  ) {}

  use(key: FontKey, bold: boolean, italic: boolean): void {
    const caps = FONT_VARIANTS[key] ?? FONT_VARIANTS.helvetica;
    const variant = variantOf(bold && caps.bold, italic && caps.italic);
    if (key === 'helvetica' || !(key in FONT_FILES)) {
      this.doc.font(HELVETICA[variant]);
      return;
    }
    const name = `${key}-${variant}`;
    if (!this.failed.has(name)) {
      try {
        if (!this.registered.has(name)) {
          const file = FONT_FILES[key as Exclude<FontKey, 'helvetica'>][variant];
          const buffer = file ? readFontFile(path.join(this.fontsDir, file)) : null;
          if (!buffer) throw new Error(`arquivo da fonte ${name} ausente em ${this.fontsDir}`);
          this.doc.registerFont(name, buffer);
          this.registered.add(name);
        }
        this.doc.font(name); // o fontkit só analisa o arquivo aqui
        return;
      } catch (error) {
        this.failed.add(name);
        if (!this.warned) {
          this.warned = true;
          logger.warn(`Fonte ${name} indisponível (${(error as Error).message}); usando Helvetica.`);
        }
      }
    }
    this.doc.font(HELVETICA[variant]);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Imagens (contrato secao 6): só referência de upload; ausente/ilegível = elemento pulado
// ---------------------------------------------------------------------------------------------------------------

type SharpModule = typeof import('sharp');
let sharpCache: SharpModule | null | undefined;

function loadSharp(): SharpModule | null {
  if (sharpCache !== undefined) return sharpCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sharpCache = require('sharp') as SharpModule;
  } catch {
    sharpCache = null;
  }
  return sharpCache;
}

/**
 * Lê a imagem `/api/uploads/<arquivo>` e devolve um buffer que o pdfkit aceita (JPEG como está; PNG/WebP convertidos para
 * PNG 8 bits pelo sharp). Qualquer problema = null (o elemento é pulado).
 */
async function loadUploadImage(ref: string, uploadsDir: string): Promise<Buffer | null> {
  try {
    if (!ref.startsWith(UPLOAD_URL_PREFIX)) return null;
    const filename = ref.slice(UPLOAD_URL_PREFIX.length);
    if (!UPLOAD_FILENAME_REGEX.test(filename)) return null;
    const full = path.join(uploadsDir, filename);
    const stat = await fs.stat(full);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) return null;
    const data = await fs.readFile(full);
    const type = detectImageType(data);
    if (!type) return null;
    if (type.ext === 'jpg') return data;
    const sharp = loadSharp();
    if (!sharp) return type.ext === 'png' ? data : null; // sem sharp, WebP não entra no PDF
    return await sharp(data, { failOn: 'error', limitInputPixels: 40_000_000 }).png().toBuffer();
  } catch {
    return null;
  }
}

async function loadImages(layout: CertificateLayout, uploadsDir: string): Promise<Map<string, Buffer | null>> {
  const refs = layoutUploadRefs(layout).slice(0, LAYOUT_LIMITS.maxImages);
  const loaded = await Promise.all(refs.map(async (ref) => [ref, await loadUploadImage(ref, uploadsDir)] as const));
  return new Map(loaded);
}

// ---------------------------------------------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------------------------------------------

interface PageBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxOf(el: { x: number; y: number; w: number; h: number }, W: number, H: number): PageBox {
  return { x: (el.x / 100) * W, y: (el.y / 100) * H, w: (el.w / 100) * W, h: (el.h / 100) * H };
}

function drawImage(doc: PDFKit.PDFDocument, image: Buffer, box: PageBox, fit: 'cover' | 'contain', opacity = 1): void {
  doc.save();
  try {
    if (opacity < 1) doc.opacity(opacity);
    if (fit === 'cover') {
      doc.rect(box.x, box.y, box.w, box.h).clip();
      doc.image(image, box.x, box.y, { cover: [box.w, box.h], align: 'center', valign: 'center' });
    } else {
      doc.image(image, box.x, box.y, { fit: [box.w, box.h], align: 'center', valign: 'center' });
    }
  } catch (error) {
    logger.warn(`Imagem ignorada no certificado: ${(error as Error).message}`);
  } finally {
    doc.restore();
  }
}

function drawRect(doc: PDFKit.PDFDocument, el: RectElement, box: PageBox): void {
  const stroke = el.stroke && el.strokeWidth > 0 ? el.stroke : null;
  if (!el.fill && !stroke) return;
  const radius = Math.min(el.radius, box.w / 2, box.h / 2);
  doc.save();
  try {
    const shape = () => (radius > 0 ? doc.roundedRect(box.x, box.y, box.w, box.h, radius) : doc.rect(box.x, box.y, box.w, box.h));
    if (el.fill) {
      shape();
      doc.fillOpacity(el.fillOpacity).fill(el.fill);
    }
    if (stroke) {
      shape();
      doc.strokeOpacity(1).lineWidth(el.strokeWidth).stroke(stroke);
    }
  } finally {
    doc.restore();
  }
}

/** O fontkit aceita o objeto { recurso: false } (os tipos do pdfkit só declaram a lista). */
const NO_LIGATURES = { liga: false } as unknown as PDFKit.Mixins.TextOptions['features'];

/**
 * Texto dentro da caixa: quebra pela largura, corta na altura (a 1ª linha sempre sai), vAlign pela altura realmente
 * ocupada, lineHeight como multiplicador do tamanho e letterSpacing em pt. Nunca cria página nova (pdfkit com `height`).
 */
function drawText(doc: PDFKit.PDFDocument, fonts: FontSelector, el: TextElement, box: PageBox, vars: CertificateVariables): void {
  let value = substituteVariables(el.text, vars);
  if (el.uppercase) value = value.toLocaleUpperCase('pt-BR');
  if (value.trim() === '') return;

  fonts.use(el.fontKey, el.bold, el.italic);
  doc.fontSize(el.size);
  const natural = doc.currentLineHeight(true);
  const step = el.size * el.lineHeight;
  const lineGap = step - natural;
  const options: PDFKit.Mixins.TextOptions = {
    width: box.w,
    align: el.align,
    lineGap,
    characterSpacing: el.letterSpacing,
    lineBreak: true,
    // Sem a ligadura fi/fl: com ela o texto copiado/extraído do PDF perde o "i" ("verifcar"), quebrando o link.
    features: NO_LIGATURES,
  };

  const lines = Math.max(1, Math.round(doc.heightOfString(value, options) / step));
  // Mesma regra do LineWrapper do pdfkit: a linha k (k >= 2) só sai se (k-1)*step + natural <= altura da caixa.
  const fitting = 1 + Math.max(0, Math.floor((box.h - natural) / step + 1e-6));
  const shown = Math.min(lines, fitting);
  const used = (shown - 1) * step + natural;
  const free = Math.max(0, box.h - used);
  const offset = el.vAlign === 'middle' ? free / 2 : el.vAlign === 'bottom' ? free : 0;

  doc.fillColor(el.color).fillOpacity(1);
  doc.text(value, box.x, box.y + offset, { ...options, height: Math.max(box.h - offset, used) + 0.01 });
}

/** QR sobre placa branca com margem (contrato secao 8). Conteúdo: o link de verificação ou, sem APP_URL, o código. */
function drawQr(doc: PDFKit.PDFDocument, el: QrElement, W: number, H: number, contents: string[]): void {
  const x = (el.x / 100) * W;
  const y = (el.y / 100) * H;
  const size = el.size;
  doc.save();
  try {
    drawQrModules(doc, x, y, size, el.fg, contents);
  } finally {
    doc.restore();
  }
}

function drawQrModules(doc: PDFKit.PDFDocument, x: number, y: number, size: number, fg: string, contents: string[]): void {
  doc.fillOpacity(1).rect(x, y, size, size).fill('#FFFFFF');
  let modules: { size: number; get(row: number, col: number): number | boolean } | null = null;
  for (const content of contents) {
    if (!content) continue;
    try {
      modules = QRCode.create(content, { errorCorrectionLevel: 'M' }).modules;
      break;
    } catch {
      modules = null;
    }
  }
  if (modules) {
    const margin = Math.max(4, size * 0.07);
    const cell = (size - margin * 2) / modules.size;
    const bleed = cell * 0.02; // sobreposição mínima: sem fresta entre módulos vizinhos
    for (let row = 0; row < modules.size; row++) {
      let col = 0;
      while (col < modules.size) {
        if (!modules.get(row, col)) {
          col++;
          continue;
        }
        const start = col;
        while (col < modules.size && modules.get(row, col)) col++;
        doc.rect(x + margin + start * cell, y + margin + row * cell, (col - start) * cell + bleed, cell + bleed);
      }
    }
    doc.fill(fg);
  }
}

function variablesOf(data: CertificatePdfData): CertificateVariables {
  return {
    aluno: data.studentName,
    grupo: data.organizationName,
    titulo: data.title,
    graduacao: data.graduationName ?? '',
    data: formatCivilDateBR(data.issuedAt),
    dataExtenso: formatLongDateBR(data.issuedAt),
    codigo: data.verificationCode,
    link: data.verificationUrl ?? '',
  };
}

/**
 * Renderizador ÚNICO dos certificados (contrato secao 1): desenha o `layout` (já validado) numa página A4 com pdfkit.
 * Sem layout = CLASSIC_LAYOUT (certificados antigos). Elementos em ordem (o último fica por cima). Falha de imagem ou de
 * fonte nunca derruba o PDF. Devolve o arquivo inteiro em memória.
 */
export async function renderCertificatePdf(
  data: CertificatePdfData,
  layout: CertificateLayout | null = null,
  options: CertificateRenderOptions = {},
): Promise<Buffer> {
  const design = layout ?? CLASSIC_LAYOUT;
  const images = await loadImages(design, options.uploadsDir ?? resolveUploadsDir());

  const doc = new PDFDocument({
    size: 'A4',
    layout: design.page.orientation,
    margin: 0,
    info: {
      Title: `Certificado - ${data.title}`.slice(0, 200),
      Author: data.organizationName.slice(0, 200),
      Producer: 'GingApp',
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const W = doc.page.width;
  const H = doc.page.height;
  const fonts = new FontSelector(doc, options.fontsDir ?? defaultFontsDir());
  const vars = variablesOf(data);

  doc.rect(0, 0, W, H).fill(design.page.background.color);
  const bgRef = design.page.background.imageRef;
  const bg = bgRef ? images.get(bgRef) : null;
  if (bg) drawImage(doc, bg, { x: 0, y: 0, w: W, h: H }, design.page.background.imageFit);

  for (const el of design.elements) {
    try {
      if (el.type === 'rect') drawRect(doc, el, boxOf(el, W, H));
      else if (el.type === 'text') drawText(doc, fonts, el, boxOf(el, W, H), vars);
      else if (el.type === 'image') {
        const image = imageOf(el, images);
        if (image) drawImage(doc, image, boxOf(el, W, H), el.fit, el.opacity);
      } else if (el.type === 'qr') drawQr(doc, el, W, H, [data.verificationUrl ?? '', data.verificationCode]);
    } catch (error) {
      // Defesa: um elemento problemático nunca derruba o certificado inteiro.
      logger.warn(`Elemento "${el.id}" ignorado no certificado: ${(error as Error).message}`);
    }
  }

  doc.end();
  return done;
}

function imageOf(el: ImageElement, images: Map<string, Buffer | null>): Buffer | null {
  if (el.useGroupLogo || !el.ref) return null; // logo do grupo é resolvido ANTES (resolveGroupLogo)
  return images.get(el.ref) ?? null;
}
