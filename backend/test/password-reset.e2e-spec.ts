import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { PasswordResetService } from '../src/shared/security/password-reset.service';
import { MESTRE_EMAIL, SecondOrg, createSecondOrg, loginAs } from './utils/list-helpers';
import { MemoryMailTransport, createTestApp } from './utils/test-app';

/**
 * E05 completo: "esqueci a senha" por e-mail + convite de aluno/responsável por e-mail. O e-mail usa um
 * transporte EM MEMÓRIA (MemoryMailTransport): nenhuma mensagem real é enviada. Fixtures: alunos
 * "[e2e-reset] ..." e usuários "@e2e-reset.local", removidos no after() (tokens caem em cascata).
 */
const DOMAIN = '@e2e-reset.local';
const TEMP_PASSWORD = 'Prov@Senha2026x';
const NEW_PASSWORD = 'Nova@Senha2026y';
const NEW_PASSWORD_2 = 'Outra@Senha2026z';
const NEUTRAL = 'Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.';

describe('Redefinição de senha e convite por e-mail (e2e)', () => {
  let appOff: INestApplication; // sem SMTP e sem transporte: recurso desligado
  let app: INestApplication; // com transporte em memória
  const mail = new MemoryMailTransport();
  const prisma = new PrismaClient();
  let mestre: Awaited<ReturnType<typeof loginAs>>;
  let orgB: SecondOrg;
  const stamp = `${Date.now()}`;
  let seq = 0;
  const email = (kind: string) => `${kind}-${stamp}-${++seq}${DOMAIN}`;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Aluno "[e2e-reset]" com conta criada pelo Mestre (senha provisória), devolve e-mail/ids. */
  async function newAccount(): Promise<{ studentId: number; userId: number; email: string }> {
    const address = email('aluno');
    const student = await request(app.getHttpServer())
      .post('/api/students')
      .set(auth(mestre.token))
      .send({ name: `[e2e-reset] Aluno ${++seq}` })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post(`/api/students/${student.body.id}/account`)
      .set(auth(mestre.token))
      .send({ email: address, password: TEMP_PASSWORD })
      .expect(201);
    return { studentId: student.body.id, userId: res.body.account.userId, email: address };
  }

  /** POST /auth/forgot-password + espera o processamento em segundo plano terminar. */
  async function forgot(address: string, application: INestApplication = app) {
    const res = await request(application.getHttpServer()).post('/api/auth/forgot-password').send({ email: address });
    await application.get(PasswordResetService).drain();
    return res;
  }
  const reset = (token: string, newPassword: string) =>
    request(app.getHttpServer()).post('/api/auth/reset-password').send({ token, newPassword });
  const loginRaw = (address: string, password: string) =>
    request(app.getHttpServer()).post('/api/auth/login').send({ email: address, password });

  before(async () => {
    appOff = await createTestApp();
    app = await createTestApp({ mailTransport: mail });
    mestre = await loginAs(app, MESTRE_EMAIL);
    orgB = await createSecondOrg(app, prisma, 'reset');
  });

  after(async () => {
    const students = await prisma.student.findMany({ where: { name: { startsWith: '[e2e-reset]' } }, select: { id: true } });
    const studentIds = students.map((s) => s.id);
    await prisma.studentGuardian.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
    await appOff.close();
  });

  describe('sem e-mail configurado', () => {
    it('capabilities informa false, forgot-password responde 503 claro e o convite é recusado (400)', async () => {
      const caps = await request(appOff.getHttpServer()).get('/api/auth/capabilities').expect(200);
      assert.deepEqual(caps.body, { passwordResetByEmail: false });

      const res = await request(appOff.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: `x-${stamp}${DOMAIN}` })
        .expect(503);
      assert.match(res.body.message, /não está habilitada/);

      const student = await request(appOff.getHttpServer())
        .post('/api/students')
        .set(auth(mestre.token))
        .send({ name: `[e2e-reset] Sem email ${++seq}` })
        .expect(201);
      await request(appOff.getHttpServer())
        .post(`/api/students/${student.body.id}/account`)
        .set(auth(mestre.token))
        .send({ email: email('semsmtp'), sendInvite: true })
        .expect(400);
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('capabilities true; e-mail inexistente e existente recebem 202 idêntico; só o existente recebe o link (token só como hash)', async () => {
      const caps = await request(app.getHttpServer()).get('/api/auth/capabilities').expect(200);
      assert.deepEqual(caps.body, { passwordResetByEmail: true });

      const account = await newAccount();
      const unknown = await forgot(`ninguem-${stamp}${DOMAIN}`);
      const known = await forgot(account.email);
      assert.equal(unknown.status, 202);
      assert.equal(known.status, 202);
      assert.deepEqual(unknown.body, { message: NEUTRAL });
      assert.deepEqual(known.body, { message: NEUTRAL });
      assert.equal(mail.to(`ninguem-${stamp}${DOMAIN}`).length, 0);

      const sent = mail.to(account.email);
      assert.equal(sent.length, 1);
      assert.match(sent[0].text, /^Olá/);
      assert.ok(sent[0].text.includes('https://app.e2e.test/redefinir-senha?token='), 'aluno recebe link do APP');
      assert.ok(sent[0].html.includes('<a href="https://app.e2e.test/redefinir-senha?token='));

      // 2ª via independente (Postgres): só o SHA-256 foi gravado, nunca o token em claro.
      const token = MemoryMailTransport.tokenOf(sent[0]);
      const rows = await prisma.passwordResetToken.findMany({ where: { userId: account.userId } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].tokenHash, createHash('sha256').update(token).digest('hex'));
      assert.notEqual(rows[0].tokenHash, token);
      assert.equal(rows[0].purpose, 'RESET');
      const ttl = rows[0].expiresAt.getTime() - rows[0].createdAt.getTime();
      assert.ok(Math.abs(ttl - 3_600_000) < 5_000, `expira em ~1 h (foi ${ttl} ms)`);
    });

    it('Mestre recebe o link do PAINEL; aluno inativo NÃO recebe e-mail; um pedido novo invalida o link anterior', async () => {
      const mestreMail = (await prisma.user.findUniqueOrThrow({ where: { id: orgB.userId } })).email;
      await forgot(mestreMail);
      const mestreMsg = mail.to(mestreMail);
      assert.equal(mestreMsg.length, 1);
      assert.ok(mestreMsg[0].text.includes('https://painel.e2e.test/redefinir-senha?token='));

      const inactive = await newAccount();
      await request(app.getHttpServer()).delete(`/api/students/${inactive.studentId}`).set(auth(mestre.token)).expect(200);
      await forgot(inactive.email);
      assert.equal(mail.to(inactive.email).length, 0, 'aluno inativo não recebe link');

      const account = await newAccount();
      await forgot(account.email);
      await forgot(account.email);
      const [first, second] = mail.to(account.email).map(MemoryMailTransport.tokenOf);
      assert.notEqual(first, second);
      await reset(first, NEW_PASSWORD).expect(400);
      await reset(second, NEW_PASSWORD).expect(200);
    });

    it('rate limit por e-mail: acima do limite responde 429 (outro e-mail segue normal)', async () => {
      const previous = process.env.FORGOT_EMAIL_THROTTLE_LIMIT;
      process.env.FORGOT_EMAIL_THROTTLE_LIMIT = '2';
      try {
        const target = `bomba-${stamp}${DOMAIN}`;
        const url = '/api/auth/forgot-password';
        await request(app.getHttpServer()).post(url).send({ email: target }).expect(202);
        await request(app.getHttpServer()).post(url).send({ email: target }).expect(202);
        await request(app.getHttpServer()).post(url).send({ email: target }).expect(429);
        await request(app.getHttpServer()).post(url).send({ email: `outro-${stamp}${DOMAIN}` }).expect(202);
      } finally {
        process.env.FORGOT_EMAIL_THROTTLE_LIMIT = previous;
        await app.get(PasswordResetService).drain();
      }
    });

    it('e-mail malformado = 400', async () => {
      await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: 'nao-e-email' }).expect(400);
    });
  });

  describe('POST /auth/reset-password', () => {
    it('redefine a senha, revoga as sessões antigas, zera mustChangePassword e o token vale uma vez só', async () => {
      const account = await newAccount();
      const firstLogin = await loginRaw(account.email, TEMP_PASSWORD).expect(200);
      assert.equal(firstLogin.body.user.mustChangePassword, true);
      const oldToken = firstLogin.body.accessToken;

      await forgot(account.email);
      const token = MemoryMailTransport.tokenOf(mail.to(account.email)[0]);
      const done = await reset(token, NEW_PASSWORD).expect(200);
      assert.match(done.body.message, /Senha redefinida/);

      // Sessão antiga revogada (tokenValidAfter) — conferido por uma chamada real autenticada.
      await request(app.getHttpServer()).get('/api/auth/me').set(auth(oldToken)).expect(401);
      await loginRaw(account.email, TEMP_PASSWORD).expect(401);
      const relogin = await loginRaw(account.email, NEW_PASSWORD).expect(200);
      assert.equal(relogin.body.user.mustChangePassword, false);
      const persisted = await prisma.user.findUniqueOrThrow({ where: { id: account.userId } });
      assert.equal(persisted.mustChangePassword, false);
      assert.ok(persisted.tokenValidAfter);

      // Uso único.
      const again = await reset(token, NEW_PASSWORD_2).expect(400);
      assert.match(again.body.message, /inválido ou expirado/);
      await loginRaw(account.email, NEW_PASSWORD).expect(200);
    });

    it('token expirado, inexistente ou senha fora da política = 400 e nada muda', async () => {
      const account = await newAccount();
      await forgot(account.email);
      const token = MemoryMailTransport.tokenOf(mail.to(account.email)[0]);

      await reset(token, 'curta').expect(400); // política (12+)
      await reset(token, 'Dev@12345-Dev@12345').expect(400); // senha padrão de dev proibida
      await reset('x'.repeat(43), NEW_PASSWORD).expect(400); // token desconhecido

      await prisma.passwordResetToken.updateMany({ where: { userId: account.userId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const expired = await reset(token, NEW_PASSWORD).expect(400);
      assert.match(expired.body.message, /inválido ou expirado/);
      await loginRaw(account.email, TEMP_PASSWORD).expect(200); // senha antiga intacta
    });
  });

  describe('convite por e-mail (sendInvite)', () => {
    it('cria o acesso sem senha provisória, envia o link do app e a pessoa define a própria senha', async () => {
      const student = await request(app.getHttpServer())
        .post('/api/students')
        .set(auth(mestre.token))
        .send({ name: `[e2e-reset] Convidado ${++seq}` })
        .expect(201);
      const address = email('convite');
      const res = await request(app.getHttpServer())
        .post(`/api/students/${student.body.id}/account`)
        .set(auth(mestre.token))
        .send({ email: address, sendInvite: true })
        .expect(201);
      assert.equal(res.body.inviteSent, true);
      assert.equal(res.body.linkedExistingUser, false);
      assert.equal(res.body.account.mustChangePassword, false);

      const sent = mail.to(address);
      assert.equal(sent.length, 1);
      assert.match(sent[0].subject, /Convite/);
      const token = MemoryMailTransport.tokenOf(sent[0]);
      const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: res.body.account.userId } });
      assert.equal(row.purpose, 'INVITE');
      assert.ok(row.expiresAt.getTime() - row.createdAt.getTime() > 48 * 3_600_000);

      await reset(token, NEW_PASSWORD).expect(200);
      const login = await loginRaw(address, NEW_PASSWORD).expect(200);
      assert.equal(login.body.user.role, 'ALUNO');
    });

    it('sendInvite junto com senha provisória = 400; falha de envio devolve inviteSent:false sem vazar detalhe', async () => {
      const student = await request(app.getHttpServer())
        .post('/api/students')
        .set(auth(mestre.token))
        .send({ name: `[e2e-reset] Convite falho ${++seq}` })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/students/${student.body.id}/account`)
        .set(auth(mestre.token))
        .send({ email: email('ambos'), sendInvite: true, password: TEMP_PASSWORD })
        .expect(400);

      mail.failNext = true;
      const res = await request(app.getHttpServer())
        .post(`/api/students/${student.body.id}/account`)
        .set(auth(mestre.token))
        .send({ email: email('falho'), sendInvite: true })
        .expect(201);
      assert.equal(res.body.inviteSent, false);
      assert.ok(!JSON.stringify(res.body).includes('ESTUB'));
    });
  });
});
