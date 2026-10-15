import { Injectable, Logger } from '@nestjs/common';
import { FinancialRecord } from '@prisma/client';

/** Por que o Pix aberto de um lancamento deixou de valer (vai para o log). */
export type PixInvalidationReason = 'MANUAL_PAY' | 'CANCEL' | 'AMOUNT_CHANGED';

type Canceller = (record: FinancialRecord, reason: PixInvalidationReason) => Promise<void>;

/**
 * Ponte (sem dependencia circular de modulos) entre o financeiro e o Pix (PLANO_PROJETO.md 10.53, achado M3): o
 * FinanceModule nao importa o PaymentsModule (e o contrario que acontece), entao o PixService REGISTRA aqui o seu
 * "cancelar o Pix aberto no provedor" e o FinanceService/FinanceCollectionService chamam `cancelOpenPix` depois de uma
 * baixa manual, cancelamento ou mudanca de valor. BEST-EFFORT: fora de transacao, nunca lanca, nunca derruba a operacao
 * do financeiro (o erro so vai para o log, sem segredo). Sem PixService registrado (ex.: modulo de pagamentos fora) = no-op.
 */
@Injectable()
export class PixLifecycleHooks {
  private readonly logger = new Logger(PixLifecycleHooks.name);
  private canceller: Canceller | null = null;

  registerCanceller(fn: Canceller): void {
    this.canceller = fn;
  }

  /** Lancamento com Pix gerado? (barato: decide antes de chamar o provedor). */
  static hasPix(record: Pick<FinancialRecord, 'gatewayPaymentId' | 'pixGeneratedAt'>): boolean {
    return !!record.gatewayPaymentId && !!record.pixGeneratedAt;
  }

  async cancelOpenPix(record: FinancialRecord, reason: PixInvalidationReason): Promise<void> {
    if (!this.canceller || !PixLifecycleHooks.hasPix(record)) return;
    try {
      await this.canceller(record, reason);
    } catch (error) {
      this.logger.warn(`Cancelamento do Pix aberto falhou (lancamento ${record.id}, ${reason}): ${(error as Error).message}`);
    }
  }
}
