import { INestApplication } from '@nestjs/common';
import { OrganizationType, PrismaClient, RecordStatus } from '@prisma/client';
import request from 'supertest';

export const DEV_PASSWORD = 'Dev@12345';

export async function loginToken(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: DEV_PASSWORD })
    .expect(200);
  return res.body.accessToken;
}

/** Organizacao "outro grupo" so para provar que X-Total-Count nunca conta registros alheios. */
export async function createOtherOrg(prisma: PrismaClient, tag: string): Promise<number> {
  const org = await prisma.organization.create({
    data: {
      name: `E2E Pagination Org (${tag})`,
      slug: `e2e-pagination-${tag}-${Date.now()}`,
      type: OrganizationType.GROUP,
      status: RecordStatus.ACTIVE,
    },
  });
  return org.id;
}

/** Remove a org criada acima (os filhos precisam ter sido apagados antes). */
export async function deleteOtherOrg(prisma: PrismaClient, orgId: number): Promise<void> {
  await prisma.organization.deleteMany({ where: { id: orgId } });
}

/** Lista com ?query e devolve { status, body, total } (total lido do header X-Total-Count). */
export async function list(app: INestApplication, path: string, token: string, query = '') {
  const res = await request(app.getHttpServer())
    .get(`/api/${path}${query ? `?${query}` : ''}`)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body, total: Number(res.headers['x-total-count']) };
}