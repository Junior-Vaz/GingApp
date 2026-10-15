import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { FinanceOverdueService } from '../src/interface/http/finance/finance-overdue.service';
import { NotificationsService } from '../src/interface/http/notifications/notifications.service';
import { DEV_PASSWORD, MESTRE_EMAIL, SecondOrg, createSecondOrg, loginAs, todaySaoPaulo } from './utils/list-helpers';
import { MeFixture, createMeFixture } from './utils/me-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * E09 — gatilhos de notificação in-app (src/interface/http/notifications/notifications.service.ts é o
 * SSOT de produção; os gatilhos vivem em lessons/graduations/events/rodas/finance).
 *
 * Fixture (utils/me-fixtures): na org do seed — `self` (ALUNO com Student próprio, matriculado em
 * classMine), `guardian` (RESPONSAVEL do dependente, também matriculado em classMine), `orphan` (ALUNO
 * sem vínculo), `stranger` (aluno SEM login, matriculado em classOther). Mensalidades vencidas rodam
 * numa SEGUNDA organização isolada (números exatos, sem tocar nos lançamentos do seed).
 * Tudo que gera notificação para usuários do seed leva o marcador "[e2e-trig]" no texto e é apagado no after().
 */
const TAG = '[e2e-trig]';
const DAY = 86_400_000;

describe('Gatilhos de notificação (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let notifications: NotificationsService;
  let overdueService: FinanceOverdueService;
  let mestre: { token: string; userId: number; organizationId: number };
  let fixture: MeFixture;
  let orgB: SecondOrg;
  let professorToken: string;
  let inactiveMemberId: number;

  const extraUserIds: number[] = [];
  const lessonIds: number[] = [];
  const eventIds: number[] = [];
  const rodaIds: number[] = [];
  const unitIds: number[] = [];
  let systemId: number;
  let levelId: number;
  const bStudentIds: number[] = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const count = (userId: number, type: string) => prisma.notification.count({ where: { userId, type } });
  const last = (userId: number, type: string) =>
    prisma.notification.findFirstOrThrow({ where: { userId, type }, orderBy: { id: 'desc' } });
  const futureDay = (n: number) => todaySaoPaulo(n);

  async function makeUser(organizationId: number, role: OrgRole, kind: string, status = 'ACTIVE') {
    const email = `${kind}-${Date.now()}${Math.floor(Math.random() * 1000)}@e2e-trig.local`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(DEV_PASSWORD, 4),
        name: `E2E trig ${kind}`,
        userType: 'MEMBER',
        status: 'ACTIVE',
      },
    });
    extraUserIds.push(user.id);
    await prisma.organizationUser.create({ data: { organizationId, userId: user.id, role, status } });
    return { id: user.id, email };
  }

  async function newLesson(classId: number, date: string, extra: Record<string, unknown> = {}) {
    const res = await request(app.getHttpServer())
      .post('/api/lessons')
      .set(auth(mestre.token))
      .send({ classId, date, startTime: '19:00', endTime: '20:00', ...extra })
      .expect(201);
    lessonIds.push(res.body.id);
    return res.body as { id: number };
  }

  const patchLesson = (id: number, body: Record<string, unknown>, token = mestre.token) =>
    request(app.getHttpServer()).patch(`/api/lessons/${id}`).set(auth(token)).send(body);

  before(async () => {
    app = await createTestApp();
    notifications = app.get(NotificationsService);
    overdueService = app.get(FinanceOverdueService);
    mestre = await loginAs(app, MESTRE_EMAIL);
    fixture = await createMeFixture(app, prisma, 'trig');
    orgB = await createSecondOrg(app, prisma, 'trig');

    const professor = await makeUser(mestre.organizationId, OrgRole.PROFESSOR, 'prof');
    professorToken = (await loginAs(app, professor.email)).token;
    inactiveMemberId = (await makeUser(mestre.organizationId, OrgRole.ALUNO, 'inativo', 'INACTIVE')).id;

    const system = await prisma.graduationSystem.create({
      data: { organizationId: mestre.organizationId, name: `${TAG} sistema` },
    });
    systemId = system.id;
    levelId = (
      await prisma.graduationLevel.create({
        data: {
          organizationId: mestre.organizationId,
          graduationSystemId: system.id,
          name: `Cordão Verde ${TAG}`,
          order: 1,
        },
      })
    ).id;
  });

  after(async () => {
    const studentIds = [fixture.self.studentId, fixture.guardian.dependentId, fixture.strangerId];
    await prisma.studentGraduation.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.graduationLevel.deleteMany({ where: { id: levelId } });
    await prisma.graduationSystem.deleteMany({ where: { id: systemId } });
    await prisma.lesson.deleteMany({ where: { id: { in: lessonIds } } });
    await prisma.eventParticipant.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.rodaParticipant.deleteMany({ where: { rodaId: { in: rodaIds } } });
    await prisma.roda.deleteMany({ where: { id: { in: rodaIds } } });
    await prisma.student.updateMany({ where: { id: { in: studentIds } }, data: { unitId: null } });
    await prisma.unit.deleteMany({ where: { id: { in: unitIds } } });
    // Notificações dos gatilhos de broadcast chegam a TODOS os membros do seed: apaga pelo marcador.
    await prisma.notification.deleteMany({ where: { body: { contains: TAG } } });
    await prisma.notification.deleteMany({ where: { userId: { in: [...extraUserIds, orgB.userId] } } });
    await prisma.financialRecord.deleteMany({ where: { organizationId: orgB.organizationId } });
    await prisma.studentGuardian.deleteMany({ where: { organizationId: orgB.organizationId } });
    await prisma.student.deleteMany({ where: { organizationId: orgB.organizationId } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: extraUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: extraUserIds } } });
    await fixture.cleanup();
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  // -------------------------------------------------------------------------------------------
  describe('aula cancelada / alterada', () => {
    let lessonId: number;
    const date = futureDay(14); // yyyy-MM-dd no futuro (fuso de São Paulo)
    const dateBR = `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

    before(async () => {
      lessonId = (await newLesson(fixture.classMineId, date)).id;
    });

    it('criar a aula NÃO notifica ninguém', async () => {
      for (const u of [fixture.self.userId, fixture.guardian.userId]) {
        assert.equal(await count(u, 'LESSON_CANCELLED'), 0);
        assert.equal(await count(u, 'LESSON_CHANGED'), 0);
      }
    });

    it('editar só observações/professor não notifica', async () => {
      await patchLesson(lessonId, { notes: 'trazer água', teacherUserId: mestre.userId }).expect(200);
      assert.equal(await count(fixture.self.userId, 'LESSON_CHANGED'), 0);
      assert.equal(await count(fixture.self.userId, 'LESSON_CANCELLED'), 0);
    });

    it('mudar o HORÁRIO avisa o aluno e o responsável do dependente (1 cada), e só eles', async () => {
      await patchLesson(lessonId, { startTime: '20:00', endTime: '21:00' }).expect(200);
      for (const u of [fixture.self.userId, fixture.guardian.userId]) {
        assert.equal(await count(u, 'LESSON_CHANGED'), 1, `usuário ${u}`);
      }
      const n = await last(fixture.self.userId, 'LESSON_CHANGED');
      assert.equal(n.title, 'Aula alterada');
      assert.equal(n.organizationId, mestre.organizationId);
      assert.equal(n.readAt, null);
      assert.match(n.body, /E2E trig turma minha/);
      assert.ok(n.body.includes(`${dateBR} às 19:00`), n.body); // de
      assert.ok(n.body.includes(`${dateBR} às 20:00`), n.body); // para
      // Sem vínculo, aluno de outra turma e o próprio MESTRE autor: nada.
      assert.equal(await count(fixture.orphan.userId, 'LESSON_CHANGED'), 0);
      assert.equal(
        await prisma.notification.count({ where: { userId: mestre.userId, type: 'LESSON_CHANGED', body: { contains: 'E2E trig' } } }),
        0,
      );
    });

    it('mudar o DIA avisa (data nova e antiga no texto); repetir o mesmo valor não avisa de novo', async () => {
      const newDate = futureDay(15);
      await patchLesson(lessonId, { date: newDate }).expect(200);
      assert.equal(await count(fixture.self.userId, 'LESSON_CHANGED'), 2);
      const n = await last(fixture.self.userId, 'LESSON_CHANGED');
      assert.ok(n.body.includes(`${newDate.slice(8, 10)}/${newDate.slice(5, 7)}/${newDate.slice(0, 4)}`), n.body);

      await patchLesson(lessonId, { date: newDate, startTime: '20:00' }).expect(200);
      assert.equal(await count(fixture.self.userId, 'LESSON_CHANGED'), 2);
    });

    it('CANCELAR (status INACTIVE) avisa; cancelar de novo e editar aula já cancelada NÃO avisam', async () => {
      await patchLesson(lessonId, { status: 'INACTIVE' }).expect(200);
      for (const u of [fixture.self.userId, fixture.guardian.userId]) {
        assert.equal(await count(u, 'LESSON_CANCELLED'), 1);
      }
      const n = await last(fixture.guardian.userId, 'LESSON_CANCELLED');
      assert.equal(n.title, 'Aula cancelada');
      assert.match(n.body, /cancelada/);

      await patchLesson(lessonId, { status: 'INACTIVE' }).expect(200);
      await patchLesson(lessonId, { startTime: '08:00' }).expect(200);
      assert.equal(await count(fixture.self.userId, 'LESSON_CANCELLED'), 1);
      assert.equal(await count(fixture.self.userId, 'LESSON_CHANGED'), 2);
    });

    it('REATIVAR avisa como "Aula reativada"', async () => {
      await patchLesson(lessonId, { status: 'ACTIVE' }).expect(200);
      assert.equal(await count(fixture.self.userId, 'LESSON_CHANGED'), 3);
      assert.equal((await last(fixture.self.userId, 'LESSON_CHANGED')).title, 'Aula reativada');
    });

    it('PATCH status INACTIVE (cancelar) avisa uma vez', async () => {
      const l = await newLesson(fixture.classMineId, futureDay(20));
      const before = await count(fixture.self.userId, 'LESSON_CANCELLED');
      await request(app.getHttpServer()).patch(`/api/lessons/${l.id}`).set(auth(mestre.token)).send({ status: 'INACTIVE' }).expect(200);
      assert.equal(await count(fixture.self.userId, 'LESSON_CANCELLED'), before + 1);
      await request(app.getHttpServer()).patch(`/api/lessons/${l.id}`).set(auth(mestre.token)).send({ status: 'INACTIVE' }).expect(200);
      assert.equal(await count(fixture.self.userId, 'LESSON_CANCELLED'), before + 1);
    });

    it('aula de OUTRA turma só avisa quem está nela (stranger não tem login: ninguém recebe)', async () => {
      const other = await newLesson(fixture.classOtherId, futureDay(16));
      const total = () =>
        prisma.notification.count({
          where: { userId: { in: [fixture.self.userId, fixture.guardian.userId, fixture.orphan.userId] } },
        });
      const before = await total();
      await patchLesson(other.id, { status: 'INACTIVE' }).expect(200);
      assert.equal(await total(), before);
    });

    it('matrícula INACTIVE e aluno INACTIVE não recebem; o responsável do outro dependente ainda recebe', async () => {
      await prisma.classStudent.updateMany({
        where: { classId: fixture.classMineId, studentId: fixture.self.studentId },
        data: { status: 'INACTIVE' },
      });
      const l = await newLesson(fixture.classMineId, futureDay(21));
      const selfBefore = await count(fixture.self.userId, 'LESSON_CANCELLED');
      const guardianBefore = await count(fixture.guardian.userId, 'LESSON_CANCELLED');
      await patchLesson(l.id, { status: 'INACTIVE' }).expect(200);
      assert.equal(await count(fixture.self.userId, 'LESSON_CANCELLED'), selfBefore);
      assert.equal(await count(fixture.guardian.userId, 'LESSON_CANCELLED'), guardianBefore + 1);

      // Reativa a matrícula, mas o ALUNO fica inativo: também não recebe.
      await prisma.classStudent.updateMany({
        where: { classId: fixture.classMineId, studentId: fixture.self.studentId },
        data: { status: 'ACTIVE' },
      });
      await prisma.student.update({ where: { id: fixture.self.studentId }, data: { status: 'INACTIVE' } });
      const l2 = await newLesson(fixture.classMineId, futureDay(22));
      await patchLesson(l2.id, { status: 'INACTIVE' }).expect(200);
      assert.equal(await count(fixture.self.userId, 'LESSON_CANCELLED'), selfBefore);
      await prisma.student.update({ where: { id: fixture.self.studentId }, data: { status: 'ACTIVE' } });
    });

    it('aula que já passou (dia civil anterior a hoje) cancelada NÃO avisa', async () => {
      const past = await newLesson(fixture.classMineId, todaySaoPaulo(-3));
      const before = await count(fixture.self.userId, 'LESSON_CANCELLED');
      await patchLesson(past.id, { status: 'INACTIVE' }).expect(200);
      assert.equal(await count(fixture.self.userId, 'LESSON_CANCELLED'), before);
    });

    it('multi-tenant: MESTRE de outro grupo não altera nem notifica (404); notificações ficam só com os vinculados', async () => {
      const l = await newLesson(fixture.classMineId, futureDay(25));
      const before = await prisma.notification.count({ where: { userId: fixture.self.userId } });
      await patchLesson(l.id, { status: 'INACTIVE' }, orgB.token).expect(404);
      await request(app.getHttpServer()).delete(`/api/lessons/${l.id}`).set(auth(orgB.token)).expect(404);
      assert.equal((await prisma.lesson.findUniqueOrThrow({ where: { id: l.id } })).status, 'ACTIVE');
      assert.equal(await prisma.notification.count({ where: { userId: fixture.self.userId } }), before);
      // Nenhuma notificação de aula foi parar em usuário da org B.
      assert.equal(await prisma.notification.count({ where: { userId: orgB.userId } }), 0);
    });

    it('o aluno enxerga a notificação na API do app (GET /notifications) e as de outro usuário não vazam', async () => {
      const mine = await request(app.getHttpServer()).get('/api/notifications?limit=100').set(auth(fixture.self.token)).expect(200);
      const types = (mine.body as Array<{ type: string }>).map((n) => n.type);
      assert.ok(types.includes('LESSON_CANCELLED'));
      assert.ok(types.includes('LESSON_CHANGED'));

      const orphan = await request(app.getHttpServer()).get('/api/notifications?limit=100').set(auth(fixture.orphan.token)).expect(200);
      assert.equal((orphan.body as Array<{ type: string }>).filter((n) => n.type.startsWith('LESSON_')).length, 0);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('graduação registrada', () => {
    const post = (studentId: number, body: Record<string, unknown>, token = mestre.token) =>
      request(app.getHttpServer()).post(`/api/graduations/students/${studentId}`).set(auth(token)).send(body);

    it('notifica o próprio aluno (1) e mais ninguém; texto traz nível e data', async () => {
      await post(fixture.self.studentId, { graduationLevelId: levelId, graduatedAt: '2026-10-10' }).expect(201);
      assert.equal(await count(fixture.self.userId, 'GRADUATION'), 1);
      const n = await last(fixture.self.userId, 'GRADUATION');
      assert.equal(n.title, 'Nova graduação');
      assert.ok(n.body.includes(`Cordão Verde ${TAG}`), n.body);
      assert.ok(n.body.includes('10/10/2026'), n.body);
      assert.equal(await count(fixture.guardian.userId, 'GRADUATION'), 0);
      assert.equal(await count(fixture.orphan.userId, 'GRADUATION'), 0);
    });

    it('graduar um DEPENDENTE avisa o responsável (e não o aluno self)', async () => {
      await post(fixture.guardian.dependentId, { graduationLevelId: levelId, graduatedAt: '2026-10-11' }).expect(201);
      assert.equal(await count(fixture.guardian.userId, 'GRADUATION'), 1);
      assert.equal(await count(fixture.self.userId, 'GRADUATION'), 1);
    });

    it('aluno sem login nem responsável: registra (201) e ninguém é notificado', async () => {
      const before = await prisma.notification.count({ where: { type: 'GRADUATION' } });
      await post(fixture.strangerId, { graduationLevelId: levelId, graduatedAt: '2026-10-11' }).expect(201);
      assert.equal(await prisma.notification.count({ where: { type: 'GRADUATION' } }), before);
    });

    it('erro de validação (nível inexistente / aluno de outro grupo) não notifica nem grava', async () => {
      const before = await prisma.notification.count({ where: { type: 'GRADUATION' } });
      const gradBefore = await prisma.studentGraduation.count({ where: { studentId: fixture.self.studentId } });
      await post(fixture.self.studentId, { graduationLevelId: 999999999, graduatedAt: '2026-10-10' }).expect(400);
      await post(fixture.self.studentId, { graduationLevelId: levelId, graduatedAt: '2026-10-10' }, orgB.token).expect(404);
      assert.equal(await prisma.notification.count({ where: { type: 'GRADUATION' } }), before);
      assert.equal(await prisma.studentGraduation.count({ where: { studentId: fixture.self.studentId } }), gradBefore);
    });

    it('editar a graduação não renotifica', async () => {
      const grad = await prisma.studentGraduation.findFirstOrThrow({ where: { studentId: fixture.self.studentId } });
      await request(app.getHttpServer())
        .patch(`/api/graduations/students/${fixture.self.studentId}/${grad.id}`)
        .set(auth(mestre.token))
        .send({ notes: 'corrigido' })
        .expect(200);
      assert.equal(await count(fixture.self.userId, 'GRADUATION'), 1);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('evento / roda novo no grupo', () => {
    const futureISO = (days: number) => new Date(Date.now() + days * DAY).toISOString();
    const activeMembers = () =>
      prisma.organizationUser.findMany({
        where: { organizationId: mestre.organizationId, status: 'ACTIVE' },
        select: { userId: true },
      });

    async function createEvent(body: Record<string, unknown>) {
      const res = await request(app.getHttpServer())
        .post('/api/events')
        .set(auth(mestre.token))
        .send(body)
        .expect(201);
      eventIds.push(res.body.id);
      return res.body as { id: number };
    }

    it('evento futuro: 1 notificação por MEMBRO ATIVO do grupo (incl. professor, aluno, responsável), 0 para inativo/outro grupo', async () => {
      const title = `Batizado ${TAG} geral`;
      await createEvent({ title, date: futureISO(30), location: 'Quadra central' });

      const members = await activeMembers();
      const rows = await prisma.notification.findMany({ where: { type: 'EVENT', body: { contains: title } } });
      assert.equal(rows.length, members.length);
      assert.deepEqual(
        rows.map((r) => r.userId).sort((a, b) => a - b),
        members.map((m) => m.userId).sort((a, b) => a - b),
      );
      assert.ok(rows.every((r) => r.organizationId === mestre.organizationId && r.title === 'Novo evento'));
      assert.ok(rows[0].body.includes('Quadra central'));
      assert.ok(members.some((m) => m.userId === fixture.self.userId));
      assert.ok(!rows.some((r) => r.userId === inactiveMemberId));
      assert.ok(!rows.some((r) => r.userId === orgB.userId));
    });

    it('evento de UMA UNIDADE: só mestres, quem tem acesso à unidade, alunos da unidade e seus responsáveis', async () => {
      const unit = await prisma.unit.create({ data: { organizationId: mestre.organizationId, name: `${TAG} unidade` } });
      unitIds.push(unit.id);
      await prisma.student.update({ where: { id: fixture.self.studentId }, data: { unitId: unit.id } });

      const title = `Treino especial ${TAG} unidade`;
      await createEvent({ title, date: futureISO(31), unitId: unit.id });

      const got = (await prisma.notification.findMany({ where: { type: 'EVENT', body: { contains: title } } })).map((r) => r.userId);
      assert.ok(got.includes(mestre.userId), 'MESTRE sempre recebe');
      assert.ok(got.includes(fixture.self.userId), 'aluno da unidade recebe');
      assert.ok(!got.includes(fixture.guardian.userId), 'responsável de dependente SEM unidade não recebe');
      assert.ok(!got.includes(fixture.orphan.userId), 'aluno sem unidade não recebe');
      assert.ok(!got.includes(orgB.userId));
    });

    it('evento JÁ PASSADO (cadastro de histórico) não notifica', async () => {
      const title = `Evento antigo ${TAG}`;
      await createEvent({ title, date: futureISO(-5) });
      assert.equal(await prisma.notification.count({ where: { body: { contains: title } } }), 0);
    });

    it('evento inválido (400) não notifica nem cria', async () => {
      const before = await prisma.notification.count({ where: { type: 'EVENT' } });
      await request(app.getHttpServer())
        .post('/api/events')
        .set(auth(mestre.token))
        .send({ title: `Sem data ${TAG}` })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/events')
        .set(auth(mestre.token))
        .send({ title: `Unidade alheia ${TAG}`, date: futureISO(10), unitId: 999999999 })
        .expect(400);
      assert.equal(await prisma.notification.count({ where: { type: 'EVENT' } }), before);
    });

    it('roda futura notifica todos os membros ativos; roda passada não; MESTRE de outro grupo notifica só o grupo dele', async () => {
      const title = `Roda de sexta ${TAG}`;
      const res = await request(app.getHttpServer())
        .post('/api/rodas')
        .set(auth(mestre.token))
        .send({ title, date: futureISO(12), location: 'Praça' })
        .expect(201);
      rodaIds.push(res.body.id);

      const members = await activeMembers();
      const rows = await prisma.notification.findMany({ where: { type: 'RODA', body: { contains: title } } });
      assert.equal(rows.length, members.length);
      assert.ok(rows.every((r) => r.title === 'Nova roda' && r.organizationId === mestre.organizationId));

      const old = await request(app.getHttpServer())
        .post('/api/rodas')
        .set(auth(mestre.token))
        .send({ title: `Roda antiga ${TAG}`, date: futureISO(-2) })
        .expect(201);
      rodaIds.push(old.body.id);
      assert.equal(await prisma.notification.count({ where: { body: { contains: `Roda antiga ${TAG}` } } }), 0);

      const bTitle = `Roda do grupo B ${TAG}`;
      const bRes = await request(app.getHttpServer())
        .post('/api/rodas')
        .set(auth(orgB.token))
        .send({ title: bTitle, date: futureISO(12) })
        .expect(201);
      rodaIds.push(bRes.body.id);
      const bRows = await prisma.notification.findMany({ where: { body: { contains: bTitle } } });
      assert.deepEqual(bRows.map((r) => r.userId), [orgB.userId]); // só o único membro do grupo B
      assert.equal(await prisma.notification.count({ where: { userId: fixture.self.userId, body: { contains: bTitle } } }), 0);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('serviço de notificações (SSOT)', () => {
    it('notifyUsers deduplica usuários e respeita o teto (menores ids primeiro)', async () => {
      const a = fixture.self.userId;
      const b = fixture.guardian.userId;
      const c = fixture.orphan.userId;
      const payload = { title: 'T', body: `${TAG} dedupe`, type: 'E2E_DEDUPE' };
      assert.equal(await notifications.notifyUsers(mestre.organizationId, [a, a, b, b, c], payload), 3);
      assert.equal(await notifications.notifyUsers(mestre.organizationId, [], payload), 0);

      const capped = await notifications.notifyUsers(mestre.organizationId, [c, a, b], { ...payload, type: 'E2E_CAP' }, 2);
      assert.equal(capped, 2);
      const got = (await prisma.notification.findMany({ where: { type: 'E2E_CAP' } })).map((r) => r.userId).sort((x, y) => x - y);
      assert.deepEqual(got, [a, b, c].sort((x, y) => x - y).slice(0, 2));
    });

    it('createMany grava em lotes (1100 linhas = 3 lotes de até 500) e devolve o total', async () => {
      const items = Array.from({ length: 1100 }, () => ({
        organizationId: mestre.organizationId,
        userId: fixture.orphan.userId,
        title: 'lote',
        body: `${TAG} lote`,
        type: 'E2E_CHUNK',
      }));
      assert.equal(await notifications.createMany(items), 1100);
      assert.equal(await count(fixture.orphan.userId, 'E2E_CHUNK'), 1100);
    });

    it('safely devolve 0 em vez de propagar quando o gatilho falha', async () => {
      assert.equal(
        await notifications.safely('teste', async () => {
          throw new Error('boom');
        }),
        0,
      );
      assert.equal(await notifications.safely('ok', async () => 7), 7);
    });

    it('userIdsByStudent não cruza organizações', async () => {
      const map = await notifications.userIdsByStudent(orgB.organizationId, [fixture.self.studentId]);
      assert.equal(map.size, 0);
      const own = await notifications.userIdsByStudent(mestre.organizationId, [
        fixture.self.studentId,
        fixture.guardian.dependentId,
        fixture.strangerId,
      ]);
      assert.deepEqual(own.get(fixture.self.studentId), [fixture.self.userId]);
      assert.deepEqual(own.get(fixture.guardian.dependentId), [fixture.guardian.userId]);
      assert.deepEqual(own.get(fixture.strangerId), []);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('mensalidade vencida (POST /finance/mark-overdue)', () => {
    let bSelf: { id: number; studentId: number };
    let bGuardian: { id: number };
    let bDependentId: number;
    let bStrangerId: number;
    let aRecordId: number;
    const rec = (data: Record<string, unknown>) =>
      prisma.financialRecord.create({
        data: { organizationId: orgB.organizationId, description: `Mensalidade ${TAG}`, amountCents: 15000, ...data } as never,
      });
    const due = (offsetDays: number) => new Date(`${todaySaoPaulo(offsetDays)}T00:00:00.000Z`);
    const status = async (id: number) => (await prisma.financialRecord.findUniqueOrThrow({ where: { id } })).status;
    const overdueCall = (token: string) =>
      request(app.getHttpServer()).post('/api/finance/mark-overdue').set(auth(token));

    const ids: Record<string, number> = {};

    before(async () => {
      const self = await makeUser(orgB.organizationId, OrgRole.ALUNO, 'b-aluno');
      const guardian = await makeUser(orgB.organizationId, OrgRole.RESPONSAVEL, 'b-resp');
      const student = await prisma.student.create({
        data: { organizationId: orgB.organizationId, userId: self.id, name: 'Aluno B' },
      });
      const dependent = await prisma.student.create({ data: { organizationId: orgB.organizationId, name: 'Dependente B' } });
      await prisma.studentGuardian.create({
        data: { organizationId: orgB.organizationId, studentId: dependent.id, userId: guardian.id, name: 'Resp B' },
      });
      const stranger = await prisma.student.create({ data: { organizationId: orgB.organizationId, name: 'Sem login B' } });
      bStudentIds.push(student.id, dependent.id, stranger.id);
      bSelf = { id: self.id, studentId: student.id };
      bGuardian = { id: guardian.id };
      bDependentId = dependent.id;
      bStrangerId = stranger.id;

      ids.vencidoSelf = (await rec({ studentId: student.id, dueDate: due(-1), status: 'PENDING' })).id;
      ids.venceHoje = (await rec({ studentId: student.id, dueDate: due(0), status: 'PENDING' })).id;
      ids.futuro = (await rec({ studentId: student.id, dueDate: due(5), status: 'PENDING' })).id;
      ids.pago = (await rec({ studentId: student.id, dueDate: due(-10), status: 'PAID', paidAt: new Date() })).id;
      ids.cancelado = (await rec({ studentId: student.id, dueDate: due(-5), status: 'CANCELLED' })).id;
      ids.jaOverdue = (await rec({ studentId: student.id, dueDate: due(-20), status: 'OVERDUE' })).id;
      ids.vencidoDependente = (await rec({ studentId: dependent.id, dueDate: due(-3), status: 'PENDING' })).id;
      ids.vencidoSemLogin = (await rec({ studentId: stranger.id, dueDate: due(-2), status: 'PENDING' })).id;
      ids.avulso = (await rec({ dueDate: due(-2), status: 'PENDING', description: `Uniforme ${TAG}` })).id;

      // Lançamento vencido da org A (do fixture): só o MESTRE de A pode mexer nele.
      aRecordId = (
        await prisma.financialRecord.create({
          data: {
            organizationId: mestre.organizationId,
            studentId: fixture.self.studentId,
            description: `Mensalidade A ${TAG}`,
            amountCents: 9900,
            dueDate: due(-30),
            status: 'PENDING',
          },
        })
      ).id;
    });

    it('RBAC: ALUNO e PROFESSOR recebem 403; sem token 401 — nada muda', async () => {
      await overdueCall(fixture.self.token).expect(403);
      await overdueCall(professorToken).expect(403);
      await request(app.getHttpServer()).post('/api/finance/mark-overdue').expect(401);
      assert.equal(await status(ids.vencidoSelf), 'PENDING');
    });

    it('MESTRE do grupo B marca só os PENDING vencidos DELE e não toca na org A', async () => {
      const res = await overdueCall(orgB.token).expect(201);
      // vencidoSelf, vencidoDependente, vencidoSemLogin, avulso
      assert.equal(res.body.marked, 4);
      assert.equal(res.body.hasMore, false);
      // notificações: self (1) + responsável do dependente (1); sem login e avulso: 0.
      assert.equal(res.body.notified, 2);

      assert.equal(await status(ids.vencidoSelf), 'OVERDUE');
      assert.equal(await status(ids.vencidoDependente), 'OVERDUE');
      assert.equal(await status(ids.vencidoSemLogin), 'OVERDUE');
      assert.equal(await status(ids.avulso), 'OVERDUE');
      // Intocados: vence hoje, futuro, pago, cancelado, já atrasado.
      assert.equal(await status(ids.venceHoje), 'PENDING');
      assert.equal(await status(ids.futuro), 'PENDING');
      assert.equal(await status(ids.pago), 'PAID');
      assert.equal(await status(ids.cancelado), 'CANCELLED');
      assert.equal(await status(ids.jaOverdue), 'OVERDUE');
      assert.equal(await status(aRecordId), 'PENDING', 'registro da org A não pode ser alterado pelo grupo B');
    });

    it('notificações corretas: aluno e responsável recebem 1 cada, com descrição, valor e vencimento; ninguém mais', async () => {
      assert.equal(await count(bSelf.id, 'FINANCE_OVERDUE'), 1);
      assert.equal(await count(bGuardian.id, 'FINANCE_OVERDUE'), 1);
      const n = await last(bSelf.id, 'FINANCE_OVERDUE');
      const d = todaySaoPaulo(-1);
      assert.equal(n.title, 'Mensalidade vencida');
      assert.equal(n.organizationId, orgB.organizationId);
      assert.ok(n.body.includes('R$ 150,00'), n.body);
      assert.ok(n.body.includes(`${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`), n.body);
      assert.equal(await count(orgB.userId, 'FINANCE_OVERDUE'), 0);
      assert.equal(await prisma.notification.count({ where: { userId: fixture.self.userId, type: 'FINANCE_OVERDUE' } }), 0);
    });

    it('é IDEMPOTENTE: segunda chamada não marca nem notifica de novo', async () => {
      const res = await overdueCall(orgB.token).expect(201);
      assert.equal(res.body.marked, 0);
      assert.equal(res.body.notified, 0);
      assert.equal(await count(bSelf.id, 'FINANCE_OVERDUE'), 1);
      assert.equal(await count(bGuardian.id, 'FINANCE_OVERDUE'), 1);
    });

    it('um lançamento voltado a PENDING depois (reaberto) e vencido volta a ser marcado/notificado', async () => {
      await prisma.financialRecord.update({ where: { id: ids.vencidoSelf }, data: { status: 'PENDING' } });
      const res = await overdueCall(orgB.token).expect(201);
      assert.equal(res.body.marked, 1);
      assert.equal(res.body.notified, 1);
      assert.equal(await count(bSelf.id, 'FINANCE_OVERDUE'), 2);
    });

    it('fuso: "hoje" é o dia civil de São Paulo (vence hoje às 23h SP não é atrasado; passou da meia-noite SP é)', async () => {
      const day = '2031-06-10';
      const dueToday = await rec({ studentId: bSelf.studentId, dueDate: new Date(`${day}T00:00:00.000Z`), status: 'PENDING' });
      const dueYesterday = await rec({ studentId: bSelf.studentId, dueDate: new Date('2031-06-09T00:00:00.000Z'), status: 'PENDING' });

      // 2031-06-10T02:00Z = 09/06 23:00 em São Paulo (UTC já está em 10/06, SP ainda não): hoje (SP) = 09/06.
      const early = await overdueService.markOverdueAndNotify(orgB.organizationId, new Date('2031-06-10T02:00:00Z'));
      assert.ok(early.marked >= 1);
      assert.equal(await status(dueYesterday.id), 'PENDING', 'vence em 09/06 e ainda é 09/06 em SP => NÃO atrasado');
      assert.equal(await status(dueToday.id), 'PENDING');
      assert.equal(await status(ids.venceHoje), 'OVERDUE', 'vencimento de hoje-real já passou em 2031');

      // 2031-06-10T03:00Z = 10/06 00:00 em SP: agora 09/06 ficou para trás.
      const late = await overdueService.markOverdueAndNotify(orgB.organizationId, new Date('2031-06-10T03:00:00Z'));
      assert.equal(late.marked, 1);
      assert.equal(await status(dueYesterday.id), 'OVERDUE');
      assert.equal(await status(dueToday.id), 'PENDING', 'vence 10/06 e hoje em SP é 10/06 => NÃO atrasado');
    });
  });
});
