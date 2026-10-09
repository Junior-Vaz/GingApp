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


// ---------------------------------------------------------------------------------------------
// B1 — paginacao + filtros no servidor e limpar campos opcionais no PATCH
// ---------------------------------------------------------------------------------------------
import { createOtherOrg, deleteOtherOrg, list, loginToken } from './utils/page-helpers';

describe('Classes: paginacao, filtros e limpar campos (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestreToken: string;
  let alunoToken: string;
  let orgId: number;
  let otherOrgId: number;
  let unitId: number;
  const tag = `[e2e-b1-classes-${Date.now()}]`;

  before(async () => {
    app = await createTestApp();
    mestreToken = await loginToken(app, MESTRE_EMAIL);
    alunoToken = await loginToken(app, ALUNO_EMAIL);
    orgId = (await prisma.organizationUser.findFirstOrThrow({ where: { user: { email: MESTRE_EMAIL } } })).organizationId;
    unitId = (await prisma.unit.create({ data: { organizationId: orgId, name: `${tag} unit` } })).id;
    otherOrgId = await createOtherOrg(prisma, 'classes');

    await prisma.class.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({ organizationId: orgId, name: `${tag} Turma ${String(i).padStart(2, '0')}` })),
    });
    await prisma.class.createMany({
      data: Array.from({ length: 3 }, (_, i) => ({ organizationId: otherOrgId, name: `${tag} Alheia ${i}` })),
    });
    await prisma.class.create({ data: { organizationId: orgId, name: `${tag} Inativa`, status: 'INACTIVE' } });
    await prisma.class.create({ data: { organizationId: orgId, name: `${tag} NaUnidade`, unitId } });
  });

  after(async () => {
    await prisma.class.deleteMany({ where: { name: { contains: tag } } });
    await prisma.unit.deleteMany({ where: { id: unitId } });
    await deleteOtherOrg(prisma, otherOrgId);
    await prisma.$disconnect();
    await app.close();
  });

  const q = () => `q=${encodeURIComponent(tag)}`;

  it('sem limit devolve 50 itens (array) e X-Total-Count correto; total NAO inclui outra organizacao', async () => {
    const r = await list(app, 'classes', mestreToken, q());
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.equal(r.body.length, 50);
    assert.equal(r.total, 57);
    const semQ = await list(app, 'classes', mestreToken);
    assert.equal(semQ.body.length, 50);
    assert.equal(semQ.total, await prisma.class.count({ where: { organizationId: orgId } }));
  });

  it('limit/offset retornam a fatia certa (igual ao Prisma) com o mesmo total', async () => {
    const expected = await prisma.class.findMany({
      where: { organizationId: orgId, name: { contains: tag } },
      orderBy: { id: 'desc' },
      skip: 50,
      take: 10,
    });
    const r = await list(app, 'classes', mestreToken, `${q()}&limit=10&offset=50`);
    assert.equal(r.total, 57);
    assert.deepEqual(r.body.map((c: { id: number }) => c.id), expected.map((c) => c.id));
    assert.equal(r.body.length, 7);
  });

  it('limit=201, limit=0 e offset=-1 retornam 400', async () => {
    for (const bad of ['limit=201', 'limit=0', 'offset=-1']) {
      assert.equal((await list(app, 'classes', mestreToken, bad)).status, 400, bad);
    }
  });

  it('filtros status e unitId; q busca no nome (case-insensitive)', async () => {
    const st = await list(app, 'classes', mestreToken, `${q()}&status=INACTIVE`);
    assert.equal(st.total, 1);
    assert.equal(st.body[0].name, `${tag} Inativa`);
    const un = await list(app, 'classes', mestreToken, `${q()}&unitId=${unitId}`);
    assert.equal(un.total, 1);
    assert.equal(un.body[0].name, `${tag} NaUnidade`);
    assert.equal((await list(app, 'classes', mestreToken, `q=${encodeURIComponent(tag.toUpperCase())}%20NAUNIDADE`)).total, 1);
    assert.equal((await list(app, 'classes', mestreToken, 'status=XPTO')).status, 400);
  });

  it('PATCH com null LIMPA os campos opcionais (confirmado via Prisma) e null em name/status => 400', async () => {
    const created = await prisma.class.create({
      data: { organizationId: orgId, name: `${tag} Limpar`, unitId, description: 'd', weekday: 3, startTime: '19:00', endTime: '20:00' },
    });
    await request(app.getHttpServer())
      .patch(`/api/classes/${created.id}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ unitId: null, description: null, weekday: null, startTime: null, endTime: null })
      .expect(200);
    const persisted = await prisma.class.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(persisted.unitId, null);
    assert.equal(persisted.description, null);
    assert.equal(persisted.weekday, null);
    assert.equal(persisted.startTime, null);
    assert.equal(persisted.endTime, null);
    assert.equal(persisted.name, `${tag} Limpar`);

    for (const body of [{ name: null }, { status: null }]) {
      await request(app.getHttpServer())
        .patch(`/api/classes/${created.id}`)
        .set('Authorization', `Bearer ${mestreToken}`)
        .send(body)
        .expect(400);
    }
  });

  it('RBAC inalterado: ALUNO lista (200) com cabecalho, nao cria (403); sem token 401', async () => {
    const r = await list(app, 'classes', alunoToken, 'limit=5');
    assert.equal(r.status, 200);
    assert.ok(r.body.length <= 5);
    assert.ok(Number.isFinite(r.total));
    await request(app.getHttpServer())
      .post('/api/classes')
      .set('Authorization', `Bearer ${alunoToken}`)
      .send({ name: `${tag} Proibida` })
      .expect(403);
    await request(app.getHttpServer()).get('/api/classes?limit=5').expect(401);
  });
});
