import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';

/** Fixtures dos e2e de /platform-team. Todos os e-mails terminam em TEAM_DOMAIN e o cleanup
 * remove SÓ o que tem esse sufixo + o prefixo da suíte — nunca toca no owner do seed. */
export const TEAM_PASSWORD = 'Dev@12345';
export const TEAM_DOMAIN = 'e2e-team.local';

export interface TeamFixtureUser {
  id: number;
  email: string;
}

export async function createPlatformUser(
  prisma: PrismaClient,
  tag: string,
  opts: { isSuperAdmin?: boolean; status?: string } = {},
): Promise<TeamFixtureUser> {
  const email = `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@${TEAM_DOMAIN}`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(TEAM_PASSWORD, 4),
      name: `E2E Team ${tag}`,
      userType: 'PLATFORM',
      isSuperAdmin: opts.isSuperAdmin ?? false,
      status: opts.status ?? 'ACTIVE',
    },
  });
  return { id: user.id, email };
}

/** Usuário MEMBER (MESTRE de uma org própria) com isSuperAdmin = true: o PlatformOnlyGuard
 * antigo deixaria passar; /platform-team deve dar 403. */
export async function createMemberSuperAdmin(
  prisma: PrismaClient,
  tag: string,
): Promise<TeamFixtureUser & { organizationId: number; cleanup: () => Promise<void> }> {
  const org = await prisma.organization.create({
    data: {
      name: `E2E Team Org ${tag}`,
      slug: `e2e-team-${tag}-${Date.now()}`,
      type: OrganizationType.GROUP,
      status: RecordStatus.ACTIVE,
    },
  });
  const email = `member-${tag}-${Date.now()}@${TEAM_DOMAIN}`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(TEAM_PASSWORD, 4),
      name: `E2E Team member ${tag}`,
      userType: 'MEMBER',
      isSuperAdmin: true,
      status: 'ACTIVE',
    },
  });
  await prisma.organizationUser.create({
    data: { organizationId: org.id, userId: user.id, role: OrgRole.MESTRE, status: 'ACTIVE' },
  });
  return {
    id: user.id,
    email,
    organizationId: org.id,
    cleanup: async () => {
      await prisma.organizationUser.deleteMany({ where: { organizationId: org.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
      await prisma.organization.deleteMany({ where: { id: org.id } });
    },
  };
}

export async function platformLogin(app: INestApplication, email: string, password = TEAM_PASSWORD): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/auth/platform-login').send({ email, password }).expect(200);
  return res.body.accessToken;
}

export async function memberLogin(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: TEAM_PASSWORD })
    .expect(200);
  return res.body.accessToken;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
