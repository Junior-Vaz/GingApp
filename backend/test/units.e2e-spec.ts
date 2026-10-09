import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { list, loginToken } from './utils/page-helpers';
import { createSecondOrg, SecondOrg } from './utils/list-helpers';

/**
 * GET /units com paginacao + busca no servidor (src/interface/http/units/): corpo continua sendo
 * um array, padrao 50, total em X-Total-Count (so da propria organizacao), q no nome.
 * Fixtures prefixadas com a tag e apagadas no after().
 */
const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';

describe('Units: paginacao e busca (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestreToken: string;
  let alunoToken: string;
  let orgId: number;
  let orgB: SecondOrg;
  const tag = `[e2e-units-${Date.now()}]`;

  before(async () => {
    app = await createTestApp();
    mestreToken = await loginToken(app, MESTRE_EMAIL);
    alunoToken = await loginToken(app, ALUNO_EMAIL);
    orgId = (await prisma.organizationUser.findFirstOrThrow({ where: { user: { email: MESTRE_EMAIL } } })).organizationId;
    orgB = await createSecondOrg(app, prisma, 'units');
    await prisma.unit.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({ organizationId: orgId, name: `${tag} Filial ${String(i).padStart(2, '0')}` })),
    });
    await prisma.unit.createMany({
      data: Array.from({ length: 3 }, (_, i) => ({ organizationId: orgB.organizationId, name: `${tag} Alheia ${i}` })),
    });
  });

  after(async () => {
    await prisma.unit.deleteMany({ where: { name: { contains: tag } } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  const q = () => `q=${encodeURIComponent(tag)}`;

  it('sem limit devolve 50 itens (array) e X-Total-Count correto; total NAO inclui outra organizacao', async () => {
    const r = await list(app, 'units', mestreToken, q());
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.equal(r.body.length, 50);
    assert.equal(r.total, 55);
    const semQ = await list(app, 'units', mestreToken);
    assert.equal(semQ.body.length, 50);
    assert.equal(semQ.total, await prisma.unit.count({ where: { organizationId: orgId } }));
  });

  it('limit/offset retornam a fatia certa (igual ao Prisma) com o mesmo total', async () => {
    const expected = await prisma.unit.findMany({
      where: { organizationId: orgId, name: { contains: tag } },
      orderBy: { id: 'desc' },
      skip: 50,
      take: 10,
    });
    const r = await list(app, 'units', mestreToken, `${q()}&limit=10&offset=50`);
    assert.equal(r.total, 55);
    assert.deepEqual(r.body.map((u: { id: number }) => u.id), expected.map((u) => u.id));
    assert.equal(r.body.length, 5);
    const maxPage = await list(app, 'units', mestreToken, `${q()}&limit=200`);
    assert.equal(maxPage.body.length, 55);
  });

  it('limit=201, limit=0, limit=abc e offset=-1 retornam 400', async () => {
    for (const bad of ['limit=201', 'limit=0', 'limit=abc', 'offset=-1']) {
      assert.equal((await list(app, 'units', mestreToken, bad)).status, 400, bad);
    }
  });

  it('q busca no nome (case-insensitive) e sem resultado devolve [] com total 0', async () => {
    const one = await list(app, 'units', mestreToken, `q=${encodeURIComponent(tag.toUpperCase())}%20FILIAL%2007`);
    assert.equal(one.total, 1);
    assert.equal(one.body[0].name, `${tag} Filial 07`);
    const none = await list(app, 'units', mestreToken, `q=${encodeURIComponent(tag + ' inexistente')}`);
    assert.equal(none.status, 200);
    assert.deepEqual(none.body, []);
    assert.equal(none.total, 0);
  });

  it('outra organizacao enxerga so as proprias unidades (login real na org B): total 3, nenhuma da org A', async () => {
    const r = await list(app, 'units', orgB.token, `${q()}&limit=200`);
    assert.equal(r.status, 200);
    assert.equal(r.total, 3);
    assert.equal(r.body.length, 3);
    assert.ok(r.body.every((u: { organizationId: number }) => u.organizationId === orgB.organizationId));
    // e o total da org B sem filtro nao inclui as 55 da org A
    assert.equal((await list(app, 'units', orgB.token)).total, 3);
  });

  it('GET /units/:id devolve a unidade da propria org; de outra org / inexistente 404; id nao numerico 400; sem token 401', async () => {
    const mine = await prisma.unit.findFirstOrThrow({ where: { organizationId: orgId, name: `${tag} Filial 03` } });
    const theirs = await prisma.unit.findFirstOrThrow({ where: { organizationId: orgB.organizationId } });
    const get = (path: string, token?: string) => {
      const r = request(app.getHttpServer()).get(`/api/units/${path}`);
      return token ? r.set('Authorization', `Bearer ${token}`) : r;
    };
    const ok = await get(String(mine.id), mestreToken).expect(200);
    assert.equal(ok.body.id, mine.id);
    assert.equal(ok.body.name, `${tag} Filial 03`);
    await get(String(theirs.id), mestreToken).expect(404); // org A nao enxerga unidade da org B
    await get(String(mine.id), orgB.token).expect(404); // e vice-versa
    await get('999999999', mestreToken).expect(404);
    await get('abc', mestreToken).expect(400);
    await get(String(mine.id)).expect(401);
    assert.equal((await get(String(theirs.id), orgB.token).expect(200)).body.id, theirs.id);
  });

  it('RBAC inalterado: ALUNO continua listando (200) com cabecalho; sem token 401', async () => {
    const r = await list(app, 'units', alunoToken, 'limit=5');
    assert.equal(r.status, 200);
    assert.ok(r.body.length <= 5);
    assert.ok(Number.isFinite(r.total));
    await request(app.getHttpServer()).get('/api/units?limit=5').expect(401);
  });
});
