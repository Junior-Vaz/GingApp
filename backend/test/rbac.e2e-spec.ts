import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * Confirma que o CanAccessGuard realmente aplica a matriz RolePermission (seed de dev,
 * PLANO_PROJETO.md §10.3): MESTRE tem acesso total aos recursos de gestão do grupo, ALUNO
 * só tem `view`. Reaproveita os usuários do seed em vez de criar fixtures próprias.
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

describe('RBAC — matriz RolePermission (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestreToken: string;
  let alunoToken: string;
  let professorToken: string;
  const createdClassIds: number[] = [];

  before(async () => {
    app = await createTestApp();
    mestreToken = await login(app, MESTRE_EMAIL);
    alunoToken = await login(app, ALUNO_EMAIL);
    professorToken = await login(app, 'professor@gingabrasil.com.br');
  });

  after(async () => {
    // Limpa só as turmas que este spec criou (o teste de "MESTRE pode criar" precisa
    // efetivamente criar uma linha real para provar o caminho de permissão).
    if (createdClassIds.length > 0) {
      await prisma.class.deleteMany({ where: { id: { in: createdClassIds } } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('ALUNO não pode criar turma (canCreate=false na matriz) — 403, e nada é gravado', async () => {
    const beforeCount = await prisma.class.count();

    await request(app.getHttpServer())
      .post('/api/classes')
      .set('Authorization', `Bearer ${alunoToken}`)
      .send({ name: 'Turma que o aluno não deveria conseguir criar' })
      .expect(403);

    const afterCount = await prisma.class.count();
    assert.equal(afterCount, beforeCount);
  });

  it('MESTRE pode criar turma (canCreate=true na matriz) — 201, e a linha existe de verdade no banco', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/classes')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: 'Turma criada pelo teste RBAC e2e' })
      .expect(201);

    createdClassIds.push(res.body.id);

    // Segunda via independente: não confia só na resposta HTTP, confirma direto no Postgres.
    const persisted = await prisma.class.findUnique({ where: { id: res.body.id } });
    assert.ok(persisted !== null);
    assert.equal(persisted?.name, 'Turma criada pelo teste RBAC e2e');
  });

  it('ALUNO não pode ver a lista de professores (canView=false na matriz) — 403', async () => {
    await request(app.getHttpServer())
      .get('/api/teachers')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(403);
  });

  it('MESTRE pode ver a lista de professores (canView=true na matriz) — 200', async () => {
    await request(app.getHttpServer())
      .get('/api/teachers')
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);
  });

  it('ALUNO NÃO lista turmas/alunos/aulas/presenças/graduações do grupo (menor privilégio, LGPD) — 403', async () => {
    for (const path of ['/api/classes', '/api/students', '/api/lessons', '/api/attendance', '/api/graduations']) {
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${alunoToken}`)
        .expect(403);
    }
  });

  it('mas ALUNO continua vendo a agenda de eventos e os comunicados do grupo (view=true) — 200', async () => {
    for (const path of ['/api/events', '/api/announcements']) {
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${alunoToken}`)
        .expect(200);
    }
  });

  it('ALUNO não pode ver registros financeiros da organização (restrição de privacidade, §10.7) — 403', async () => {
    await request(app.getHttpServer())
      .get('/api/finance')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(403);
  });

  it('PROFESSOR não pode ver registros financeiros (financeiro é só do MESTRE) — 403; MESTRE — 200', async () => {
    await request(app.getHttpServer())
      .get('/api/finance')
      .set('Authorization', `Bearer ${professorToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/finance')
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);
  });

  it('PROFESSOR continua acessando classes e dashboard (só o finance foi restringido) — 200', async () => {
    await request(app.getHttpServer())
      .get('/api/classes')
      .set('Authorization', `Bearer ${professorToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${professorToken}`)
      .expect(200);
  });

  it('mas ALUNO pode ver o PRÓPRIO financeiro escopado via /finance/me — 200', async () => {
    await request(app.getHttpServer())
      .get('/api/finance/me')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);
  });
});
