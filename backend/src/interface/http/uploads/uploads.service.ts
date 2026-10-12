import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { detectImageType } from '../../../shared/uploads/image-signature';
import { UPLOAD_FILENAME_REGEX, UPLOAD_URL_PREFIX } from '../../../shared/uploads/image-ref';

/** Limite por arquivo (bytes recebidos). O multer corta antes de bufferizar tudo (413). */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
/** Lado maior depois do reprocessamento (sharp). */
export const UPLOAD_MAX_DIMENSION = 1600;

export interface UploadedImageFile {
  buffer: Buffer;
  size: number;
}

export interface UploadResult {
  url: string;
  filename: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
}

type SharpModule = typeof import('sharp');
let sharpCache: SharpModule | null | undefined;

/** Carrega o sharp sob demanda: se o binario nativo nao existir na plataforma, o upload segue SEM reprocessar. */
function loadSharp(logger: Logger): SharpModule | null {
  if (sharpCache !== undefined) return sharpCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sharpCache = require('sharp') as SharpModule;
  } catch (err) {
    sharpCache = null;
    logger.warn(`sharp indisponivel (${(err as Error).message}): imagens serao gravadas SEM redimensionar/limpar EXIF.`);
  }
  return sharpCache;
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Diretorio de armazenamento (UPLOADS_DIR; padrao ./uploads). Lido a cada chamada: os testes trocam a env. */
  uploadsDir(): string {
    return path.resolve(process.env.UPLOADS_DIR?.trim() || './uploads');
  }

  /** Cota por grupo em bytes (UPLOAD_ORG_QUOTA_MB; padrao 1024 MB; 0 = sem limite). */
  private quotaBytes(): number {
    const raw = process.env.UPLOAD_ORG_QUOTA_MB;
    const mb = raw === undefined || raw.trim() === '' ? 1024 : Number(raw);
    return Number.isFinite(mb) && mb > 0 ? Math.floor(mb * 1024 * 1024) : 0;
  }

  async save(file: UploadedImageFile | undefined, organizationId: number, userId: number): Promise<UploadResult> {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException('Envie a imagem no campo "file" (multipart/form-data).');
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      throw new PayloadTooLargeException('A imagem excede o limite de 5 MB.');
    }
    // O tipo vem da ASSINATURA do arquivo, nunca do mimetype/extensao informados pelo cliente.
    const detected = detectImageType(file.buffer);
    if (!detected) {
      throw new UnsupportedMediaTypeException('Formato nao suportado: envie uma imagem JPEG, PNG ou WebP.');
    }

    let data = file.buffer;
    let contentType: string = detected.mime;
    let ext: string = detected.ext;
    let width: number | undefined;
    let height: number | undefined;

    const sharp = loadSharp(this.logger);
    if (sharp) {
      try {
        // rotate(): aplica a orientacao EXIF antes de o metadado ser descartado. webp() sem withMetadata()
        // remove EXIF/GPS/ICC. limitInputPixels barra "bombas de pixels".
        const out = await sharp(file.buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
          .rotate()
          .resize({ width: UPLOAD_MAX_DIMENSION, height: UPLOAD_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer({ resolveWithObject: true });
        data = out.data;
        width = out.info.width;
        height = out.info.height;
        contentType = 'image/webp';
        ext = 'webp';
      } catch {
        throw new BadRequestException('Imagem invalida ou corrompida.');
      }
    }

    const quota = this.quotaBytes();
    if (quota > 0) {
      const used = await this.prisma.upload.aggregate({ where: { organizationId }, _sum: { sizeBytes: true } });
      if ((used._sum.sizeBytes ?? 0) + data.length > quota) {
        throw new PayloadTooLargeException('O limite de armazenamento de imagens do grupo foi atingido.');
      }
    }

    const filename = `${randomUUID()}.${ext}`;
    const dir = this.uploadsDir();
    await fs.mkdir(dir, { recursive: true });
    const fullPath = path.join(dir, filename);
    await fs.writeFile(fullPath, data, { flag: 'wx' });
    try {
      await this.prisma.upload.create({
        data: { organizationId, userId, filename, mimeType: contentType, sizeBytes: data.length },
      });
    } catch (err) {
      await fs.unlink(fullPath).catch(() => undefined); // nao deixa arquivo orfao se o registro falhar
      throw err;
    }
    return { url: `${UPLOAD_URL_PREFIX}${filename}`, filename, contentType, size: data.length, width, height };
  }

  /**
   * Caminho absoluto do arquivo, ou null. O nome precisa casar EXATAMENTE com o formato gerado
   * (uuid + extensao): "../", barras, pontos extras e codificacoes nao passam => path traversal impossivel.
   */
  async resolveFile(filename: string): Promise<{ fullPath: string; contentType: string } | null> {
    if (!UPLOAD_FILENAME_REGEX.test(filename)) return null;
    const fullPath = path.join(this.uploadsDir(), filename);
    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) return null;
    } catch {
      return null;
    }
    const ext = path.extname(filename).slice(1);
    const contentType = ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp';
    return { fullPath, contentType };
  }
}
