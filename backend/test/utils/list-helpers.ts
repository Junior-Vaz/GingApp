import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';

/** Helpers dos e2e de listagem paginada / limpar campos (módulos finance, events, rodas,
 * announcements, certificates). */
export const DEV_PASSWORD = 'Dev@12345';
export const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';
export const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';

export async function loginAs(
  app: INestApplication,
  email: string,
): Promise<{ token: string; userId: number; organizationId: number }> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: DEV_PASSWORD })
    .expect(200);
  return { token: res.body.accessToken, userId: res.body.user.id, organizationId: res.body.user.organizationId };
}

export interface SecondOrg {
  organizationId: number;
  userId: number;
  token: string;
  cleanup: () => Promise<void>;
}

/** Cria uma SEGUNDA organização (com MESTRE e login) só para a suíte e prova de isolamento
 * multi-tenant. `cleanup` apaga o que depender dela — chame depois de apagar os registros dela. */
export async function createSecondOrg(
  app: INestApplication,
  prisma: PrismaClient,
  tag: string,
): Promise<SecondOrg> {
  const org = await prisma.organization.create({
    data: {
      name: `E2E ${tag} Org B`,
      slug: `e2e-${tag}-org-b-${Date.now()}`,
      type: OrganizationType.GROUP,
      status: RecordStatus.ACTIVE,
    },
  });
  const email = `mestre-${tag}-${Date.now()}@e2e-list.local`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(DEV_PASSWORD, 4),
      name: `Mestre E2E ${tag}`,
      userType: 'MEMBER',
      status: 'ACTIVE',
    },
  });
  await prisma.organizationUser.create({
    data: { organizationId: org.id, userId: user.id, role: OrgRole.MESTRE, status: 'ACTIVE' },
  });
  const { token } = await loginAs(app, email);
  return {
    organizationId: org.id,
    userId: user.id,
    token,
    cleanup: async () => {
      await prisma.organizationUser.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.delete({ where: { id: org.id } });
      await prisma.user.delete({ where: { id: user.id } });
    },
  };
}

/** Data civil (yyyy-MM-dd) de hoje em America/Sao_Paulo — calculada de forma independente da do
 * service (toLocaleDateString), para o teste não validar o código com ele mesmo. */
export function todaySaoPaulo(offsetDays = 0): string {
  const base = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T12:00:00Z');
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}
