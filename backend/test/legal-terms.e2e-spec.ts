import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { LEGAL_VERSION } from '../src/shared/legal/legal-documents';
import { MESTRE_EMAIL, loginAs } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * E10 (LGPD): textos públicos, aceite, exportação e pedido de exclusão. Usa uma conta própria
 * "@e2e-legal.local" (nunca o seed) e apaga tudo no after().
 */
const DOMAIN = '@e2e-legal.local';
const TEMP = 'Prov@Senha2026x';

describe('Termos, privacidade e direitos do titular (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestre: Awaited<ReturnType<typeof loginAs>>;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const stamp = Date.now();
  const email = `aluno-${stamp}${DOMAIN}`;
  let token = '';
  let userId = 0;

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    mestre = await loginAs(app, MESTRE_EMAIL);
    const student = await http().post('/api/students').set(auth(mestre.token)).send({ name: '[e2e-legal] Aluno' }).expect(201);
    await http().post(`/api/students/${student.body.id}/account`).set(auth(mestre.token)).send({ email, password: TEMP }).expect(201);
    const first = await http().post('/api/auth/login').send({ email, password: TEMP }).expect(200);
    const changed = await http()
      .post('/api/auth/change-password')
      .set(auth(first.body.accessToken))
      .send({ currentPassword: TEMP, newPassword: 'Definitiva@2026z' })
      .expect(200);
    token = changed.body.accessToken;
    userId = first.body.user.id;
  });

  after(async () => {
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.dataDeletionRequest.deleteMany({ where: { userId } });
    const students = await prisma.student.findMany({ where: { name: { startsWith: '[e2e-legal]' } }, select: { id: true } });
    await prisma.student.deleteMany({ where: { id: { in: students.map((s) => s.id) } } });
    await prisma.organizationUser.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('GET /legal/terms e /legal/privacy são públicos, versionados e avisam que são MODELO; outro nome é 404', async () => {
    const index = await http().get('/api/legal').expect(200);
    assert.equal(index.body.version, LEGAL_VERSION);
    for (const type of ['terms', 'privacy']) {
      const res = await http().get(`/api/legal/${type}`).expect(200);
      assert.equal(res.body.type, type);
      assert.equal(res.body.version, LEGAL_VERSION);
      assert.match(res.body.notice, /MODELO — revisar com assessoria jurídica/);
      assert.ok(res.body.sections.length > 5);
    }
    await http().get('/api/legal/cookies').expect(404);
  });

  it('login informa aceite pendente; POST /auth/accept-terms registra (User + AuditLog) e zera a pendência', async () => {
    const login = await http().post('/api/auth/login').send({ email, password: 'Definitiva@2026z' }).expect(200);
    assert.equal(login.body.user.termsAcceptanceRequired, true);
    assert.equal(login.body.user.currentTermsVersion, LEGAL_VERSION);
    assert.equal(login.body.user.acceptedTermsVersion, null);

    // Sem aceitar o servidor NÃO bloqueia o uso (decisão: quem barra é o frontend; TERMS_ENFORCEMENT liga o bloqueio).
    await http().get('/api/students/me').set(auth(token)).expect(200);

    await http().post('/api/auth/accept-terms').set(auth(token)).send({}).expect(400);
    const stale = await http().post('/api/auth/accept-terms').set(auth(token)).send({ version: '1999-01-01.1' }).expect(409);
    assert.equal(stale.body.code, 'TERMS_VERSION_MISMATCH');
    await http().post('/api/auth/accept-terms').send({ version: LEGAL_VERSION }).expect(401);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).acceptedTermsVersion, null);

    const ok = await http().post('/api/auth/accept-terms').set(auth(token)).send({ version: LEGAL_VERSION }).expect(200);
    assert.equal(ok.body.termsAcceptanceRequired, false);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(row.acceptedTermsVersion, LEGAL_VERSION);
    assert.ok(row.acceptedTermsAt);
    assert.equal(await prisma.auditLog.count({ where: { userId, action: 'ACCEPT_TERMS', resourceId: LEGAL_VERSION } }), 1);

    // Idempotente: aceitar de novo não grava outro registro.
    await http().post('/api/auth/accept-terms').set(auth(token)).send({ version: LEGAL_VERSION }).expect(200);
    assert.equal(await prisma.auditLog.count({ where: { userId, action: 'ACCEPT_TERMS' } }), 1);

    const me = await http().get('/api/auth/me').set(auth(token)).expect(200);
    assert.equal(me.body.termsAcceptanceRequired, false);
    const again = await http().post('/api/auth/login').send({ email, password: 'Definitiva@2026z' }).expect(200);
    assert.equal(again.body.user.termsAcceptanceRequired, false);
  });

  it('GET /auth/me/export devolve só os dados do próprio usuário, sem hash de senha; exige token', async () => {
    await http().get('/api/auth/me/export').expect(401);
    const res = await http().get('/api/auth/me/export').set(auth(token)).expect(200);
    assert.match(String(res.headers['content-disposition']), /attachment/);
    assert.equal(res.body.account.email, email);
    assert.equal(res.body.student.length, 1);
    assert.equal(res.body.student[0].name, '[e2e-legal] Aluno');
    assert.equal(res.body.memberships[0].role, 'ALUNO');
    assert.ok(res.body.termsAcceptances.length >= 1);
    assert.ok(!/passwordHash|twoFactorSecret|tokenValidAfter/.test(res.text), 'nenhum segredo na exportação');
    // O Mestre exporta os PRÓPRIOS dados: não enxerga o aluno acima.
    const other = await http().get('/api/auth/me/export').set(auth(mestre.token)).expect(200);
    assert.ok(!other.text.includes('[e2e-legal]'));
  });

  it('POST /auth/me/delete-request só registra o pedido (nada é apagado) e é idempotente', async () => {
    await http().post('/api/auth/me/delete-request').send({}).expect(401);
    await http().post('/api/auth/me/delete-request').set(auth(token)).send({ reason: 'x'.repeat(1001) }).expect(400);
    const first = await http().post('/api/auth/me/delete-request').set(auth(token)).send({ reason: 'Quero sair' }).expect(200);
    assert.equal(first.body.status, 'PENDING');
    assert.equal(first.body.alreadyRequested, false);
    const second = await http().post('/api/auth/me/delete-request').set(auth(token)).send({}).expect(200);
    assert.equal(second.body.alreadyRequested, true);
    assert.equal(second.body.id, first.body.id);
    assert.equal(await prisma.dataDeletionRequest.count({ where: { userId } }), 1);
    // nada foi apagado: usuário e aluno seguem ativos
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).status, 'ACTIVE');
    assert.equal(await prisma.student.count({ where: { name: '[e2e-legal] Aluno' } }), 1);
    const me = await http().get('/api/auth/me').set(auth(token)).expect(200);
    assert.equal(me.body.pendingDeletionRequest.id, first.body.id);
  });
});
