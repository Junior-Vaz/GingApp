import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { buildCheckinToken } from '../src/shared/checkin/checkin-token';
import { createTestApp } from './utils/test-app';
import { MESTRE_EMAIL, SecondOrg, createSecondOrg, loginAs, todaySaoPaulo } from './utils/list-helpers';
import { MeFixture, createMeFixture } from './utils/me-fixtures';

/**
 * Check-in por QR: o ALUNO marca a própria presença em evento (POST /events/:id/checkin-self) e em aula
 * (POST /attendance/self-checkin). Eventos/aulas são criados no banco e removidos no after().
 */
describe('Check-in por QR (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let fx: MeFixture;
  let orgB: SecondOrg;
  let mestreToken: string;
  const eventIds: number[] = [];
  const lessonIds: number[] = [];
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);

  const newEvent = async (date: Date) => {
    const e = await prisma.event.create({ data: { organizationId: fx.organizationId, title: `[e2e-checkin] ${Date.now()}`, date } });
    eventIds.push(e.id);
    return e;
  };
  const checkinEvent = (eventId: number, token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/api/events/${eventId}/checkin-self`).set(auth(token)).send(body);
  const selfCheckin = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/attendance/self-checkin').set(auth(token)).send(body);

  before(async () => {
    app = await createTestApp();
    fx = await createMeFixture(app, prisma, 'qr');
    orgB = await createSecondOrg(app, prisma, 'qr');
    mestreToken = (await loginAs(app, MESTRE_EMAIL)).token;
  });

  after(async () => {
    await prisma.auditLog.deleteMany({
      where: { action: { in: ['EVENT_CHECKIN_SELF', 'LESSON_CHECKIN_SELF'] }, resourceId: { in: [...eventIds, ...lessonIds].map(String) } },
    });
    await prisma.eventParticipant.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await fx.cleanup(); // apaga aulas, frequências e matrículas da fixture
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  describe('evento', () => {
    it('feliz: staff gera o QR; aluno inscrito faz check-in => ATTENDED, auditoria e notificação; repetir é idempotente', async () => {
      const event = await newEvent(hoursFromNow(1));
      const issued = await request(app.getHttpServer()).get(`/api/events/${event.id}/checkin-token`).set(auth(mestreToken)).expect(200);
      assert.match(issued.body.token, /^E\d+-[A-Z2-9]{10}$/);
      assert.match(issued.body.qrDataUrl, /^data:image\/png;base64,/);
      // aluno não gera token (sem events.edit)
      await request(app.getHttpServer()).get(`/api/events/${event.id}/checkin-token`).set(auth(fx.self.token)).expect(403);

      const p = await prisma.eventParticipant.create({
        data: { organizationId: fx.organizationId, eventId: event.id, studentId: fx.self.studentId, status: 'CONFIRMED' },
      });
      const ok = await checkinEvent(event.id, fx.self.token, { token: issued.body.token }).expect(200);
      assert.equal(ok.body.alreadyCheckedIn, false);
      assert.equal((await prisma.eventParticipant.findUniqueOrThrow({ where: { id: p.id } })).status, 'ATTENDED');
      assert.equal(await prisma.auditLog.count({ where: { action: 'EVENT_CHECKIN_SELF', resourceId: String(event.id) } }), 1);
      assert.equal(await prisma.notification.count({ where: { userId: fx.self.userId, type: 'EVENT_CHECKIN' } }), 1);

      const again = await checkinEvent(event.id, fx.self.token, { token: issued.body.token }).expect(200);
      assert.equal(again.body.alreadyCheckedIn, true);
      assert.equal(await prisma.auditLog.count({ where: { action: 'EVENT_CHECKIN_SELF', resourceId: String(event.id) } }), 1);
    });

    it('erros: token inválido 400; fora da janela 409; não inscrito 403; evento de outro grupo 404', async () => {
      const event = await newEvent(hoursFromNow(1));
      const good = buildCheckinToken('E', event.id, fx.organizationId);
      await prisma.eventParticipant.create({
        data: { organizationId: fx.organizationId, eventId: event.id, studentId: fx.guardian.dependentId, status: 'CONFIRMED' },
      });
      await checkinEvent(event.id, fx.guardian.token, { token: 'E999-AAAAAAAAAA' }).expect(400);
      await checkinEvent(event.id, fx.guardian.token, { token: buildCheckinToken('E', event.id, orgB.organizationId) }).expect(400);
      // dentro da janela mas sem inscrição
      await checkinEvent(event.id, fx.self.token, { token: good }).expect(403);

      const past = await newEvent(hoursFromNow(-48));
      await prisma.eventParticipant.create({
        data: { organizationId: fx.organizationId, eventId: past.id, studentId: fx.self.studentId, status: 'CONFIRMED' },
      });
      await checkinEvent(past.id, fx.self.token, { token: buildCheckinToken('E', past.id, fx.organizationId) }).expect(409);

      // outro grupo: o evento não existe para ele
      await checkinEvent(event.id, orgB.token, { token: good }).expect(404);
    });

    it('lista de espera não faz check-in (409)', async () => {
      const event = await newEvent(hoursFromNow(1));
      await prisma.eventParticipant.create({
        data: { organizationId: fx.organizationId, eventId: event.id, studentId: fx.self.studentId, status: 'WAITLIST' },
      });
      await checkinEvent(event.id, fx.self.token, { token: buildCheckinToken('E', event.id, fx.organizationId) }).expect(409);
    });
  });

  describe('aula', () => {
    const makeLesson = async (classId: number, startTime: string | null) => {
      const l = await prisma.lesson.create({
        data: {
          organizationId: fx.organizationId,
          classId,
          date: new Date(`${todaySaoPaulo(0)}T00:00:00.000Z`),
          startTime,
          endTime: startTime ? '23:59' : null,
        },
      });
      lessonIds.push(l.id);
      return l;
    };

    it('feliz: staff gera o QR da aula; aluno matriculado registra presença (dependente via studentId); idempotente', async () => {
      const lesson = await makeLesson(fx.classMineId, null); // sem horário = dia inteiro
      const issued = await request(app.getHttpServer())
        .get(`/api/attendance/lessons/${lesson.id}/checkin-token`)
        .set(auth(mestreToken))
        .expect(200);
      assert.match(issued.body.token, /^L\d+-[A-Z2-9]{10}$/);

      const ok = await selfCheckin(fx.self.token, { token: issued.body.token }).expect(200);
      assert.equal(ok.body.alreadyCheckedIn, false);
      const row = await prisma.attendance.findUniqueOrThrow({
        where: { lessonId_studentId: { lessonId: lesson.id, studentId: fx.self.studentId } },
      });
      assert.equal(row.present, true);
      const again = await selfCheckin(fx.self.token, { token: issued.body.token }).expect(200);
      assert.equal(again.body.alreadyCheckedIn, true);
      assert.equal(await prisma.auditLog.count({ where: { action: 'LESSON_CHECKIN_SELF', resourceId: String(lesson.id) } }), 1);

      // responsável marca o dependente (matriculado na mesma turma)
      await selfCheckin(fx.guardian.token, { token: issued.body.token, studentId: fx.guardian.dependentId }).expect(200);
      assert.equal(
        (await prisma.attendance.findUniqueOrThrow({ where: { lessonId_studentId: { lessonId: lesson.id, studentId: fx.guardian.dependentId } } })).present,
        true,
      );
    });

    it('erros: token inválido 400; turma onde não está matriculado 403; aula de outro grupo 404; fora da janela 409', async () => {
      const lesson = await makeLesson(fx.classOtherId, null); // só o "alheio" está matriculado
      const good = buildCheckinToken('L', lesson.id, fx.organizationId);
      await selfCheckin(fx.self.token, { token: 'L99999999-AAAAAAAAAA' }).expect(404);
      await selfCheckin(fx.self.token, { token: buildCheckinToken('L', lesson.id, orgB.organizationId) }).expect(400);
      await selfCheckin(fx.self.token, { token: good }).expect(403);
      // outro grupo usando o token real de uma aula que não é dele
      await selfCheckin(orgB.token, { token: good }).expect(404);

      const early = await makeLesson(fx.classMineId, '00:00');
      // janela de 00:00 até 23:59 + 2h: para forçar "fora da janela", usa aula de ontem
      await prisma.lesson.update({ where: { id: early.id }, data: { date: new Date(`${todaySaoPaulo(-3)}T00:00:00.000Z`) } });
      await selfCheckin(fx.self.token, { token: buildCheckinToken('L', early.id, fx.organizationId) }).expect(409);
    });
  });
});
