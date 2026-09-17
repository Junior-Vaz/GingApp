import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * CRUD completo de Alunos (Student, src/interface/http/students/). Reaproveita os usuários do
 * seed de dev (prisma/seed.ts) — MESTRE tem canCreate/canEdit/canDelete=true na matriz
 * RolePermission (PLANO_PROJETO.md §10.3), então os testes de mutação usam o token dele.
 * Fixtures criadas aqui são prefixadas com "[e2e-students]" e apagadas no after().
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

describe('Students CRUD (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestreToken: string;
  let alunoToken: string;
  const createdStudentIds: number[] = [];

  before(async () => {
    app = await createTestApp();
    mestreToken = await login(app, MESTRE_EMAIL);
    alunoToken = await login(app, ALUNO_EMAIL);
  });

  after(async () => {
    // Limpa só as fixtures criadas por esta suíte — nunca mexe no Student do seed (Ana).
    if (createdStudentIds.length > 0) {
      await prisma.student.deleteMany({ where: { id: { in: createdStudentIds } } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('POST /students cria um aluno de verdade (confirmado via Prisma)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/students')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: '[e2e-students] Aluno Teste' })
      .expect(201);

    createdStudentIds.push(res.body.id);

    // Segunda via independente: não confia só na resposta HTTP, confirma direto no Postgres.
    const persisted = await prisma.student.findUnique({ where: { id: res.body.id } });
    assert.ok(persisted !== null);
    assert.equal(persisted?.name, '[e2e-students] Aluno Teste');
  });

  it('POST /students com unitId inexistente retorna 400 e nada é gravado', async () => {
    const beforeCount = await prisma.student.count();

    const res = await request(app.getHttpServer())
      .post('/api/students')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: '[e2e-students] Aluno Unidade Inválida', unitId: 999999 })
      .expect(400);

    assert.equal(res.body.message, 'Unidade inválida para esta organização.');

    const afterCount = await prisma.student.count();
    assert.equal(afterCount, beforeCount);
  });

  it('PATCH /students/:id edita um campo, confirmado via Prisma', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/students')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: '[e2e-students] Aluno Para Editar' })
      .expect(201);
    createdStudentIds.push(created.body.id);

    await request(app.getHttpServer())
      .patch(`/api/students/${created.body.id}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: '[e2e-students] Aluno Editado' })
      .expect(200);

    const persisted = await prisma.student.findUniqueOrThrow({ where: { id: created.body.id } });
    assert.equal(persisted.name, '[e2e-students] Aluno Editado');
  });

  it('DELETE /students/:id é soft delete — status vira INACTIVE, registro nunca some', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/students')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: '[e2e-students] Aluno Para Remover' })
      .expect(201);
    createdStudentIds.push(created.body.id);

    await request(app.getHttpServer())
      .delete(`/api/students/${created.body.id}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    const persisted = await prisma.student.findUniqueOrThrow({ where: { id: created.body.id } });
    assert.ok(persisted !== null); // continua existindo — nunca é apagado de verdade
    assert.equal(persisted.status, 'INACTIVE');
  });

  it('GET /students/:id de um aluno inexistente retorna 404', async () => {
    await request(app.getHttpServer())
      .get('/api/students/999999')
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(404);
  });

  it('GET /students/me logado como aluno retorna ao menos o próprio Student do seed', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/students/me')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);

    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.some((s: { name: string }) => s.name === 'Ana Capoeirista'));
  });

  it('PATCH /students/me/profile edita foto/capa/redes sociais do próprio perfil, confirmado via Prisma', async () => {
    const payload = {
      photo: 'https://images.unsplash.com/photo-e2e-profile-1?w=200',
      coverPhoto: 'https://images.unsplash.com/photo-e2e-profile-2?w=800',
      socialLinks: { instagram: 'https://instagram.com/e2e-teste', whatsapp: 'https://wa.me/5511999999999' },
    };

    await request(app.getHttpServer())
      .patch('/api/students/me/profile')
      .set('Authorization', `Bearer ${alunoToken}`)
      .send(payload)
      .expect(200);

    // Segunda via independente: confirma direto no Postgres, não só no corpo da resposta HTTP.
    const persisted = await prisma.student.findFirstOrThrow({ where: { name: 'Ana Capoeirista' } });
    assert.equal(persisted.photo, payload.photo);
    assert.equal(persisted.coverPhoto, payload.coverPhoto);
    assert.deepEqual(persisted.socialLinks, payload.socialLinks);

    // Este é o Student do seed (não uma fixture desta suíte) — restaura o estado original.
    await prisma.student.update({
      where: { id: persisted.id },
      data: { photo: null, coverPhoto: null, socialLinks: Prisma.JsonNull },
    });
  });

  it('PATCH /students/me/profile com URL inválida em socialLinks retorna 400 e nada é gravado', async () => {
    const before = await prisma.student.findFirstOrThrow({ where: { name: 'Ana Capoeirista' } });

    await request(app.getHttpServer())
      .patch('/api/students/me/profile')
      .set('Authorization', `Bearer ${alunoToken}`)
      .send({ socialLinks: { instagram: 'nao-e-uma-url' } })
      .expect(400);

    const after = await prisma.student.findFirstOrThrow({ where: { name: 'Ana Capoeirista' } });
    assert.deepEqual(after.socialLinks, before.socialLinks);
  });

  it('PATCH /students/me/profile logado sem Student próprio (MESTRE) retorna 404', async () => {
    await request(app.getHttpServer())
      .patch('/api/students/me/profile')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ coverPhoto: 'https://images.unsplash.com/photo-e2e-profile-3?w=800' })
      .expect(404);
  });
});
