import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { detectImageType } from '../../../shared/uploads/image-signature';
import { resolveUploadsDir } from '../../../shared/uploads/uploads-dir';
import { resolveFeedMediaDir } from '../feed/feed-media-storage';
import { resolvePrivateUploadsDir } from '../registration-forms/private-storage';

/**
 * Foto PROPRIA do atleta de fora do chaveamento (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md 1): armazenamento PRIVADO e pipeline de
 * imagem. Nao e o `/api/uploads` comum: o arquivo so sai por rota que confere a regra de privacidade do telao.
 *  - diretorio: TOURNAMENT_PHOTOS_DIR; padrao `<PRIVATE_UPLOADS_DIR>/tournament-photos` (subpasta que NAO casa `org-<n>`: a
 *    varredura dos anexos de formularios so entra em `org-<n>` na raiz do diretorio privado). Nunca dentro de UPLOADS_DIR
 *    (servido em /api/uploads), nem igual ao diretorio privado dos formularios, nem ao do feed (assertTournamentPhotosDirSafe);
 *  - arquivo `<uuid>.webp`, modo 0600, flag `wx` (nunca sobrescreve); o nome e SEMPRE gerado aqui e so nomes nesse formato
 *    chegam ao disco (sem path traversal);
 *  - pipeline: magic bytes (JPEG/PNG/WebP; HEIC/GIF/SVG/HTML = 415) -> sharp OBRIGATORIO (sem ele: 503 e NADA e gravado,
 *    nunca o original: EXIF/GPS de menor nao pode passar) -> rotate (EXIF) + lado maior 800 + WebP q82 sem metadados;
 *    `limitInputPixels` 25 MP, timeout 15 s, semaforo de concorrencia.
 */

export const TOURNAMENT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const TOURNAMENT_PHOTO_MAX_DIMENSION = 800;
export const TOURNAMENT_PHOTO_QUALITY = 82;
/** "Bomba de pixels": acima disto o sharp recusa ANTES de decodificar (le so o cabecalho). */
export const TOURNAMENT_PHOTO_MAX_INPUT_PIXELS = 25_000_000;
export const TOURNAMENT_PHOTO_TIMEOUT_SECONDS = 15;
/** Fotos no sharp ao mesmo tempo neste processo e fila maxima (excedeu: 'BUSY'). */
export const TOURNAMENT_PHOTO_CONCURRENCY = 2;
export const TOURNAMENT_PHOTO_QUEUE_MAX = 16;
/** Arquivo so e candidato a lixo (GC) depois deste tempo: quem acabou de enviar ainda nao confirmou no banco. */
export const TOURNAMENT_PHOTO_GC_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** Nome gerado pelo servidor: uuid v4 (minusculo) + `.webp`. QUALQUER outro nome nunca toca o disco. */
export const TOURNAMENT_PHOTO_FILE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

export function isTournamentPhotoFile(value: unknown): value is string {
  return typeof value === 'string' && TOURNAMENT_PHOTO_FILE_REGEX.test(value);
}

/** Diretorio das fotos. Lido a cada chamada (os testes trocam a env). */
export function resolveTournamentPhotosDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.TOURNAMENT_PHOTOS_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(resolvePrivateUploadsDir(env), 'tournament-photos');
}

/** Cota por grupo em bytes (TOURNAMENT_PHOTOS_QUOTA_MB; padrao 200; valor invalido ou <= 0 cai no padrao). */
export function tournamentPhotosQuotaBytes(env: NodeJS.ProcessEnv = process.env): number {
  const mb = Number(env.TOURNAMENT_PHOTOS_QUOTA_MB);
  return Math.floor((Number.isFinite(mb) && mb > 0 ? mb : 200) * 1024 * 1024);
}

/** Boot: diretorio fora do publico e diferente dos diretorios privados dos formularios e do feed. */
export function assertTournamentPhotosDirSafe(env: NodeJS.ProcessEnv = process.env): void {
  const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  const dir = norm(resolveTournamentPhotosDir(env));
  const publicDir = norm(resolveUploadsDir());
  const formsDir = norm(resolvePrivateUploadsDir(env));
  if (dir === publicDir || dir.startsWith(publicDir + path.sep)) {
    throw new Error('TOURNAMENT_PHOTOS_DIR não pode ficar dentro de UPLOADS_DIR (as fotos dos atletas seriam públicas).');
  }
  const rel = path.relative(formsDir, dir);
  if (dir === formsDir || /^org-\d/.test(rel.split(path.sep)[0] ?? '')) {
    throw new Error('TOURNAMENT_PHOTOS_DIR não pode ser o diretório dos anexos dos formulários (PRIVATE_UPLOADS_DIR) nem uma pasta org-<n> dele.');
  }
  // Feed: a limpeza das fotos do feed varre o proprio diretorio; as duas pastas nunca se contem nem se igualam.
  const feedDir = norm(resolveFeedMediaDir(env));
  if (dir === feedDir || dir.startsWith(feedDir + path.sep) || feedDir.startsWith(dir + path.sep)) {
    throw new Error('TOURNAMENT_PHOTOS_DIR não pode ser igual, ancestral nem descendente de FEED_MEDIA_DIR (as fotos do feed e dos atletas ficam em pastas separadas).');
  }
}

/** Caminho absoluto de um nome gerado pelo servidor, ou null (nome fora do formato / escapa do diretorio). */
export function tournamentPhotoPath(file: string, baseDir: string = resolveTournamentPhotosDir()): string | null {
  if (!isTournamentPhotoFile(file)) return null;
  const base = path.resolve(baseDir);
  const full = path.resolve(base, file);
  return path.dirname(full) === base ? full : null;
}

/** Le a foto (<= poucas centenas de KB) ou null se o nome for invalido / o arquivo nao existir. Nunca lanca por ENOENT. */
export async function readTournamentPhoto(file: string): Promise<Buffer | null> {
  const full = tournamentPhotoPath(file);
  if (!full) return null;
  try {
    return await fs.readFile(full);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Grava o buffer (JA processado) com nome novo: `wx` (nunca sobrescreve) e 0600. */
export async function storeTournamentPhoto(data: Buffer): Promise<{ file: string; bytes: number }> {
  const file = `${randomUUID()}.webp`;
  const full = tournamentPhotoPath(file);
  if (!full) throw new Error('Nome de foto inválido.');
  await fs.mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
  await fs.writeFile(full, data, { flag: 'wx', mode: 0o600 });
  return { file, bytes: data.length };
}

/**
 * Apaga os arquivos (ignora vazios, nomes invalidos e inexistentes). Devolve quantos saiu. NUNCA lanca: falha de disco vira
 * log e o GC semanal pega (a acao principal ja foi confirmada no banco).
 */
export async function deleteTournamentPhotoFiles(
  files: Iterable<string | null | undefined>,
  logger?: Logger,
  baseDir: string = resolveTournamentPhotosDir(),
): Promise<number> {
  let deleted = 0;
  for (const file of new Set(files)) {
    if (!file) continue;
    const full = tournamentPhotoPath(file, baseDir);
    if (!full) continue;
    try {
      await fs.unlink(full);
      deleted += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger?.warn(`Não foi possível apagar a foto de atleta (o GC semanal tenta de novo): ${(error as Error).message}`);
      }
    }
  }
  return deleted;
}

// ---------------------------------------------------------------------------------------------------------------
// Pipeline (sharp)
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
 * SO PARA TESTES: `null` simula o sharp indisponivel (o pipeline responde UNAVAILABLE e nada e gravado); `undefined` volta a
 * carregar o modulo real.
 */
export function setTournamentPhotoSharpForTests(value: SharpModule | null | undefined): void {
  sharpCache = value;
}

let running = 0;
const waiting: Array<() => void> = [];

/**
 * Semaforo do processo: ate TOURNAMENT_PHOTO_CONCURRENCY imagens no sharp; fila cheia = 'busy'. `signal` abortado (cliente que
 * desistiu): sai da fila na hora (sem ocupar vaga) ou, ja com a vaga, devolve-a sem processar = 'aborted'.
 */
async function withSlot<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T | 'busy' | 'aborted'> {
  if (signal?.aborted) return 'aborted';
  if (running >= TOURNAMENT_PHOTO_CONCURRENCY) {
    if (waiting.length >= TOURNAMENT_PHOTO_QUEUE_MAX) return 'busy';
    const proceeded = await new Promise<boolean>((resolve) => {
      const onAbort = (): void => {
        const i = waiting.indexOf(entry);
        if (i >= 0) waiting.splice(i, 1);
        resolve(false);
      };
      const entry = (): void => {
        signal?.removeEventListener('abort', onAbort);
        resolve(true);
      };
      waiting.push(entry);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    if (!proceeded) return 'aborted';
  } else {
    running += 1;
  }
  try {
    if (signal?.aborted) return 'aborted';
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

export type TournamentPhotoResult =
  | { ok: true; data: Buffer; width: number; height: number }
  | { ok: false; reason: 'TYPE' | 'DECODE' | 'UNAVAILABLE' | 'BUSY' | 'ABORTED' };

/**
 * Valida (magic bytes) e REGRAVA a foto em WebP lado maior 800 SEM metadados (EXIF/GPS/ICC/XMP saem: o sharp so os copia com
 * withMetadata). So o 1o quadro de imagem animada. Nunca devolve o original.
 */
export async function processTournamentPhoto(buffer: Buffer, signal?: AbortSignal): Promise<TournamentPhotoResult> {
  if (!detectImageType(buffer)) return { ok: false, reason: 'TYPE' };
  const sharp = loadSharp();
  if (!sharp) return { ok: false, reason: 'UNAVAILABLE' };
  const result = await withSlot(async (): Promise<TournamentPhotoResult> => {
    try {
      const out = await sharp(buffer, { failOn: 'error', limitInputPixels: TOURNAMENT_PHOTO_MAX_INPUT_PIXELS, animated: false })
        .rotate()
        .resize({ width: TOURNAMENT_PHOTO_MAX_DIMENSION, height: TOURNAMENT_PHOTO_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: TOURNAMENT_PHOTO_QUALITY })
        .timeout({ seconds: TOURNAMENT_PHOTO_TIMEOUT_SECONDS })
        .toBuffer({ resolveWithObject: true });
      return { ok: true, data: out.data, width: out.info.width, height: out.info.height };
    } catch {
      return { ok: false, reason: 'DECODE' };
    }
  }, signal);
  if (result === 'busy') return { ok: false, reason: 'BUSY' };
  if (result === 'aborted') return { ok: false, reason: 'ABORTED' };
  return result;
}

/** Arquivos do diretorio com nome valido (para o GC). Diretorio inexistente = lista vazia. */
export async function listTournamentPhotoFiles(baseDir: string = resolveTournamentPhotosDir()): Promise<string[]> {
  try {
    return (await fs.readdir(baseDir)).filter((n) => TOURNAMENT_PHOTO_FILE_REGEX.test(n));
  } catch {
    return [];
  }
}
