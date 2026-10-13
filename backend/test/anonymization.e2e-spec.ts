import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createPlatformUser, platformLogin } from './utils/platform-team-fixtures';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * LGPD - POST /data-deletion-requests/:id/anonymize (docs/FICHA_UNICA.md secao 12.D). Grupo PROPRIO; o usuario anonimizado
 * perde o e-mail original, por isso os ids sao rastreados para a limpeza. Nao toca o seed nem o demo.
 */
const PASSWORD = 'Prov@Senha2026x';

function makeCpf(): string {
  for (;;) {
    const base = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
    if (/^(\d)\1{8}$/.test(base)) continue;
    const digit = (s: string) => {
      let sum = 0;
      for (let i = 0; i < s.length; i++) sum += Number(s[i]) * (s.length + 1 - i);
      const rest = (sum * 10) % 11;
      return rest === 10 ? 0 : rest;
    };
    const d1 = digit(base);
    return base + d1 + digit(base + d1);
  }
}

describe('LGPD - anonimizar pedido de exclusao (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let org: ReportOrg;
  const stamp = Date.now();
  const cpf = makeCpf();
  const email = `lia-${stamp}@e2e-anon.local`;
  let superToken = '';
  let plainToken = '';
  const platformIds: number[] = [];
  const trackedUserIds: number[] = [];
  let studentId = 0;
  let personId = 0;
  let userId = 0;
  let userToken = '';
  let oldCode = '';
  let requestId = 0;
  let lessonId = 0;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    org = await createReportOrg(app, prisma, 'anon');
    trackedUserIds.push(org.mestre.userId, org.professor.userId, org.aluno.userId);
    const sup = await createPlatformUser(prisma, 'anon-super', { isSuperAdmin: true });
    const plain = await createPlatformUser(prisma, 'anon-plain');
    platformIds.push(sup.id, plain.id);
    superToken = await platformLogin(app, sup.email);
    plainToken = await platformLogin(app, plain.email);

    const s = (
      await http()
        .post('/api/students')
        .set(auth(org.mestre.token))
        .send({ name: '[e2e-anon] Lia Silva', birthDate: '1990-03-04', document: cpf, phone: '11999990000', email })
        .expect(201)
    ).body;
    studentId = s.id;
    personId = s.personId;
    oldCode = s.person.gingappCode;
    await http().post(`/api/students/${studentId}/account`).set(auth(org.mestre.token)).send({ email, password: PASSWORD }).expect(201);
    const user = await prisma.user.update({ where: { email }, data: { mustChangePassword: false } });
    userId = user.id;
    trackedUserIds.push(userId);
    const slug = (await prisma.organization.findUniqueOrThrow({ where: { id: org.organizationId } })).slug;
    userToken = (await http().post('/api/auth/login').send({ email, password: PASSWORD, organizationSlug: slug }).expect(200)).body.accessToken;

    // Historico que precisa sobreviver sem identificar: frequencia, graduacao e uma expulsao.
    const cls = await prisma.class.create({ data: { organizationId: org.organizationId, name: 'Turma anon', autoGenerateLessons: false } });
    await prisma.classStudent.create({ data: { organizationId: org.organizationId, classId: cls.id, studentId, status: 'ACTIVE' } });
    lessonId = (await prisma.lesson.create({ data: { organizationId: org.organizationId, classId: cls.id, date: new Date('2026-09-01T00:00:00Z') } })).id;
    await prisma.attendance.create({ data: { organizationId: org.organizationId, lessonId, studentId, present: true } });
    const system = await prisma.graduationSystem.create({ data: { organizationId: org.organizationId, name: 'Sistema anon' } });
    const level = await prisma.graduationLevel.create({
      data: { organizationId: org.organizationId, graduationSystemId: system.id, name: 'Verde', order: 1, color: '#00AA00', colors: ['#00AA00'] },
    });
    await prisma.studentGraduation.create({ data: { organizationId: org.organizationId, studentId, graduationLevelId: level.id, graduatedAt: new Date('2026-06-01T00:00:00Z') } });
    await prisma.occurrence.create({
      data: { organizationId: org.organizationId, studentId, personId, kind: 'EXPULSAO', occurredAt: new Date('2026-08-01T00:00:00Z'), reason: 'Motivo identificavel secreto' },
    });
    requestId = (await http().post('/api/auth/me/delete-request').set(auth(userToken)).send({ reason: 'Quero sair' }).expect(200)).body.id;
  });

  after(async () => {
    const ids = [...trackedUserIds, ...platformIds];
    await prisma.dataDeletionRequest.deleteMany({ where: { userId: { in: ids } } });
    await prisma.occurrence.deleteMany({ where: { organizationId: org.organizationId } });
    await org.cleanup();
    await prisma.person.deleteMany({ where: { name: { in: ['Pessoa removida', '[e2e-anon] Lia Silva'] }, students: { none: {} } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('erros: so super admin; confirm obrigatorio; ultimo MESTRE bloqueia; usuario da plataforma bloqueia; pedido inexistente 404', async () => {
    await http().post(`/api/data-deletion-requests/${requestId}/anonymize`).set(auth(plainToken)).send({ confirm: true }).expect(403);
    await http().post(`/api/data-deletion-requests/${requestId}/anonymize`).set(auth(org.mestre.token)).send({ confirm: true }).expect(403);
    await http().post(`/api/data-deletion-requests/${requestId}/anonymize`).set(auth(superToken)).send({}).expect(400);
    await http().post(`/api/data-deletion-requests/${requestId}/anonymize`).set(auth(superToken)).send({ confirm: false }).expect(400);
    await http().post('/api/data-deletion-requests/99999999/anonymize').set(auth(superToken)).send({ confirm: true }).expect(404);
    // Nada mudou ate aqui.
    assert.equal((await prisma.person.findUniqueOrThrow({ where: { id: personId } })).anonymizedAt, null);

    const mestreReq = (await http().post('/api/auth/me/delete-request').set(auth(org.mestre.token)).send({}).expect(200)).body.id;
    const last = await http().post(`/api/data-deletion-requests/${mestreReq}/anonymize`).set(auth(superToken)).send({ confirm: true }).expect(409);
    assert.equal(last.body.code, 'ANONYMIZE_LAST_MESTRE');
    const platformReq = await prisma.dataDeletionRequest.create({ data: { userId: platformIds[1] } });
    const plat = await http().post(`/api/data-deletion-requests/${platformReq.id}/anonymize`).set(auth(superToken)).send({ confirm: true }).expect(409);
    assert.equal(plat.body.code, 'ANONYMIZE_PLATFORM_USER');
  });

  it('feliz: anonimiza ficha, matricula e login; mantem frequencia/graduacao/ocorrencia sem identificar; marca DONE e audita', async () => {
    const res = await http().post(`/api/data-deletion-requests/${requestId}/anonymize`).set(auth(superToken)).send({ confirm: true }).expect(200);
    assert.equal(res.body.request.status, 'DONE');
    assert.deepEqual(res.body.result, { personId, studentsAnonymized: 1, userDeactivated: true, occurrencesRetained: 1 });

    const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });
    assert.equal(person.name, 'Pessoa removida');
    assert.notEqual(person.gingappCode, oldCode);
    assert.ok(person.anonymizedAt);
    for (const field of ['nickname', 'birthDate', 'photo', 'email', 'phone', 'documentHash', 'documentEnc', 'documentLast4', 'documentKind', 'userId'] as const) {
      assert.equal(person[field], null, `Person.${field}`);
    }
    const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    assert.equal(student.name, 'Pessoa removida');
    assert.equal(student.status, 'FORMER');
    assert.equal(student.leftReason, 'ANONYMIZED');
    for (const field of ['birthDate', 'document', 'phone', 'email', 'photo', 'userId'] as const) assert.equal(student[field], null, `Student.${field}`);
    assert.ok(student.anonymizedAt);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(user.status, 'INACTIVE');
    assert.equal(user.name, 'Pessoa removida');
    assert.match(user.email, /@anonimizado\.invalid$/);
    await http().get('/api/students/me').set(auth(userToken)).expect(401); // sessao revogada
    await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(401);

    // Integridade historica preservada.
    assert.equal(await prisma.attendance.count({ where: { lessonId, studentId, present: true } }), 1);
    assert.equal(await prisma.studentGraduation.count({ where: { studentId } }), 1);
    const occ = await prisma.occurrence.findFirstOrThrow({ where: { studentId } });
    assert.equal(occ.kind, 'EXPULSAO');
    assert.ok(!occ.reason.includes('secreto'));
    assert.equal(await prisma.classStudent.count({ where: { studentId, status: 'ACTIVE' } }), 0);

    const request = await prisma.dataDeletionRequest.findUniqueOrThrow({ where: { id: requestId } });
    assert.equal(request.status, 'DONE');
    assert.ok(request.resolvedAt);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'PERSON_ANONYMIZE' }, orderBy: { id: 'desc' } });
    assert.ok(!JSON.stringify(audit.metadata).includes('Lia'), 'auditoria sem nome');

    // O CPF ficou livre: a mesma pessoa pode ganhar uma ficha nova sem colidir com a anonimizada.
    const again = await http().post('/api/students').set(auth(org.mestre.token)).send({ name: '[e2e-anon] Lia Silva', document: cpf }).expect(201);
    assert.notEqual(again.body.personId, personId);
    // Pedido finalizado nao anonimiza de novo.
    const final = await http().post(`/api/data-deletion-requests/${requestId}/anonymize`).set(auth(superToken)).send({ confirm: true }).expect(409);
    assert.equal(final.body.code, 'DELETION_REQUEST_FINAL');
  });
});
