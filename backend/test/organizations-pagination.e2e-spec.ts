import { INestApplication } from '@nestjs/common';
import { OrganizationType, PrismaClient, RecordStatus } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { DEV_PASSWORD, MESTRE_EMAIL, loginAs } from './utils/list-helpers';
import { list } from './utils/page-helpers';

/** GET /organizations (plataforma): ?limit&offset&q, header X-Total-Count, corpo continua array. */
describe('Organizations: listagem paginada da plataforma (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let platformToken: string;
  let mestreToken: string;
  let mestreOrgId: number;
  const tag = `e2e-orgpage-${Date.now()}`;

  before(async () => {
    app = await createTestApp();
    const res = await request(app.getHttpServer())
      .post('/api/auth/platform-login')
      .send({ email: 'owner@gingapp.com.br', password: DEV_PASSWORD })
      .expect(200);
    platformToken = res.body.accessToken;
    const mestre = await loginAs(app, MESTRE_EMAIL);
    mestreToken = mestre.token;
    mestreOrgId = mestre.organizationId;
    await prisma.organization.createMany({
      data: Array.from({ length: 7 }, (_, i) => ({
        name: `${tag} Grupo ${i}`,
        slug: `${tag}-${i}`,
        type: OrganizationType.GROUP,
        status: RecordStatus.ACTIVE,
      })),
    });
  });

  after(async () => {
    await prisma.organization.deleteMany({ where: { slug: { startsWith: tag } } });
    await prisma.$disconnect();
    await app.close();
  });

  const q = `q=${encodeURIComponent(tag.toUpperCase())}`; // case-insensitive

  it('q filtra, total = 7 no header, corpo é array', async () => {
    const r = await list(app, 'organizations', platformToken, q);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.equal(r.total, 7);
    assert.equal(r.body.length, 7);
  });

  it('limit/offset retornam a fatia certa (id desc, igual ao Prisma) com o mesmo total', async () => {
    const expected = await prisma.organization.findMany({
      where: { name: { contains: tag } },
      orderBy: { id: 'desc' },
      skip: 5,
      take: 3,
    });
    const r = await list(app, 'organizations', platformToken, `${q}&limit=3&offset=5`);
    assert.equal(r.total, 7);
    assert.deepEqual(r.body.map((o: { id: number }) => o.id), expected.map((o) => o.id));
    assert.equal(r.body.length, 2);
  });

  it('sem limit: no máximo 50 itens e total = contagem real do banco', async () => {
    const r = await list(app, 'organizations', platformToken);
    assert.ok(r.body.length <= 50);
    assert.equal(r.total, await prisma.organization.count());
  });

  it('limit=201, limit=0 e offset=-1 => 400', async () => {
    for (const bad of ['limit=201', 'limit=0', 'offset=-1']) {
      assert.equal((await list(app, 'organizations', platformToken, bad)).status, 400, bad);
    }
  });

  it('MESTRE (não plataforma) continua vendo só a própria organização', async () => {
    const r = await list(app, 'organizations', mestreToken);
    assert.equal(r.status, 200);
    const ids = (Array.isArray(r.body) ? r.body : [r.body]).map((o: { id: number }) => o.id);
    assert.deepEqual(ids, [mestreOrgId]);
  });
});
