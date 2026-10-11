import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { loginToken } from './utils/page-helpers';
import { createSecondOrg, SecondOrg } from './utils/list-helpers';
import { createPlatformUser, platformLogin } from './utils/platform-team-fixtures';

/**
 * CRUD de Unidades (E02): POST/PATCH/DELETE /units + matriz automática no grupo novo.
 * Segunda via independente = Prisma direto (linha gravada, contagens, nada apagado).
 * Grupo "G" = criado de verdade por POST /organizations (nasce com a unidade Matriz); grupo "B" = org
 * de fixture (nasce SEM unidade) usada nos cenários de plano/limite e de isolamento entre grupos.
 */
const TAG = `${Date.now()}`;
const NAME_PREFIX = 'E2E UnitsCrud';
const MAIL_DOMAIN = 'e2e-units-crud.local';
const MESTRE_PASSWORD = 'Mestre#Seguro2026';
const PROFESSOR_EMAIL = 'professor@gingabrasil.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';

describe('Units: CRUD, matriz, limite do plano e RBAC (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const server = () => app.getHttpServer();
  const fixtureUserIds: number[] = [];
  const planIds: number[] = [];

  let superToken: string;
  let professorToken: string;
  let alunoToken: string;
  let groupId: number;
  let mestreToken: string;
  let orgB: SecondOrg;

  const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, token?: string) => {
    const req = request(server())[method](`/api${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const units = (organizationId: number) =>
    prisma.unit.findMany({ where: { organizationId }, orderBy: { id: 'asc' } });
  const mainCount = (organizationId: number) => prisma.unit.count({ where: { organizationId, isMain: true } });

  before(async () => {
    app = await createTestApp();
    const superAdmin = await createPlatformUser(prisma, 'unitscrud-super', { isSuperAdmin: true });
    fixtureUserIds.push(superAdmin.id);
    superToken = await platformLogin(app, superAdmin.email);
    professorToken = await loginToken(app, PROFESSOR_EMAIL);
    alunoToken = await loginToken(app, ALUNO_EMAIL);

    const created = await request(server())
      .post('/api/organizations')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        name: `${NAME_PREFIX} ${TAG}`,
        mestre: { name: 'Mestre Unidades', email: `mestre-${TAG}@${MAIL_DOMAIN}`, password: MESTRE_PASSWORD },
      })
      .expect(201);
    groupId = created.body.id;
    const login = await request(server())
      .post('/api/auth/login')
      .send({ email: `mestre-${TAG}@${MAIL_DOMAIN}`, password: MESTRE_PASSWORD })
      .expect(200);
    mestreToken = login.body.accessToken;
    orgB = await createSecondOrg(app, prisma, 'unitscrud');
  });

  after(async () => {
    const orgIds = [groupId, orgB.organizationId];
    await prisma.subscription.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
    await prisma.unit.deleteMany({ where: { organizationId: { in: orgIds } } });
    // Se o RBAC regredir, as escritas de PROFESSOR/ALUNO passam e criariam unidades na org do seed: não deixa lixo.
    await prisma.unit.deleteMany({ where: { name: { in: ['Professor Cria', 'Professor Edita', 'Aluno Cria', 'Aluno Edita'] } } });
    const memberships = await prisma.organizationUser.findMany({ where: { organizationId: groupId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: groupId } });
    await prisma.user.deleteMany({ where: { id: { in: memberships.map((m) => m.userId) } } });
    await prisma.organization.deleteMany({ where: { id: groupId } });
    await orgB.cleanup();
    await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('grupo novo e criação', () => {
    it('POST /organizations cria o grupo COM a unidade Matriz (isMain, ACTIVE); o Mestre novo a enxerga em GET /units', async () => {
      const rows = await units(groupId);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, 'Matriz');
      assert.equal(rows[0].isMain, true);
      assert.equal(rows[0].status, 'ACTIVE');
      const list = await api('get', '/units', mestreToken).expect(200);
      assert.deepEqual(list.body.map((u: { id: number }) => u.id), [rows[0].id]);
    });

    it('MESTRE cria filial: nome/endereço aparados, UF em maiúsculas, organizationId do TOKEN, não vira matriz', async () => {
      const res = await api('post', '/units', mestreToken)
        .send({ name: '  Filial Centro  ', address: ' Rua A, 10 ', city: ' Goiânia ', state: 'go' })
        .expect(201);
      assert.equal(res.body.name, 'Filial Centro');
      assert.equal(res.body.address, 'Rua A, 10');
      assert.equal(res.body.city, 'Goiânia');
      assert.equal(res.body.state, 'GO');
      assert.equal(res.body.isMain, false);
      assert.equal(res.body.status, 'ACTIVE');
      assert.equal(res.body.organizationId, groupId);
      const row = await prisma.unit.findUniqueOrThrow({ where: { id: res.body.id } });
      assert.equal(row.organizationId, groupId);
      assert.equal(row.state, 'GO');
    });

    it('campos vazios opcionais são omitidos (null no banco)', async () => {
      const res = await api('post', '/units', mestreToken).send({ name: 'Filial Vazia', address: '  ', city: '', state: '' }).expect(201);
      assert.equal(res.body.address, null);
      assert.equal(res.body.city, null);
      assert.equal(res.body.state, null);
    });

    it('validação: nome curto, UF inválida, isMain não booleano, campos proibidos (organizationId/status/id) => 400 e nada criado', async () => {
      const before = await prisma.unit.count({ where: { organizationId: groupId } });
      const bad: Array<Record<string, unknown>> = [
        {},
        { name: 'A' },
        { name: 'x'.repeat(121) },
        { name: 'Filial', state: 'XX' },
        { name: 'Filial', state: 'Goiás' },
        { name: 'Filial', isMain: 'sim' },
        { name: 'Filial', organizationId: orgB.organizationId },
        { name: 'Filial', status: 'INACTIVE' },
        { name: 'Filial', id: 1 },
        { name: 'Filial', address: 'y'.repeat(201) },
      ];
      for (const payload of bad) {
        const res = await api('post', '/units', mestreToken).send(payload);
        assert.equal(res.status, 400, `${JSON.stringify(payload).slice(0, 60)} => ${res.status}`);
      }
      assert.equal(await prisma.unit.count({ where: { organizationId: groupId } }), before);
    });
  });

  describe('matriz exclusiva por grupo', () => {
    it('criar com isMain=true torna a nova a única matriz', async () => {
      const res = await api('post', '/units', mestreToken).send({ name: 'Nova Matriz', isMain: true }).expect(201);
      assert.equal(res.body.isMain, true);
      assert.equal(await mainCount(groupId), 1);
      const rows = await units(groupId);
      assert.deepEqual(rows.filter((u) => u.isMain).map((u) => u.id), [res.body.id]);
    });

    it('PATCH isMain=true em outra unidade passa a matriz (a anterior é desmarcada); continua exatamente 1', async () => {
      const target = await prisma.unit.findFirstOrThrow({ where: { organizationId: groupId, name: 'Filial Centro' } });
      const res = await api('patch', `/units/${target.id}`, mestreToken).send({ isMain: true }).expect(200);
      assert.equal(res.body.isMain, true);
      assert.equal(await mainCount(groupId), 1);
      assert.equal((await prisma.unit.findUniqueOrThrow({ where: { id: target.id } })).isMain, true);
    });

    it('desmarcar a matriz sem outra assumir => 409 (o grupo nunca fica sem matriz)', async () => {
      const main = await prisma.unit.findFirstOrThrow({ where: { organizationId: groupId, isMain: true } });
      const res = await api('patch', `/units/${main.id}`, mestreToken).send({ isMain: false }).expect(409);
      assert.match(res.body.message, /matriz/i);
      assert.equal((await prisma.unit.findUniqueOrThrow({ where: { id: main.id } })).isMain, true);
    });

    it('a matriz não pode ser inativada nem por DELETE nem por PATCH status (409), e continua ativa', async () => {
      const main = await prisma.unit.findFirstOrThrow({ where: { organizationId: groupId, isMain: true } });
      assert.match((await api('delete', `/units/${main.id}`, mestreToken).expect(409)).body.message, /matriz/i);
      await api('patch', `/units/${main.id}`, mestreToken).send({ status: 'INACTIVE' }).expect(409);
      const row = await prisma.unit.findUniqueOrThrow({ where: { id: main.id } });
      assert.equal(row.status, 'ACTIVE');
      assert.equal(row.isMain, true);
    });
  });

  describe('inativar (DELETE) e reativar — nunca apaga', () => {
    it('DELETE de filial => 200 e status INACTIVE; a linha continua no banco; repetir é idempotente', async () => {
      const filial = await prisma.unit.findFirstOrThrow({ where: { organizationId: groupId, name: 'Filial Vazia' } });
      const total = await prisma.unit.count({ where: { organizationId: groupId } });
      const first = await api('delete', `/units/${filial.id}`, mestreToken).expect(200);
      assert.equal(first.body.status, 'INACTIVE');
      await api('delete', `/units/${filial.id}`, mestreToken).expect(200);
      assert.equal(await prisma.unit.count({ where: { organizationId: groupId } }), total, 'nenhuma linha pode sumir');
      assert.equal((await prisma.unit.findUniqueOrThrow({ where: { id: filial.id } })).status, 'INACTIVE');
    });

    it('unidade inativa não pode ser matriz (409) até ser reativada; reativar por PATCH status=ACTIVE => 200', async () => {
      const filial = await prisma.unit.findFirstOrThrow({ where: { organizationId: groupId, name: 'Filial Vazia' } });
      await api('patch', `/units/${filial.id}`, mestreToken).send({ isMain: true }).expect(409);
      await api('patch', `/units/${filial.id}`, mestreToken).send({ status: 'INACTIVE', isMain: true }).expect(409);
      assert.equal(await mainCount(groupId), 1);
      const res = await api('patch', `/units/${filial.id}`, mestreToken).send({ status: 'ACTIVE' }).expect(200);
      assert.equal(res.body.status, 'ACTIVE');
    });

    it('vínculos não impedem inativar e o histórico segue apontando para a unidade (aluno com unitId preservado)', async () => {
      const filial = await prisma.unit.findFirstOrThrow({ where: { organizationId: groupId, name: 'Filial Vazia' } });
      const student = await prisma.student.create({ data: { organizationId: groupId, unitId: filial.id, name: `${NAME_PREFIX} aluno` } });
      try {
        await api('delete', `/units/${filial.id}`, mestreToken).expect(200);
        assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).unitId, filial.id);
      } finally {
        await prisma.student.delete({ where: { id: student.id } });
      }
    });

    it('nunca se inativa a ÚNICA unidade ativa do grupo (409), mesmo sem matriz marcada', async () => {
      // Estado "legado" via Prisma: só uma unidade ativa e nenhuma marcada como matriz.
      try {
        await prisma.unit.updateMany({ where: { organizationId: groupId }, data: { isMain: false } });
        const actives = await prisma.unit.findMany({ where: { organizationId: groupId, status: 'ACTIVE' }, orderBy: { id: 'asc' } });
        await prisma.unit.updateMany({ where: { id: { in: actives.slice(1).map((u) => u.id) } }, data: { status: 'INACTIVE' } });
        const res = await api('delete', `/units/${actives[0].id}`, mestreToken).expect(409);
        assert.match(res.body.message, /única unidade ativa/i);
        assert.equal((await prisma.unit.findUniqueOrThrow({ where: { id: actives[0].id } })).status, 'ACTIVE');
      } finally {
        // restaura G: a primeira unidade volta a ser a matriz ativa para os testes seguintes
        const first = await prisma.unit.findFirstOrThrow({ where: { organizationId: groupId }, orderBy: { id: 'asc' } });
        await prisma.unit.update({ where: { id: first.id }, data: { status: 'ACTIVE', isMain: true } });
      }
    });
  });

  describe('edição parcial (PATCH)', () => {
    it('muda só o enviado; null/vazio LIMPA endereço/cidade/UF; name e status não aceitam null', async () => {
      const unit = (await api('post', '/units', mestreToken).send({ name: 'Editavel', address: 'Rua X', city: 'Anápolis', state: 'GO' }).expect(201)).body;
      const renamed = await api('patch', `/units/${unit.id}`, mestreToken).send({ name: ' Editavel 2 ' }).expect(200);
      assert.equal(renamed.body.name, 'Editavel 2');
      assert.equal(renamed.body.address, 'Rua X');
      const cleared = await api('patch', `/units/${unit.id}`, mestreToken).send({ address: null, city: '', state: null }).expect(200);
      assert.equal(cleared.body.address, null);
      assert.equal(cleared.body.city, null);
      assert.equal(cleared.body.state, null);
      assert.equal(cleared.body.name, 'Editavel 2');
      for (const bad of [{ name: null }, { status: null }, { isMain: null }, { status: 'DELETED' }, { state: 'ZZ' }, { organizationId: 1 }, {}]) {
        await api('patch', `/units/${unit.id}`, mestreToken).send(bad).expect(400);
      }
    });

    it('ids inexistentes => 404; id não numérico => 400; sem token => 401', async () => {
      await api('patch', '/units/999999999', mestreToken).send({ name: 'Nada' }).expect(404);
      await api('delete', '/units/999999999', mestreToken).expect(404);
      await api('patch', '/units/abc', mestreToken).send({ name: 'Nada' }).expect(400);
      await api('post', '/units').send({ name: 'Sem token' }).expect(401);
      await api('patch', '/units/1').send({ name: 'Sem token' }).expect(401);
      await api('delete', '/units/1').expect(401);
    });

    it('GET /units?status= filtra por situação e valor inválido => 400', async () => {
      const inactive = await api('get', '/units?status=INACTIVE', mestreToken).expect(200);
      assert.ok(inactive.body.every((u: { status: string }) => u.status === 'INACTIVE'));
      const active = await api('get', '/units?status=ACTIVE&limit=200', mestreToken).expect(200);
      assert.ok(active.body.length > 0 && active.body.every((u: { status: string }) => u.status === 'ACTIVE'));
      await api('get', '/units?status=XYZ', mestreToken).expect(400);
    });
  });

  describe('RBAC (recurso units)', () => {
    it('PROFESSOR só visualiza: GET 200; POST/PATCH/DELETE 403 (e nada muda)', async () => {
      await api('get', '/units?limit=5', professorToken).expect(200);
      const before = await prisma.unit.count();
      await api('post', '/units', professorToken).send({ name: 'Professor Cria' }).expect(403);
      await api('patch', '/units/1', professorToken).send({ name: 'Professor Edita' }).expect(403);
      await api('delete', '/units/1', professorToken).expect(403);
      assert.equal(await prisma.unit.count(), before);
      assert.equal(await prisma.unit.count({ where: { name: { in: ['Professor Cria', 'Professor Edita'] } } }), 0);
    });

    it('ALUNO só visualiza (comportamento anterior preservado): GET 200; escritas 403', async () => {
      await api('get', '/units?limit=5', alunoToken).expect(200);
      await api('post', '/units', alunoToken).send({ name: 'Aluno Cria' }).expect(403);
      await api('patch', '/units/1', alunoToken).send({ name: 'Aluno Edita' }).expect(403);
      await api('delete', '/units/1', alunoToken).expect(403);
    });

    it('a matriz de permissões tem a linha units para os 4 papéis (MESTRE tudo; demais só view)', async () => {
      const rows = await prisma.rolePermission.findMany({ where: { resource: 'units' } });
      const flags = Object.fromEntries(
        rows.map((r) => [r.role, `${r.canView ? 'V' : '-'}${r.canCreate ? 'C' : '-'}${r.canEdit ? 'E' : '-'}${r.canDelete ? 'D' : '-'}`]),
      );
      assert.deepEqual(flags, { MESTRE: 'VCED', PROFESSOR: 'V---', ALUNO: 'V---', RESPONSAVEL: 'V---' });
    });
  });

  describe('isolamento entre grupos', () => {
    it('Mestre de G não vê, edita nem inativa unidade de B (404) e a unidade de B não muda', async () => {
      const theirs = (await api('post', '/units', orgB.token).send({ name: `${NAME_PREFIX} B isolada` }).expect(201)).body;
      assert.equal(theirs.organizationId, orgB.organizationId);
      await api('get', `/units/${theirs.id}`, mestreToken).expect(404);
      await api('patch', `/units/${theirs.id}`, mestreToken).send({ name: 'Invadida', isMain: true }).expect(404);
      await api('delete', `/units/${theirs.id}`, mestreToken).expect(404);
      const row = await prisma.unit.findUniqueOrThrow({ where: { id: theirs.id } });
      assert.equal(row.name, `${NAME_PREFIX} B isolada`);
      assert.equal(row.status, 'ACTIVE');
      // e a matriz de G não foi tocada pela criação em B (matriz é por grupo)
      assert.equal(await mainCount(groupId), 1);
      assert.equal(await mainCount(orgB.organizationId), 1);
      await prisma.unit.delete({ where: { id: theirs.id } });
    });
  });

  describe('Plan.maxUnits', () => {
    async function openPlan(maxUnits: number | null) {
      const plan = await prisma.plan.create({
        data: { name: `${NAME_PREFIX} plano ${maxUnits}`, code: `e2e-unitscrud-${TAG}-${maxUnits}-${Math.floor(Math.random() * 1e6)}`, priceCents: 1000, maxUnits },
      });
      planIds.push(plan.id);
      const sub = await prisma.subscription.create({ data: { organizationId: orgB.organizationId, planId: plan.id, status: 'ACTIVE' } });
      return { plan, sub };
    }
    const reset = async () => {
      await prisma.subscription.deleteMany({ where: { organizationId: orgB.organizationId } });
      await prisma.unit.deleteMany({ where: { organizationId: orgB.organizationId } });
    };
    const activeCount = () => prisma.unit.count({ where: { organizationId: orgB.organizationId, status: 'ACTIVE' } });

    it('sem assinatura em aberto não há limite', async () => {
      await reset();
      for (let i = 0; i < 4; i++) await api('post', '/units', orgB.token).send({ name: `Livre ${i}` }).expect(201);
      assert.equal(await activeCount(), 4);
    });

    it('limite 2: a 3ª criação => 403 com mensagem clara; inativar libera vaga; reativar acima do limite => 403', async () => {
      await reset();
      await openPlan(2);
      const u1 = (await api('post', '/units', orgB.token).send({ name: 'L1' }).expect(201)).body;
      const u2 = (await api('post', '/units', orgB.token).send({ name: 'L2' }).expect(201)).body;
      assert.equal(u1.isMain, true, 'primeira unidade de um grupo sem matriz vira a matriz');
      assert.equal(u2.isMain, false);
      const blocked = await api('post', '/units', orgB.token).send({ name: 'L3' }).expect(403);
      assert.match(blocked.body.message, /Limite de 2 unidade/);
      assert.match(blocked.body.message, /plano/);
      assert.equal(await prisma.unit.count({ where: { organizationId: orgB.organizationId, name: 'L3' } }), 0);

      await api('delete', `/units/${u2.id}`, orgB.token).expect(200);
      const u3 = (await api('post', '/units', orgB.token).send({ name: 'L3' }).expect(201)).body;
      assert.equal(await activeCount(), 2);
      const reactivate = await api('patch', `/units/${u2.id}`, orgB.token).send({ status: 'ACTIVE' }).expect(403);
      assert.match(reactivate.body.message, /Limite de 2/);
      assert.equal((await prisma.unit.findUniqueOrThrow({ where: { id: u2.id } })).status, 'INACTIVE');

      // Editar sem mudar a situação não esbarra no limite; upgrade de plano libera a reativação.
      await api('patch', `/units/${u3.id}`, orgB.token).send({ name: 'L3 editada' }).expect(200);
      await prisma.plan.updateMany({ where: { id: { in: planIds } }, data: { maxUnits: null } });
      await api('patch', `/units/${u2.id}`, orgB.token).send({ status: 'ACTIVE' }).expect(200);
      assert.equal(await activeCount(), 3);
    });

    it('assinatura CANCELED não aplica limite', async () => {
      await reset();
      const { sub } = await openPlan(1);
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELED' } });
      await api('post', '/units', orgB.token).send({ name: 'C1' }).expect(201);
      await api('post', '/units', orgB.token).send({ name: 'C2' }).expect(201);
    });

    it('criações simultâneas no limite: nunca passa de 3 unidades ativas (lock por grupo)', async () => {
      await reset();
      await openPlan(3);
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => api('post', '/units', orgB.token).send({ name: `Corrida ${i}` })),
      );
      const statuses = results.map((r) => r.status).sort();
      assert.deepEqual(statuses, [201, 201, 201, 403, 403, 403, 403, 403], JSON.stringify(statuses));
      assert.equal(await activeCount(), 3);
      assert.equal(await mainCount(orgB.organizationId), 1, 'continua UMA matriz mesmo com criações simultâneas');
    });

    it('determinístico: POST/PATCH/DELETE de unidade ESPERAM o lock da linha da organização (serialização por grupo)', async () => {
      await reset();
      const unit = (await api('post', '/units', orgB.token).send({ name: 'Lock base' }).expect(201)).body;
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const lockedPromise = new Promise<void>((resolve) => (locked = resolve));
      // Outra "instância" segura o lock da organização (SELECT ... FOR UPDATE) até liberarmos.
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${orgB.organizationId} FOR UPDATE`;
          locked();
          await released;
        },
        { timeout: 30_000 },
      );
      await lockedPromise;
      const finished = { post: false, patch: false, del: false };
      const post = api('post', '/units', orgB.token).send({ name: 'Espera lock' }).then((r) => ((finished.post = true), r));
      const patch = api('patch', `/units/${unit.id}`, orgB.token).send({ name: 'Lock renomeada' }).then((r) => ((finished.patch = true), r));
      const del = api('delete', `/units/${unit.id}`, orgB.token).then((r) => ((finished.del = true), r));
      await new Promise((resolve) => setTimeout(resolve, 700));
      assert.deepEqual(finished, { post: false, patch: false, del: false }, 'as escritas devem esperar o lock do grupo');
      release();
      await holder;
      const [p, pa, d] = await Promise.all([post, patch, del]);
      assert.equal(p.status, 201);
      assert.ok([200, 409].includes(pa.status) && [200, 409].includes(d.status), `${pa.status}/${d.status}`);
    });

    it('trocas de matriz simultâneas terminam com UMA só matriz', async () => {
      await reset();
      const ids: number[] = [];
      for (let i = 0; i < 4; i++) ids.push((await api('post', '/units', orgB.token).send({ name: `M${i}` }).expect(201)).body.id);
      const results = await Promise.all(ids.map((id) => api('patch', `/units/${id}`, orgB.token).send({ isMain: true })));
      assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.status)));
      assert.equal(await mainCount(orgB.organizationId), 1);
    });
  });
});
