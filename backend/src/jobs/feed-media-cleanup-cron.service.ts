import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../shared/prisma/prisma.service';
import { deleteFeedFiles, resolveFeedMediaDir } from '../interface/http/feed/feed-media-storage';
import { purgeRemovedPostsMedia } from '../interface/http/feed/feed-purge';
import { STORAGE_KEY_REGEX } from '../interface/http/registration-forms/private-storage';

/** FEED_MEDIA_CLEANUP=false desliga a limpeza das fotos do feed (padrao: ligada). */
export function isFeedMediaCleanupEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FEED_MEDIA_CLEANUP?.trim().toLowerCase() !== 'false';
}

export const FEED_MEDIA_CLEANUP_CRON_EXPRESSION = '*/15 * * * *';
export const FEED_MEDIA_CLEANUP_CRON_NAME = 'feed-media-cleanup-15min';
/** Varredura disco x banco: todo dia 05:30 (SP). Arquivo sem linha so sai depois de 24 h (upload em andamento fica). */
export const FEED_MEDIA_SWEEP_CRON_EXPRESSION = '30 5 * * *';
export const FEED_MEDIA_SWEEP_CRON_NAME = 'feed-media-sweep-daily';
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;
const MAX_BATCHES = 20;

export interface FeedMediaCleanupResult {
  pendingDeleted: number;
  removedPostsMedia: number;
}

/**
 * A cada 15 min: (1) fotos PENDENTES vencidas (enviadas e nunca usadas num post em 24 h) saem do banco e do disco;
 * (2) rede de seguranca: fotos que ainda restarem de posts REMOVED (o fluxo de remocao ja apaga na hora). A linha sai
 * primeiro e de forma condicional (um post criado no mesmo instante que ligou a foto vence), o arquivo depois.
 */
@Injectable()
export class FeedMediaCleanupCronService {
  private readonly logger = new Logger(FeedMediaCleanupCronService.name);
  private running = false;
  private sweeping = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(FEED_MEDIA_CLEANUP_CRON_EXPRESSION, { name: FEED_MEDIA_CLEANUP_CRON_NAME, timeZone: 'America/Sao_Paulo' })
  async handleCron(): Promise<void> {
    await this.run();
  }

  @Cron(FEED_MEDIA_SWEEP_CRON_EXPRESSION, { name: FEED_MEDIA_SWEEP_CRON_NAME, timeZone: 'America/Sao_Paulo' })
  async handleSweep(): Promise<void> {
    await this.sweepOrphans();
  }

  /**
   * Varredura disco x banco (diaria): arquivo do feed (`org-<n>/<uuid>.webp`) SEM linha (foto nem miniatura) e com mais de
   * 24 h e apagado - cobre o unlink que falhou depois do commit (remocao, LGPD). Nome fora do formato nunca e tocado.
   */
  async sweepOrphans(options: { now?: Date; baseDir?: string } = {}): Promise<number | null> {
    if (!isFeedMediaCleanupEnabled() || this.sweeping) return null;
    this.sweeping = true;
    try {
      const now = options.now ?? new Date();
      const base = options.baseDir ?? resolveFeedMediaDir();
      let deleted = 0;
      const orgDirs = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
      for (const dir of orgDirs) {
        if (!dir.isDirectory() || !/^org-\d{1,10}$/.test(dir.name)) continue;
        const names = (await fs.readdir(path.join(base, dir.name)).catch(() => [] as string[])).filter((n) => STORAGE_KEY_REGEX.test(`${dir.name}/${n}`));
        for (let i = 0; i < names.length; i += 500) {
          const keys = names.slice(i, i + 500).map((n) => `${dir.name}/${n}`);
          const rows = await this.prisma.feedPostMedia.findMany({
            where: { OR: [{ storageKey: { in: keys } }, { thumbKey: { in: keys } }] },
            select: { storageKey: true, thumbKey: true },
          });
          const known = new Set(rows.flatMap((r) => [r.storageKey, r.thumbKey]));
          for (const key of keys) {
            if (known.has(key)) continue;
            const full = path.join(base, ...key.split('/'));
            const stat = await fs.stat(full).catch(() => null);
            if (!stat || now.getTime() - stat.mtimeMs < ORPHAN_MIN_AGE_MS) continue;
            if (await fs.unlink(full).then(() => true, () => false)) deleted += 1;
          }
        }
      }
      if (deleted > 0) this.logger.log(`Fotos do feed sem registro apagadas do disco: ${deleted}.`);
      return deleted;
    } catch (error) {
      this.logger.error('Falha na varredura das fotos do feed.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.sweeping = false;
    }
  }

  /** Corpo do job (chamavel direto). `organizationId` limita (so para os testes). null = desligado/ocupado/falhou. */
  async run(options: { now?: Date; organizationId?: number } = {}): Promise<FeedMediaCleanupResult | null> {
    if (!isFeedMediaCleanupEnabled() || this.running) return null;
    this.running = true;
    try {
      const now = options.now ?? new Date();
      const orgFilter = options.organizationId !== undefined ? { organizationId: options.organizationId } : {};
      let pendingDeleted = 0;
      for (let round = 0; round < MAX_BATCHES; round++) {
        const stale = await this.prisma.feedPostMedia.findMany({
          where: { ...orgFilter, postId: null, OR: [{ pendingExpiresAt: { lte: now } }, { pendingExpiresAt: null }] },
          select: { id: true, storageKey: true, thumbKey: true },
          orderBy: { id: 'asc' },
          take: BATCH,
        });
        for (const m of stale) {
          const removed = await this.prisma.feedPostMedia.deleteMany({ where: { id: m.id, postId: null } });
          if (removed.count === 0) continue;
          await deleteFeedFiles([m.storageKey, m.thumbKey]);
          pendingDeleted += 1;
        }
        if (stale.length < BATCH) break;
      }
      const removedPostsMedia = await purgeRemovedPostsMedia(this.prisma, options.organizationId);
      if (pendingDeleted + removedPostsMedia > 0) {
        this.logger.log(`Fotos do feed limpas: ${pendingDeleted} pendente(s) vencida(s), ${removedPostsMedia} de post(s) removido(s).`);
      }
      return { pendingDeleted, removedPostsMedia };
    } catch (error) {
      this.logger.error('Falha na limpeza das fotos do feed.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.running = false;
    }
  }
}
