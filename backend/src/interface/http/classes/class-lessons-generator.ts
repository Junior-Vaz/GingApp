import { Class } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';

export const DAY_MS = 86_400_000;
/** Maior intervalo aceito por POST /classes/:id/generate-lessons com `to` explicito (to - from, em dias). */
export const MAX_GENERATE_LESSONS_SPAN_DAYS = 90;
/** Namespace do advisory lock de geração (par com o id da turma): serializa gerações concorrentes da MESMA turma. */
export const GENERATE_LESSONS_LOCK_NS = 7106;

export interface GenerateLessonsResult {
  classId: number;
  from: string;
  to: string;
  /** Quantas datas do intervalo caem no dia da semana da turma. */
  occurrences: number;
  /** Aulas criadas agora. */
  created: number;
  /** Ocorrências ignoradas porque já existe aula (qualquer status, inclusive cancelada) da turma naquela data. */
  ignored: number;
  createdDates: string[];
  ignoredDates: string[];
}

/** O que o gerador precisa da turma (a turma completa do Prisma serve). */
export type GeneratableClass = Pick<
  Class,
  'id' | 'organizationId' | 'unitId' | 'teacherUserId' | 'weekday' | 'startTime' | 'endTime'
>;

/** "YYYY-MM-DD" (data civil UTC) de um instante. */
export function civilDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * GERADOR ÚNICO (SSOT) de aulas da turma: uma Lesson para cada data de [from, to] (inclusivas, datas civis UTC —
 * meia-noite UTC, a mesma convenção de Lesson.date) cujo dia da semana é o `weekday` da turma. Copia unidade,
 * professor responsável e horário da turma. Usado por POST /classes/:id/generate-lessons (período explícito ou
 * contínuo) e pelo ClassLessonsRollingService (job diário / ensureHorizon). Quem chama valida turma ativa, weekday
 * definido, from <= to e o limite de dias; aqui só se gera.
 *
 * Idempotente: data que já tem aula da turma (qualquer status — uma aula cancelada NÃO é recriada) é ignorada e
 * contada em `ignored`. Gerações concorrentes da mesma turma são serializadas por advisory lock transacional
 * (Lesson não tem unique por turma+data). NÃO notifica ninguém (aula gerada é silenciosa).
 */
export async function generateLessonsInRange(
  prisma: PrismaService,
  klass: GeneratableClass,
  from: Date,
  to: Date,
): Promise<GenerateLessonsResult> {
  const { organizationId } = klass;
  const classId = klass.id;
  const days: string[] = [];
  if (klass.weekday !== null) {
    for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
      const day = new Date(t);
      if (day.getUTCDay() === klass.weekday) days.push(civilDayString(day));
    }
  }

  const base = { classId, from: civilDayString(from), to: civilDayString(to), occurrences: days.length };
  if (days.length === 0) {
    return { ...base, created: 0, ignored: 0, createdDates: [], ignoredDates: [] };
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${GENERATE_LESSONS_LOCK_NS}::int, ${classId}::int)`;

    // Intervalo (e não "date IN (...)"): uma aula criada à mão com horário no timestamp também conta
    // como existente naquele dia civil UTC.
    const existing = await tx.lesson.findMany({
      where: {
        organizationId,
        classId,
        date: { gte: from, lte: new Date(to.getTime() + DAY_MS - 1) },
      },
      select: { date: true },
    });
    const taken = new Set(existing.map((l) => civilDayString(l.date)));
    const createdDates = days.filter((d) => !taken.has(d));
    const ignoredDates = days.filter((d) => taken.has(d));

    if (createdDates.length > 0) {
      await tx.lesson.createMany({
        data: createdDates.map((d) => ({
          organizationId,
          classId,
          unitId: klass.unitId,
          teacherUserId: klass.teacherUserId,
          date: new Date(`${d}T00:00:00.000Z`),
          startTime: klass.startTime,
          endTime: klass.endTime,
        })),
      });
    }
    return { ...base, created: createdDates.length, ignored: ignoredDates.length, createdDates, ignoredDates };
  });
}
