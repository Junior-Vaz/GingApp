import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { MESTRE_EMAIL, loginAs } from './utils/list-helpers';
import { MeFixture, createMeFixture } from './utils/me-fixtures';

/**
 * events.service.addParticipant: inscrição de aluno é idempotente (repetir não duplica nem sobe
 * participantsCount); convidado (guestName) grava o userId de quem inscreveu e esse MEMBER consegue
 * cancelar a própria inscrição de convidado; outro MEMBER continua 403.
 */
describe('Eventos: inscrição idempotente e convidado (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let fx: MeFixture;
  let mestreToken: string;
  let eventId: number;
  const title = `[e2e-events-idem] ${Date.now()}`;

  const participants = () => prisma.eventParticipant.findMany({ where: { eventId } });
  const countViaApi = async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/events?q=${encodeURIComponent(title)}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);
    assert.equal(res.body.length, 1);
    return res.body[0].participantsCount as number;
  };

  before(async () => {
    app = await createTestApp();
    fx = await createMeFixture(app, prisma, 'evidem');
    mestreToken = (await loginAs(app, MESTRE_EMAIL)).token;
    eventId = (
      await prisma.event.create({
        data: { organizationId: fx.organizationId, title, date: new Date(Date.now() + 86400000) },
      })
    ).id;
  });

  after(async () => {
    await prisma.eventParticipant.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await fx.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('inscrever o mesmo aluno 3x: 1 linha, mesmo id, participantsCount continua 1', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await request(app.getHttpServer())
        .post(`/api/events/${eventId}/participants`)
        .set('Authorization', `Bearer ${fx.self.token}`)
        .send({ studentId: fx.self.studentId })
        .expect(201);
      ids.push(res.body.id);
    }
    assert.equal(new Set(ids).size, 1);
    assert.equal((await participants()).length, 1);
    assert.equal(await countViaApi(), 1);
  });

  it('convidado: inscrição grava userId do requester (confirmado via Prisma) e participantsCount sobe', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/events/${eventId}/participants`)
      .set('Authorization', `Bearer ${fx.self.token}`)
      .send({ guestName: 'Convidado E2E' })
      .expect(201);
    const row = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: res.body.id } });
    assert.equal(row.userId, fx.self.userId);
    assert.equal(row.studentId, null);
    assert.equal(await countViaApi(), 2);
  });

  it('outro MEMBER não cancela a inscrição do convidado => 403 e a linha continua', async () => {
    const guest = await prisma.eventParticipant.findFirstOrThrow({ where: { eventId, guestName: 'Convidado E2E' } });
    await request(app.getHttpServer())
      .delete(`/api/events/${eventId}/participants/${guest.id}`)
      .set('Authorization', `Bearer ${fx.orphan.token}`)
      .expect(403);
    assert.ok(await prisma.eventParticipant.findUnique({ where: { id: guest.id } }));
  });

  it('o MEMBER que inscreveu o convidado consegue cancelar (200) e a linha some', async () => {
    const guest = await prisma.eventParticipant.findFirstOrThrow({ where: { eventId, guestName: 'Convidado E2E' } });
    await request(app.getHttpServer())
      .delete(`/api/events/${eventId}/participants/${guest.id}`)
      .set('Authorization', `Bearer ${fx.self.token}`)
      .expect(200);
    assert.equal(await prisma.eventParticipant.findUnique({ where: { id: guest.id } }), null);
    assert.equal(await countViaApi(), 1);
  });
});
