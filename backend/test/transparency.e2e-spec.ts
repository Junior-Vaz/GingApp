import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus, TransparencySetting } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { countActiveGroups, countActiveStudents } from '../src/interface/http/platform-dashboard/platform-metrics';
import { addMonths, currentMonthSaoPaulo } from '../src/interface/http/transparency/transparency-rules';
import { AUDIT_ACTION_CODES } from '../src/shared/audit/audit-actions';
import { createPlatformUser, memberLogin, platformLogin, TEAM_DOMAIN, TEAM_PASSWORD } from './utils/platform-team-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Transparencia da plataforma (docs/CONTRATO_TRANSPARENCIA.md secao 7, backend): permissoes (anonimo 401, nao-platform
 * 403, PLATFORM comum so le, super admin escreve; /transparency publico 200), par tipo x categoria, centavos inteiros,
 * datas, congelamento do mes publicado (criar/editar/mover/excluir = 409), MONTH_NOT_CLOSED/MONTH_EMPTY/publicar 2x,
 * concorrencia (2 publicacoes simultaneas = 1 x 201 + 1 x 409), retrato imutavel, reserva somando TODOS os meses
 * publicados, custo por aluno (0 alunos = null), goalCoveragePct (meta 0 = null, > 100), so 12 meses, PROVA de privacidade
 * (texto-sentinela na description varrido no JSON publico inteiro + campos proibidos), CSV anti-injecao, auditoria sem
 * texto livre, log de requisicao sem IP e throttle por IP.
 *
 * Dados GLOBAIS (sem grupo): o spec exige que NAO haja lancamento/mes publicado de fora dele no banco (senao os numeros
 * publicos nao seriam exatos), limpa sobras de uma execucao interrompida e RESTAURA a configuracao singleton no after().
 * Com TRANSPARENCY_CAPTURE_DIR definido, grava o JSON REAL de GET /transparency e GET /platform-finance/months
 * (2 meses publicados) para virar fixture do app/admin.
 */
const TAG = '[e2e-transp]';
const TEAM_TAG = 'transp';

describe('Transparência da plataforma (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const SENTINEL = `SENTINELA-${stamp}-Fornecedor Fulano de Tal CPF 123.456.789-00`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const as = (token: string) => ({
    get: (p: string) => http().get(`/api${p}`).set(auth(token)),
    post: (p: string, body?: object) => http().post(`/api${p}`).set(auth(token)).send(body ?? {}),
    patch: (p: string, body: object) => http().patch(`/api${p}`).set(auth(token)).send(body),
    put: (p: string, body: object) => http().put(`/api${p}`).set(auth(token)).send(body),
    del: (p: string) => http().delete(`/api${p}`).set(auth(token)),
  });
  const pub = () => http().get('/api/transparency');

  const CUR = currentMonthSaoPaulo();
  const M1 = addMonths(CUR, -1); // mes mais recente encerrado
  const M2 = addMonths(CUR, -2);
  const M3 = addMonths(CUR, -3);
  /** Os 13 meses encerrados mais recentes (o 13o NAO pode aparecer no publico). */
  const LAST13 = Array.from({ length: 13 }, (_v, i) => addMonths(CUR, -(i + 1)));
  const ALL_MONTHS = [CUR, ...LAST13];

  let superToken: string;
  let commonToken: string;
  let memberToken: string;
  let superUserId: number;
  const userIds: number[] = [];
  let orgId: number;
  let settingBackup: TransparencySetting | null = null;
  const envBackup = { ...process.env };

  const entryBody = (over: Record<string, unknown> = {}) => ({
    type: 'DESPESA',
    category: 'HOSPEDAGEM',
    amountCents: 1000,
    occurredOn: `${CUR}-01`,
    description: `${TAG} ${SENTINEL}`,
    ...over,
  });
  const createEntry = async (over: Record<string, unknown> = {}) =>
    (await as(superToken).post('/platform-finance/entries', entryBody(over)).expect(201)).body;

  /** Todas as chaves (em qualquer nivel) de um JSON. */
  const keysDeep = (value: unknown, acc = new Set<string>()): Set<string> => {
    if (Array.isArray(value)) value.forEach((v) => keysDeep(v, acc));
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        acc.add(k);
        keysDeep(v, acc);
      }
    }
    return acc;
  };
  const PUBLIC_TOP_KEYS = ['generatedAt', 'entityName', 'introText', 'surplusText', 'monthlyGoalCents', 'reserveCents', 'months'];
  const PUBLIC_MONTH_KEYS = [
    'month', 'publishedAt', 'note', 'revenueCents', 'expenseCents', 'balanceCents', 'revenueBySource', 'expensesByCategory',
    'activeStudents', 'activeGroups', 'costPerActiveStudentCents', 'goalCents', 'goalCoveragePct',
  ];
  const FORBIDDEN_PUBLIC_KEYS = [
    'id', 'description', 'createdByUserId', 'publishedByUserId', 'updatedByUserId', 'occurredOn', 'entries', 'createdAt',
    'updatedAt', 'locked', 'userId', 'ip', 'userAgent', 'openingReserveCents', 'liveActiveStudents', 'snapshot',
  ];
  /** Corpo publico: chaves exatas, nenhum campo proibido, nenhum texto de description (sentinela). */
  const assertPublicShape = (body: Record<string, unknown>, raw: string) => {
    assert.deepEqual(Object.keys(body).sort(), [...PUBLIC_TOP_KEYS].sort());
    for (const m of body.months as Record<string, unknown>[]) {
      assert.deepEqual(Object.keys(m).sort(), [...PUBLIC_MONTH_KEYS].sort(), JSON.stringify(m));
      for (const list of [m.revenueBySource, m.expensesByCategory] as Record<string, unknown>[][]) {
        for (const item of list) assert.deepEqual(Object.keys(item).sort(), ['category', 'cents', 'label']);
        const cents = list.map((i) => i.cents as number);
        assert.deepEqual(cents, [...cents].sort((a, b) => b - a), 'ordenado por valor desc');
        assert.ok(cents.every((c) => Number.isInteger(c) && c > 0), 'só categorias com valor > 0');
      }
    }
    const keys = keysDeep(body);
    for (const k of FORBIDDEN_PUBLIC_KEYS) assert.ok(!keys.has(k), `campo proibido no público: ${k}`);
    assert.ok(!raw.includes('SENTINELA'), 'o texto-sentinela da description NÃO pode aparecer no JSON público');
    assert.ok(!raw.includes(stamp), 'nada do carimbo deste spec (descriptions) no JSON público');
    assert.ok(!raw.includes(TAG), 'nenhuma description no JSON público');
  };

  before(async () => {
    app = await createTestApp();

    // Sobras de uma execucao interrompida deste spec (descriptions com a TAG; meses publicados por usuarios do spec).
    const leftoverUsers = await prisma.user.findMany({
      where: { email: { startsWith: `${TEAM_TAG}-`, endsWith: `@${TEAM_DOMAIN}` } },
      select: { id: true },
    });
    const leftoverIds = leftoverUsers.map((u) => u.id);
    await prisma.ledgerEntry.deleteMany({ where: { OR: [{ description: { contains: TAG } }, { createdByUserId: { in: leftoverIds } }] } });
    await prisma.transparencyMonth.deleteMany({ where: { publishedByUserId: { in: leftoverIds } } });

    // Isolamento: nenhum dado de transparencia de fora deste spec (os numeros publicos sao globais).
    const [foreignEntries, foreignMonths] = await Promise.all([prisma.ledgerEntry.count(), prisma.transparencyMonth.count()]);
    assert.equal(foreignEntries + foreignMonths, 0, 'há lançamentos/meses publicados de fora deste spec no banco de dev; limpe-os antes de rodar');

    settingBackup = await prisma.transparencySetting.findUnique({ where: { id: 1 } });
    await prisma.transparencySetting.deleteMany({});

    const superAdmin = await createPlatformUser(prisma, `${TEAM_TAG}-super`, { isSuperAdmin: true });
    const common = await createPlatformUser(prisma, `${TEAM_TAG}-common`);
    superUserId = superAdmin.id;
    userIds.push(superAdmin.id, common.id);
    superToken = await platformLogin(app, superAdmin.email);
    commonToken = await platformLogin(app, common.email);

    // MEMBER (Mestre de um grupo proprio): nao e da plataforma
    orgId = (
      await prisma.organization.create({
        data: { name: `${TAG} Grupo ${stamp}`, slug: `e2e-transp-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
      })
    ).id;
    const memberEmail = `${TEAM_TAG}-member-${stamp}@${TEAM_DOMAIN}`;
    const member = await prisma.user.create({
      data: { email: memberEmail, passwordHash: await bcrypt.hash(TEAM_PASSWORD, 4), name: `${TAG} mestre`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    userIds.push(member.id);
    await prisma.organizationUser.create({ data: { organizationId: orgId, userId: member.id, role: OrgRole.MESTRE, status: 'ACTIVE' } });
    memberToken = await memberLogin(app, memberEmail);
  });

  after(async () => {
    process.env = { ...envBackup };
    await app.close();
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { organizationId: orgId }] } });
    await prisma.ledgerEntry.deleteMany({ where: { OR: [{ description: { contains: TAG } }, { createdByUserId: { in: userIds } }] } });
    await prisma.transparencyMonth.deleteMany({ where: { OR: [{ publishedByUserId: { in: userIds } }, { month: { in: ALL_MONTHS } }] } });
    await prisma.transparencySetting.deleteMany({});
    if (settingBackup) await prisma.transparencySetting.create({ data: settingBackup });
    await prisma.student.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('permissões', () => {
    const ROUTES: Array<['get' | 'post' | 'patch' | 'put' | 'del', string]> = [
      ['get', '/platform-finance/entries'],
      ['get', '/platform-finance/entries.csv'],
      ['post', '/platform-finance/entries'],
      ['patch', '/platform-finance/entries/1'],
      ['del', '/platform-finance/entries/1'],
      ['get', '/platform-finance/months'],
      ['post', `/platform-finance/months/${M1}/publish`],
      ['post', `/platform-finance/months/${M1}/unpublish`],
      ['get', '/platform-finance/settings'],
      ['put', '/platform-finance/settings'],
      ['get', '/platform-finance/preview'],
    ];
    const call = (token: string | null, method: string, p: string) => {
      const verb = method === 'del' ? 'delete' : method;
      const req = (http() as unknown as Record<string, (u: string) => request.Test>)[verb](`/api${p}`);
      if (token) req.set(auth(token));
      return method === 'get' || method === 'del' ? req : req.send({});
    };

    it('sem token = 401 e MEMBER (não-platform) = 403 em TODAS as rotas /platform-finance; /transparency sem token = 200', async () => {
      for (const [method, p] of ROUTES) {
        assert.equal((await call(null, method, p)).status, 401, `anônimo ${method} ${p}`);
        assert.equal((await call(memberToken, method, p)).status, 403, `MEMBER ${method} ${p}`);
      }
      const res = await pub().expect(200);
      assert.equal(res.headers['cache-control'], 'public, max-age=300');
      assert.deepEqual(res.body.months, [], 'sem nenhum mês publicado: months = []');
      assert.equal(res.body.reserveCents, 0);
      assert.equal(res.body.monthlyGoalCents, 0);
      // token enviado a rota publica nao muda nada (nem quebra)
      await pub().set(auth(memberToken)).expect(200);
    });

    it('PLATFORM comum lê (200) e recebe 403 em TODA escrita, antes de validar o corpo; nada é gravado', async () => {
      for (const [method, p] of ROUTES) {
        const res = await call(commonToken, method, p);
        if (method === 'get') assert.equal(res.status, 200, `comum ${method} ${p} -> ${res.status}`);
        else assert.equal(res.status, 403, `comum ${method} ${p} -> ${res.status}`);
      }
      await as(commonToken).post('/platform-finance/entries', entryBody()).expect(403);
      await as(commonToken).put('/platform-finance/settings', { monthlyGoalCents: 1 }).expect(403);
      assert.equal(await prisma.ledgerEntry.count(), 0);
      assert.equal(await prisma.transparencySetting.count(), 0);
      for (const code of [
        'PLATFORM_FINANCE_ENTRY_CREATE', 'PLATFORM_FINANCE_ENTRY_UPDATE', 'PLATFORM_FINANCE_ENTRY_DELETE', 'PLATFORM_FINANCE_MONTH_PUBLISH',
        'PLATFORM_FINANCE_MONTH_UNPUBLISH', 'PLATFORM_FINANCE_SETTINGS_UPDATE', 'PLATFORM_FINANCE_EXPORT',
      ]) {
        assert.ok(AUDIT_ACTION_CODES.includes(code), code);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('configurações', () => {
    it('GET padrão; PUT parcial do super admin (trim, vazio = null, inteiros 0..1e9); inválidos = 400; auditoria sem texto', async () => {
      const empty = (await as(commonToken).get('/platform-finance/settings').expect(200)).body;
      assert.deepEqual(empty, {
        monthlyGoalCents: 0, openingReserveCents: 0, entityName: null, introText: null, surplusText: null, updatedAt: null, updatedByUserId: null,
      });
      const saved = (
        await as(superToken)
          .put('/platform-finance/settings', {
            monthlyGoalCents: 300000,
            openingReserveCents: 100000,
            entityName: '  Associação Ginga Aberta  ',
            introText: 'A plataforma é gratuita. Aqui você vê quanto custa e de onde vem o dinheiro.',
            surplusText: 'O que sobra vira reserva para os meses mais apertados.',
          })
          .expect(200)
      ).body;
      assert.equal(saved.monthlyGoalCents, 300000);
      assert.equal(saved.openingReserveCents, 100000);
      assert.equal(saved.entityName, 'Associação Ginga Aberta');
      assert.equal(saved.updatedByUserId, superUserId);
      // parcial: so o introText muda (vazio = null); o resto fica
      const partial = (await as(superToken).put('/platform-finance/settings', { introText: '   ' }).expect(200)).body;
      assert.equal(partial.introText, null);
      assert.equal(partial.monthlyGoalCents, 300000);
      assert.equal(partial.surplusText, saved.surplusText);
      await as(superToken).put('/platform-finance/settings', { introText: saved.introText }).expect(200);

      for (const bad of [
        { monthlyGoalCents: -1 },
        { monthlyGoalCents: 10.5 },
        { monthlyGoalCents: '300000' },
        { monthlyGoalCents: 1_000_000_001 },
        { openingReserveCents: -100 },
        { openingReserveCents: null },
        { entityName: 'x'.repeat(121) },
        { introText: 'x'.repeat(601) },
        { surplusText: 'x'.repeat(601) },
        { qualquer: 1 },
      ]) {
        const res = await as(superToken).put('/platform-finance/settings', bad);
        assert.equal(res.status, 400, `${JSON.stringify(bad)} -> ${res.status}`);
      }
      const reread = (await as(commonToken).get('/platform-finance/settings').expect(200)).body;
      assert.equal(reread.monthlyGoalCents, 300000);
      assert.equal(reread.openingReserveCents, 100000);

      const audits = await prisma.auditLog.findMany({ where: { action: 'PLATFORM_FINANCE_SETTINGS_UPDATE', userId: superUserId }, orderBy: { id: 'asc' } });
      assert.equal(audits.length, 3);
      for (const a of audits) {
        const text = JSON.stringify(a.metadata);
        assert.ok(!text.includes('Associação') && !text.includes('gratuita') && !text.includes('reserva para'), text);
        assert.equal(a.organizationId, null);
      }
      assert.deepEqual((audits[0].metadata as { fields: string[] }).fields.sort(), ['entityName', 'introText', 'monthlyGoalCents', 'openingReserveCents', 'surplusText']);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  const ids: Record<string, number> = {};

  describe('lançamentos', () => {
    it('validações: par tipo×categoria, centavos inteiros, data (real, não além do fim do mês corrente), descrição, campos extras', async () => {
      const cases: Array<[Record<string, unknown>, string | null]> = [
        [{ type: 'RECEITA', category: 'HOSPEDAGEM' }, 'INVALID_CATEGORY'],
        [{ type: 'DESPESA', category: 'PATROCINIO' }, 'INVALID_CATEGORY'],
        [{ category: 'XPTO' }, null],
        [{ type: 'ENTRADA' }, null],
        [{ amountCents: 10.5 }, null],
        [{ amountCents: 0 }, null],
        [{ amountCents: -100 }, null],
        [{ amountCents: '1000' }, null],
        [{ amountCents: 1_000_000_001 }, null],
        [{ occurredOn: `${addMonths(CUR, 1)}-01` }, 'FUTURE_DATE'],
        [{ occurredOn: `${addMonths(CUR, 12)}-15` }, 'FUTURE_DATE'],
        [{ occurredOn: '2026-02-30' }, 'VALIDATION'],
        [{ occurredOn: '1999-12-31' }, 'VALIDATION'],
        [{ occurredOn: '15/10/2026' }, null],
        [{ occurredOn: '2026-10-15T10:00:00Z' }, null],
        [{ description: '    ' }, 'VALIDATION'],
        [{ description: 'x'.repeat(301) }, 'VALIDATION'],
        [{ month: M1 }, null], // o mes e derivado no servidor: o cliente nao o envia
        [{ createdByUserId: 1 }, null],
      ];
      for (const [over, code] of cases) {
        const res = await as(superToken).post('/platform-finance/entries', entryBody(over));
        assert.equal(res.status, 400, `${JSON.stringify(over)} -> ${res.status} ${JSON.stringify(res.body)}`);
        if (code) assert.equal(res.body.code, code, JSON.stringify(over));
      }
      assert.equal(await prisma.ledgerEntry.count(), 0);
    });

    it('cria (201) com mês derivado de occurredOn, rótulo e locked=false; fim do mês corrente é aceito', async () => {
      const lastDay = new Date(Date.UTC(Number(CUR.slice(0, 4)), Number(CUR.slice(5, 7)), 0)).getUTCDate();
      const created = await createEntry({ occurredOn: `${CUR}-${String(lastDay).padStart(2, '0')}`, amountCents: 4321, category: 'DOMINIO' });
      assert.deepEqual(Object.keys(created).sort(), ['amountCents', 'category', 'categoryLabel', 'createdAt', 'description', 'id', 'locked', 'month', 'occurredOn', 'type']);
      assert.equal(created.month, CUR);
      assert.equal(created.categoryLabel, 'Domínio');
      assert.equal(created.locked, false);
      assert.equal(created.amountCents, 4321);
      assert.equal(created.description, `${TAG} ${SENTINEL}`);
      ids.current = created.id;
      const row = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(row.createdByUserId, superUserId);
      assert.equal(row.month, CUR);

      // M2: despesa 150000 (120000 + 30000), receita 200000
      ids.m2Host = (await createEntry({ occurredOn: `${M2}-05`, category: 'HOSPEDAGEM', amountCents: 120000 })).id;
      ids.m2Maps = (await createEntry({ occurredOn: `${M2}-20`, category: 'MAPAS', amountCents: 30000 })).id;
      ids.m2Spons = (await createEntry({ type: 'RECEITA', occurredOn: `${M2}-10`, category: 'PATROCINIO', amountCents: 200000 })).id;
      // M1: o exemplo do contrato (receita 280000, despesa 250000)
      ids.m1Host = (await createEntry({ occurredOn: `${M1}-03`, category: 'HOSPEDAGEM', amountCents: 150000 })).id;
      ids.m1Mail = (await createEntry({ occurredOn: `${M1}-04`, category: 'EMAIL', amountCents: 20000 })).id;
      ids.m1People = (await createEntry({ occurredOn: `${M1}-28`, category: 'PESSOAS_SUPORTE', amountCents: 80000 })).id;
      ids.m1Spons = (await createEntry({ type: 'RECEITA', occurredOn: `${M1}-11`, category: 'PATROCINIO', amountCents: 230000 })).id;
      ids.m1Apoio = (await createEntry({ type: 'RECEITA', occurredOn: `${M1}-12`, category: 'APOIO', amountCents: 50000 })).id;
    });

    it('lista: filtros mês/tipo/categoria/q, ordem occurredOn desc + id desc, X-Total-Count, limit/offset', async () => {
      const all = await as(commonToken).get('/platform-finance/entries').expect(200);
      assert.equal(all.headers['x-total-count'], '9');
      const days = all.body.map((e: { occurredOn: string }) => e.occurredOn);
      assert.deepEqual(days, [...days].sort().reverse());
      const m1 = await as(commonToken).get(`/platform-finance/entries?month=${M1}`).expect(200);
      assert.equal(m1.headers['x-total-count'], '5');
      assert.ok(m1.body.every((e: { month: string }) => e.month === M1));
      const rec = await as(commonToken).get(`/platform-finance/entries?month=${M1}&type=RECEITA`).expect(200);
      assert.deepEqual(rec.body.map((e: { id: number }) => e.id).sort(), [ids.m1Spons, ids.m1Apoio].sort());
      const cat = await as(commonToken).get('/platform-finance/entries?category=HOSPEDAGEM').expect(200);
      assert.deepEqual(cat.body.map((e: { id: number }) => e.id), [ids.m1Host, ids.m2Host]);
      const q = await as(commonToken).get(`/platform-finance/entries?q=${encodeURIComponent(stamp)}`).expect(200);
      assert.equal(q.headers['x-total-count'], '9');
      const none = await as(commonToken).get('/platform-finance/entries?q=nao-existe-xyz').expect(200);
      assert.deepEqual(none.body, []);
      const page = await as(commonToken).get('/platform-finance/entries?limit=2&offset=1').expect(200);
      assert.equal(page.body.length, 2);
      assert.equal(page.body[0].id, all.body[1].id);
      await as(commonToken).get('/platform-finance/entries?month=2026-13').expect(400);
      await as(commonToken).get('/platform-finance/entries?type=OUTRO').expect(400);
    });

    it('PATCH parcial (par validado com o valor atual), 404 inexistente; DELETE 204/404; auditoria sem a description', async () => {
      const bad = await as(superToken).patch(`/platform-finance/entries/${ids.current}`, { type: 'RECEITA' }).expect(400);
      assert.equal(bad.body.code, 'INVALID_CATEGORY');
      await as(superToken).patch(`/platform-finance/entries/${ids.current}`, { amountCents: 1.5 }).expect(400);
      await as(superToken).patch(`/platform-finance/entries/${ids.current}`, { description: null }).expect(400);
      await as(superToken).patch(`/platform-finance/entries/${ids.current}`, { occurredOn: `${addMonths(CUR, 1)}-01` }).expect(400);
      const ok = (await as(superToken).patch(`/platform-finance/entries/${ids.current}`, { type: 'RECEITA', category: 'EDITAIS_OUTROS', amountCents: 999 }).expect(200)).body;
      assert.equal(ok.type, 'RECEITA');
      assert.equal(ok.category, 'EDITAIS_OUTROS');
      assert.equal(ok.amountCents, 999);
      assert.equal(ok.description, `${TAG} ${SENTINEL}`, 'campo ausente não muda');
      await as(superToken).patch('/platform-finance/entries/999999999', { amountCents: 5 }).expect(404);
      await as(superToken).patch('/platform-finance/entries/abc', { amountCents: 5 }).expect(400);
      await as(superToken).del('/platform-finance/entries/999999999').expect(404);

      const temp = await createEntry({ occurredOn: `${CUR}-02`, amountCents: 77 });
      await as(superToken).del(`/platform-finance/entries/${temp.id}`).expect(204);
      await as(superToken).del(`/platform-finance/entries/${temp.id}`).expect(404);
      const audits = await prisma.auditLog.findMany({ where: { resource: 'ledger_entry', resourceId: { in: [String(ids.current), String(temp.id)] } }, orderBy: { id: 'asc' } });
      assert.deepEqual(audits.map((a) => a.action), ['PLATFORM_FINANCE_ENTRY_CREATE', 'PLATFORM_FINANCE_ENTRY_UPDATE', 'PLATFORM_FINANCE_ENTRY_CREATE', 'PLATFORM_FINANCE_ENTRY_DELETE']);
      const upd = audits[1].metadata as Record<string, unknown>;
      assert.deepEqual(upd.fields, ['type', 'category', 'amountCents']);
      assert.equal(upd.previousAmountCents, 4321);
      assert.equal(audits[3].metadata && (audits[3].metadata as Record<string, unknown>).amountCents, 77);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  let capturedPublic: Record<string, unknown> | null = null;

  describe('publicação, congelamento e corpo público', () => {
    it('MONTH_NOT_CLOSED (corrente/futuro), formato inválido = 400, MONTH_EMPTY, publicar 2x = 409', async () => {
      for (const m of [CUR, addMonths(CUR, 1)]) {
        const res = await as(superToken).post(`/platform-finance/months/${m}/publish`).expect(400);
        assert.equal(res.body.code, 'MONTH_NOT_CLOSED', m);
      }
      for (const m of ['2026-13', 'abc', '2026-1']) await as(superToken).post(`/platform-finance/months/${m}/publish`).expect(400);
      const empty = await as(superToken).post(`/platform-finance/months/${M3}/publish`).expect(400);
      assert.equal(empty.body.code, 'MONTH_EMPTY');
      await as(superToken).post(`/platform-finance/months/${M2}/publish`, { note: 'x'.repeat(501) }).expect(400);
      await as(superToken).post(`/platform-finance/months/${M2}/publish`, { extra: 1 }).expect(400);

      const studentsNow = await countActiveStudents(prisma);
      const groupsNow = await countActiveGroups(prisma);
      const pubM2 = (await as(superToken).post(`/platform-finance/months/${M2}/publish`, { note: '  Primeiro mês publicado.  ' }).expect(201)).body;
      assert.equal(pubM2.month, M2);
      assert.equal(pubM2.published, true);
      assert.equal(pubM2.note, 'Primeiro mês publicado.');
      assert.equal(pubM2.revenueCents, 200000);
      assert.equal(pubM2.expenseCents, 150000);
      assert.equal(pubM2.balanceCents, 50000);
      assert.equal(pubM2.entries, 3);
      assert.deepEqual(pubM2.snapshot, { activeStudents: studentsNow, activeGroups: groupsNow, goalCents: 300000 });
      assert.equal(pubM2.liveActiveStudents, null);
      const again = await as(superToken).post(`/platform-finance/months/${M2}/publish`).expect(409);
      assert.equal(again.body.code, 'MONTH_PUBLISHED');
    });

    it('concorrência: 2 publicações simultâneas do mesmo mês = 1 × 201 + 1 × 409; uma linha só', async () => {
      const [a, b] = await Promise.all([
        as(superToken).post(`/platform-finance/months/${M1}/publish`, { note: 'Mês com patrocínio e apoio.' }),
        as(superToken).post(`/platform-finance/months/${M1}/publish`, { note: 'Mês com patrocínio e apoio.' }),
      ]);
      assert.deepEqual([a.status, b.status].sort(), [201, 409], `${a.status}/${b.status}`);
      const loser = a.status === 409 ? a : b;
      assert.equal(loser.body.code, 'MONTH_PUBLISHED');
      assert.equal(await prisma.transparencyMonth.count({ where: { month: M1 } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { action: 'PLATFORM_FINANCE_MONTH_PUBLISH', resourceId: M1 } }), 1);
    });

    it('mês publicado é congelado: criar, editar, mover para/desde e excluir = 409 MONTH_PUBLISHED; lista mostra locked', async () => {
      const attempts = [
        () => as(superToken).post('/platform-finance/entries', entryBody({ occurredOn: `${M1}-15` })),
        () => as(superToken).patch(`/platform-finance/entries/${ids.m1Host}`, { amountCents: 1 }),
        () => as(superToken).patch(`/platform-finance/entries/${ids.m1Host}`, { description: `${TAG} outra` }),
        () => as(superToken).patch(`/platform-finance/entries/${ids.m1Host}`, { occurredOn: `${CUR}-01` }), // mover PARA FORA
        () => as(superToken).patch(`/platform-finance/entries/${ids.current}`, { occurredOn: `${M1}-02` }), // mover PARA DENTRO
        () => as(superToken).patch(`/platform-finance/entries/${ids.current}`, { occurredOn: `${M2}-02` }),
        () => as(superToken).del(`/platform-finance/entries/${ids.m1Host}`),
        () => as(superToken).del(`/platform-finance/entries/${ids.m2Maps}`),
      ];
      for (const [i, attempt] of attempts.entries()) {
        const res = await attempt();
        assert.equal(res.status, 409, `tentativa ${i} -> ${res.status} ${JSON.stringify(res.body)}`);
        assert.equal(res.body.code, 'MONTH_PUBLISHED', `tentativa ${i}`);
      }
      const host = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: ids.m1Host } });
      assert.equal(host.amountCents, 150000);
      assert.equal(host.month, M1);
      assert.equal((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: ids.current } })).month, CUR);
      assert.equal(await prisma.ledgerEntry.count({ where: { month: M1 } }), 5);
      const list = (await as(commonToken).get('/platform-finance/entries?limit=200').expect(200)).body as Array<{ month: string; locked: boolean }>;
      for (const e of list) assert.equal(e.locked, e.month === M1 || e.month === M2, `${e.month} locked=${e.locked}`);
    });

    it('GET /transparency com 2 meses publicados: números, reserva, custo por aluno, % da meta, ordem; PROVA de privacidade; = preview', async () => {
      const res = await pub().expect(200);
      assert.equal(res.headers['cache-control'], 'public, max-age=300');
      assert.equal(res.headers['set-cookie'], undefined);
      const body = res.body as Record<string, any>;
      assertPublicShape(body, res.text);
      assert.equal(body.entityName, 'Associação Ginga Aberta');
      assert.equal(body.monthlyGoalCents, 300000);
      // reserva = 100000 + (200000 - 150000) + (280000 - 250000)
      assert.equal(body.reserveCents, 180000);
      assert.deepEqual(body.months.map((m: { month: string }) => m.month), [M1, M2]);
      const [m1, m2] = body.months;
      assert.equal(m1.revenueCents, 280000);
      assert.equal(m1.expenseCents, 250000);
      assert.equal(m1.balanceCents, 30000);
      assert.equal(m1.note, 'Mês com patrocínio e apoio.');
      assert.deepEqual(m1.revenueBySource, [
        { category: 'PATROCINIO', label: 'Patrocínios', cents: 230000 },
        { category: 'APOIO', label: 'Apoio de usuários', cents: 50000 },
      ]);
      assert.deepEqual(m1.expensesByCategory.map((c: { category: string }) => c.category), ['HOSPEDAGEM', 'PESSOAS_SUPORTE', 'EMAIL']);
      assert.equal(m1.expensesByCategory[0].label, 'Hospedagem e servidores');
      const snap = await prisma.transparencyMonth.findUniqueOrThrow({ where: { month: M1 } });
      assert.equal(m1.activeStudents, snap.activeStudents);
      assert.equal(m1.activeGroups, snap.activeGroups);
      assert.equal(m1.costPerActiveStudentCents, snap.activeStudents > 0 ? Math.round(250000 / snap.activeStudents) : null);
      assert.equal(m1.goalCents, 300000);
      assert.equal(m1.goalCoveragePct, 93);
      assert.equal(m2.goalCoveragePct, 67);
      assert.equal(m2.publishedAt, (await prisma.transparencyMonth.findUniqueOrThrow({ where: { month: M2 } })).publishedAt.toISOString());
      capturedPublic = body;

      // previa do admin = exatamente o corpo publico (a menos do generatedAt)
      const preview = (await as(commonToken).get('/platform-finance/preview').expect(200)).body;
      assert.deepEqual({ ...preview, generatedAt: null }, { ...body, generatedAt: null });

      if (process.env.TRANSPARENCY_CAPTURE_DIR) {
        const months = await as(commonToken).get('/platform-finance/months').expect(200);
        await fs.mkdir(process.env.TRANSPARENCY_CAPTURE_DIR, { recursive: true });
        await fs.writeFile(path.join(process.env.TRANSPARENCY_CAPTURE_DIR, 'transparency-real-public.json'), `${JSON.stringify(body, null, 2)}\n`, 'utf8');
        await fs.writeFile(path.join(process.env.TRANSPARENCY_CAPTURE_DIR, 'transparency-real-months.json'), `${JSON.stringify(months.body, null, 2)}\n`, 'utf8');
        console.log(`[captura] JSON real gravado em ${process.env.TRANSPARENCY_CAPTURE_DIR}`);
      }
    });

    it('GET /platform-finance/months: janela 24 meses + corrente, desc; ao vivo x retrato; mesmo critério do platform-dashboard (SSOT)', async () => {
      const body = (await as(commonToken).get('/platform-finance/months').expect(200)).body;
      assert.deepEqual(Object.keys(body), ['items']);
      assert.deepEqual(body.items.map((m: { month: string }) => m.month), [CUR, M1, M2]);
      const [cur, m1, m2] = body.items;
      const dash = (await as(commonToken).get('/platform-dashboard').expect(200)).body;
      assert.equal(cur.published, false);
      assert.equal(cur.snapshot, null);
      assert.equal(cur.liveActiveStudents, dash.students.active, 'mesmo critério de alunos ativos do dashboard');
      assert.equal(cur.liveActiveGroups, dash.organizations.active, 'mesmo critério de grupos ativos do dashboard');
      assert.equal(cur.entries, 1);
      assert.equal(m1.published, true);
      assert.equal(m1.liveActiveStudents, null);
      assert.equal(m1.entries, 5);
      assert.equal(m1.revenueCents, 280000);
      assert.deepEqual(m1.revenueByCategory.map((c: { category: string }) => c.category), ['PATROCINIO', 'APOIO']);
      assert.equal(m2.note, 'Primeiro mês publicado.');
      for (const item of body.items) {
        assert.deepEqual(Object.keys(item).sort(), [
          'balanceCents', 'entries', 'expenseCents', 'expensesByCategory', 'liveActiveGroups', 'liveActiveStudents', 'month', 'note',
          'published', 'publishedAt', 'revenueByCategory', 'revenueCents', 'snapshot',
        ]);
      }
      assert.ok(!JSON.stringify(body).includes('SENTINELA'), 'months traz só somas, nunca descriptions');
    });

    it('retrato imutável: mudar a meta e ganhar aluno ativo depois NÃO altera o mês publicado (o corrente segue ao vivo)', async () => {
      const before = capturedPublic as Record<string, any>;
      await as(superToken).put('/platform-finance/settings', { monthlyGoalCents: 500000 }).expect(200);
      const liveBefore = await countActiveStudents(prisma);
      await prisma.student.create({ data: { organizationId: orgId, name: `${TAG} aluno ativo novo`, status: 'ACTIVE' } });
      const body = (await pub().expect(200)).body;
      assert.equal(body.monthlyGoalCents, 500000, 'a meta vigente (topo) muda');
      for (const i of [0, 1]) {
        assert.equal(body.months[i].goalCents, 300000, 'o retrato não muda');
        assert.equal(body.months[i].activeStudents, before.months[i].activeStudents);
        assert.equal(body.months[i].activeGroups, before.months[i].activeGroups);
        assert.equal(body.months[i].costPerActiveStudentCents, before.months[i].costPerActiveStudentCents);
        assert.equal(body.months[i].goalCoveragePct, before.months[i].goalCoveragePct);
      }
      const months = (await as(commonToken).get('/platform-finance/months').expect(200)).body.items;
      assert.equal(months[0].liveActiveStudents, liveBefore + 1, 'mês corrente: ao vivo');
      assert.equal(months[1].snapshot.goalCents, 300000);
    });

    it('meta 0 = goalCoveragePct null; 0 alunos no retrato = costPerActiveStudentCents null; cobertura > 100', async () => {
      await as(superToken).put('/platform-finance/settings', { monthlyGoalCents: 0 }).expect(200);
      await createEntry({ occurredOn: `${M3}-09`, category: 'FERRAMENTAS', amountCents: 5000 });
      await createEntry({ type: 'RECEITA', occurredOn: `${M3}-09`, category: 'EDITAIS_OUTROS', amountCents: 9000 });
      const m3 = (await as(superToken).post(`/platform-finance/months/${M3}/publish`).expect(201)).body;
      assert.equal(m3.snapshot.goalCents, 0);
      // o banco de dev sempre tem alunos ativos: o retrato com 0 alunos e forcado direto na linha (o servico le o retrato)
      await prisma.transparencyMonth.update({ where: { month: M3 }, data: { activeStudents: 0 } });
      let body = (await pub().expect(200)).body;
      const pm3 = body.months.find((m: { month: string }) => m.month === M3);
      assert.equal(pm3.goalCoveragePct, null);
      assert.equal(pm3.costPerActiveStudentCents, null);
      assert.equal(pm3.activeStudents, 0);
      // reserva soma os 3 meses publicados
      assert.equal(body.reserveCents, 180000 + 4000);
      // cobertura acima de 100%
      await prisma.transparencyMonth.update({ where: { month: M3 }, data: { goalCents: 3000 } });
      body = (await pub().expect(200)).body;
      assert.equal(body.months.find((m: { month: string }) => m.month === M3).goalCoveragePct, 300);
    });

    it('despublicar: 204 + auditado; de novo = 409 MONTH_NOT_PUBLISHED; o mês some do público e volta a editar', async () => {
      await as(superToken).post(`/platform-finance/months/${M3}/unpublish`).expect(204);
      const again = await as(superToken).post(`/platform-finance/months/${M3}/unpublish`).expect(409);
      assert.equal(again.body.code, 'MONTH_NOT_PUBLISHED');
      await as(superToken).post('/platform-finance/months/abc/unpublish').expect(400);
      const body = (await pub().expect(200)).body;
      assert.deepEqual(body.months.map((m: { month: string }) => m.month), [M1, M2], 'só mês publicado é público');
      assert.equal(body.reserveCents, 180000);
      assert.equal(await prisma.auditLog.count({ where: { action: 'PLATFORM_FINANCE_MONTH_UNPUBLISH', resourceId: M3 } }), 1);
      const entry = await createEntry({ occurredOn: `${M3}-20`, amountCents: 100 });
      await as(superToken).patch(`/platform-finance/entries/${entry.id}`, { amountCents: 200 }).expect(200);
      await as(superToken).del(`/platform-finance/entries/${entry.id}`).expect(204);
    });

    it('só 12 meses no público (do mais recente ao mais antigo); a reserva soma TODOS os publicados (13)', async () => {
      await as(superToken).put('/platform-finance/settings', { monthlyGoalCents: 300000 }).expect(200);
      // M3 ja tem 5000 de despesa e 9000 de receita; os meses 4..13 ganham 1000 de despesa cada
      for (const m of LAST13.slice(3)) await createEntry({ occurredOn: `${m}-10`, category: 'OUTROS_DESPESA', amountCents: 1000 });
      for (const m of LAST13.slice(2)) await as(superToken).post(`/platform-finance/months/${m}/publish`).expect(201);
      const res = await pub().expect(200);
      const body = res.body;
      assertPublicShape(body, res.text);
      assert.equal(body.months.length, 12);
      assert.deepEqual(body.months.map((m: { month: string }) => m.month), LAST13.slice(0, 12));
      assert.ok(!body.months.some((m: { month: string }) => m.month === LAST13[12]), 'o 13o mês fica fora da lista');
      // 100000 + 50000 + 30000 + 4000 (M3) - 10 x 1000 (meses 4..13, o 13o incluido)
      assert.equal(body.reserveCents, 100000 + 50000 + 30000 + 4000 - 10 * 1000);
      // reserva negativa: abertura 0 e um mes muito deficitario
      await as(superToken).put('/platform-finance/settings', { openingReserveCents: 0 }).expect(200);
      await as(superToken).post(`/platform-finance/months/${LAST13[12]}/unpublish`).expect(204);
      await createEntry({ occurredOn: `${LAST13[12]}-11`, category: 'IMPOSTOS_TARIFAS', amountCents: 500000 });
      await as(superToken).post(`/platform-finance/months/${LAST13[12]}/publish`).expect(201);
      const neg = (await pub().expect(200)).body;
      assert.equal(neg.reserveCents, 50000 + 30000 + 4000 - 10 * 1000 - 500000);
      assert.ok(neg.reserveCents < 0);
      // a varredura de privacidade vale para o JSON inteiro, com 13 meses publicados
      assert.ok(!JSON.stringify(neg).includes('SENTINELA'));
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('CSV, auditoria, log e throttle', () => {
    it('CSV: BOM, ";", cabeçalho, valores em reais, description só no admin, anti formula-injection', async () => {
      // (o servidor apara espacos/TAB nas pontas da description, entao o gatilho e o primeiro caractere util)
      const formulas = ['=HYPERLINK("http://mal.example","clique")', '+SOMA(1;2)', '-2+3', '@cmd', '  =1+1'];
      for (const f of formulas) await createEntry({ occurredOn: `${CUR}-03`, category: 'FERRAMENTAS', amountCents: 1234, description: `${f} ${TAG}` });
      const res = await as(commonToken).get(`/platform-finance/entries.csv?month=${CUR}`).buffer(true).expect(200);
      assert.match(res.headers['content-type'], /^text\/csv; charset=utf-8/);
      assert.match(res.headers['content-disposition'], new RegExp(`attachment; filename="financeiro-plataforma-${CUR}-\\d{4}-\\d{2}-\\d{2}\\.csv"`));
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.equal(res.headers['x-total-count'], String(1 + formulas.length));
      const text = res.text;
      assert.ok(text.startsWith('﻿'), 'UTF-8 com BOM');
      const lines = text.slice(1).split('\r\n').filter(Boolean);
      assert.equal(lines[0], 'Id;Data;Mês;Tipo;Categoria;Valor (R$);Descrição;Mês publicado');
      assert.equal(lines.length, 1 + 1 + formulas.length);
      assert.ok(text.includes(';12,34;'), 'valor em reais');
      assert.ok(text.includes(`"'=HYPERLINK(""http://mal.example"",""clique"") ${TAG}"`), text);
      assert.ok(text.includes(`"'+SOMA(1;2) ${TAG}"`), text);
      assert.ok(text.includes(`'-2+3 ${TAG}`));
      assert.ok(text.includes(`'@cmd ${TAG}`));
      assert.ok(text.includes(`'=1+1 ${TAG}`));
      for (const line of lines.slice(1)) {
        const description = line.split(';')[6] ?? '';
        assert.ok(!/^"?[=+\-@\t]/.test(description), `célula de fórmula sem apóstrofo: ${line}`);
      }
      assert.ok(text.includes('SENTINELA'), 'a description é privada do ADMIN (aparece no CSV da equipe)');
      const all = await as(commonToken).get('/platform-finance/entries.csv').buffer(true).expect(200);
      assert.match(all.headers['content-disposition'], /financeiro-plataforma-todos-/);
      await as(commonToken).get('/platform-finance/entries.csv?month=xx').expect(400);
      assert.ok((await prisma.auditLog.count({ where: { action: 'PLATFORM_FINANCE_EXPORT', userId: { in: userIds } } })) >= 2);
    });

    it('auditoria: toda escrita auditada, organizationId nulo, meta só com chaves permitidas, NENHUM texto de description', async () => {
      const rows = await prisma.auditLog.findMany({ where: { userId: { in: userIds }, action: { startsWith: 'PLATFORM_FINANCE_' } } });
      const byAction = (a: string) => rows.filter((r) => r.action === a).length;
      assert.ok(byAction('PLATFORM_FINANCE_ENTRY_CREATE') >= 25, `creates: ${byAction('PLATFORM_FINANCE_ENTRY_CREATE')}`);
      assert.ok(byAction('PLATFORM_FINANCE_ENTRY_UPDATE') >= 2);
      assert.ok(byAction('PLATFORM_FINANCE_ENTRY_DELETE') >= 2);
      assert.ok(byAction('PLATFORM_FINANCE_MONTH_PUBLISH') >= 14);
      assert.ok(byAction('PLATFORM_FINANCE_MONTH_UNPUBLISH') >= 2);
      const ALLOWED = new Set([
        'month', 'previousMonth', 'type', 'category', 'amountCents', 'previousAmountCents', 'fields', 'entries', 'revenueCents',
        'expenseCents', 'activeStudents', 'activeGroups', 'goalCents', 'hasNote', 'publishedAt', 'monthlyGoalCents',
        'openingReserveCents', 'rows', 'total',
      ]);
      for (const r of rows) {
        assert.equal(r.organizationId, null, r.action);
        for (const k of Object.keys((r.metadata ?? {}) as object)) assert.ok(ALLOWED.has(k), `${r.action}: chave ${k}`);
      }
      // varredura textual da trilha inteira: nem sentinela, nem TAG das descriptions, nem notas, nem textos das configuracoes
      // (so as linhas dos usuarios deste spec: o banco de dev tem a trilha de outros specs)
      const scan = (needle: string) =>
        prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*)::bigint AS n FROM "AuditLog" WHERE "userId" = ANY($2::int[]) AND row_to_json("AuditLog")::text LIKE $1`,
          `%${needle}%`,
          userIds,
        );
      for (const needle of ['SENTINELA', stamp, TAG, 'HYPERLINK', 'SOMA', 'patrocínio e apoio', 'Primeiro mês', 'Associação', 'gratuita']) {
        assert.equal(Number((await scan(needle))[0].n), 0, `AuditLog contém ${needle}`);
      }
      // controle positivo: a varredura acha o que existe
      assert.ok(Number((await scan('PLATFORM_FINANCE_ENTRY_CREATE'))[0].n) >= 25);
    });

    it('GET /transparency: não audita, log de requisição SEM userId/ip (rota real), throttle 429 por IP', async () => {
      // marco por id (os testes anteriores gravam auditoria no mesmo segundo: createdAt nao serve de marco)
      const lastAuditId = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? 0;
      const captured: string[] = [];
      const out = process.stdout.write.bind(process.stdout);
      process.env.REQUEST_LOG = 'true';
      process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
        captured.push(String(chunk));
        return (out as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof process.stdout.write;
      try {
        await pub().set('X-Forwarded-For', '198.51.100.88').set('User-Agent', `UA-${stamp}`).expect(200);
        await pub().set(auth(superToken)).expect(200);
        await as(commonToken).get('/platform-finance/months').expect(200);
      } finally {
        process.stdout.write = out as typeof process.stdout.write;
        process.env.REQUEST_LOG = envBackup.REQUEST_LOG ?? 'false';
      }
      const lines = (captured.join('').match(/\{"ts":"[^\n]*?"msg":"http_request"[^\n]*?\}(?=\n|$)/g) ?? []).map((l) => JSON.parse(l));
      const publicLines = lines.filter((l) => l.route === '/api/transparency');
      assert.equal(publicLines.length, 2, JSON.stringify(lines));
      for (const l of publicLines) assert.deepEqual([l.userId, l.ip], [null, null], JSON.stringify(l));
      const adminLine = lines.find((l) => l.route === '/api/platform-finance/months');
      assert.ok(adminLine && adminLine.userId !== null, 'rotas de plataforma seguem com userId');
      assert.ok(!captured.join('').includes(`UA-${stamp}`));
      // nenhuma linha de auditoria nova por servir a pagina publica
      const audits = await prisma.auditLog.findMany({ where: { id: { gt: lastAuditId } } });
      assert.deepEqual(audits, [], JSON.stringify(audits));

      process.env.TRANSPARENCY_THROTTLE_LIMIT = '3';
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 4; i += 1) statuses.push((await pub()).status);
        assert.equal(statuses[statuses.length - 1], 429, statuses.join(','));
      } finally {
        process.env.TRANSPARENCY_THROTTLE_LIMIT = '5000';
      }
    });
  });
});
