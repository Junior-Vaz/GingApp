import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CommunicationsService } from '../interface/http/communications/communications.service';

/** A cada minuto (o relogio do servidor basta: o horario agendado e um instante absoluto). */
export const COMM_SCHEDULER_CRON_EXPRESSION = '* * * * *';
export const COMM_SCHEDULER_CRON_TIMEZONE = 'America/Sao_Paulo';
export const COMM_SCHEDULER_CRON_NAME = 'communications-scheduler-minutely';

/** COMM_SCHEDULER=false desliga o agendador (os testes e2e rodam assim: test/env-setup.ts). */
export function isCommSchedulerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.COMM_SCHEDULER !== 'false';
}

/**
 * Agendador do Comunicar (contrato secao 3): envia os comunicados `SCHEDULED` cujo `scheduledAt` ja venceu.
 * O corpo (`run`) e chamavel direto, com `now` injetavel. Idempotente: a transicao SCHEDULED -> SENT e atomica por
 * comunicado dentro de CommunicationsService.sendDueScheduled (duas instancias/execucoes nunca enviam duas vezes).
 */
@Injectable()
export class CommunicationsSchedulerService {
  private readonly logger = new Logger(CommunicationsSchedulerService.name);
  private running = false;

  constructor(private readonly communications: CommunicationsService) {}

  @Cron(COMM_SCHEDULER_CRON_EXPRESSION, { name: COMM_SCHEDULER_CRON_NAME, timeZone: COMM_SCHEDULER_CRON_TIMEZONE })
  async handleCron(): Promise<void> {
    await this.run();
  }

  /** `null` = desligado / ja em execucao / erro. `organizationId` limita a varredura (so para os testes). */
  async run(options: { now?: Date; organizationId?: number } = {}) {
    if (!isCommSchedulerEnabled() || this.running) return null;
    this.running = true;
    try {
      const result = await this.communications.sendDueScheduled(options.now ?? new Date(), { organizationId: options.organizationId });
      if (result.sent + result.cancelled + result.failed > 0) {
        this.logger.log(`Comunicados agendados: ${result.sent} enviado(s), ${result.cancelled} cancelado(s), ${result.failed} com falha.`);
      }
      return result;
    } catch (error) {
      this.logger.error('Falha no agendador de comunicados.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.running = false;
    }
  }
}
