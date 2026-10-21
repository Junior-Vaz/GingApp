import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, OnModuleInit, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { FeedPostStatus } from '@prisma/client';
import { promises as fs } from 'node:fs';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { FeedViewer } from './feed-access';
import { FeedErrorCode, tooMany } from './feed-errors';
import {
  assertFeedMediaDirSafe,
  deleteFeedFiles,
  FEED_MEDIA_MAX_BYTES,
  feedFilePath,
  MediaVariant,
  mediaExpiry,
  parseSignedParams,
  processFeedImage,
  signedMediaUrl,
  storeFeedImage,
  verifyMediaSignature,
} from './feed-media-storage';
import { FeedService } from './feed.service';
import { startOfDaySaoPaulo } from './feed-text';

export interface UploadedFeedFile {
  buffer: Buffer;
  size: number;
}

export interface FeedMediaUploadView {
  mediaId: number;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

/** Foto pendente (ainda sem post) vale 24 h; depois a limpeza agendada apaga linha e arquivos. */
export const FEED_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/** Tetos anti-abuso (env opcional, lidas a cada envio; padroes no codigo). */
function cap(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const fileTooLarge = () =>
  new PayloadTooLargeException({ statusCode: 413, error: 'Payload Too Large', code: FeedErrorCode.FILE_TOO_LARGE, message: 'A foto passa de 5 MB.' });
const typeNotAllowed = () =>
  new UnsupportedMediaTypeException({
    statusCode: 415,
    error: 'Unsupported Media Type',
    code: FeedErrorCode.FILE_TYPE_NOT_ALLOWED,
    message: 'Envie uma foto JPEG, PNG ou WEBP.',
  });

export interface ServableMedia {
  fullPath: string;
  /** `review` = foto ainda nao aprovada: cache curto no navegador. */
  review: boolean;
}

/**
 * Fotos do feed: envio (POST /feed/media, privado e pendente) e entrega por URL ASSINADA (GET /feed/media/:id).
 * A entrega nao usa Authorization (o <img> nao manda cabecalho): a assinatura HMAC presa ao grupo + midia + variante
 * + expiracao e a credencial; qualquer falha (id, assinatura, expiracao, post oculto/removido, pendente vencida) = o
 * MESMO 404.
 */
@Injectable()
export class FeedMediaService implements OnModuleInit {
  private readonly logger = new Logger(FeedMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feed: FeedService,
  ) {}

  onModuleInit(): void {
    assertFeedMediaDirSafe();
  }

  async upload(v: FeedViewer, file: UploadedFeedFile | undefined, now = new Date()): Promise<FeedMediaUploadView> {
    this.feed.assertCanPost(v, await this.feed.orgSettings(v.organizationId));
    if (!file || !file.buffer || file.size === 0) throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: FeedErrorCode.VALIDATION, message: 'Envie a foto no campo "file".' });
    if (file.size > FEED_MEDIA_MAX_BYTES || file.buffer.length > FEED_MEDIA_MAX_BYTES) throw fileTooLarge();

    const dayStart = startOfDaySaoPaulo(now);
    const [userToday, userPending, orgPending, orgToday] = await Promise.all([
      this.prisma.feedPostMedia.count({ where: { organizationId: v.organizationId, uploaderUserId: v.userId, createdAt: { gte: dayStart } } }),
      this.prisma.feedPostMedia.count({ where: { organizationId: v.organizationId, uploaderUserId: v.userId, postId: null } }),
      this.prisma.feedPostMedia.count({ where: { organizationId: v.organizationId, postId: null } }),
      this.prisma.feedPostMedia.count({ where: { organizationId: v.organizationId, createdAt: { gte: dayStart } } }),
    ]);
    const userDaily = v.isStaff ? cap('FEED_MEDIA_STAFF_PER_DAY', 60) : cap('FEED_MEDIA_USER_PER_DAY', 20);
    if (userToday >= userDaily) throw tooMany(FeedErrorCode.MEDIA_LIMIT, 'Você chegou ao limite de fotos de hoje.');
    if (userPending >= cap('FEED_MEDIA_USER_PENDING_MAX', 12)) throw tooMany(FeedErrorCode.MEDIA_LIMIT, 'Você tem fotos demais esperando um post. Publique ou aguarde.');
    if (orgPending >= cap('FEED_MEDIA_ORG_PENDING_MAX', 200) || orgToday >= cap('FEED_MEDIA_ORG_PER_DAY', 500)) {
      throw tooMany(FeedErrorCode.MEDIA_LIMIT, 'O grupo chegou ao limite de fotos por agora. Tente mais tarde.');
    }

    const processed = await processFeedImage(file.buffer);
    if (!processed.ok) {
      if (processed.reason === 'TYPE' || processed.reason === 'DECODE') throw typeNotAllowed();
      if (processed.reason === 'BUSY') throw tooMany(FeedErrorCode.TOO_MANY_REQUESTS, 'Muitas fotos sendo processadas agora. Tente de novo em instantes.');
      this.logger.error('sharp indisponível: fotos do feed recusadas (não é possível remover EXIF/GPS).');
      throw new HttpException(
        { statusCode: 503, error: 'Service Unavailable', code: FeedErrorCode.MEDIA_PROCESSING_UNAVAILABLE, message: 'Envio de fotos indisponível no momento.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const { image } = processed;
    const keys = await storeFeedImage(v.organizationId, image);
    let mediaId: number;
    try {
      mediaId = (
        await this.prisma.feedPostMedia.create({
          data: {
            organizationId: v.organizationId,
            uploaderUserId: v.userId,
            storageKey: keys.storageKey,
            thumbKey: keys.thumbKey,
            width: image.width,
            height: image.height,
            sizeBytes: image.main.length,
            mimeType: image.mimeType,
            pendingExpiresAt: new Date(now.getTime() + FEED_PENDING_TTL_MS),
          },
          select: { id: true },
        })
      ).id;
    } catch (error) {
      await deleteFeedFiles([keys.storageKey, keys.thumbKey]); // nunca deixa arquivo sem linha
      throw error;
    }
    // Pendente = ainda nao aprovada: URL `review` (30 min), so para a previa do compositor.
    const expiry = mediaExpiry(now.getTime(), undefined, 'review');
    return {
      mediaId,
      url: signedMediaUrl(v.organizationId, mediaId, 'full', expiry, undefined, 'review'),
      thumbUrl: signedMediaUrl(v.organizationId, mediaId, 'thumb', expiry, undefined, 'review'),
      width: image.width,
      height: image.height,
    };
  }

  /** Caminho do arquivo a servir, ou null (o controller responde 404 identico para qualquer falha). */
  async resolveSigned(rawId: string, variant: MediaVariant, e: unknown, s: unknown, r?: unknown, now = Date.now()): Promise<ServableMedia | null> {
    if (!/^\d{1,10}$/.test(rawId)) return null;
    const id = Number(rawId);
    if (id < 1 || id > 2_147_483_647) return null;
    const params = parseSignedParams(e, s, now, r);
    if (!params) return null;
    const media = await this.prisma.feedPostMedia.findUnique({
      where: { id },
      select: { organizationId: true, storageKey: true, thumbKey: true, postId: true, pendingExpiresAt: true, post: { select: { status: true, deletedAt: true } } },
    });
    if (!media || !verifyMediaSignature(media.organizationId, id, variant, params.expiresAtSec, params.signature, undefined, params.scope)) return null;
    // Foto ainda NAO aprovada (pendente sem post, post pendente ou oculto) so com URL `review` (curta, emitida ao
    // autor/moderador); post publicado aceita as duas; removido nunca.
    if (media.postId === null) {
      if (params.scope !== 'review' || !media.pendingExpiresAt || media.pendingExpiresAt.getTime() <= now) return null;
    } else if (!media.post || media.post.deletedAt || media.post.status === FeedPostStatus.REMOVED) {
      return null;
    } else if (media.post.status !== FeedPostStatus.PUBLISHED && params.scope !== 'review') {
      return null;
    }
    const fullPath = feedFilePath(variant === 'thumb' ? media.thumbKey : media.storageKey);
    if (!fullPath) return null;
    const stat = await fs.stat(fullPath).catch(() => null);
    return stat?.isFile() ? { fullPath, review: params.scope === 'review' } : null;
  }
}
