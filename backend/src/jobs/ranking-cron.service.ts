import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RankingService } from '../interface/http/ranking/ranking.service';

/** Todo dia as 02:30, fuso de Sao Paulo: recalcula os pontos de todos os alunos (cobre roda que aconteceu, mes que fechou...). */
export const RANKING_SYNC_CRON_EXPRESSION = '30 2 * * *';
/** Dia 1 de cada mes as 03:00 (depois do recalculo das 02:30): fecha a temporada do mes anterior. */
export const RANKING_CLOSE_CRON_EXPRESSION = '0 3 1 * *';
export const RANKING_CRON_TIMEZONE = 'America/Sao_Paulo';
export const RANKING_SYNC_CRON_NAME = 'ranking-sync-daily';
export const RANKING_CLOSE_CRON_NAME = 'ranking-close-season-monthly';

/** RANKING_CRON=false desliga os dois jobs (os testes e2e rodam assim: test/env-setup.ts). */
export function isRankingCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RANKING_CRON !== 'false';
}

/** Jobs do Ginga Rank. Os corpos (`runSync`/`runClose`) sao chamaveis direto, sem esperar o relogio. */
@Injectable()
export class RankingCronService {
  private readonly logger = new Logger(RankingCronService.name);
  private syncing = false;
  private closing = false;

  constructor(private readonly ranking: RankingService) {}

  @Cron(RANKING_SYNC_CRON_EXPRESSION, { name: RANKING_SYNC_CRON_NAME, timeZone: RANKING_CRON_TIMEZONE })
  async handleSync(): Promise<void> {
    await this.runSync();
  }

  @Cron(RANKING_CLOSE_CRON_EXPRESSION, { name: RANKING_CLOSE_CRON_NAME, timeZone: RANKING_CRON_TIMEZONE })
  async handleClose(): Promise<void> {
    await this.runClose();
  }

  /** `null` = desligado / ja em execucao / erro. */
  async runSync() {
    if (!isRankingCronEnabled() || this.syncing) return null;
    this.syncing = true;
    try {
      return await this.ranking.syncAll({ notify: true });
    } catch (error) {
      this.logger.error('Falha no recálculo noturno do ranking.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.syncing = false;
    }
  }

  /** Fecha a temporada do mes anterior (notificando os campeoes) e qualquer outra encerrada que ficou sem resultado (sem avisos). */
  async runClose(now: Date = new Date()) {
    if (!isRankingCronEnabled() || this.closing) return null;
    this.closing = true;
    try {
      const closed = await this.ranking.closeSeason(this.ranking.previousSeason(now), { notify: true });
      const others = await this.ranking.closePendingSeasons({ notify: false });
      this.logger.log(`Temporada ${closed.season} fechada: ${closed.written} escopo(s) gravado(s), ${closed.championsNotified} campeão(ões) avisado(s).`);
      return { closed, others };
    } catch (error) {
      this.logger.error('Falha no fechamento mensal do ranking.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.closing = false;
    }
  }
}
