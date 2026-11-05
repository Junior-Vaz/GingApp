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
import { SponsorsService } from '../src/interface/http/sponsors/sponsors.service';
import { UploadsGcCronService } from '../src/jobs/uploads-gc-cron.service';
import { AUDIT_ACTION_CODES } from '../src/shared/audit/audit-actions';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { DEV_PASSWORD, loginAs, todaySaoPaulo } from './utils/list-helpers';
import { createPlatformUser, platformLogin } from './utils/platform-team-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Patrocinadores no banner da Home (docs/CONTRATO_PATROCINADORES.md): CRUD/permissoes da plataforma, upload de plataforma,
 * validacoes, ativar/pausar/retomar, status efetivo, selecao por UF e peso, regra de MENOR, impressao, clique (302 para a URL
 * GRAVADA), interruptor, relatorio JSON/CSV, PROVA de privacidade, throttles e o coletor de imagens orfas.
 * Grupo, unidades, usuarios e patrocinadores PROPRIOS (nada do seed); tudo removido no after().
 */
const DOMAIN = '@e2e-sponsors.local';
const DAY = 86_400_000;
const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const APP_HOME = 'https://app.e2e.test/';

interface Member {
  userId: number;
  token: string;
  studentId?: number;
}

describe('Patrocinadores (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  let dir = '';
  let sponsorsService: SponsorsService;

  let orgId: number;
  let orgBId: number;
  let mainUnitId: number;
  let spUnitId: number;
  let mestre: Member;
  let adult: Member; // ALUNO adulto, unidade SP
  let minor: Member; // ALUNO menor (data da matricula)
  let undated: Member; // ALUNO sem nenhuma data
  let personMinor: Member; // ALUNO: matricula diz adulto, FICHA (Person) diz menor
  let orphan: Member; // ALUNO sem aluno nenhum
  let staffNoDate: Member; // PROFESSOR com matricula de equipe sem data
  let guardian: Member; // RESPONSAVEL sem aluno proprio
  let spare: Member; // MESTRE do grupo B (sem unidade/UF): "outro usuario" do throttle
  let depMinorId: number;
  let depAdultId: number;
  let depUndatedId: number;
  let strangerBId: number;
  let commonToken: string; // PLATFORM comum
  let superToken: string; // PLATFORM super admin
  let commonUserId: number;
  let superUserId: number;
  const userIds: number[] = [];
  const personIds: number[] = [];
  const sponsorIds: number[] = [];
  const uploadFiles: string[] = [];
  const envBackup = { ...process.env };

  const plat = (token: string) => ({
    get: (p: string) => http().get(`/api${p}`).set(auth(token)),
    post: (p: string, body?: object) => http().post(`/api${p}`).set(auth(token)).send(body ?? {}),
    patch: (p: string, body: object) => http().patch(`/api${p}`).set(auth(token)).send(body),
    del: (p: string) => http().delete(`/api${p}`).set(auth(token)),
  });
  const active = (m: Member, studentId?: number) =>
    http().get(`/api/sponsors/active${studentId ? `?studentId=${studentId}` : ''}`).set(auth(m.token));
  const impression = (m: Member, id: number, ua: string | null = BROWSER_UA, query = '') => {
    const req = http().post(`/api/sponsors/${id}/impression${query}`).set(auth(m.token));
    return ua === null ? req : req.set('User-Agent', ua);
  };
  const click = (id: number | string, query = '', ua = BROWSER_UA) => http().get(`/api/sponsors/${id}/click${query}`).set('User-Agent', ua);
  const stats = (campaignId: number) =>
    prisma.sponsorStatDay.findMany({ where: { campaignId }, orderBy: [{ day: 'asc' }, { state: 'asc' }] });
  const statOf = async (campaignId: number, state: string) =>
    (await prisma.sponsorStatDay.findUnique({ where: { campaignId_day_state: { campaignId, day: todaySaoPaulo(), state } } })) ?? {
      impressions: 0,
      clicks: 0,
    };

  /** Imagem de plataforma enviada pela API (PNG pequeno). */
  const platformImage = async (color = '#3366aa'): Promise<string> => {
    const png = await sharp({ create: { width: 120, height: 63, channels: 3, background: color } }).png().toBuffer();
    const res = await http().post('/api/platform-uploads').set(auth(commonToken)).attach('file', png, { filename: 'logo.png', contentType: 'image/png' }).expect(201);
    uploadFiles.push(res.body.filename);
    return res.body.url;
  };

  let sponsorId: number;
  let logoUrl: string;
  const window = (startOffsetDays: number, endOffsetDays: number) => ({
    startsAt: new Date(Date.now() + startOffsetDays * DAY).toISOString(),
    endsAt: new Date(Date.now() + endOffsetDays * DAY).toISOString(),
  });
  const campaignBody = (over: Record<string, unknown> = {}) => ({
    sponsorId,
    title: `[e2e-spons] Campanha ${stamp}`,
    text: 'Berimbaus artesanais com 10% de desconto para capoeiristas.',
    destinationUrl: 'https://www.loja-exemplo.com.br/berimbau',
    category: 'INSTRUMENTOS',
    ...window(-1, 10),
    ...over,
  });
  const createCampaign = async (over: Record<string, unknown> = {}) =>
    (await plat(commonToken).post('/platform-sponsor-campaigns', campaignBody(over)).expect(201)).body;
  const activeCampaign = async (over: Record<string, unknown> = {}) => {
    const c = await createCampaign(over);
    return (await plat(superToken).post(`/platform-sponsor-campaigns/${c.id}/activate`).expect(200)).body;
  };

  const makeMember = async (kind: string, organizationId: number, role: OrgRole, student?: { unitId?: number; birthDate?: string; isStaff?: boolean }) => {
    const email = `${kind}-${stamp}${DOMAIN}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `[e2e-spons] ${kind}`, userType: 'MEMBER', status: 'ACTIVE' },
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
            name: `[e2e-spons] aluno ${kind}`,
            unitId: student.unitId,
            isStaff: student.isStaff ?? false,
            birthDate: student.birthDate ? new Date(`${student.birthDate}T00:00:00.000Z`) : null,
          },
        })
      ).id;
    }
    return { userId: user.id, token: (await loginAs(app, email)).token, studentId };
  };

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-sponsors-'));
    process.env.UPLOADS_DIR = dir;
    app = await createTestApp();
    sponsorsService = app.get(SponsorsService);

    // Isolamento: nenhuma campanha alheia ATIVA no banco de dev (senao a selecao por UF/peso nao seria exata).
    const foreign = await prisma.sponsorCampaign.count({ where: { status: 'ACTIVE', endsAt: { gt: new Date() } } });
    assert.equal(foreign, 0, 'há campanhas ATIVAS de fora deste spec no banco de dev; pause-as antes de rodar');

    orgId = (
      await prisma.organization.create({
        data: { name: `[e2e-spons] Grupo ${stamp}`, slug: `e2e-spons-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE, state: 'RS' },
      })
    ).id;
    orgBId = (
      await prisma.organization.create({
        data: { name: `[e2e-spons] Grupo B ${stamp}`, slug: `e2e-spons-b-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
      })
    ).id;
    mainUnitId = (await prisma.unit.create({ data: { organizationId: orgId, name: '[e2e-spons] Sede', state: 'GO', isMain: true } })).id;
    spUnitId = (await prisma.unit.create({ data: { organizationId: orgId, name: '[e2e-spons] Filial SP', state: 'SP' } })).id;

    mestre = await makeMember('mestre', orgId, OrgRole.MESTRE);
    adult = await makeMember('adulto', orgId, OrgRole.ALUNO, { unitId: spUnitId, birthDate: '1990-05-10' });
    minor = await makeMember('menor', orgId, OrgRole.ALUNO, { unitId: spUnitId, birthDate: '2015-03-01' });
    undated = await makeMember('semdata', orgId, OrgRole.ALUNO, { unitId: spUnitId });
    personMinor = await makeMember('fichamenor', orgId, OrgRole.ALUNO, { unitId: spUnitId, birthDate: '1990-01-01' });
    personIds.push(
      (await prisma.person.create({ data: { gingappCode: `E2E-SP-${stamp}-1`, name: '[e2e-spons] ficha menor', userId: personMinor.userId, birthDate: new Date('2014-06-01T00:00:00.000Z') } })).id,
    );
    orphan = await makeMember('orfao', orgId, OrgRole.ALUNO);
    staffNoDate = await makeMember('professor', orgId, OrgRole.PROFESSOR, { isStaff: true });
    guardian = await makeMember('responsavel', orgId, OrgRole.RESPONSAVEL);
    spare = await makeMember('mestreb', orgBId, OrgRole.MESTRE);
    const dep = async (name: string, birthDate?: string, personBirth?: string) => {
      let personId: number | undefined;
      if (personBirth) {
        personId = (await prisma.person.create({ data: { gingappCode: `E2E-SP-${stamp}-${name}`, name, birthDate: new Date(`${personBirth}T00:00:00.000Z`) } })).id;
        personIds.push(personId);
      }
      const s = await prisma.student.create({
        data: { organizationId: orgId, unitId: spUnitId, name: `[e2e-spons] ${name}`, personId, birthDate: birthDate ? new Date(`${birthDate}T00:00:00.000Z`) : null },
      });
      await prisma.studentGuardian.create({ data: { organizationId: orgId, studentId: s.id, userId: guardian.userId, name: '[e2e-spons] responsavel' } });
      return s.id;
    };
    // dependente menor pela FICHA (a matricula diria adulto), adulto, sem data
    depMinorId = await dep('dep-menor', '1980-01-01', '2016-02-02');
    depAdultId = await dep('dep-adulto', '1995-07-07');
    depUndatedId = await dep('dep-semdata');
    strangerBId = (await prisma.student.create({ data: { organizationId: orgBId, name: '[e2e-spons] alheio B', birthDate: new Date('1990-01-01T00:00:00Z') } })).id;

    const common = await createPlatformUser(prisma, 'spons-common');
    const superAdmin = await createPlatformUser(prisma, 'spons-super', { isSuperAdmin: true });
    commonUserId = common.id;
    superUserId = superAdmin.id;
    userIds.push(common.id, superAdmin.id);
    commonToken = await platformLogin(app, common.email);
    superToken = await platformLogin(app, superAdmin.email);

    logoUrl = await platformImage();
    const sponsor = await plat(commonToken)
      .post('/platform-sponsors', {
        name: `  [e2e-spons]   Loja do Berimbau ${stamp} `,
        logo: logoUrl,
        contactName: 'Contato Sigiloso Fulano',
        contactEmail: `CONTATO-${stamp}@LOJA-SIGILOSA.com.br`,
        contactPhone: '+55 62 99999-1234',
        document: '12.345.678/0001-90',
        notes: 'Nota comercial sigilosa',
      })
      .expect(201);
    sponsorId = sponsor.body.id;
    sponsorIds.push(sponsorId);
  });

  after(async () => {
    process.env = { ...envBackup };
    sponsorsService.random = Math.random;
    await app.close();
    const sponsorWhere = { id: { in: sponsorIds } };
    const campaigns = await prisma.sponsorCampaign.findMany({ where: { sponsorId: { in: sponsorIds } }, select: { id: true } });
    const campaignIds = campaigns.map((c) => c.id);
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { organizationId: { in: [orgId, orgBId] } },
          { resource: 'sponsor', resourceId: { in: sponsorIds.map(String) } },
          { resource: 'sponsor_campaign', resourceId: { in: campaignIds.map(String) } },
          { resource: 'upload', resourceId: { in: uploadFiles } },
        ],
      },
    });
    await prisma.sponsorCampaign.deleteMany({ where: { id: { in: campaignIds } } }); // estatisticas em cascata
    await prisma.sponsor.deleteMany({ where: sponsorWhere });
    await prisma.upload.deleteMany({ where: { OR: [{ filename: { in: uploadFiles } }, { userId: { in: userIds } }] } });
    await prisma.studentGuardian.deleteMany({ where: { organizationId: { in: [orgId, orgBId] } } });
    await prisma.student.deleteMany({ where: { organizationId: { in: [orgId, orgBId] } } });
    await prisma.person.deleteMany({ where: { id: { in: personIds } } });
    await prisma.unit.deleteMany({ where: { organizationId: { in: [orgId, orgBId] } } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgId, orgBId] } } });
    await fs.rm(dir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('plataforma: permissões, upload e patrocinadores', () => {
    it('MEMBER = 403 em todas as rotas de plataforma; sem token = 401; o catálogo de auditoria tem os códigos novos', async () => {
      for (const [method, p] of [
        ['get', '/platform-sponsors'],
        ['post', '/platform-sponsors'],
        ['get', `/platform-sponsors/${sponsorId}`],
        ['get', '/platform-sponsor-campaigns'],
        ['post', '/platform-sponsor-campaigns'],
        ['post', '/platform-sponsor-campaigns/1/activate'],
        ['get', '/platform-sponsor-campaigns/1/report'],
        ['get', '/platform-sponsor-campaigns/1/report.csv'],
        ['post', '/platform-uploads'],
      ] as const) {
        const res = method === 'get' ? await plat(mestre.token).get(p) : await plat(mestre.token).post(p, {});
        assert.equal(res.status, 403, `${method} ${p} -> ${res.status}`);
        const anon = method === 'get' ? await http().get(`/api${p}`) : await http().post(`/api${p}`).send({});
        assert.equal(anon.status, 401, `anônimo ${method} ${p}`);
      }
      for (const code of [
        'SPONSOR_CREATE', 'SPONSOR_UPDATE', 'SPONSOR_DELETE', 'SPONSOR_CAMPAIGN_CREATE', 'SPONSOR_CAMPAIGN_UPDATE',
        'SPONSOR_CAMPAIGN_DELETE', 'SPONSOR_CAMPAIGN_ACTIVATE', 'SPONSOR_CAMPAIGN_PAUSE', 'SPONSOR_CAMPAIGN_RESUME',
      ]) {
        assert.ok(AUDIT_ACTION_CODES.includes(code), code);
      }
      assert.equal(new Set(AUDIT_ACTION_CODES).size, AUDIT_ACTION_CODES.length, 'códigos únicos');
    });

    it('POST /platform-uploads: dono = plataforma (organizationId nulo), webp sem EXIF, <= 250 KB; pesada é reprocessada; acima do limite = 413 sem gravar', async () => {
      const row = await prisma.upload.findUniqueOrThrow({ where: { filename: logoUrl.slice('/api/uploads/'.length) } });
      assert.equal(row.organizationId, null);
      assert.equal(row.userId, commonUserId);
      assert.match(logoUrl, /^\/api\/uploads\/[0-9a-f-]{36}\.webp$/);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'UPLOAD_CREATE', resourceId: row.filename } });
      assert.equal(audit.organizationId, null);
      assert.deepEqual(audit.metadata, { sizeBytes: row.sizeBytes, mimeType: 'image/webp', scope: 'platform' });

      // imagem "pesada" (degrade + ruido, 1600x1000): a 1a passada passa de 700 KB; reprocessada cabe em <= 250 KB
      const w = 1600;
      const h = 1000;
      const raw = Buffer.alloc(w * h * 3);
      let seed = 7;
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
      const heavy = await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
        .jpeg({ quality: 92 })
        .withMetadata({ exif: { IFD0: { Copyright: 'segredo-exif' } } })
        .toBuffer();
      assert.ok(heavy.length > 900 * 1024, `entrada ${heavy.length}`);
      const res = await http().post('/api/platform-uploads').set(auth(commonToken)).attach('file', heavy, { filename: 'banner.jpg', contentType: 'image/jpeg' }).expect(201);
      uploadFiles.push(res.body.filename);
      assert.ok(res.body.size <= 250 * 1024, `final ${res.body.size}`);
      assert.equal(res.body.contentType, 'image/webp');
      assert.ok(res.body.width < 1600, `reprocessada menor: ${res.body.width}x${res.body.height}`);
      const got = await http().get(res.body.url).buffer(true).expect(200);
      assert.equal((await sharp(got.body as Buffer).metadata()).exif, undefined, 'EXIF removido');
      console.log('[exemplo] upload de plataforma:', JSON.stringify(res.body));

      process.env.PLATFORM_UPLOAD_MAX_KB = '1';
      try {
        const before = (await fs.readdir(dir)).length;
        const rows = await prisma.upload.count({ where: { userId: commonUserId } });
        const tooBig = await http().post('/api/platform-uploads').set(auth(commonToken)).attach('file', heavy, { filename: 'b.jpg', contentType: 'image/jpeg' }).expect(413);
        assert.match(tooBig.body.message, /mais de 1 KB/);
        assert.equal((await fs.readdir(dir)).length, before, 'nada gravado em disco');
        assert.equal(await prisma.upload.count({ where: { userId: commonUserId } }), rows, 'nada gravado no banco');
      } finally {
        delete process.env.PLATFORM_UPLOAD_MAX_KB;
      }
      // tipo falso por assinatura = 415; o upload de GRUPO continua exigindo token de grupo (PLATFORM => 401)
      await http().post('/api/platform-uploads').set(auth(commonToken)).attach('file', Buffer.from('<svg></svg> nao e imagem'), { filename: 'a.png', contentType: 'image/png' }).expect(415);
      const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).png().toBuffer();
      await http().post('/api/uploads').set(auth(commonToken)).attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(401);
    });

    it('patrocinador: cria normalizado, lista paginada com campaignsCount, lê, edita; validações 400 em português com o campo', async () => {
      const one = await plat(commonToken).get(`/platform-sponsors/${sponsorId}`).expect(200);
      assert.equal(one.body.name, `[e2e-spons] Loja do Berimbau ${stamp}`, 'espaços normalizados');
      assert.equal(one.body.contactEmail, `contato-${stamp}@loja-sigilosa.com.br`);
      assert.equal(one.body.logo, logoUrl);
      assert.equal(one.body.campaignsCount, 0);
      const list = await plat(commonToken).get(`/platform-sponsors?q=${encodeURIComponent(stamp)}&limit=5`).expect(200);
      assert.equal(list.headers['x-total-count'], '1');
      assert.equal(list.body[0].id, sponsorId);

      const bad = async (body: object, field: string) => {
        const res = await plat(commonToken).post('/platform-sponsors', body).expect(400);
        assert.ok(JSON.stringify(res.body.message).includes(field), `${field}: ${JSON.stringify(res.body)}`);
        return res.body;
      };
      await bad({ name: 'x' }, 'name');
      await bad({ name: '<b>Loja</b>' }, 'name');
      await bad({ name: 'Loja', logo: 'https://cdn.exemplo.com.br/logo.png' }, 'logo');
      await bad({ name: 'Loja', logo: '/api/uploads/00000000-0000-4000-8000-000000000000.webp' }, 'logo');
      // imagem de GRUPO (enviada pelo Mestre) nao vale como logo de patrocinador
      const groupPng = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#0a0' } }).png().toBuffer();
      const groupUp = await http().post('/api/uploads').set(auth(mestre.token)).attach('file', groupPng, { filename: 'g.png', contentType: 'image/png' }).expect(201);
      uploadFiles.push(groupUp.body.filename);
      const groupErr = await bad({ name: 'Loja', logo: groupUp.body.url }, 'logo');
      assert.equal(groupErr.field, 'logo');
      await bad({ name: 'Loja', contactEmail: 'nao-e-email' }, 'contactEmail');
      await bad({ name: 'Loja', extra: 1 }, 'extra');
      await bad({ name: 'x'.repeat(81) }, 'name');

      const upd = await plat(commonToken).patch(`/platform-sponsors/${sponsorId}`, { notes: '  Nota   comercial sigilosa  ', contactPhone: '' }).expect(200);
      assert.equal(upd.body.notes, 'Nota comercial sigilosa');
      assert.equal(upd.body.contactPhone, null, 'texto vazio limpa');
      await plat(commonToken).patch(`/platform-sponsors/${sponsorId}`, { name: null }).expect(400);
      await plat(commonToken).get('/platform-sponsors/999999999').expect(404);
    });

    it('excluir: com campanha = 409 SPONSOR_HAS_CAMPAIGNS; sem campanha = 204; auditoria sem contato/documento/notas', async () => {
      const temp = (await plat(commonToken).post('/platform-sponsors', { name: `[e2e-spons] Temp ${stamp}` }).expect(201)).body;
      sponsorIds.push(temp.id);
      const c = await createCampaign({ sponsorId: temp.id });
      const blocked = await plat(commonToken).del(`/platform-sponsors/${temp.id}`).expect(409);
      assert.equal(blocked.body.code, 'SPONSOR_HAS_CAMPAIGNS');
      assert.match(blocked.body.message, /1 campanha/);
      await plat(commonToken).del(`/platform-sponsor-campaigns/${c.id}`).expect(204);
      await plat(commonToken).del(`/platform-sponsors/${temp.id}`).expect(204);
      await plat(commonToken).get(`/platform-sponsors/${temp.id}`).expect(404);
      assert.equal((await prisma.auditLog.count({ where: { action: 'SPONSOR_DELETE', resourceId: String(temp.id) } })), 1);
      const audits = await prisma.auditLog.findMany({ where: { resource: { in: ['sponsor', 'sponsor_campaign'] }, userId: { in: [commonUserId, superUserId] } } });
      assert.ok(audits.length >= 4);
      for (const a of audits) assert.equal(a.organizationId, null, 'ação de plataforma');
      const text = JSON.stringify(audits);
      for (const secret of ['Contato Sigiloso', 'loja-sigilosa', '99999-1234', '12.345.678', 'Nota comercial']) {
        assert.ok(!text.includes(secret), `auditoria contém ${secret}`);
      }
      const create = audits.find((a) => a.action === 'SPONSOR_CREATE' && a.resourceId === String(sponsorId));
      assert.deepEqual(create?.metadata, { fields: ['contactEmail', 'contactName', 'contactPhone', 'document', 'logo', 'name', 'notes'] });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('plataforma: campanhas', () => {
    it('validações 400 (URL do contrato 2.6 com code INVALID_DESTINATION_URL, UFs, categoria, peso, datas, janela, textos, imagem, extra)', async () => {
      const post = (over: Record<string, unknown>) => plat(commonToken).post('/platform-sponsor-campaigns', campaignBody(over));
      for (const destinationUrl of [
        'http://www.loja-exemplo.com.br/',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'https://user:senha@loja-exemplo.com.br/',
        'https://127.0.0.1/admin',
        'https://[::1]/',
        'https://localhost/',
        'https://impressora.local/',
        'https://loja-exemplo.com.br:8443/',
        'https://xn--pple-43d.com/',
        `https://loja-exemplo.com.br/${'a'.repeat(600)}`,
      ]) {
        const res = await post({ destinationUrl }).expect(400);
        assert.equal(res.body.code, 'INVALID_DESTINATION_URL', `${destinationUrl.slice(0, 60)}: ${JSON.stringify(res.body)}`);
        assert.equal(res.body.field, 'destinationUrl');
        assert.match(res.body.message, /^destinationUrl: /);
      }
      const example = await post({ destinationUrl: 'https://usuario:senha@loja.com.br/' }).expect(400);
      console.log('[exemplo] erro de validação de URL:', JSON.stringify(example.body));

      const expect400 = async (over: Record<string, unknown>, field: string) => {
        const res = await post(over).expect(400);
        assert.ok(JSON.stringify(res.body).includes(field), `${field}: ${JSON.stringify(res.body)}`);
      };
      await expect400({ states: ['GO', 'XX'] }, 'states');
      await expect400({ states: 'GO' }, 'states');
      await expect400({ category: 'BEBIDAS_ALCOOLICAS' }, 'category');
      await expect400({ category: 'APOSTAS' }, 'category');
      await expect400({ weight: 0 }, 'weight');
      await expect400({ weight: 11 }, 'weight');
      await expect400({ weight: 2.5 }, 'weight');
      await expect400({ ...window(5, 5) }, 'endsAt');
      await expect400({ ...window(5, 1) }, 'endsAt');
      await expect400({ ...window(0, 367) }, 'endsAt');
      await expect400({ startsAt: '10/11/2026' }, 'startsAt');
      await expect400({ title: 'x' }, 'title');
      await expect400({ title: 'x'.repeat(61) }, 'title');
      await expect400({ text: 'y'.repeat(91) }, 'text');
      await expect400({ text: 'Oferta <img src=x onerror=alert(1)>' }, 'text');
      await expect400({ ctaLabel: 'x' }, 'ctaLabel');
      await expect400({ imageRef: 'https://cdn.exemplo.com/banner.png' }, 'imageRef');
      await expect400({ sponsorId: 999999999 }, 'sponsorId');
      await expect400({ priceCents: -1 }, 'priceCents');
      await expect400({ extra: 'x' }, 'extra');
      await expect400({ destinationUrl: undefined }, 'destinationUrl');
      assert.equal(await prisma.sponsorCampaign.count({ where: { sponsorId, title: { contains: 'x'.repeat(10) } } }), 0, 'nada gravado');
    });

    it('criar: DRAFT, URL normalizada + host, UFs normalizadas, padrões; lista/leitura com effectiveStatus e patrocinador', async () => {
      const image = await platformImage('#aa3366');
      const c = await createCampaign({
        destinationUrl: 'https://WWW.Loja-Exemplo.com.br:443/promo?ref=gingapp',
        states: ['sp', 'GO', 'SP'],
        imageRef: image,
        weight: 3,
        priceCents: 150000,
        billingNote: 'Pago via Pix',
      });
      assert.equal(c.status, 'DRAFT');
      assert.equal(c.effectiveStatus, 'DRAFT');
      assert.equal(c.destinationUrl, 'https://www.loja-exemplo.com.br/promo?ref=gingapp');
      assert.equal(c.destinationHost, 'www.loja-exemplo.com.br');
      assert.deepEqual(c.states, ['GO', 'SP']);
      assert.equal(c.ctaLabel, 'Conhecer');
      assert.equal(c.imageRef, image);
      assert.deepEqual(c.sponsor, { id: sponsorId, name: `[e2e-spons] Loja do Berimbau ${stamp}`, logo: logoUrl });
      assert.equal(c.approvedBy, null);
      const list = await plat(commonToken).get(`/platform-sponsor-campaigns?sponsorId=${sponsorId}&status=DRAFT&limit=50`).expect(200);
      assert.ok(Number(list.headers['x-total-count']) >= 1);
      assert.ok(list.body.some((x: { id: number }) => x.id === c.id));
      await plat(commonToken).get('/platform-sponsor-campaigns?effective=QUALQUER').expect(400);
      await plat(commonToken).get('/platform-sponsor-campaigns/999999999').expect(404);
      await plat(commonToken).del(`/platform-sponsor-campaigns/${c.id}`).expect(204);
    });

    it('ativar: PLATFORM comum = 403 (continua DRAFT); super admin = ACTIVE com aprovador/quando; de novo = 409; pausar/retomar; editar conteúdo volta a DRAFT', async () => {
      const c = await createCampaign();
      const denied = await plat(commonToken).post(`/platform-sponsor-campaigns/${c.id}/activate`).expect(403);
      assert.match(denied.body.message, /super admin/);
      assert.equal((await prisma.sponsorCampaign.findUniqueOrThrow({ where: { id: c.id } })).status, 'DRAFT');

      const on = await plat(superToken).post(`/platform-sponsor-campaigns/${c.id}/activate`).expect(200);
      assert.equal(on.body.status, 'ACTIVE');
      assert.equal(on.body.effectiveStatus, 'ACTIVE_NOW');
      assert.equal(on.body.approvedByUserId, superUserId);
      assert.deepEqual(on.body.approvedBy, { id: superUserId, name: 'E2E Team spons-super' });
      assert.ok(Date.now() - new Date(on.body.approvedAt).getTime() < 60_000);
      const act = await prisma.auditLog.findFirstOrThrow({ where: { action: 'SPONSOR_CAMPAIGN_ACTIVATE', resourceId: String(c.id) } });
      assert.equal(act.userId, superUserId);
      assert.equal(act.organizationId, null);
      assert.deepEqual(act.metadata, { previousStatus: 'DRAFT', status: 'ACTIVE' });
      assert.equal((await plat(superToken).post(`/platform-sponsor-campaigns/${c.id}/activate`).expect(409)).body.code, 'INVALID_TRANSITION');
      console.log('[exemplo] campanha (admin):', JSON.stringify(on.body));

      // pausar e retomar (PLATFORM comum): mantem a aprovacao
      assert.equal((await plat(commonToken).post(`/platform-sponsor-campaigns/${c.id}/pause`).expect(200)).body.effectiveStatus, 'PAUSED');
      assert.equal((await plat(commonToken).post(`/platform-sponsor-campaigns/${c.id}/pause`).expect(409)).body.code, 'INVALID_TRANSITION');
      const resumed = await plat(commonToken).post(`/platform-sponsor-campaigns/${c.id}/resume`).expect(200);
      assert.deepEqual([resumed.body.status, resumed.body.approvedByUserId, resumed.body.approvedAt], ['ACTIVE', superUserId, on.body.approvedAt]);

      // editar NAO-conteudo (peso, UFs, datas) mantem ACTIVE
      const w = await plat(commonToken).patch(`/platform-sponsor-campaigns/${c.id}`, { weight: 5, states: ['GO'] }).expect(200);
      assert.deepEqual([w.body.status, w.body.weight, w.body.states], ['ACTIVE', 5, ['GO']]);
      // mandar o MESMO conteudo nao conta como mudanca
      assert.equal((await plat(commonToken).patch(`/platform-sponsor-campaigns/${c.id}`, { title: c.title }).expect(200)).body.status, 'ACTIVE');
      // editar CONTEUDO volta a DRAFT e limpa a aprovacao; retomar rascunho = 409
      const draft = await plat(commonToken).patch(`/platform-sponsor-campaigns/${c.id}`, { title: `[e2e-spons] Novo título ${stamp}` }).expect(200);
      assert.deepEqual([draft.body.status, draft.body.approvedByUserId, draft.body.approvedAt], ['DRAFT', null, null]);
      const upd = await prisma.auditLog.findFirstOrThrow({ where: { action: 'SPONSOR_CAMPAIGN_UPDATE', resourceId: String(c.id), metadata: { path: ['backToDraft'], equals: true } } });
      assert.deepEqual(upd.metadata, { fields: ['title'], previousStatus: 'ACTIVE', status: 'DRAFT', backToDraft: true });
      assert.match((await plat(commonToken).post(`/platform-sponsor-campaigns/${c.id}/resume`).expect(409)).body.message, /super admin/);

      // PAUSADA + conteudo novo (URL) => DRAFT tambem (retomar exigiria nova aprovacao)
      await plat(superToken).post(`/platform-sponsor-campaigns/${c.id}/activate`).expect(200);
      await plat(commonToken).post(`/platform-sponsor-campaigns/${c.id}/pause`).expect(200);
      const paused = await plat(commonToken).patch(`/platform-sponsor-campaigns/${c.id}`, { destinationUrl: 'https://outra-loja.com.br/' }).expect(200);
      assert.equal(paused.body.status, 'DRAFT');
      for (const action of ['PAUSE', 'RESUME']) {
        assert.ok((await prisma.auditLog.count({ where: { action: `SPONSOR_CAMPAIGN_${action}`, resourceId: String(c.id) } })) >= 1, action);
      }
      await plat(commonToken).del(`/platform-sponsor-campaigns/${c.id}`).expect(204);
    });

    it('janela/status efetivo: SCHEDULED, ACTIVE_NOW, ENDED, DRAFT, PAUSED (filtro effective) e ativar encerrada = 400 CAMPAIGN_ENDED', async () => {
      const scheduled = await activeCampaign({ ...window(2, 5), title: `[e2e-spons] agendada ${stamp}` });
      const now = await activeCampaign({ title: `[e2e-spons] no ar ${stamp}` });
      const paused = await activeCampaign({ title: `[e2e-spons] pausada ${stamp}` });
      await plat(commonToken).post(`/platform-sponsor-campaigns/${paused.id}/pause`).expect(200);
      const draft = await createCampaign({ title: `[e2e-spons] rascunho ${stamp}` });
      const ended = await activeCampaign({ ...window(-5, 1), title: `[e2e-spons] encerrada ${stamp}` });
      // encerra no banco (a API nao deixa ativar campanha ja terminada)
      await prisma.sponsorCampaign.update({ where: { id: ended.id }, data: { startsAt: new Date(Date.now() - 5 * DAY), endsAt: new Date(Date.now() - DAY) } });
      const endedDraft = await createCampaign({ ...window(-5, 1), title: `[e2e-spons] rascunho vencido ${stamp}` });
      await prisma.sponsorCampaign.update({ where: { id: endedDraft.id }, data: { endsAt: new Date(Date.now() - DAY) } });

      assert.equal(scheduled.effectiveStatus, 'SCHEDULED');
      const effOf = async (id: number) => (await plat(commonToken).get(`/platform-sponsor-campaigns/${id}`).expect(200)).body.effectiveStatus;
      assert.deepEqual(
        [await effOf(scheduled.id), await effOf(now.id), await effOf(paused.id), await effOf(draft.id), await effOf(ended.id), await effOf(endedDraft.id)],
        ['SCHEDULED', 'ACTIVE_NOW', 'PAUSED', 'DRAFT', 'ENDED', 'ENDED'],
      );
      const filter = async (effective: string) =>
        (await plat(commonToken).get(`/platform-sponsor-campaigns?effective=${effective}&q=${encodeURIComponent(stamp)}&limit=200`).expect(200)).body.map((x: { id: number }) => x.id);
      assert.ok((await filter('SCHEDULED')).includes(scheduled.id));
      assert.ok(!(await filter('SCHEDULED')).includes(now.id));
      assert.ok((await filter('ACTIVE_NOW')).includes(now.id));
      assert.ok((await filter('PAUSED')).includes(paused.id));
      assert.ok((await filter('DRAFT')).includes(draft.id));
      assert.ok(!(await filter('DRAFT')).includes(endedDraft.id));
      assert.deepEqual((await filter('ENDED')).sort(), [ended.id, endedDraft.id].sort());

      const endedRes = await plat(superToken).post(`/platform-sponsor-campaigns/${endedDraft.id}/activate`).expect(400);
      assert.equal(endedRes.body.code, 'CAMPAIGN_ENDED');

      // limpa (os testes do app exigem um conjunto exato de campanhas ativas)
      for (const c of [scheduled, now, paused, draft, ended, endedDraft]) await plat(commonToken).del(`/platform-sponsor-campaigns/${c.id}`).expect(204);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('app: GET /sponsors/active, impressão e clique', () => {
    let natA: { id: number };
    let goB: { id: number };
    let spC: { id: number };
    let futureD: { id: number };
    let pausedE: { id: number };
    let image: string;

    before(async () => {
      image = await platformImage('#55aa33');
      natA = await activeCampaign({ title: `[e2e-spons] Nacional ${stamp}`, imageRef: image, destinationUrl: 'https://www.loja-exemplo.com.br/oferta?cor=azul#topo' });
      goB = await activeCampaign({ title: `[e2e-spons] Goiás ${stamp}`, states: ['GO'], weight: 9 });
      spC = await activeCampaign({ title: `[e2e-spons] SP e RJ ${stamp}`, states: ['SP', 'RJ'], ctaLabel: 'Ver loja' });
      futureD = await activeCampaign({ title: `[e2e-spons] Futura ${stamp}`, ...window(3, 9) });
      pausedE = await activeCampaign({ title: `[e2e-spons] Pausada ${stamp}` });
      await plat(commonToken).post(`/platform-sponsor-campaigns/${pausedE.id}/pause`).expect(200);
      await createCampaign({ title: `[e2e-spons] Rascunho ${stamp}` });
    });

    /** Ids que o espectador pode receber, varrendo o sorteio com varios valores do RNG. */
    const reachable = async (m: Member, studentId?: number): Promise<number[]> => {
      const ids = new Set<number>();
      for (const r of [0, 0.05, 0.15, 0.35, 0.5, 0.75, 0.95, 0.9999]) {
        sponsorsService.random = () => r;
        const res = await active(m, studentId).expect(200);
        assert.ok(res.body.items.length <= 1);
        for (const item of res.body.items) ids.add(item.id);
      }
      sponsorsService.random = Math.random;
      return [...ids].sort((a, b) => a - b);
    };

    it('formato do SponsorSlide (sem contato/preço/notas/URL), Cache-Control privado e clickPath com a UF', async () => {
      sponsorsService.random = () => 0; // natA (primeira por id, peso 1 de 10)
      const res = await active(mestre).expect(200);
      sponsorsService.random = Math.random;
      assert.equal(res.headers['cache-control'], 'private, max-age=300');
      assert.equal(res.body.items.length, 1);
      const [slide] = res.body.items;
      assert.deepEqual(Object.keys(slide).sort(), ['clickPath', 'ctaLabel', 'id', 'imageUrl', 'logoUrl', 'sponsorName', 'state', 'text', 'title']);
      assert.deepEqual(slide, {
        id: natA.id,
        sponsorName: `[e2e-spons] Loja do Berimbau ${stamp}`,
        logoUrl,
        imageUrl: image,
        title: `[e2e-spons] Nacional ${stamp}`,
        text: 'Berimbaus artesanais com 10% de desconto para capoeiristas.',
        ctaLabel: 'Conhecer',
        clickPath: `/api/sponsors/${natA.id}/click?s=GO`,
        state: 'GO',
      });
      for (const secret of ['loja-sigilosa', 'Contato Sigiloso', '99999-1234', '12.345.678', 'Nota comercial', 'loja-exemplo.com.br', 'approved', 'priceCents', 'weight']) {
        assert.ok(!res.text.includes(secret), `vazou ${secret}`);
      }
      console.log('[exemplo] GET /sponsors/active:', res.text);
      await http().get('/api/sponsors/active').expect(401);
      await http().get('/api/sponsors/active').set(auth(commonToken)).expect(401); // token de plataforma nao tem grupo
      await active(mestre).query({ extra: 1 }).expect(400);
    });

    it('região e peso: GO (unidade principal) vê nacional + GO; SP vê nacional + SP/RJ; sem UF só nacional; UF-sede do grupo como último recurso', async () => {
      assert.deepEqual(await reachable(mestre), [natA.id, goB.id], 'equipe sem aluno: UF da unidade principal (GO)');
      assert.deepEqual(await reachable(adult), [natA.id, spC.id], 'aluno da filial SP');
      assert.deepEqual(await reachable(staffNoDate), [natA.id, goB.id], 'professor com matrícula sem unidade: unidade principal');
      assert.deepEqual(await reachable(spare), [natA.id], 'grupo B sem unidade/UF: só nacional');
      // UF-sede do grupo B (Organization.state) entra quando nao ha unidade
      await prisma.organization.update({ where: { id: orgBId }, data: { state: 'RJ' } });
      assert.deepEqual(await reachable(spare), [natA.id, spC.id]);
      await prisma.organization.update({ where: { id: orgBId }, data: { state: null } });
      const noUf = await active(spare).expect(200);
      assert.ok(noUf.body.items.every((i: { clickPath: string; state: string }) => !i.clickPath.includes('?s=') && i.state === ''), noUf.text);

      // peso: GO = natA (1) + goB (9) => r < 0,1 natA; r >= 0,1 goB
      sponsorsService.random = () => 0.09;
      assert.equal((await active(mestre).expect(200)).body.items[0].id, natA.id);
      sponsorsService.random = () => 0.1;
      assert.equal((await active(mestre).expect(200)).body.items[0].id, goB.id);
      sponsorsService.random = () => 0.99;
      assert.equal((await active(mestre).expect(200)).body.items[0].id, goB.id);
      sponsorsService.random = Math.random;
      // futura, pausada e rascunho nunca aparecem (ja coberto pelo "reachable" acima: so natA/goB/spC)
      assert.ok(![futureD.id, pausedE.id].some((id) => [natA.id, goB.id, spC.id].includes(id)));
    });

    it('MENOR nunca recebe: aluno menor, aluno sem data, ficha menor, órfão ALUNO, dependente menor/sem data via studentId; adulto/equipe/responsável recebem', async () => {
      for (const [who, m, sid] of [
        ['aluno menor', minor, undefined],
        ['aluno sem data', undated, undefined],
        ['ficha (Person) menor vence a matrícula', personMinor, undefined],
        ['ALUNO sem aluno', orphan, undefined],
        ['dependente menor pela ficha', guardian, depMinorId],
        ['dependente sem data', guardian, depUndatedId],
        ['menor pedindo pelo próprio id', minor, minor.studentId],
      ] as Array<[string, Member, number | undefined]>) {
        assert.deepEqual(await reachable(m, sid), [], who);
      }
      assert.deepEqual(await reachable(adult), [natA.id, spC.id], 'adulto');
      assert.deepEqual(await reachable(guardian, depAdultId), [natA.id, spC.id], 'dependente adulto: região da unidade dele (SP)');
      assert.deepEqual(await reachable(guardian), [natA.id, goB.id], 'responsável sem aluno próprio: adulto, unidade principal');
      // studentId alheio (outro grupo / sem vinculo) nao e erro: cai no proprio usuario
      assert.deepEqual(await reachable(adult, strangerBId), [natA.id, spC.id]);
      assert.deepEqual(await reachable(adult, depMinorId), [natA.id, spC.id], 'dependente de OUTRO usuário é ignorado');
      assert.deepEqual(await reachable(minor, depAdultId), [], 'menor não "vira" adulto escolhendo um id alheio');
    });

    it('impressão: 204 sempre; conta só elegível + região + navegador; não conta para menor, robô, sem UA, inelegível; upsert atômico', async () => {
      const before = await statOf(spC.id, 'SP');
      await impression(adult, spC.id).expect(204);
      await impression(adult, spC.id).expect(204);
      // Formato REAL do app: `api.post` sem corpo, mas com `Content-Type: application/json` (nao pode virar 400).
      await impression(adult, spC.id).set('Content-Type', 'application/json').expect(204);
      assert.equal((await statOf(spC.id, 'SP')).impressions, before.impressions + 3);
      // 10 em paralelo: +10 exatos, uma linha so (campanha, dia, UF)
      await Promise.all(Array.from({ length: 10 }, () => impression(adult, spC.id).expect(204)));
      assert.equal((await statOf(spC.id, 'SP')).impressions, before.impressions + 13);
      assert.equal((await stats(spC.id)).filter((r) => r.state === 'SP' && r.day === todaySaoPaulo()).length, 1);

      const totalA = async () => (await stats(natA.id)).reduce((s, r) => s + r.impressions, 0);
      const a0 = await totalA();
      await impression(minor, natA.id).expect(204); // menor
      await impression(undated, natA.id).expect(204); // ALUNO sem data
      await impression(guardian, natA.id, BROWSER_UA, `?studentId=${depMinorId}`).expect(204); // dependente menor
      await impression(adult, natA.id, 'Googlebot/2.1 (+http://www.google.com/bot.html)').expect(204);
      await impression(adult, natA.id, 'curl/8.4.0').expect(204);
      await impression(adult, natA.id, null).expect(204); // sem User-Agent
      await impression(mestre, spC.id).expect(204); // regiao GO: spC nao aparece para ele
      await impression(adult, futureD.id).expect(204);
      await impression(adult, pausedE.id).expect(204);
      await impression(adult, 999999999).expect(204);
      assert.equal(await totalA(), a0, 'nada contou na nacional');
      assert.equal((await statOf(spC.id, 'GO')).impressions, 0);
      assert.equal((await stats(futureD.id)).length + (await stats(pausedE.id)).length, 0);
      // conta para quem pode: responsavel pelo dependente adulto (UF SP), equipe sem data (GO)
      await impression(guardian, natA.id, BROWSER_UA, `?studentId=${depAdultId}`).expect(204);
      await impression(staffNoDate, natA.id).expect(204);
      assert.equal((await statOf(natA.id, 'SP')).impressions, 1);
      assert.equal((await statOf(natA.id, 'GO')).impressions, 1);

      // corpo/campo extra = 400; id nao numerico = 400; sem token = 401
      await impression(adult, natA.id).send({ x: 1 }).expect(400);
      await impression(adult, natA.id).send([1]).expect(400);
      await impression(adult, natA.id, BROWSER_UA, '?foo=1').expect(400);
      await http().post('/api/sponsors/abc/impression').set(auth(adult.token)).set('User-Agent', BROWSER_UA).expect(400);
      await http().post(`/api/sponsors/${natA.id}/impression`).set('User-Agent', BROWSER_UA).expect(401);
      assert.equal(await totalA(), a0 + 2);
    });

    it('clique PÚBLICO: 302 para a URL GRAVADA + utm (query/fragmento preservados), cabeçalhos, conta (UF de `s`), `?url=` não muda o destino', async () => {
      const c0 = await statOf(natA.id, 'GO');
      const res = await click(natA.id, '?s=GO').expect(302);
      const expected = `https://www.loja-exemplo.com.br/oferta?cor=azul&utm_source=gingapp&utm_medium=parceiro&utm_campaign=c${natA.id}#topo`;
      assert.equal(res.headers.location, expected);
      assert.equal(res.headers['referrer-policy'], 'no-referrer');
      assert.equal(res.headers['x-robots-tag'], 'noindex');
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.equal((await statOf(natA.id, 'GO')).clicks, c0.clicks + 1);
      console.log('[exemplo] clique 302:', JSON.stringify({ status: res.status, location: res.headers.location, 'referrer-policy': res.headers['referrer-policy'], 'x-robots-tag': res.headers['x-robots-tag'], 'cache-control': res.headers['cache-control'] }));

      // tentativa de open redirect: parametros extras sao ignorados
      for (const q of ['?url=https://evil.example.com', '?s=GO&url=https%3A%2F%2Fevil.example.com&next=//evil.example.com', '?redirect=javascript:alert(1)']) {
        assert.equal((await click(natA.id, q).expect(302)).headers.location, expected, q);
      }
      // s invalida / ausente / repetida => UF '' ; minuscula valida => normalizada
      const blank0 = (await statOf(natA.id, '')).clicks;
      await click(natA.id, '?s=XX').expect(302);
      await click(natA.id).expect(302);
      await click(natA.id, '?s=GO&s=SP').expect(302);
      await click(natA.id, `?s=${'%27%3B--'}`).expect(302);
      assert.equal((await statOf(natA.id, '')).clicks, blank0 + 4, 's inválida/ausente/repetida conta em ""');
      await click(natA.id, '?s=sp').expect(302);
      assert.ok((await statOf(natA.id, 'SP')).clicks >= 1);
      // URL sem query: utm vira a query
      assert.equal(
        (await click(spC.id, '?s=SP').expect(302)).headers.location,
        `https://www.loja-exemplo.com.br/berimbau?utm_source=gingapp&utm_medium=parceiro&utm_campaign=c${spC.id}`,
      );
    });

    it('clique inelegível/inexistente/id inválido = 302 para o app sem contar; sem APP_URL = 404; SPONSORS_ENABLED=false desliga tudo', async () => {
      const allClicks = async () => (await prisma.sponsorStatDay.aggregate({ where: { campaignId: { in: [futureD.id, pausedE.id] } }, _sum: { clicks: true } }))._sum.clicks ?? 0;
      for (const id of [futureD.id, pausedE.id, 999999999, 'abc', '0', '-1', '1e3']) {
        const res = await click(id, '?s=GO').expect(302);
        assert.equal(res.headers.location, APP_HOME, String(id));
        assert.equal(res.headers['referrer-policy'], 'no-referrer');
      }
      assert.equal(await allClicks(), 0);

      delete process.env.APP_URL;
      try {
        const nf = await click(futureD.id).expect(404);
        assert.equal(nf.headers['cache-control'], 'no-store');
      } finally {
        process.env.APP_URL = envBackup.APP_URL;
      }

      const a = await statOf(natA.id, 'SP');
      process.env.SPONSORS_ENABLED = 'false';
      try {
        assert.deepEqual((await active(adult).expect(200)).body, { items: [] });
        await impression(adult, natA.id).expect(204);
        assert.equal((await click(natA.id, '?s=SP').expect(302)).headers.location, APP_HOME);
        const after = await statOf(natA.id, 'SP');
        assert.deepEqual([after.impressions, after.clicks], [a.impressions, a.clicks], 'nada contou desligado');
      } finally {
        delete process.env.SPONSORS_ENABLED;
      }
      assert.equal((await active(adult).expect(200)).body.items.length, 1, 'religado');
    });

    it('PROVA de privacidade: SponsorStatDay só tem (campanha, dia, UF, números); nada de usuário/IP/UA em linhas, auditoria ou log', async () => {
      const marker = `E2E-SPONS-UA-${stamp}`;
      const ua = `Mozilla/5.0 (Linux; Android 14; ${marker}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36`;
      const t0 = new Date(Date.now() - 1000);
      const captured: string[] = [];
      const out = process.stdout.write.bind(process.stdout);
      process.env.REQUEST_LOG = 'true';
      process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
        captured.push(String(chunk));
        return (out as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof process.stdout.write;
      try {
        await active(adult).set('User-Agent', ua).expect(200);
        await impression(adult, spC.id, ua).expect(204);
        await impression(guardian, natA.id, ua, `?studentId=${depAdultId}`).expect(204);
        await click(spC.id, '?s=SP', ua).set('X-Forwarded-For', '198.51.100.77').expect(302);
        await click(natA.id, '?s=GO', ua).expect(302);
      } finally {
        process.stdout.write = out as typeof process.stdout.write;
        process.env.REQUEST_LOG = envBackup.REQUEST_LOG ?? 'false';
      }

      // 1) colunas de SponsorStatDay: exatamente estas (nenhum identificador)
      const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'SponsorStatDay' ORDER BY column_name`,
      );
      assert.deepEqual(cols.map((c) => c.column_name).sort(), ['campaignId', 'clicks', 'day', 'id', 'impressions', 'state']);
      // e todas as linhas das campanhas deste spec: UF valida ou '', dia AAAA-MM-DD, numeros
      const rows = await prisma.sponsorStatDay.findMany({ where: { campaign: { sponsorId: { in: sponsorIds } } } });
      assert.ok(rows.length >= 4, `linhas: ${rows.length}`);
      for (const r of rows) {
        assert.match(r.day, /^\d{4}-\d{2}-\d{2}$/);
        assert.match(r.state, /^([A-Z]{2})?$/);
        assert.ok(Number.isInteger(r.impressions) && Number.isInteger(r.clicks));
      }

      // 2) auditoria: impressao/clique nao gravam NADA (nenhuma linha nova de nenhum ator desta parte)
      const mine = await prisma.auditLog.findMany({ where: { createdAt: { gte: t0 }, userId: { in: userIds } } });
      assert.deepEqual(mine, [], JSON.stringify(mine));
      const auditText = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM "AuditLog" WHERE row_to_json("AuditLog")::text LIKE $1 OR row_to_json("AuditLog")::text LIKE $2`,
        `%${marker}%`,
        '%198.51.100.77%',
      );
      assert.equal(Number(auditText[0].n), 0);

      // 3) banco inteiro: o User-Agent e o IP enviados nao aparecem em NENHUMA tabela (controle positivo antes)
      const control = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM "Sponsor" t WHERE row_to_json(t)::text LIKE $1`,
        `%Loja do Berimbau ${stamp}%`,
      );
      assert.equal(Number(control[0].n), 1, 'a varredura por row_to_json encontra o que existe');
      const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      assert.ok(tables.some((t) => t.table_name === 'SponsorStatDay'));
      for (const { table_name } of tables) {
        for (const needle of [marker, '198.51.100.77']) {
          const found = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
            `SELECT count(*)::bigint AS n FROM "${table_name}" t WHERE row_to_json(t)::text LIKE $1`,
            `%${needle}%`,
          );
          assert.equal(Number(found[0].n), 0, `${table_name} contém ${needle}`);
        }
      }
      console.log(`[privacidade] ${tables.length} tabelas varridas: 0 ocorrências do User-Agent/IP enviados`);

      // 4) log de requisicao: linhas das rotas /api/sponsors/* SEM userId e SEM ip; nada do UA
      // (o stdout capturado tambem tem a saida do runner de testes: so as linhas JSON do log de requisicao contam)
      const lines = (captured.join('').match(/\{"ts":"[^\n]*?"msg":"http_request"[^\n]*?\}(?=\n|$)/g) ?? []).map((l) => JSON.parse(l));
      const sponsorLines = lines.filter((l) => String(l.route).startsWith('/api/sponsors/'));
      assert.deepEqual(sponsorLines.map((l) => l.route).sort(), [
        '/api/sponsors/:id/click', '/api/sponsors/:id/click', '/api/sponsors/:id/impression', '/api/sponsors/:id/impression', '/api/sponsors/active',
      ]);
      for (const l of sponsorLines) assert.deepEqual([l.userId, l.ip], [null, null], JSON.stringify(l));
      assert.ok(!captured.join('').includes(marker), 'o log não contém o User-Agent');
      assert.ok(!captured.join('').includes('198.51.100.77'), 'o log não contém o IP');
    });

    it('throttle: impressão 429 por USUÁRIO (outro usuário do mesmo IP segue); clique 429 por IP', async () => {
      process.env.SPONSOR_IMPRESSION_THROTTLE_LIMIT = '2';
      try {
        await impression(orphan, natA.id).expect(204);
        await impression(orphan, natA.id).expect(204);
        const limited = await impression(orphan, natA.id).expect(429);
        assert.equal(limited.body.code, 'TOO_MANY_REQUESTS');
        assert.equal(limited.body.message, 'Muitas tentativas. Aguarde um minuto.');
        await impression(spare, natA.id).expect(204);
      } finally {
        process.env.SPONSOR_IMPRESSION_THROTTLE_LIMIT = '1000';
      }
      process.env.SPONSOR_CLICK_THROTTLE_LIMIT = '2';
      try {
        // o contador do IP ja tem os cliques dos testes anteriores (mesmo minuto): o 429 vem no maximo na 3a tentativa
        const statuses: number[] = [];
        for (let i = 0; i < 3; i += 1) statuses.push((await click(natA.id, '?s=GO')).status);
        assert.equal(statuses[statuses.length - 1], 429, statuses.join(','));
        const limited = await click(natA.id, '?s=GO').expect(429);
        assert.equal(limited.body.code, 'TOO_MANY_REQUESTS');
      } finally {
        process.env.SPONSOR_CLICK_THROTTLE_LIMIT = '5000';
      }
    });

    it('relatório JSON/CSV: totais, CTR, byDay, byState, filtro de período, injeção de fórmula; MEMBER 403', async () => {
      const formulaSponsor = (await plat(commonToken).post('/platform-sponsors', { name: `+SOMA(1;2) [e2e-spons] ${stamp}` }).expect(201)).body;
      sponsorIds.push(formulaSponsor.id);
      const rep = await createCampaign({ sponsorId: formulaSponsor.id, title: '=HYPERLINK("https://x.y";"a")', ...window(-30, 30) });
      await prisma.sponsorStatDay.createMany({
        data: [
          { campaignId: rep.id, day: '2026-10-01', state: 'SP', impressions: 100, clicks: 3 },
          { campaignId: rep.id, day: '2026-10-01', state: 'RJ', impressions: 50, clicks: 1 },
          { campaignId: rep.id, day: '2026-10-02', state: 'SP', impressions: 10, clicks: 0 },
          { campaignId: rep.id, day: '2026-10-03', state: '', impressions: 5, clicks: 1 },
        ],
      });
      const res = await plat(commonToken).get(`/platform-sponsor-campaigns/${rep.id}/report`).expect(200);
      assert.deepEqual(res.body.totals, { impressions: 165, clicks: 5, ctr: 3.03 });
      assert.deepEqual(res.body.byDay, [
        { day: '2026-10-01', impressions: 150, clicks: 4 },
        { day: '2026-10-02', impressions: 10, clicks: 0 },
        { day: '2026-10-03', impressions: 5, clicks: 1 },
      ]);
      assert.deepEqual(res.body.byState, [
        { state: 'SP', impressions: 110, clicks: 3 },
        { state: 'RJ', impressions: 50, clicks: 1 },
        { state: '', impressions: 5, clicks: 1 },
      ]);
      assert.deepEqual(Object.keys(res.body.campaign).sort(), ['endsAt', 'id', 'sponsorName', 'startsAt', 'status', 'title']);
      assert.equal(res.body.campaign.sponsorName, `+SOMA(1;2) [e2e-spons] ${stamp}`);
      console.log('[exemplo] relatório:', res.text);

      const period = await plat(commonToken).get(`/platform-sponsor-campaigns/${rep.id}/report?from=2026-10-02&to=2026-10-02`).expect(200);
      assert.deepEqual(period.body.totals, { impressions: 10, clicks: 0, ctr: 0 });
      assert.deepEqual(period.body.byState, [{ state: 'SP', impressions: 10, clicks: 0 }]);
      const fromOnly = await plat(commonToken).get(`/platform-sponsor-campaigns/${rep.id}/report?from=2026-10-02`).expect(200);
      assert.deepEqual(fromOnly.body.totals, { impressions: 15, clicks: 1, ctr: 6.67 });
      const empty = await plat(commonToken).get(`/platform-sponsor-campaigns/${rep.id}/report?from=2027-01-01&to=2027-01-31`).expect(200);
      assert.deepEqual([empty.body.totals, empty.body.byDay, empty.body.byState], [{ impressions: 0, clicks: 0, ctr: 0 }, [], []]);
      for (const q of ['?from=2026-13-01', '?to=01/10/2026', '?from=2026-10-05&to=2026-10-01', '?x=1']) {
        await plat(commonToken).get(`/platform-sponsor-campaigns/${rep.id}/report${q}`).expect(400);
      }
      await plat(commonToken).get('/platform-sponsor-campaigns/999999999/report').expect(404);
      await plat(mestre.token).get(`/platform-sponsor-campaigns/${rep.id}/report`).expect(403);

      const csv = await plat(commonToken).get(`/platform-sponsor-campaigns/${rep.id}/report.csv?from=2026-10-01&to=2026-10-03`).buffer(true).expect(200);
      assert.match(csv.headers['content-type'], /^text\/csv; charset=utf-8/);
      assert.match(csv.headers['content-disposition'], new RegExp(`attachment; filename="patrocinio-c${rep.id}-\\d{4}-\\d{2}-\\d{2}\\.csv"`));
      assert.equal(csv.headers['cache-control'], 'no-store');
      const text = csv.text;
      assert.ok(text.startsWith('﻿'), 'BOM');
      const lines = text.slice(1).split('\r\n');
      assert.equal(lines[0], 'Seção;Chave;Título;Patrocinador;Impressões;Cliques;CTR (%)');
      assert.ok(lines.includes(`Campanha;c${rep.id};"'=HYPERLINK(""https://x.y"";""a"")";"'+SOMA(1;2) [e2e-spons] ${stamp}";;;`), lines.join('\n'));
      assert.ok(lines.includes('Total;;;;165;5;3,03'), lines.join('\n'));
      assert.ok(lines.includes('Dia;2026-10-01;;;150;4;2,67'));
      assert.ok(lines.includes('UF;SP;;;110;3;2,73'));
      assert.ok(lines.includes('UF;Não identificada;;;5;1;20,00'));
      assert.ok(!/(^|;)[=+\-@]/.test(lines.slice(1).join('\n')), 'nenhuma célula começa com gatilho de fórmula');
      await plat(mestre.token).get(`/platform-sponsor-campaigns/${rep.id}/report.csv`).expect(403);
      // excluir a campanha apaga as estatisticas
      await plat(commonToken).del(`/platform-sponsor-campaigns/${rep.id}`).expect(204);
      assert.equal(await prisma.sponsorStatDay.count({ where: { campaignId: rep.id } }), 0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('coletor de imagens órfãs (UPLOADS_GC)', () => {
    it('varre Sponsor.logo e SponsorCampaign.imageRef: imagens de patrocinador referenciadas ficam; órfã de plataforma é coletada', async () => {
      const old = new Date(Date.now() - 5 * DAY);
      const make = async () => {
        const filename = `${randomUUID()}.webp`;
        const data = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#123456' } }).webp().toBuffer();
        const full = path.join(dir, filename);
        await fs.writeFile(full, data);
        await fs.utimes(full, old, old);
        await prisma.upload.create({ data: { organizationId: null, userId: commonUserId, filename, mimeType: 'image/webp', sizeBytes: data.length, createdAt: old } });
        uploadFiles.push(filename);
        return filename;
      };
      const logoFile = await make();
      const campaignFile = await make();
      const orphanFile = await make();
      const gcSponsor = (await plat(commonToken).post('/platform-sponsors', { name: `[e2e-spons] GC ${stamp}`, logo: `/api/uploads/${logoFile}` }).expect(201)).body;
      sponsorIds.push(gcSponsor.id);
      const gcCampaign = await createCampaign({ sponsorId: gcSponsor.id, imageRef: `/api/uploads/${campaignFile}` });

      const service = new UploadsGcCronService(app.get(PrismaService));
      const referenced = await service.referencedFilenames();
      assert.ok(referenced.has(logoFile), 'Sponsor.logo é varrido');
      assert.ok(referenced.has(campaignFile), 'SponsorCampaign.imageRef é varrido');
      assert.ok(!referenced.has(orphanFile));

      process.env.UPLOADS_GC = 'true';
      let result;
      try {
        result = await service.run({ dir, organizationId: null });
      } finally {
        process.env.UPLOADS_GC = 'false';
      }
      assert.ok(result, 'o GC rodou');
      const exists = (f: string) => fs.stat(path.join(dir, f)).then(() => true, () => false);
      for (const kept of [logoFile, campaignFile]) {
        assert.ok(await exists(kept), `${kept} referenciada deve ficar`);
        assert.equal(await prisma.upload.count({ where: { filename: kept } }), 1);
      }
      assert.equal(await exists(orphanFile), false, 'a órfã é coletada (o GC estava ativo)');
      assert.equal(await prisma.upload.count({ where: { filename: orphanFile } }), 0);
      await plat(commonToken).del(`/platform-sponsor-campaigns/${gcCampaign.id}`).expect(204);
    });
  });
});
