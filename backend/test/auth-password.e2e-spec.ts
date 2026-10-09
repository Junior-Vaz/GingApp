import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OrgRole, PrismaClient, UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { AuthController } from '../src/interface/http/auth/auth.controller';
import { OrganizationsController } from '../src/interface/http/organizations/organizations.controller';
import { createMemberSuperAdmin, createPlatformUser, platformLogin } from './utils/platform-team-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Senhas e e-mail de login (decisões do dono, backend de segurança de autenticação):
 *   A) POST /auth/change-password — qualquer usuário autenticado troca a PRÓPRIA senha (400 se a atual
 *      estiver errada, nunca 401; revoga as outras sessões; devolve accessToken novo);
 *   B) POST /organizations/:orgId/members/:userId/reset-password — só super admin ativo, só MESTRE ativo
 *      do grupo (404 único para o resto), 204 sem corpo, revoga as sessões do MESTRE;
 *   C) login normaliza o e-mail (maiúsculas/espaços) e acha contas legadas gravadas com maiúsculas;
 *   D) GET /organizations/:id — só PLATFORM, a organização + mestres (sem segredo).
 *
 * Prova com Prisma como 2ª via independente (hash, custo bcrypt, tokenValidAfter), SEM nenhuma pausa
 * para "esperar o segundo virar": o token antigo morre e o novo vale no MESMO segundo da troca.
 * Tudo que a suíte cria é apagado no after() (ids rastreados + varredura pelo domínio de e-mail).
 */
const TAG = `${Date.now()}`;
const MAIL_DOMAIN = 'e2e-auth-pwd.local';
const INITIAL = `Inicial#Senha-${TAG}`;
const DEV_PASSWORD = 'Dev@12345';
const GOOD = (n: number | string) => `Nova#Segura-${TAG}-${n}`;

let seq = 0;
const uniq = () => `${TAG}-${++seq}`;

interface Account {
  id: number;
  email: string;
  password: string;
  kind: 'MEMBER' | 'PLATFORM';
  orgId?: number;
  role?: OrgRole;
}

function jwtPayload(token: string): Record<string, unknown> & { iat: number; exp: number } {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

/** Captura tudo que a aplicação escreve em stdout/stderr (logs do Nest, console) durante `fn`. */
async function captureOutput<T>(fn: () => Promise<T>): Promise<{ result: T; output: string }> {
  const chunks: string[] = [];
  const outWrite = process.stdout.write;
  const errWrite = process.stderr.write;
  const wrap =
    (original: typeof process.stdout.write) =>
    (chunk: unknown, ...rest: unknown[]): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
      return (original as (...args: unknown[]) => boolean).call(process.stdout, chunk, ...rest);
    };
  process.stdout.write = wrap(outWrite) as typeof process.stdout.write;
  process.stderr.write = wrap(errWrite) as typeof process.stderr.write;
  try {
    const result = await fn();
    return { result, output: chunks.join('') };
  } finally {
    process.stdout.write = outWrite;
    process.stderr.write = errWrite;
  }
}

/** Redecora o @Throttle de um handler (limite rebaixado) só durante `fn` e restaura o original. */
async function withThrottleLimit<T>(
  controller: { prototype: object },
  method: string,
  limit: number,
  fn: () => Promise<T>,
): Promise<T> {
  const key = 'THROTTLER:LIMITdefault';
  const descriptor = Object.getOwnPropertyDescriptor(controller.prototype, method)!;
  const original = Reflect.getMetadata(key, descriptor.value);
  assert.equal(typeof original, 'number', `${method} declara @Throttle próprio`);
  const apply = (value: number) => Throttle({ default: { limit: value, ttl: 60_000 } })(controller.prototype, method, descriptor);
  apply(limit);
  try {
    return await fn();
  } finally {
    apply(original);
    assert.equal(Reflect.getMetadata(key, descriptor.value), original);
  }
}

describe('Senha: change-password, reset de MESTRE, login normalizado e GET /organizations/:id (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const server = () => app.getHttpServer();

  const userIds: number[] = [];
  const orgIds: number[] = [];
  const cleanups: Array<() => Promise<void>> = [];

  let orgA: number;
  let orgB: number;
  let orgBSlug: string;
  let orgASlug: string;
  let superToken: string;
  let plainPlatformToken: string;
  let memberSuperToken: string;

  // ---------------------------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------------------------
  async function makeOrg(label: string): Promise<{ id: number; slug: string }> {
    const slug = `e2e-authpwd-${label}-${uniq()}`;
    const org = await prisma.organization.create({ data: { name: `E2E AuthPwd ${slug}`, slug, type: 'GROUP', status: 'ACTIVE' } });
    orgIds.push(org.id);
    return { id: org.id, slug };
  }

  async function makeMember(
    role: OrgRole,
    opts: { orgId?: number; password?: string; email?: string; userStatus?: string; membershipStatus?: string; isSuperAdmin?: boolean } = {},
  ): Promise<Account> {
    const password = opts.password ?? INITIAL;
    const email = opts.email ?? `${role.toLowerCase()}-${uniq()}@${MAIL_DOMAIN}`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 4),
        name: `E2E ${role} ${uniq()}`,
        userType: UserType.MEMBER,
        status: opts.userStatus ?? 'ACTIVE',
        isSuperAdmin: opts.isSuperAdmin ?? false,
      },
    });
    userIds.push(user.id);
    const orgId = opts.orgId ?? orgA;
    await prisma.organizationUser.create({
      data: { organizationId: orgId, userId: user.id, role, status: opts.membershipStatus ?? 'ACTIVE' },
    });
    return { id: user.id, email, password, kind: 'MEMBER', orgId, role };
  }

  async function makePlatform(opts: { isSuperAdmin?: boolean; password?: string; status?: string } = {}): Promise<Account> {
    const password = opts.password ?? INITIAL;
    const email = `platform-${uniq()}@${MAIL_DOMAIN}`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 4),
        name: `E2E Platform ${uniq()}`,
        userType: UserType.PLATFORM,
        isSuperAdmin: opts.isSuperAdmin ?? false,
        status: opts.status ?? 'ACTIVE',
      },
    });
    userIds.push(user.id);
    return { id: user.id, email, password, kind: 'PLATFORM' };
  }

  const loginRaw = (account: Pick<Account, 'kind' | 'email'>, password: string, extra: Record<string, unknown> = {}) =>
    request(server())
      .post(account.kind === 'PLATFORM' ? '/api/auth/platform-login' : '/api/auth/login')
      .send({ email: account.email, password, ...extra });

  async function login(account: Account, password = account.password, extra: Record<string, unknown> = {}): Promise<string> {
    const res = await loginRaw(account, password, extra);
    assert.equal(res.status, 200, `login ${account.email}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.accessToken as string;
  }

  /** Status de uma rota autenticada qualquer (GET /organizations responde a MEMBER e PLATFORM). */
  const whoami = async (token: string): Promise<number> =>
    (await request(server()).get('/api/organizations').set('Authorization', `Bearer ${token}`)).status;

  const change = (token: string | undefined, body: unknown) => {
    const req = request(server()).post('/api/auth/change-password');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body as object);
  };

  const reset = (token: string | undefined, orgId: number | string, userId: number | string, body: unknown) => {
    const req = request(server()).post(`/api/organizations/${orgId}/members/${userId}/reset-password`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body as object);
  };

  const row = (id: number) => prisma.user.findUniqueOrThrow({ where: { id } });
  const passwordMatches = async (id: number, password: string) => bcrypt.compare(password, (await row(id)).passwordHash);

  // ---------------------------------------------------------------------------------------------
  before(async () => {
    // Rate limit global desligado só neste app (dezenas de logins/trocas); o limite em si é provado abaixo,
    // em apps próprios com o @Throttle rebaixado.
    app = await createTestApp({ disableThrottle: true });

    const a = await makeOrg('a');
    const b = await makeOrg('b');
    orgA = a.id;
    orgASlug = a.slug;
    orgB = b.id;
    orgBSlug = b.slug;

    const superAdmin = await createPlatformUser(prisma, 'authpwd-super', { isSuperAdmin: true });
    const plain = await createPlatformUser(prisma, 'authpwd-plain', { isSuperAdmin: false });
    userIds.push(superAdmin.id, plain.id);
    superToken = await platformLogin(app, superAdmin.email);
    plainPlatformToken = await platformLogin(app, plain.email);

    const memberSuper = await createMemberSuperAdmin(prisma, 'authpwd');
    cleanups.push(memberSuper.cleanup);
    memberSuperToken = (
      await request(server()).post('/api/auth/login').send({ email: memberSuper.email, password: DEV_PASSWORD }).expect(200)
    ).body.accessToken;
  });

  after(async () => {
    const swept = await prisma.user.findMany({ where: { email: { endsWith: `@${MAIL_DOMAIN}`, mode: 'insensitive' } }, select: { id: true } });
    const allUsers = [...new Set([...userIds, ...swept.map((u) => u.id)])];
    const allOrgs = [...new Set(orgIds)];
    await prisma.organizationUser.deleteMany({ where: { OR: [{ userId: { in: allUsers } }, { organizationId: { in: allOrgs } }] } });
    await prisma.user.deleteMany({ where: { id: { in: allUsers } } });
    await prisma.organization.deleteMany({ where: { id: { in: allOrgs } } });
    for (const cleanup of cleanups) await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  // ===============================================================================================
  // A) POST /auth/change-password
  // ===============================================================================================
  describe('A) POST /auth/change-password', () => {
    it('sucesso: token antigo 401 e novo vale NO MESMO segundo; login com a nova ok, com a antiga 401; outras sessões revogadas', async () => {
      const user = await makeMember(OrgRole.MESTRE);
      const oldToken = await login(user);
      const otherSession = await login(user);
      const newPassword = GOOD('sucesso');
      const loginPayload = jwtPayload(oldToken);
      const before = await row(user.id);
      assert.equal(before.tokenValidAfter, null);

      const res = await change(oldToken, { currentPassword: user.password, newPassword }).expect(200);

      assert.deepEqual(Object.keys(res.body), ['accessToken']);
      const newToken = res.body.accessToken as string;
      assert.equal(typeof newToken, 'string');
      assert.ok(!res.text.includes(newPassword) && !res.text.includes(user.password) && !res.text.includes('$2'));

      // sem sleep: o token antigo e a outra sessão morrem na hora; o novo funciona na requisição seguinte
      assert.equal(await whoami(oldToken), 401, 'token usado na chamada deve ser revogado');
      assert.equal(await whoami(otherSession), 401, 'outra sessão deve ser revogada');
      assert.equal(await whoami(newToken), 200, 'accessToken novo deve funcionar imediatamente');

      // mesmo formato/expiração do login
      const newPayload = jwtPayload(newToken);
      assert.deepEqual(Object.keys(newPayload).sort(), Object.keys(loginPayload).sort());
      for (const claim of ['sub', 'email', 'userType', 'isSuperAdmin', 'organizationId', 'role']) {
        assert.equal(newPayload[claim], loginPayload[claim], claim);
      }
      assert.equal(newPayload.exp - newPayload.iat, loginPayload.exp - loginPayload.iat);

      // 2ª via independente: o que ficou no banco
      const after = await row(user.id);
      assert.notEqual(after.passwordHash, before.passwordHash);
      assert.equal(await bcrypt.compare(newPassword, after.passwordHash), true);
      assert.equal(await bcrypt.compare(user.password, after.passwordHash), false);
      assert.equal(bcrypt.getRounds(after.passwordHash), 10, 'custo = BCRYPT_ROUNDS');
      assert.ok(after.tokenValidAfter, 'tokenValidAfter gravado');
      assert.ok(newPayload.iat * 1000 >= after.tokenValidAfter!.getTime(), 'iat do token novo >= corte de revogação');
      assert.ok(Math.abs(Date.now() - after.tokenValidAfter!.getTime()) < 10_000);

      // login com a nova senha funciona (e o token nasce válido no mesmo segundo); com a antiga, 401 genérico
      const fresh = await login(user, newPassword);
      assert.equal(await whoami(fresh), 200);
      const stale = await loginRaw(user, user.password).expect(401);
      assert.equal(stale.body.message, 'Credenciais inválidas.');
    });

    it('PROFESSOR, ALUNO, RESPONSAVEL, MESTRE, PLATFORM e super admin: cada um troca a PRÓPRIA senha (e só a própria)', async () => {
      const bystander = await makeMember(OrgRole.ALUNO);
      const accounts: Account[] = [
        await makeMember(OrgRole.PROFESSOR),
        await makeMember(OrgRole.ALUNO),
        await makeMember(OrgRole.RESPONSAVEL),
        await makeMember(OrgRole.MESTRE),
        await makePlatform(),
        await makePlatform({ isSuperAdmin: true }),
      ];
      for (const [i, account] of accounts.entries()) {
        const token = await login(account);
        const newPassword = GOOD(`papel-${i}`);
        const res = await change(token, { currentPassword: account.password, newPassword }).expect(200);
        assert.equal(await whoami(token), 401, `${account.role ?? account.kind}: token antigo`);
        assert.equal(await whoami(res.body.accessToken), 200, `${account.role ?? account.kind}: token novo`);
        await login(account, newPassword);
        await loginRaw(account, account.password).expect(401);
        assert.equal(await passwordMatches(account.id, newPassword), true);
      }
      assert.equal(await passwordMatches(bystander.id, bystander.password), true, 'a senha de terceiros não muda');
      assert.equal((await row(bystander.id)).tokenValidAfter, null);
    });

    it('conta MEMBER com vínculo em 2 grupos: o token novo mantém organizationId/role do token usado', async () => {
      const user = await makeMember(OrgRole.MESTRE, { orgId: orgA });
      await prisma.organizationUser.create({ data: { organizationId: orgB, userId: user.id, role: OrgRole.ALUNO, status: 'ACTIVE' } });
      await loginRaw(user, user.password).expect(400); // exige organizationSlug
      const tokenB = await login(user, user.password, { organizationSlug: orgBSlug });
      const res = await change(tokenB, { currentPassword: user.password, newPassword: GOOD('multi') }).expect(200);
      const payload = jwtPayload(res.body.accessToken);
      assert.equal(payload.organizationId, orgB);
      assert.equal(payload.role, 'ALUNO');
      const tokenA = await login(user, GOOD('multi'), { organizationSlug: orgASlug });
      assert.equal(jwtPayload(tokenA).role, 'MESTRE');
    });

    it('senha atual errada: 400 "Senha atual incorreta." (NUNCA 401), nada muda, sessão continua válida', async () => {
      for (const make of [() => makeMember(OrgRole.PROFESSOR), () => makePlatform()]) {
        const user = await make();
        const token = await login(user);
        const before = await row(user.id);

        for (const wrong of ['senha-errada-qualquer', user.password + 'x', user.password.toUpperCase(), ' ' + user.password]) {
          const res = await change(token, { currentPassword: wrong, newPassword: GOOD('x') });
          assert.equal(res.status, 400, `${user.kind}: esperado 400, veio ${res.status}`);
          assert.equal(res.body.message, 'Senha atual incorreta.');
          assert.equal(res.body.statusCode, 400);
        }

        const after = await row(user.id);
        assert.equal(after.passwordHash, before.passwordHash, 'hash intacto');
        assert.equal(after.tokenValidAfter, null, 'nada revogado');
        assert.equal(await whoami(token), 200, 'a sessão continua válida (o front não pode deslogar)');
        await login(user); // senha antiga continua valendo
      }
    });

    it('política da nova senha: 11 chars, 73/74 bytes, Dev@12345 (qualquer caixa), igual à atual, não-string, ausente e campos extras => 400, nada muda', async () => {
      const user = await makeMember(OrgRole.MESTRE);
      const token = await login(user);
      const before = await row(user.id);
      const cur = user.password;
      const cases: Array<[string, Record<string, unknown>, RegExp]> = [
        ['11 chars', { currentPassword: cur, newPassword: 'Abcdef#1234' }, /newPassword/],
        ['73 bytes', { currentPassword: cur, newPassword: 'a'.repeat(73) }, /newPassword/],
        ['74 bytes multibyte', { currentPassword: cur, newPassword: 'ç'.repeat(37) }, /newPassword/],
        ['Dev@12345', { currentPassword: cur, newPassword: 'Dev@12345' }, /newPassword/],
        ['dev@12345 maiúsculas e embutida', { currentPassword: cur, newPassword: 'meu-DEV@12345-ok!!' }, /newPassword/],
        ['igual à atual', { currentPassword: cur, newPassword: cur }, /diferente da atual/],
        ['número', { currentPassword: cur, newPassword: 123456789012345 }, /newPassword/],
        ['array', { currentPassword: cur, newPassword: [GOOD('arr')] }, /newPassword/],
        ['objeto', { currentPassword: cur, newPassword: { $ne: null } }, /newPassword/],
        ['null', { currentPassword: cur, newPassword: null }, /newPassword/],
        ['newPassword ausente', { currentPassword: cur }, /newPassword/],
        ['currentPassword ausente', { newPassword: GOOD('a') }, /currentPassword/],
        ['currentPassword não-string', { currentPassword: 12345678, newPassword: GOOD('b') }, /currentPassword/],
        ['currentPassword vazia', { currentPassword: '', newPassword: GOOD('c') }, /currentPassword/],
        ['campo extra', { currentPassword: cur, newPassword: GOOD('d'), extra: true }, /should not exist/],
        ['tentar trocar outro usuário', { currentPassword: cur, newPassword: GOOD('e'), userId: 1 }, /should not exist/],
        ['tentar passar o hash', { currentPassword: cur, newPassword: GOOD('f'), passwordHash: 'x' }, /should not exist/],
      ];
      for (const [label, body, expected] of cases) {
        const res = await change(token, body);
        assert.equal(res.status, 400, `${label}: ${res.status} ${JSON.stringify(res.body)}`);
        assert.match(JSON.stringify(res.body.message), expected, label);
      }
      assert.equal((await change(token, [])).status, 400);
      assert.equal((await change(token, 'texto')).status, 400);

      const after = await row(user.id);
      assert.equal(after.passwordHash, before.passwordHash);
      assert.equal(after.tokenValidAfter, null);
      assert.equal(await whoami(token), 200);
    });

    it('limites exatos aceitos: 12 caracteres e 72 bytes (ASCII e multibyte); espaços nas pontas fazem parte da senha', async () => {
      const user = await makeMember(OrgRole.PROFESSOR);
      let password = user.password;
      let token = await login(user);
      for (const next of ['Abcdef#12345', `${'a'.repeat(71)}1`, 'ç'.repeat(36), `  ${GOOD('espacos')}  `]) {
        const res = await change(token, { currentPassword: password, newPassword: next }).expect(200);
        token = res.body.accessToken;
        password = next;
        assert.equal(await passwordMatches(user.id, next), true);
        assert.equal(await whoami(token), 200);
        await login(user, next);
      }
    });

    it('sem token / token inválido / Bearer vazio => 401 e nada muda', async () => {
      const user = await makeMember(OrgRole.ALUNO);
      const before = await row(user.id);
      const body = { currentPassword: user.password, newPassword: GOOD('anon') };
      await change(undefined, body).expect(401);
      await change('token-invalido', body).expect(401);
      await change('', body).expect(401);
      assert.equal((await row(user.id)).passwordHash, before.passwordHash);
    });

    it('usuário inativo, vínculo inativo e sessão revogada => 401 (nada muda)', async () => {
      const body = (u: Account) => ({ currentPassword: u.password, newPassword: GOOD('inativo') });

      const inactive = await makeMember(OrgRole.PROFESSOR);
      const tokenInactive = await login(inactive);
      await prisma.user.update({ where: { id: inactive.id }, data: { status: 'INACTIVE' } });
      await change(tokenInactive, body(inactive)).expect(401);
      assert.equal(await passwordMatches(inactive.id, inactive.password), true);

      const platformInactive = await makePlatform();
      const tokenPlatformInactive = await login(platformInactive);
      await prisma.user.update({ where: { id: platformInactive.id }, data: { status: 'INACTIVE' } });
      await change(tokenPlatformInactive, body(platformInactive)).expect(401);

      const removed = await makeMember(OrgRole.ALUNO);
      const tokenRemoved = await login(removed);
      assert.equal(await whoami(tokenRemoved), 200);
      await prisma.organizationUser.updateMany({ where: { userId: removed.id }, data: { status: 'INACTIVE' } });
      await change(tokenRemoved, body(removed)).expect(401); // JwtStrategy não olha o vínculo; o service sim
      assert.equal(await passwordMatches(removed.id, removed.password), true);

      const revoked = await makeMember(OrgRole.MESTRE);
      const tokenRevoked = await login(revoked);
      await prisma.user.update({ where: { id: revoked.id }, data: { tokenValidAfter: new Date(Date.now() + 60_000) } });
      await change(tokenRevoked, body(revoked)).expect(401);
      assert.equal(await passwordMatches(revoked.id, revoked.password), true);
    });

    it('login logo depois da revogação: o token nasce válido mesmo no mesmo segundo (iat >= corte)', async () => {
      const user = await makeMember(OrgRole.MESTRE);
      // corte 1 ms à frente de agora (como a troca grava); logins seguidos NUNCA podem nascer revogados
      await prisma.user.update({ where: { id: user.id }, data: { tokenValidAfter: new Date(Date.now() + 1) } });
      for (let i = 0; i < 5; i++) {
        const token = await login(user);
        assert.equal(await whoami(token), 200, `login ${i}`);
      }
    });

    it('duas trocas simultâneas com o mesmo token: no máximo uma vence; o banco fica com a senha da vencedora', async () => {
      const user = await makeMember(OrgRole.MESTRE);
      const token = await login(user);
      const [p1, p2] = [GOOD('corrida-1'), GOOD('corrida-2')];
      const [r1, r2] = await Promise.all([
        change(token, { currentPassword: user.password, newPassword: p1 }),
        change(token, { currentPassword: user.password, newPassword: p2 }),
      ]);
      const statuses = [r1.status, r2.status].sort();
      assert.equal(statuses[0], 200, `statuses ${statuses}`);
      assert.ok([400, 409].includes(statuses[1]), `statuses ${statuses}`);
      const winner = r1.status === 200 ? p1 : p2;
      const loser = r1.status === 200 ? p2 : p1;
      assert.equal(await passwordMatches(user.id, winner), true);
      assert.equal(await passwordMatches(user.id, loser), false);
    });

    it('a senha nunca aparece em resposta nem em log (sucesso, 400 de política, senha atual errada, 401)', async () => {
      const user = await makeMember(OrgRole.MESTRE);
      const token = await login(user);
      const secretNew = GOOD('segredo-novo');
      const secretWrong = `Errada#Secreta-${TAG}`;
      const secretPolicy = 'Dev@12345-politica';

      // prova que a captura funciona (senão "não achei" não significaria nada)
      const canary = await captureOutput(async () => {
        console.log(`canario-${TAG}`);
        process.stderr.write(`canario-err-${TAG}\n`);
      });
      assert.ok(canary.output.includes(`canario-${TAG}`) && canary.output.includes(`canario-err-${TAG}`));

      const { result: responses, output } = await captureOutput(async () => [
        await change(token, { currentPassword: secretWrong, newPassword: secretNew }),
        await change(token, { currentPassword: user.password, newPassword: secretPolicy }),
        await change(token, { currentPassword: user.password, newPassword: secretNew, extra: secretWrong }),
        await change('token-invalido', { currentPassword: secretWrong, newPassword: secretNew }),
        await change(token, { currentPassword: user.password, newPassword: secretNew }),
        await change(token, { currentPassword: secretNew, newPassword: GOOD('depois') }), // token já revogado
      ]);
      assert.deepEqual(responses.map((r) => r.status), [400, 400, 400, 401, 200, 401]);

      const secrets = [user.password, secretNew, secretWrong, secretPolicy];
      for (const res of responses) {
        const everything = res.text + JSON.stringify(res.headers);
        for (const secret of secrets) assert.ok(!everything.includes(secret), 'senha vazou na resposta');
        assert.ok(!everything.includes('$2b$') && !everything.includes('passwordHash'));
      }
      for (const secret of secrets) assert.ok(!output.includes(secret), 'senha vazou em log');
      assert.ok(!output.includes('$2b$'), 'hash vazou em log');
    });

    it('rate limit: 429 depois do limite (por IP E por usuário — trocar de IP não contorna)', async () => {
      await withThrottleLimit(AuthController, 'changePassword', 3, async () => {
        const limited = await createTestApp(); // throttle ligado, contadores limpos
        try {
          (limited.getHttpAdapter().getInstance() as { set(k: string, v: unknown): void }).set('trust proxy', true);
          const attempt = (token: string, ip: string, currentPassword = 'errada-qualquer') =>
            request(limited.getHttpServer())
              .post('/api/auth/change-password')
              .set('Authorization', `Bearer ${token}`)
              .set('X-Forwarded-For', ip)
              .send({ currentPassword, newPassword: GOOD('limite') });
          const tokenOf = async (u: Account) =>
            (await request(limited.getHttpServer()).post('/api/auth/login').send({ email: u.email, password: u.password }).expect(200)).body.accessToken as string;

          // (1) POR USUÁRIO: mesmo usuário, 4 IPs diferentes => a 4ª é 429 mesmo com IP "novo"
          const victim = await makeMember(OrgRole.MESTRE);
          const victimToken = await tokenOf(victim);
          for (const ip of ['10.1.0.1', '10.1.0.2', '10.1.0.3']) assert.equal((await attempt(victimToken, ip)).status, 400, ip);
          const blocked = await attempt(victimToken, '10.1.0.4');
          assert.equal(blocked.status, 429, 'limite por usuário');
          assert.ok(!blocked.text.includes('errada-qualquer'));
          // outro usuário, de um IP já usado pelo primeiro, NÃO é bloqueado (contagem por usuário)
          const bystander = await makeMember(OrgRole.PROFESSOR);
          assert.equal((await attempt(await tokenOf(bystander), '10.1.0.1')).status, 400);
          // e a senha NÃO foi trocada durante a rajada
          assert.equal(await passwordMatches(victim.id, victim.password), true);

          // (2) POR IP: 3 usuários distintos no mesmo IP => o 4º, de outro usuário, é 429
          const sameIp = '10.2.0.1';
          for (let i = 0; i < 3; i++) assert.equal((await attempt(await tokenOf(await makeMember(OrgRole.ALUNO)), sameIp)).status, 400);
          assert.equal((await attempt(await tokenOf(await makeMember(OrgRole.ALUNO)), sameIp)).status, 429, 'limite por IP');
        } finally {
          await limited.close();
        }
      });
    });
  });

  // ===============================================================================================
  // B) POST /organizations/:orgId/members/:userId/reset-password
  // ===============================================================================================
  describe('B) POST /organizations/:orgId/members/:userId/reset-password', () => {
    it('super admin reseta o MESTRE: 204 sem corpo; login novo ok, antigo 401; tokens antigos 401 na hora; hash/custo/tokenValidAfter no banco', async () => {
      const mestre = await makeMember(OrgRole.MESTRE);
      const professor = await makeMember(OrgRole.PROFESSOR);
      const oldToken = await login(mestre);
      const otherSession = await login(mestre);
      const before = await row(mestre.id);
      const newPassword = GOOD('reset');

      const res = await reset(superToken, orgA, mestre.id, { newPassword });
      assert.equal(res.status, 204);
      assert.equal(res.text, '');
      assert.deepEqual(res.body, {});
      assert.ok(!JSON.stringify(res.headers).includes(newPassword));

      assert.equal(await whoami(oldToken), 401);
      assert.equal(await whoami(otherSession), 401);
      const fresh = await login(mestre, newPassword);
      assert.equal(await whoami(fresh), 200, 'login logo após o reset vale no mesmo segundo');
      const stale = await loginRaw(mestre, mestre.password).expect(401);
      assert.equal(stale.body.message, 'Credenciais inválidas.');

      const after = await row(mestre.id);
      assert.notEqual(after.passwordHash, before.passwordHash);
      assert.equal(await bcrypt.compare(newPassword, after.passwordHash), true);
      assert.equal(bcrypt.getRounds(after.passwordHash), 10);
      assert.ok(after.tokenValidAfter);
      assert.ok(Math.abs(Date.now() - after.tokenValidAfter!.getTime()) < 10_000);
      assert.equal(after.status, 'ACTIVE');
      assert.equal(after.userType, 'MEMBER');
      assert.equal(await passwordMatches(professor.id, professor.password), true, 'colega de grupo intacto');

      // o MESTRE segue o fluxo normal depois: troca a própria senha com a que o admin definiu
      const res2 = await change(fresh, { currentPassword: newPassword, newPassword: GOOD('depois-do-reset') }).expect(200);
      assert.equal(await whoami(res2.body.accessToken), 200);
    });

    it('política: 11 chars, 73 bytes, Dev@12345, não-string, ausente, campos extras (inclusive "password") => 400 e nada muda', async () => {
      const mestre = await makeMember(OrgRole.MESTRE);
      const token = await login(mestre);
      const before = await row(mestre.id);
      const bodies: unknown[] = [
        {},
        { newPassword: 'Abcdef#1234' },
        { newPassword: 'a'.repeat(73) },
        { newPassword: 'ç'.repeat(37) },
        { newPassword: 'Dev@12345' },
        { newPassword: 'DEV@12345-abc' },
        { newPassword: 123456789012 },
        { newPassword: null },
        { newPassword: [GOOD('x')] },
        { newPassword: GOOD('x'), extra: 1 },
        { password: GOOD('x') }, // o campo do platform-team NÃO vale aqui
        { newPassword: GOOD('x'), currentPassword: INITIAL },
        [],
      ];
      for (const body of bodies) {
        const res = await reset(superToken, orgA, mestre.id, body);
        assert.equal(res.status, 400, `${JSON.stringify(body)} -> ${res.status} ${JSON.stringify(res.body)}`);
      }
      const after = await row(mestre.id);
      assert.equal(after.passwordHash, before.passwordHash);
      assert.equal(after.tokenValidAfter, null);
      assert.equal(await whoami(token), 200);
      // limites exatos aceitos
      await reset(superToken, orgA, mestre.id, { newPassword: 'Abcdef#12345' }).expect(204);
      await reset(superToken, orgA, mestre.id, { newPassword: `${'a'.repeat(71)}1` }).expect(204);
    });

    it('quem não é super admin ativo: PLATFORM comum 403, MEMBER (inclusive o próprio MESTRE e MEMBER com flag isSuperAdmin) 403, anônimo/token inválido 401, super admin demovido 403, desativado 401', async () => {
      const mestre = await makeMember(OrgRole.MESTRE);
      const mestreToken = await login(mestre);
      const before = await row(mestre.id);
      const body = { newPassword: GOOD('intruso') };

      const forbidden = [
        await reset(plainPlatformToken, orgA, mestre.id, body),
        await reset(mestreToken, orgA, mestre.id, body), // o MESTRE não reseta nem a si mesmo por aqui
        await reset(memberSuperToken, orgA, mestre.id, body), // MEMBER com isSuperAdmin = true
        await reset(plainPlatformToken, orgA, mestre.id, {}), // 403 vem antes da validação do corpo
      ];
      for (const res of forbidden) {
        assert.equal(res.status, 403, JSON.stringify(res.body));
        assert.ok(!JSON.stringify(res.body).includes(body.newPassword));
      }
      assert.equal((await reset(undefined, orgA, mestre.id, body)).status, 401);
      assert.equal((await reset('token-invalido', orgA, mestre.id, body)).status, 401);

      const demotable = await makePlatform({ isSuperAdmin: true });
      const demotableToken = await login(demotable);
      await reset(demotableToken, orgA, mestre.id, { newPassword: GOOD('ok-antes') }).expect(204);
      await prisma.user.update({ where: { id: mestre.id }, data: { passwordHash: before.passwordHash, tokenValidAfter: null } });
      await prisma.user.update({ where: { id: demotable.id }, data: { isSuperAdmin: false } });
      assert.equal((await reset(demotableToken, orgA, mestre.id, body)).status, 403, 'rebaixado perde o poder na hora');
      await prisma.user.update({ where: { id: demotable.id }, data: { isSuperAdmin: true, status: 'INACTIVE' } });
      assert.equal((await reset(demotableToken, orgA, mestre.id, body)).status, 401, 'desativado');

      const after = await row(mestre.id);
      assert.equal(after.passwordHash, before.passwordHash, 'nenhuma tentativa negada alterou a senha');
      assert.equal(await whoami(mestreToken), 200);
    });

    it('alvo que não é MESTRE ativo do grupo (outro papel, outra organização, inexistente, vínculo inativo, PLATFORM) => MESMO 404 e nada muda', async () => {
      const mestreA = await makeMember(OrgRole.MESTRE, { orgId: orgA });
      const professorA = await makeMember(OrgRole.PROFESSOR, { orgId: orgA });
      const alunoA = await makeMember(OrgRole.ALUNO, { orgId: orgA });
      const responsavelA = await makeMember(OrgRole.RESPONSAVEL, { orgId: orgA });
      const mestreB = await makeMember(OrgRole.MESTRE, { orgId: orgB });
      const mestreInativo = await makeMember(OrgRole.MESTRE, { orgId: orgA, membershipStatus: 'INACTIVE' });
      const platform = await makePlatform({ isSuperAdmin: true });
      const targets = [mestreA, professorA, alunoA, responsavelA, mestreB, mestreInativo, platform];
      const hashes = new Map<number, string>();
      for (const t of targets) hashes.set(t.id, (await row(t.id)).passwordHash);
      const body = { newPassword: GOOD('alvo-errado') };

      const attempts: Array<[string, number | string, number | string]> = [
        ['PROFESSOR', orgA, professorA.id],
        ['ALUNO', orgA, alunoA.id],
        ['RESPONSAVEL', orgA, responsavelA.id],
        ['MESTRE de outra org (no caminho da org A)', orgA, mestreB.id],
        ['MESTRE da org A no caminho da org B', orgB, mestreA.id],
        ['MESTRE com vínculo inativo', orgA, mestreInativo.id],
        ['usuário PLATFORM', orgA, platform.id],
        ['usuário inexistente', orgA, 2_000_000_000],
        ['usuário gigante (> int32)', orgA, '99999999999999'],
        ['organização inexistente', 2_000_000_000, mestreA.id],
        ['organização gigante', '99999999999999', mestreA.id],
      ];
      const bodies: unknown[] = [];
      for (const [label, o, u] of attempts) {
        const res = await reset(superToken, o, u, body);
        assert.equal(res.status, 404, `${label}: ${res.status} ${JSON.stringify(res.body)}`);
        bodies.push(res.body);
      }
      for (const b of bodies) assert.deepEqual(b, bodies[0], '404 idêntico para todos os casos (não vaza existência)');
      assert.match((bodies[0] as { message: string }).message, /não encontrado/i);

      for (const t of targets) assert.equal((await row(t.id)).passwordHash, hashes.get(t.id), `hash de ${t.role ?? t.kind} intacto`);
      assert.equal((await row(mestreInativo.id)).tokenValidAfter, null);

      // ids não numéricos: 400 do ParseIntPipe (rota nem chega no service)
      assert.equal((await reset(superToken, 'abc', mestreA.id, body)).status, 400);
      assert.equal((await reset(superToken, orgA, 'abc', body)).status, 400);
    });

    it('a senha é do USUÁRIO: MESTRE que também é membro de outro grupo tem a senha trocada nos dois (e as sessões dos dois revogadas)', async () => {
      const user = await makeMember(OrgRole.MESTRE, { orgId: orgA });
      await prisma.organizationUser.create({ data: { organizationId: orgB, userId: user.id, role: OrgRole.ALUNO, status: 'ACTIVE' } });
      const tokenB = await login(user, user.password, { organizationSlug: orgBSlug });
      await reset(superToken, orgA, user.id, { newPassword: GOOD('multi-reset') }).expect(204);
      assert.equal(await whoami(tokenB), 401);
      await login(user, GOOD('multi-reset'), { organizationSlug: orgBSlug });
      await login(user, GOOD('multi-reset'), { organizationSlug: orgASlug });
      await loginRaw(user, user.password, { organizationSlug: orgBSlug }).expect(401);
    });

    it('a senha nunca aparece em resposta nem em log', async () => {
      const mestre = await makeMember(OrgRole.MESTRE);
      const secret = GOOD('segredo-reset');
      const { result, output } = await captureOutput(async () => [
        await reset(superToken, orgA, mestre.id, { newPassword: secret }),
        await reset(superToken, orgA, 2_000_000_000, { newPassword: secret }),
        await reset(superToken, orgA, mestre.id, { newPassword: secret, extra: secret }),
        await reset(plainPlatformToken, orgA, mestre.id, { newPassword: secret }),
        await reset(undefined, orgA, mestre.id, { newPassword: secret }),
      ]);
      assert.deepEqual(result.map((r) => r.status), [204, 404, 400, 403, 401]);
      for (const res of result) assert.ok(!(res.text + JSON.stringify(res.headers)).includes(secret));
      assert.ok(!output.includes(secret) && !output.includes('$2b$'));
    });

    it('rate limit: 429 depois do limite', async () => {
      await withThrottleLimit(OrganizationsController, 'resetMestrePassword', 3, async () => {
        const limited = await createTestApp();
        try {
          const mestre = await makeMember(OrgRole.MESTRE);
          const admin = await createPlatformUser(prisma, 'authpwd-throttle', { isSuperAdmin: true });
          userIds.push(admin.id);
          const token = (await request(limited.getHttpServer()).post('/api/auth/platform-login').send({ email: admin.email, password: DEV_PASSWORD }).expect(200)).body.accessToken;
          const attempt = () =>
            request(limited.getHttpServer())
              .post(`/api/organizations/${orgA}/members/${mestre.id}/reset-password`)
              .set('Authorization', `Bearer ${token}`)
              .send({});
          for (let i = 0; i < 3; i++) await attempt().expect(400);
          await attempt().expect(429);
          assert.equal(await passwordMatches(mestre.id, mestre.password), true);
        } finally {
          await limited.close();
        }
      });
    });
  });

  // ===============================================================================================
  // C) login normaliza o e-mail
  // ===============================================================================================
  describe('C) login normaliza o e-mail', () => {
    it('MEMBER: "  MESTRE-x@E2E-AUTH-PWD.LOCAL  " (maiúsculas e espaços) loga; o e-mail da resposta é o gravado', async () => {
      const mestre = await makeMember(OrgRole.MESTRE);
      for (const typed of [mestre.email.toUpperCase(), `  ${mestre.email}  `, `\t${mestre.email.toUpperCase()}\n`, mestre.email.replace(/^./, (c) => c.toUpperCase())]) {
        const res = await request(server()).post('/api/auth/login').send({ email: typed, password: mestre.password });
        assert.equal(res.status, 200, JSON.stringify(typed));
        assert.equal(res.body.user.email, mestre.email);
        assert.equal(res.body.user.role, 'MESTRE');
        assert.equal(await whoami(res.body.accessToken), 200);
      }
      // senha continua diferenciando maiúsculas; e-mail malformado = 400 como antes
      await request(server()).post('/api/auth/login').send({ email: mestre.email.toUpperCase(), password: mestre.password.toUpperCase() }).expect(401);
      await request(server()).post('/api/auth/login').send({ email: 'nao-e-email', password: mestre.password }).expect(400);
    });

    it('PLATFORM: platform-login com maiúsculas e espaços funciona; MEMBER continua barrado no platform-login', async () => {
      const platform = await makePlatform();
      const res = await request(server()).post('/api/auth/platform-login').send({ email: `  ${platform.email.toUpperCase()} `, password: platform.password }).expect(200);
      assert.equal(res.body.user.email, platform.email);
      const member = await makeMember(OrgRole.MESTRE);
      await request(server()).post('/api/auth/platform-login').send({ email: member.email.toUpperCase(), password: member.password }).expect(401);
      await request(server()).post('/api/auth/login').send({ email: platform.email.toUpperCase(), password: platform.password }).expect(401);
    });

    it('conta LEGADA gravada com maiúsculas (como o TeachersService antigo fazia) continua logando — com qualquer caixa', async () => {
      const legacyEmail = `Prof.Legado-${uniq()}@E2E-Auth-Pwd.LOCAL`;
      const legacy = await makeMember(OrgRole.PROFESSOR, { email: legacyEmail });
      assert.equal((await row(legacy.id)).email, legacyEmail, 'gravada com maiúsculas');
      for (const typed of [legacyEmail, legacyEmail.toLowerCase(), legacyEmail.toUpperCase(), `  ${legacyEmail}  `]) {
        const res = await request(server()).post('/api/auth/login').send({ email: typed, password: legacy.password });
        assert.equal(res.status, 200, typed);
        assert.equal(res.body.user.email, legacyEmail);
      }
      const legacyPlatformEmail = `Plat.Legado-${uniq()}@E2E-Auth-Pwd.LOCAL`;
      const prow = await prisma.user.create({
        data: { email: legacyPlatformEmail, passwordHash: await bcrypt.hash(INITIAL, 4), name: 'Legado Plat', userType: 'PLATFORM', status: 'ACTIVE' },
      });
      userIds.push(prow.id);
      for (const typed of [legacyPlatformEmail, legacyPlatformEmail.toLowerCase()]) {
        await request(server()).post('/api/auth/platform-login').send({ email: typed, password: INITIAL }).expect(200);
      }
    });

    it('duas contas legadas que diferem só na caixa: cada senha abre a sua conta; nenhuma outra senha abre nenhuma', async () => {
      const lower = await makeMember(OrgRole.PROFESSOR, { email: `dup-${uniq()}@${MAIL_DOMAIN}`, password: `Senha#Minuscula-${TAG}` });
      const upperEmail = lower.email.replace(/^dup/, 'DUP');
      const upper = await makeMember(OrgRole.ALUNO, { email: upperEmail, password: `Senha#Maiuscula-${TAG}` });
      const a = await request(server()).post('/api/auth/login').send({ email: lower.email, password: lower.password }).expect(200);
      assert.equal(a.body.user.id, lower.id);
      const b = await request(server()).post('/api/auth/login').send({ email: upperEmail, password: upper.password }).expect(200);
      assert.equal(b.body.user.id, upper.id);
      await request(server()).post('/api/auth/login').send({ email: lower.email, password: 'outra-senha-qualquer' }).expect(401);
    });

    it('curingas LIKE não funcionam no e-mail ("_" e "%" são literais)', async () => {
      const real = await makeMember(OrgRole.ALUNO, { email: `curinga-${uniq()}@${MAIL_DOMAIN}` });
      for (const typed of [real.email.replace('curinga', 'c_ringa'), real.email.replace('curinga', 'c%'), real.email.replace(/^curinga/, '%')]) {
        const res = await request(server()).post('/api/auth/login').send({ email: typed, password: real.password });
        assert.ok([400, 401].includes(res.status), `${typed} -> ${res.status}`);
      }

      // cadastro: o mesmo "_" não gera 409 falso (e-mail diferente de verdade) e a duplicata real (outra caixa) segue barrada
      const twin = real.email.replace('curinga', 'c_ringa');
      const created = await request(server())
        .post('/api/organizations')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: `E2E AuthPwd curinga ${uniq()}`, mestre: { name: 'Mestre Curinga', email: twin, password: GOOD('curinga') } });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      orgIds.push(created.body.id);
      userIds.push(created.body.mestre.id);
      const dup = await request(server())
        .post('/api/organizations')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: `E2E AuthPwd dup ${uniq()}`, mestre: { name: 'Mestre Dup', email: real.email.toUpperCase().replace('@E2E-AUTH-PWD.LOCAL', '@e2e-auth-pwd.local'), password: GOOD('dup') } });
      assert.equal(dup.status, 409, JSON.stringify(dup.body));
    });

    it('rate limit do login não é contornado variando maiúsculas/espaços (login e platform-login)', async () => {
      for (const [method, path] of [['login', '/api/auth/login'], ['platformLogin', '/api/auth/platform-login']] as const) {
        await withThrottleLimit(AuthController, method, 3, async () => {
          const limited = await createTestApp();
          try {
            const email = `contorno-${uniq()}@${MAIL_DOMAIN}`;
            const variants = [email, email.toUpperCase(), ` ${email} `, email.replace(/^./, 'C')];
            const statuses: number[] = [];
            for (const typed of variants) {
              statuses.push((await request(limited.getHttpServer()).post(path).send({ email: typed, password: 'senha-errada' })).status);
            }
            assert.deepEqual(statuses, [401, 401, 401, 429], `${path}: ${statuses}`);
          } finally {
            await limited.close();
          }
        });
      }
    });

    it('POST /teachers grava o e-mail em minúsculas e recusa duplicata que só difere na caixa', async () => {
      const mestre = await makeMember(OrgRole.MESTRE);
      const token = await login(mestre);
      const typed = `Prof.Novo-${uniq()}@E2E-Auth-Pwd.Local`;
      const created = await request(server())
        .post('/api/teachers')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Professor Novo', email: typed, password: 'senha-simples-1', role: 'PROFESSOR' })
        .expect(201);
      assert.equal(created.body.user.email, typed.toLowerCase());
      userIds.push(created.body.user.id);
      assert.equal((await row(created.body.user.id)).email, typed.toLowerCase());

      const dup = await request(server())
        .post('/api/teachers')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Outro', email: typed.toUpperCase().replace('@E2E-AUTH-PWD.LOCAL', '@e2e-auth-pwd.local'), password: 'senha-simples-1', role: 'PROFESSOR' });
      assert.equal(dup.status, 400);
      assert.equal(dup.body.message, 'E-mail já cadastrado.');
      await request(server()).post('/api/auth/login').send({ email: typed, password: 'senha-simples-1' }).expect(200);
    });
  });

  // ===============================================================================================
  // D) GET /organizations/:id
  // ===============================================================================================
  describe('D) GET /organizations/:id', () => {
    it('PLATFORM (super e comum): 200 com a organização no formato da lista + mestres {id,name,email,status}, sem nenhum segredo', async () => {
      const org = await makeOrg('detalhe');
      const m1 = await makeMember(OrgRole.MESTRE, { orgId: org.id });
      const m2 = await makeMember(OrgRole.MESTRE, { orgId: org.id, membershipStatus: 'INACTIVE' });
      await makeMember(OrgRole.PROFESSOR, { orgId: org.id });
      await makeMember(OrgRole.ALUNO, { orgId: org.id });
      await makeMember(OrgRole.MESTRE, { orgId: orgB }); // mestre de OUTRO grupo não entra

      const dbOrg = JSON.parse(JSON.stringify(await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })));
      for (const token of [superToken, plainPlatformToken]) {
        const res = await request(server()).get(`/api/organizations/${org.id}`).set('Authorization', `Bearer ${token}`).expect(200);
        const { mestres, ...organization } = res.body;
        assert.deepEqual(organization, dbOrg, 'mesmas colunas de uma linha de GET /organizations');
        assert.deepEqual(mestres, [
          { id: m1.id, name: (await row(m1.id)).name, email: m1.email, status: 'ACTIVE' },
          { id: m2.id, name: (await row(m2.id)).name, email: m2.email, status: 'INACTIVE' },
        ]);
        for (const m of mestres) assert.deepEqual(Object.keys(m).sort(), ['email', 'id', 'name', 'status']);
        for (const forbidden of ['passwordHash', 'tokenValidAfter', 'twoFactorSecret', '$2b$', '$2a$', 'userType', 'isSuperAdmin']) {
          assert.ok(!res.text.includes(forbidden), `vazou ${forbidden}`);
        }
      }

      // mesmo formato da lista: as chaves da organização são as de uma linha de GET /organizations
      const list = await request(server()).get('/api/organizations').set('Authorization', `Bearer ${superToken}`).expect(200);
      assert.ok(Array.isArray(list.body) && list.body.length > 0);
      const one = await request(server()).get(`/api/organizations/${org.id}`).set('Authorization', `Bearer ${superToken}`).expect(200);
      assert.deepEqual(Object.keys(one.body).filter((k) => k !== 'mestres').sort(), Object.keys(list.body[0]).sort());
    });

    it('grupo sem MESTRE => mestres: []; a lista GET /organizations não mudou (array, sem "mestres")', async () => {
      const org = await makeOrg('sem-mestre');
      const res = await request(server()).get(`/api/organizations/${org.id}`).set('Authorization', `Bearer ${superToken}`).expect(200);
      assert.deepEqual(res.body.mestres, []);
      assert.equal(res.body.id, org.id);
      const list = await request(server()).get('/api/organizations').set('Authorization', `Bearer ${superToken}`).expect(200);
      assert.ok(Array.isArray(list.body));
      assert.ok(list.body.length <= 50);
      assert.ok(list.body.every((o: Record<string, unknown>) => !('mestres' in o)));
    });

    it('404 inexistente (inclusive id gigante), 400 não numérico, 403 para MEMBER (qualquer papel, inclusive o próprio grupo), 401 anônimo', async () => {
      const sup = { Authorization: `Bearer ${superToken}` };
      const nf = await request(server()).get('/api/organizations/2000000000').set(sup).expect(404);
      assert.equal((await request(server()).get('/api/organizations/99999999999999').set(sup).expect(404)).body.message, nf.body.message);
      await request(server()).get('/api/organizations/abc').set(sup).expect(400);

      for (const role of [OrgRole.MESTRE, OrgRole.PROFESSOR, OrgRole.ALUNO, OrgRole.RESPONSAVEL]) {
        const member = await makeMember(role);
        const token = await login(member);
        const own = await request(server()).get(`/api/organizations/${orgA}`).set('Authorization', `Bearer ${token}`);
        assert.equal(own.status, 403, `${role} no próprio grupo`);
        const other = await request(server()).get(`/api/organizations/${orgB}`).set('Authorization', `Bearer ${token}`);
        assert.equal(other.status, 403, `${role} em outro grupo`);
        assert.ok(!own.text.includes('mestres'));
      }
      await request(server()).get(`/api/organizations/${orgA}`).expect(401);
      await request(server()).get(`/api/organizations/${orgA}`).set('Authorization', 'Bearer token-invalido').expect(401);
    });
  });
});
