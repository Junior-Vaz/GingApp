import { Injectable, Logger } from '@nestjs/common';
import { Prisma, RecordStatus } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { civilTodayStart } from '../finance/finance.service';
import { DAY_MS, generateLessonsInRange } from './class-lessons-generator';

/** Horizonte padrão (dias a partir de hoje) das aulas contínuas; LESSONS_HORIZON_DAYS ajusta (1..365). */
export const DEFAULT_LESSONS_HORIZON_DAYS = 60;
export const MAX_LESSONS_HORIZON_DAYS = 365;
const PAGE_SIZE = 200;

/** LESSONS_HORIZON_DAYS lido a cada chamada (inteiro 1..365; inválido/ausente = 60). */
export function lessonsHorizonDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.LESSONS_HORIZON_DAYS);
  if (!Number.isInteger(raw) || raw < 1) return DEFAULT_LESSONS_HORIZON_DAYS;
  return Math.min(raw, MAX_LESSONS_HORIZON_DAYS);
}

/** Último dia (meia-noite UTC, data civil de São Paulo) coberto pelo horizonte a partir de `now`. */
export function lessonsHorizonEnd(now: Date = new Date(), days: number = lessonsHorizonDays()): Date {
  return new Date(civilTodayStart(now).getTime() + days * DAY_MS);
}

export interface EnsureHorizonScope {
  /** Só esta turma. */
  classId?: number;
  /** Só as turmas deste grupo. Sem classId nem organizationId = todas as organizações ativas. */
  organizationId?: number;
}

export interface EnsureHorizonResult {
  /** Turmas elegíveis processadas (ativas, com weekday, autoGenerateLessons=true, grupo ativo). */
  classes: number;
  /** Aulas criadas agora (as já existentes não contam: idempotente). */
  created: number;
  /** Turmas cuja geração falhou (logadas; a próxima execução tenta de novo). */
  failed: number;
  /** Intervalo coberto, "YYYY-MM-DD". */
  from: string;
  to: string;
}

/**
 * Geração ROLANTE de aulas (aulas contínuas, sem data final): garante que cada turma ATIVA, com dia da semana e
 * `autoGenerateLessons=true`, tenha aulas criadas de hoje (data civil de São Paulo) até hoje + LESSONS_HORIZON_DAYS
 * (padrão 60). Reusa o gerador único (generateLessonsInRange: idempotente, advisory lock por turma, nunca recria
 * aula cancelada, não notifica). Turma INACTIVE ou com autoGenerateLessons=false não gera; as aulas futuras já
 * geradas de uma turma desativada continuam existindo (este serviço nunca apaga nada).
 */
@Injectable()
export class ClassLessonsRollingService {
  private readonly logger = new Logger(ClassLessonsRollingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureHorizon(scope: EnsureHorizonScope = {}, now: Date = new Date()): Promise<EnsureHorizonResult> {
    const from = civilTodayStart(now);
    const to = lessonsHorizonEnd(now);
    const where: Prisma.ClassWhereInput = {
      status: RecordStatus.ACTIVE,
      autoGenerateLessons: true,
      weekday: { not: null },
      organization: { status: RecordStatus.ACTIVE },
    };
    if (scope.classId !== undefined) where.id = scope.classId;
    if (scope.organizationId !== undefined) where.organizationId = scope.organizationId;

    const result: EnsureHorizonResult = {
      classes: 0,
      created: 0,
      failed: 0,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    };
    let cursor = 0;
    for (;;) {
      const page = await this.prisma.class.findMany({
        where: { ...where, AND: [{ id: { gt: cursor } }] },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
      });
      if (page.length === 0) break;
      for (const klass of page) {
        result.classes += 1;
        try {
          const generated = await generateLessonsInRange(this.prisma, klass, from, to);
          result.created += generated.created;
        } catch (error) {
          result.failed += 1;
          this.logger.error(
            `Falha ao gerar as aulas continuas da turma ${klass.id}.`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
      cursor = page[page.length - 1].id;
      if (page.length < PAGE_SIZE) break;
    }
    return result;
  }

  /** Fire-and-forget (criar/editar turma): nunca atrasa nem derruba a resposta; falha é logada. */
  queueEnsureHorizon(classId: number): void {
    void this.ensureHorizon({ classId }).catch((error: unknown) => {
      this.logger.error(
        `Falha ao garantir o horizonte de aulas da turma ${classId}.`,
        error instanceof Error ? error.stack : String(error),
      );
    });
  }
}
