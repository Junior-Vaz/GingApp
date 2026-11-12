import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { resolveUploadsDir } from '../../../shared/uploads/uploads-dir';

/**
 * Armazenamento PRIVADO dos anexos das inscricoes (comprovante/documento). Regras:
 *  - diretorio PROPRIO (PRIVATE_UPLOADS_DIR; padrao = irmao de UPLOADS_DIR chamado "private-uploads"), NUNCA dentro do
 *    diretorio servido por GET /api/uploads/:file (que so aceita nomes `<uuid>.<ext>` na raiz de UPLOADS_DIR) e nunca
 *    servido por rota publica: so por GET /event-forms/:id/submissions/:sid/files/:fileId (autenticado, mesmo grupo);
 *  - nome aleatorio (uuid), o nome do cliente nunca entra no caminho; chave relativa `org-<id>/<uuid>.<ext>`;
 *  - tipo REAL pelos magic bytes (JPEG, PNG, WEBP, PDF); qualquer outro (SVG, HTML, GIF, ZIP...) e recusado.
 */

export type PrivateFileType = { mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'; ext: 'jpg' | 'png' | 'webp' | 'pdf' };

/**
 * Teto ABSOLUTO por arquivo: 9 MB, abaixo do `client_max_body_size 10m` do nginx do app (acima disso o nginx cortaria
 * com um 413 em HTML, sem o `code` FILE_TOO_LARGE que o app entende).
 */
export const FORMS_FILE_HARD_MAX_MB = 9;

/** Limite por arquivo (FORMS_FILE_MAX_MB; padrao 5 MB; valores acima de 9 MB sao reduzidos para 9). Lido a cada chamada. */
export function formsFileMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const mb = Number(env.FORMS_FILE_MAX_MB);
  if (!Number.isFinite(mb) || mb <= 0) return 5 * 1024 * 1024;
  return Math.floor(Math.min(mb, FORMS_FILE_HARD_MAX_MB) * 1024 * 1024);
}

type SharpModule = typeof import('sharp');
let sharpCache: SharpModule | null | undefined;

/** SO PARA TESTES: forca o sharp "indisponivel" (null) ou volta ao carregamento normal (undefined). */
export function setSharpForTests(value: null | undefined): void {
  sharpCache = value;
}

/** Mesmo carregamento sob demanda de uploads.service.ts: sem o binario nativo, segue SEM reprocessar (com aviso). */
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

/** Lado maior de uma imagem anexada depois do reprocessamento (comprovante continua legivel). */
export const FORMS_IMAGE_MAX_DIMENSION = 2400;

/**
 * Reprocessa a IMAGEM anexada por anonimo (mesmo formato): aplica a orientacao EXIF e grava SEM metadados (EXIF/GPS/
 * ICC saem: o sharp so os copia com withMetadata()). PDF passa intocado. Devolve null se a imagem nao decodifica
 * (o chamador responde 415). `reprocessed=false` = sharp indisponivel na plataforma (arquivo original, com aviso).
 */
export async function sanitizeImage(buffer: Buffer, type: PrivateFileType): Promise<{ buffer: Buffer; reprocessed: boolean } | null> {
  if (type.mime === 'application/pdf') return { buffer, reprocessed: false };
  const sharp = loadSharp();
  if (!sharp) return { buffer, reprocessed: false };
  try {
    const pipeline = sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: FORMS_IMAGE_MAX_DIMENSION, height: FORMS_IMAGE_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true });
    const out =
      type.ext === 'jpg' ? await pipeline.jpeg({ quality: 85 }).toBuffer() : type.ext === 'png' ? await pipeline.png().toBuffer() : await pipeline.webp({ quality: 85 }).toBuffer();
    return { buffer: out, reprocessed: true };
  } catch {
    return null;
  }
}

/** Lado maior da foto do participante (campo PHOTO) depois do reprocessamento. */
export const FORMS_PHOTO_MAX_DIMENSION = 1200;
export const FORMS_PHOTO_QUALITY = 82;
/** "Bomba de pixels": acima disto o sharp recusa antes de decodificar (~25 MP). */
export const FORMS_PHOTO_MAX_INPUT_PIXELS = 25_000_000;
export const FORMS_PHOTO_TIMEOUT_SECONDS = 15;
/** Fotos no sharp ao mesmo tempo neste processo (cada uma pode ocupar dezenas de MB) e fila maxima. */
export const FORMS_PHOTO_CONCURRENCY = 2;
export const FORMS_PHOTO_QUEUE_MAX = 16;

let photosRunning = 0;
const photosWaiting: Array<() => void> = [];

/** Semaforo do processo; fila cheia = 'busy'. */
async function withPhotoSlot<T>(fn: () => Promise<T>): Promise<T | 'busy'> {
  if (photosRunning >= FORMS_PHOTO_CONCURRENCY) {
    if (photosWaiting.length >= FORMS_PHOTO_QUEUE_MAX) return 'busy';
    await new Promise<void>((resolve) => photosWaiting.push(resolve));
  } else {
    photosRunning += 1;
  }
  try {
    return await fn();
  } finally {
    const next = photosWaiting.shift();
    if (next) next();
    else photosRunning -= 1;
  }
}

export type PhotoSanitizeResult =
  | { status: 'ok'; buffer: Buffer; width: number; height: number }
  | { status: 'unreadable' | 'unavailable' | 'busy' };

/**
 * Foto do participante (campo PHOTO): SEMPRE regravada como WebP (lado maior 1200, q82), com a orientacao EXIF aplicada e
 * SEM metadados (EXIF/GPS/ICC). O sharp e OBRIGATORIO: sem ele `unavailable` (o chamador responde 503 e NAO grava o
 * original, que poderia carregar GPS de um menor). `unreadable` = nao decodifica / bomba de pixels / estourou o tempo.
 */
export async function sanitizePhotoImage(buffer: Buffer): Promise<PhotoSanitizeResult> {
  const sharp = loadSharp();
  if (!sharp) return { status: 'unavailable' };
  const result = await withPhotoSlot(async (): Promise<PhotoSanitizeResult> => {
    try {
      const out = await sharp(buffer, { failOn: 'error', limitInputPixels: FORMS_PHOTO_MAX_INPUT_PIXELS, animated: false })
        .rotate()
        .resize({ width: FORMS_PHOTO_MAX_DIMENSION, height: FORMS_PHOTO_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: FORMS_PHOTO_QUALITY })
        .timeout({ seconds: FORMS_PHOTO_TIMEOUT_SECONDS })
        .toBuffer({ resolveWithObject: true });
      return { status: 'ok', buffer: out.data, width: out.info.width, height: out.info.height };
    } catch {
      return { status: 'unreadable' };
    }
  });
  return result === 'busy' ? { status: 'busy' } : result;
}

/** Diretorio privado. Lido a cada chamada (os testes trocam a env). */
export function resolvePrivateUploadsDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PRIVATE_UPLOADS_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(path.dirname(resolveUploadsDir()), 'private-uploads');
}

/** Assinatura do arquivo. O mimetype/extensao informados pelo cliente nao provam nada. */
export function detectPrivateFileType(buf: Buffer): PrivateFileType | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  // PDF: "%PDF-" no inicio do arquivo (o leitor do navegador exige isso no 1o KB; aqui exigimos no byte 0).
  if (buf.toString('ascii', 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

/** Chave relativa gerada pelo servidor; qualquer outra forma e recusada (path traversal impossivel). */
export const STORAGE_KEY_REGEX = /^org-\d{1,10}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$/;

/** Caminho absoluto de uma chave, ou null se a chave nao for do formato gerado / escapar do diretorio. */
export function privateFilePath(storageKey: string, baseDir: string = resolvePrivateUploadsDir()): string | null {
  if (!STORAGE_KEY_REGEX.test(storageKey)) return null;
  const base = path.resolve(baseDir);
  const full = path.resolve(base, ...storageKey.split('/'));
  return full.startsWith(base + path.sep) ? full : null;
}

/** Nome original "limpo" (so para exibir/baixar): sem caminho, sem controle, so caracteres seguros, ate 120. */
export function sanitizeOriginalName(name: string | undefined | null, ext: string): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  if (!cleaned) return `arquivo.${ext}`;
  return /\.[A-Za-z0-9]{1,5}$/.test(cleaned) ? cleaned : `${cleaned}.${ext}`;
}

export interface StoredPrivateFile {
  storageKey: string;
  sha256: string;
  sizeBytes: number;
}

/** Grava o buffer (ja validado) com nome novo; `wx` = nunca sobrescreve. */
export async function storePrivateFile(organizationId: number, buffer: Buffer, type: PrivateFileType): Promise<StoredPrivateFile> {
  const storageKey = `org-${organizationId}/${randomUUID()}.${type.ext}`;
  const full = privateFilePath(storageKey);
  if (!full) throw new Error('Chave de armazenamento invalida.');
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer, { flag: 'wx', mode: 0o600 });
  return { storageKey, sha256: createHash('sha256').update(buffer).digest('hex'), sizeBytes: buffer.length };
}

/** Apaga (ignora "nao existe"). Devolve true se apagou. */
export async function deletePrivateFile(storageKey: string): Promise<boolean> {
  const full = privateFilePath(storageKey);
  if (!full) return false;
  try {
    await fs.unlink(full);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
