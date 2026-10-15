import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { DEV_PASSWORD, SecondOrg, createSecondOrg, loginAs } from './utils/list-helpers';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { createTestApp } from './utils/test-app';

/** Modelos de aviso rápido: /notifications/quick-templates. Grupo PRÓPRIO; fixtures "@e2e-qtpl.local"; limpo no after(). */
const DOMAIN = '@e2e-qtpl.local';
const BASE = '/api/notifications/quick-templates';

interface View {
  id: number | string;
  title: string;
  body: string;
  emoji: string | null;
  sortOrder: number;
  builtin: boolean;
}

describe('Modelos de aviso rápido (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let org: ReportOrg;
  let orgB: SecondOrg;
  let monitor: { userId: number; token: string };
  const stamp = Date.now();

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const list = async (token: string) => (await http().get(BASE).set(auth(token)).expect(200)).body as View[];
  const create = (token: string, body: Record<string, unknown>) => http().post(BASE).set(auth(token)).send(body);

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    org = await createReportOrg(app, prisma, 'qtpl');
    orgB = await createSecondOrg(app, prisma, 'qtpl');
    const email = `monitor-${stamp}${DOMAIN}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: '[e2e-qtpl] monitor', userType: 'MEMBER', status: 'ACTIVE' },
    });
    await prisma.organizationUser.create({ data: { organizationId: org.organizationId, userId: user.id, role: OrgRole.MONITOR, status: 'ACTIVE' } });
    monitor = { userId: user.id, token: (await loginAs(app, email)).token };
  });

  after(async () => {
    await prisma.quickNoticeTemplate.deleteMany({ where: { organizationId: { in: [org.organizationId, orgB.organizationId] } } });
    await orgB.cleanup();
    await org.cleanup();
    const ids = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('professor lista: só os modelos padrão (builtin) quando o grupo não criou nenhum', async () => {
    const items = await list(org.professor.token);
    assert.equal(items.length, 6);
    assert.ok(items.every((t) => t.builtin && typeof t.id === 'string' && t.id.startsWith('builtin:')));
    assert.ok(items.every((t) => t.title.length >= 2 && t.title.length <= 80 && t.body.length >= 2 && t.body.length <= 280));
    assert.ok(items.some((t) => t.title === 'Treino cancelado por chuva' && t.emoji === '🌧️'));
  });

  it('MESTRE: cria, edita, reordena e apaga; lista traz os do grupo primeiro e os padrão depois', async () => {
    const a = (await create(org.mestre.token, { title: '  Aviso A  ', body: 'Texto do aviso A', emoji: '🔔' }).expect(201)).body as View;
    assert.equal(a.title, 'Aviso A', 'título aparado');
    assert.equal(a.builtin, false);
    assert.equal(a.emoji, '🔔');
    assert.equal(typeof a.id, 'number');
    const b = (await create(org.mestre.token, { title: 'Aviso B', body: 'Texto do aviso B' }).expect(201)).body as View;
    assert.equal(b.emoji, null);
    assert.ok(b.sortOrder > a.sortOrder, 'sem sortOrder => vai para o fim');

    const edited = (await http().patch(`${BASE}/${a.id}`).set(auth(org.mestre.token)).send({ body: 'Texto editado', emoji: '', sortOrder: 50 }).expect(200)).body as View;
    assert.equal(edited.body, 'Texto editado');
    assert.equal(edited.title, 'Aviso A', 'campo omitido não muda');
    assert.equal(edited.emoji, null, 'emoji vazio limpa');
    assert.equal(edited.sortOrder, 50);

    const items = await list(org.mestre.token);
    assert.deepEqual(items.map((t) => t.id).slice(0, 2), [b.id, a.id], 'ordenado por sortOrder');
    assert.deepEqual(items.map((t) => t.builtin), [false, false, true, true, true, true, true, true]);

    await http().delete(`${BASE}/${a.id}`).set(auth(org.mestre.token)).expect(200);
    await http().delete(`${BASE}/${b.id}`).set(auth(org.mestre.token)).expect(200);
    assert.equal(await prisma.quickNoticeTemplate.count({ where: { organizationId: org.organizationId } }), 0);
    await http().delete(`${BASE}/${a.id}`).set(auth(org.mestre.token)).expect(404);
  });

  it('professor: 403 em POST/PATCH/DELETE; MONITOR 403 até na listagem; sem token 401', async () => {
    const own = await prisma.quickNoticeTemplate.create({ data: { organizationId: org.organizationId, title: 'Do mestre', body: 'Texto do mestre' } });
    await create(org.professor.token, { title: 'Quero criar', body: 'Não pode' }).expect(403);
    await http().patch(`${BASE}/${own.id}`).set(auth(org.professor.token)).send({ title: 'Mudei' }).expect(403);
    await http().delete(`${BASE}/${own.id}`).set(auth(org.professor.token)).expect(403);
    const after1 = await prisma.quickNoticeTemplate.findUniqueOrThrow({ where: { id: own.id } });
    assert.equal(after1.title, 'Do mestre');
    assert.ok((await list(org.professor.token)).some((t) => t.id === own.id), 'professor enxerga o modelo do mestre');

    await http().get(BASE).set(auth(monitor.token)).expect(403);
    await http().get(BASE).set(auth(org.aluno.token)).expect(403);
    await http().get(BASE).expect(401);
    await prisma.quickNoticeTemplate.delete({ where: { id: own.id } });
  });

  it('isolamento entre grupos: o outro grupo não vê nem edita nem apaga (404)', async () => {
    const mine = (await create(org.mestre.token, { title: 'Só do grupo A', body: 'Texto do grupo A' }).expect(201)).body as View;
    const seenByB = await list(orgB.token);
    assert.ok(!seenByB.some((t) => t.id === mine.id), 'grupo B não vê');
    assert.equal(seenByB.length, 6);
    await http().patch(`${BASE}/${mine.id}`).set(auth(orgB.token)).send({ title: 'Invadido' }).expect(404);
    await http().delete(`${BASE}/${mine.id}`).set(auth(orgB.token)).expect(404);
    assert.equal((await prisma.quickNoticeTemplate.findUniqueOrThrow({ where: { id: mine.id } })).title, 'Só do grupo A');
    await http().delete(`${BASE}/${mine.id}`).set(auth(org.mestre.token)).expect(200);
  });

  it('modelos padrão (builtin) não são editáveis nem apagáveis (400 BUILTIN_TEMPLATE), mas podem ser duplicados via POST', async () => {
    const builtin = (await list(org.mestre.token)).find((t) => t.builtin)!;
    const patched = await http().patch(`${BASE}/${builtin.id}`).set(auth(org.mestre.token)).send({ title: 'Mudou' }).expect(400);
    assert.equal(patched.body.code, 'BUILTIN_TEMPLATE');
    const deleted = await http().delete(`${BASE}/${builtin.id}`).set(auth(org.mestre.token)).expect(400);
    assert.equal(deleted.body.code, 'BUILTIN_TEMPLATE');
    const copy = (await create(org.mestre.token, { title: builtin.title, body: builtin.body, emoji: builtin.emoji }).expect(201)).body as View;
    assert.equal(copy.builtin, false);
    assert.equal((await list(org.mestre.token)).filter((t) => t.title === builtin.title).length, 2, 'cópia + padrão');
    await http().delete(`${BASE}/${copy.id}`).set(auth(org.mestre.token)).expect(200);
  });

  it('validação do corpo e id inválido', async () => {
    const m = org.mestre.token;
    await create(m, { title: 'a', body: 'texto ok' }).expect(400);
    await create(m, { title: 'Título', body: 'b'.repeat(281) }).expect(400);
    await create(m, { title: 'x'.repeat(81), body: 'texto ok' }).expect(400);
    await create(m, { title: 'Título', body: 'texto ok', emoji: '123456789' }).expect(400);
    await create(m, { title: 'Título', body: 'texto ok', sortOrder: -1 }).expect(400);
    await create(m, { title: 'Título', body: 'texto ok', extra: 1 }).expect(400);
    await create(m, { title: 'Título' }).expect(400);
    await http().patch(`${BASE}/abc`).set(auth(m)).send({ title: 'Título' }).expect(404);
    await http().patch(`${BASE}/999999999`).set(auth(m)).send({ title: 'Título' }).expect(404);
    assert.equal(await prisma.quickNoticeTemplate.count({ where: { organizationId: org.organizationId } }), 0);
  });

  it('limite de 30 modelos por grupo (400 QUICK_TEMPLATE_LIMIT); apagar libera vaga; o outro grupo não conta', async () => {
    await prisma.quickNoticeTemplate.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({ organizationId: org.organizationId, title: `Modelo ${i}`, body: `Texto ${i}`, sortOrder: i })),
    });
    const blocked = await create(org.mestre.token, { title: 'Trigésimo primeiro', body: 'Passou do limite' }).expect(400);
    assert.equal(blocked.body.code, 'QUICK_TEMPLATE_LIMIT');
    assert.equal(await prisma.quickNoticeTemplate.count({ where: { organizationId: org.organizationId } }), 30);
    await create(orgB.token, { title: 'Grupo B livre', body: 'O outro grupo não é afetado' }).expect(201);

    const first = await prisma.quickNoticeTemplate.findFirstOrThrow({ where: { organizationId: org.organizationId } });
    await http().delete(`${BASE}/${first.id}`).set(auth(org.mestre.token)).expect(200);
    await create(org.mestre.token, { title: 'Agora cabe', body: 'Vaga liberada' }).expect(201);
    await prisma.quickNoticeTemplate.deleteMany({ where: { organizationId: org.organizationId } });
  });

  it('auditoria: ações CREATE/UPDATE/DELETE gravadas sem o texto do modelo', async () => {
    const secret = `segredo-${stamp}`;
    const t = (await create(org.mestre.token, { title: 'Auditado', body: secret }).expect(201)).body as View;
    await http().patch(`${BASE}/${t.id}`).set(auth(org.mestre.token)).send({ body: `${secret}-2` }).expect(200);
    await http().delete(`${BASE}/${t.id}`).set(auth(org.mestre.token)).expect(200);
    const logs = await prisma.auditLog.findMany({
      where: { organizationId: org.organizationId, action: { startsWith: 'QUICK_NOTICE_TEMPLATE_' }, resourceId: String(t.id) },
      orderBy: { id: 'asc' },
    });
    assert.deepEqual(logs.map((l) => l.action), ['QUICK_NOTICE_TEMPLATE_CREATE', 'QUICK_NOTICE_TEMPLATE_UPDATE', 'QUICK_NOTICE_TEMPLATE_DELETE']);
    assert.ok(!JSON.stringify(logs).includes(secret), 'o texto não vai para a auditoria');
  });
});
