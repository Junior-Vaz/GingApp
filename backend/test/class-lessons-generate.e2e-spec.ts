import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { DEV_PASSWORD, MESTRE_EMAIL, SecondOrg, createSecondOrg, loginAs } from './utils/list-helpers';
import { MeFixture, createMeFixture } from './utils/me-fixtures';
import { createTestApp } from './utils/test-app';
import { ClassesService, GENERATE_LESSONS_LOCK_NS } from '../src/interface/http/classes/classes.service';

/**
 * E06 — professor responsável da turma + POST /classes/:id/generate-lessons
 * (src/interface/http/classes/classes.service.ts).
 *
 * Datas do teste (calendário real, conferido): 2026-11-03/10/17/24 e 2026-12-01/08/15 são TERÇAS
 * (weekday 2); 2026-11-01 e 2026-11-08 são DOMINGOS (weekday 0). Aula = data civil gravada como
 * meia-noite UTC — o teste lê o banco e compara o ISO UTC, independente do fuso da máquina.
 *
 * Fixtures: turmas "[e2e-gen]" apagadas (com suas aulas) no after(); usuários extras também.
 */
describe('Turma: professor responsável + geração de aulas (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestre: { token: string; userId: number; organizationId: number };
  let professor: { token: string; userId: number };
  let fixture: MeFixture;
  let orgB: SecondOrg;
  let inactiveProfessorUserId: number;
  const classIds: number[] = [];
  const extraUserIds: number[] = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const iso = (d: Date) => d.toISOString();

  async function createClass(body: Record<string, unknown>, token = mestre.token) {
    const res = await request(app.getHttpServer())
      .post('/api/classes')
      .set(auth(token))
      .send({ name: '[e2e-gen] Turma', autoGenerateLessons: false, ...body }) // sem geracao rolante: estes testes contam aulas do periodo manual
      .expect(201);
    classIds.push(res.body.id);
    return res.body as { id: number };
  }

  const generate = (classId: number, from: string, to: string, token = mestre.token) =>
    request(app.getHttpServer()).post(`/api/classes/${classId}/generate-lessons`).set(auth(token)).send({ from, to });

  const lessonDates = async (classId: number) =>
    (await prisma.lesson.findMany({ where: { classId }, orderBy: { date: 'asc' } })).map((l) => iso(l.date).slice(0, 10));

  before(async () => {
    app = await createTestApp();
    mestre = await loginAs(app, MESTRE_EMAIL);
    fixture = await createMeFixture(app, prisma, 'gen');
    orgB = await createSecondOrg(app, prisma, 'gen');

    // PROFESSOR próprio da suíte (o do seed pode ter a senha trocada por outras suítes).
    const profEmail = `prof-gen-${Date.now()}@e2e-gen.local`;
    const prof = await prisma.user.create({
      data: {
        email: profEmail,
        passwordHash: await bcrypt.hash(DEV_PASSWORD, 4),
        name: 'Professor E2E gen',
        userType: 'MEMBER',
        status: 'ACTIVE',
      },
    });
    extraUserIds.push(prof.id);
    await prisma.organizationUser.create({
      data: { organizationId: mestre.organizationId, userId: prof.id, role: OrgRole.PROFESSOR, status: 'ACTIVE' },
    });
    professor = { token: (await loginAs(app, profEmail)).token, userId: prof.id };

    const inactive = await prisma.user.create({
      data: {
        email: `prof-inativo-gen-${Date.now()}@e2e-gen.local`,
        passwordHash: await bcrypt.hash(DEV_PASSWORD, 4),
        name: 'Professor Inativo E2E',
        userType: 'MEMBER',
        status: 'ACTIVE',
      },
    });
    extraUserIds.push(inactive.id);
    inactiveProfessorUserId = inactive.id;
    await prisma.organizationUser.create({
      data: { organizationId: mestre.organizationId, userId: inactive.id, role: OrgRole.PROFESSOR, status: 'INACTIVE' },
    });
  });

  after(async () => {
    await prisma.lesson.deleteMany({ where: { classId: { in: classIds } } });
    await prisma.class.deleteMany({ where: { id: { in: classIds } } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: extraUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: extraUserIds } } });
    await fixture.cleanup();
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  describe('professor responsável', () => {
    it('POST /classes grava teacherUserId de um PROFESSOR ativo do grupo (conferido via Prisma)', async () => {
      const created = await createClass({ teacherUserId: professor.userId });
      const row = await prisma.class.findUnique({ where: { id: created.id } });
      assert.equal(row?.teacherUserId, professor.userId);
    });

    it('rejeita (400, nada gravado) ALUNO, membro de outro grupo, membership inativa e id inexistente', async () => {
      const before = await prisma.class.count();
      for (const teacherUserId of [fixture.orphan.userId, orgB.userId, inactiveProfessorUserId, 999999999]) {
        const res = await request(app.getHttpServer())
          .post('/api/classes')
          .set(auth(mestre.token))
          .send({ name: '[e2e-gen] invalido', teacherUserId });
        assert.equal(res.status, 400, `teacherUserId=${teacherUserId} deveria ser 400`);
        assert.match(JSON.stringify(res.body), /Professor inválido/);
      }
      assert.equal(await prisma.class.count(), before);
    });

    it('PATCH troca o professor, rejeita inválido (400, mantém o anterior) e null remove', async () => {
      const created = await createClass({ teacherUserId: professor.userId });

      await request(app.getHttpServer())
        .patch(`/api/classes/${created.id}`)
        .set(auth(mestre.token))
        .send({ teacherUserId: orgB.userId })
        .expect(400);
      assert.equal((await prisma.class.findUnique({ where: { id: created.id } }))?.teacherUserId, professor.userId);

      await request(app.getHttpServer())
        .patch(`/api/classes/${created.id}`)
        .set(auth(mestre.token))
        .send({ teacherUserId: mestre.userId })
        .expect(200);
      assert.equal((await prisma.class.findUnique({ where: { id: created.id } }))?.teacherUserId, mestre.userId);

      await request(app.getHttpServer())
        .patch(`/api/classes/${created.id}`)
        .set(auth(mestre.token))
        .send({ teacherUserId: null })
        .expect(200);
      assert.equal((await prisma.class.findUnique({ where: { id: created.id } }))?.teacherUserId, null);
    });

    it('PATCH de outro campo não mexe no professor (undefined mantém)', async () => {
      const created = await createClass({ teacherUserId: professor.userId });
      await request(app.getHttpServer())
        .patch(`/api/classes/${created.id}`)
        .set(auth(mestre.token))
        .send({ description: 'nova' })
        .expect(200);
      assert.equal((await prisma.class.findUnique({ where: { id: created.id } }))?.teacherUserId, professor.userId);
    });
  });

  describe('POST /classes/:id/generate-lessons', () => {
    let classId: number;

    before(async () => {
      // Terça 19:00-20:30, com professor responsável.
      classId = (await createClass({ weekday: 2, startTime: '19:00', endTime: '20:30', teacherUserId: professor.userId })).id;
    });

    it('gera uma aula por TERÇA do período, copiando horário/professor/unidade, em meia-noite UTC', async () => {
      const res = await generate(classId, '2026-11-01', '2026-11-30').expect(201);
      assert.equal(res.body.occurrences, 4);
      assert.equal(res.body.created, 4);
      assert.equal(res.body.ignored, 0);
      assert.deepEqual(res.body.createdDates, ['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24']);

      const lessons = await prisma.lesson.findMany({ where: { classId }, orderBy: { date: 'asc' } });
      assert.deepEqual(lessons.map((l) => iso(l.date)), [
        '2026-11-03T00:00:00.000Z',
        '2026-11-10T00:00:00.000Z',
        '2026-11-17T00:00:00.000Z',
        '2026-11-24T00:00:00.000Z',
      ]);
      for (const l of lessons) {
        assert.equal(l.organizationId, mestre.organizationId);
        assert.equal(l.startTime, '19:00');
        assert.equal(l.endTime, '20:30');
        assert.equal(l.teacherUserId, professor.userId);
        assert.equal(l.status, 'ACTIVE');
        assert.equal(l.unitId, null);
      }
    });

    it('é IDEMPOTENTE: repetir não duplica (created 0 / ignored 4) e estender o período cria só as novas', async () => {
      const again = await generate(classId, '2026-11-01', '2026-11-30').expect(201);
      assert.equal(again.body.created, 0);
      assert.equal(again.body.ignored, 4);
      assert.deepEqual(again.body.ignoredDates, ['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24']);
      assert.equal(await prisma.lesson.count({ where: { classId } }), 4);

      const wider = await generate(classId, '2026-11-01', '2026-12-08').expect(201);
      assert.equal(wider.body.occurrences, 6);
      assert.equal(wider.body.created, 2);
      assert.equal(wider.body.ignored, 4);
      assert.deepEqual(wider.body.createdDates, ['2026-12-01', '2026-12-08']);
      assert.equal(await prisma.lesson.count({ where: { classId } }), 6);
    });

    it('uma aula CANCELADA não é recriada, e uma aula manual com horário no timestamp conta como existente no dia', async () => {
      const lesson = await prisma.lesson.findFirstOrThrow({ where: { classId, date: new Date('2026-11-10T00:00:00Z') } });
      await prisma.lesson.update({ where: { id: lesson.id }, data: { status: 'INACTIVE' } });
      // Aula criada à mão pelo POST /lessons com instante no meio do dia civil UTC.
      await prisma.lesson.create({
        data: { organizationId: mestre.organizationId, classId, date: new Date('2026-12-15T15:00:00.000Z') },
      });

      const res = await generate(classId, '2026-11-09', '2026-12-15').expect(201);
      // Terças: 10/11 (cancelada), 17/11, 24/11, 1/12, 8/12 (já existem) e 15/12 (manual) => nada novo.
      assert.equal(res.body.occurrences, 6);
      assert.equal(res.body.created, 0);
      assert.equal(res.body.ignored, 6);
      assert.equal((await prisma.lesson.findUniqueOrThrow({ where: { id: lesson.id } })).status, 'INACTIVE');
      assert.equal(await prisma.lesson.count({ where: { classId } }), 7);
    });

    it('nunca cria antes de `from` nem depois de `to`; intervalo de 1 dia no dia certo cria 1, no errado cria 0', async () => {
      const sunday = (await createClass({ weekday: 0 })).id;
      // 2026-11-01 e 2026-11-08 são domingos; o intervalo começa DEPOIS do primeiro e termina no segundo.
      const res = await generate(sunday, '2026-11-02', '2026-11-08').expect(201);
      assert.deepEqual(res.body.createdDates, ['2026-11-08']);
      assert.deepEqual(await lessonDates(sunday), ['2026-11-08']);

      const sameDay = await generate(sunday, '2026-11-01', '2026-11-01').expect(201);
      assert.equal(sameDay.body.created, 1);
      const wrongDay = await generate(sunday, '2026-11-02', '2026-11-02').expect(201);
      assert.equal(wrongDay.body.occurrences, 0);
      assert.equal(wrongDay.body.created, 0);
      assert.deepEqual(await lessonDates(sunday), ['2026-11-01', '2026-11-08']);
    });

    it('sábado (weekday 6) e fronteira de 90 dias: 2026-11-01..2027-01-30 gera 13 aulas; 91 dias é 400', async () => {
      const saturday = (await createClass({ weekday: 6 })).id;
      const ok = await generate(saturday, '2026-11-01', '2027-01-30').expect(201);
      assert.equal(ok.body.created, 13);
      assert.equal(ok.body.createdDates[0], '2026-11-07');
      assert.equal(ok.body.createdDates[12], '2027-01-30');

      const before = await prisma.lesson.count({ where: { classId: saturday } });
      const tooLong = await generate(saturday, '2026-11-01', '2027-01-31').expect(400);
      assert.match(JSON.stringify(tooLong.body), /90 dias/);
      assert.equal(await prisma.lesson.count({ where: { classId: saturday } }), before);
    });

    it('validações: formato, dia inexistente (30/02), to < from, `to` sem `from`, to+continuous, continuous:false sem `to` e propriedade extra => 400', async () => {
      const before = await prisma.lesson.count({ where: { classId } });
      for (const body of [
        { from: '2026-11-1', to: '2026-11-30' },
        { from: '2026-02-30', to: '2026-03-10' },
        { from: '2026-11-30', to: '2026-11-01' },
        { to: '2026-11-30' },
        { from: '2026-11-01', to: '2026-11-30', continuous: true },
        { continuous: false },
        { from: '2026-11-01', continuous: 'sim' },
        { from: '2026-11-01', to: '2026-11-30', classId: 1 },
        { from: '2026-11-01T00:00:00Z', to: '2026-11-30' },
      ]) {
        await request(app.getHttpServer())
          .post(`/api/classes/${classId}/generate-lessons`)
          .set(auth(mestre.token))
          .send(body)
          .expect(400);
      }
      assert.equal(await prisma.lesson.count({ where: { classId } }), before);
    });

    it('turma sem dia da semana => 400; turma inativa => 400; inexistente => 404 (nada criado)', async () => {
      const noWeekday = (await createClass({})).id;
      await generate(noWeekday, '2026-11-01', '2026-11-30').expect(400);

      const inactive = (await createClass({ weekday: 2 })).id;
      await request(app.getHttpServer()).delete(`/api/classes/${inactive}`).set(auth(mestre.token)).expect(200);
      const res = await generate(inactive, '2026-11-01', '2026-11-30').expect(400);
      assert.match(JSON.stringify(res.body), /inativa/);

      await generate(999999999, '2026-11-01', '2026-11-30').expect(404);
      assert.equal(await prisma.lesson.count({ where: { classId: { in: [noWeekday, inactive] } } }), 0);
    });

    it('gerações CONCORRENTES da mesma turma não duplicam: 12 chamadas simultâneas ao service', async () => {
      const concurrent = (await createClass({ weekday: 2, startTime: '18:00' })).id;
      // Direto no service (sem HTTP/guards no meio) para as transações se sobreporem ao máximo.
      const service = app.get(ClassesService);
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          service.generateLessons(mestre.organizationId, concurrent, { from: '2026-11-01', to: '2027-01-29' }),
        ),
      );
      assert.equal(results.reduce((sum, r) => sum + r.created, 0), 13); // terças de 3/11/2026 a 26/1/2027
      assert.equal(await prisma.lesson.count({ where: { classId: concurrent } }), 13);
      assert.equal(new Set(await lessonDates(concurrent)).size, 13);
    });

    it('a geração ESPERA o advisory lock da turma (determinístico): bloqueada enquanto outra transação o segura, livre depois', async () => {
      const locked = (await createClass({ weekday: 2 })).id;
      const service = app.get(ClassesService);
      let release!: () => void;
      const hold = new Promise<void>((resolve) => (release = resolve));
      let acquired!: () => void;
      const gotLock = new Promise<void>((resolve) => (acquired = resolve));
      // Outra transação segura o lock desta turma (mesma chave que o service usa).
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${GENERATE_LESSONS_LOCK_NS}::int, ${locked}::int)`;
          acquired();
          await hold;
        },
        { timeout: 20000 },
      );
      await gotLock;

      let finished = false;
      const generation = service
        .generateLessons(mestre.organizationId, locked, { from: '2026-11-01', to: '2026-11-30' })
        .then((r) => {
          finished = true;
          return r;
        });
      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.equal(finished, false, 'a geração não pode concluir enquanto o lock da turma está tomado');
      assert.equal(await prisma.lesson.count({ where: { classId: locked } }), 0);

      // O lock de OUTRA turma não bloqueia.
      const other = (await createClass({ weekday: 2 })).id;
      const otherResult = await service.generateLessons(mestre.organizationId, other, { from: '2026-11-01', to: '2026-11-30' });
      assert.equal(otherResult.created, 4);

      release();
      await holder;
      const result = await generation;
      assert.equal(result.created, 4);
      assert.equal(await prisma.lesson.count({ where: { classId: locked } }), 4);
    });

    it('as aulas geradas aparecem em GET /lessons/me do aluno matriculado (e não para quem não tem vínculo)', async () => {
      const mine = (await createClass({ weekday: 2, startTime: '10:00', endTime: '11:00' })).id;
      await prisma.classStudent.create({
        data: { organizationId: mestre.organizationId, classId: mine, studentId: fixture.self.studentId },
      });
      await generate(mine, '2026-11-01', '2026-11-30').expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/lessons/me?from=2026-11-01&to=2026-11-30&limit=200')
        .set(auth(fixture.self.token))
        .expect(200);
      const mineLessons = (res.body as Array<{ classId: number; date: string }>).filter((l) => l.classId === mine);
      assert.equal(mineLessons.length, 4);

      const orphan = await request(app.getHttpServer())
        .get('/api/lessons/me?from=2026-11-01&to=2026-11-30&limit=200')
        .set(auth(fixture.orphan.token))
        .expect(200);
      assert.equal((orphan.body as Array<{ classId: number }>).filter((l) => l.classId === mine).length, 0);
      await prisma.classStudent.deleteMany({ where: { classId: mine } });
    });
  });

  describe('multi-tenant e RBAC', () => {
    it('MESTRE de outro grupo recebe 404 ao gerar aulas de turma alheia (nada criado); a turma dele é independente', async () => {
      const aClass = (await createClass({ weekday: 2 })).id;
      await generate(aClass, '2026-11-01', '2026-11-30', orgB.token).expect(404);
      assert.equal(await prisma.lesson.count({ where: { classId: aClass } }), 0);

      const bClass = await prisma.class.create({
        data: { organizationId: orgB.organizationId, name: '[e2e-gen] turma B', weekday: 2 },
      });
      classIds.push(bClass.id);
      // Aulas da turma A nas mesmas datas NÃO contam como "existentes" para a turma B.
      await generate(aClass, '2026-11-01', '2026-11-30').expect(201);
      const res = await generate(bClass.id, '2026-11-01', '2026-11-30', orgB.token).expect(201);
      assert.equal(res.body.created, 4);
      const rows = await prisma.lesson.findMany({ where: { classId: bClass.id } });
      assert.ok(rows.every((l) => l.organizationId === orgB.organizationId));
    });

    it('ALUNO não gera aulas (403); PROFESSOR (lessons:create) gera (201); sem token => 401', async () => {
      const target = (await createClass({ weekday: 2 })).id;
      await generate(target, '2026-11-01', '2026-11-30', fixture.self.token).expect(403);
      assert.equal(await prisma.lesson.count({ where: { classId: target } }), 0);

      const ok = await generate(target, '2026-11-01', '2026-11-30', professor.token).expect(201);
      assert.equal(ok.body.created, 4);

      await request(app.getHttpServer())
        .post(`/api/classes/${target}/generate-lessons`)
        .send({ from: '2026-11-01', to: '2026-11-30' })
        .expect(401);
    });
  });
});
