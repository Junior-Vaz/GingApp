import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * "Professor" não é uma tabela própria (PLANO_PROJETO.md §2.2 / teachers.service.ts): é o
 * papel MESTRE ou PROFESSOR de um OrganizationUser. `id` nas rotas é o id do
 * OrganizationUser (a membership), não do User. POST /teachers cria User + OrganizationUser
 * juntos numa transação; DELETE só inativa a membership (o User nunca é apagado).
 *
 * Fixtures desta suíte usam e-mails em "@e2e-teachers-test.local" e são removidas no after()
 * (membership antes do user, por causa da FK).
 */
const DEV_PASSWORD = 'Dev@12345';
const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';

async function login(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: DEV_PASSWORD })
    .expect(200);
  return res.body.accessToken;
}

describe('Teachers CRUD (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestreToken: string;
  let alunoToken: string;
  const createdMembershipIds: number[] = [];
  const createdUserIds: number[] = [];

  before(async () => {
    app = await createTestApp();
    mestreToken = await login(app, MESTRE_EMAIL);
    alunoToken = await login(app, ALUNO_EMAIL);
  });

  after(async () => {
    // Ordem importa: apaga a membership (FK para o User) antes do User.
    if (createdMembershipIds.length > 0) {
      await prisma.organizationUser.deleteMany({ where: { id: { in: createdMembershipIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('POST /teachers cria User + OrganizationUser juntos, com o role certo (confirmado via Prisma)', async () => {
    const email = `professor-novo-${Date.now()}@e2e-teachers-test.local`;

    const res = await request(app.getHttpServer())
      .post('/api/teachers')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: '[e2e-teachers] Professor Novo', email, password: 'Dev@12345', role: OrgRole.PROFESSOR })
      .expect(201);

    createdMembershipIds.push(res.body.id);

    // Segunda via independente: confirma direto no Postgres que os DOIS registros existem.
    const membership = await prisma.organizationUser.findUnique({
      where: { id: res.body.id },
      include: { user: true },
    });
    assert.ok(membership !== null);
    assert.equal(membership?.role, OrgRole.PROFESSOR);
    assert.equal(membership?.status, 'ACTIVE');
    assert.equal(membership?.user.email, email);
    assert.equal(membership?.user.name, '[e2e-teachers] Professor Novo');

    createdUserIds.push(membership!.user.id);
  });

  it('POST /teachers com e-mail já cadastrado retorna 400 e nada novo é criado', async () => {
    const usersBefore = await prisma.user.count();
    const membershipsBefore = await prisma.organizationUser.count();

    const res = await request(app.getHttpServer())
      .post('/api/teachers')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({
        name: '[e2e-teachers] Duplicado',
        email: ALUNO_EMAIL, // já existe no seed (com outro role/uso)
        password: 'Dev@12345',
        role: OrgRole.PROFESSOR,
      })
      .expect(400);

    assert.equal(res.body.message, 'E-mail já cadastrado.');

    assert.equal(await prisma.user.count(), usersBefore);
    assert.equal(await prisma.organizationUser.count(), membershipsBefore);
  });

  it('PATCH /teachers/:id atualiza o papel (PROFESSOR → MESTRE), confirmado via Prisma', async () => {
    const email = `professor-para-editar-${Date.now()}@e2e-teachers-test.local`;
    const created = await request(app.getHttpServer())
      .post('/api/teachers')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: '[e2e-teachers] Para Editar', email, password: 'Dev@12345', role: OrgRole.PROFESSOR })
      .expect(201);
    createdMembershipIds.push(created.body.id);
    createdUserIds.push(created.body.user.id);

    await request(app.getHttpServer())
      .patch(`/api/teachers/${created.body.id}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ role: OrgRole.MESTRE })
      .expect(200);

    const persisted = await prisma.organizationUser.findUniqueOrThrow({ where: { id: created.body.id } });
    assert.equal(persisted.role, OrgRole.MESTRE);
  });

  it('DELETE /teachers/:id é soft delete — membership vira INACTIVE, o User continua existindo', async () => {
    const email = `professor-para-remover-${Date.now()}@e2e-teachers-test.local`;
    const created = await request(app.getHttpServer())
      .post('/api/teachers')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: '[e2e-teachers] Para Remover', email, password: 'Dev@12345', role: OrgRole.PROFESSOR })
      .expect(201);
    createdMembershipIds.push(created.body.id);
    const userId = created.body.user.id;
    createdUserIds.push(userId);

    await request(app.getHttpServer())
      .delete(`/api/teachers/${created.body.id}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    const membership = await prisma.organizationUser.findUniqueOrThrow({ where: { id: created.body.id } });
    assert.equal(membership.status, 'INACTIVE');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    assert.ok(user !== null); // o User nunca é apagado, só a membership é inativada
  });

  it('ALUNO tentando POST /teachers recebe 403 (RBAC) e nada é gravado', async () => {
    const usersBefore = await prisma.user.count();
    const membershipsBefore = await prisma.organizationUser.count();

    await request(app.getHttpServer())
      .post('/api/teachers')
      .set('Authorization', `Bearer ${alunoToken}`)
      .send({
        name: '[e2e-teachers] Não Deveria Existir',
        email: `nao-deveria-existir-${Date.now()}@e2e-teachers-test.local`,
        password: 'Dev@12345',
        role: OrgRole.PROFESSOR,
      })
      .expect(403);

    assert.equal(await prisma.user.count(), usersBefore);
    assert.equal(await prisma.organizationUser.count(), membershipsBefore);
  });
});
