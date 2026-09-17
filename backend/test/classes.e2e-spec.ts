import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * CRUD completo de Turmas (Class, src/interface/http/classes/) — mesmo padrão de
 * students.e2e-spec.ts. Fixtures criadas aqui são prefixadas com "[e2e-classes]" e apagadas
 * no after(). "Adulto — Quinta 19h" é a turma do seed em que Ana (aluno@) já está matriculada
 * via ClassStudent — usada para o teste de GET /classes/me.
 */
const DEV_PASSWORD = 'Dev@12345';
const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';
const SEED_CLASS_NAME = 'Adulto — Quinta 19h';

async function login(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: DEV_PASSWORD })
    .expect(200);
  return res.body.accessToken;
}

describe('Classes CRUD (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestreToken: string;
  let alunoToken: string;
  const createdClassIds: number[] = [];

  before(async () => {
    app = await createTestApp();
    mestreToken = await login(app, MESTRE_EMAIL);
    alunoToken = await login(app, ALUNO_EMAIL);
  });

  after(async () => {
    // Limpa só as fixtures criadas por esta suíte — nunca mexe na turma do seed.
    if (createdClassIds.length > 0) {
      await prisma.class.deleteMany({ where: { id: { in: createdClassIds } } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('POST /classes cria uma turma de verdade (confirmado via Prisma)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/classes')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: '[e2e-classes] Turma Teste' })
      .expect(201);

    createdClassIds.push(res.body.id);

    const persisted = await prisma.class.findUnique({ where: { id: res.body.id } });
    assert.ok(persisted !== null);
    assert.equal(persisted?.name, '[e2e-classes] Turma Teste');
  });

  it('POST /classes com unitId inexistente retorna 400 e nada é gravado', async () => {
    const beforeCount = await prisma.class.count();

    const res = await request(app.getHttpServer())
      .post('/api/classes')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: '[e2e-classes] Turma Unidade Inválida', unitId: 999999 })
      .expect(400);

    assert.equal(res.body.message, 'Unidade inválida para esta organização.');

    const afterCount = await prisma.class.count();
    assert.equal(afterCount, beforeCount);
  });

  it('PATCH /classes/:id edita um campo, confirmado via Prisma', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/classes')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: '[e2e-classes] Turma Para Editar' })
      .expect(201);
    createdClassIds.push(created.body.id);

    await request(app.getHttpServer())
      .patch(`/api/classes/${created.body.id}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: '[e2e-classes] Turma Editada' })
      .expect(200);

    const persisted = await prisma.class.findUniqueOrThrow({ where: { id: created.body.id } });
    assert.equal(persisted.name, '[e2e-classes] Turma Editada');
  });

  it('DELETE /classes/:id é soft delete — status vira INACTIVE, registro nunca some', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/classes')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: '[e2e-classes] Turma Para Remover' })
      .expect(201);
    createdClassIds.push(created.body.id);

    await request(app.getHttpServer())
      .delete(`/api/classes/${created.body.id}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    const persisted = await prisma.class.findUniqueOrThrow({ where: { id: created.body.id } });
    assert.ok(persisted !== null); // continua existindo — nunca é apagado de verdade
    assert.equal(persisted.status, 'INACTIVE');
  });

  it('GET /classes/:id de uma turma inexistente retorna 404', async () => {
    await request(app.getHttpServer())
      .get('/api/classes/999999')
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(404);
  });

  it('GET /classes/me logado como aluno inclui a turma do seed em que ele está matriculado', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/classes/me')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);

    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.some((c: { name: string }) => c.name === SEED_CLASS_NAME));
  });
});
