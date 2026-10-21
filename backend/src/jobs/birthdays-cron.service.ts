import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BirthdayAutomationService } from '../interface/http/birthdays/birthday-automation.service';

export const BIRTHDAY_CRON_TIMEZONE = 'America/Sao_Paulo';
/** Resumo diario aos gestores: todo dia as 07:30 de Sao Paulo. */
export const BIRTHDAY_DIGEST_CRON_EXPRESSION = '30 7 * * *';
export const BIRTHDAY_DIGEST_CRON_NAME = 'birthday-digest-daily';
/** Varredura dos parabens automaticos: todo inicio de hora (minuto 5) de Sao Paulo; cada grupo tem a sua hora. */
export const BIRTHDAY_GREETING_CRON_EXPRESSION = '5 * * * *';
export const BIRTHDAY_GREETING_CRON_NAME = 'birthday-auto-greeting-hourly';

/** BIRTHDAY_CRON=false desliga os dois jobs (padrao: ligado). Lido a cada chamada; o AppModule tambem o usa. */
export function isBirthdayCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BIRTHDAY_CRON !== 'false';
}

/**
 * Jobs dos aniversariantes (contrato secao 2). A regra toda vive em BirthdayAutomationService (idempotente, `now`
 * injetavel); aqui so o agendamento, o flag e a protecao contra execucao simultanea. Falha vira log, nunca derruba o processo.
 */
@Injectable()
export class BirthdaysCronService {
  private readonly logger = new Logger(BirthdaysCronService.name);
  private digestRunning = false;
  private greetingRunning = false;

  constructor(private readonly automation: BirthdayAutomationService) {}

  @Cron(BIRTHDAY_DIGEST_CRON_EXPRESSION, { name: BIRTHDAY_DIGEST_CRON_NAME, timeZone: BIRTHDAY_CRON_TIMEZONE })
  async handleDigest(): Promise<void> {
    await this.runDigest();
  }

  @Cron(BIRTHDAY_GREETING_CRON_EXPRESSION, { name: BIRTHDAY_GREETING_CRON_NAME, timeZone: BIRTHDAY_CRON_TIMEZONE })
  async handleAutoGreeting(): Promise<void> {
    await this.runAutoGreeting();
  }

  async runDigest(now: Date = new Date()): Promise<{ organizations: number; notified: number } | null> {
    if (!isBirthdayCronEnabled()) return null;
    if (this.digestRunning) {
      this.logger.warn('Resumo de aniversariantes anterior ainda em andamento; ignorando esta execução.');
      return null;
    }
    this.digestRunning = true;
    try {
      const result = await this.automation.sendDailyDigests(now);
      this.logger.log(`Resumo de aniversariantes: ${result.notified} aviso(s) em ${result.organizations} grupo(s).`);
      return result;
    } catch (error) {
      this.logger.error('Falha no resumo diário de aniversariantes.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.digestRunning = false;
    }
  }

  async runAutoGreeting(now: Date = new Date()): Promise<{ organizations: number; greeted: number } | null> {
    if (!isBirthdayCronEnabled()) return null;
    if (this.greetingRunning) {
      this.logger.warn('Varredura de parabéns automáticos anterior ainda em andamento; ignorando esta execução.');
      return null;
    }
    this.greetingRunning = true;
    try {
      const result = await this.automation.sendAutoGreetings(now);
      if (result.greeted > 0) this.logger.log(`Parabéns automáticos: ${result.greeted} em ${result.organizations} grupo(s).`);
      return result;
    } catch (error) {
      this.logger.error('Falha nos parabéns automáticos.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.greetingRunning = false;
    }
  }
}
