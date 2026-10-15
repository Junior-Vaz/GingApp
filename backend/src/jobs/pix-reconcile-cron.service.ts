import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PixService } from '../interface/http/payments/pix.service';
import { isPaymentsReconcileCronEnabled } from '../shared/payments/payments.config';

/** A cada 15 minutos, no fuso de Sao Paulo. */
export const PIX_RECONCILE_CRON_EXPRESSION = '*/15 * * * *';
export const PIX_RECONCILE_CRON_TIMEZONE = 'America/Sao_Paulo';
export const PIX_RECONCILE_CRON_NAME = 'payments-pix-reconcile';

/**
 * Reconciliacao dos Pix de mensalidade (PLANO_PROJETO.md 10.52): confere no provedor os Pix pendentes gerados ha mais de
 * 5 min (cobre webhook perdido/atrasado), libera os cancelados/vencidos e renova tokens perto de vencer. Lote limitado
 * (RECONCILE_BATCH_SIZE por execucao). A regra toda vive em PixService.reconcilePending: entre REPLICAS cada Pix e
 * reivindicado por compare-and-set em pixLastCheckedAt (nenhum Pix e conferido duas vezes na mesma rodada) e a renovacao
 * de token usa advisory lock por grupo; o `running` abaixo so evita sobreposicao no mesmo processo.
 * PAYMENTS_RECONCILE_CRON=false desliga.
 */
@Injectable()
export class PixReconcileCronService {
  private readonly logger = new Logger(PixReconcileCronService.name);
  private running = false;

  constructor(private readonly pix: PixService) {}

  @Cron(PIX_RECONCILE_CRON_EXPRESSION, { name: PIX_RECONCILE_CRON_NAME, timeZone: PIX_RECONCILE_CRON_TIMEZONE })
  async handleCron(): Promise<void> {
    await this.run();
  }

  async run() {
    if (!isPaymentsReconcileCronEnabled()) return null;
    if (this.running) {
      this.logger.warn('Reconciliação anterior ainda em andamento; ignorando esta.');
      return null;
    }
    this.running = true;
    try {
      const stats = await this.pix.reconcilePending();
      if (stats.checked > 0) {
        this.logger.log(
          `Pix: ${stats.checked} conferidos, ${stats.paid} baixados, ${stats.cancelled} cancelados, ${stats.expired} vencidos, ${stats.unavailable} sem conta utilizavel, ${stats.errors} erro(s).`,
        );
      }
      return stats;
    } catch (error) {
      this.logger.error('Falha na reconciliação dos Pix.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.running = false;
    }
  }
}
