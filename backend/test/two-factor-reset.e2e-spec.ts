import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { generateTotpSecret } from '../src/shared/security/totp';
import { encryptTwoFactorSecret, generateRecoveryCodes, hashRecoveryCode } from '../src/shared/security/two-factor-crypto';
import { DEV_PASSWORD } from './utils/list-helpers';
import { createPlatformUser, platformLogin } from './utils/platform-team-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * POST /auth/2fa/reset/:userId — MESTRE (so' usuarios do proprio grupo) e super admin (qualquer um). Grupos e usuarios
 * PROPRIOS da suite (nao toca no seed ginga-brasil nem no demo); o 2FA dos alvos e' ligado direto no banco. Limpa tudo.
 */
const DOMAIN = '@e2e-2fa-reset.local';

describe('2FA: redefinicao administrativa (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}`;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const reset = (token: string, userId: number) => http().post(`/api/auth/2fa/reset/${userId}`).set(auth(token));

  let orgA: number;
  let orgB: number;
  let superId: number;
  let superToken = '';
  let plainPlatformToken = '';
  const platformIds: number[] = [];
  const u: Record<string, { id: number; email: string; token: string }> = {};

  async function makeMember(key: string, organizationId: number, role: OrgRole): Promise<number> {
    const user = await prisma.user.create({
      data: {
        email: `${key}-${stamp}${DOMAIN}`,
        passwordHash: await bcrypt.hash(DEV_PASSWORD, 4),
        name: `[e2e-2fa-reset] ${key}`,
        userType: 'MEMBER',
        status: 'ACTIVE',
      },
    });
    await prisma.organizationUser.create({ data: { organizationId, userId: user.id, role, status: 'ACTIVE' } });
    const login = await http().post('/api/auth/login').send({ email: user.email, password: DEV_PASSWORD }).expect(200);
    u[key] = { id: user.id, email: user.email, token: login.body.accessToken };
    return user.id;
  }

  /** Liga o 2FA direto no banco (segredo cifrado + codigos de recuperacao), depois de o alvo ja ter feito login. */
  async function enable2fa(userId: number): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: encryptTwoFactorSecret(generateTotpSecret()),
        twoFactorRecoveryHashes: generateRecoveryCodes().map(hashRecoveryCode),
        twoFactorLastStep: 123,
      },
    });
  }

  before(async () => {
    app = await createTestApp();
    const mkOrg = (name: string) =>
      prisma.organization.create({
        data: { name: `E2E 2fa-reset ${name} ${stamp}`, slug: `e2e-2fa-reset-${name}-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
      });
    orgA = (await mkOrg('a')).id;
    orgB = (await mkOrg('b')).id;
    await makeMember('mestre', orgA, OrgRole.MESTRE);
    await makeMember('mestre2', orgA, OrgRole.MESTRE);
    await makeMember('prof', orgA, OrgRole.PROFESSOR);
    await makeMember('aluno', orgA, OrgRole.ALUNO);
    await makeMember('shared', orgA, OrgRole.ALUNO);
    await prisma.organizationUser.create({ data: { organizationId: orgB, userId: u.shared.id, role: OrgRole.ALUNO, status: 'ACTIVE' } });
    await makeMember('outsider', orgB, OrgRole.PROFESSOR);
    const sup = await createPlatformUser(prisma, '2fa-reset-super', { isSuperAdmin: true });
    const plain = await createPlatformUser(prisma, '2fa-reset-plain');
    platformIds.push(sup.id, plain.id);
    superId = sup.id;
    superToken = await platformLogin(app, sup.email);
    plainPlatformToken = await platformLogin(app, plain.email);
    for (const key of ['prof', 'aluno', 'shared', 'outsider', 'mestre2']) await enable2fa(u[key].id);
  });

  after(async () => {
    const ids = (
      await prisma.user.findMany({ where: { OR: [{ email: { endsWith: DOMAIN } }, { id: { in: platformIds } }] }, select: { id: true } })
    ).map((x) => x.id);
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: [orgA, orgB] } }, { userId: { in: ids } }] } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('MESTRE redefine o 2FA de um professor do proprio grupo: zera tudo, revoga as sessoes e audita', async () => {
    const res = await reset(u.mestre.token, u.prof.id).expect(200);
    assert.deepEqual(res.body, { twoFactorEnabled: false });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.prof.id } });
    assert.deepEqual(
      [row.twoFactorEnabled, row.twoFactorSecret, row.twoFactorRecoveryHashes.length, row.twoFactorLastStep],
      [false, null, 0, null],
    );
    await http().get('/api/auth/me').set(auth(u.prof.token)).expect(401); // sessao antiga revogada
    const login = await http().post('/api/auth/login').send({ email: u.prof.email, password: DEV_PASSWORD }).expect(200);
    assert.ok(login.body.accessToken, 'sem 2FA o login volta a ser direto');
    const log = await prisma.auditLog.findFirst({ where: { action: 'TWO_FACTOR_RESET', resourceId: String(u.prof.id) } });
    assert.ok(log);
    assert.equal(log.userId, u.mestre.id);
    assert.equal(log.organizationId, orgA);
  });

  it('MESTRE: erros (si mesmo 400, professor como autor 403, outro grupo 404, outro Mestre 403, conta compartilhada 409, sem 2FA 400)', async () => {
    await reset(u.mestre.token, u.mestre.id).expect(400);
    await reset(u.prof.token, u.aluno.id).expect(401); // token do professor foi revogado acima
    const prof = await http().post('/api/auth/login').send({ email: u.prof.email, password: DEV_PASSWORD }).expect(200);
    await reset(prof.body.accessToken, u.aluno.id).expect(403);
    await reset(u.mestre.token, u.outsider.id).expect(404);
    await reset(u.mestre.token, u.mestre2.id).expect(403);
    await reset(u.mestre.token, u.shared.id).expect(409);
    await reset(u.mestre.token, u.prof.id).expect(400); // ja foi redefinido: nao ha 2FA ativo
    const outsider = await prisma.user.findUniqueOrThrow({ where: { id: u.outsider.id } });
    assert.equal(outsider.twoFactorEnabled, true, 'o 404/403/409 nao alterou ninguem');
  });

  it('super admin ativo redefine qualquer usuario; equipe sem super admin e o proprio super admin sao recusados', async () => {
    await reset(plainPlatformToken, u.outsider.id).expect(403);
    await reset(superToken, superId).expect(400);
    await reset(superToken, 999999999).expect(404);
    await reset(superToken, u.outsider.id).expect(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.outsider.id } });
    assert.equal(row.twoFactorEnabled, false);
    const log = await prisma.auditLog.findFirst({ where: { action: 'TWO_FACTOR_RESET', resourceId: String(u.outsider.id) } });
    assert.ok(log);
    assert.equal(log.userId, superId);
  });
});
