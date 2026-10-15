import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { todaySaoPaulo } from './utils/list-helpers';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * GET /classes devolve, por turma, o diagnostico das aulas a frente: `nextLesson` ({date,status} da mais proxima de qualquer
 * status, de hoje em diante) e `nextActiveLesson` ({date} da mais proxima ATIVA) — em lote (sem N+1). E, ao mudar
 * professor/horario/unidade da turma, as aulas FUTURAS ATIVAS que ainda tem o valor antigo acompanham. Grupo PROPRIO.
 */
describe('Turmas: nextLesson/nextActiveLesson + sync das aulas futuras (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let org: ReportOrg;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const day = (offset: number) => new Date(`${todaySaoPaulo(offset)}T00:00:00.000Z`);
  const iso = (offset: number) => todaySaoPaulo(offset);

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    org = await createReportOrg(app, prisma, 'nextles');
  });

  after(async () => {
    await org.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  const cls = (name: string, extra: Record<string, unknown> = {}) =>
    prisma.class.create({ data: { organizationId: org.organizationId, name, autoGenerateLessons: true, weekday: 3, ...extra } });
  const lesson = (classId: number, offset: number, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE', extra: Record<string, unknown> = {}) =>
    prisma.lesson.create({ data: { organizationId: org.organizationId, classId, date: day(offset), status, ...extra } });

  it('proxima ativa, proxima cancelada na frente da ativa, so passadas e sem aulas', async () => {
    const withActive = await cls('Com ativa');
    await lesson(withActive.id, -3); // passada: ignorada
    await lesson(withActive.id, 4);
    await lesson(withActive.id, 11);
    const cancelledFirst = await cls('Cancelada na frente');
    await lesson(cancelledFirst.id, 0, 'INACTIVE'); // hoje conta como "a frente"
    await lesson(cancelledFirst.id, 7);
    const onlyCancelled = await cls('So canceladas');
    await lesson(onlyCancelled.id, 2, 'INACTIVE');
    await lesson(onlyCancelled.id, 9, 'INACTIVE');
    const onlyPast = await cls('So passadas');
    await lesson(onlyPast.id, -1);
    const none = await cls('Sem aulas');
    const sameDay = await cls('Empate no dia');
    await lesson(sameDay.id, 5, 'INACTIVE');
    await lesson(sameDay.id, 5, 'ACTIVE');

    const res = await http().get('/api/classes').query({ limit: 50 }).set(auth(org.mestre.token)).expect(200);
    const by = (id: number) => res.body.find((c: { id: number }) => c.id === id);
    const d = (offset: number) => `${iso(offset)}T00:00:00.000Z`;

    assert.deepEqual(by(withActive.id).nextLesson, { date: d(4), status: 'ACTIVE' });
    assert.deepEqual(by(withActive.id).nextActiveLesson, { date: d(4) });
    assert.deepEqual(by(cancelledFirst.id).nextLesson, { date: d(0), status: 'INACTIVE' }, 'a mais proxima e a cancelada de hoje');
    assert.deepEqual(by(cancelledFirst.id).nextActiveLesson, { date: d(7) });
    assert.deepEqual(by(onlyCancelled.id).nextLesson, { date: d(2), status: 'INACTIVE' });
    assert.equal(by(onlyCancelled.id).nextActiveLesson, null, 'sem nenhuma ativa a frente');
    assert.equal(by(onlyPast.id).nextLesson, null);
    assert.equal(by(onlyPast.id).nextActiveLesson, null);
    assert.equal(by(none.id).nextLesson, null);
    assert.deepEqual(by(sameDay.id).nextLesson, { date: d(5), status: 'ACTIVE' }, 'empate de data: a ativa vence');
    // Contrato antigo preservado (campos da turma + unit/teacher).
    assert.ok('name' in by(none.id) && 'unit' in by(none.id) && 'teacher' in by(none.id));
    // Outros endpoints seguem sem os campos novos.
    const one = await http().get(`/api/classes/${none.id}`).set(auth(org.mestre.token)).expect(200);
    assert.ok(!('nextLesson' in one.body));
  });

  it('isolamento: nao enxerga aulas de outro grupo e a pagina vazia nao quebra', async () => {
    const empty = await http().get('/api/classes').query({ q: 'zzz-nao-existe-zzz' }).set(auth(org.mestre.token)).expect(200);
    assert.deepEqual(empty.body, []);
  });

  it('mudar professor/horario/unidade da turma repassa as aulas FUTURAS ATIVAS que ainda tem o valor antigo (cancelada, passada e aula editada a mao ficam)', async () => {
    const teacherA = org.professor.userId;
    const teacherB = org.mestre.userId;
    const klass = await cls('Sync', {
      weekday: 4,
      startTime: '20:00',
      endTime: '21:00',
      teacherUserId: teacherA,
      unitId: org.unitA.id,
      autoGenerateLessons: false,
    });
    const copy = { startTime: '20:00', endTime: '21:00', teacherUserId: teacherA, unitId: org.unitA.id };
    const future = await lesson(klass.id, 3, 'ACTIVE', copy);
    const past = await lesson(klass.id, -3, 'ACTIVE', copy);
    const cancelled = await lesson(klass.id, 6, 'INACTIVE', copy);
    const handEdited = await lesson(klass.id, 10, 'ACTIVE', { ...copy, startTime: '18:00', teacherUserId: teacherB });
    const inherit = await lesson(klass.id, 13, 'ACTIVE'); // sem valores proprios: herda da turma

    await http()
      .patch(`/api/classes/${klass.id}`)
      .set(auth(org.mestre.token))
      .send({ startTime: '20:30', endTime: '21:30', teacherUserId: teacherB, unitId: org.unitB.id })
      .expect(200);

    const row = (id: number) => prisma.lesson.findUniqueOrThrow({ where: { id } });
    const f = await row(future.id);
    assert.deepEqual([f.startTime, f.endTime, f.teacherUserId, f.unitId], ['20:30', '21:30', teacherB, org.unitB.id]);
    const p = await row(past.id);
    assert.deepEqual([p.startTime, p.endTime, p.teacherUserId, p.unitId], ['20:00', '21:00', teacherA, org.unitA.id], 'passada intacta');
    const c = await row(cancelled.id);
    assert.deepEqual([c.startTime, c.teacherUserId], ['20:00', teacherA], 'cancelada intacta');
    const h = await row(handEdited.id);
    assert.deepEqual([h.startTime, h.endTime, h.teacherUserId], ['18:00', '21:30', teacherB], 'valor editado a mao fica; o que ainda era o antigo (fim) acompanha');
    const i = await row(inherit.id);
    assert.deepEqual([i.startTime, i.endTime, i.teacherUserId, i.unitId], [null, null, null, null], 'sem valor proprio continua herdando');
  });
});
