import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron } from '@nestjs/schedule';
import { promises as fs } from 'node:fs';
import { PrismaService } from '../shared/prisma/prisma.service';
import {
  deleteTournamentPhotoFiles,
  listTournamentPhotoFiles,
  resolveTournamentPhotosDir,
  TOURNAMENT_PHOTO_GC_MIN_AGE_MS,
  tournamentPhotoPath,
} from '../interface/http/tournaments/tournament-photo-storage';
import { PUBLIC_VIEW_DAYS_AFTER_EVENT } from '../interface/http/tournaments/tournament-rules';
import { TournamentsService } from '../interface/http/tournaments/tournaments.service';

/**
 * Fotos PROPRIAS dos atletas de fora do chaveamento (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md 1): dois jobs, ambos com `dry-run`
 * como PADRAO (so contam e registram no log) e so apagam com `true`; `false` desliga.
 *  - GC semanal (domingo 05:30, `TOURNAMENT_PHOTOS_GC`): arquivo do diretorio que NENHUM atleta referencia (`photoFile`) e tem
 *    mais de 24 h (quem acabou de enviar ainda nao confirmou no banco). Cobre restos de falha de disco, de exclusao de evento
 *    e de substituicao concorrente;
 *  - expiracao diaria (04:55, `TOURNAMENT_PHOTOS_PURGE`): torneios cujo evento passou ha mais de 30 dias (mesma janela do
 *    telao publico): apaga as fotos proprias e zera `photoFile/photoBytes/photoUpdatedAt`.
 *  - reconciliacao diaria (junto da expiracao, `TOURNAMENT_ANON_RECONCILE`, padrao `true`; `false` desliga; NAO depende de
 *    dry-run porque so completa uma anonimizacao JA devida): atletas cujo aluno/inscricao/participante/usuario foi anonimizado e
 *    que ainda tem nome/grupo/foto (a ponte da anonimizacao so loga quando falha) sao anonimizados (idempotente).
 * So contagens no log (nunca nome de arquivo nem de atleta).
 */

export type TournamentPhotosMode = 'on' | 'off' | 'dry-run';

function modeOf(value: string | undefined): TournamentPhotosMode {
  const v = value?.trim().toLowerCase();
  if (v === 'true' || v === 'on' || v === '1') return 'on';
  if (v === 'false' || v === 'off' || v === '0') return 'off';
  return 'dry-run';
}

export function tournamentPhotosGcMode(env: NodeJS.ProcessEnv = process.env): TournamentPhotosMode {
  return modeOf(env.TOURNAMENT_PHOTOS_GC);
}
export function tournamentPhotosPurgeMode(env: NodeJS.ProcessEnv = process.env): TournamentPhotosMode {
  return modeOf(env.TOURNAMENT_PHOTOS_PURGE);
}

/** `TOURNAMENT_ANON_RECONCILE`: padrao LIGADO; so `false`/`off`/`0` desliga. */
export function tournamentAnonReconcileEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.TOURNAMENT_ANON_RECONCILE?.trim().toLowerCase();
  return !(v === 'false' || v === 'off' || v === '0');
}

/** Avisos do BOOT: em `dry-run` as fotos (de menores inclusive) NAO expiram nem saem do disco; o dono decide ligar em producao. */
export function tournamentPhotosBootWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  if (tournamentPhotosPurgeMode(env) === 'dry-run') {
    out.push('TOURNAMENT_PHOTOS_PURGE=dry-run: as fotos dos atletas (inclusive de menores) NÃO expiram 30 dias após o evento. Defina TOURNAMENT_PHOTOS_PURGE=true para ligar a expiração.');
  }
  if (tournamentPhotosGcMode(env) === 'dry-run') {
    out.push('TOURNAMENT_PHOTOS_GC=dry-run: arquivos de fotos órfãos NÃO são apagados do disco. Defina TOURNAMENT_PHOTOS_GC=true para ligar a limpeza.');
  }
  return out;
}

export const TOURNAMENT_PHOTOS_GC_CRON_EXPRESSION = '30 5 * * 0';
export const TOURNAMENT_PHOTOS_GC_CRON_NAME = 'tournament-photos-gc-weekly';
export const TOURNAMENT_PHOTOS_PURGE_CRON_EXPRESSION = '55 4 * * *';
export const TOURNAMENT_PHOTOS_PURGE_CRON_NAME = 'tournament-photos-purge-daily';
export const TOURNAMENT_PHOTOS_CRON_TIMEZONE = 'America/Sao_Paulo';

const DAY_MS = 86_400_000;

export interface TournamentPhotosGcResult {
  dryRun: boolean;
  /** Arquivos no disco sem atleta e com mais de 24 h. */
  orphanFiles: number;
  orphanFilesDeleted: number;
  bytes: number;
}

export interface TournamentPhotosPurgeResult {
  dryRun: boolean;
  tournaments: number;
  competitors: number;
  filesDeleted: number;
}

export interface TournamentAnonReconcileResult {
  competitors: number;
  photosDeleted: number;
  tournaments: number;
}

@Injectable()
export class TournamentPhotosCronService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TournamentPhotosCronService.name);
  private gcRunning = false;
  private purgeRunning = false;
  private reconcileRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    /** O `TournamentsService` e resolvido sob demanda (sem dependencia circular entre modulos). */
    private readonly moduleRef: ModuleRef,
  ) {}

  onApplicationBootstrap(): void {
    for (const warning of tournamentPhotosBootWarnings()) this.logger.warn(warning);
  }

  @Cron(TOURNAMENT_PHOTOS_GC_CRON_EXPRESSION, { name: TOURNAMENT_PHOTOS_GC_CRON_NAME, timeZone: TOURNAMENT_PHOTOS_CRON_TIMEZONE })
  async handleGcCron(): Promise<void> {
    await this.runGc();
  }

  @Cron(TOURNAMENT_PHOTOS_PURGE_CRON_EXPRESSION, { name: TOURNAMENT_PHOTOS_PURGE_CRON_NAME, timeZone: TOURNAMENT_PHOTOS_CRON_TIMEZONE })
  async handlePurgeCron(): Promise<void> {
    await this.runPurge();
    await this.runReconcile();
  }

  /** Reconciliacao das anonimizacoes pendentes (chamavel direto). Null se desligada/ocupada/falhou. */
  async runReconcile(): Promise<TournamentAnonReconcileResult | null> {
    if (!tournamentAnonReconcileEnabled() || this.reconcileRunning) return null;
    this.reconcileRunning = true;
    try {
      const tournaments = this.moduleRef.get(TournamentsService, { strict: false }) as TournamentsService | undefined;
      if (!tournaments) return null;
      const result = await tournaments.reconcileAnonymizedCompetitors();
      if (result.competitors > 0) {
        this.logger.warn(`Reconciliação LGPD do chaveamento: ${result.competitors} atleta(s) anonimizado(s) em ${result.tournaments} torneio(s), ${result.photosDeleted} foto(s) apagada(s).`);
      }
      return result;
    } catch (error) {
      this.logger.error('Falha na reconciliação das anonimizações do chaveamento.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.reconcileRunning = false;
    }
  }

  /** GC de orfaos (chamavel direto). `dir`/`now` so para os testes. Devolve null se desligado/ocupado/falhou. */
  async runGc(options: { dir?: string; now?: Date } = {}): Promise<TournamentPhotosGcResult | null> {
    const mode = tournamentPhotosGcMode();
    if (mode === 'off' || this.gcRunning) return null;
    this.gcRunning = true;
    try {
      const dryRun = mode === 'dry-run';
      const dir = options.dir ?? resolveTournamentPhotosDir();
      const now = (options.now ?? new Date()).getTime();
      const result: TournamentPhotosGcResult = { dryRun, orphanFiles: 0, orphanFilesDeleted: 0, bytes: 0 };
      const names = await listTournamentPhotoFiles(dir);
      for (let i = 0; i < names.length; i += 500) {
        const batch = names.slice(i, i + 500);
        const referenced = new Set(
          (await this.prisma.tournamentCompetitor.findMany({ where: { photoFile: { in: batch } }, select: { photoFile: true } })).map((r) => r.photoFile),
        );
        const orphans: string[] = [];
        for (const name of batch) {
          if (referenced.has(name)) continue;
          const full = tournamentPhotoPath(name, dir);
          if (!full) continue;
          const stat = await fs.stat(full).catch(() => null);
          if (!stat || !stat.isFile() || now - stat.mtimeMs < TOURNAMENT_PHOTO_GC_MIN_AGE_MS) continue;
          // Reconfere o banco no ultimo instante: um envio que acabou de ligar este nome vence a varredura.
          if (await this.prisma.tournamentCompetitor.findFirst({ where: { photoFile: name }, select: { id: true } })) continue;
          result.orphanFiles += 1;
          result.bytes += stat.size;
          orphans.push(name);
        }
        if (!dryRun && orphans.length > 0) {
          result.orphanFilesDeleted += await deleteTournamentPhotoFiles(orphans, this.logger, dir);
        }
      }
      this.logger.log(
        `Fotos de atletas órfãs${dryRun ? ' (dry-run, nada apagado)' : ''}: ${result.orphanFiles} arquivo(s), ${result.bytes} bytes` +
          `${dryRun ? '' : `, ${result.orphanFilesDeleted} apagado(s)`}.`,
      );
      return result;
    } catch (error) {
      this.logger.error('Falha na limpeza das fotos órfãs dos atletas.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.gcRunning = false;
    }
  }

  /**
   * Expiracao (chamavel direto): torneios cujo evento passou ha mais de PUBLIC_VIEW_DAYS_AFTER_EVENT dias perdem as fotos
   * proprias (arquivo DEPOIS do commit; colunas zeradas; `revision` sobe). `organizationId` so para os testes (banco de dev
   * compartilhado).
   */
  async runPurge(options: { now?: Date; organizationId?: number } = {}): Promise<TournamentPhotosPurgeResult | null> {
    const mode = tournamentPhotosPurgeMode();
    if (mode === 'off' || this.purgeRunning) return null;
    this.purgeRunning = true;
    try {
      const dryRun = mode === 'dry-run';
      const cutoff = new Date((options.now ?? new Date()).getTime() - PUBLIC_VIEW_DAYS_AFTER_EVENT * DAY_MS);
      const result: TournamentPhotosPurgeResult = { dryRun, tournaments: 0, competitors: 0, filesDeleted: 0 };
      const tournaments = await this.prisma.tournament.findMany({
        where: {
          ...(options.organizationId !== undefined ? { organizationId: options.organizationId } : {}),
          event: { date: { lt: cutoff } },
          categories: { some: { competitors: { some: { photoFile: { not: null } } } } },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      for (const t of tournaments) {
        if (dryRun) {
          const count = await this.prisma.tournamentCompetitor.count({ where: { photoFile: { not: null }, category: { tournamentId: t.id } } });
          if (count > 0) {
            result.tournaments += 1;
            result.competitors += count;
          }
          continue;
        }
        const purged = await this.prisma.$transaction(
          async (tx) => {
            const rows = await tx.tournamentCompetitor.findMany({
              where: { photoFile: { not: null }, category: { tournamentId: t.id } },
              select: { id: true, photoFile: true },
            });
            if (rows.length === 0) return null;
            await tx.tournamentCompetitor.updateMany({
              where: { id: { in: rows.map((r) => r.id) } },
              data: { photoFile: null, photoBytes: null, photoUpdatedAt: null },
            });
            await tx.tournament.update({ where: { id: t.id }, data: { revision: { increment: 1 } } });
            return rows.map((r) => r.photoFile);
          },
          { maxWait: 10_000, timeout: 30_000 },
        );
        if (!purged) continue;
        result.tournaments += 1;
        result.competitors += purged.length;
        result.filesDeleted += await deleteTournamentPhotoFiles(purged, this.logger);
      }
      this.logger.log(
        `Expiração das fotos de atletas${dryRun ? ' (dry-run, nada apagado)' : ''}: ${result.tournaments} torneio(s), ` +
          `${result.competitors} foto(s)${dryRun ? '' : `, ${result.filesDeleted} arquivo(s) apagado(s)`}.`,
      );
      return result;
    } catch (error) {
      this.logger.error('Falha na expiração das fotos de atletas.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.purgeRunning = false;
    }
  }
}
