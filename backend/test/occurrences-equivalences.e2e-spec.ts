import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { RankingService } from '../src/interface/http/ranking/ranking.service';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * FICHA UNICA - Fases 4 (ocorrencias) e 5 (equivalencia de cordas). Grupos PROPRIOS: A (origem), B (destino), C (estranho).
 * Nunca o seed/demo. Fixtures "[e2e-ocorr]" / "@e2e-ocorr.local", limpas no after().
 */
const PREFIX = '[e2e-ocorr]';
const DOMAIN = '@e2e-ocorr.local';
const PASSWORD = 'Prov@Senha2026x';
const SECRET_REASON = `Motivo sigiloso ${Date.now()}`;

describe('ocorrencias e equivalencia de cordas - fases 4 e 5 (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let A: ReportOrg;
  let B: ReportOrg;
  let C: ReportOrg;
  let slugA: string;
  let slugB: string;
  const stamp = Date.now();
  let ana: { id: number; personId: number; userId: number; email: string };
  let anaToken: string;
  let anaB: number;
  let contestedId: number;
  const levelsA: number[] = [];
  const levelsB: number[] = [];

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (email: string, slug: string) =>
    (await http().post('/api/auth/login').send({ email, password: PASSWORD, organizationSlug: slug }).expect(200)).body.accessToken as string;
  const occ = (token: string, studentId: number) => http().post(`/api/students/${studentId}/occurrences`).set(auth(token));

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    A = await createReportOrg(app, prisma, 'ocorr-a');
    B = await createReportOrg(app, prisma, 'ocorr-b');
    C = await createReportOrg(app, prisma, 'ocorr-c');
    slugA = (await prisma.organization.findUniqueOrThrow({ where: { id: A.organizationId } })).slug;
    slugB = (await prisma.organization.findUniqueOrThrow({ where: { id: B.organizationId } })).slug;
    const s = (await http().post('/api/students').set(auth(A.mestre.token)).send({ name: `${PREFIX} Ana`, birthDate: '1992-02-02' }).expect(201)).body;
    const email = `ana-${stamp}${DOMAIN}`;
    await http().post(`/api/students/${s.id}/account`).set(auth(A.mestre.token)).send({ email, password: PASSWORD }).expect(201);
    const user = await prisma.user.update({ where: { email }, data: { mustChangePassword: false } });
    ana = { id: s.id, personId: s.personId, userId: user.id, email };
    anaToken = await login(email, slugA);
    // Sistema A com 4 cordas (Ana na 3a) e sistema B com 2 cordas.
    const sysA = await prisma.graduationSystem.create({ data: { organizationId: A.organizationId, name: `${PREFIX} Sistema A` } });
    for (const [order, name] of [[1, 'Crua'], [2, 'Verde'], [3, 'Amarela'], [4, 'Azul']] as const) {
      levelsA.push((await prisma.graduationLevel.create({ data: { organizationId: A.organizationId, graduationSystemId: sysA.id, name, order, color: '#00AA00', colors: ['#00AA00'] } })).id);
    }
    const sysB = await prisma.graduationSystem.create({ data: { organizationId: B.organizationId, name: `${PREFIX} Sistema B` } });
    for (const [order, name] of [[1, 'Iniciante B'], [2, 'Graduado B']] as const) {
      levelsB.push((await prisma.graduationLevel.create({ data: { organizationId: B.organizationId, graduationSystemId: sysB.id, name, order, color: '#0000AA', colors: ['#0000AA'] } })).id);
    }
    await prisma.studentGraduation.create({ data: { organizationId: A.organizationId, studentId: ana.id, graduationLevelId: levelsA[2]!, graduatedAt: new Date('2026-05-05T00:00:00Z') } });
  });

  after(async () => {
    const orgIds = [A.organizationId, B.organizationId, C.organizationId];
    await prisma.levelEquivalence.deleteMany({ where: { toOrganizationId: { in: orgIds } } });
    await prisma.transferRequest.deleteMany({ where: { OR: [{ toOrganizationId: { in: orgIds } }, { fromOrganizationId: { in: orgIds } }] } });
    await prisma.pointEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.achievement.deleteMany({ where: { student: { organizationId: { in: orgIds } } } });
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    await prisma.notification.deleteMany({ where: { userId: { in: [...userIds, A.mestre.userId, B.mestre.userId, C.mestre.userId] } } });
    await A.cleanup();
    await B.cleanup();
    await C.cleanup();
    await prisma.person.deleteMany({ where: { name: { startsWith: PREFIX }, students: { none: {} } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('ocorrencia: so o MESTRE do grupo escreve/le; PROFESSOR e ALUNO 403; outro grupo 404', async () => {
    const res = await occ(A.mestre.token, ana.id).send({ kind: 'ADVERTENCIA', occurredAt: '2026-09-10', reason: SECRET_REASON }).expect(201);
    contestedId = res.body.id;
    assert.equal(res.body.status, 'ACTIVE');
    assert.equal(res.body.createdBy.id, A.mestre.userId);
    await occ(A.professor.token, ana.id).send({ kind: 'OUTRA', occurredAt: '2026-09-10', reason: 'nao pode' }).expect(403);
    await http().get(`/api/students/${ana.id}/occurrences`).set(auth(A.professor.token)).expect(403);
    await http().get(`/api/students/${ana.id}/occurrences`).set(auth(A.aluno.token)).expect(403);
    await http().get(`/api/students/${ana.id}/occurrences`).set(auth(anaToken)).expect(403);
    await http().get(`/api/students/${ana.id}/occurrences`).set(auth(B.mestre.token)).expect(404);
    const list = await http().get(`/api/students/${ana.id}/occurrences`).set(auth(A.mestre.token)).expect(200);
    assert.equal(list.body.length, 1);
    assert.equal(await prisma.auditLog.count({ where: { action: 'OCCURRENCE_CREATE', resourceId: String(contestedId) } }), 1);
    assert.equal(await prisma.notification.count({ where: { userId: ana.userId, type: 'OCCURRENCE_REGISTERED' } }), 1);
    const bad = await occ(A.mestre.token, ana.id).send({ kind: 'ADVERTENCIA', occurredAt: '2026-09-10', reason: 'x expel', expel: true }).expect(400);
    assert.equal(bad.body.code, 'EXPEL_ONLY_FOR_EXPULSION');
  });

  it('a pessoa ve (com o motivo) e contesta; o Mestre ve a contestacao; outra pessoa nao contesta; retratacao', async () => {
    const mine = await http().get('/api/people/me/occurrences').set(auth(anaToken)).expect(200);
    assert.equal(mine.body.length, 1);
    assert.equal(mine.body[0].reason, SECRET_REASON);
    assert.equal(mine.body[0].canContest, true);
    assert.equal(mine.body[0].organization.id, A.organizationId);
    const other = await http().get('/api/people/me/occurrences').set(auth(A.aluno.token)).expect(200);
    assert.ok(!JSON.stringify(other.body).includes(SECRET_REASON));
    await http().post(`/api/people/me/occurrences/${contestedId}/contest`).set(auth(A.aluno.token)).send({ note: 'nao sou eu' }).expect(404);
    const c = await http().post(`/api/people/me/occurrences/${contestedId}/contest`).set(auth(anaToken)).send({ note: 'Nao aconteceu assim' }).expect(200);
    assert.equal(c.body.status, 'CONTESTED');
    const again = await http().post(`/api/people/me/occurrences/${contestedId}/contest`).set(auth(anaToken)).send({ note: 'de novo' }).expect(409);
    assert.equal(again.body.code, 'OCCURRENCE_NOT_CONTESTABLE');
    const staff = await http().get(`/api/students/${ana.id}/occurrences`).set(auth(A.mestre.token)).expect(200);
    assert.equal(staff.body[0].contestNote, 'Nao aconteceu assim');
    // Uma segunda ocorrencia, retratada pelo Mestre (nao vai para o grupo novo).
    const r = await occ(A.mestre.token, ana.id).send({ kind: 'SUSPENSAO', occurredAt: '2026-09-11', endsAt: '2026-09-18', reason: 'Retratada depois' }).expect(201);
    const retracted = await http().patch(`/api/students/${ana.id}/occurrences/${r.body.id}/retract`).set(auth(A.mestre.token)).send({ note: 'Engano' }).expect(200);
    assert.equal(retracted.body.status, 'RETRACTED');
    const twice = await http().patch(`/api/students/${ana.id}/occurrences/${r.body.id}/retract`).set(auth(A.mestre.token)).send({}).expect(409);
    assert.equal(twice.body.code, 'OCCURRENCE_ALREADY_RETRACTED');
  });

  it('grupo novo: nada antes do compartilhamento; depois, so o MESTRE le (somente leitura, auditado); retratada nao vai', async () => {
    const t = (await http().post('/api/transfers').set(auth(B.mestre.token)).send({ personId: ana.personId }).expect(201)).body;
    await http().get(`/api/students/${ana.id}/ficha`).set(auth(B.mestre.token)).expect(404);
    await http().post(`/api/people/me/transfers/${t.id}/approve`).set(auth(anaToken)).expect(200);
    anaB = (await prisma.transferRequest.findUniqueOrThrow({ where: { id: t.id } })).toStudentId!;
    anaToken = await login(ana.email, slugB);

    const ficha = await http().get(`/api/students/${anaB}/ficha`).set(auth(B.mestre.token)).expect(200);
    const shared = ficha.body.sharedFromOtherGroups[0];
    assert.deepEqual(shared.occurrences.map((o: { id: number; status: string }) => [o.id, o.status]), [[contestedId, 'CONTESTED']]);
    assert.equal(shared.occurrences[0].reason, SECRET_REASON);
    assert.ok((await prisma.auditLog.count({ where: { organizationId: B.organizationId, action: 'OCCURRENCE_READ_SHARED' } })) >= 1);
    // PROFESSOR do grupo novo: a ficha vem SEM a chave de ocorrencias.
    const prof = await http().get(`/api/students/${anaB}/ficha`).set(auth(B.professor.token)).expect(200);
    assert.ok(!('occurrences' in prof.body.sharedFromOtherGroups[0]));
    assert.ok(!JSON.stringify(prof.body).includes(SECRET_REASON));
    // O grupo novo nao escreve nem retrata ocorrencia do grupo antigo.
    await http().get(`/api/students/${ana.id}/occurrences`).set(auth(B.mestre.token)).expect(404);
    await http().patch(`/api/students/${ana.id}/occurrences/${contestedId}/retract`).set(auth(B.mestre.token)).send({}).expect(404);
    // C (estranho) nao ve nada.
    await http().get(`/api/students/${anaB}/ficha`).set(auth(C.mestre.token)).expect(404);
  });

  it('expulsao com "encerrar matricula" deixa o aluno Ex-aluno (leftReason EXPELLED)', async () => {
    const s = (await http().post('/api/students').set(auth(A.mestre.token)).send({ name: `${PREFIX} Expulso` }).expect(201)).body;
    const res = await occ(A.mestre.token, s.id).send({ kind: 'EXPULSAO', occurredAt: '2026-10-01', reason: 'Agressao em roda', expel: true }).expect(201);
    assert.equal(res.body.expelledEnrollment, true);
    const after = await prisma.student.findUniqueOrThrow({ where: { id: s.id } });
    assert.equal(after.status, 'FORMER');
    assert.equal(after.leftReason, 'EXPELLED');
  });

  it('equivalencia: sugestao pela posicao relativa; so corda compartilhada; reconhecer cria 1 graduacao (idempotente) que pontua na matricula nova', async () => {
    await http().get(`/api/graduations/equivalences/suggestions?studentId=${anaB}`).set(auth(B.professor.token)).expect(403);
    await http().get(`/api/graduations/equivalences/suggestions?studentId=${anaB}`).set(auth(C.mestre.token)).expect(404);
    const sug = await http().get(`/api/graduations/equivalences/suggestions?studentId=${anaB}`).set(auth(B.mestre.token)).expect(200);
    assert.equal(sug.body.length, 1);
    assert.equal(sug.body[0].fromLevel.name, 'Amarela');
    assert.equal(sug.body[0].fromSystem.levelsCount, 4);
    assert.equal(sug.body[0].suggested.name, 'Graduado B', '3a de 4 -> 2a de 2');
    assert.equal(sug.body[0].recognized, false);

    // Corda de origem NAO compartilhada (Azul, ninguem tem) = 404; destino de outro grupo = 400.
    await http().post('/api/graduations/equivalences').set(auth(B.mestre.token)).send({ fromLevelId: levelsA[3], toLevelId: levelsB[1] }).expect(404);
    const badTo = await http().post('/api/graduations/equivalences').set(auth(B.mestre.token)).send({ fromLevelId: levelsA[2], toLevelId: levelsA[0] }).expect(400);
    assert.equal(badTo.body.code, 'INVALID_TO_LEVEL');
    await http().post('/api/graduations/equivalences').set(auth(C.mestre.token)).send({ fromLevelId: levelsA[2], toLevelId: levelsB[1] }).expect(404);

    const first = await http()
      .post('/api/graduations/equivalences')
      .set(auth(B.mestre.token))
      .send({ fromLevelId: levelsA[2], toLevelId: levelsB[1], recognizeForStudentId: anaB })
      .expect(201);
    assert.equal(first.body.equivalence.toLevel.name, 'Graduado B');
    assert.match(first.body.recognizedGraduation.notes, /^Reconhecida de /);
    const second = await http()
      .post('/api/graduations/equivalences')
      .set(auth(B.mestre.token))
      .send({ fromLevelId: levelsA[2], toLevelId: levelsB[1], recognizeForStudentId: anaB })
      .expect(201);
    assert.equal(second.body.recognizedGraduation.id, first.body.recognizedGraduation.id, 'reconhecer de novo nao duplica');
    assert.equal(await prisma.studentGraduation.count({ where: { studentId: anaB } }), 1);
    assert.equal(await prisma.studentGraduation.count({ where: { studentId: ana.id } }), 1, 'a graduacao antiga nao muda');
    const after = await http().get(`/api/graduations/equivalences/suggestions?studentId=${anaB}`).set(auth(B.mestre.token)).expect(200);
    assert.equal(after.body[0].recognized, true);
    assert.equal(after.body[0].declared.name, 'Graduado B');

    // Pontos: a reconhecida pontua na matricula NOVA; a de origem (Ex-aluno) segue fora dos rankings (so ativos).
    await app.get(RankingService).syncStudent(anaB);
    assert.equal(await prisma.pointEvent.count({ where: { studentId: anaB, type: 'GRADUATION' } }), 1);
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: ana.id } })).status, 'FORMER');
    const ficha = await http().get(`/api/students/${anaB}/ficha`).set(auth(B.mestre.token)).expect(200);
    assert.equal(ficha.body.graduations[0].recognizedFromLevelId, levelsA[2]);
  });

  it('a corda reconhecida alimenta a sugestao de cargo do grupo novo', async () => {
    const sys = await prisma.graduationLevel.findUniqueOrThrow({ where: { id: levelsB[1]! } });
    await http().put(`/api/graduations/systems/${sys.graduationSystemId}/role-rules`).set(auth(B.mestre.token)).send({ rules: [{ role: 'MONITOR', minLevelOrder: 2 }] }).expect(200);
    const sug = await http().get('/api/roles/suggestions').set(auth(B.mestre.token)).expect(200);
    const mine = sug.body.find((s: { studentId: number }) => s.studentId === anaB);
    assert.ok(mine, 'aluna transferida com corda reconhecida aparece como sugestao');
    // Cargos personalizados: a sugestão traz o cargo do grupo (objeto), com o perfil de acesso base.
    assert.equal(mine.role.accessRole, 'MONITOR');
    assert.equal(mine.level.name, 'Graduado B');
  });
});
