import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { MESTRE_EMAIL, loginAs } from './utils/list-helpers';
import { MeFixture, createMeFixture } from './utils/me-fixtures';

/**
 * Eventos: vagas, lista de espera, preço, status e cancelamento com notificação.
 * Eventos são criados direto no banco (PUBLISHED sem broadcast de "Novo evento" para o seed); a criação pela API usa
 * DRAFT (não notifica). Tudo que o spec cria é apagado no after().
 */
describe('Eventos: vagas, lista de espera e status (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let fx: MeFixture;
  let mestreToken: string;
  const eventIds: number[] = [];
  const TAG = `[e2e-cap] ${Date.now()}`;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

  const newEvent = async (data: Record<string, unknown>) => {
    const e = await prisma.event.create({
      data: { organizationId: fx.organizationId, title: `${TAG} ${eventIds.length}`, date: inDays(10), ...data },
    });
    eventIds.push(e.id);
    return e;
  };
  const join = (eventId: number, token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/api/events/${eventId}/participants`).set(auth(token)).send(body);

  before(async () => {
    app = await createTestApp();
    fx = await createMeFixture(app, prisma, 'evcap');
    mestreToken = (await loginAs(app, MESTRE_EMAIL)).token;
  });

  after(async () => {
    await prisma.auditLog.deleteMany({ where: { resource: 'event', resourceId: { in: eventIds.map(String) } } });
    await prisma.eventParticipant.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await fx.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('criação pela API guarda vagas, preço e prazo; rascunho fica oculto para o aluno (404) e visível para a equipe', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/events')
      .set(auth(mestreToken))
      .send({
        title: `${TAG} draft`,
        date: inDays(20).toISOString(),
        capacity: 30,
        priceCents: 15000,
        status: 'DRAFT',
        registrationDeadline: inDays(15).toISOString(),
      })
      .expect(201);
    eventIds.push(res.body.id);
    assert.equal(res.body.capacity, 30);
    assert.equal(res.body.priceCents, 15000);
    assert.equal(res.body.status, 'DRAFT');
    await request(app.getHttpServer()).get(`/api/events/${res.body.id}`).set(auth(fx.self.token)).expect(404);
    await request(app.getHttpServer()).get(`/api/events/${res.body.id}`).set(auth(mestreToken)).expect(200);
    // prazo depois do início => 400
    await request(app.getHttpServer())
      .post('/api/events')
      .set(auth(mestreToken))
      .send({ title: `${TAG} x`, date: inDays(5).toISOString(), status: 'DRAFT', registrationDeadline: inDays(6).toISOString() })
      .expect(400);
  });

  it('lotado => 409 EVENT_FULL; joinWaitlist => WAITLIST; sair promove o primeiro da fila e avisa', async () => {
    const event = await newEvent({ capacity: 1 });
    const a = await join(event.id, fx.self.token, { studentId: fx.self.studentId }).expect(201);
    assert.equal(a.body.status, 'CONFIRMED');

    const full = await join(event.id, fx.guardian.token, { studentId: fx.guardian.dependentId }).expect(409);
    assert.equal(full.body.code, 'EVENT_FULL');
    assert.equal(await prisma.eventParticipant.count({ where: { eventId: event.id } }), 1);

    const w = await join(event.id, fx.guardian.token, { studentId: fx.guardian.dependentId, joinWaitlist: true }).expect(201);
    assert.equal(w.body.status, 'WAITLIST');
    const again = await join(event.id, fx.guardian.token, { studentId: fx.guardian.dependentId, joinWaitlist: true }).expect(201);
    assert.equal(again.body.id, w.body.id, 'idempotente');

    const list = await request(app.getHttpServer()).get(`/api/events?q=${encodeURIComponent(event.title)}`).set(auth(fx.self.token)).expect(200);
    const item = list.body[0];
    assert.equal(item.confirmedCount, 1);
    assert.equal(item.waitlistCount, 1);
    assert.equal(item.spotsLeft, 0);
    assert.equal(item.myParticipation.status, 'CONFIRMED');

    await request(app.getHttpServer()).delete(`/api/events/${event.id}/participants/${a.body.id}`).set(auth(fx.self.token)).expect(200);
    const promoted = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: w.body.id } });
    assert.equal(promoted.status, 'CONFIRMED');
    assert.equal(await prisma.notification.count({ where: { userId: fx.guardian.userId, type: 'EVENT_WAITLIST_PROMOTED' } }), 1);
  });

  it('prazo vencido (aluno) => 409; a equipe ainda inscreve', async () => {
    const event = await newEvent({ registrationDeadline: inDays(-1), date: inDays(3) });
    await join(event.id, fx.self.token, { studentId: fx.self.studentId }).expect(409);
    await join(event.id, mestreToken, { studentId: fx.self.studentId }).expect(201);
  });

  it('cancelar o evento notifica os inscritos (e grava auditoria) e fecha novas inscrições', async () => {
    const event = await newEvent({ capacity: 5 });
    await join(event.id, fx.self.token, { studentId: fx.self.studentId }).expect(201);
    await request(app.getHttpServer())
      .patch(`/api/events/${event.id}`)
      .set(auth(mestreToken))
      .send({ status: 'CANCELLED' })
      .expect(200);
    const n = await prisma.notification.findFirst({ where: { userId: fx.self.userId, type: 'EVENT_CANCELLED' } });
    assert.ok(n, 'inscrito notificado');
    assert.equal(await prisma.notification.count({ where: { userId: fx.orphan.userId, type: 'EVENT_CANCELLED' } }), 0);
    assert.equal(await prisma.auditLog.count({ where: { action: 'EVENT_CANCEL', resourceId: String(event.id) } }), 1);
    await join(event.id, fx.guardian.token, { studentId: fx.guardian.dependentId }).expect(409);
  });
});
