import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { ALUNO_EMAIL as ALUNO, MESTRE_EMAIL as MESTRE, SecondOrg, createSecondOrg, loginAs } from './utils/list-helpers';

/**
 * Rodas (src/interface/http/rodas/rodas.service.ts e rodas.controller.ts) — domínio público
 * ("Comunidade"): findAll/findOne/listParticipants não exigem token e não filtram por
 * organização (nenhum dado privado do grupo é exposto). `organizationId` foi adicionado ao
 * model em Fase 10.7 (PLANO_PROJETO.md §10.7, gap do schema original) só para restringir quem
 * pode editar/excluir uma roda — nunca para filtrar a listagem pública.
 *
 * Reaproveita mestre/aluno/responsavel do seed. Cria uma segunda organização isolada (mesmo
 * padrão de multi-tenant-isolation.e2e-spec.ts) só para provar que um MESTRE de outra
 * organização não consegue editar a roda.
 */
const DEV_PASSWORD = 'Dev@12345';
const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';
const RESPONSAVEL_EMAIL = 'responsavel@gingabrasil.com.br';
const ORG_B_MESTRE_EMAIL = 'mestre-b@e2e-rodas-test.local';

interface LoginResult {
  accessToken: string;
  user: { id: number; organizationId: number };
}

async function login(app: INestApplication, email: string): Promise<LoginResult> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: DEV_PASSWORD })
    .expect(200);
  return res.body as LoginResult;
}

describe('Rodas e participantes (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let mestreToken: string;
  let organizationId: number;
  let alunoToken: string;
  let alunoUserId: number;
  let responsavelToken: string;

  // --- Organização B, isolada, criada só para o teste de "outra organização não edita" ---
  let orgBId: number;
  let orgBUserId: number;
  let orgBToken: string;

  let rodaId: number;
  let alunoParticipantId: number;

  const RODA_TITLE = `[e2e-test] Roda participantes ${Date.now()}`;

  before(async () => {
    app = await createTestApp();

    const mestreLogin = await login(app, MESTRE_EMAIL);
    mestreToken = mestreLogin.accessToken;
    organizationId = mestreLogin.user.organizationId;

    const alunoLogin = await login(app, ALUNO_EMAIL);
    alunoToken = alunoLogin.accessToken;
    alunoUserId = alunoLogin.user.id;

    const responsavelLogin = await login(app, RESPONSAVEL_EMAIL);
    responsavelToken = responsavelLogin.accessToken;

    // --- Organização B isolada, só para este teste ---
    const orgB = await prisma.organization.create({
      data: {
        name: 'E2E Rodas Org B',
        slug: `e2e-rodas-org-b-${Date.now()}`,
        type: OrganizationType.GROUP,
        status: RecordStatus.ACTIVE,
      },
    });
    orgBId = orgB.id;

    const passwordHash = await bcrypt.hash(DEV_PASSWORD, 4); // custo baixo só para acelerar o teste
    const userB = await prisma.user.create({
      data: {
        email: ORG_B_MESTRE_EMAIL,
        passwordHash,
        name: 'Mestre E2E Org B (Rodas)',
        userType: 'MEMBER',
        status: 'ACTIVE',
      },
    });
    orgBUserId = userB.id;

    await prisma.organizationUser.create({
      data: { organizationId: orgB.id, userId: userB.id, role: OrgRole.MESTRE, status: 'ACTIVE' },
    });

    const loginB = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ORG_B_MESTRE_EMAIL, password: DEV_PASSWORD })
      .expect(200);
    orgBToken = loginB.body.accessToken;
  });

  after(async () => {
    // Rede de segurança: o fluxo normal do teste já remove a roda (com seus participantes,
    // em transação), mas cobre a hipótese de falha no meio do caminho.
    await prisma.rodaParticipant.deleteMany({ where: { roda: { title: RODA_TITLE } } });
    await prisma.roda.deleteMany({ where: { title: RODA_TITLE } });

    // Organização B isolada, criada só para este teste.
    await prisma.organizationUser.deleteMany({ where: { organizationId: orgBId } });
    await prisma.organization.delete({ where: { id: orgBId } });
    await prisma.user.delete({ where: { id: orgBUserId } });

    await prisma.$disconnect();
    await app.close();
  });

  it('GET /rodas sem token → 200 (rota pública)', async () => {
    await request(app.getHttpServer()).get('/api/rodas').expect(200);
  });

  it('POST /rodas (mestre) cria uma roda — organizationId setado para a organização do mestre, confirmado via Prisma', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/rodas')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({
        title: RODA_TITLE,
        date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        location: 'Praça Central',
      })
      .expect(201);

    rodaId = res.body.id;
    assert.equal(typeof rodaId, 'number');

    const persisted = await prisma.roda.findUnique({ where: { id: rodaId } });
    assert.ok(persisted !== null);
    assert.equal(persisted?.organizationId, organizationId);
  });

  it('PATCH /rodas/:id logado como MESTRE de OUTRA organização → 404 "Roda não encontrada ou não organizada por esta organização."', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/rodas/${rodaId}`)
      .set('Authorization', `Bearer ${orgBToken}`)
      .send({ title: 'Tentativa de edição por outra organização' })
      .expect(404);

    assert.equal(res.body.message, 'Roda não encontrada ou não organizada por esta organização.');

    const stillIntact = await prisma.roda.findUnique({ where: { id: rodaId } });
    assert.equal(stillIntact?.title, RODA_TITLE);
  });

  it('POST /rodas/:id/participants (sem body) como ALUNO → 201, autoregistro com o próprio userId, confirmado via Prisma', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/rodas/${rodaId}/participants`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(201);

    alunoParticipantId = res.body.id;
    assert.equal(res.body.userId, alunoUserId);

    const persisted = await prisma.rodaParticipant.findUnique({ where: { id: alunoParticipantId } });
    assert.ok(persisted !== null);
    assert.equal(persisted?.userId, alunoUserId);
    assert.equal(persisted?.rodaId, rodaId);
  });

  it('POST /rodas/:id/participants de novo com o MESMO usuário → ainda 201, mas idempotente (só uma linha no banco)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/rodas/${rodaId}/participants`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(201);

    // Idempotente: devolve a MESMA participação já existente, não cria uma segunda.
    assert.equal(res.body.id, alunoParticipantId);

    const rows = await prisma.rodaParticipant.findMany({ where: { rodaId, userId: alunoUserId } });
    assert.equal(rows.length, 1);
  });

  it('DELETE .../participants/:id logado como usuário que NÃO é o dono nem MESTRE/PROFESSOR da organização → 403', async () => {
    // Carla (RESPONSAVEL) é da mesma organização do mestre que criou a roda, mas seu papel não
    // está em ADMIN_ROLES (MESTRE/PROFESSOR) e ela não é dona desta inscrição (é da Ana... na
    // verdade da própria aluna, não da Carla) — cai no 403 do RodasService.leave.
    const res = await request(app.getHttpServer())
      .delete(`/api/rodas/${rodaId}/participants/${alunoParticipantId}`)
      .set('Authorization', `Bearer ${responsavelToken}`)
      .expect(403);

    assert.equal(res.body.message, 'Você só pode cancelar a própria participação.');

    const stillThere = await prisma.rodaParticipant.findUnique({ where: { id: alunoParticipantId } });
    assert.ok(stillThere !== null);
  });

  it('DELETE .../participants/:id logado como o PRÓPRIO dono → 200', async () => {
    await request(app.getHttpServer())
      .delete(`/api/rodas/${rodaId}/participants/${alunoParticipantId}`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);

    const gone = await prisma.rodaParticipant.findUnique({ where: { id: alunoParticipantId } });
    assert.equal(gone, null);
  });
});

/** Paginação + filtros (lista PÚBLICA), limpar campos no PATCH. */
describe('Rodas — lista paginada e limpar campos (e2e)', () => {
  const TAG = `B2RODA${Date.now()}`;
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestre: Awaited<ReturnType<typeof loginAs>>;
  let aluno: Awaited<ReturnType<typeof loginAs>>;
  let orgB: SecondOrg;
  const stateIds: number[] = [];
  const cityIds: number[] = [];
  const get = (path: string) => request(app.getHttpServer()).get(`/api${path}`); // pública: sem token
  const patch = (id: number, body: object) =>
    request(app.getHttpServer()).patch(`/api/rodas/${id}`).set('Authorization', `Bearer ${mestre.token}`).send(body);

  before(async () => {
    app = await createTestApp();
    mestre = await loginAs(app, MESTRE);
    aluno = await loginAs(app, ALUNO);
    orgB = await createSecondOrg(app, prisma, 'roda');
    for (let k = 0; k < 2; k++) {
      const st = await prisma.state.create({ data: { name: `${TAG} UF${k}`, uf: `R${k}${String(Date.now()).slice(-5)}` } });
      stateIds.push(st.id);
      cityIds.push((await prisma.city.create({ data: { name: `${TAG} Cidade${k}`, stateId: st.id } })).id);
    }
    // 55 rodas da org A: estado/cidade 0 nas 20 primeiras, 1 nas demais; local em 'Praça' nas pares.
    await prisma.roda.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        organizationId: mestre.organizationId,
        title: `${TAG} roda ${String(i).padStart(2, '0')}`,
        date: new Date(Date.UTC(2032, 0, 1 + i)),
        stateId: stateIds[i < 20 ? 0 : 1],
        cityId: cityIds[i < 20 ? 0 : 1],
        location: i % 2 === 0 ? `Praça ${TAG}Q` : null,
      })),
    });
    await prisma.roda.createMany({
      data: Array.from({ length: 3 }, (_, i) => ({
        organizationId: orgB.organizationId,
        title: `${TAG} orgB ${i}`,
        date: new Date(Date.UTC(2032, 5, 1 + i)),
        stateId: stateIds[0],
      })),
    });
  });

  after(async () => {
    const ids = (await prisma.roda.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } })).map((r) => r.id);
    await prisma.rodaParticipant.deleteMany({ where: { rodaId: { in: ids } } });
    await prisma.roda.deleteMany({ where: { id: { in: ids } } });
    await prisma.city.deleteMany({ where: { id: { in: cityIds } } });
    await prisma.state.deleteMany({ where: { id: { in: stateIds } } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('pública sem token; sem limit: array de 50 e X-Total-Count global; limit/offset fatiam (date asc, id asc)', async () => {
    const res = await get('/rodas').expect(200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 50);
    assert.equal(res.headers['x-total-count'], String(await prisma.roda.count()));

    const all = await prisma.roda.findMany({ where: { title: { startsWith: TAG } }, orderBy: [{ date: 'asc' }, { id: 'asc' }] });
    const page = await get(`/rodas?q=${TAG}&limit=10&offset=50`).expect(200);
    assert.equal(page.headers['x-total-count'], '58'); // lista é pública: inclui as 3 da org B (regra existente)
    assert.deepEqual(page.body.map((r: { id: number }) => r.id), all.slice(50, 60).map((r) => r.id));
  });

  it('limit=201, limit=0, offset=-1, stateId inválido e parâmetro desconhecido => 400', async () => {
    for (const qs of ['limit=201', 'limit=0', 'offset=-1', 'stateId=abc', 'cityId=x', 'foo=1']) await get(`/rodas?${qs}`).expect(400);
  });

  it('filtros: stateId, cityId, q (título e local, insensível a caixa)', async () => {
    assert.equal((await get(`/rodas?q=${TAG}&stateId=${stateIds[0]}`).expect(200)).headers['x-total-count'], String(20 + 3));
    assert.equal((await get(`/rodas?q=${TAG}&stateId=${stateIds[1]}`).expect(200)).headers['x-total-count'], '35');
    assert.equal((await get(`/rodas?q=${TAG}&cityId=${cityIds[0]}`).expect(200)).headers['x-total-count'], '20');
    assert.equal((await get(`/rodas?q=${TAG}&stateId=${stateIds[0]}&cityId=${cityIds[1]}`).expect(200)).headers['x-total-count'], '0');
    assert.equal((await get(`/rodas?q=${(TAG + 'q').toLowerCase()}`).expect(200)).headers['x-total-count'], '28');
    assert.equal((await get(`/rodas?q=${TAG}%20roda%2054`).expect(200)).headers['x-total-count'], '1');
  });

  it('PATCH null limpa description/location/stateId/cityId/communityId/imageUrl (2ª via: Prisma)', async () => {
    const community = await prisma.community.create({ data: { name: `${TAG} com`, stateId: stateIds[0] } });
    const roda = await prisma.roda.create({
      data: { organizationId: mestre.organizationId, title: `${TAG} limpar`, date: new Date(), description: 'd', location: 'l', stateId: stateIds[0], cityId: cityIds[0], communityId: community.id, imageUrl: 'https://exemplo.com/a.png' },
    });
    await patch(roda.id, { description: null, location: null, stateId: null, cityId: null, communityId: null, imageUrl: null }).expect(200);
    const db = await prisma.roda.findUniqueOrThrow({ where: { id: roda.id } });
    assert.deepEqual([db.description, db.location, db.stateId, db.cityId, db.communityId, db.imageUrl], [null, null, null, null, null, null]);
    await patch(roda.id, { cityId: 99999999 }).expect(400);
    await patch(roda.id, { imageUrl: '' }).expect(400);
    await prisma.roda.delete({ where: { id: roda.id } });
    await prisma.community.delete({ where: { id: community.id } });
  });

  it('null em campo OBRIGATÓRIO => 400 (title, date) e nada muda', async () => {
    const roda = await prisma.roda.create({ data: { organizationId: mestre.organizationId, title: `${TAG} obrig`, date: new Date() } });
    for (const body of [{ title: null }, { date: null }]) await patch(roda.id, body).expect(400);
    assert.equal((await prisma.roda.findUniqueOrThrow({ where: { id: roda.id } })).title, `${TAG} obrig`);
  });

  it('RBAC inalterado: PATCH sem token 401; ALUNO 403; roda de OUTRA organização 404 para o MESTRE', async () => {
    const mine = await prisma.roda.findFirstOrThrow({ where: { organizationId: mestre.organizationId, title: { startsWith: TAG } } });
    await request(app.getHttpServer()).patch(`/api/rodas/${mine.id}`).send({ location: 'x' }).expect(401);
    await request(app.getHttpServer()).patch(`/api/rodas/${mine.id}`).set('Authorization', `Bearer ${aluno.token}`).send({ location: 'x' }).expect(403);
    const other = await prisma.roda.findFirstOrThrow({ where: { organizationId: orgB.organizationId, title: { startsWith: TAG } } });
    await patch(other.id, { location: 'x' }).expect(404);
  });
});