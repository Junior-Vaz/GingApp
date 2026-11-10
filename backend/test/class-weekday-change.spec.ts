import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { civilTodayStart } from '../src/interface/http/finance/finance.service';
import { civilWeekdayOf } from '../src/interface/http/classes/class-lessons-generator';
import {
  hasLessonNotes,
  isValidWeekday,
  planWeekdayChange,
  shouldSyncLessonsOnWeekdayChange,
  WeekdayChangeLesson,
} from '../src/interface/http/classes/class-weekday-change';

/**
 * Troca do dia da semana da turma (docs/CONTRATO_TROCA_DIA_TURMA.md): decisão PURA, sem banco.
 * Calendário real conferido: 2026-11-09 é SEGUNDA (1); 11 = quarta (3); 12 = quinta (4); 13 = sexta (5); 08 = domingo (0).
 */
const utc = (day: string, time = '00:00:00.000') => new Date(`${day}T${time}Z`);
const TODAY = utc('2026-11-09');

let nextId = 1;
function lesson(day: string, over: Partial<WeekdayChangeLesson> = {}): WeekdayChangeLesson {
  return { id: nextId++, date: utc(day), status: 'ACTIVE', notes: null, attendances: 0, attendanceNotices: 0, ...over };
}

describe('troca de dia da turma: shouldSyncLessonsOnWeekdayChange', () => {
  const active = { status: 'ACTIVE' as const, autoGenerateLessons: true };

  it('vale: de um número para OUTRO número, turma ACTIVE com aulas contínuas (inclui 0 domingo e 6 sábado)', () => {
    assert.equal(shouldSyncLessonsOnWeekdayChange({ weekday: 3 }, { weekday: 4, ...active }), true);
    assert.equal(shouldSyncLessonsOnWeekdayChange({ weekday: 0 }, { weekday: 6, ...active }), true);
    assert.equal(shouldSyncLessonsOnWeekdayChange({ weekday: 6 }, { weekday: 0, ...active }), true);
  });

  it('NÃO vale: mesmo dia, de/para null, turma INACTIVE, autoGenerateLessons=false', () => {
    assert.equal(shouldSyncLessonsOnWeekdayChange({ weekday: 3 }, { weekday: 3, ...active }), false);
    assert.equal(shouldSyncLessonsOnWeekdayChange({ weekday: 3 }, { weekday: null, ...active }), false);
    assert.equal(shouldSyncLessonsOnWeekdayChange({ weekday: null }, { weekday: 4, ...active }), false);
    assert.equal(shouldSyncLessonsOnWeekdayChange({ weekday: null }, { weekday: null, ...active }), false);
    assert.equal(shouldSyncLessonsOnWeekdayChange({ weekday: 3 }, { weekday: 4, status: 'INACTIVE', autoGenerateLessons: true }), false);
    assert.equal(shouldSyncLessonsOnWeekdayChange({ weekday: 3 }, { weekday: 4, status: 'ACTIVE', autoGenerateLessons: false }), false);
  });

  it('weekday fora de 0..6 / não inteiro nunca vale (defesa)', () => {
    assert.equal(shouldSyncLessonsOnWeekdayChange({ weekday: 7 }, { weekday: 4, ...active }), false);
    assert.equal(shouldSyncLessonsOnWeekdayChange({ weekday: 3 }, { weekday: -1, ...active }), false);
    assert.equal(shouldSyncLessonsOnWeekdayChange({ weekday: 3 }, { weekday: 2.5, ...active }), false);
    assert.equal(isValidWeekday(0), true);
    assert.equal(isValidWeekday(6), true);
    assert.equal(isValidWeekday(null), false);
    assert.equal(isValidWeekday('3'), false);
  });
});

describe('troca de dia da turma: planWeekdayChange', () => {
  it('convenção do dia: a MESMA do gerador (getUTCDay da meia-noite UTC)', () => {
    assert.equal(civilWeekdayOf(utc('2026-11-11')), 3);
    assert.equal(civilWeekdayOf(utc('2026-11-08')), 0);
    assert.equal(civilWeekdayOf(utc('2026-11-14')), 6);
  });

  it('cancela só as futuras ATIVAS do dia antigo sem presença/aviso/observação', () => {
    const a = lesson('2026-11-11');
    const b = lesson('2026-11-18');
    const plan = planWeekdayChange([a, b], 3, TODAY);
    assert.deepEqual(plan.cancel.map((c) => c.id), [a.id, b.id]);
    assert.equal(plan.kept, 0);
    assert.deepEqual(plan.cancel[0].date, a.date, 'devolve a data exata (o where do updateMany re-checa por id+date)');
  });

  it('MANTÉM e conta (kept) as com presença, as com aviso de ausência e as com observação', () => {
    const withAttendance = lesson('2026-11-11', { attendances: 2 });
    const withNotice = lesson('2026-11-18', { attendanceNotices: 1 });
    const withNotes = lesson('2026-11-25', { notes: 'Roda especial' });
    const free = lesson('2026-12-02');
    const plan = planWeekdayChange([withAttendance, withNotice, withNotes, free], 3, TODAY);
    assert.deepEqual(plan.cancel.map((c) => c.id), [free.id]);
    assert.equal(plan.kept, 3);
  });

  it('observação "" (vazia) conta como SEM observação; texto (até só espaços) bloqueia (conservador)', () => {
    assert.equal(hasLessonNotes(null), false);
    assert.equal(hasLessonNotes(''), false);
    assert.equal(hasLessonNotes(' '), true);
    assert.equal(hasLessonNotes('x'), true);
    const empty = lesson('2026-11-11', { notes: '' });
    const spaces = lesson('2026-11-18', { notes: '   ' });
    const plan = planWeekdayChange([empty, spaces], 3, TODAY);
    assert.deepEqual(plan.cancel.map((c) => c.id), [empty.id]);
    assert.equal(plan.kept, 1);
  });

  it('NÃO toca (nem conta) passadas, já canceladas, de outros dias (à mão) e as do dia novo', () => {
    const past = lesson('2026-11-04'); // quarta passada
    const cancelled = lesson('2026-11-11', { status: 'INACTIVE' });
    const otherDay = lesson('2026-11-14'); // sábado criado à mão
    const newDay = lesson('2026-11-12'); // quinta = dia novo
    const plan = planWeekdayChange([past, cancelled, otherDay, newDay], 3, TODAY);
    assert.deepEqual(plan, { cancel: [], kept: 0 });
  });

  it('passada com presença não conta como mantida (só futuras entram no kept)', () => {
    const plan = planWeekdayChange([lesson('2026-11-04', { attendances: 3 }), lesson('2026-11-11', { status: 'INACTIVE', attendances: 1 })], 3, TODAY);
    assert.deepEqual(plan, { cancel: [], kept: 0 });
  });

  it('HOJE conta como futura (date >= hoje); ontem não', () => {
    const today = lesson('2026-11-09'); // segunda = dia antigo 1
    const yesterday = lesson('2026-11-02');
    const plan = planWeekdayChange([today, yesterday], 1, TODAY);
    assert.deepEqual(plan.cancel.map((c) => c.id), [today.id]);
  });

  it('aula criada à mão com hora no timestamp (15:00Z de hoje) também é a de hoje', () => {
    const withHour: WeekdayChangeLesson = { id: nextId++, date: utc('2026-11-09', '15:00:00.000'), status: 'ACTIVE', notes: null, attendances: 0, attendanceNotices: 0 };
    assert.deepEqual(planWeekdayChange([withHour], 1, TODAY).cancel.map((c) => c.id), [withHour.id]);
  });

  it('FUSO: às 22h de São Paulo (01h UTC do dia seguinte) "hoje" continua sendo o dia civil de SP', () => {
    const at22hSp = new Date('2026-11-10T01:00:00.000Z'); // 22:00 de 09/11 em SP (UTC-3, sem horário de verão)
    const today = civilTodayStart(at22hSp);
    assert.equal(today.toISOString(), '2026-11-09T00:00:00.000Z');
    const todaysLesson = lesson('2026-11-09');
    const plan = planWeekdayChange([todaysLesson], 1, today);
    assert.deepEqual(plan.cancel.map((c) => c.id), [todaysLesson.id], 'a aula de hoje às 22h SP ainda é "hoje"');
    // E logo depois da meia-noite de SP o dia vira: a mesma aula passa a ser passada.
    const afterMidnightSp = civilTodayStart(new Date('2026-11-10T03:00:00.000Z'));
    assert.equal(afterMidnightSp.toISOString(), '2026-11-10T00:00:00.000Z');
    assert.deepEqual(planWeekdayChange([todaysLesson], 1, afterMidnightSp), { cancel: [], kept: 0 });
  });

  it('sem aulas: plano vazio', () => {
    assert.deepEqual(planWeekdayChange([], 3, TODAY), { cancel: [], kept: 0 });
  });
});
