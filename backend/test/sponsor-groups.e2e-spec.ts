import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import request from 'supertest';
import { SPONSOR_TERMS_VERSION } from '../src/interface/http/sponsors/sponsor-terms';
import { SponsorsService } from '../src/interface/http/sponsors/sponsors.service';
import { UploadsGcCronService } from '../src/jobs/uploads-gc-cron.service';
import { AUDIT_ACTION_CODES } from '../src/shared/audit/audit-actions';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { DEV_PASSWORD, loginAs, todaySaoPaulo } from './utils/list-helpers';
import { createPlatformUser, platformLogin } from './utils/platform-team-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Patrocinadores do GRUPO (docs/CONTRATO_PATROCINADORES_GRUPO.md): API do Mestre (termo, CRUD, ativar/pausar/retomar,
 * limites 10/10/3, states/weight, imagens do proprio grupo <= 250 KB, relatorio/CSV), isolamento entre grupos, servir ate 2
 * slides (grupo primeiro), menores, impressao/clique por escopo, supervisao da plataforma (scope=GROUP, suspender/levantar,
 * bloquear/liberar, /platform-sponsor-groups), auditoria, PROVA de privacidade, coletor de orfas, cascade e trigger.
 * Grupos, usuarios e patrocinadores PROPRIOS (nada do seed); tudo removido no after().
 */
const DOMAIN = '@e2e-sgrp.local';
const DAY = 86_400_000;
const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const APP_HOME = 'https://app.e2e.test/';

interface Member {
  userId: number;
  token: string;
  studentId?: number;
}

describe('Patrocinadores do grupo (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  let dir = '';
  let sponsorsService: SponsorsService;

  const orgIds: number[] = [];
  let orgA: number;
  let orgB: number;
  let orgL: number; // limites
  let orgAName: string;
  let mestreA: Member;
  let professorA: Member;
  let adultA: Member;
  let minorA: Member;
  let undatedA: Member;
  let guardianA: Member;
  let depMinorA: number;
  let mestreB: Member;
  let adultB: Member;
  let mestreL: Member;
  let commonToken: string;
  let superToken: string;
  let commonUserId: number;
  let superUserId: number;
  const userIds: number[] = [];
  const uploadFiles: string[] = [];
  const envBackup = { ...process.env };

  const as = (token: string) => ({
    get: (p: string) => http().get(`/api${p}`).set(auth(token)),
    post: (p: string, body?: object) => http().post(`/api${p}`).set(auth(token)).send(body ?? {}),
    patch: (p: string, body: object) => http().patch(`/api${p}`).set(auth(token)).send(body),
    del: (p: string) => http().delete(`/api${p}`).set(auth(token)),
  });
  const active = (m: Member, studentId?: number) =>
    http().get(`/api/sponsors/active${studentId ? `?studentId=${studentId}` : ''}`).set(auth(m.token));
  const impression = (m: Member, id: number, ua = BROWSER_UA, query = '') =>
    http().post(`/api/sponsors/${id}/impression${query}`).set(auth(m.token)).set('User-Agent', ua);
  const click = (id: number, query = '', ua = BROWSER_UA) => http().get(`/api/sponsors/${id}/click${query}`).set('User-Agent', ua);
  const statOf = async (campaignId: number, state: string) =>
    (await prisma.sponsorStatDay.findUnique({ where: { campaignId_day_state: { campaignId, day: todaySaoPaulo(), state } } })) ?? {
      impressions: 0,
      clicks: 0,
    };
  const totalImpressions = async (campaignId: number) =>
    (await prisma.sponsorStatDay.aggregate({ where: { campaignId }, _sum: { impressions: true } }))._sum.impressions ?? 0;
  const totalClicks = async (campaignId: number) =>
    (await prisma.sponsorStatDay.aggregate({ where: { campaignId }, _sum: { clicks: true } }))._sum.clicks ?? 0;

  const window = (startOffsetDays: number, endOffsetDays: number) => ({
    startsAt: new Date(Date.now() + startOffsetDays * DAY).toISOString(),
    endsAt: new Date(Date.now() + endOffsetDays * DAY).toISOString(),
  });
  const campaignBody = (sponsorId: number, over: Record<string, unknown> = {}) => ({
    sponsorId,
    title: `[e2e-sgrp] Campanha ${stamp}`,
    text: 'Aulas de reforço muscular com 15% para o grupo.',
    destinationUrl: 'https://www.academia-exemplo.com.br/capoeira',
    category: 'ESPORTES',
    ...window(-1, 10),
    ...over,
  });

  const png = (color: string, w = 120, h = 63) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
  /** Imagem "pesada" (ruido 1600x1000): a 1a passada do upload normal passa de 250 KB. */
  const heavyJpeg = async () => {
    const w = 1600;
    const h = 1000;
    const raw = Buffer.alloc(w * h * 3);
    let seed = 11;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
        const n = seed % 60;
        const i = (y * w + x) * 3;
        raw[i] = ((x * 255) / w + n) & 255;
        raw[i + 1] = ((y * 255) / h + n) & 255;
        raw[i + 2] = (((x + y) % 255) + n) & 255;
      }
    }
    return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  };
  const upload = async (route: '/uploads' | '/group-sponsor-uploads' | '/platform-uploads', token: string, file: Buffer, expect = 201) => {
    const res = await http().post(`/api${route}`).set(auth(token)).attach('file', file, { filename: 'img.png', contentType: 'image/png' }).expect(expect);
    if (res.body.filename) uploadFiles.push(res.body.filename);
    return res.body as { url: string; filename: string; size: number };
  };

  const makeOrg = async (tag: string, state?: string) => {
    const name = `[e2e-sgrp] Grupo ${tag} ${stamp}`;
    const id = (
      await prisma.organization.create({
        data: { name, slug: `e2e-sgrp-${tag.toLowerCase()}-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE, state },
      })
    ).id;
    orgIds.push(id);
    return { id, name };
  };
  const makeMember = async (kind: string, organizationId: number, role: OrgRole, student?: { birthDate?: string }) => {
    const email = `${kind}-${stamp}${DOMAIN}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `[e2e-sgrp] ${kind}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    userIds.push(user.id);
    await prisma.organizationUser.create({ data: { organizationId, userId: user.id, role, status: 'ACTIVE' } });
    let studentId: number | undefined;
    if (student) {
      studentId = (
        await prisma.student.create({
          data: {
            organizationId,
            userId: user.id,
            name: `[e2e-sgrp] aluno ${kind}`,
            birthDate: student.birthDate ? new Date(`${student.birthDate}T00:00:00.000Z`) : null,
          },
        })
      ).id;
    }
    return { userId: user.id, token: (await loginAs(app, email)).token, studentId };
  };

  /** Patrocinador + campanha ATIVA do grupo pelo Mestre (aceita o termo antes, se preciso). */
  const groupSponsor = async (m: Member, over: Record<string, unknown> = {}) =>
    (await as(m.token).post('/group-sponsors', { name: `[e2e-sgrp] Academia ${stamp}`, ...over }).expect(201)).body;
  const groupCampaign = async (m: Member, sponsorId: number, over: Record<string, unknown> = {}) =>
    (await as(m.token).post('/group-sponsor-campaigns', campaignBody(sponsorId, over)).expect(201)).body;
  const acceptTerms = (m: Member) => as(m.token).post('/group-sponsors/terms/accept', { version: SPONSOR_TERMS_VERSION }).expect(200);

  /** Ids que o espectador pode receber (por escopo), varrendo o sorteio com varios valores do RNG. */
  const reachable = async (m: Member, studentId?: number) => {
    const group = new Set<number>();
    const platform = new Set<number>();
    for (const r of [0, 0.2, 0.5, 0.8, 0.9999]) {
      sponsorsService.random = () => r;
      const res = await active(m, studentId).expect(200);
      assert.ok(res.body.items.length <= 2, res.text);
      assert.ok(res.body.items.filter((i: { scope: string }) => i.scope === 'GROUP').length <= 1);
      assert.ok(res.body.items.filter((i: { scope: string }) => i.scope === 'PLATFORM').length <= 1);
      if (res.body.items.length === 2) assert.equal(res.body.items[0].scope, 'GROUP', 'grupo primeiro');
      for (const item of res.body.items) (item.scope === 'GROUP' ? group : platform).add(item.id);
    }
    sponsorsService.random = Math.random;
    return { group: [...group].sort((a, b) => a - b), platform: [...platform].sort((a, b) => a - b) };
  };

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-sgrp-'));
    process.env.UPLOADS_DIR = dir;
    // Centenas de pedidos (varreduras de permissao e do sorteio): o rate limit nao e o que este spec testa
    // (os throttles de impressao/clique/upload sao provados em sponsors.e2e-spec.ts/uploads).
    app = await createTestApp({ disableThrottle: true });
    sponsorsService = app.get(SponsorsService);
    const foreign = await prisma.sponsorCampaign.count({ where: { status: 'ACTIVE', endsAt: { gt: new Date() } } });
    assert.equal(foreign, 0, 'há campanhas ATIVAS de fora deste spec no banco de dev; pause-as antes de rodar');

    const a = await makeOrg('A', 'GO');
    orgA = a.id;
    orgAName = a.name;
    orgB = (await makeOrg('B', 'SP')).id;
    orgL = (await makeOrg('L')).id;
    mestreA = await makeMember('mestre-a', orgA, OrgRole.MESTRE);
    professorA = await makeMember('professor-a', orgA, OrgRole.PROFESSOR);
    adultA = await makeMember('adulto-a', orgA, OrgRole.ALUNO, { birthDate: '1990-05-10' });
    minorA = await makeMember('menor-a', orgA, OrgRole.ALUNO, { birthDate: '2015-03-01' });
    undatedA = await makeMember('semdata-a', orgA, OrgRole.ALUNO, {});
    guardianA = await makeMember('responsavel-a', orgA, OrgRole.RESPONSAVEL);
    const dep = await prisma.student.create({
      data: { organizationId: orgA, name: '[e2e-sgrp] dependente menor', birthDate: new Date('2016-02-02T00:00:00.000Z') },
    });
    depMinorA = dep.id;
    await prisma.studentGuardian.create({ data: { organizationId: orgA, studentId: dep.id, userId: guardianA.userId, name: '[e2e-sgrp] resp' } });
    mestreB = await makeMember('mestre-b', orgB, OrgRole.MESTRE);
    adultB = await makeMember('adulto-b', orgB, OrgRole.ALUNO, { birthDate: '1988-01-01' });
    mestreL = await makeMember('mestre-l', orgL, OrgRole.MESTRE);

    const common = await createPlatformUser(prisma, 'sgrp-common');
    const superAdmin = await createPlatformUser(prisma, 'sgrp-super', { isSuperAdmin: true });
    commonUserId = common.id;
    superUserId = superAdmin.id;
    userIds.push(common.id, superAdmin.id);
    commonToken = await platformLogin(app, common.email);
    superToken = await platformLogin(app, superAdmin.email);
  });

  after(async () => {
    process.env = { ...envBackup };
    sponsorsService.random = Math.random;
    await app.close();
    const sponsors = await prisma.sponsor.findMany({
      where: { OR: [{ organizationId: { in: orgIds } }, { name: { contains: `[e2e-sgrp]` } }] },
      select: { id: true },
    });
    const sponsorIds = sponsors.map((s) => s.id);
    const campaigns = await prisma.sponsorCampaign.findMany({ where: { sponsorId: { in: sponsorIds } }, select: { id: true } });
    const campaignIds = campaigns.map((c) => c.id);
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { organizationId: { in: orgIds } },
          { resource: 'sponsor', resourceId: { in: sponsorIds.map(String) } },
          { resource: 'sponsor_campaign', resourceId: { in: campaignIds.map(String) } },
          { resource: 'upload', resourceId: { in: uploadFiles } },
        ],
      },
    });
    await prisma.sponsorCampaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.sponsor.deleteMany({ where: { id: { in: sponsorIds } } });
    await prisma.upload.deleteMany({ where: { OR: [{ filename: { in: uploadFiles } }, { userId: { in: userIds } }, { organizationId: { in: orgIds } }] } });
    await prisma.studentGuardian.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.student.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await fs.rm(dir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('permissões e termo', () => {
    it('só o MESTRE: PROFESSOR/ALUNO/RESPONSAVEL/PLATFORM = 403 em todas as rotas do Mestre; sem token = 401', async () => {
      const routes = [
        ['get', '/group-sponsors'],
        ['post', '/group-sponsors'],
        ['get', '/group-sponsors/terms'],
        ['post', '/group-sponsors/terms/accept'],
        ['get', '/group-sponsors/1'],
        ['patch', '/group-sponsors/1'],
        ['delete', '/group-sponsors/1'],
        ['get', '/group-sponsor-campaigns'],
        ['post', '/group-sponsor-campaigns'],
        ['get', '/group-sponsor-campaigns/1'],
        ['patch', '/group-sponsor-campaigns/1'],
        ['delete', '/group-sponsor-campaigns/1'],
        ['post', '/group-sponsor-campaigns/1/activate'],
        ['post', '/group-sponsor-campaigns/1/pause'],
        ['post', '/group-sponsor-campaigns/1/resume'],
        ['get', '/group-sponsor-campaigns/1/report'],
        ['get', '/group-sponsor-campaigns/1/report.csv'],
        ['post', '/group-sponsor-uploads'],
      ] as const;
      for (const [who, token] of [
        ['PROFESSOR', professorA.token],
        ['ALUNO', adultA.token],
        ['RESPONSAVEL', guardianA.token],
        ['PLATFORM', commonToken],
        ['PLATFORM super', superToken],
      ] as const) {
        for (const [method, p] of routes) {
          const c = as(token);
          const res = method === 'get' ? await c.get(p) : method === 'post' ? await c.post(p, { name: 'x' }) : method === 'patch' ? await c.patch(p, { name: 'x' }) : await c.del(p);
          assert.equal(res.status, 403, `${who} ${method} ${p} -> ${res.status}`);
        }
      }
      for (const [method, p] of routes.slice(0, 4)) {
        const res = method === 'get' ? await http().get(`/api${p}`) : await http().post(`/api${p}`).send({});
        assert.equal(res.status, 401, `anônimo ${method} ${p}`);
      }
      // Mestre de grupo NAO entra nas rotas de plataforma novas
      await as(mestreA.token).get('/platform-sponsor-groups').expect(403);
      await as(mestreA.token).post('/platform-sponsor-campaigns/1/suspend', { reason: 'abc' }).expect(403);
      await as(mestreA.token).post(`/platform-sponsor-groups/${orgA}/block`, { reason: 'abc' }).expect(403);
      for (const code of [
        'SPONSOR_GROUP_TERMS_ACCEPT', 'SPONSOR_GROUP_SPONSOR_CREATE', 'SPONSOR_GROUP_SPONSOR_UPDATE', 'SPONSOR_GROUP_SPONSOR_DELETE',
        'SPONSOR_GROUP_CAMPAIGN_CREATE', 'SPONSOR_GROUP_CAMPAIGN_UPDATE', 'SPONSOR_GROUP_CAMPAIGN_DELETE', 'SPONSOR_GROUP_CAMPAIGN_ACTIVATE',
        'SPONSOR_GROUP_CAMPAIGN_PAUSE', 'SPONSOR_GROUP_CAMPAIGN_RESUME', 'SPONSOR_CAMPAIGN_SUSPEND', 'SPONSOR_CAMPAIGN_UNSUSPEND',
        'SPONSOR_GROUP_BLOCK', 'SPONSOR_GROUP_UNBLOCK',
      ]) {
        assert.ok(AUDIT_ACTION_CODES.includes(code), code);
      }
      assert.equal(new Set(AUDIT_ACTION_CODES).size, AUDIT_ACTION_CODES.length, 'códigos únicos');
    });

    it('termo: GET mostra versão/texto; sem aceite ativar = 403 SPONSOR_TERMS_REQUIRED; versão errada = 409; aceite registra usuário/instante', async () => {
      const t0 = await as(mestreA.token).get('/group-sponsors/terms').expect(200);
      assert.deepEqual(Object.keys(t0.body).sort(), ['accepted', 'acceptedAt', 'acceptedVersion', 'blocked', 'blockedReason', 'text', 'version']);
      assert.equal(t0.body.version, SPONSOR_TERMS_VERSION);
      assert.equal(t0.body.accepted, false);
      assert.equal(t0.body.acceptedAt, null);
      assert.equal(t0.body.blocked, false);
      assert.match(t0.body.text, /revisão jurídica/);
      console.log('[exemplo] GET /group-sponsors/terms:', JSON.stringify({ ...t0.body, text: `${t0.body.text.slice(0, 120)}...` }));

      // sem aceite: cadastrar pode; ativar nao
      const s = await groupSponsor(mestreA, { name: `[e2e-sgrp] Termo ${stamp}` });
      const c = await groupCampaign(mestreA, s.id);
      const denied = await as(mestreA.token).post(`/group-sponsor-campaigns/${c.id}/activate`).expect(403);
      assert.equal(denied.body.code, 'SPONSOR_TERMS_REQUIRED');
      console.log('[exemplo] erro SPONSOR_TERMS_REQUIRED:', JSON.stringify(denied.body));
      assert.equal((await prisma.sponsorCampaign.findUniqueOrThrow({ where: { id: c.id } })).status, 'DRAFT');

      const wrong = await as(mestreA.token).post('/group-sponsors/terms/accept', { version: '1999-01-01.v0' }).expect(409);
      assert.equal(wrong.body.code, 'TERMS_VERSION_MISMATCH');
      await as(mestreA.token).post('/group-sponsors/terms/accept', {}).expect(400);
      await as(mestreA.token).post('/group-sponsors/terms/accept', { version: SPONSOR_TERMS_VERSION, extra: 1 }).expect(400);
      assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: orgA } })).sponsorTermsVersion, null, 'nada gravado');

      const before = Date.now();
      const ok = await acceptTerms(mestreA);
      assert.equal(ok.body.accepted, true);
      assert.ok(new Date(ok.body.acceptedAt).getTime() >= before - 1000);
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });
      assert.deepEqual([org.sponsorTermsVersion, org.sponsorTermsAcceptedByUserId], [SPONSOR_TERMS_VERSION, mestreA.userId]);
      // aceitar de novo nao muda o primeiro aceite
      await acceptTerms(mestreA);
      const again = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });
      assert.equal(again.sponsorTermsAcceptedAt?.getTime(), org.sponsorTermsAcceptedAt?.getTime());
      const audits = await prisma.auditLog.findMany({ where: { action: 'SPONSOR_GROUP_TERMS_ACCEPT', organizationId: orgA } });
      assert.equal(audits.length, 1);
      assert.equal(audits[0].userId, mestreA.userId);
      assert.deepEqual(audits[0].metadata, { version: SPONSOR_TERMS_VERSION, previousVersion: null });

      // versao do aceite antiga = precisa aceitar de novo
      await prisma.organization.update({ where: { id: orgA }, data: { sponsorTermsVersion: '2000-01-01.v0' } });
      assert.equal((await as(mestreA.token).get('/group-sponsors/terms').expect(200)).body.accepted, false);
      assert.equal((await as(mestreA.token).post(`/group-sponsor-campaigns/${c.id}/activate`).expect(403)).body.code, 'SPONSOR_TERMS_REQUIRED');
      await acceptTerms(mestreA);
      const on = await as(mestreA.token).post(`/group-sponsor-campaigns/${c.id}/activate`).expect(200);
      assert.equal(on.body.status, 'ACTIVE');
      assert.deepEqual(on.body.approvedBy, { id: mestreA.userId, name: '[e2e-sgrp] mestre-a' });
      await as(mestreA.token).post(`/group-sponsor-campaigns/${c.id}/pause`).expect(200);
      await as(mestreA.token).del(`/group-sponsor-campaigns/${c.id}`).expect(204);
      await as(mestreA.token).del(`/group-sponsors/${s.id}`).expect(204);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('Mestre: imagens, patrocinadores e campanhas', () => {
    it('imagens: upload do PRÓPRIO grupo vale (<= 250 KB); de plataforma/outro grupo = 400; pesada do /uploads = 400 IMAGE_TOO_LARGE; /group-sponsor-uploads reprocessa', async () => {
      const own = await upload('/uploads', mestreA.token, await png('#22aa44'));
      const viaGroupRoute = await upload('/group-sponsor-uploads', mestreA.token, await png('#2244aa'));
      const row = await prisma.upload.findUniqueOrThrow({ where: { filename: viaGroupRoute.filename } });
      assert.deepEqual([row.organizationId, row.userId], [orgA, mestreA.userId]);
      const upAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'UPLOAD_CREATE', resourceId: row.filename } });
      assert.deepEqual([upAudit.organizationId, (upAudit.metadata as { scope?: string }).scope], [orgA, 'group-sponsor']);
      const platformUp = await upload('/platform-uploads', commonToken, await png('#aa2244'));
      const otherGroup = await upload('/uploads', mestreB.token, await png('#444444'));

      const ok = await groupSponsor(mestreA, { name: `[e2e-sgrp] Img ${stamp}`, logo: own.url });
      assert.equal(ok.logo, own.url);
      for (const [label, url] of [['plataforma', platformUp.url], ['outro grupo', otherGroup.url], ['externa', 'https://cdn.x.com/a.png'], ['inexistente', '/api/uploads/00000000-0000-4000-8000-000000000000.webp']]) {
        const res = await as(mestreA.token).post('/group-sponsors', { name: `[e2e-sgrp] X ${stamp}`, logo: url }).expect(400);
        assert.equal(res.body.field, 'logo', `${label}: ${JSON.stringify(res.body)}`);
      }
      const c = await groupCampaign(mestreA, ok.id, { imageRef: viaGroupRoute.url });
      assert.equal(c.imageRef, viaGroupRoute.url);
      const badImg = await as(mestreA.token).post('/group-sponsor-campaigns', campaignBody(ok.id, { imageRef: platformUp.url })).expect(400);
      assert.equal(badImg.body.field, 'imageRef');
      await as(mestreA.token).patch(`/group-sponsor-campaigns/${c.id}`, { imageRef: otherGroup.url }).expect(400);

      // pesada: pelo /uploads normal (1 passada) fica > 250 KB => nao serve para patrocinador; pela rota do grupo cabe
      const heavy = await heavyJpeg();
      const big = await upload('/uploads', mestreA.token, heavy);
      assert.ok(big.size > 250 * 1024, `upload normal sem teto: ${big.size}`);
      const tooBig = await as(mestreA.token).patch(`/group-sponsor-campaigns/${c.id}`, { imageRef: big.url }).expect(400);
      assert.deepEqual([tooBig.body.code, tooBig.body.field], ['IMAGE_TOO_LARGE', 'imageRef']);
      const fitted = await upload('/group-sponsor-uploads', mestreA.token, heavy);
      assert.ok(fitted.size <= 250 * 1024, `reprocessada: ${fitted.size}`);
      assert.equal((await as(mestreA.token).patch(`/group-sponsor-campaigns/${c.id}`, { imageRef: fitted.url }).expect(200)).body.imageRef, fitted.url);
      // e o upload de plataforma continua exigindo plataforma: imagem do grupo como logo da plataforma = 400
      await as(commonToken).post('/platform-sponsors', { name: `[e2e-sgrp] P ${stamp}`, logo: own.url }).expect(400);
      await as(mestreA.token).del(`/group-sponsor-campaigns/${c.id}`).expect(204);
      await as(mestreA.token).del(`/group-sponsors/${ok.id}`).expect(204);
    });

    it('patrocinador: cria/lista (só do grupo, X-Total-Count)/lê/edita/exclui (409 com campanha); validações; outro grupo = 404', async () => {
      const s = await groupSponsor(mestreA, {
        name: `  [e2e-sgrp]   Loja Local ${stamp} `,
        contactName: 'Contato Sigiloso Grupo',
        contactEmail: `VENDAS-${stamp}@LOJA-LOCAL-SIGILOSA.com.br`,
        contactPhone: '+55 62 98888-4321',
        document: '98.765.432/0001-10',
        notes: 'Nota sigilosa do grupo',
      });
      assert.equal(s.name, `[e2e-sgrp] Loja Local ${stamp}`);
      assert.equal(s.organizationId, orgA);
      assert.deepEqual(s.organization, { id: orgA, name: orgAName });
      const list = await as(mestreA.token).get(`/group-sponsors?q=${encodeURIComponent(stamp)}`).expect(200);
      assert.equal(list.headers['x-total-count'], '1');
      assert.equal(list.body[0].id, s.id);
      assert.equal((await as(mestreB.token).get(`/group-sponsors?q=${encodeURIComponent(stamp)}`).expect(200)).headers['x-total-count'], '0');
      // plataforma NAO lista por padrao
      assert.ok(!(await as(commonToken).get(`/platform-sponsors?q=${encodeURIComponent(stamp)}`).expect(200)).body.some((x: { id: number }) => x.id === s.id));

      await as(mestreA.token).post('/group-sponsors', { name: 'x' }).expect(400);
      await as(mestreA.token).post('/group-sponsors', { name: '<b>Loja</b>' }).expect(400);
      await as(mestreA.token).post('/group-sponsors', { name: 'Loja', contactEmail: 'nao-e-email' }).expect(400);
      await as(mestreA.token).post('/group-sponsors', { name: 'Loja', organizationId: orgB }).expect(400);
      // mesmo valor depois de normalizar = sem mudanca (nao audita); valor novo = SPONSOR_GROUP_SPONSOR_UPDATE
      const same = await as(mestreA.token).patch(`/group-sponsors/${s.id}`, { notes: '  Nota   sigilosa do grupo ' }).expect(200);
      assert.equal(same.body.notes, 'Nota sigilosa do grupo');
      const upd = await as(mestreA.token).patch(`/group-sponsors/${s.id}`, { notes: 'Nota sigilosa do grupo, revisada', contactPhone: '' }).expect(200);
      assert.deepEqual([upd.body.notes, upd.body.contactPhone], ['Nota sigilosa do grupo, revisada', null]);

      // isolamento: o Mestre B nao ve, nao edita, nao exclui
      await as(mestreB.token).get(`/group-sponsors/${s.id}`).expect(404);
      await as(mestreB.token).patch(`/group-sponsors/${s.id}`, { name: 'Invasor' }).expect(404);
      await as(mestreB.token).del(`/group-sponsors/${s.id}`).expect(404);
      // e o patrocinador de A nao serve para campanha de B
      const bSponsor = await groupSponsor(mestreB, { name: `[e2e-sgrp] Loja B ${stamp}` });
      const cross = await as(mestreB.token).post('/group-sponsor-campaigns', campaignBody(s.id)).expect(400);
      assert.equal(cross.body.field, 'sponsorId');
      // nem patrocinador da plataforma
      const platSponsor = (await as(commonToken).post('/platform-sponsors', { name: `[e2e-sgrp] Plataforma ${stamp}` }).expect(201)).body;
      assert.equal((await as(mestreA.token).post('/group-sponsor-campaigns', campaignBody(platSponsor.id)).expect(400)).body.field, 'sponsorId');
      // e a plataforma nao cria campanha com patrocinador de grupo
      const platCross = await as(commonToken).post('/platform-sponsor-campaigns', campaignBody(s.id)).expect(400);
      assert.equal(platCross.body.field, 'sponsorId');

      const c = await groupCampaign(mestreA, s.id);
      const blocked = await as(mestreA.token).del(`/group-sponsors/${s.id}`).expect(409);
      assert.equal(blocked.body.code, 'SPONSOR_HAS_CAMPAIGNS');
      await as(mestreA.token).del(`/group-sponsor-campaigns/${c.id}`).expect(204);
      await as(mestreA.token).del(`/group-sponsors/${s.id}`).expect(204);
      await as(mestreA.token).get(`/group-sponsors/${s.id}`).expect(404);
      await as(mestreB.token).del(`/group-sponsors/${bSponsor.id}`).expect(204);
      await as(commonToken).del(`/platform-sponsors/${platSponsor.id}`).expect(204);

      // auditoria: SPONSOR_GROUP_SPONSOR_*, organizationId do grupo, sem contato/documento/notas
      const audits = await prisma.auditLog.findMany({ where: { resource: 'sponsor', resourceId: String(s.id) } });
      assert.deepEqual(audits.map((a) => a.action).sort(), ['SPONSOR_GROUP_SPONSOR_CREATE', 'SPONSOR_GROUP_SPONSOR_DELETE', 'SPONSOR_GROUP_SPONSOR_UPDATE']);
      for (const a of audits) assert.deepEqual([a.organizationId, a.userId], [orgA, mestreA.userId]);
      const text = JSON.stringify(audits);
      for (const secret of ['Contato Sigiloso', 'loja-local-sigilosa', '98888-4321', '98.765.432', 'Nota sigilosa']) {
        assert.ok(!text.includes(secret), `auditoria contém ${secret}`);
      }
    });

    it('campanha: states/weight inválidos = 400; cria DRAFT (scope GROUP); ativa/pausa/retoma; editar conteúdo volta a DRAFT; outro grupo = 404 em tudo', async () => {
      const s = await groupSponsor(mestreA, { name: `[e2e-sgrp] Campanhas ${stamp}` });
      const bad = async (over: Record<string, unknown>, field: string) => {
        const res = await as(mestreA.token).post('/group-sponsor-campaigns', campaignBody(s.id, over)).expect(400);
        assert.ok(JSON.stringify(res.body).includes(field), `${field}: ${JSON.stringify(res.body)}`);
      };
      await bad({ states: ['GO'] }, 'states');
      await bad({ states: ['GO', 'SP'] }, 'states');
      await bad({ weight: 2 }, 'weight');
      await bad({ weight: 0 }, 'weight');
      await bad({ weight: 11 }, 'weight');
      await bad({ destinationUrl: 'http://loja.com.br/' }, 'destinationUrl');
      await bad({ category: 'APOSTAS' }, 'category');
      await bad({ ...window(0, 367) }, 'endsAt');
      await bad({ title: 'x' }, 'title');
      await bad({ text: 'Oferta <img src=x>' }, 'text');
      await bad({ organizationId: orgB }, 'organizationId');

      const c = await groupCampaign(mestreA, s.id, { states: [], weight: 1, priceCents: 50000, billingNote: 'Pix mensal' });
      assert.deepEqual(
        [c.status, c.effectiveStatus, c.scope, c.organizationId, c.weight, c.states, c.platformSuspended, c.platformSuspendReason],
        ['DRAFT', 'DRAFT', 'GROUP', orgA, 1, [], false, null],
      );
      assert.ok(!('platformSuspendedBy' in c) && !('platformSuspendedByUserId' in c), 'o Mestre não vê quem suspendeu');
      assert.deepEqual(c.organization, { id: orgA, name: orgAName });

      const on = await as(mestreA.token).post(`/group-sponsor-campaigns/${c.id}/activate`).expect(200);
      assert.deepEqual([on.body.status, on.body.effectiveStatus, on.body.approvedByUserId], ['ACTIVE', 'ACTIVE_NOW', mestreA.userId]);
      assert.equal((await as(mestreA.token).post(`/group-sponsor-campaigns/${c.id}/activate`).expect(409)).body.code, 'INVALID_TRANSITION');
      assert.equal((await as(mestreA.token).post(`/group-sponsor-campaigns/${c.id}/pause`).expect(200)).body.effectiveStatus, 'PAUSED');
      const resumed = await as(mestreA.token).post(`/group-sponsor-campaigns/${c.id}/resume`).expect(200);
      assert.deepEqual([resumed.body.status, resumed.body.approvedAt], ['ACTIVE', on.body.approvedAt]);
      // nao-conteudo (datas/preco) mantem ACTIVE; states/weight no PATCH: so [] / 1
      assert.equal((await as(mestreA.token).patch(`/group-sponsor-campaigns/${c.id}`, { priceCents: 60000, ...window(-1, 12) }).expect(200)).body.status, 'ACTIVE');
      assert.equal((await as(mestreA.token).patch(`/group-sponsor-campaigns/${c.id}`, { states: [], weight: 1 }).expect(200)).body.status, 'ACTIVE');
      await as(mestreA.token).patch(`/group-sponsor-campaigns/${c.id}`, { states: ['GO'] }).expect(400);
      await as(mestreA.token).patch(`/group-sponsor-campaigns/${c.id}`, { weight: 3 }).expect(400);
      const draft = await as(mestreA.token).patch(`/group-sponsor-campaigns/${c.id}`, { title: `[e2e-sgrp] Título novo ${stamp}` }).expect(200);
      assert.deepEqual([draft.body.status, draft.body.approvedByUserId], ['DRAFT', null]);
      assert.match((await as(mestreA.token).post(`/group-sponsor-campaigns/${c.id}/resume`).expect(409)).body.message, /rascunho/);
      // PAUSADA + conteudo => DRAFT
      await as(mestreA.token).post(`/group-sponsor-campaigns/${c.id}/activate`).expect(200);
      await as(mestreA.token).post(`/group-sponsor-campaigns/${c.id}/pause`).expect(200);
      assert.equal((await as(mestreA.token).patch(`/group-sponsor-campaigns/${c.id}`, { destinationUrl: 'https://outra-academia.com.br/' }).expect(200)).body.status, 'DRAFT');
      // encerrada nao ativa
      const ended = await groupCampaign(mestreA, s.id, { ...window(-5, 1) });
      await prisma.sponsorCampaign.update({ where: { id: ended.id }, data: { endsAt: new Date(Date.now() - DAY) } });
      assert.equal((await as(mestreA.token).post(`/group-sponsor-campaigns/${ended.id}/activate`).expect(400)).body.code, 'CAMPAIGN_ENDED');

      // lista com filtros e effectiveStatus
      const list = await as(mestreA.token).get(`/group-sponsor-campaigns?sponsorId=${s.id}&effective=ENDED`).expect(200);
      assert.deepEqual(list.body.map((x: { id: number }) => x.id), [ended.id]);
      await as(mestreA.token).get('/group-sponsor-campaigns?effective=XX').expect(400);

      // isolamento: o Mestre B recebe 404 em tudo da campanha de A (igual ao inexistente)
      for (const [method, p] of [
        ['get', `/group-sponsor-campaigns/${c.id}`],
        ['patch', `/group-sponsor-campaigns/${c.id}`],
        ['post', `/group-sponsor-campaigns/${c.id}/activate`],
        ['post', `/group-sponsor-campaigns/${c.id}/pause`],
        ['post', `/group-sponsor-campaigns/${c.id}/resume`],
        ['get', `/group-sponsor-campaigns/${c.id}/report`],
        ['get', `/group-sponsor-campaigns/${c.id}/report.csv`],
        ['delete', `/group-sponsor-campaigns/${c.id}`],
        ['get', '/group-sponsor-campaigns/999999999'],
      ] as const) {
        const b = as(mestreB.token);
        const res = method === 'get' ? await b.get(p) : method === 'post' ? await b.post(p) : method === 'patch' ? await b.patch(p, { title: 'Invasão total' }) : await b.del(p);
        assert.equal(res.status, 404, `${method} ${p} -> ${res.status}`);
      }
      assert.ok(!(await as(mestreB.token).get('/group-sponsor-campaigns?limit=200').expect(200)).body.some((x: { id: number }) => x.id === c.id));
      assert.equal((await prisma.sponsorCampaign.findUniqueOrThrow({ where: { id: c.id } })).title, `[e2e-sgrp] Título novo ${stamp}`, 'B não alterou');

      // auditoria do Mestre: codigos SPONSOR_GROUP_CAMPAIGN_*, organizationId do grupo
      const audits = await prisma.auditLog.findMany({ where: { resource: 'sponsor_campaign', resourceId: String(c.id) } });
      const actions = new Set(audits.map((a) => a.action));
      for (const a of ['CREATE', 'ACTIVATE', 'PAUSE', 'RESUME', 'UPDATE']) assert.ok(actions.has(`SPONSOR_GROUP_CAMPAIGN_${a}`), a);
      for (const a of audits) assert.equal(a.organizationId, orgA);
      assert.ok(!JSON.stringify(audits).includes('Pix mensal'), 'billingNote fora da auditoria');
      for (const id of [c.id, ended.id]) await as(mestreA.token).del(`/group-sponsor-campaigns/${id}`).expect(204);
      assert.ok((await prisma.auditLog.count({ where: { action: 'SPONSOR_GROUP_CAMPAIGN_DELETE', resourceId: String(c.id), organizationId: orgA } })) === 1);
      await as(mestreA.token).del(`/group-sponsors/${s.id}`).expect(204);
    });

    it('limites: 10 patrocinadores e 10 campanhas por grupo (409 SPONSOR_LIMIT); no máximo 3 ACTIVE (ativar e retomar)', async () => {
      await acceptTerms(mestreL);
      const sponsors: number[] = [];
      for (let i = 0; i < 10; i += 1) sponsors.push((await groupSponsor(mestreL, { name: `[e2e-sgrp] L${i} ${stamp}` })).id);
      const over = await as(mestreL.token).post('/group-sponsors', { name: `[e2e-sgrp] L10 ${stamp}` }).expect(409);
      assert.equal(over.body.code, 'SPONSOR_LIMIT');
      console.log('[exemplo] erro SPONSOR_LIMIT (patrocinadores):', JSON.stringify(over.body));
      assert.equal(await prisma.sponsor.count({ where: { organizationId: orgL } }), 10);
      // outro grupo nao e afetado pelo limite de L
      const bOk = await groupSponsor(mestreB, { name: `[e2e-sgrp] B livre ${stamp}` });
      await as(mestreB.token).del(`/group-sponsors/${bOk.id}`).expect(204);

      const campaigns: number[] = [];
      for (let i = 0; i < 10; i += 1) campaigns.push((await groupCampaign(mestreL, sponsors[i], { title: `[e2e-sgrp] LC${i} ${stamp}` })).id);
      const overC = await as(mestreL.token).post('/group-sponsor-campaigns', campaignBody(sponsors[0])).expect(409);
      assert.equal(overC.body.code, 'SPONSOR_LIMIT');
      assert.equal(await prisma.sponsorCampaign.count({ where: { organizationId: orgL } }), 10);

      for (const id of campaigns.slice(0, 3)) await as(mestreL.token).post(`/group-sponsor-campaigns/${id}/activate`).expect(200);
      const fourth = await as(mestreL.token).post(`/group-sponsor-campaigns/${campaigns[3]}/activate`).expect(409);
      assert.equal(fourth.body.code, 'SPONSOR_LIMIT');
      console.log('[exemplo] erro SPONSOR_LIMIT (ativas):', JSON.stringify(fourth.body));
      assert.equal((await prisma.sponsorCampaign.findUniqueOrThrow({ where: { id: campaigns[3] } })).status, 'DRAFT');
      // pausar libera vaga; retomar a pausada com 3 ativas = 409
      await as(mestreL.token).post(`/group-sponsor-campaigns/${campaigns[0]}/pause`).expect(200);
      await as(mestreL.token).post(`/group-sponsor-campaigns/${campaigns[3]}/activate`).expect(200);
      assert.equal((await as(mestreL.token).post(`/group-sponsor-campaigns/${campaigns[0]}/resume`).expect(409)).body.code, 'SPONSOR_LIMIT');
      // ativacoes em paralelo nao furam o limite (trava por grupo)
      await as(mestreL.token).post(`/group-sponsor-campaigns/${campaigns[3]}/pause`).expect(200);
      const statuses = await Promise.all(campaigns.slice(4, 8).map((id) => as(mestreL.token).post(`/group-sponsor-campaigns/${id}/activate`)));
      assert.deepEqual(statuses.map((r) => r.status).sort(), [200, 409, 409, 409], statuses.map((r) => r.status).join(','));
      assert.equal(await prisma.sponsorCampaign.count({ where: { organizationId: orgL, status: 'ACTIVE' } }), 3);
      // limpa (o servir exige um conjunto exato de campanhas ativas)
      await prisma.sponsorCampaign.updateMany({ where: { organizationId: orgL }, data: { status: 'PAUSED' } });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('servir: grupo + plataforma, menores, impressão e clique', () => {
    let groupA: { id: number };
    let groupA2: { id: number };
    let groupB: { id: number };
    let platformC: { id: number };
    let platformSponsorId: number;

    before(async () => {
      const sa = await groupSponsor(mestreA, { name: `[e2e-sgrp] Parceiro A ${stamp}` });
      groupA = (await as(mestreA.token).post(`/group-sponsor-campaigns/${(await groupCampaign(mestreA, sa.id, { title: `[e2e-sgrp] Grupo A ${stamp}`, destinationUrl: 'https://www.parceiro-a.com.br/promo?x=1' })).id}/activate`).expect(200)).body;
      groupA2 = (await as(mestreA.token).post(`/group-sponsor-campaigns/${(await groupCampaign(mestreA, sa.id, { title: `[e2e-sgrp] Grupo A2 ${stamp}` })).id}/activate`).expect(200)).body;
      await acceptTerms(mestreB);
      const sb = await groupSponsor(mestreB, { name: `[e2e-sgrp] Parceiro B ${stamp}` });
      groupB = (await as(mestreB.token).post(`/group-sponsor-campaigns/${(await groupCampaign(mestreB, sb.id, { title: `[e2e-sgrp] Grupo B ${stamp}` })).id}/activate`).expect(200)).body;
      platformSponsorId = (await as(commonToken).post('/platform-sponsors', { name: `[e2e-sgrp] Nacional ${stamp}` }).expect(201)).body.id;
      const pc = (await as(commonToken).post('/platform-sponsor-campaigns', campaignBody(platformSponsorId, { title: `[e2e-sgrp] Plataforma ${stamp}` })).expect(201)).body;
      platformC = (await as(superToken).post(`/platform-sponsor-campaigns/${pc.id}/activate`).expect(200)).body;
    });

    it('GET /sponsors/active: 2 itens (GRUPO primeiro, com groupName; depois PLATAFORMA); outro grupo NUNCA recebe a campanha de A', async () => {
      sponsorsService.random = () => 0;
      const res = await active(adultA).expect(200);
      sponsorsService.random = Math.random;
      assert.equal(res.headers['cache-control'], 'private, max-age=300');
      assert.equal(res.body.items.length, 2, res.text);
      const [g, p] = res.body.items;
      assert.deepEqual(Object.keys(g).sort(), ['clickPath', 'ctaLabel', 'groupName', 'id', 'imageUrl', 'logoUrl', 'scope', 'sponsorName', 'state', 'text', 'title']);
      assert.deepEqual([g.scope, g.groupName, g.id, g.sponsorName], ['GROUP', orgAName, groupA.id, `[e2e-sgrp] Parceiro A ${stamp}`]);
      assert.deepEqual([p.scope, p.groupName, p.id], ['PLATFORM', null, platformC.id]);
      assert.equal(g.clickPath, `/api/sponsors/${groupA.id}/click?s=GO`);
      for (const secret of ['parceiro-a.com.br', 'priceCents', 'billingNote', 'approved', 'weight', 'platformSuspend']) assert.ok(!res.text.includes(secret), `vazou ${secret}`);
      console.log('[exemplo] GET /sponsors/active (grupo + plataforma):', res.text);

      const a = await reachable(adultA);
      assert.deepEqual(a, { group: [groupA.id, groupA2.id].sort((x, y) => x - y), platform: [platformC.id] }, 'sorteio uniforme entre as do grupo A');
      const b = await reachable(adultB);
      assert.deepEqual(b, { group: [groupB.id], platform: [platformC.id] }, 'B vê a do B, nunca a de A');
      const l = await reachable(mestreL);
      assert.deepEqual(l, { group: [], platform: [platformC.id] }, 'grupo sem campanha ativa: só a plataforma');
    });

    it('MENOR/aluno sem data/dependente menor = [] nos DOIS escopos; SPONSORS_ENABLED=false desliga os dois', async () => {
      for (const [who, m, sid] of [
        ['aluno menor', minorA, undefined],
        ['aluno sem data', undatedA, undefined],
        ['dependente menor', guardianA, depMinorA],
      ] as Array<[string, Member, number | undefined]>) {
        assert.deepEqual(await reachable(m, sid), { group: [], platform: [] }, who);
      }
      assert.deepEqual(
        await reachable(guardianA),
        { group: [groupA.id, groupA2.id].sort((x, y) => x - y), platform: [platformC.id] },
        'responsável adulto sem dependente escolhido vê',
      );
      process.env.SPONSORS_ENABLED = 'false';
      try {
        assert.deepEqual((await active(adultA).expect(200)).body, { items: [] });
        const before = await totalImpressions(groupA.id);
        await impression(adultA, groupA.id).expect(204);
        assert.equal(await totalImpressions(groupA.id), before);
        assert.equal((await click(groupA.id, '?s=GO').expect(302)).headers.location, APP_HOME);
      } finally {
        delete process.env.SPONSORS_ENABLED;
      }
    });

    it('impressão: campanha de grupo conta SÓ para espectador do mesmo grupo (adulto); clique público = elegibilidade geral', async () => {
      const g0 = await statOf(groupA.id, 'GO');
      await impression(adultA, groupA.id).expect(204);
      await impression(adultA, groupA.id).expect(204);
      assert.equal((await statOf(groupA.id, 'GO')).impressions, g0.impressions + 2);
      const total = await totalImpressions(groupA.id);
      await impression(adultB, groupA.id).expect(204); // outro grupo
      await impression(mestreL, groupA.id).expect(204); // outro grupo
      await impression(minorA, groupA.id).expect(204); // menor
      await impression(guardianA, groupA.id, BROWSER_UA, `?studentId=${depMinorA}`).expect(204); // dependente menor
      await impression(adultA, groupA.id, 'curl/8.4.0').expect(204); // robo
      assert.equal(await totalImpressions(groupA.id), total, 'nada contou');
      // a de plataforma conta para os dois grupos
      const p0 = await totalImpressions(platformC.id);
      await impression(adultA, platformC.id).expect(204);
      await impression(adultB, platformC.id).expect(204);
      assert.equal(await totalImpressions(platformC.id), p0 + 2);

      // clique publico (sem token): 302 para a URL GRAVADA + utm e conta
      const c0 = await totalClicks(groupA.id);
      const res = await click(groupA.id, '?s=GO').expect(302);
      assert.equal(res.headers.location, `https://www.parceiro-a.com.br/promo?x=1&utm_source=gingapp&utm_medium=parceiro&utm_campaign=c${groupA.id}`);
      assert.equal(res.headers['referrer-policy'], 'no-referrer');
      assert.equal(await totalClicks(groupA.id), c0 + 1);
    });

    it('suspensão pela plataforma: para de servir NA HORA; Mestre não retoma (403 SUSPENDED_BY_PLATFORM); levantar só super admin (volta PAUSED)', async () => {
      await as(commonToken).post(`/platform-sponsor-campaigns/${groupA.id}/suspend`, {}).expect(400);
      await as(commonToken).post(`/platform-sponsor-campaigns/${groupA.id}/suspend`, { reason: 'ab' }).expect(400);
      await as(commonToken).post(`/platform-sponsor-campaigns/${groupA.id}/suspend`, { reason: 'x'.repeat(301) }).expect(400);
      assert.equal((await as(commonToken).post(`/platform-sponsor-campaigns/${platformC.id}/suspend`, { reason: 'Teste plataforma' }).expect(409)).body.code, 'NOT_GROUP_CAMPAIGN');
      await as(commonToken).post('/platform-sponsor-campaigns/999999999/suspend', { reason: 'Inexistente' }).expect(404);

      const sus = await as(commonToken).post(`/platform-sponsor-campaigns/${groupA.id}/suspend`, { reason: '  Denúncia   de propaganda enganosa ' }).expect(200);
      assert.deepEqual(
        [sus.body.status, sus.body.platformSuspended, sus.body.platformSuspendReason, sus.body.platformSuspendedByUserId, sus.body.platformSuspendedBy],
        ['PAUSED', true, 'Denúncia de propaganda enganosa', commonUserId, { id: commonUserId, name: 'E2E Team sgrp-common' }],
      );
      assert.equal((await as(commonToken).post(`/platform-sponsor-campaigns/${groupA.id}/suspend`, { reason: 'De novo' }).expect(409)).body.code, 'INVALID_TRANSITION');
      // servir: so a A2 (e a plataforma); impressao e clique da suspensa nao contam
      assert.deepEqual(await reachable(adultA), { group: [groupA2.id], platform: [platformC.id] });
      const i0 = await totalImpressions(groupA.id);
      const k0 = await totalClicks(groupA.id);
      await impression(adultA, groupA.id).expect(204);
      assert.equal((await click(groupA.id, '?s=GO').expect(302)).headers.location, APP_HOME);
      assert.deepEqual([await totalImpressions(groupA.id), await totalClicks(groupA.id)], [i0, k0]);

      // o Mestre ve suspensa + motivo (sem quem suspendeu) e NAO retoma nem ativa
      const mine = (await as(mestreA.token).get('/group-sponsor-campaigns').expect(200)).body.find((x: { id: number }) => x.id === groupA.id);
      assert.deepEqual([mine.platformSuspended, mine.platformSuspendReason, mine.effectiveStatus], [true, 'Denúncia de propaganda enganosa', 'PAUSED']);
      assert.ok(!('platformSuspendedByUserId' in mine) && !('platformSuspendedBy' in mine));
      console.log('[exemplo] campanha do Mestre na lista (suspensa):', JSON.stringify(mine));
      const resume = await as(mestreA.token).post(`/group-sponsor-campaigns/${groupA.id}/resume`).expect(403);
      assert.equal(resume.body.code, 'SUSPENDED_BY_PLATFORM');
      console.log('[exemplo] erro SUSPENDED_BY_PLATFORM:', JSON.stringify(resume.body));
      // editar conteudo -> DRAFT, mas ativar continua 403 (a suspensao fica)
      await as(mestreA.token).patch(`/group-sponsor-campaigns/${groupA.id}`, { text: 'Texto revisado depois da denúncia.' }).expect(200);
      assert.equal((await as(mestreA.token).post(`/group-sponsor-campaigns/${groupA.id}/activate`).expect(403)).body.code, 'SUSPENDED_BY_PLATFORM');

      // levantar: PLATFORM comum = 403; super admin = ok e a campanha fica como esta (DRAFT agora) para o Mestre decidir
      await as(commonToken).post(`/platform-sponsor-campaigns/${groupA.id}/unsuspend`).expect(403);
      const lifted = await as(superToken).post(`/platform-sponsor-campaigns/${groupA.id}/unsuspend`).expect(200);
      assert.deepEqual([lifted.body.platformSuspended, lifted.body.platformSuspendReason, lifted.body.platformSuspendedBy, lifted.body.status], [false, null, null, 'DRAFT']);
      await as(superToken).post(`/platform-sponsor-campaigns/${groupA.id}/unsuspend`).expect(409);
      await as(mestreA.token).post(`/group-sponsor-campaigns/${groupA.id}/activate`).expect(200);
      assert.equal((await reachable(adultA)).group.length, 2, 'volta a ser servida');

      // suspender ACTIVE -> PAUSED; levantar mantem PAUSED; o Mestre retoma
      await as(commonToken).post(`/platform-sponsor-campaigns/${groupA2.id}/suspend`, { reason: 'Verificação de rotina' }).expect(200);
      assert.equal((await as(superToken).post(`/platform-sponsor-campaigns/${groupA2.id}/unsuspend`).expect(200)).body.status, 'PAUSED');
      assert.equal((await as(mestreA.token).post(`/group-sponsor-campaigns/${groupA2.id}/resume`).expect(200)).body.status, 'ACTIVE');

      const audits = await prisma.auditLog.findMany({ where: { action: { in: ['SPONSOR_CAMPAIGN_SUSPEND', 'SPONSOR_CAMPAIGN_UNSUSPEND'] }, resourceId: { in: [String(groupA.id), String(groupA2.id)] } } });
      assert.equal(audits.length, 4);
      for (const a of audits) assert.equal(a.organizationId, orgA, 'grupo alvo');
      const sAudit = audits.find((a) => a.action === 'SPONSOR_CAMPAIGN_SUSPEND' && a.resourceId === String(groupA.id));
      assert.deepEqual([sAudit?.userId, sAudit?.metadata], [commonUserId, { previousStatus: 'ACTIVE', status: 'PAUSED', reasonLength: 'Denúncia de propaganda enganosa'.length }]);
      assert.ok(!JSON.stringify(audits).includes('Denúncia'), 'o texto do motivo não vai para a auditoria');
    });

    it('bloqueio do grupo: para de servir e impede ativar/retomar; só super admin; GET /platform-sponsor-groups', async () => {
      await as(commonToken).post(`/platform-sponsor-groups/${orgA}/block`, { reason: 'Muitas denúncias' }).expect(403);
      await as(superToken).post(`/platform-sponsor-groups/${orgA}/block`, {}).expect(400);
      await as(superToken).post('/platform-sponsor-groups/999999999/block', { reason: 'Inexistente' }).expect(404);
      const blocked = await as(superToken).post(`/platform-sponsor-groups/${orgA}/block`, { reason: 'Muitas denúncias' }).expect(200);
      assert.deepEqual([blocked.body.organizationId, blocked.body.blocked, blocked.body.blockedReason], [orgA, true, 'Muitas denúncias']);
      await as(superToken).post(`/platform-sponsor-groups/${orgA}/block`, { reason: 'De novo' }).expect(409);

      assert.deepEqual(await reachable(adultA), { group: [], platform: [platformC.id] }, 'grupo bloqueado: só a plataforma');
      assert.deepEqual((await reachable(adultB)).group, [groupB.id], 'outro grupo segue');
      const i0 = await totalImpressions(groupA.id);
      await impression(adultA, groupA.id).expect(204);
      assert.equal(await totalImpressions(groupA.id), i0);
      assert.equal((await click(groupA.id).expect(302)).headers.location, APP_HOME);
      const terms = await as(mestreA.token).get('/group-sponsors/terms').expect(200);
      assert.deepEqual([terms.body.blocked, terms.body.blockedReason], [true, 'Muitas denúncias']);
      await as(mestreA.token).post(`/group-sponsor-campaigns/${groupA2.id}/pause`).expect(200);
      assert.equal((await as(mestreA.token).post(`/group-sponsor-campaigns/${groupA2.id}/resume`).expect(403)).body.code, 'SPONSORS_BLOCKED');
      assert.equal((await as(mestreA.token).post(`/group-sponsor-campaigns/${groupA2.id}/activate`).expect(403)).body.code, 'SPONSORS_BLOCKED');

      const groups = await as(commonToken).get(`/platform-sponsor-groups?q=${encodeURIComponent(stamp)}&limit=50`).expect(200);
      const rowA = groups.body.find((g: { organizationId: number }) => g.organizationId === orgA);
      const rowB = groups.body.find((g: { organizationId: number }) => g.organizationId === orgB);
      assert.ok(rowA && rowB, groups.text);
      assert.deepEqual(Object.keys(rowA).sort(), ['activeNow', 'blocked', 'blockedAt', 'blockedReason', 'campaigns', 'name', 'organizationId', 'sponsors', 'termsAcceptedAt', 'termsCurrent', 'termsVersion']);
      assert.deepEqual([rowA.name, rowA.sponsors, rowA.campaigns, rowA.activeNow, rowA.blocked, rowA.termsCurrent], [orgAName, 1, 2, 1, true, true]);
      assert.deepEqual([rowB.sponsors, rowB.campaigns, rowB.activeNow, rowB.blocked], [1, 1, 1, false]);
      assert.ok(Number(groups.headers['x-total-count']) >= 3, 'A, B e L');
      console.log('[exemplo] GET /platform-sponsor-groups:', JSON.stringify(groups.body.filter((g: { organizationId: number }) => g.organizationId === orgA || g.organizationId === orgB)));

      await as(commonToken).post(`/platform-sponsor-groups/${orgA}/unblock`).expect(403);
      const freed = await as(superToken).post(`/platform-sponsor-groups/${orgA}/unblock`).expect(200);
      assert.equal(freed.body.blocked, false);
      await as(superToken).post(`/platform-sponsor-groups/${orgA}/unblock`).expect(409);
      await as(mestreA.token).post(`/group-sponsor-campaigns/${groupA2.id}/resume`).expect(200);
      assert.equal((await reachable(adultA)).group.length, 2, 'liberado: volta a servir');
      const audits = await prisma.auditLog.findMany({ where: { action: { in: ['SPONSOR_GROUP_BLOCK', 'SPONSOR_GROUP_UNBLOCK'] }, organizationId: orgA } });
      assert.deepEqual(audits.map((a) => a.action).sort(), ['SPONSOR_GROUP_BLOCK', 'SPONSOR_GROUP_UNBLOCK']);
      for (const a of audits) assert.equal(a.userId, superUserId);
      assert.ok(!JSON.stringify(audits).includes('Muitas'), 'motivo fora da auditoria');
    });

    it('plataforma: listagens padrão só da plataforma; ?scope=GROUP&organizationId= lista as do grupo (organization); escrita em campanha de grupo = 404; leitura/relatório ok', async () => {
      const def = await as(commonToken).get(`/platform-sponsor-campaigns?q=${encodeURIComponent(stamp)}&limit=200`).expect(200);
      assert.deepEqual(def.body.map((x: { id: number }) => x.id), [platformC.id], 'padrão = só organizationId nulo');
      const grp = await as(commonToken).get(`/platform-sponsor-campaigns?scope=GROUP&organizationId=${orgA}&limit=200`).expect(200);
      assert.deepEqual(grp.body.map((x: { id: number }) => x.id).sort(), [groupA.id, groupA2.id].sort());
      assert.equal(grp.headers['x-total-count'], '2');
      assert.deepEqual(grp.body[0].organization, { id: orgA, name: orgAName });
      assert.equal(grp.body[0].scope, 'GROUP');
      const all = await as(commonToken).get(`/platform-sponsor-campaigns?scope=GROUP&q=${encodeURIComponent(stamp)}&limit=200`).expect(200);
      assert.ok([groupA.id, groupA2.id, groupB.id].every((id) => all.body.some((x: { id: number }) => x.id === id)));
      assert.ok(!all.body.some((x: { id: number }) => x.id === platformC.id));
      const eff = await as(commonToken).get(`/platform-sponsor-campaigns?scope=GROUP&organizationId=${orgA}&effective=ACTIVE_NOW`).expect(200);
      assert.equal(eff.body.length, 2);
      const sp = await as(commonToken).get(`/platform-sponsors?scope=GROUP&organizationId=${orgA}`).expect(200);
      assert.deepEqual(sp.body.map((x: { organization: { id: number } }) => x.organization.id), [orgA]);
      assert.ok(!(await as(commonToken).get(`/platform-sponsors?q=${encodeURIComponent(stamp)}`).expect(200)).body.some((x: { organizationId: number | null }) => x.organizationId !== null));
      await as(commonToken).get(`/platform-sponsor-campaigns?organizationId=${orgA}`).expect(400);
      await as(commonToken).get('/platform-sponsor-campaigns?scope=OUTRO').expect(400);

      await as(commonToken).get(`/platform-sponsor-campaigns/${groupA.id}`).expect(200);
      await as(commonToken).get(`/platform-sponsors/${sp.body[0].id}`).expect(200);
      await as(commonToken).patch(`/platform-sponsor-campaigns/${groupA.id}`, { title: 'Plataforma editando grupo' }).expect(404);
      await as(commonToken).post(`/platform-sponsor-campaigns/${groupA.id}/pause`).expect(404);
      await as(superToken).post(`/platform-sponsor-campaigns/${groupA.id}/activate`).expect(404);
      await as(commonToken).del(`/platform-sponsor-campaigns/${groupA.id}`).expect(404);
      await as(commonToken).patch(`/platform-sponsors/${sp.body[0].id}`, { name: 'Plataforma editando' }).expect(404);
      await as(commonToken).del(`/platform-sponsors/${sp.body[0].id}`).expect(404);
      const rep = await as(commonToken).get(`/platform-sponsor-campaigns/${groupA.id}/report`).expect(200);
      assert.ok(rep.body.totals.impressions >= 2);
    });

    it('relatório/CSV do Mestre: mesmo formato, só do PRÓPRIO grupo', async () => {
      await prisma.sponsorStatDay.createMany({
        data: [
          { campaignId: groupA2.id, day: '2026-10-01', state: 'GO', impressions: 40, clicks: 2 },
          { campaignId: groupA2.id, day: '2026-10-02', state: '', impressions: 10, clicks: 1 },
        ],
      });
      const rep = await as(mestreA.token).get(`/group-sponsor-campaigns/${groupA2.id}/report?from=2026-10-01&to=2026-10-02`).expect(200);
      assert.deepEqual(rep.body.totals, { impressions: 50, clicks: 3, ctr: 6 });
      assert.deepEqual(rep.body.byDay, [
        { day: '2026-10-01', impressions: 40, clicks: 2 },
        { day: '2026-10-02', impressions: 10, clicks: 1 },
      ]);
      assert.deepEqual(rep.body.byState, [
        { state: 'GO', impressions: 40, clicks: 2 },
        { state: '', impressions: 10, clicks: 1 },
      ]);
      assert.deepEqual(Object.keys(rep.body.campaign).sort(), ['endsAt', 'id', 'sponsorName', 'startsAt', 'status', 'title']);
      await as(mestreA.token).get(`/group-sponsor-campaigns/${groupA2.id}/report?from=2026-13-01`).expect(400);
      const csv = await as(mestreA.token).get(`/group-sponsor-campaigns/${groupA2.id}/report.csv?from=2026-10-01&to=2026-10-02`).buffer(true).expect(200);
      assert.match(csv.headers['content-type'], /^text\/csv; charset=utf-8/);
      assert.ok(csv.text.startsWith('﻿'), 'BOM');
      const lines = csv.text.slice(1).split('\r\n');
      assert.equal(lines[0], 'Seção;Chave;Título;Patrocinador;Impressões;Cliques;CTR (%)');
      assert.ok(lines.includes('Total;;;;50;3;6,00'), lines.join('\n'));
      assert.ok(lines.includes('UF;Não identificada;;;10;1;10,00'));
      await as(mestreB.token).get(`/group-sponsor-campaigns/${groupA2.id}/report`).expect(404);
      await as(mestreB.token).get(`/group-sponsor-campaigns/${groupA2.id}/report.csv`).expect(404);
      await as(professorA.token).get(`/group-sponsor-campaigns/${groupA2.id}/report`).expect(403);
    });

    it('PROVA de privacidade nos caminhos novos: contadores só (campanha, dia, UF); nenhum IP/UA/usuário em tabela, auditoria ou log', async () => {
      const marker = `E2E-SGRP-UA-${stamp}`;
      const ua = `Mozilla/5.0 (Linux; Android 14; ${marker}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36`;
      const ip = '203.0.113.88';
      // marco por id (nao por relogio: o teste anterior acabou de auditar acoes do Mestre no mesmo segundo)
      const lastAudit = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? 0;
      const captured: string[] = [];
      const out = process.stdout.write.bind(process.stdout);
      process.env.REQUEST_LOG = 'true';
      process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
        captured.push(String(chunk));
        return (out as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof process.stdout.write;
      const before = await totalImpressions(groupA.id);
      try {
        await active(adultA).set('User-Agent', ua).set('X-Forwarded-For', ip).expect(200);
        await impression(adultA, groupA.id, ua).set('X-Forwarded-For', ip).expect(204);
        await impression(adultB, groupB.id, ua).set('X-Forwarded-For', ip).expect(204);
        await click(groupA.id, '?s=GO', ua).set('X-Forwarded-For', ip).expect(302);
      } finally {
        process.stdout.write = out as typeof process.stdout.write;
        process.env.REQUEST_LOG = envBackup.REQUEST_LOG ?? 'false';
      }
      assert.equal(await totalImpressions(groupA.id), before + 1, 'controle positivo: a impressão contou');
      const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'SponsorStatDay' ORDER BY column_name`,
      );
      assert.deepEqual(cols.map((c) => c.column_name).sort(), ['campaignId', 'clicks', 'day', 'id', 'impressions', 'state'], 'nenhuma coluna de grupo/usuário nos contadores');
      const rows = await prisma.sponsorStatDay.findMany({ where: { campaignId: { in: [groupA.id, groupA2.id, groupB.id] } } });
      assert.ok(rows.length >= 3);
      for (const r of rows) {
        assert.match(r.day, /^\d{4}-\d{2}-\d{2}$/);
        assert.match(r.state, /^([A-Z]{2})?$/);
      }
      const mine = await prisma.auditLog.findMany({ where: { id: { gt: lastAudit } } });
      assert.deepEqual(mine, [], 'impressão/clique/servir não auditam (nenhuma linha nova de ninguém)');
      const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      const control = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM "Organization" t WHERE row_to_json(t)::text LIKE $1`, `%${orgAName}%`);
      assert.equal(Number(control[0].n), 1, 'a varredura encontra o que existe');
      for (const { table_name } of tables) {
        for (const needle of [marker, ip]) {
          const found = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM "${table_name}" t WHERE row_to_json(t)::text LIKE $1`, `%${needle}%`);
          assert.equal(Number(found[0].n), 0, `${table_name} contém ${needle}`);
        }
      }
      const lines = (captured.join('').match(/\{"ts":"[^\n]*?"msg":"http_request"[^\n]*?\}(?=\n|$)/g) ?? []).map((l) => JSON.parse(l));
      const sponsorLines = lines.filter((l) => String(l.route).startsWith('/api/sponsors/'));
      assert.equal(sponsorLines.length, 4, JSON.stringify(lines.map((l) => l.route)));
      for (const l of sponsorLines) assert.deepEqual([l.userId, l.ip], [null, null], JSON.stringify(l));
      assert.ok(!captured.join('').includes(marker) && !captured.join('').includes(ip), 'o log não contém UA/IP');
      console.log(`[privacidade] ${tables.length} tabelas varridas: 0 ocorrências do User-Agent/IP (caminhos do grupo)`);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('coletor de órfãs, cascade e invariante no banco', () => {
    it('coletor: imagem do grupo referenciada por patrocinador/campanha de grupo fica; órfã do grupo é coletada', async () => {
      const old = new Date(Date.now() - 5 * DAY);
      const make = async () => {
        const filename = `${randomUUID()}.webp`;
        const data = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#654321' } }).webp().toBuffer();
        const full = path.join(dir, filename);
        await fs.writeFile(full, data);
        await fs.utimes(full, old, old);
        await prisma.upload.create({ data: { organizationId: orgB, userId: mestreB.userId, filename, mimeType: 'image/webp', sizeBytes: data.length, createdAt: old } });
        uploadFiles.push(filename);
        return filename;
      };
      const logoFile = await make();
      const imageFile = await make();
      const orphanFile = await make();
      const s = await groupSponsor(mestreB, { name: `[e2e-sgrp] GC ${stamp}`, logo: `/api/uploads/${logoFile}` });
      const c = await groupCampaign(mestreB, s.id, { imageRef: `/api/uploads/${imageFile}` });
      const service = new UploadsGcCronService(app.get(PrismaService));
      const referenced = await service.referencedFilenames();
      assert.ok(referenced.has(logoFile) && referenced.has(imageFile) && !referenced.has(orphanFile));
      process.env.UPLOADS_GC = 'true';
      let result;
      try {
        result = await service.run({ dir, organizationId: orgB });
      } finally {
        process.env.UPLOADS_GC = 'false';
      }
      assert.ok(result, 'o GC rodou');
      const exists = (f: string) => fs.stat(path.join(dir, f)).then(() => true, () => false);
      assert.ok((await exists(logoFile)) && (await exists(imageFile)), 'referenciadas ficam');
      assert.equal(await exists(orphanFile), false, 'órfã coletada');
      assert.equal(await prisma.upload.count({ where: { filename: orphanFile } }), 0);
      await as(mestreB.token).del(`/group-sponsor-campaigns/${c.id}`).expect(204);
      await as(mestreB.token).del(`/group-sponsors/${s.id}`).expect(204);
    });

    it('invariante no banco: campanha com organizationId diferente do patrocinador é recusada pelo trigger', async () => {
      const s = await groupSponsor(mestreB, { name: `[e2e-sgrp] Trigger ${stamp}` });
      const base = {
        sponsorId: s.id,
        title: 't',
        text: 't',
        destinationUrl: 'https://a.com.br/',
        destinationHost: 'a.com.br',
        category: 'ESPORTES' as const,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + DAY),
      };
      await assert.rejects(prisma.sponsorCampaign.create({ data: { ...base, organizationId: orgA } }), /difere do organizationId/);
      await assert.rejects(prisma.sponsorCampaign.create({ data: { ...base, organizationId: null } }), /difere do organizationId/);
      const ok = await prisma.sponsorCampaign.create({ data: { ...base, organizationId: orgB } });
      await assert.rejects(prisma.sponsorCampaign.update({ where: { id: ok.id }, data: { organizationId: orgA } }), /difere do organizationId/);
      await assert.rejects(prisma.sponsor.update({ where: { id: s.id }, data: { organizationId: orgA } }), /outro organizationId/);
      await prisma.sponsorCampaign.delete({ where: { id: ok.id } });
      await as(mestreB.token).del(`/group-sponsors/${s.id}`).expect(204);
    });

    it('cascade: apagar o grupo apaga patrocinadores, campanhas e estatísticas dele (e nada de outro grupo)', async () => {
      const x = await makeOrg('X');
      const sponsor = await prisma.sponsor.create({ data: { name: '[e2e-sgrp] cascade', organizationId: x.id } });
      const campaign = await prisma.sponsorCampaign.create({
        data: {
          organizationId: x.id,
          sponsorId: sponsor.id,
          title: 'Cascade',
          text: 'Cascade',
          destinationUrl: 'https://a.com.br/',
          destinationHost: 'a.com.br',
          category: 'ESPORTES',
          startsAt: new Date(),
          endsAt: new Date(Date.now() + DAY),
        },
      });
      await prisma.sponsorStatDay.create({ data: { campaignId: campaign.id, day: '2026-10-01', state: 'GO', impressions: 1, clicks: 0 } });
      const othersBefore = await prisma.sponsorCampaign.count({ where: { organizationId: { in: [orgA, orgB] } } });
      await prisma.organization.delete({ where: { id: x.id } });
      assert.equal(await prisma.sponsor.count({ where: { id: sponsor.id } }), 0);
      assert.equal(await prisma.sponsorCampaign.count({ where: { id: campaign.id } }), 0);
      assert.equal(await prisma.sponsorStatDay.count({ where: { campaignId: campaign.id } }), 0);
      assert.equal(await prisma.sponsorCampaign.count({ where: { organizationId: { in: [orgA, orgB] } } }), othersBefore);
    });

    it('limpeza: nenhuma campanha deste spec fica ATIVA (os outros specs exigem banco sem campanhas ativas alheias)', async () => {
      await prisma.sponsorCampaign.updateMany({ where: { OR: [{ organizationId: { in: orgIds } }, { title: { contains: stamp } }] }, data: { status: 'PAUSED' } });
      assert.equal(await prisma.sponsorCampaign.count({ where: { status: 'ACTIVE', endsAt: { gt: new Date() }, title: { contains: stamp } } }), 0);
    });
  });
});
