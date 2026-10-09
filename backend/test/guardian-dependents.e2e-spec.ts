import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { DEV_PASSWORD, loginAs } from './utils/list-helpers';

/**
 * Seletor de dependente do app (RESPONSAVEL com MAIS DE UM StudentGuardian): as rotas "/me" que
 * dependem de um aluno aceitam `?studentId=` — passaporte, finance/me (+ /summary), attendance/me e
 * lessons/me; /graduations/students/:studentId e as mutações do passaporte/eventos já recebiam o
 * studentId. A regra única do vínculo é StudentsService.resolveLink (via requireLinkedStudent):
 * aluno sem vínculo, de outra organização ou inexistente => o MESMO 404 (não vaza existência).
 *
 * Fixtures em ORGANIZAÇÕES NOVAS (não toca no seed): org 1 com um RESPONSAVEL (Carlos) com 2
 * dependentes de dados DISTINTOS (Alfa e Beta), um ALUNO (Ana, vínculo próprio) e um aluno sem
 * vínculo (Zeca); org 2 com um aluno (Bia). Tudo é apagado no `after`.
 */
const DAY = 86_400_000;

describe('Responsável com 2 dependentes: ?studentId= nas rotas /me (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const tag = `${Date.now()}`;

  let org1Id: number;
  let org2Id: number;
  const userIds: number[] = [];
  let carlosToken: string;
  let anaToken: string;
  let biaToken: string;
  let alfaId: number;
  let betaId: number;
  let anaId: number;
  let zecaId: number;
  let biaId: number;
  let eventId: number;
  let carlosUserId: number;

  const day = (offset: number) => new Date(new Date().setUTCHours(0, 0, 0, 0) + offset * DAY);

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    const passwordHash = await bcrypt.hash(DEV_PASSWORD, 4);
    const mkUser = async (label: string) => {
      const email = `${label}-${tag}@dep.local`;
      const user = await prisma.user.create({
        data: { email, passwordHash, name: `${label} ${tag}`, userType: 'MEMBER', status: 'ACTIVE' },
      });
      userIds.push(user.id);
      return { id: user.id, email };
    };
    const mkOrg = (label: string) =>
      prisma.organization.create({
        data: { name: `E2E dep ${label} ${tag}`, slug: `e2e-dep-${label}-${tag}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
      });

    const org1 = await mkOrg('a');
    const org2 = await mkOrg('b');
    org1Id = org1.id;
    org2Id = org2.id;

    const carlos = await mkUser('carlos');
    const ana = await mkUser('ana');
    const bia = await mkUser('bia');
    carlosUserId = carlos.id;
    await prisma.organizationUser.createMany({
      data: [
        { organizationId: org1Id, userId: carlos.id, role: OrgRole.RESPONSAVEL, status: 'ACTIVE' },
        { organizationId: org1Id, userId: ana.id, role: OrgRole.ALUNO, status: 'ACTIVE' },
        { organizationId: org2Id, userId: bia.id, role: OrgRole.ALUNO, status: 'ACTIVE' },
      ],
    });

    const mkStudent = async (organizationId: number, name: string, extra: { userId?: number; birthDate?: Date } = {}) =>
      (await prisma.student.create({ data: { organizationId, name: `${name} ${tag}`, status: 'ACTIVE', ...extra } })).id;
    alfaId = await mkStudent(org1Id, 'Alfa', { birthDate: new Date('2015-05-05T00:00:00.000Z') });
    betaId = await mkStudent(org1Id, 'Beta', { birthDate: new Date('2012-02-02T00:00:00.000Z') });
    anaId = await mkStudent(org1Id, 'Ana', { userId: ana.id });
    zecaId = await mkStudent(org1Id, 'Zeca');
    biaId = await mkStudent(org2Id, 'Bia', { userId: bia.id });
    for (const studentId of [alfaId, betaId]) {
      await prisma.studentGuardian.create({
        data: { organizationId: org1Id, studentId, userId: carlos.id, name: `Carlos ${tag}` },
      });
    }

    // Turmas/aulas/presenças: Alfa tem 3 aulas (2 presenças + 1 falta); Beta tem 2 aulas (1 presença + 1 futura).
    const classAlfa = await prisma.class.create({ data: { organizationId: org1Id, name: `Turma Alfa ${tag}` } });
    const classBeta = await prisma.class.create({ data: { organizationId: org1Id, name: `Turma Beta ${tag}` } });
    await prisma.classStudent.createMany({
      data: [
        { organizationId: org1Id, classId: classAlfa.id, studentId: alfaId },
        { organizationId: org1Id, classId: classBeta.id, studentId: betaId },
      ],
    });
    const lesson = async (classId: number, offset: number) =>
      (await prisma.lesson.create({ data: { organizationId: org1Id, classId, date: day(offset), notes: `L${offset} ${tag}` } })).id;
    const att = (lessonId: number, studentId: number, present: boolean) =>
      prisma.attendance.create({ data: { organizationId: org1Id, lessonId, studentId, present } });
    await att(await lesson(classAlfa.id, -1), alfaId, true);
    await att(await lesson(classAlfa.id, -2), alfaId, true);
    await att(await lesson(classAlfa.id, -3), alfaId, false);
    await att(await lesson(classBeta.id, -1), betaId, true);
    await lesson(classBeta.id, 3);

    // Financeiro: Alfa pago 5000 + atrasado 10000; Beta em aberto 30000 (futuro); Ana 777; Zeca/Bia valores sentinela.
    const fin = (studentId: number, organizationId: number, amountCents: number, dueOffset: number, status: 'PAID' | 'PENDING') =>
      prisma.financialRecord.create({
        data: { organizationId, studentId, description: `Fin ${amountCents} ${tag}`, amountCents, dueDate: day(dueOffset), status },
      });
    await fin(alfaId, org1Id, 5000, -40, 'PAID');
    await fin(alfaId, org1Id, 10000, -10, 'PENDING');
    await fin(betaId, org1Id, 30000, 20, 'PENDING');
    await fin(anaId, org1Id, 777, 5, 'PENDING');
    await fin(zecaId, org1Id, 424242, 5, 'PENDING');
    await fin(biaId, org2Id, 515151, 5, 'PENDING');

    // Graduações: Alfa Crua -> Amarela; Beta Azul.
    const system = await prisma.graduationSystem.create({ data: { organizationId: org1Id, name: `Sistema ${tag}` } });
    const level = async (order: number, name: string) =>
      (await prisma.graduationLevel.create({ data: { organizationId: org1Id, graduationSystemId: system.id, order, name } })).id;
    const [crua, amarela, azul] = [await level(1, 'Crua'), await level(2, 'Amarela'), await level(3, 'Azul')];
    const grad = (studentId: number, graduationLevelId: number, offset: number) =>
      prisma.studentGraduation.create({
        data: { organizationId: org1Id, studentId, graduationLevelId, graduatedAt: day(offset) },
      });
    await grad(alfaId, crua, -200);
    await grad(alfaId, amarela, -100);
    await grad(betaId, azul, -50);

    eventId = (await prisma.event.create({ data: { organizationId: org1Id, title: `Evento ${tag}`, date: day(10) } })).id;

    carlosToken = (await loginAs(app, carlos.email)).token;
    anaToken = (await loginAs(app, ana.email)).token;
    biaToken = (await loginAs(app, bia.email)).token;
  });

  after(async () => {
    const orgs = [org1Id, org2Id].filter((id) => id !== undefined);
    await prisma.publicProfile.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.eventParticipant.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.event.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.attendance.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.lesson.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.classStudent.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.class.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.studentGraduation.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.graduationLevel.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.graduationSystem.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.financialRecord.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.studentGuardian.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.student.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
    await prisma.$disconnect();
    await app.close();
  });

  const get = (url: string, token: string, query: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).get(url).query(query).set('Authorization', `Bearer ${token}`);

  // ---------------------------------------------------------------------------------------
  it('sanidade: /students/me do responsável lista os 2 dependentes (e só eles)', async () => {
    const res = await get('/api/students/me', carlosToken).expect(200);
    assert.deepEqual(
      (res.body as { id: number }[]).map((s) => s.id).sort((a, b) => a - b),
      [alfaId, betaId].sort((a, b) => a - b),
    );
  });

  it('passaporte: ?studentId= escolhe cada dependente (estatísticas e graduação distintas); viewer.isGuardian', async () => {
    const alfa = (await get('/api/passport/me', carlosToken, { studentId: alfaId }).expect(200)).body;
    const beta = (await get('/api/passport/me', carlosToken, { studentId: betaId }).expect(200)).body;
    assert.equal(alfa.student.id, alfaId);
    assert.equal(beta.student.id, betaId);
    assert.equal(alfa.currentGraduation.name, 'Amarela');
    assert.equal(beta.currentGraduation.name, 'Azul');
    assert.equal(alfa.stats.aulas, 2); // presenças de Alfa
    assert.equal(beta.stats.aulas, 1);
    assert.equal(alfa.stats.graduacoes, 2);
    assert.equal(beta.stats.graduacoes, 1);
    assert.equal(alfa.viewer.isGuardian, true);
    assert.equal(beta.viewer.isGuardian, true);
  });

  it('financeiro: lista E resumo no MESMO escopo por dependente; sem ?studentId= segue agregando os dois (compatível)', async () => {
    const scope = async (query: Record<string, unknown>) => {
      const list = await get('/api/finance/me', carlosToken, query).expect(200);
      const summary = (await get('/api/finance/me/summary', carlosToken, query).expect(200)).body;
      return { items: list.body as { studentId: number; amountCents: number }[], total: Number(list.headers['x-total-count']), summary };
    };
    const alfa = await scope({ studentId: alfaId });
    assert.deepEqual(alfa.items.map((r) => r.studentId), [alfaId, alfaId]);
    assert.equal(alfa.total, 2);
    assert.deepEqual(
      { open: alfa.summary.openCents, overdue: alfa.summary.overdueCents, paid: alfa.summary.paidCents, n: alfa.summary.openCount + alfa.summary.paidCount },
      { open: 10000, overdue: 10000, paid: 5000, n: alfa.total },
    );

    const beta = await scope({ studentId: betaId });
    assert.deepEqual(beta.items.map((r) => [r.studentId, r.amountCents]), [[betaId, 30000]]);
    assert.equal(beta.total, 1);
    assert.deepEqual(
      { open: beta.summary.openCents, overdue: beta.summary.overdueCents, paid: beta.summary.paidCents, n: beta.summary.openCount + beta.summary.paidCount },
      { open: 30000, overdue: 0, paid: 0, n: beta.total },
    );

    const all = await scope({});
    assert.equal(all.total, 3);
    assert.equal(all.summary.openCents, 40000);
    assert.ok(!all.items.some((r) => [424242, 515151, 777].includes(r.amountCents)), 'financeiro de terceiros não pode vazar');
  });

  it('frequência: registros e indicadores só do dependente escolhido', async () => {
    const alfa = (await get('/api/attendance/me', carlosToken, { studentId: alfaId }).expect(200)).body;
    const beta = (await get('/api/attendance/me', carlosToken, { studentId: betaId }).expect(200)).body;
    assert.equal(alfa.records.length, 3);
    assert.ok(alfa.records.every((r: { studentId: number }) => r.studentId === alfaId));
    assert.equal(alfa.last30dPercent, 67); // 2 de 3
    assert.equal(alfa.currentStreak, 2); // as duas mais recentes são presenças; a falta é a mais antiga
    assert.equal(beta.records.length, 1);
    assert.ok(beta.records.every((r: { studentId: number }) => r.studentId === betaId));
    assert.equal(beta.last30dPercent, 100);
    assert.equal(beta.currentStreak, 1);
    const all = (await get('/api/attendance/me', carlosToken).expect(200)).body;
    assert.equal(all.records.length, 4); // compatível: agrega os dois
  });

  it('aulas: só as aulas das turmas do dependente escolhido', async () => {
    const lessons = async (studentId?: number) => {
      const res = await get('/api/lessons/me', carlosToken, studentId ? { studentId } : {}).expect(200);
      return { items: res.body as { notes: string; classId: number }[], total: Number(res.headers['x-total-count']) };
    };
    const alfa = await lessons(alfaId);
    const beta = await lessons(betaId);
    assert.equal(alfa.items.length, 3);
    assert.equal(alfa.total, 3);
    assert.equal(beta.items.length, 2);
    assert.equal(beta.total, 2);
    assert.equal(new Set([...alfa.items, ...beta.items].map((l) => l.classId)).size, 2);
    assert.equal((await lessons()).items.length, 5); // compatível: união
  });

  it('graduações: cada dependente tem o seu histórico (rota que já recebia o studentId)', async () => {
    const alfa = (await get(`/api/graduations/students/${alfaId}`, carlosToken).expect(200)).body as { graduationLevel: { name: string } }[];
    const beta = (await get(`/api/graduations/students/${betaId}`, carlosToken).expect(200)).body as { graduationLevel: { name: string } }[];
    assert.deepEqual(alfa.map((g) => g.graduationLevel.name), ['Amarela', 'Crua']);
    assert.deepEqual(beta.map((g) => g.graduationLevel.name), ['Azul']);
  });

  // ---------------------------------------------------------------------------------------
  // 404 idêntico: sem vínculo (Zeca, mesma org), outra organização (Bia) e inexistente.
  // ---------------------------------------------------------------------------------------
  const ME_ROUTES: Array<[string, (id: number) => Record<string, unknown>]> = [
    ['/api/passport/me', (id) => ({ studentId: id })],
    ['/api/finance/me', (id) => ({ studentId: id })],
    ['/api/finance/me/summary', (id) => ({ studentId: id })],
    ['/api/attendance/me', (id) => ({ studentId: id })],
    ['/api/lessons/me', (id) => ({ studentId: id })],
  ];
  const MISSING_ID = 2_000_000_000;

  it('responsável pedindo aluno SEM vínculo / de outra organização / inexistente: 404 com corpo IDÊNTICO e sem dado algum', async () => {
    for (const [url, query] of ME_ROUTES) {
      const bodies: string[] = [];
      for (const id of [zecaId, biaId, MISSING_ID]) {
        const res = await get(url, carlosToken, query(id));
        assert.equal(res.status, 404, `${url} studentId=${id}`);
        bodies.push(JSON.stringify(res.body));
      }
      assert.equal(new Set(bodies).size, 1, `${url}: corpos diferentes revelam existência: ${bodies.join(' | ')}`);
      assert.ok(!/424242|515151|Zeca|Bia/.test(bodies[0] ?? ''), `${url}: vazou dado de terceiro`);
    }
    // graduações (rota que já existia) segue o mesmo contrato
    const g = [] as string[];
    for (const id of [zecaId, biaId, MISSING_ID]) {
      const res = await get(`/api/graduations/students/${id}`, carlosToken);
      assert.equal(res.status, 404);
      g.push(JSON.stringify(res.body));
    }
    assert.equal(new Set(g).size, 1);
  });

  it('ALUNO (vínculo único) não enxerga dependente de outro responsável: 404 idêntico; sem ?studentId= vê só o próprio', async () => {
    for (const [url, query] of ME_ROUTES) {
      const bodies: string[] = [];
      for (const id of [alfaId, betaId, MISSING_ID]) {
        const res = await get(url, anaToken, query(id));
        assert.equal(res.status, 404, `${url} studentId=${id}`);
        bodies.push(JSON.stringify(res.body));
      }
      assert.equal(new Set(bodies).size, 1, `${url}: corpos diferentes`);
    }
    const own = (await get('/api/passport/me', anaToken).expect(200)).body;
    assert.equal(own.student.id, anaId);
    const ownByParam = (await get('/api/passport/me', anaToken, { studentId: anaId }).expect(200)).body;
    assert.equal(ownByParam.student.id, anaId);
    const fin = (await get('/api/finance/me', anaToken, { studentId: anaId }).expect(200)).body as { amountCents: number }[];
    assert.deepEqual(fin.map((r) => r.amountCents), [777]);
    await get(`/api/graduations/students/${alfaId}`, anaToken).expect(404);
  });

  it('aluno de OUTRA organização não alcança os dependentes (nem pelo id): 404', async () => {
    for (const [url, query] of ME_ROUTES) {
      await get(url, biaToken, query(alfaId)).expect(404);
    }
    await get(`/api/graduations/students/${alfaId}`, biaToken).expect(404);
  });

  it('studentId inválido (0, negativo, texto) => 400; com nome de parâmetro desconhecido continua 400 (whitelist)', async () => {
    for (const bad of ['0', '-3', 'abc', '1.5']) {
      await get('/api/passport/me', carlosToken, { studentId: bad }).expect(400);
      await get('/api/finance/me', carlosToken, { studentId: bad }).expect(400);
    }
    await get('/api/finance/me/summary', carlosToken, { dependentId: alfaId }).expect(400);
  });

  // ---------------------------------------------------------------------------------------
  // Mutações que o app faz com o dependente escolhido (contrato que já existia; prova ponta a ponta).
  // ---------------------------------------------------------------------------------------
  it('passaporte: consentimento + publicação gravam SÓ o dependente escolhido; despublicar idem', async () => {
    const post = (url: string, body: object) => request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${carlosToken}`).send(body);
    await post('/api/passport/publish', { studentId: alfaId }).expect(400); // sem consentimento do responsável
    await request(app.getHttpServer())
      .patch('/api/passport/guardian-consent')
      .set('Authorization', `Bearer ${carlosToken}`)
      .send({ studentId: alfaId, consent: true })
      .expect(200);
    await post('/api/passport/publish', { studentId: alfaId }).expect(201);

    const profiles = await prisma.publicProfile.findMany({ where: { studentId: { in: [alfaId, betaId] } } });
    assert.deepEqual(profiles.map((p) => [p.studentId, p.isPublished]), [[alfaId, true]]);
    const guardians = await prisma.studentGuardian.findMany({ where: { userId: carlosUserId } });
    const consentOf = (studentId: number) => guardians.find((g) => g.studentId === studentId)?.consentPublicProfile;
    assert.equal(consentOf(alfaId), true);
    assert.equal(consentOf(betaId), false);
    // o passaporte lido com ?studentId= reflete a publicação só do Alfa
    const alfa = (await get('/api/passport/me', carlosToken, { studentId: alfaId }).expect(200)).body;
    const beta = (await get('/api/passport/me', carlosToken, { studentId: betaId }).expect(200)).body;
    assert.equal(alfa.publicProfile.isPublished, true);
    assert.equal(beta.publicProfile, null);

    await post('/api/passport/unpublish', { studentId: alfaId }).expect(201);
    assert.equal((await prisma.publicProfile.findUniqueOrThrow({ where: { studentId: alfaId } })).isPublished, false);
  });

  it('eventos: inscrição grava o studentId do dependente escolhido; sem vínculo = 403', async () => {
    const url = `/api/events/${eventId}/participants`;
    await request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${carlosToken}`).send({ studentId: betaId }).expect(201);
    const rows = await prisma.eventParticipant.findMany({ where: { eventId } });
    assert.deepEqual(rows.map((r) => r.studentId), [betaId]);
    await request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${carlosToken}`).send({ studentId: zecaId }).expect(403);
    assert.equal(await prisma.eventParticipant.count({ where: { eventId } }), 1);
  });
});
