import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { resolveJwtSecret } from '../../../shared/config/runtime-config';
import { deriveSubkey } from '../../../shared/security/aes-gcm';
import { detectImageType, DetectedImage } from '../../../shared/uploads/image-signature';
import { resolveUploadsDir } from '../../../shared/uploads/uploads-dir';
import { privateFilePath, resolvePrivateUploadsDir } from '../registration-forms/private-storage';

/**
 * Fotos do feed em armazenamento PRIVADO (contrato secao 4). Reaproveita o SSOT existente:
 *  - assinatura do arquivo: `detectImageType` (shared/uploads/image-signature.ts: so JPEG/PNG/WEBP; SVG/GIF/HTML = null);
 *  - chave `org-<id>/<uuid>.<ext>` e resolucao sem path traversal: `privateFilePath` (registration-forms/private-storage.ts),
 *    aqui com a base FEED_MEDIA_DIR;
 *  - segredo derivado do JWT_SECRET (HKDF, `deriveSubkey`), como os tokens dos formularios.
 * Diretorio: FEED_MEDIA_DIR; padrao `<PRIVATE_UPLOADS_DIR>/feed` (subpasta que NAO casa `org-<n>`: a varredura semanal dos
 * anexos de formularios so olha `org-<n>` na raiz do diretorio privado, nunca entra aqui). Nunca dentro de UPLOADS_DIR
 * (servido em /api/uploads) nem IGUAL ao diretorio privado dos formularios: o boot falha (assertFeedMediaDirSafe).
 */

/** Limite por arquivo recebido (o multer corta antes de bufferizar tudo: 413). */
export const FEED_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
/** Lado maior da foto regravada e da miniatura. */
export const FEED_MEDIA_MAX_DIMENSION = 1600;
export const FEED_THUMB_MAX_DIMENSION = 480;
/** "Bomba de pixels": acima disto o sharp recusa ANTES de decodificar (le so o cabecalho). ~25 MP. */
export const FEED_MEDIA_MAX_INPUT_PIXELS = 25_000_000;
/** Teto de tempo de CPU do sharp por imagem (libvips aborta). */
export const FEED_MEDIA_TIMEOUT_SECONDS = 15;
/** Fotos processadas ao mesmo tempo neste processo (memoria: cada uma pode ocupar dezenas de MB) e fila maxima. */
export const FEED_MEDIA_CONCURRENCY = 2;
export const FEED_MEDIA_QUEUE_MAX = 16;

export function resolveFeedMediaDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.FEED_MEDIA_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(resolvePrivateUploadsDir(env), 'feed');
}

/** Boot: diretorio da midia do feed fora do publico e diferente do diretorio privado dos formularios. */
export function assertFeedMediaDirSafe(env: NodeJS.ProcessEnv = process.env): void {
  // Windows: caminho sem distincao de caixa (symlink nao e resolvido aqui: nao aponte FEED_MEDIA_DIR para outra pasta).
  const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  const feedDir = norm(resolveFeedMediaDir(env));
  const publicDir = norm(resolveUploadsDir());
  const formsDir = norm(resolvePrivateUploadsDir(env));
  if (feedDir === publicDir || feedDir.startsWith(publicDir + path.sep)) {
    throw new Error('FEED_MEDIA_DIR não pode ficar dentro de UPLOADS_DIR (as fotos do feed seriam públicas).');
  }
  const rel = path.relative(formsDir, feedDir);
  if (feedDir === formsDir || /^org-\d/.test(rel.split(path.sep)[0] ?? '')) {
    throw new Error('FEED_MEDIA_DIR não pode ser o diretório dos anexos dos formulários (PRIVATE_UPLOADS_DIR) nem uma pasta org-<n> dele.');
  }
}

/** Caminho absoluto de uma chave do feed (formato gerado pelo servidor) ou null. */
export function feedFilePath(key: string, baseDir: string = resolveFeedMediaDir()): string | null {
  return privateFilePath(key, baseDir);
}

/** Apaga as chaves (ignora inexistentes/invalidas). Devolve quantos arquivos saiu. Nunca lanca. */
export async function deleteFeedFiles(keys: Iterable<string>): Promise<number> {
  let deleted = 0;
  for (const key of keys) {
    const full = feedFilePath(key);
    if (!full) continue;
    try {
      await fs.unlink(full);
      deleted += 1;
    } catch {
      // ENOENT ou erro de disco: a varredura/limpeza tenta de novo; nunca derruba a acao principal.
    }
  }
  return deleted;
}

// ---------------------------------------------------------------------------------------------------------------
// Processamento (sharp)
// ---------------------------------------------------------------------------------------------------------------

type SharpModule = typeof import('sharp');
let sharpCache: SharpModule | null | undefined;

/** Sem o binario nativo do sharp o feed NAO aceita foto (diferente de /uploads): EXIF/GPS de menor nao pode passar. */
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

let running = 0;
const waiting: Array<() => void> = [];

/** Semaforo do processo: no maximo FEED_MEDIA_CONCURRENCY imagens no sharp; fila cheia = 'busy' (o chamador responde 429). */
async function withSlot<T>(fn: () => Promise<T>): Promise<T | 'busy'> {
  if (running >= FEED_MEDIA_CONCURRENCY) {
    if (waiting.length >= FEED_MEDIA_QUEUE_MAX) return 'busy';
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running += 1;
  }
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

export interface ProcessedFeedImage {
  main: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  mimeType: 'image/webp';
}

export type ProcessResult =
  | { ok: true; image: ProcessedFeedImage; detected: DetectedImage }
  | { ok: false; reason: 'TYPE' | 'DECODE' | 'UNAVAILABLE' | 'BUSY' };

/**
 * Valida (magic bytes) e REGRAVA a foto: aplica a orientacao EXIF e grava WEBP SEM metadados (EXIF/GPS/ICC/XMP saem:
 * o sharp so os copia com withMetadata/keepMetadata), lado maior <= 1600 px, + miniatura 480 px. So o 1o quadro de
 * WEBP/PNG animado. `limitInputPixels` barra bomba de pixels antes de decodificar; `timeout` corta imagem patologica.
 */
export async function processFeedImage(buffer: Buffer): Promise<ProcessResult> {
  const detected = detectImageType(buffer);
  if (!detected) return { ok: false, reason: 'TYPE' };
  const sharp = loadSharp();
  if (!sharp) return { ok: false, reason: 'UNAVAILABLE' };
  const result = await withSlot(async (): Promise<ProcessResult> => {
    try {
      const main = await sharp(buffer, { failOn: 'error', limitInputPixels: FEED_MEDIA_MAX_INPUT_PIXELS, animated: false })
        .rotate()
        .resize({ width: FEED_MEDIA_MAX_DIMENSION, height: FEED_MEDIA_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .timeout({ seconds: FEED_MEDIA_TIMEOUT_SECONDS })
        .toBuffer({ resolveWithObject: true });
      const thumb = await sharp(main.data, { failOn: 'error' })
        .resize({ width: FEED_THUMB_MAX_DIMENSION, height: FEED_THUMB_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 72 })
        .timeout({ seconds: FEED_MEDIA_TIMEOUT_SECONDS })
        .toBuffer();
      return { ok: true, detected, image: { main: main.data, thumb, width: main.info.width, height: main.info.height, mimeType: 'image/webp' } };
    } catch {
      return { ok: false, reason: 'DECODE' };
    }
  });
  return result === 'busy' ? { ok: false, reason: 'BUSY' } : result;
}

/** Grava foto + miniatura com nomes novos (`wx`: nunca sobrescreve; 0600). Falha no 2o apaga o 1o. */
export async function storeFeedImage(organizationId: number, image: ProcessedFeedImage): Promise<{ storageKey: string; thumbKey: string }> {
  const storageKey = `org-${organizationId}/${randomUUID()}.webp`;
  const thumbKey = `org-${organizationId}/${randomUUID()}.webp`;
  const full = feedFilePath(storageKey);
  const thumbFull = feedFilePath(thumbKey);
  if (!full || !thumbFull) throw new Error('Chave de armazenamento inválida.');
  await fs.mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
  await fs.writeFile(full, image.main, { flag: 'wx', mode: 0o600 });
  try {
    await fs.writeFile(thumbFull, image.thumb, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    await fs.unlink(full).catch(() => undefined);
    throw error;
  }
  return { storageKey, thumbKey };
}

// ---------------------------------------------------------------------------------------------------------------
// URL assinada (o <img> nao manda Authorization)
// ---------------------------------------------------------------------------------------------------------------

export type MediaVariant = 'full' | 'thumb';

const HOUR_MS = 60 * 60 * 1000;
/** Teto absoluto aceito para `e` (protege contra TTL mal configurado): 7 dias. */
const MAX_TTL_MS = 7 * 24 * HOUR_MS;

/** FEED_MEDIA_URL_TTL_HOURS (padrao 6; 1..168). Lido a cada chamada. */
export function feedMediaTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const h = Number(env.FEED_MEDIA_URL_TTL_HOURS);
  if (!Number.isFinite(h) || h <= 0) return 6 * HOUR_MS;
  return Math.min(Math.max(h, 1), 168) * HOUR_MS;
}

function signingKey(): Buffer {
  return deriveSubkey(resolveJwtSecret(process.env.JWT_SECRET), 'gingapp-feed-v1', 'media-url');
}

/**
 * Escopo da URL: `member` (post PUBLICADO, validade FEED_MEDIA_URL_TTL_HOURS) ou `review` (foto ainda NAO aprovada:
 * pendente sem post, post PENDING_APPROVAL, ou post HIDDEN visto pelo moderador). `review` vale so 30-35 min e e o
 * UNICO escopo aceito para essas fotos: quem recebeu a URL (autor/moderador) nao consegue usa-la como hospedagem que
 * contorna a aprovacao (ex.: colar o link num comentario) por mais que alguns minutos.
 */
export type MediaScope = 'member' | 'review';
export const REVIEW_URL_TTL_MS = 30 * 60 * 1000;
const REVIEW_BUCKET_MS = 5 * 60 * 1000;

/** HMAC-SHA256 (base64url, 43 chars) de grupo + midia + variante + expiracao (+ escopo review). */
export function mediaSignature(
  organizationId: number,
  mediaId: number,
  variant: MediaVariant,
  expiresAtSec: number,
  key: Buffer = signingKey(),
  scope: MediaScope = 'member',
): string {
  const material = `feed-media|v1|${organizationId}|${mediaId}|${variant}|${expiresAtSec}${scope === 'review' ? '|review' : ''}`;
  return createHmac('sha256', key).update(material).digest('base64url');
}

/**
 * Expiracao ARREDONDADA para a hora cheia seguinte de agora + TTL: a mesma URL vale por ate 1 h de requisicoes (o
 * navegador reaproveita o cache `private, max-age=3600`); validade efetiva entre TTL e TTL + 1 h. `review`: 30 min
 * arredondados para os 5 min seguintes.
 */
export function mediaExpiry(now: number = Date.now(), ttlMs: number = feedMediaTtlMs(), scope: MediaScope = 'member'): number {
  if (scope === 'review') return Math.ceil((now + REVIEW_URL_TTL_MS) / REVIEW_BUCKET_MS) * (REVIEW_BUCKET_MS / 1000);
  return Math.ceil((now + ttlMs) / HOUR_MS) * (HOUR_MS / 1000);
}

/** `/api/feed/media/<id>[/thumb]?e=<epoch s>&s=<assinatura>[&r=1]`. */
export function signedMediaUrl(
  organizationId: number,
  mediaId: number,
  variant: MediaVariant,
  expiresAtSec: number = mediaExpiry(),
  key?: Buffer,
  scope: MediaScope = 'member',
): string {
  const s = mediaSignature(organizationId, mediaId, variant, expiresAtSec, key, scope);
  return `/api/feed/media/${mediaId}${variant === 'thumb' ? '/thumb' : ''}?e=${expiresAtSec}&s=${s}${scope === 'review' ? '&r=1' : ''}`;
}

/** Parametros `e`/`s`(/`r`) bem formados e ainda validos (sem tocar no banco). */
export function parseSignedParams(
  e: unknown,
  s: unknown,
  now: number = Date.now(),
  r?: unknown,
): { expiresAtSec: number; signature: string; scope: MediaScope } | null {
  if (typeof e !== 'string' || typeof s !== 'string' || !/^\d{9,11}$/.test(e) || !/^[A-Za-z0-9_-]{43}$/.test(s)) return null;
  if (r !== undefined && r !== '1') return null;
  const scope: MediaScope = r === '1' ? 'review' : 'member';
  const expiresAtSec = Number(e);
  const expiresMs = expiresAtSec * 1000;
  const maxAhead = scope === 'review' ? REVIEW_URL_TTL_MS + REVIEW_BUCKET_MS : MAX_TTL_MS + HOUR_MS;
  if (expiresMs <= now || expiresMs > now + maxAhead) return null;
  return { expiresAtSec, signature: s, scope };
}

/** Comparacao em TEMPO CONSTANTE da assinatura recebida com a esperada. */
export function verifyMediaSignature(
  organizationId: number,
  mediaId: number,
  variant: MediaVariant,
  expiresAtSec: number,
  signature: string,
  key?: Buffer,
  scope: MediaScope = 'member',
): boolean {
  const expected = Buffer.from(mediaSignature(organizationId, mediaId, variant, expiresAtSec, key, scope));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
