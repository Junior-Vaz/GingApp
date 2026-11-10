import { RecordStatus } from '@prisma/client';
import { civilWeekdayOf } from './class-lessons-generator';

/**
 * Troca do dia da semana de uma turma (docs/CONTRATO_TROCA_DIA_TURMA.md): funções PURAS de decisão. O I/O (consulta,
 * updateMany, geração) fica no ClassesService; aqui só se decide SE a regra vale e QUAIS aulas cancelar/manter.
 */

/** Resumo devolvido em `lessonsSync` no PATCH da turma (sem dados pessoais; também vai no meta da auditoria). */
export interface LessonsSync {
  /** Aulas do dia antigo canceladas agora. */
  cancelled: number;
  /** Aulas futuras ativas do dia antigo MANTIDAS por terem presença, aviso de ausência ou observação. */
  kept: number;
  /** Aulas criadas no dia novo; `null` = a geração falhou e será feita pelo job diário. */
  created: number | null;
  oldWeekday: number;
  newWeekday: number;
}

/** Dia da semana válido do contrato (0 = domingo .. 6 = sábado). */
export function isValidWeekday(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

/**
 * A regra vale quando o dia mudou de UM número (0..6) para OUTRO número (0..6) E a turma, depois do update, está
 * ACTIVE com autoGenerateLessons ligado. De/para `null`, mesmo dia, turma INACTIVE ou autoGenerateLessons=false: não vale.
 */
export function shouldSyncLessonsOnWeekdayChange(
  before: { weekday: number | null },
  after: { weekday: number | null; status: RecordStatus; autoGenerateLessons: boolean },
): boolean {
  return (
    isValidWeekday(before.weekday) &&
    isValidWeekday(after.weekday) &&
    before.weekday !== after.weekday &&
    after.status === RecordStatus.ACTIVE &&
    after.autoGenerateLessons
  );
}

/** Uma aula da turma como o plano a enxerga (contagens, não registros: nada de dados de alunos). */
export interface WeekdayChangeLesson {
  id: number;
  date: Date;
  status: RecordStatus;
  notes: string | null;
  /** Quantas presenças/ausências (Attendance) a aula tem. */
  attendances: number;
  /** Quantos avisos de ausência (AttendanceNotice) a aula tem. */
  attendanceNotices: number;
}

/** Observação preenchida? (nulo ou "" = sem observação; qualquer outro texto bloqueia, até só espaços: conservador). */
export function hasLessonNotes(notes: string | null): boolean {
  return notes !== null && notes !== '';
}

export interface WeekdayChangePlan {
  /** Aulas a cancelar (id + data exata, para o `where` do updateMany re-checar). */
  cancel: Array<{ id: number; date: Date }>;
  /** Aulas do dia antigo, futuras e ativas, que ficam por terem presença/aviso/observação. */
  kept: number;
}

/**
 * Separa as aulas do dia ANTIGO que saem (futuras = `date >= today`, ATIVAS, sem presença, sem aviso, sem observação)
 * das que ficam (mesmas condições de data/status/dia, mas bloqueadas por presença/aviso/observação). Tudo o que não é do
 * dia antigo (outro dia, hoje-ou-depois no dia novo), passado ou já cancelado é ignorado — nem cancela, nem conta.
 * O dia da semana vem de civilWeekdayOf (a mesma convenção do gerador).
 */
export function planWeekdayChange(lessons: WeekdayChangeLesson[], oldWeekday: number, today: Date): WeekdayChangePlan {
  const cancel: WeekdayChangePlan['cancel'] = [];
  let kept = 0;
  for (const lesson of lessons) {
    if (lesson.status !== RecordStatus.ACTIVE) continue;
    if (lesson.date.getTime() < today.getTime()) continue;
    if (civilWeekdayOf(lesson.date) !== oldWeekday) continue;
    if (lesson.attendances > 0 || lesson.attendanceNotices > 0 || hasLessonNotes(lesson.notes)) kept += 1;
    else cancel.push({ id: lesson.id, date: lesson.date });
  }
  return { cancel, kept };
}
