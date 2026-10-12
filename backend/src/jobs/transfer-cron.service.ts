import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TransfersService } from '../interface/http/people/transfers.service';

/** Todo dia as 04:15, fuso de Sao Paulo: expira pedidos de transferencia sem decisao e fecha as janelas de contestacao. */
export const TRANSFER_CRON_EXPRESSION = '15 4 * * *';
export const TRANSFER_CRON_TIMEZONE = 'America/Sao_Paulo';
export const TRANSFER_CRON_NAME = 'transfers-daily';

/** TRANSFER_CRON=false desliga o job (os testes e2e rodam assim: test/env-setup.ts). Lido a cada chamada. */
export function isTransferCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TRANSFER_CRON !== 'false';
}

/** Job diario das transferencias (ficha unica, Fase 2). Idempotente; `run` e chamavel direto pelos specs. */
@Injectable()
export class TransferCronService {
  private readonly logger = new Logger(TransferCronService.name);
  private running = false;

  constructor(private readonly transfers: TransfersService) {}

  @Cron(TRANSFER_CRON_EXPRESSION, { name: TRANSFER_CRON_NAME, timeZone: TRANSFER_CRON_TIMEZONE })
  async handleCron(): Promise<void> {
    await this.run();
  }

  /** `null` = desligado / ja em execucao / erro. */
  async run(now: Date = new Date()): Promise<{ expired: number; completed: number } | null> {
    if (!isTransferCronEnabled() || this.running) return null;
    this.running = true;
    try {
      const result = await this.transfers.runMaintenance(now);
      this.logger.log(`Transferencias: ${result.expired} pedido(s) expirado(s), ${result.completed} concluido(s).`);
      return result;
    } catch (error) {
      this.logger.error('Falha no job diario de transferencias.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.running = false;
    }
  }
}
