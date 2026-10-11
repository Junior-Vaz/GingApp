import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FinanceOverdueService } from '../interface/http/finance/finance-overdue.service';

/** Todo dia as 03:00, no fuso de Sao Paulo (cron: minuto hora dia mes dia-da-semana). */
export const OVERDUE_CRON_EXPRESSION = '0 3 * * *';
export const OVERDUE_CRON_TIMEZONE = 'America/Sao_Paulo';
/** Nome do job no SchedulerRegistry (usado pelo teste e por quem quiser parar/rodar o job). */
export const OVERDUE_CRON_NAME = 'finance-overdue-daily';

/** Teto de lotes por execucao (cada lote = ate OVERDUE_BATCH_SIZE lancamentos) - evita laco infinito. */
export const OVERDUE_MAX_BATCHES = 100;

/**
 * OVERDUE_CRON=false desliga o job diario (padrao: ligado). Lido a cada chamada. O AppModule tambem usa isto
 * para nem registrar o agendador (testes e2e rodam com OVERDUE_CRON=false: ver test/env-setup.ts).
 */
export function isOverdueCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OVERDUE_CRON !== 'false';
}

/**
 * Job diario da mensalidade vencida (E07/E09): chama FinanceOverdueService.markOverdueAndNotify() SEM
 * organizationId, isto e, para TODAS as organizacoes - marca PENDING vencido como OVERDUE e notifica o aluno e
 * os responsaveis. A regra de negocio continua toda em FinanceOverdueService (idempotente: rodar duas vezes
 * no mesmo dia nao notifica de novo).
 *
 * Instancia unica: com mais de uma replica do backend o job rodaria em cada uma; e seguro (idempotente), so
 * redundante. Falha de uma execucao e logada e nao derruba o processo; a proxima execucao tenta de novo.
 */
@Injectable()
export class OverdueCronService {
  private readonly logger = new Logger(OverdueCronService.name);
  private running = false;

  constructor(private readonly overdue: FinanceOverdueService) {}

  @Cron(OVERDUE_CRON_EXPRESSION, { name: OVERDUE_CRON_NAME, timeZone: OVERDUE_CRON_TIMEZONE })
  async handleCron(): Promise<void> {
    await this.run();
  }

  /** Corpo do job (separado do @Cron para ser chamado direto, sem esperar o relogio). */
  async run(): Promise<{ marked: number; notified: number; batches: number } | null> {
    if (!isOverdueCronEnabled()) return null;
    if (this.running) {
      this.logger.warn('Execução anterior ainda em andamento; ignorando esta.');
      return null;
    }
    this.running = true;
    try {
      let marked = 0;
      let notified = 0;
      let batches = 0;
      let hasMore = true;
      while (hasMore && batches < OVERDUE_MAX_BATCHES) {
        const result = await this.overdue.markOverdueAndNotify();
        marked += result.marked;
        notified += result.notified;
        hasMore = result.hasMore;
        batches += 1;
      }
      this.logger.log(`Mensalidades vencidas: ${marked} marcadas, ${notified} notificações (${batches} lote(s)).`);
      return { marked, notified, batches };
    } catch (error) {
      this.logger.error(
        'Falha ao marcar mensalidades vencidas.',
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    } finally {
      this.running = false;
    }
  }
}
