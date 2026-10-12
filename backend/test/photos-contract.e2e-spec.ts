import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createSecondOrg, DEV_PASSWORD, loginAs, MESTRE_EMAIL, SecondOrg, todaySaoPaulo } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Fotos de turma / unidade / professor + contrato de leitura (class/unit/teacher com {id,name,photo}) em
 * /classes, /classes/me, /units, /teachers, /lessons, /lessons/me, roster da chamada (photo do aluno) e imageUrl no mapa.
 * Tudo numa organizacao PROPRIA da suite (createSecondOrg): o seed ginga-brasil so e' lido (GET /map/places).
 * Simples, sem mutacao: cada caso confere a resposta e, quando importa, a coluna via Prisma (2a via independente).
 */
const photoRef = () => `/api/uploads/${randomUUID()}.webp`;

describe('Fotos + contrato de leitura class/unit/teacher (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let orgB: SecondOrg;
  let seedMestreToken: string;
  let alunoToken: string;
  let alunoStudentId: number;
  let teacherToken: string;
  let teacherUserId: number;
  let teacherMembershipId: number;
  let otherTeacherUserId: number;
  const extraUserIds: number[] = [];
  const unitPhoto = photoRef();
  const unit2Photo = photoRef();
  const classPhoto = photoRef();
  const teacherPhoto = photoRef();
  const otherTeacherPhoto = photoRef();
  const studentPhoto = photoRef();
  let unitId: number;
  let unit2Id: number;
  let classId: number; // com foto, unidade 1 e professor
  let plainClassId: number; // sem foto/professor, na unidade 2
  let lessonId: number; // herda unidade/professor da turma
  let overrideLessonId: number; // unidade 2 e outro professor proprios

  async function member(kind: string, role: OrgRole, photo: string | null = null) {
    const email = `${kind}-${Date.now()}-${Math.floor(Math.random() * 1000)}@e2e-photos.local`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `E2E ${kind}`, userType: 'MEMBER', status: 'ACTIVE', photo },
    });
    extraUserIds.push(user.id);
    const membership = await prisma.organizationUser.create({
      data: { organizationId: orgB.organizationId, userId: user.id, role, status: 'ACTIVE' },
    });
    return { userId: user.id, membershipId: membership.id, token: (await loginAs(app, email)).token };
  }

  before(async () => {
    app = await createTestApp();
    seedMestreToken = (await loginAs(app, MESTRE_EMAIL)).token;
    orgB = await createSecondOrg(app, prisma, 'photos');
    const orgId = orgB.organizationId;

    const teacher = await member('prof', OrgRole.PROFESSOR, teacherPhoto);
    teacherToken = teacher.token;
    teacherUserId = teacher.userId;
    teacherMembershipId = teacher.membershipId;
    otherTeacherUserId = (await member('prof2', OrgRole.PROFESSOR, otherTeacherPhoto)).userId;
    const aluno = await member('aluno', OrgRole.ALUNO);
    alunoToken = aluno.token;
    alunoStudentId = (
      await prisma.student.create({ data: { organizationId: orgId, userId: aluno.userId, name: 'E2E Aluno Fotos', photo: studentPhoto } })
    ).id;
  });

  after(async () => {
    const organizationId = orgB.organizationId;
    await prisma.attendance.deleteMany({ where: { organizationId } });
    await prisma.lesson.deleteMany({ where: { organizationId } });
    await prisma.classStudent.deleteMany({ where: { organizationId } });
    await prisma.class.deleteMany({ where: { organizationId } });
    await prisma.student.deleteMany({ where: { organizationId } });
    await prisma.userUnitAccess.deleteMany({ where: { organizationId } });
    await prisma.unit.deleteMany({ where: { organizationId } });
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: extraUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: extraUserIds } } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  describe('unidade', () => {
    it('POST /units aceita foto (upload ou URL), rejeita lixo (400) e GET devolve photo', async () => {
      for (const bad of ['javascript:alert(1)', 'foto.png', 'ftp://x.com/a.png', '/api/uploads/../../etc/passwd', 123]) {
        await request(server()).post('/api/units').set(auth(orgB.token)).send({ name: 'Unidade ruim', photo: bad }).expect(400);
      }
      const created = await request(server())
        .post('/api/units')
        .set(auth(orgB.token))
        .send({ name: 'Matriz Fotos', photo: unitPhoto, latitude: -23.55, longitude: -46.63 })
        .expect(201);
      unitId = created.body.id;
      assert.equal(created.body.photo, unitPhoto);
      assert.equal((await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })).photo, unitPhoto);

      const url = await request(server())
        .post('/api/units')
        .set(auth(orgB.token))
        .send({ name: 'Filial Fotos', photo: unit2Photo, isMain: false })
        .expect(201);
      unit2Id = url.body.id;

      const list = await request(server()).get('/api/units').set(auth(orgB.token)).expect(200);
      assert.equal(list.body.find((u: { id: number }) => u.id === unitId).photo, unitPhoto);
      const one = await request(server()).get(`/api/units/${unitId}`).set(auth(orgB.token)).expect(200);
      assert.equal(one.body.photo, unitPhoto);
    });

    it('PATCH /units/:id troca a foto, rejeita invalida e null / "" limpam', async () => {
      await request(server()).patch(`/api/units/${unit2Id}`).set(auth(orgB.token)).send({ photo: 'nao-e-url' }).expect(400);
      const fresh = photoRef();
      await request(server()).patch(`/api/units/${unit2Id}`).set(auth(orgB.token)).send({ photo: fresh }).expect(200);
      assert.equal((await prisma.unit.findUniqueOrThrow({ where: { id: unit2Id } })).photo, fresh);

      await request(server()).patch(`/api/units/${unit2Id}`).set(auth(orgB.token)).send({ photo: null }).expect(200);
      assert.equal((await prisma.unit.findUniqueOrThrow({ where: { id: unit2Id } })).photo, null);
      await request(server()).patch(`/api/units/${unit2Id}`).set(auth(orgB.token)).send({ photo: unit2Photo }).expect(200);
      await request(server()).patch(`/api/units/${unit2Id}`).set(auth(orgB.token)).send({ photo: '' }).expect(200);
      assert.equal((await prisma.unit.findUniqueOrThrow({ where: { id: unit2Id } })).photo, null);
      await request(server()).patch(`/api/units/${unit2Id}`).set(auth(orgB.token)).send({ photo: unit2Photo }).expect(200);
    });
  });

  describe('professor', () => {
    it('GET /teachers e /teachers/:id trazem photo (de User.photo) no topo, mantendo user.photo', async () => {
      const one = await request(server()).get(`/api/teachers/${teacherMembershipId}`).set(auth(orgB.token)).expect(200);
      assert.equal(one.body.photo, teacherPhoto);
      assert.equal(one.body.user.photo, teacherPhoto);
      const list = await request(server()).get('/api/teachers').set(auth(orgB.token)).expect(200);
      assert.equal(list.body.find((t: { id: number }) => t.id === teacherMembershipId).photo, teacherPhoto);
    });

    it('PATCH /teachers/:id aceita photo (valida), null / "" limpam; POST /teachers aceita photo', async () => {
      await request(server()).patch(`/api/teachers/${teacherMembershipId}`).set(auth(orgB.token)).send({ photo: 'x' }).expect(400);
      const fresh = photoRef();
      const ok = await request(server()).patch(`/api/teachers/${teacherMembershipId}`).set(auth(orgB.token)).send({ photo: fresh }).expect(200);
      assert.equal(ok.body.photo, fresh);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: teacherUserId } })).photo, fresh);
      await request(server()).patch(`/api/teachers/${teacherMembershipId}`).set(auth(orgB.token)).send({ photo: null }).expect(200);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: teacherUserId } })).photo, null);
      await request(server()).patch(`/api/teachers/${teacherMembershipId}`).set(auth(orgB.token)).send({ photo: '' }).expect(200);
      await request(server()).patch(`/api/teachers/${teacherMembershipId}`).set(auth(orgB.token)).send({ photo: teacherPhoto }).expect(200);

      const email = `novo-${Date.now()}@e2e-photos.local`;
      const created = await request(server())
        .post('/api/teachers')
        .set(auth(orgB.token))
        .send({ name: 'Professor Novo', email, password: 'Senha@Forte123', role: 'PROFESSOR', photo: unit2Photo })
        .expect(201);
      extraUserIds.push(created.body.user.id);
      assert.equal(created.body.photo, unit2Photo);
      await request(server())
        .post('/api/teachers')
        .set(auth(orgB.token))
        .send({ name: 'Professor Ruim', email: `ruim-${Date.now()}@e2e-photos.local`, password: 'Senha@Forte123', role: 'PROFESSOR', photo: 'lixo' })
        .expect(400);
    });

    it('PATCH /auth/me/profile: o proprio usuario (professor e aluno) troca/limpa a foto; invalida => 400', async () => {
      await request(server()).patch('/api/auth/me/profile').set(auth(teacherToken)).send({ photo: 'lixo' }).expect(400);
      await request(server()).patch('/api/auth/me/profile').send({ photo: teacherPhoto }).expect(401);
      const fresh = photoRef();
      const res = await request(server()).patch('/api/auth/me/profile').set(auth(teacherToken)).send({ photo: fresh }).expect(200);
      assert.equal(res.body.photo, fresh);
      assert.equal((await request(server()).get('/api/auth/me').set(auth(teacherToken)).expect(200)).body.photo, fresh);
      await request(server()).patch('/api/auth/me/profile').set(auth(teacherToken)).send({ photo: null }).expect(200);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: teacherUserId } })).photo, null);
      await request(server()).patch('/api/auth/me/profile').set(auth(teacherToken)).send({ photo: teacherPhoto }).expect(200);
      await request(server()).patch('/api/auth/me/profile').set(auth(alunoToken)).send({ photo: fresh }).expect(200);
      // propriedade desconhecida segue barrada pelo ValidationPipe global
      await request(server()).patch('/api/auth/me/profile').set(auth(teacherToken)).send({ name: 'Outro' }).expect(400);
    });
  });

  describe('turma', () => {
    it('POST /classes aceita photo e devolve photo + unit{id,name,photo} + teacher{id,name,photo}', async () => {
      await request(server())
        .post('/api/classes')
        .set(auth(orgB.token))
        .send({ name: 'Turma ruim', photo: 'lixo', autoGenerateLessons: false })
        .expect(400);
      const created = await request(server())
        .post('/api/classes')
        .set(auth(orgB.token))
        .send({ name: 'Turma com Foto', photo: classPhoto, unitId, teacherUserId, autoGenerateLessons: false })
        .expect(201);
      classId = created.body.id;
      assert.equal(created.body.photo, classPhoto);
      assert.deepEqual(created.body.unit, { id: unitId, name: 'Matriz Fotos', photo: unitPhoto });
      assert.deepEqual(created.body.teacher, { id: teacherUserId, name: 'E2E prof', photo: teacherPhoto });

      const plain = await request(server())
        .post('/api/classes')
        .set(auth(orgB.token))
        .send({ name: 'Turma Simples', unitId: unit2Id, autoGenerateLessons: false })
        .expect(201);
      plainClassId = plain.body.id;
      assert.equal(plain.body.photo, null);
      assert.equal(plain.body.teacher, null);
      assert.deepEqual(plain.body.unit, { id: unit2Id, name: 'Filial Fotos', photo: unit2Photo });
    });

    it('GET /classes, /classes/:id e /classes/me trazem o contrato; /classes/me so expoe nome e foto do professor', async () => {
      await prisma.classStudent.create({ data: { organizationId: orgB.organizationId, classId, studentId: alunoStudentId } });

      const list = await request(server()).get('/api/classes').set(auth(orgB.token)).expect(200);
      const fromList = list.body.find((c: { id: number }) => c.id === classId);
      assert.equal(fromList.photo, classPhoto);
      assert.equal(fromList.unit.photo, unitPhoto);
      assert.equal(fromList.teacher.name, 'E2E prof');

      const one = await request(server()).get(`/api/classes/${classId}`).set(auth(orgB.token)).expect(200);
      assert.deepEqual(one.body.teacher, { id: teacherUserId, name: 'E2E prof', photo: teacherPhoto });

      const mine = await request(server()).get('/api/classes/me').set(auth(alunoToken)).expect(200);
      assert.equal(mine.body.length, 1);
      assert.equal(mine.body[0].photo, classPhoto);
      assert.deepEqual(Object.keys(mine.body[0].teacher).sort(), ['id', 'name', 'photo']);
      assert.deepEqual(Object.keys(mine.body[0].unit).sort(), ['id', 'name', 'photo']);
      assert.ok(!JSON.stringify(mine.body).includes('@e2e-photos.local'), 'nenhum e-mail do professor');
    });

    it('PATCH /classes/:id troca a foto, invalida => 400, null e "" limpam (conferido via Prisma)', async () => {
      await request(server()).patch(`/api/classes/${plainClassId}`).set(auth(orgB.token)).send({ photo: 'lixo' }).expect(400);
      const fresh = photoRef();
      const ok = await request(server()).patch(`/api/classes/${plainClassId}`).set(auth(orgB.token)).send({ photo: fresh }).expect(200);
      assert.equal(ok.body.photo, fresh);
      assert.equal((await prisma.class.findUniqueOrThrow({ where: { id: plainClassId } })).photo, fresh);
      await request(server()).patch(`/api/classes/${plainClassId}`).set(auth(orgB.token)).send({ photo: null }).expect(200);
      assert.equal((await prisma.class.findUniqueOrThrow({ where: { id: plainClassId } })).photo, null);
      await request(server()).patch(`/api/classes/${plainClassId}`).set(auth(orgB.token)).send({ photo: fresh }).expect(200);
      await request(server()).patch(`/api/classes/${plainClassId}`).set(auth(orgB.token)).send({ photo: '' }).expect(200);
      assert.equal((await prisma.class.findUniqueOrThrow({ where: { id: plainClassId } })).photo, null);
    });
  });

  describe('aula, chamada e mapa', () => {
    it('GET /lessons e /lessons/me: class/unit/teacher (da aula ou, na falta, da turma) sem perder os campos antigos', async () => {
      const today = todaySaoPaulo();
      const inherit = await request(server())
        .post('/api/lessons')
        .set(auth(orgB.token))
        .send({ classId, date: `${today}T00:00:00.000Z` })
        .expect(201);
      lessonId = inherit.body.id;
      assert.deepEqual(inherit.body.class, { id: classId, name: 'Turma com Foto', photo: classPhoto });
      assert.deepEqual(inherit.body.unit, { id: unitId, name: 'Matriz Fotos', photo: unitPhoto });
      assert.deepEqual(inherit.body.teacher, { id: teacherUserId, name: 'E2E prof', photo: teacherPhoto });
      assert.equal(inherit.body.classId, classId);
      assert.equal(inherit.body.unitId, null);
      assert.equal(inherit.body.teacherUserId, null);

      const override = await request(server())
        .post('/api/lessons')
        .set(auth(orgB.token))
        .send({ classId, unitId: unit2Id, teacherUserId: otherTeacherUserId, date: `${today}T00:00:00.000Z` })
        .expect(201);
      overrideLessonId = override.body.id;

      const list = await request(server()).get(`/api/lessons?classId=${classId}`).set(auth(orgB.token)).expect(200);
      const byId = (id: number) => list.body.find((l: { id: number }) => l.id === id);
      assert.deepEqual(byId(lessonId).unit, { id: unitId, name: 'Matriz Fotos', photo: unitPhoto });
      assert.deepEqual(byId(overrideLessonId).unit, { id: unit2Id, name: 'Filial Fotos', photo: unit2Photo });
      assert.deepEqual(byId(overrideLessonId).teacher, { id: otherTeacherUserId, name: 'E2E prof2', photo: otherTeacherPhoto });
      assert.equal(byId(overrideLessonId).class.photo, classPhoto);

      const one = await request(server()).get(`/api/lessons/${overrideLessonId}`).set(auth(orgB.token)).expect(200);
      assert.equal(one.body.teacher.id, otherTeacherUserId);

      const mine = await request(server()).get('/api/lessons/me').set(auth(alunoToken)).expect(200);
      assert.equal(mine.body.length, 2);
      for (const lesson of mine.body) {
        assert.deepEqual(Object.keys(lesson.class).sort(), ['id', 'name', 'photo']);
        assert.deepEqual(Object.keys(lesson.teacher).sort(), ['id', 'name', 'photo']);
      }
      assert.ok(!JSON.stringify(mine.body).includes('@e2e-photos.local'));
    });

    it('GET /attendance/lessons/:id (roster) traz a photo do aluno', async () => {
      const roster = await request(server()).get(`/api/attendance/lessons/${lessonId}`).set(auth(orgB.token)).expect(200);
      assert.equal(roster.body.length, 1);
      assert.deepEqual(roster.body[0], {
        studentId: alunoStudentId,
        studentName: 'E2E Aluno Fotos',
        photo: studentPhoto,
        present: null,
        justification: null,
      });
    });

    it('GET /map/places: UNIT usa a foto da unidade; CLASS a da turma (sem foto, cai na da unidade)', async () => {
      await prisma.unit.update({ where: { id: unit2Id }, data: { latitude: -22.9, longitude: -43.17 } });
      const res = await request(server()).get('/api/map/places?types=UNIT,CLASS&limit=1000').set(auth(seedMestreToken)).expect(200);
      const find = (id: string) => res.body.items.find((i: { id: string }) => i.id === id);
      assert.equal(find(`UNIT:${unitId}`).imageUrl, unitPhoto);
      assert.equal(find(`UNIT:${unit2Id}`).imageUrl, unit2Photo);
      assert.equal(find(`CLASS:${classId}`).imageUrl, classPhoto);
      assert.equal(find(`CLASS:${plainClassId}`).imageUrl, unit2Photo, 'turma sem foto usa a da unidade');
      const mapBody = JSON.stringify(find(`CLASS:${classId}`));
      assert.ok(!mapBody.includes('E2E prof'), 'o mapa continua sem dados de pessoa');
    });

    it('escopo de unidade: professor restrito a unidade 1 nao ve a turma da unidade 2, e o contrato segue completo', async () => {
      await prisma.userUnitAccess.create({ data: { organizationId: orgB.organizationId, userId: teacherUserId, unitId } });
      const list = await request(server()).get('/api/classes').set(auth(teacherToken)).expect(200);
      assert.ok(list.body.some((c: { id: number }) => c.id === classId));
      assert.ok(!list.body.some((c: { id: number }) => c.id === plainClassId));
      assert.equal(list.body.find((c: { id: number }) => c.id === classId).unit.photo, unitPhoto);
      await request(server()).get(`/api/classes/${plainClassId}`).set(auth(teacherToken)).expect(404);
      const lessons = await request(server()).get('/api/lessons').set(auth(teacherToken)).expect(200);
      assert.ok(lessons.body.some((l: { id: number }) => l.id === lessonId));
      assert.ok(!lessons.body.some((l: { id: number }) => l.id === overrideLessonId), 'aula da unidade 2 fica fora do escopo');
    });
  });
});
