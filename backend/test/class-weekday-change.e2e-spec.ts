import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it, mock } from 'node:test';
import request from 'supertest';
import { ClassLessonsRollingService } from '../src/interface/http/classes/class-lessons-rolling.service';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { createSecondOrg, SecondOrg, todaySaoPaulo } from './utils/list-helpers';
import { createTestApp, MemoryPushSender } from './utils/test-app';

/**
 * Troca do dia da semana da turma (docs/CONTRATO_TROCA_DIA_TURMA.md): PATCH /classes/:id cancela as aulas futuras do dia
 * antigo que nao tem presenca/aviso/observacao e gera as do dia novo; devolve `lessonsSync`; audita no CLASS_UPDATE.
 *
 * Tudo em organizacoes PROPRIAS da suite (createSecondOrg) — seed/demo nunca sao tocados. As turmas sao criadas por Prisma
 * (nao pela API) para a geracao em segundo plano do POST /classes nao correr junto com as aulas montadas a mao; o dia da
 * semana "antigo" e' o de HOJE (assim "hoje conta como futura" e' exercitado em todos os cenarios, em qualquer dia em que
 * o teste rode). O calculo das datas esperadas e' independente do service (mesma ideia de lessons-continuous).
 * GINGAPP_CAPTURE_DIR (opcional): grava aqui um JSON real do PATCH com e sem lessonsSync.
 */
const DAY = 86_400_000;
const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
const wd = (day: string) => utc(day).getUTCDay();

/** Datas "YYYY-MM-DD" de hoje (SP) ate hoje+horizon cujo dia da semana e' `weekday` — independente do service. */
function expectedDates(weekday: number, horizon = 60): string[] {
  const start = utc(todaySaoPaulo(0)).getTime();
  const out: string[] = [];
  for (let t = start; t <= start + horizon * DAY; t += DAY) {
    if (new Date(t).getUTCDay() === weekday) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

describe('Troca do dia da semana da turma: cancela o dia antigo e gera o novo (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const push = new MemoryPushSender();
  let orgB: SecondOrg;
  let orgC: SecondOrg;
  let rolling: ClassLessonsRollingService;
  let studentId: number;
  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const TODAY = todaySaoPaulo(0);
  const OLD = wd(TODAY); // dia antigo = o dia da semana de hoje
  const NEW = (OLD + 1) % 7; // dia novo
  const OTHER = (OLD + 2) % 7; // um terceiro dia (aula criada a mao)
  const day = (offset: number) => todaySaoPaulo(offset);

  async function newClass(data: { weekday?: number | null; autoGenerateLessons?: boolean; status?: 'ACTIVE' | 'INACTIVE'; org?: SecondOrg } = {}) {
    const org = data.org ?? orgB;
    return prisma.class.create({
      data: {
        organizationId: org.organizationId,
        name: '[e2e-troca] Turma',
        weekday: data.weekday === undefined ? OLD : data.weekday,
        startTime: '19:00',
        endTime: '20:00',
        autoGenerateLessons: data.autoGenerateLessons ?? true,
        status: data.status ?? 'ACTIVE',
      },
    });
  }
  const addLesson = (classId: number, date: string, extra: { status?: 'ACTIVE' | 'INACTIVE'; notes?: string | null; org?: SecondOrg; cancelledAt?: Date } = {}) =>
    prisma.lesson.create({
      data: { organizationId: (extra.org ?? orgB).organizationId, classId, date: utc(date), startTime: '19:00', endTime: '20:00', status: extra.status, notes: extra.notes, cancelledAt: extra.cancelledAt },
    });
  const lessons = (classId: number) => prisma.lesson.findMany({ where: { classId }, orderBy: { date: 'asc' } });
  const statusByDate = async (classId: number) =>
    Object.fromEntries((await lessons(classId)).map((l) => [l.date.toISOString().slice(0, 10), l.status]));
  const patch = (classId: number, body: Record<string, unknown>, token = orgB.token) =>
    request(server()).patch(`/api/classes/${classId}`).set(auth(token)).send(body);
  const classUpdateLogs = (classId: number) =>
    prisma.auditLog.findMany({ where: { resource: 'class', resourceId: String(classId), action: 'CLASS_UPDATE' }, orderBy: { id: 'asc' } });
  const notifications = (organizationId: number) => prisma.notification.count({ where: { organizationId } });
  const capture = (name: string, body: unknown) => {
    const dir = process.env.GINGAPP_CAPTURE_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), JSON.stringify(body, null, 2), 'utf8');
  };

  /** Espia as chamadas do gerador (ensureHorizon aguardado / queueEnsureHorizon fire-and-forget). */
  function spyRolling() {
    const calls = { ensure: [] as unknown[], queue: [] as number[] };
    const ensure = rolling.ensureHorizon.bind(rolling);
    const queue = rolling.queueEnsureHorizon.bind(rolling);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = rolling as any;
    r.ensureHorizon = (scope: unknown, now?: Date) => {
      calls.ensure.push(scope);
      return ensure(scope as never, now);
    };
    r.queueEnsureHorizon = (classId: number) => {
      calls.queue.push(classId);
      queue(classId);
    };
    return {
      calls,
      restore: () => {
        r.ensureHorizon = ensure;
        r.queueEnsureHorizon = queue;
      },
    };
  }

  before(async () => {
    app = await createTestApp({ pushSender: push });
    rolling = app.get(ClassLessonsRollingService);
    orgB = await createSecondOrg(app, prisma, 'troca');
    orgC = await createSecondOrg(app, prisma, 'trocac');
    studentId = (await prisma.student.create({ data: { organizationId: orgB.organizationId, name: 'Aluno Troca' } })).id;
  });

  after(async () => {
    for (const org of [orgB, orgC]) {
      const organizationId = org.organizationId;
      await prisma.attendanceNotice.deleteMany({ where: { organizationId } });
      await prisma.attendance.deleteMany({ where: { organizationId } });
      await prisma.notification.deleteMany({ where: { organizationId } });
      await prisma.lesson.deleteMany({ where: { organizationId } });
      await prisma.class.deleteMany({ where: { organizationId } });
      await prisma.student.deleteMany({ where: { organizationId } });
      await prisma.auditLog.deleteMany({ where: { organizationId } });
      await org.cleanup();
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('cancela so as futuras ativas do dia antigo sem presenca/aviso/observacao; mantem (kept) as bloqueadas; gera o dia novo sem duplicar', async () => {
    const klass = await newClass();
    const other = await newClass(); // outra turma do MESMO grupo, no mesmo dia antigo
    const foreign = await newClass({ org: orgC }); // turma de OUTRO grupo, no mesmo dia antigo

    const past = await addLesson(klass.id, day(-7)); // passada (dia antigo)
    const lToday = await addLesson(klass.id, day(0)); // hoje (dia antigo): conta como futura
    const free1 = await addLesson(klass.id, day(7));
    const free2 = await addLesson(klass.id, day(14));
    const withAttendance = await addLesson(klass.id, day(21));
    const withNotice = await addLesson(klass.id, day(28));
    const withNotes = await addLesson(klass.id, day(35), { notes: 'Roda especial com visita' });
    const earlier = new Date(Date.now() - 3 * DAY);
    const alreadyCancelled = await addLesson(klass.id, day(42), { status: 'INACTIVE', cancelledAt: earlier });
    const otherDayManual = await addLesson(klass.id, day(2)); // terceiro dia, criada a mao
    const newDayManual = await addLesson(klass.id, day(1)); // JA no dia novo
    const otherClassLesson = await addLesson(other.id, day(7));
    const foreignLesson = await addLesson(foreign.id, day(7), { org: orgC });
    await prisma.attendance.create({ data: { organizationId: orgB.organizationId, lessonId: withAttendance.id, studentId, present: true } });
    await prisma.attendanceNotice.create({ data: { organizationId: orgB.organizationId, lessonId: withNotice.id, studentId } });

    const notificationsBefore = await notifications(orgB.organizationId);
    const pushBefore = push.sent.length;
    const spy = spyRolling();
    let res;
    try {
      res = await patch(klass.id, { weekday: NEW }).expect(200);
    } finally {
      spy.restore();
    }

    // Resposta: ClassView + lessonsSync
    const newDates = expectedDates(NEW);
    assert.equal(res.body.id, klass.id);
    assert.equal(res.body.weekday, NEW);
    assert.deepEqual(res.body.lessonsSync, {
      cancelled: 3,
      kept: 3,
      created: newDates.length - 1, // a aula ja existente no dia novo (newDayManual) nao e recriada
      oldWeekday: OLD,
      newWeekday: NEW,
    });
    capture('troca-dia-real.json', res.body);

    // Cancelou so as 3 livres (soft: INACTIVE + cancelledAt)
    for (const l of [lToday, free1, free2]) {
      const row = await prisma.lesson.findUniqueOrThrow({ where: { id: l.id } });
      assert.equal(row.status, 'INACTIVE', `aula ${row.date.toISOString()} deveria estar cancelada`);
      assert.ok(row.cancelledAt && Math.abs(row.cancelledAt.getTime() - Date.now()) < 60_000);
    }
    // Manteve as bloqueadas e tudo o que nao era para tocar (status E campos intactos)
    for (const l of [withAttendance, withNotice, withNotes, past, otherDayManual, newDayManual]) {
      const row = await prisma.lesson.findUniqueOrThrow({ where: { id: l.id } });
      assert.equal(row.status, 'ACTIVE');
      assert.equal(row.cancelledAt, null);
      assert.equal(row.notes, l.notes);
      assert.equal(row.date.getTime(), l.date.getTime());
    }
    assert.equal((await prisma.lesson.findUniqueOrThrow({ where: { id: withNotes.id } })).notes, 'Roda especial com visita');
    const stillCancelled = await prisma.lesson.findUniqueOrThrow({ where: { id: alreadyCancelled.id } });
    assert.equal(stillCancelled.status, 'INACTIVE');
    assert.equal(stillCancelled.cancelledAt?.getTime(), earlier.getTime(), 'a cancelada de antes NAO tem o cancelledAt reescrito');
    assert.equal((await prisma.attendance.count({ where: { lessonId: withAttendance.id } })), 1);
    assert.equal((await prisma.attendanceNotice.count({ where: { lessonId: withNotice.id } })), 1);
    // Outra turma do grupo e turma de OUTRO grupo: intactas
    assert.equal((await prisma.lesson.findUniqueOrThrow({ where: { id: otherClassLesson.id } })).status, 'ACTIVE');
    assert.equal((await prisma.lesson.findUniqueOrThrow({ where: { id: foreignLesson.id } })).status, 'ACTIVE');
    assert.equal((await lessons(other.id)).length, 1);
    assert.equal((await lessons(foreign.id)).length, 1);

    // Gerou o dia novo ate o horizonte, sem duplicar (uma aula por data, inclusive a que ja existia)
    const newDayRows = (await lessons(klass.id)).filter((l) => l.date.getUTCDay() === NEW);
    assert.deepEqual(newDayRows.map((l) => l.date.toISOString().slice(0, 10)), newDates);
    assert.ok(newDayRows.every((l) => l.status === 'ACTIVE' && l.startTime === '19:00' && l.endTime === '20:00'));
    assert.equal(newDayRows.filter((l) => l.id === newDayManual.id).length, 1);
    // Nenhuma aula nova no dia antigo nem no terceiro dia
    assert.equal((await lessons(klass.id)).filter((l) => l.date.getUTCDay() === OLD && l.status === 'ACTIVE').length, 3 + 1 /* withAttendance, withNotice, withNotes + past */);
    assert.equal((await lessons(klass.id)).filter((l) => l.date.getUTCDay() === OTHER).length, 1);

    // Gerador: 1x aguardado (ensureHorizon) e NUNCA o fire-and-forget em duplicidade
    assert.deepEqual(spy.calls.ensure, [{ classId: klass.id }]);
    assert.deepEqual(spy.calls.queue, []);

    // Silencioso: nenhuma notificacao e nenhum push
    assert.equal(await notifications(orgB.organizationId), notificationsBefore);
    assert.equal(push.sent.length, pushBefore);

    // Auditoria: UM CLASS_UPDATE com lessonsSync no meta (sem dados pessoais)
    const logs = await classUpdateLogs(klass.id);
    assert.equal(logs.length, 1);
    const meta = logs[0].metadata as { fields: string[]; status: string; lessonsSync: unknown };
    assert.deepEqual(meta.lessonsSync, res.body.lessonsSync);
    assert.deepEqual(meta.fields, ['weekday']);
    assert.equal(meta.status, 'ACTIVE');
  });

  it('PATCH sem troca de dia (ex.: so o nome) NAO traz lessonsSync e nao mexe nas aulas', async () => {
    const klass = await newClass();
    const l = await addLesson(klass.id, day(7));
    const res = await patch(klass.id, { name: '[e2e-troca] Renomeada' }).expect(200);
    assert.equal('lessonsSync' in res.body, false);
    capture('troca-dia-real-sem-lessonsSync.json', res.body);
    assert.equal((await prisma.lesson.findUniqueOrThrow({ where: { id: l.id } })).status, 'ACTIVE');
    const meta = (await classUpdateLogs(klass.id))[0].metadata as Record<string, unknown>;
    assert.equal('lessonsSync' in meta, false);
  });

  it('outras rotas (GET /classes e /classes/:id) nao ganham lessonsSync', async () => {
    const klass = await newClass();
    await patch(klass.id, { weekday: NEW }).expect(200);
    const one = await request(server()).get(`/api/classes/${klass.id}`).set(auth(orgB.token)).expect(200);
    assert.equal('lessonsSync' in one.body, false);
    const list = await request(server()).get('/api/classes').set(auth(orgB.token)).expect(200);
    assert.ok(Array.isArray(list.body) && list.body.length > 0);
    assert.ok(list.body.every((c: Record<string, unknown>) => !('lessonsSync' in c)));
  });

  describe('casos em que a regra NAO se aplica (comportamento de hoje, nada cancelado)', () => {
    async function assertUntouched(classId: number, ids: number[]) {
      for (const id of ids) assert.equal((await prisma.lesson.findUniqueOrThrow({ where: { id } })).status, 'ACTIVE');
      const logs = await classUpdateLogs(classId);
      assert.ok(logs.every((l) => !('lessonsSync' in ((l.metadata as object) ?? {}))));
    }

    it('weekday igual ao atual', async () => {
      const klass = await newClass();
      const l = await addLesson(klass.id, day(7));
      const res = await patch(klass.id, { weekday: OLD }).expect(200);
      assert.equal('lessonsSync' in res.body, false);
      await assertUntouched(klass.id, [l.id]);
    });

    it('weekday passa a null (e a aula do dia antigo continua)', async () => {
      const klass = await newClass();
      const l = await addLesson(klass.id, day(7));
      const res = await patch(klass.id, { weekday: null }).expect(200);
      assert.equal('lessonsSync' in res.body, false);
      assert.equal(res.body.weekday, null);
      await assertUntouched(klass.id, [l.id]);
    });

    it('weekday vem de null: cancela nada; o gerador de sempre (fire-and-forget) gera o dia novo', async () => {
      const klass = await newClass({ weekday: null });
      const l = await addLesson(klass.id, day(7)); // criada a mao num dia qualquer
      const spy = spyRolling();
      let res;
      try {
        res = await patch(klass.id, { weekday: NEW }).expect(200);
      } finally {
        spy.restore();
      }
      assert.equal('lessonsSync' in res.body, false);
      assert.deepEqual(spy.calls.queue, [klass.id], 'comportamento atual: queueEnsureHorizon fire-and-forget');
      await assertUntouched(klass.id, [l.id]);
      for (let i = 0; i < 80 && (await lessons(klass.id)).length < 2; i += 1) await new Promise((r) => setTimeout(r, 100));
      assert.ok((await lessons(klass.id)).some((x) => x.date.getUTCDay() === NEW && x.id !== l.id), 'a geracao em segundo plano acontece');
    });

    it('turma que fica INACTIVE (mesmo PATCH) e turma que ja estava INACTIVE', async () => {
      const klass = await newClass();
      const l = await addLesson(klass.id, day(7));
      const res = await patch(klass.id, { weekday: NEW, status: 'INACTIVE' }).expect(200);
      assert.equal('lessonsSync' in res.body, false);
      assert.equal(res.body.status, 'INACTIVE');
      await assertUntouched(klass.id, [l.id]);

      const parked = await newClass({ status: 'INACTIVE' });
      const l2 = await addLesson(parked.id, day(7));
      const res2 = await patch(parked.id, { weekday: NEW }).expect(200);
      assert.equal('lessonsSync' in res2.body, false);
      await assertUntouched(parked.id, [l2.id]);
    });

    it('autoGenerateLessons=false (o dono gerencia as aulas a mao): nada cancelado nem gerado; ligar junto com a troca aplica a regra', async () => {
      const klass = await newClass({ autoGenerateLessons: false });
      const l = await addLesson(klass.id, day(7));
      const res = await patch(klass.id, { weekday: NEW }).expect(200);
      assert.equal('lessonsSync' in res.body, false);
      await assertUntouched(klass.id, [l.id]);
      assert.equal((await lessons(klass.id)).length, 1, 'nao gerou nada');

      // Troca de dia E autoGenerateLessons=false no mesmo PATCH: tambem nao aplica.
      const l2 = await addLesson(klass.id, day(14));
      const res2 = await patch(klass.id, { weekday: OTHER, autoGenerateLessons: false }).expect(200);
      assert.equal('lessonsSync' in res2.body, false);
      await assertUntouched(klass.id, [l.id, l2.id]);

      // Contrato: a regra olha a turma DEPOIS do update — ligando autoGenerateLessons na mesma troca ela vale.
      const manual = await newClass({ autoGenerateLessons: false });
      await addLesson(manual.id, day(7));
      await addLesson(manual.id, day(14));
      const res3 = await patch(manual.id, { weekday: NEW, autoGenerateLessons: true }).expect(200);
      assert.deepEqual(res3.body.lessonsSync, { cancelled: 2, kept: 0, created: expectedDates(NEW).length, oldWeekday: OLD, newWeekday: NEW });
    });
  });

  it('CORRIDA: presenca/aviso/observacao que surge entre a leitura e o cancelamento segura a aula (as guardas valem no where do updateMany)', async () => {
    const klass = await newClass();
    const a = await addLesson(klass.id, day(7));
    const b = await addLesson(klass.id, day(14));
    const c = await addLesson(klass.id, day(21));
    const d = await addLesson(klass.id, day(28));
    const prismaService = app.get(PrismaService);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lessonDelegate = prismaService.lesson as any;
    const originalUpdateMany = lessonDelegate.updateMany.bind(lessonDelegate);
    let armed = true;
    lessonDelegate.updateMany = async (args: unknown) => {
      if (armed) {
        armed = false; // alguem registra a chamada / avisa ausencia / anota a aula DEPOIS da leitura e ANTES do cancelamento
        await prisma.attendance.create({ data: { organizationId: orgB.organizationId, lessonId: a.id, studentId, present: true } });
        await prisma.attendanceNotice.create({ data: { organizationId: orgB.organizationId, lessonId: b.id, studentId } });
        await prisma.lesson.update({ where: { id: c.id }, data: { notes: 'anotada no meio' } });
      }
      return originalUpdateMany(args);
    };
    let res;
    try {
      res = await patch(klass.id, { weekday: NEW }).expect(200);
    } finally {
      lessonDelegate.updateMany = originalUpdateMany;
    }
    assert.equal(res.body.lessonsSync.cancelled, 1, 'so a livre (d) foi cancelada');
    assert.equal(res.body.lessonsSync.kept, 3, 'as tres seguradas no meio viram "mantidas"');
    for (const l of [a, b, c]) assert.equal((await prisma.lesson.findUniqueOrThrow({ where: { id: l.id } })).status, 'ACTIVE');
    assert.equal((await prisma.lesson.findUniqueOrThrow({ where: { id: d.id } })).status, 'INACTIVE');
  });

  it('turma de OUTRO grupo: PATCH com o token errado e 404 e nada e cancelado', async () => {
    const klass = await newClass();
    const l = await addLesson(klass.id, day(7));
    await patch(klass.id, { weekday: NEW }, orgC.token).expect(404);
    assert.equal((await prisma.lesson.findUniqueOrThrow({ where: { id: l.id } })).status, 'ACTIVE');
    assert.equal((await prisma.class.findUniqueOrThrow({ where: { id: klass.id } })).weekday, OLD);
  });

  describe('falha na geracao: o update da turma e o cancelamento permanecem (nunca 5xx)', () => {
    it('ensureHorizon lanca: 200, created null, aulas canceladas; o job seguinte gera', async () => {
      const klass = await newClass();
      const free = await addLesson(klass.id, day(7));
      const original = rolling.ensureHorizon.bind(rolling);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rolling as any).ensureHorizon = async () => {
        throw new Error('falha simulada da geracao');
      };
      let res;
      try {
        res = await patch(klass.id, { weekday: NEW }).expect(200);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rolling as any).ensureHorizon = original;
      }
      assert.deepEqual(res.body.lessonsSync, { cancelled: 1, kept: 0, created: null, oldWeekday: OLD, newWeekday: NEW });
      assert.equal(res.body.weekday, NEW);
      assert.equal((await prisma.class.findUniqueOrThrow({ where: { id: klass.id } })).weekday, NEW);
      assert.equal((await prisma.lesson.findUniqueOrThrow({ where: { id: free.id } })).status, 'INACTIVE');
      assert.equal((await lessons(klass.id)).length, 1, 'nada foi gerado');
      const meta = (await classUpdateLogs(klass.id))[0].metadata as { lessonsSync: { created: number | null } };
      assert.equal(meta.lessonsSync.created, null);

      // "A proxima execucao do job gera": o gerador (idempotente) completa o dia novo.
      const job = await rolling.ensureHorizon({ classId: klass.id });
      assert.equal(job.created, expectedDates(NEW).length);
    });

    it('ensureHorizon engole o erro da turma (failed > 0): tambem created null', async () => {
      const klass = await newClass();
      await addLesson(klass.id, day(7));
      const original = rolling.ensureHorizon.bind(rolling);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rolling as any).ensureHorizon = async () => ({ classes: 1, created: 0, failed: 1, from: TODAY, to: TODAY });
      let res;
      try {
        res = await patch(klass.id, { weekday: NEW }).expect(200);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rolling as any).ensureHorizon = original;
      }
      assert.equal(res.body.lessonsSync.created, null);
      assert.equal(res.body.lessonsSync.cancelled, 1);
    });
  });

  it('dois PATCH seguidos (A -> B, depois B -> C): so o ultimo dia fica ativo; presenca/kept intocados; nada cancelado a mais', async () => {
    const A = OLD;
    const B = (A + 1) % 7;
    const C = (A + 2) % 7;
    const klass = await newClass({ weekday: A });
    await rolling.ensureHorizon({ classId: klass.id }); // aulas "de verdade" do dia A ate o horizonte
    const aDates = expectedDates(A);
    assert.deepEqual((await lessons(klass.id)).map((l) => l.date.toISOString().slice(0, 10)), aDates);
    const protectedLesson = (await lessons(klass.id))[2]; // a 3a aula do dia A tem presenca
    await prisma.attendance.create({ data: { organizationId: orgB.organizationId, lessonId: protectedLesson.id, studentId, present: true } });

    const first = await patch(klass.id, { weekday: B }).expect(200);
    assert.deepEqual(first.body.lessonsSync, { cancelled: aDates.length - 1, kept: 1, created: expectedDates(B).length, oldWeekday: A, newWeekday: B });

    const second = await patch(klass.id, { weekday: C }).expect(200);
    // 2o PATCH cancela o dia B (geradas no 1o); o dia A (ja cancelado / mantido) NAO e reprocessado: kept 0 (so conta o dia antigo = B)
    assert.deepEqual(second.body.lessonsSync, { cancelled: expectedDates(B).length, kept: 0, created: expectedDates(C).length, oldWeekday: B, newWeekday: C });

    const rows = await lessons(klass.id);
    const active = rows.filter((l) => l.status === 'ACTIVE');
    const activeByDay = (w: number) => active.filter((l) => l.date.getUTCDay() === w).map((l) => l.date.toISOString().slice(0, 10));
    assert.deepEqual(activeByDay(C), expectedDates(C), 'o dia final tem todas as aulas ativas');
    assert.deepEqual(activeByDay(B), [], 'nenhuma aula ativa no dia do meio');
    assert.deepEqual(activeByDay(A), [protectedLesson.date.toISOString().slice(0, 10)], 'so a aula do dia A com presenca continua ativa');
    assert.equal(rows.filter((l) => l.date.getUTCDay() === A && l.status === 'INACTIVE').length, aDates.length - 1);
    assert.equal(rows.filter((l) => l.date.getUTCDay() === B && l.status === 'INACTIVE').length, expectedDates(B).length);
    assert.equal(await prisma.attendance.count({ where: { lessonId: protectedLesson.id } }), 1);
    const dateCounts = new Set(rows.map((l) => l.date.toISOString().slice(0, 10)));
    assert.equal(dateCounts.size, rows.length, 'nenhuma data duplicada');
  });

  it('FUSO: com o relogio as 22h de Sao Paulo (01h UTC do dia seguinte) a aula de HOJE continua sendo hoje e e cancelada', async () => {
    const klass = await newClass();
    const lToday = await addLesson(klass.id, day(0));
    const lPast = await addLesson(klass.id, day(-7));
    const lNext = await addLesson(klass.id, day(7));
    const at22hSp = new Date(`${TODAY}T22:00:00-03:00`); // Sao Paulo nao tem horario de verao desde 2019
    mock.timers.enable({ apis: ['Date'], now: at22hSp });
    let res;
    try {
      assert.equal(new Date().getUTCDate() !== utc(TODAY).getUTCDate(), true, 'no relogio simulado o dia UTC ja virou');
      res = await patch(klass.id, { weekday: NEW }).expect(200);
    } finally {
      mock.timers.reset();
    }
    assert.equal(res.body.lessonsSync.cancelled, 2, 'hoje e +7 canceladas');
    assert.equal((await prisma.lesson.findUniqueOrThrow({ where: { id: lToday.id } })).status, 'INACTIVE');
    assert.equal((await prisma.lesson.findUniqueOrThrow({ where: { id: lNext.id } })).status, 'INACTIVE');
    assert.equal((await prisma.lesson.findUniqueOrThrow({ where: { id: lPast.id } })).status, 'ACTIVE', 'a passada nao e tocada');
  });
});
