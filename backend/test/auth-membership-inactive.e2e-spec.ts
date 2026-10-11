import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { MESTRE_EMAIL, loginAs } from './utils/list-helpers';

/**
 * jwt.strategy: token com organizationId cuja membership ficou INACTIVE passa a dar 401 na hora
 * (professor removido por DELETE /teachers/:id perde o acesso sem esperar o token expirar).
 */
/** Senha forte (professor criado via API segue a política de 12+ caracteres). */
const PROF_PASSWORD = 'Prof@Forte2026x';

describe('JWT: membership inativa derruba o token (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestreToken: string;
  const membershipIds: number[] = [];
  const userIds: number[] = [];

  before(async () => {
    app = await createTestApp();
    mestreToken = (await loginAs(app, MESTRE_EMAIL)).token;
  });

  after(async () => {
    await prisma.organizationUser.deleteMany({ where: { id: { in: membershipIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('professor logado acessa (200); após DELETE /teachers/:id o MESMO token => 401', async () => {
    const email = `prof-jwt-${Date.now()}@e2e-jwt.local`;
    const created = await request(app.getHttpServer())
      .post('/api/teachers')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: '[e2e-jwt] Professor', email, password: PROF_PASSWORD, role: OrgRole.PROFESSOR })
      .expect(201);
    membershipIds.push(created.body.id);
    const membership = await prisma.organizationUser.findUniqueOrThrow({ where: { id: created.body.id } });
    userIds.push(membership.userId);

    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PROF_PASSWORD }).expect(200);
    const token: string = login.body.accessToken;
    await request(app.getHttpServer()).get('/api/events').set('Authorization', `Bearer ${token}`).expect(200);

    await request(app.getHttpServer())
      .delete(`/api/teachers/${created.body.id}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);
    const inactive = await prisma.organizationUser.findUniqueOrThrow({ where: { id: created.body.id } });
    assert.equal(inactive.status, 'INACTIVE');

    await request(app.getHttpServer()).get('/api/events').set('Authorization', `Bearer ${token}`).expect(401);
    // controle: o MESTRE (membership ativa) continua com acesso
    await request(app.getHttpServer()).get('/api/events').set('Authorization', `Bearer ${mestreToken}`).expect(200);
  });
});
