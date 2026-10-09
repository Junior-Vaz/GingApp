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


// ---------------------------------------------------------------------------------------------
// B1 — paginacao + filtros no servidor e limpar campos opcionais no PATCH
// ---------------------------------------------------------------------------------------------
import { createOtherOrg, deleteOtherOrg, list, loginToken } from './utils/page-helpers';

describe('Students: paginacao, filtros e limpar campos (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestreToken: string;
  let alunoToken: string;
  let orgId: number;
  let otherOrgId: number;
  let unitId: number;
  const tag = `[e2e-b1-students-${Date.now()}]`;

  before(async () => {
    app = await createTestApp();
    mestreToken = await loginToken(app, MESTRE_EMAIL);
    alunoToken = await loginToken(app, ALUNO_EMAIL);
    orgId = (await prisma.organizationUser.findFirstOrThrow({ where: { user: { email: MESTRE_EMAIL } } })).organizationId;
    unitId = (await prisma.unit.create({ data: { organizationId: orgId, name: `${tag} unit` } })).id;
    otherOrgId = await createOtherOrg(prisma, 'students');

    // 55 alunos da org A (mais que o padrao de 50) + 3 da org B com o MESMO marcador no nome.
    await prisma.student.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({ organizationId: orgId, name: `${tag} Aluno ${String(i).padStart(2, '0')}` })),
    });
    await prisma.student.createMany({
      data: Array.from({ length: 3 }, (_, i) => ({ organizationId: otherOrgId, name: `${tag} Alheio ${i}` })),
    });
    // Casos especificos para os filtros (ids mais altos => primeiros na ordenacao desc).
    await prisma.student.create({ data: { organizationId: orgId, name: `${tag} Susp`, status: 'SUSPENDED', unitId } });
    await prisma.student.create({ data: { organizationId: orgId, name: `${tag} Zeca`, email: `ZECA-${Date.now()}@b1.local`, document: 'DOC-B1-777', phone: '+55-B1-999' } });
  });

  after(async () => {
    await prisma.student.deleteMany({ where: { name: { contains: tag } } });
    await prisma.unit.deleteMany({ where: { id: unitId } });
    await deleteOtherOrg(prisma, otherOrgId);
    await prisma.$disconnect();
    await app.close();
  });

  const q = () => `q=${encodeURIComponent(tag)}`;

  it('sem limit devolve 50 itens (array) e X-Total-Count com o total real; o total NAO inclui a outra organizacao', async () => {
    const r = await list(app, 'students', mestreToken, q());
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.equal(r.body.length, 50);
    assert.equal(r.total, 57); // 55 + Susp + Zeca da org A; os 3 da org B nao entram
    const semQ = await list(app, 'students', mestreToken);
    assert.equal(semQ.body.length, 50);
    assert.equal(semQ.total, await prisma.student.count({ where: { organizationId: orgId } }));
  });

  it('limit/offset retornam a fatia certa (igual ao Prisma) com o mesmo total', async () => {
    const expected = await prisma.student.findMany({
      where: { organizationId: orgId, name: { contains: tag } },
      orderBy: { id: 'desc' },
      skip: 50,
      take: 10,
    });
    const r = await list(app, 'students', mestreToken, `${q()}&limit=10&offset=50`);
    assert.equal(r.status, 200);
    assert.equal(r.total, 57);
    assert.deepEqual(r.body.map((s: { id: number }) => s.id), expected.map((s) => s.id));
    assert.equal(r.body.length, 7);
    const grande = await list(app, 'students', mestreToken, `${q()}&limit=200`);
    assert.equal(grande.body.length, 57);
  });

  it('limit=201, limit=0 e offset=-1 retornam 400', async () => {
    for (const bad of ['limit=201', 'limit=0', 'offset=-1', 'limit=abc']) {
      const r = await list(app, 'students', mestreToken, bad);
      assert.equal(r.status, 400, bad);
    }
  });

  it('parametro desconhecido continua sendo rejeitado (forbidNonWhitelisted)', async () => {
    assert.equal((await list(app, 'students', mestreToken, 'naoExiste=1')).status, 400);
  });

  it('filtros status e unitId (e status invalido => 400)', async () => {
    const st = await list(app, 'students', mestreToken, `${q()}&status=SUSPENDED`);
    assert.equal(st.total, 1);
    assert.equal(st.body[0].name, `${tag} Susp`);
    const un = await list(app, 'students', mestreToken, `${q()}&unitId=${unitId}`);
    assert.equal(un.total, 1);
    assert.equal(un.body[0].name, `${tag} Susp`);
    assert.equal((await list(app, 'students', mestreToken, 'status=XPTO')).status, 400);
  });

  it('q busca (case-insensitive) em nome, e-mail, documento e telefone', async () => {
    assert.equal((await list(app, 'students', mestreToken, `q=${encodeURIComponent(tag.toLowerCase())}%20zeca`)).total, 1);
    assert.equal((await list(app, 'students', mestreToken, 'q=zeca-')).total, 1); // e-mail (gravado em maiusculas)
    assert.equal((await list(app, 'students', mestreToken, 'q=doc-b1-777')).total, 1);
    assert.equal((await list(app, 'students', mestreToken, `q=${encodeURIComponent('+55-b1-999')}`)).total, 1);
    assert.equal((await list(app, 'students', mestreToken, `q=${'x'.repeat(101)}`)).status, 400);
  });

  it('PATCH com null LIMPA os campos opcionais (confirmado via Prisma) e null em name/status => 400', async () => {
    const created = await prisma.student.create({
      data: {
        organizationId: orgId, name: `${tag} Limpar`, unitId, birthDate: new Date('2000-01-01'),
        document: 'D1', phone: '11', email: 'limpar@b1.local', photo: 'http://x/p.png', joinedAt: new Date('2020-01-01'),
      },
    });
    const r = await request(app.getHttpServer())
      .patch(`/api/students/${created.id}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ unitId: null, birthDate: null, document: null, phone: null, email: null, photo: null, joinedAt: null })
      .expect(200);
    assert.equal(r.body.phone, null);
    const persisted = await prisma.student.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(persisted.unitId, null);
    assert.equal(persisted.birthDate, null);
    assert.equal(persisted.document, null);
    assert.equal(persisted.phone, null);
    assert.equal(persisted.email, null);
    assert.equal(persisted.photo, null);
    assert.equal(persisted.joinedAt, null);
    assert.equal(persisted.name, `${tag} Limpar`); // intocado

    for (const body of [{ name: null }, { status: null }]) {
      await request(app.getHttpServer())
        .patch(`/api/students/${created.id}`)
        .set('Authorization', `Bearer ${mestreToken}`)
        .send(body)
        .expect(400);
    }
    const still = await prisma.student.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(still.name, `${tag} Limpar`);
  });

  it('RBAC inalterado: sem token 401; ALUNO nao edita aluno (403) e a listagem do ALUNO segue o mesmo status com ou sem query', async () => {
    await request(app.getHttpServer()).get('/api/students?limit=5').expect(401);
    const alvo = await prisma.student.findFirstOrThrow({ where: { name: { contains: tag } } });
    await request(app.getHttpServer())
      .patch(`/api/students/${alvo.id}`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .send({ phone: null })
      .expect(403);
    const a = await list(app, 'students', alunoToken);
    const b = await list(app, 'students', alunoToken, 'limit=5');
    assert.equal(a.status, b.status);
  });
});
