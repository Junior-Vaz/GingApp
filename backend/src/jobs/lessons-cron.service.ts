import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  ClassLessonsRollingService,
  EnsureHorizonResult,
} from '../interface/http/classes/class-lessons-rolling.service';

/** Todo dia as 01:30, fuso de Sao Paulo: mantem as aulas continuas geradas ate o horizonte (LESSONS_HORIZON_DAYS). */
export const LESSONS_CRON_EXPRESSION = '30 1 * * *';
export const LESSONS_CRON_TIMEZONE = 'America/Sao_Paulo';
export const LESSONS_CRON_NAME = 'lessons-rolling-daily';

/** LESSONS_CRON=false desliga o job (os testes e2e rodam assim: test/env-setup.ts). Lido a cada chamada. */
export function isLessonsCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LESSONS_CRON !== 'false';
}

/**
 * Job diario das aulas continuas: ClassLessonsRollingService.ensureHorizon() SEM filtro = todas as turmas ativas, com
 * dia da semana e autoGenerateLessons=true, de todas as organizacoes ativas. Idempotente (rodar duas vezes nao
 * duplica; aula cancelada nao e recriada) e silencioso (aula gerada nao notifica). O corpo (`run`) e chamavel direto,
 * sem esperar o relogio. Falha e logada e nao derruba o processo; a proxima execucao tenta de novo.
 */
@Injectable()
export class LessonsCronService {
  private readonly logger = new Logger(LessonsCronService.name);
  private running = false;

  constructor(private readonly rolling: ClassLessonsRollingService) {}

  @Cron(LESSONS_CRON_EXPRESSION, { name: LESSONS_CRON_NAME, timeZone: LESSONS_CRON_TIMEZONE })
  async handleCron(): Promise<void> {
    await this.run();
  }

  /** `null` = desligado / ja em execucao / erro. */
  async run(now: Date = new Date()): Promise<EnsureHorizonResult | null> {
    if (!isLessonsCronEnabled() || this.running) return null;
    this.running = true;
    try {
      const result = await this.rolling.ensureHorizon({}, now);
      this.logger.log(
        `Aulas continuas: ${result.classes} turma(s), ${result.created} aula(s) criada(s), ${result.failed} falha(s) (${result.from}..${result.to}).`,
      );
      return result;
    } catch (error) {
      this.logger.error('Falha na geracao diaria das aulas continuas.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.running = false;
    }
  }
}
