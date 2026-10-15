import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { DEV_PASSWORD, todaySaoPaulo } from './utils/list-helpers';

/**
 * E08 — autorização por unidade. Grupo PRÓPRIO da suíte (não toca no seed ginga-brasil nem no demo), com duas
 * unidades (A e B), um grupo B para o multi-tenant e usuários:
 *  - profA  (UserUnitAccess só na unidade A)   - profB (só na B)   - profFree (nenhum registro => vê tudo)
 *  - aluno  (ALUNO com UserUnitAccess na A — o escopo dele NÃO é por unidade)   - mestre
 * Tudo via HTTP real, conferência independente no Postgres (PrismaClient próprio). Limpa tudo no after().
 */
const DOMAIN = '@e2e-uscope.local';

describe('Autorização por unidade (E08, e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}`;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let orgId: number;
  let otherOrgId: number;
  let unitA: number;
  let unitB: number;
  let otherUnit: number;
  const tokens: Record<string, string> = {};
  const userIds: Record<string, number> = {};
  const membershipIds: Record<string, number> = {};

  // Fixtures criadas pelo MESTRE via API.
  let stuA: number;
  let stuB: number;
  let stuNone: number;
  let classA: number;
  let classB: number;
  let lessonA: number;
  let lessonB: number;
  let lessonInheritB: number; // aula sem unitId própria, de turma da B
  let eventA: number;
  let eventB: number;
  let eventGroup: number;
  let announcementA: number;
  let announcementB: number;
  let announcementGroup: number;

  async function makeUser(key: string, role: OrgRole, organizationId: number): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: `${key}-${stamp}${DOMAIN}`,
        passwordHash: await bcrypt.hash(DEV_PASSWORD, 4),
        name: `[e2e-uscope] ${key}`,
        userType: 'MEMBER',
        status: 'ACTIVE',
      },
    });
    const membership = await prisma.organizationUser.create({
      data: { organizationId, userId: user.id, role, status: 'ACTIVE' },
    });
    userIds[key] = user.id;
    membershipIds[key] = membership.id;
    const login = await http()
      .post('/api/auth/login')
      .send({ email: user.email, password: DEV_PASSWORD })
      .expect(200);
    tokens[key] = login.body.accessToken;
  }

  const ids = (body: Array<{ id: number }>) => body.map((r) => r.id).sort((a, b) => a - b);
  const mine = (all: Array<{ id: number }>, wanted: number[]) => ids(all.filter((r) => wanted.includes(r.id)));
  const sorted = (n: number[]) => [...n].sort((a, b) => a - b);

  before(async () => {
    app = await createTestApp();
    const org = await prisma.organization.create({
      data: { name: `E2E uscope ${stamp}`, slug: `e2e-uscope-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
    });
    const other = await prisma.organization.create({
      data: { name: `E2E uscope other ${stamp}`, slug: `e2e-uscope-other-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
    });
    orgId = org.id;
    otherOrgId = other.id;
    unitA = (await prisma.unit.create({ data: { organizationId: orgId, name: 'Filial A', isMain: true } })).id;
    unitB = (await prisma.unit.create({ data: { organizationId: orgId, name: 'Filial B' } })).id;
    otherUnit = (await prisma.unit.create({ data: { organizationId: otherOrgId, name: 'Unidade de outro grupo' } })).id;

    await makeUser('mestre', OrgRole.MESTRE, orgId);
    await makeUser('profA', OrgRole.PROFESSOR, orgId);
    await makeUser('profB', OrgRole.PROFESSOR, orgId);
    await makeUser('profFree', OrgRole.PROFESSOR, orgId);
    await makeUser('aluno', OrgRole.ALUNO, orgId);
    await makeUser('mestreOther', OrgRole.MESTRE, otherOrgId);

    // Unidades atribuídas direto no banco (a API é testada no describe do PUT, abaixo).
    await prisma.userUnitAccess.createMany({
      data: [
        { organizationId: orgId, userId: userIds.profA, unitId: unitA },
        { organizationId: orgId, userId: userIds.profB, unitId: unitB },
        { organizationId: orgId, userId: userIds.aluno, unitId: unitA }, // ALUNO com registro: o escopo dele não é por unidade
      ],
    });

    const m = tokens.mestre;
    const post = async (path: string, body: object) => (await http().post(`/api/${path}`).set(auth(m)).send(body).expect(201)).body;
    stuA = (await post('students', { name: '[e2e-uscope] Aluno A', unitId: unitA })).id;
    stuB = (await post('students', { name: '[e2e-uscope] Aluno B', unitId: unitB })).id;
    stuNone = (await post('students', { name: '[e2e-uscope] Aluno sem unidade' })).id;
    classA = (await post('classes', { name: '[e2e-uscope] Turma A', unitId: unitA, weekday: 1 })).id;
    classB = (await post('classes', { name: '[e2e-uscope] Turma B', unitId: unitB, weekday: 1 })).id;
    // Chamada (attendance): o PROFESSOR so le/marca as aulas das turmas em que e o responsavel (ownLessonFilter), alem do escopo de unidade.
    await prisma.class.update({ where: { id: classA }, data: { teacherUserId: userIds.profA } });
    lessonA = (await post('lessons', { classId: classA, unitId: unitA, date: todaySaoPaulo(1) })).id;
    lessonB = (await post('lessons', { classId: classB, unitId: unitB, date: todaySaoPaulo(1) })).id;
    lessonInheritB = (await post('lessons', { classId: classB, date: todaySaoPaulo(2) })).id;
    await post(`classes/${classA}/students`, { studentId: stuA });
    await post(`classes/${classB}/students`, { studentId: stuB });
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
    eventA = (await post('events', { title: '[e2e-uscope] Evento A', date: future, unitId: unitA })).id;
    eventB = (await post('events', { title: '[e2e-uscope] Evento B', date: future, unitId: unitB })).id;
    eventGroup = (await post('events', { title: '[e2e-uscope] Evento do grupo', date: future })).id;
    announcementA = (await post('announcements', { title: '[e2e-uscope] Aviso A', body: 'aviso a', unitId: unitA })).id;
    announcementB = (await post('announcements', { title: '[e2e-uscope] Aviso B', body: 'aviso b', unitId: unitB })).id;
    announcementGroup = (await post('announcements', { title: '[e2e-uscope] Aviso geral', body: 'aviso geral' })).id;
  });

  after(async () => {
    const where = { organizationId: { in: [orgId, otherOrgId] } };
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    const userIdList = users.map((u) => u.id);
    await prisma.notification.deleteMany({ where });
    await prisma.certificate.deleteMany({ where });
    await prisma.studentGraduation.deleteMany({ where });
    await prisma.attendance.deleteMany({ where });
    await prisma.lesson.deleteMany({ where });
    await prisma.classStudent.deleteMany({ where });
    await prisma.class.deleteMany({ where });
    await prisma.eventParticipant.deleteMany({ where });
    await prisma.event.deleteMany({ where });
    await prisma.announcement.deleteMany({ where });
    await prisma.studentGuardian.deleteMany({ where });
    await prisma.student.deleteMany({ where });
    await prisma.userUnitAccess.deleteMany({ where });
    await prisma.unit.deleteMany({ where });
    await prisma.auditLog.deleteMany({ where });
    await prisma.organizationUser.deleteMany({ where });
    await prisma.user.deleteMany({ where: { id: { in: userIdList } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET/PUT /teachers/:id/units', () => {
    it('só o MESTRE lê e define; PROFESSOR e ALUNO recebem 403; sem token 401', async () => {
      await http().get(`/api/teachers/${membershipIds.profA}/units`).set(auth(tokens.profA)).expect(403);
      await http().put(`/api/teachers/${membershipIds.profA}/units`).set(auth(tokens.profA)).send({ unitIds: [unitB] }).expect(403);
      await http().put(`/api/teachers/${membershipIds.profA}/units`).set(auth(tokens.aluno)).send({ unitIds: [unitB] }).expect(403);
      await http().put(`/api/teachers/${membershipIds.profA}/units`).send({ unitIds: [] }).expect(401);
      // nada mudou no banco
      const rows = await prisma.userUnitAccess.findMany({ where: { userId: userIds.profA } });
      assert.deepEqual(rows.map((r) => r.unitId), [unitA]);
    });

    it('GET devolve as unidades atuais; GET /teachers e GET /teachers/:id trazem unitIds', async () => {
      const res = await http().get(`/api/teachers/${membershipIds.profA}/units`).set(auth(tokens.mestre)).expect(200);
      assert.deepEqual(res.body, { unitIds: [unitA] });

      const list = await http().get('/api/teachers?limit=200').set(auth(tokens.mestre)).expect(200);
      const rowA = list.body.find((t: { id: number }) => t.id === membershipIds.profA);
      const rowFree = list.body.find((t: { id: number }) => t.id === membershipIds.profFree);
      const rowMestre = list.body.find((t: { id: number }) => t.id === membershipIds.mestre);
      assert.deepEqual(rowA.unitIds, [unitA]);
      assert.deepEqual(rowFree.unitIds, [], 'sem registros = lista vazia (= sem restrição)');
      assert.deepEqual(rowMestre.unitIds, []);

      const one = await http().get(`/api/teachers/${membershipIds.profB}`).set(auth(tokens.mestre)).expect(200);
      assert.deepEqual(one.body.unitIds, [unitB]);
    });

    it('PUT substitui o conjunto (não acumula) e persiste; lista vazia remove a restrição', async () => {
      const set = await http()
        .put(`/api/teachers/${membershipIds.profFree}/units`)
        .set(auth(tokens.mestre))
        .send({ unitIds: [unitB, unitA, unitB === unitA ? 0 : unitA].filter((n, i, a) => n > 0 && a.indexOf(n) === i) })
        .expect(200);
      assert.deepEqual(set.body, { unitIds: sorted([unitA, unitB]) });
      let rows = await prisma.userUnitAccess.findMany({ where: { userId: userIds.profFree }, orderBy: { unitId: 'asc' } });
      assert.deepEqual(rows.map((r) => r.unitId), sorted([unitA, unitB]));
      assert.ok(rows.every((r) => r.organizationId === orgId));

      await http().put(`/api/teachers/${membershipIds.profFree}/units`).set(auth(tokens.mestre)).send({ unitIds: [unitB] }).expect(200);
      rows = await prisma.userUnitAccess.findMany({ where: { userId: userIds.profFree } });
      assert.deepEqual(rows.map((r) => r.unitId), [unitB], 'substituiu: a A saiu');

      const cleared = await http().put(`/api/teachers/${membershipIds.profFree}/units`).set(auth(tokens.mestre)).send({ unitIds: [] }).expect(200);
      assert.deepEqual(cleared.body, { unitIds: [] });
      assert.equal(await prisma.userUnitAccess.count({ where: { userId: userIds.profFree } }), 0);
      // idempotente
      await http().put(`/api/teachers/${membershipIds.profFree}/units`).set(auth(tokens.mestre)).send({ unitIds: [] }).expect(200);
    });

    it('valida: unidade de OUTRO grupo e inexistente = 400 (e nada é gravado); duplicados, não-array e ids ruins = 400', async () => {
      const url = `/api/teachers/${membershipIds.profFree}/units`;
      await http().put(url).set(auth(tokens.mestre)).send({ unitIds: [unitA, otherUnit] }).expect(400);
      await http().put(url).set(auth(tokens.mestre)).send({ unitIds: [999999999] }).expect(400);
      await http().put(url).set(auth(tokens.mestre)).send({ unitIds: [unitA, unitA] }).expect(400);
      await http().put(url).set(auth(tokens.mestre)).send({ unitIds: unitA }).expect(400);
      await http().put(url).set(auth(tokens.mestre)).send({ unitIds: [0] }).expect(400);
      await http().put(url).set(auth(tokens.mestre)).send({ unitIds: ['x'] }).expect(400);
      await http().put(url).set(auth(tokens.mestre)).send({}).expect(400);
      await http().put(url).set(auth(tokens.mestre)).send({ unitIds: [unitA], extra: 1 }).expect(400);
      assert.equal(await prisma.userUnitAccess.count({ where: { userId: userIds.profFree } }), 0, 'nenhuma gravação parcial');
    });

    it('multi-tenant: professor/membership de outro grupo = 404 (GET e PUT); o Mestre B não toca no grupo A; Mestre alvo = 400', async () => {
      await http().get(`/api/teachers/${membershipIds.profA}/units`).set(auth(tokens.mestreOther)).expect(404);
      await http().put(`/api/teachers/${membershipIds.profA}/units`).set(auth(tokens.mestreOther)).send({ unitIds: [otherUnit] }).expect(404);
      assert.deepEqual((await prisma.userUnitAccess.findMany({ where: { userId: userIds.profA } })).map((r) => r.unitId), [unitA]);
      await http().put(`/api/teachers/999999999/units`).set(auth(tokens.mestre)).send({ unitIds: [] }).expect(404);
      // aluno não é "professor": 404 (o recurso /teachers só enxerga MESTRE/PROFESSOR)
      await http().put(`/api/teachers/${membershipIds.aluno}/units`).set(auth(tokens.mestre)).send({ unitIds: [unitA] }).expect(404);
      await http().put(`/api/teachers/${membershipIds.mestre}/units`).set(auth(tokens.mestre)).send({ unitIds: [unitA] }).expect(400);
    });
  });

  describe('alunos (students)', () => {
    it('profA lista só a unidade A (itens e X-Total-Count batem); filtro ?unitId=B não amplia; busca respeita o escopo', async () => {
      const res = await http().get('/api/students?limit=200').set(auth(tokens.profA)).expect(200);
      assert.deepEqual(mine(res.body, [stuA, stuB, stuNone]), sorted([stuA, stuNone]), 'a da A e a sem unidade (legado); nunca a da B');
      assert.equal(Number(res.headers['x-total-count']), res.body.length);
      assert.ok(res.body.every((s: { unitId: number | null }) => s.unitId === unitA || s.unitId === null));

      const other = await http().get(`/api/students?unitId=${unitB}`).set(auth(tokens.profA)).expect(200);
      assert.deepEqual(other.body, []);
      assert.equal(other.headers['x-total-count'], '0');

      const search = await http().get('/api/students?q=%5Be2e-uscope%5D&limit=200').set(auth(tokens.profA)).expect(200);
      assert.deepEqual(ids(search.body.filter((s: { unitId: number | null }) => s.unitId === unitB)), []);
      assert.equal(Number(search.headers['x-total-count']), search.body.length);
    });

    it('profA não lê nem edita aluno da B (404 igual ao inexistente; DELETE é 403 por RBAC)', async () => {
      const missing = await http().get('/api/students/999999999').set(auth(tokens.profA)).expect(404);
      const readB = await http().get(`/api/students/${stuB}`).set(auth(tokens.profA)).expect(404);
      assert.deepEqual(readB.body.message, missing.body.message, 'não vaza a existência');
      await http().get(`/api/students/${stuNone}`).set(auth(tokens.profA)).expect(200); // sem unidade = legado, visível
      await http().patch(`/api/students/${stuB}`).set(auth(tokens.profA)).send({ name: 'invadido' }).expect(404);
      await http().delete(`/api/students/${stuB}`).set(auth(tokens.profA)).expect(403);
      const stored = await prisma.student.findUniqueOrThrow({ where: { id: stuB } });
      assert.equal(stored.name, '[e2e-uscope] Aluno B');
      assert.equal(stored.status, 'ACTIVE');
      // o da própria unidade funciona
      await http().get(`/api/students/${stuA}`).set(auth(tokens.profA)).expect(200);
    });

    it('escritas na própria unidade: criar sem unitId assume a única unidade; unitId de outra unidade = 403; não move para fora nem limpa', async () => {
      const created = await http().post('/api/students').set(auth(tokens.profA)).send({ name: '[e2e-uscope] Criado pelo profA' }).expect(201);
      assert.equal(created.body.unitId, unitA);
      await http().post('/api/students').set(auth(tokens.profA)).send({ name: '[e2e-uscope] fora', unitId: unitB }).expect(403);
      assert.equal(await prisma.student.count({ where: { name: '[e2e-uscope] fora' } }), 0);
      await http().patch(`/api/students/${stuA}`).set(auth(tokens.profA)).send({ unitId: unitB }).expect(403);
      await http().patch(`/api/students/${stuA}`).set(auth(tokens.profA)).send({ unitId: null }).expect(403);
      assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: stuA } })).unitId, unitA);
      await http().patch(`/api/students/${stuA}`).set(auth(tokens.profA)).send({ phone: '(62) 90000-0000' }).expect(200);
    });

    it('rotas do aluno por id (conta de acesso, responsáveis, graduações, certificados) também respeitam a unidade', async () => {
      await http().get(`/api/students/${stuB}/account`).set(auth(tokens.profA)).expect(404);
      await http().get(`/api/students/${stuB}/guardians`).set(auth(tokens.profA)).expect(404);
      await http().post(`/api/students/${stuB}/guardians`).set(auth(tokens.profA)).send({ name: 'Intruso' }).expect(404);
      await http().get(`/api/students/${stuA}/guardians`).set(auth(tokens.profA)).expect(200);
      await http().get(`/api/graduations/students/${stuB}`).set(auth(tokens.profA)).expect(404);
      await http().post(`/api/graduations/students/${stuB}`).set(auth(tokens.profA)).send({ graduationLevelId: 1, graduatedAt: '2026-01-01' }).expect(404);
      await http().get(`/api/graduations/students/${stuA}`).set(auth(tokens.profA)).expect(200);
      await http().post('/api/certificates').set(auth(tokens.profA)).send({ studentId: stuB, title: 'x' }).expect(400);
      const cert = await http().post('/api/certificates').set(auth(tokens.mestre)).send({ studentId: stuB, title: '[e2e-uscope] Cert B' }).expect(201);
      const certA = await http().post('/api/certificates').set(auth(tokens.mestre)).send({ studentId: stuA, title: '[e2e-uscope] Cert A' }).expect(201);
      const list = await http().get('/api/certificates?limit=200').set(auth(tokens.profA)).expect(200);
      assert.deepEqual(mine(list.body, [cert.body.id, certA.body.id]), [certA.body.id]);
      assert.equal(Number(list.headers['x-total-count']), list.body.length);
      await http().get(`/api/certificates/${cert.body.id}`).set(auth(tokens.profA)).expect(404);
      await http().delete(`/api/certificates/${cert.body.id}`).set(auth(tokens.profA)).expect(403);
      assert.equal(await prisma.certificate.count({ where: { id: cert.body.id } }), 1);
    });
  });

  describe('turmas (classes)', () => {
    it('lista, leitura, edição, remoção, matrícula e geração de aulas da turma da B = 404/400; da própria unidade funciona', async () => {
      const list = await http().get('/api/classes?limit=200').set(auth(tokens.profA)).expect(200);
      assert.deepEqual(mine(list.body, [classA, classB]), [classA]);
      assert.equal(Number(list.headers['x-total-count']), list.body.length);
      assert.deepEqual((await http().get(`/api/classes?unitId=${unitB}`).set(auth(tokens.profA)).expect(200)).body, []);

      await http().get(`/api/classes/${classB}`).set(auth(tokens.profA)).expect(404);
      await http().patch(`/api/classes/${classB}`).set(auth(tokens.profA)).send({ name: 'invadida' }).expect(404);
      await http().delete(`/api/classes/${classB}`).set(auth(tokens.profA)).expect(403);
      await http().get(`/api/classes/${classB}/students`).set(auth(tokens.profA)).expect(404);
      await http().post(`/api/classes/${classB}/students`).set(auth(tokens.profA)).send({ studentId: stuA }).expect(404);
      await http().delete(`/api/classes/${classB}/students/${stuB}`).set(auth(tokens.profA)).expect(404);
      await http().post(`/api/classes/${classB}/generate-lessons`).set(auth(tokens.profA)).send({ from: todaySaoPaulo(0), to: todaySaoPaulo(14) }).expect(404);
      const stored = await prisma.class.findUniqueOrThrow({ where: { id: classB } });
      assert.equal(stored.name, '[e2e-uscope] Turma B');
      assert.equal(stored.status, 'ACTIVE');
      assert.equal(await prisma.classStudent.count({ where: { classId: classB, studentId: stuA } }), 0);

      await http().get(`/api/classes/${classA}`).set(auth(tokens.profA)).expect(200);
      const students = await http().get(`/api/classes/${classA}/students`).set(auth(tokens.profA)).expect(200);
      assert.deepEqual(students.body.map((s: { studentId: number }) => s.studentId), [stuA]);
    });

    it('matricular aluno da B numa turma da A = 400; criar turma em outra unidade = 403, sem unitId assume a A', async () => {
      await http().post(`/api/classes/${classA}/students`).set(auth(tokens.profA)).send({ studentId: stuB }).expect(400);
        assert.equal(await prisma.classStudent.count({ where: { classId: classA, studentId: stuB } }), 0);
      await http().post('/api/classes').set(auth(tokens.profA)).send({ name: '[e2e-uscope] fora', unitId: unitB }).expect(403);
      const created = await http().post('/api/classes').set(auth(tokens.profA)).send({ name: '[e2e-uscope] Turma do profA', weekday: 3 }).expect(201);
      assert.equal(created.body.unitId, unitA);
      await http().patch(`/api/classes/${classA}`).set(auth(tokens.profA)).send({ unitId: unitB }).expect(403);
      const gen = await http().post(`/api/classes/${classA}/generate-lessons`).set(auth(tokens.profA)).send({ from: todaySaoPaulo(0), to: todaySaoPaulo(7) }).expect(201);
      assert.ok(gen.body.created >= 0);
      const generated = await prisma.lesson.findMany({ where: { classId: classA, id: { not: lessonA } } });
      assert.ok(generated.every((l) => l.unitId === unitA));
    });
  });

  describe('aulas (lessons) e frequência (attendance)', () => {
    it('profA lista só aulas da A — inclusive a unidade herdada da turma; aula da B (própria ou herdada) = 404', async () => {
      const list = await http().get('/api/lessons?limit=200').set(auth(tokens.profA)).expect(200);
      const got = mine(list.body, [lessonA, lessonB, lessonInheritB]);
      assert.deepEqual(got, [lessonA]);
      assert.equal(Number(list.headers['x-total-count']), list.body.length);

      await http().get(`/api/lessons/${lessonB}`).set(auth(tokens.profA)).expect(404);
      await http().get(`/api/lessons/${lessonInheritB}`).set(auth(tokens.profA)).expect(404);
      await http().patch(`/api/lessons/${lessonB}`).set(auth(tokens.profA)).send({ notes: 'invadida' }).expect(404);
      await http().delete(`/api/lessons/${lessonB}`).set(auth(tokens.profA)).expect(403);
      await http().delete(`/api/lessons/${lessonInheritB}`).set(auth(tokens.profA)).expect(403);
      for (const id of [lessonB, lessonInheritB]) {
        const stored = await prisma.lesson.findUniqueOrThrow({ where: { id } });
        assert.equal(stored.status, 'ACTIVE');
        assert.equal(stored.notes, null);
      }
      await http().get(`/api/lessons/${lessonA}`).set(auth(tokens.profA)).expect(200);
    });

    it('criar aula: turma da B = 400; unitId da B numa turma da A = 403; sem unitId na turma da A funciona; mover para a B = 403', async () => {
      await http().post('/api/lessons').set(auth(tokens.profA)).send({ classId: classB, date: todaySaoPaulo(3) }).expect(400);
      await http().post('/api/lessons').set(auth(tokens.profA)).send({ classId: classA, unitId: unitB, date: todaySaoPaulo(3) }).expect(403);
      const ok = await http().post('/api/lessons').set(auth(tokens.profA)).send({ classId: classA, date: todaySaoPaulo(3) }).expect(201);
      await http().get(`/api/lessons/${ok.body.id}`).set(auth(tokens.profA)).expect(200);
      await http().patch(`/api/lessons/${ok.body.id}`).set(auth(tokens.profA)).send({ classId: classB }).expect(400);
      await http().patch(`/api/lessons/${ok.body.id}`).set(auth(tokens.profA)).send({ unitId: unitB }).expect(403);
      await http().patch(`/api/lessons/${ok.body.id}`).set(auth(tokens.profA)).send({ notes: 'ok' }).expect(200);
      assert.equal(await prisma.lesson.count({ where: { classId: classB, notes: 'ok' } }), 0);
    });

    it('chamada: roster e registro da aula da B = 404; da A funciona; GET /attendance só mostra aulas da A', async () => {
      await http().get(`/api/attendance/lessons/${lessonB}`).set(auth(tokens.profA)).expect(404);
      await http().get(`/api/attendance/lessons/${lessonInheritB}`).set(auth(tokens.profA)).expect(404);
      await http().post(`/api/attendance/lessons/${lessonB}`).set(auth(tokens.profA)).send([{ studentId: stuB, present: true }]).expect(404);
      assert.equal(await prisma.attendance.count({ where: { lessonId: lessonB } }), 0);

      const roster = await http().get(`/api/attendance/lessons/${lessonA}`).set(auth(tokens.profA)).expect(200);
      assert.deepEqual(roster.body.map((r: { studentId: number }) => r.studentId), [stuA]);
      await http().post(`/api/attendance/lessons/${lessonA}`).set(auth(tokens.profA)).send([{ studentId: stuA, present: true }]).expect(201);
      // o MESTRE registra na B (para o GET /attendance ter dado das duas unidades)
      await http().post(`/api/attendance/lessons/${lessonB}`).set(auth(tokens.mestre)).send([{ studentId: stuB, present: false }]).expect(201);

      const list = await http().get('/api/attendance').set(auth(tokens.profA)).expect(200);
      assert.ok(list.body.length > 0);
      assert.ok(list.body.every((a: { lessonId: number }) => a.lessonId !== lessonB));
      assert.ok(list.body.some((a: { lessonId: number }) => a.lessonId === lessonA));
    });
  });

  describe('eventos, comunicados, unidades e dashboard', () => {
    it('eventos: profA vê os da A e os do grupo inteiro, não os da B; só altera os da própria unidade', async () => {
      const list = await http().get('/api/events?limit=200').set(auth(tokens.profA)).expect(200);
      assert.deepEqual(mine(list.body, [eventA, eventB, eventGroup]), sorted([eventA, eventGroup]));
      assert.equal(Number(list.headers['x-total-count']), list.body.length);
      await http().get(`/api/events/${eventB}`).set(auth(tokens.profA)).expect(404);
      await http().get(`/api/events/${eventGroup}`).set(auth(tokens.profA)).expect(200);
      await http().patch(`/api/events/${eventB}`).set(auth(tokens.profA)).send({ title: 'invadido' }).expect(404);
      await http().delete(`/api/events/${eventB}`).set(auth(tokens.profA)).expect(403);
      await http().get(`/api/events/${eventB}/participants`).set(auth(tokens.profA)).expect(404);
      await http().patch(`/api/events/${eventGroup}`).set(auth(tokens.profA)).send({ title: 'do grupo' }).expect(403);
      await http().delete(`/api/events/${eventGroup}`).set(auth(tokens.profA)).expect(403);
      await http().patch(`/api/events/${eventA}`).set(auth(tokens.profA)).send({ unitId: unitB }).expect(403);
      await http().post('/api/events').set(auth(tokens.profA)).send({ title: '[e2e-uscope] fora', date: new Date().toISOString(), unitId: unitB }).expect(403);
      const created = await http().post('/api/events').set(auth(tokens.profA)).send({ title: '[e2e-uscope] Do profA', date: new Date(Date.now() + 86_400_000).toISOString() }).expect(201);
      assert.equal(created.body.unitId, unitA);
      await http().patch(`/api/events/${eventA}`).set(auth(tokens.profA)).send({ location: 'Quadra' }).expect(200);
      assert.equal((await prisma.event.findUniqueOrThrow({ where: { id: eventB } })).title, '[e2e-uscope] Evento B');
      assert.equal(await prisma.event.count({ where: { id: eventGroup } }), 1);
    });

    it('comunicados: profA vê os da A e os gerais, não os da B; só altera os da própria unidade', async () => {
      const list = await http().get('/api/announcements?limit=200').set(auth(tokens.profA)).expect(200);
      assert.deepEqual(mine(list.body, [announcementA, announcementB, announcementGroup]), sorted([announcementA, announcementGroup]));
      assert.equal(Number(list.headers['x-total-count']), list.body.length);
      assert.ok(list.body.every((a: { createdByUserId?: number }) => 'createdByUserId' in a), 'staff continua vendo o autor');
      await http().get(`/api/announcements/${announcementB}`).set(auth(tokens.profA)).expect(404);
      await http().patch(`/api/announcements/${announcementB}`).set(auth(tokens.profA)).send({ title: 'invadido' }).expect(404);
      await http().delete(`/api/announcements/${announcementB}`).set(auth(tokens.profA)).expect(403);
      await http().patch(`/api/announcements/${announcementGroup}`).set(auth(tokens.profA)).send({ title: 'geral' }).expect(403);
      await http().post('/api/announcements').set(auth(tokens.profA)).send({ title: '[e2e-uscope] fora', body: 'texto x', unitId: unitB }).expect(403);
      const created = await http().post('/api/announcements').set(auth(tokens.profA)).send({ title: '[e2e-uscope] Do profA', body: 'texto x' }).expect(201);
      assert.equal(created.body.unitId, unitA);
      assert.equal((await prisma.announcement.findUniqueOrThrow({ where: { id: announcementB } })).isActive, true);
    });

    it('unidades: profA vê só a A (lista e por id); o Mestre vê as duas', async () => {
      const list = await http().get('/api/units?limit=200').set(auth(tokens.profA)).expect(200);
      assert.deepEqual(ids(list.body), [unitA]);
      assert.equal(list.headers['x-total-count'], '1');
      await http().get(`/api/units/${unitA}`).set(auth(tokens.profA)).expect(200);
      await http().get(`/api/units/${unitB}`).set(auth(tokens.profA)).expect(404);
      const all = await http().get('/api/units?limit=200').set(auth(tokens.mestre)).expect(200);
      assert.deepEqual(ids(all.body), sorted([unitA, unitB]));
    });

    it('dashboard: os números do profA são só os da unidade A (o Mestre vê o consolidado)', async () => {
      const [pa, ms] = await Promise.all([
        http().get('/api/dashboard').set(auth(tokens.profA)).expect(200),
        http().get('/api/dashboard').set(auth(tokens.mestre)).expect(200),
      ]);
      // sem unidade (legado) conta para o professor restrito
      const activeInA = await prisma.student.count({ where: { organizationId: orgId, status: 'ACTIVE', OR: [{ unitId: unitA }, { unitId: null }] } });
      const activeAll = await prisma.student.count({ where: { organizationId: orgId, status: 'ACTIVE' } });
      assert.equal(pa.body.students.active, activeInA);
      assert.equal(ms.body.students.active, activeAll);
      assert.ok(activeAll > activeInA);
      const classesInA = await prisma.class.count({ where: { organizationId: orgId, status: 'ACTIVE', OR: [{ unitId: unitA }, { unitId: null }] } });
      assert.equal(pa.body.classes.active, classesInA);
      assert.equal(ms.body.classes.active, await prisma.class.count({ where: { organizationId: orgId, status: 'ACTIVE' } }));
      const titles = (b: { upcomingEvents: Array<{ title: string }> }) => b.upcomingEvents.map((e) => e.title);
      assert.ok(!titles(pa.body).includes('[e2e-uscope] Evento B'));
    });
  });

  describe('quem NÃO fica restrito', () => {
    it('profFree (PROFESSOR sem nenhum registro) vê e edita tudo, como antes', async () => {
      const students = await http().get('/api/students?limit=200').set(auth(tokens.profFree)).expect(200);
      assert.deepEqual(mine(students.body, [stuA, stuB, stuNone]), sorted([stuA, stuB, stuNone]));
      assert.equal(Number(students.headers['x-total-count']), students.body.length);
      await http().get(`/api/students/${stuB}`).set(auth(tokens.profFree)).expect(200);
      await http().patch(`/api/students/${stuB}`).set(auth(tokens.profFree)).send({ phone: '(62) 91111-1111' }).expect(200);
      await http().get(`/api/classes/${classB}`).set(auth(tokens.profFree)).expect(200);
      await http().get(`/api/lessons/${lessonInheritB}`).set(auth(tokens.profFree)).expect(200);
      // Chamada: sem restricao de UNIDADE, mas o PROFESSOR so le a chamada das turmas em que e o responsavel (classB nao e dele) => 404.
      await http().get(`/api/attendance/lessons/${lessonB}`).set(auth(tokens.profFree)).expect(404);
      await http().get(`/api/events/${eventB}`).set(auth(tokens.profFree)).expect(200);
      await http().get(`/api/announcements/${announcementB}`).set(auth(tokens.profFree)).expect(200);
      const units = await http().get('/api/units?limit=200').set(auth(tokens.profFree)).expect(200);
      assert.deepEqual(ids(units.body), sorted([unitA, unitB]));
      const created = await http().post('/api/students').set(auth(tokens.profFree)).send({ name: '[e2e-uscope] Criado pelo profFree' }).expect(201);
      assert.equal(created.body.unitId, null, 'sem restrição não assume unidade nenhuma');
    });

    it('MESTRE vê e edita tudo', async () => {
      const students = await http().get('/api/students?limit=200').set(auth(tokens.mestre)).expect(200);
      assert.deepEqual(mine(students.body, [stuA, stuB, stuNone]), sorted([stuA, stuB, stuNone]));
      await http().get(`/api/classes/${classB}`).set(auth(tokens.mestre)).expect(200);
      await http().get(`/api/attendance/lessons/${lessonInheritB}`).set(auth(tokens.mestre)).expect(200);
      await http().patch(`/api/events/${eventGroup}`).set(auth(tokens.mestre)).send({ location: 'Sede' }).expect(200);
      await http().patch(`/api/students/${stuB}`).set(auth(tokens.mestre)).send({ unitId: unitA }).expect(200);
      await http().patch(`/api/students/${stuB}`).set(auth(tokens.mestre)).send({ unitId: unitB }).expect(200);
    });

    it('ALUNO não muda, mesmo com registro em UserUnitAccess: segue vendo os eventos de todas as unidades e as rotas /me', async () => {
      const events = await http().get('/api/events?limit=200').set(auth(tokens.aluno)).expect(200);
      assert.deepEqual(mine(events.body, [eventA, eventB, eventGroup]), sorted([eventA, eventB, eventGroup]));
      await http().get('/api/students/me').set(auth(tokens.aluno)).expect(200);
      await http().get('/api/classes/me').set(auth(tokens.aluno)).expect(200);
      await http().get('/api/lessons/me').set(auth(tokens.aluno)).expect(200);
      await http().get('/api/attendance/me').set(auth(tokens.aluno)).expect(200);
      await http().get('/api/students').set(auth(tokens.aluno)).expect(403);
    });

    it('rotas /me do profA (escopo por vínculo) continuam respondendo, sem filtro por unidade', async () => {
      await http().get('/api/students/me').set(auth(tokens.profA)).expect(200);
      await http().get('/api/classes/me').set(auth(tokens.profA)).expect(200);
      await http().get('/api/lessons/me').set(auth(tokens.profA)).expect(200);
      await http().get('/api/attendance/me').set(auth(tokens.profA)).expect(200);
    });

    it('trocar as unidades pela API muda o acesso na hora: profFree restrito à B passa a não ver a A; ao esvaziar, volta a ver tudo', async () => {
      await http().put(`/api/teachers/${membershipIds.profFree}/units`).set(auth(tokens.mestre)).send({ unitIds: [unitB] }).expect(200);
      const restricted = await http().get('/api/students?limit=200').set(auth(tokens.profFree)).expect(200);
      assert.deepEqual(mine(restricted.body, [stuA, stuB, stuNone]), sorted([stuB, stuNone]));
      await http().get(`/api/students/${stuA}`).set(auth(tokens.profFree)).expect(404);
      await http().put(`/api/teachers/${membershipIds.profFree}/units`).set(auth(tokens.mestre)).send({ unitIds: [] }).expect(200);
      const free = await http().get('/api/students?limit=200').set(auth(tokens.profFree)).expect(200);
      assert.deepEqual(mine(free.body, [stuA, stuB, stuNone]), sorted([stuA, stuB, stuNone]));
    });
  });

  describe('multi-tenant', () => {
    it('o Mestre do outro grupo não vê nem altera nada deste grupo; o profB também não enxerga a A', async () => {
      const students = await http().get('/api/students?limit=200').set(auth(tokens.mestreOther)).expect(200);
      assert.deepEqual(mine(students.body, [stuA, stuB, stuNone]), []);
      await http().get(`/api/students/${stuA}`).set(auth(tokens.mestreOther)).expect(404);
      await http().get(`/api/classes/${classA}`).set(auth(tokens.mestreOther)).expect(404);
      await http().get(`/api/attendance/lessons/${lessonA}`).set(auth(tokens.mestreOther)).expect(404);
      const units = await http().get('/api/units?limit=200').set(auth(tokens.mestreOther)).expect(200);
      assert.deepEqual(ids(units.body), [otherUnit]);

      const asB = await http().get('/api/students?limit=200').set(auth(tokens.profB)).expect(200);
      assert.deepEqual(mine(asB.body, [stuA, stuB, stuNone]), sorted([stuB, stuNone]));
      await http().get(`/api/students/${stuA}`).set(auth(tokens.profB)).expect(404);
    });

    it('UserUnitAccess de outro grupo não vale aqui: o escopo é por (usuário, organização do token)', async () => {
      // profFree ganha um registro numa unidade do OUTRO grupo (lixo/legado): neste grupo continua sem restrição.
      await prisma.userUnitAccess.create({ data: { organizationId: otherOrgId, userId: userIds.profFree, unitId: otherUnit } });
      const res = await http().get('/api/students?limit=200').set(auth(tokens.profFree)).expect(200);
      assert.deepEqual(mine(res.body, [stuA, stuB, stuNone]), sorted([stuA, stuB, stuNone]));
      await prisma.userUnitAccess.deleteMany({ where: { userId: userIds.profFree } });
    });
  });
});
