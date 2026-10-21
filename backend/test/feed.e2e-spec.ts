import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import request from 'supertest';
import { AnonymizationService } from '../src/interface/http/data-deletion-requests/anonymization.service';
import { mediaSignature, resolveFeedMediaDir } from '../src/interface/http/feed/feed-media-storage';
import { FeedMediaCleanupCronService } from '../src/jobs/feed-media-cleanup-cron.service';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { DEV_PASSWORD } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Feed do grupo (docs/CONTRATO_FEED_ANIVERSARIOS_COMUNICACAO.md secao 4). Grupos, unidades, turmas, usuarios e
 * diretorios PROPRIOS (UPLOADS_DIR/PRIVATE_UPLOADS_DIR temporarios; FEED_MEDIA_DIR = padrao <privado>/feed). Nao toca no
 * seed. Limpa tudo (banco + disco) no after() e confere por consulta.
 */
const DOMAIN = '@e2e-feed.local';
const SECRET = `CONTEUDO-SECRETO-${Date.now()}`;

type Member = { id: number; token: string };
type Post = { id: number; status: string; visibility: string; media: Array<{ id: number; url: string; thumbUrl: string; width: number; height: number }>; [k: string]: unknown };

describe('Feed do grupo (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  let seq = 0;
  let uploadsDir = '';
  let privateDir = '';
  let feedDir = '';
  let orgA = 0;
  let orgB = 0;
  let u1 = 0;
  let u2 = 0;
  let unitB = 0;
  let c1 = 0;
  let c2 = 0;
  const personIds: number[] = [];
  const userIds: number[] = [];
  const m = {} as Record<'mestre' | 'prof1' | 'prof2' | 'monitor' | 'adult' | 'minor' | 'resp' | 'u2' | 'extra' | 'lgpd' | 'mestreB' | 'alunoB', Member>;
  const oldEnv: Record<string, string | undefined> = {};

  const withEnv = async <T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> => {
    const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(old)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  const login = async (email: string) => (await http().post('/api/auth/login').send({ email, password: DEV_PASSWORD }).expect(200)).body.accessToken as string;
  const member = async (org: number, role: OrgRole, tag: string, birthDate?: Date | null): Promise<Member> => {
    const user = await prisma.user.create({
      data: { email: `${tag}-${stamp}${DOMAIN}`, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `[e2e-feed] ${tag}`, userType: 'MEMBER' },
    });
    userIds.push(user.id);
    await prisma.organizationUser.create({ data: { organizationId: org, userId: user.id, role, status: 'ACTIVE' } });
    if (birthDate !== undefined) {
      const p = await prisma.person.create({ data: { gingappCode: `E2EFEED-${stamp}-${++seq}`, name: `[e2e-feed] ${tag}`, nickname: tag, birthDate, userId: user.id } });
      personIds.push(p.id);
    }
    return { id: user.id, token: await login(user.email) };
  };
  const student = async (org: number, unitId: number, userId: number | null, tag: string, classId?: number) => {
    const s = await prisma.student.create({ data: { organizationId: org, unitId, userId, name: `[e2e-feed] aluno ${tag}`, status: 'ACTIVE' } });
    if (classId) await prisma.classStudent.create({ data: { organizationId: org, classId, studentId: s.id, status: 'ACTIVE' } });
    return s;
  };

  const settings = (body: Record<string, unknown>) => http().put('/api/feed/settings').set(auth(m.mestre.token)).send(body).expect(200);
  const post = (who: Member, body: Record<string, unknown>) => http().post('/api/feed/posts').set(auth(who.token)).send(body);
  const created = async (who: Member, body: Record<string, unknown>): Promise<Post> => (await post(who, body).expect(201)).body as Post;
  const upload = (who: Member, buf: Buffer, filename = 'foto.jpg', contentType = 'image/jpeg') =>
    http().post('/api/feed/media').set(auth(who.token)).attach('file', buf, { filename, contentType });
  const binary = (url: string) =>
    http()
      .get(url)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  const jpeg = (w = 120, h = 80) => sharp({ create: { width: w, height: h, channels: 3, background: '#3a6' } }).jpeg().toBuffer();
  /** Todos os ids do feed do usuario (segue o cursor ate o fim). */
  const seen = async (who: Member): Promise<Map<number, Post>> => {
    const out = new Map<number, Post>();
    let cursor: string | null = null;
    for (let i = 0; i < 50; i++) {
      const res = await http().get('/api/feed').query({ limit: 30, ...(cursor ? { cursor } : {}) }).set(auth(who.token)).expect(200);
      for (const p of res.body.items as Post[]) out.set(p.id, p);
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    return out;
  };
  const notifications = (userId: number, type: string) => prisma.notification.findMany({ where: { userId, type }, orderBy: { id: 'asc' } });
  const mediaPaths = async (mediaId: number) => {
    const row = await prisma.feedPostMedia.findUniqueOrThrow({ where: { id: mediaId } });
    return [path.join(feedDir, ...row.storageKey.split('/')), path.join(feedDir, ...row.thumbKey.split('/'))];
  };
  const exists = (p: string) => fs.stat(p).then(() => true, () => false);

  before(async () => {
    uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-feed-pub-'));
    privateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-feed-priv-'));
    for (const k of ['UPLOADS_DIR', 'PRIVATE_UPLOADS_DIR', 'FEED_MEDIA_DIR', 'FEED_POSTS_PER_DAY', 'FEED_COMMENTS_PER_DAY']) oldEnv[k] = process.env[k];
    process.env.UPLOADS_DIR = uploadsDir;
    process.env.PRIVATE_UPLOADS_DIR = privateDir;
    delete process.env.FEED_MEDIA_DIR;
    process.env.FEED_POSTS_PER_DAY = '500';
    process.env.FEED_COMMENTS_PER_DAY = '500';
    feedDir = resolveFeedMediaDir();
    assert.equal(feedDir, path.join(privateDir, 'feed'), 'padrao: subpasta "feed" do diretorio privado');
    app = await createTestApp();

    // Grupo A usa o PADRAO do banco (feed DESLIGADO; o primeiro teste confere e liga pelo Mestre); o B liga direto.
    orgA = (await prisma.organization.create({ data: { name: `E2E feed A ${stamp}`, slug: `e2e-feed-a-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE } })).id;
    orgB = (await prisma.organization.create({ data: { name: `E2E feed B ${stamp}`, slug: `e2e-feed-b-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE, feedEnabled: true } })).id;
    u1 = (await prisma.unit.create({ data: { organizationId: orgA, name: 'Unidade 1' } })).id;
    u2 = (await prisma.unit.create({ data: { organizationId: orgA, name: 'Unidade 2' } })).id;
    unitB = (await prisma.unit.create({ data: { organizationId: orgB, name: 'Unidade B' } })).id;

    const adult = new Date('1990-05-10T00:00:00Z');
    const minorBirth = new Date(Date.UTC(new Date().getUTCFullYear() - 12, 0, 15));
    m.mestre = await member(orgA, OrgRole.MESTRE, 'mestre', adult);
    m.prof1 = await member(orgA, OrgRole.PROFESSOR, 'prof1', adult);
    m.prof2 = await member(orgA, OrgRole.PROFESSOR, 'prof2', adult);
    m.monitor = await member(orgA, OrgRole.MONITOR, 'monitor', adult);
    m.adult = await member(orgA, OrgRole.ALUNO, 'adulto', adult);
    m.minor = await member(orgA, OrgRole.ALUNO, 'menor', minorBirth);
    m.resp = await member(orgA, OrgRole.RESPONSAVEL, 'resp');
    m.u2 = await member(orgA, OrgRole.ALUNO, 'alunou2', adult);
    m.extra = await member(orgA, OrgRole.ALUNO, 'extra', adult);
    m.lgpd = await member(orgA, OrgRole.ALUNO, 'lgpd', adult);
    m.mestreB = await member(orgB, OrgRole.MESTRE, 'mestreb', adult);
    m.alunoB = await member(orgB, OrgRole.ALUNO, 'alunob', adult);
    await prisma.userUnitAccess.create({ data: { organizationId: orgA, userId: m.prof1.id, unitId: u1 } });
    await prisma.userUnitAccess.create({ data: { organizationId: orgA, userId: m.prof2.id, unitId: u2 } });
    c1 = (await prisma.class.create({ data: { organizationId: orgA, unitId: u1, name: 'Turma 1', teacherUserId: m.prof1.id, autoGenerateLessons: false } })).id;
    c2 = (await prisma.class.create({ data: { organizationId: orgA, unitId: u2, name: 'Turma 2', autoGenerateLessons: false } })).id;
    await student(orgA, u1, m.adult.id, 'adulto', c1);
    const minorStudent = await student(orgA, u1, m.minor.id, 'menor', c1);
    await prisma.studentGuardian.create({ data: { organizationId: orgA, studentId: minorStudent.id, userId: m.resp.id, name: '[e2e-feed] resp' } });
    await student(orgA, u2, m.u2.id, 'u2', c2);
    await student(orgA, u1, m.extra.id, 'extra');
    await student(orgA, u1, m.lgpd.id, 'lgpd');
    await student(orgB, unitB, m.alunoB.id, 'b');
  });

  after(async () => {
    const orgs = [orgA, orgB].filter(Boolean);
    await prisma.feedReport.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.feedReaction.deleteMany({ where: { post: { organizationId: { in: orgs } } } });
    await prisma.feedActivityNotice.deleteMany({ where: { post: { organizationId: { in: orgs } } } });
    await prisma.feedComment.deleteMany({ where: { organizationId: { in: orgs }, parentId: { not: null } } });
    await prisma.feedComment.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.feedPostMedia.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.feedPost.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.notification.deleteMany({ where: { OR: [{ organizationId: { in: orgs } }, { userId: { in: userIds } }] } });
    await prisma.announcement.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: orgs } }, { userId: { in: userIds } }] } });
    await prisma.dataDeletionRequest.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.studentGuardian.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.classStudent.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.student.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.class.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.userUnitAccess.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.unit.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.person.deleteMany({ where: { id: { in: personIds } } });
    await prisma.organizationUser.deleteMany({ where: { OR: [{ organizationId: { in: orgs } }, { userId: { in: userIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
    await fs.rm(uploadsDir, { recursive: true, force: true });
    await fs.rm(privateDir, { recursive: true, force: true });
    // Conferencia por consulta (2a via): nada do spec ficou no banco nem no disco.
    const left = await Promise.all([
      prisma.feedPost.count({ where: { organizationId: { in: orgs } } }),
      prisma.feedPostMedia.count({ where: { organizationId: { in: orgs } } }),
      prisma.feedComment.count({ where: { organizationId: { in: orgs } } }),
      prisma.feedReport.count({ where: { organizationId: { in: orgs } } }),
      prisma.user.count({ where: { id: { in: userIds } } }),
      prisma.organization.count({ where: { id: { in: orgs } } }),
      prisma.person.count({ where: { id: { in: personIds } } }),
      prisma.notification.count({ where: { userId: { in: userIds } } }),
    ]);
    assert.deepEqual(left, [0, 0, 0, 0, 0, 0, 0, 0], 'limpeza do banco');
    assert.equal(await exists(privateDir), false, 'limpeza do disco');
    for (const [k, v] of Object.entries(oldEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('A1: o feed nasce DESLIGADO no grupo novo (padrao do banco); nada de postar/ler ate o Mestre ligar', async () => {
    const row = await prisma.organization.findUniqueOrThrow({ where: { id: orgA }, select: { feedEnabled: true, feedPostingMode: true } });
    assert.deepEqual(row, { feedEnabled: false, feedPostingMode: 'MODERATED' });
    const aluno = (await http().get('/api/feed/settings').set(auth(m.adult.token)).expect(200)).body;
    assert.deepEqual(aluno, { enabled: false, postingMode: 'MODERATED', canPost: false, allowComments: true, requiresApproval: true });
    assert.equal((await post(m.prof1, { body: 'foto da turma infantil', visibility: 'GROUP' }).expect(403)).body.code, 'FEED_DISABLED', 'professor nao posta com o feed desligado');
    assert.equal((await http().get('/api/feed').set(auth(m.adult.token)).expect(403)).body.code, 'FEED_DISABLED');
    assert.equal(await prisma.feedPost.count({ where: { organizationId: orgA } }), 0);
    // so o Mestre liga (em Configuracoes do feed)
    await http().put('/api/feed/settings').set(auth(m.prof1.token)).send({ enabled: true }).expect(403);
    assert.equal((await settings({ enabled: true })).body.enabled, true);
  });

  it('configuracoes: padrao MODERATED; requiresApproval por usuario; so o MESTRE le/grava as palavras; auditoria sem as palavras', async () => {
    const aluno = (await http().get('/api/feed/settings').set(auth(m.adult.token)).expect(200)).body;
    assert.deepEqual(aluno, { enabled: true, postingMode: 'MODERATED', canPost: true, allowComments: true, requiresApproval: true });
    assert.equal((await http().get('/api/feed/settings').set(auth(m.mestre.token)).expect(200)).body.requiresApproval, false);
    assert.equal((await http().get('/api/feed/settings').set(auth(m.prof1.token)).expect(200)).body.requiresApproval, false);
    assert.equal((await http().get('/api/feed/settings').set(auth(m.monitor.token)).expect(200)).body.requiresApproval, true, 'MONITOR conta como membro');
    for (const who of [m.adult, m.prof1, m.monitor]) {
      await http().get('/api/feed/settings/admin').set(auth(who.token)).expect(403);
      await http().put('/api/feed/settings').set(auth(who.token)).send({ enabled: false }).expect(403);
    }
    const saved = await settings({ blockedWords: ['Palavrão', ' palavrao ', '', 'xingo feio'] });
    assert.deepEqual(saved.body.blockedWords, ['Palavrão', 'xingo feio']);
    assert.deepEqual((await http().get('/api/feed/settings/admin').set(auth(m.mestre.token)).expect(200)).body.blockedWords, ['Palavrão', 'xingo feio']);
    await http().put('/api/feed/settings').set(auth(m.mestre.token)).send({ blockedWords: Array.from({ length: 51 }, (_, i) => `p${i}`) }).expect(400);
    await http().put('/api/feed/settings').set(auth(m.mestre.token)).send({ blockedWords: ['x'.repeat(41)] }).expect(400);
    await http().put('/api/feed/settings').set(auth(m.mestre.token)).send({ postingMode: 'QUALQUER' }).expect(400);
    // alias PUT /feed/settings/admin
    await http().put('/api/feed/settings/admin').set(auth(m.mestre.token)).send({ allowComments: true }).expect(200);
    const audit = await prisma.auditLog.findMany({ where: { organizationId: orgA, action: 'FEED_SETTINGS_UPDATE' } });
    assert.ok(audit.length >= 2);
    assert.ok(audit.every((a) => !JSON.stringify(a.metadata).toLowerCase().includes('palavr')), 'palavras nao vao para a auditoria');
  });

  it('postar: MODERATED/ALL/STAFF_ONLY, menor sempre pendente, palavra bloqueada, limites, corpo vazio, feed desligado', async () => {
    assert.equal((await created(m.adult, { body: `aluno moderado ${SECRET}`, visibility: 'GROUP' })).status, 'PENDING_APPROVAL');
    assert.equal((await created(m.monitor, { body: `monitor ${SECRET}`, visibility: 'GROUP' })).status, 'PENDING_APPROVAL');
    assert.equal((await created(m.prof1, { body: `prof ${SECRET}`, visibility: 'GROUP' })).status, 'PUBLISHED');
    const resp = await created(m.resp, { body: `responsavel ${SECRET}`, visibility: 'GROUP' });
    assert.equal(resp.status, 'PENDING_APPROVAL');

    await settings({ postingMode: 'ALL' });
    assert.equal((await created(m.adult, { body: `aluno livre ${SECRET}`, visibility: 'GROUP' })).status, 'PUBLISHED');
    const minor = await created(m.minor, { body: `menor ${SECRET}`, visibility: 'GROUP' });
    assert.equal(minor.status, 'PENDING_APPROVAL', 'menor de 18 SEMPRE pendente');
    assert.equal((await http().get('/api/feed/settings').set(auth(m.minor.token)).expect(200)).body.requiresApproval, true);
    const blocked = await created(m.adult, { body: `que PALAVRÃO, hein ${SECRET}`, visibility: 'GROUP' });
    assert.equal(blocked.status, 'PENDING_APPROVAL', 'palavra bloqueada (sem acento/caixa) vai para aprovacao');
    assert.equal(Object.keys(blocked).some((k) => /reason|blocked/i.test(k)), false, 'sem dizer o motivo');
    // texto puro: HTML guardado como texto, espacos normalizados
    const html = await created(m.adult, { body: `  <b>oi</b>   <script>x()</script>  ${SECRET} `, visibility: 'GROUP' });
    assert.equal(html.body, `<b>oi</b> <script>x()</script> ${SECRET}`);

    await post(m.adult, { visibility: 'GROUP' }).expect(400);
    await post(m.adult, { body: '   \n ', visibility: 'GROUP' }).expect(400);
    await post(m.adult, { body: 'x'.repeat(2001), visibility: 'GROUP' }).expect(400);
    await post(m.adult, { body: 'ok', visibility: 'TODOS' }).expect(400);
    await post(m.adult, { body: 'ok', visibility: 'GROUP', extra: 1 }).expect(400);

    await settings({ postingMode: 'STAFF_ONLY' });
    assert.equal((await post(m.adult, { body: 'x', visibility: 'GROUP' }).expect(403)).body.code, 'POSTING_NOT_ALLOWED');
    assert.equal((await post(m.monitor, { body: 'x', visibility: 'GROUP' }).expect(403)).body.code, 'POSTING_NOT_ALLOWED');
    assert.equal((await upload(m.adult, await jpeg()).expect(403)).body.code, 'POSTING_NOT_ALLOWED');
    assert.equal((await http().get('/api/feed/settings').set(auth(m.adult.token)).expect(200)).body.canPost, false);
    assert.equal((await created(m.prof1, { body: `equipe ${SECRET}`, visibility: 'GROUP' })).status, 'PUBLISHED');

    await settings({ enabled: false, postingMode: 'ALL' });
    assert.equal((await post(m.mestre, { body: 'x', visibility: 'GROUP' }).expect(403)).body.code, 'FEED_DISABLED');
    assert.equal((await http().get('/api/feed').set(auth(m.adult.token)).expect(403)).body.code, 'FEED_DISABLED');
    await settings({ enabled: true });

    const today = await prisma.feedPost.count({ where: { organizationId: orgA, authorUserId: m.adult.id } });
    await withEnv({ FEED_POSTS_PER_DAY: String(today) }, async () => {
      assert.equal((await post(m.adult, { body: 'mais um', visibility: 'GROUP' }).expect(429)).body.code, 'POST_LIMIT');
    });
  });

  it('visibilidade escolhida: so unidade/turma a que o autor pertence (IDOR) - 403; GROUP com unidade = 400', async () => {
    const denied = async (who: Member, body: Record<string, unknown>) => assert.equal((await post(who, { body: 'x', ...body }).expect(403)).body.code, 'VISIBILITY_NOT_ALLOWED');
    await denied(m.adult, { visibility: 'UNIT', unitId: u2 });
    await denied(m.adult, { visibility: 'CLASS', classId: c2 });
    await denied(m.adult, { visibility: 'UNIT', unitId: unitB });
    await denied(m.adult, { visibility: 'UNIT', unitId: 999999999 });
    await denied(m.extra, { visibility: 'CLASS', classId: c1 });
    await denied(m.prof1, { visibility: 'UNIT', unitId: u2 });
    await denied(m.prof1, { visibility: 'CLASS', classId: c2 });
    await denied(m.mestreB, { visibility: 'UNIT', unitId: u1 });
    await post(m.adult, { body: 'x', visibility: 'GROUP', unitId: u1 }).expect(400);
    await post(m.adult, { body: 'x', visibility: 'UNIT' }).expect(400);
    await post(m.adult, { body: 'x', visibility: 'CLASS', classId: c1, unitId: u2 }).expect(400);
    assert.equal((await created(m.adult, { body: `turma 1 ${SECRET}`, visibility: 'CLASS', classId: c1 })).unitId, u1, 'post de turma guarda a unidade da turma');
    await created(m.resp, { body: `resp turma ${SECRET}`, visibility: 'CLASS', classId: c1 });
    await created(m.prof1, { body: `prof unidade ${SECRET}`, visibility: 'UNIT', unitId: u1 });
    await created(m.mestre, { body: `mestre u2 ${SECRET}`, visibility: 'UNIT', unitId: u2 });
  });

  it('fotos: tipos recusados (415), > 5 MB (413), EXIF/GPS removido, bomba de pixels, URL assinada e cabecalhos', async () => {
    assert.equal((await upload(m.adult, Buffer.from('apenas texto, nao imagem'), 'a.jpg').expect(415)).body.code, 'FILE_TYPE_NOT_ALLOWED');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>');
    assert.equal((await upload(m.adult, svg, 'a.svg', 'image/svg+xml').expect(415)).body.code, 'FILE_TYPE_NOT_ALLOWED');
    const html = Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>');
    assert.equal((await upload(m.adult, html, 'foto.jpg', 'image/jpeg').expect(415)).body.code, 'FILE_TYPE_NOT_ALLOWED', 'HTML disfarcado de JPG');
    const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('lixo que nao decodifica'.repeat(10))]);
    assert.equal((await upload(m.adult, fakeJpeg).expect(415)).body.code, 'FILE_TYPE_NOT_ALLOWED', 'cabecalho JPEG falso');
    const big = Buffer.concat([await jpeg(), Buffer.alloc(5 * 1024 * 1024)]);
    assert.equal((await upload(m.adult, big).expect(413)).body.code, 'FILE_TOO_LARGE');
    const bomb = await sharp({ create: { width: 5200, height: 5000, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer();
    assert.ok(bomb.length < 1024 * 1024, 'arquivo pequeno, 26 MP');
    assert.equal((await upload(m.adult, bomb, 'b.png', 'image/png').expect(415)).body.code, 'FILE_TYPE_NOT_ALLOWED', 'bomba de pixels recusada');
    await upload(m.adult, Buffer.alloc(0)).expect(400);

    const withExif = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#a36' } })
      .withExif({ IFD0: { Copyright: `EXIF-${SECRET}`, Artist: 'e2e' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 33/1 0/1' } })
      .jpeg()
      .toBuffer();
    assert.ok((await sharp(withExif).metadata()).exif, 'a entrada TEM EXIF/GPS');
    const up = (await upload(m.adult, withExif).expect(201)).body;
    assert.deepEqual(Object.keys(up).sort(), ['height', 'mediaId', 'thumbUrl', 'url', 'width']);
    assert.equal(up.width, 1600, 'lado maior <= 1600');
    assert.equal(up.height, 800);
    const [full, thumb] = await mediaPaths(up.mediaId);
    assert.ok(full.startsWith(path.join(privateDir, 'feed') + path.sep), 'gravado no diretorio PRIVADO');
    const stored = await fs.readFile(full);
    assert.equal((await sharp(stored).metadata()).exif, undefined, 'EXIF/GPS removido do arquivo gravado');
    assert.equal(stored.includes(`EXIF-${SECRET}`), false);
    assert.equal((await sharp(await fs.readFile(thumb)).metadata()).width, 480, 'miniatura 480');
    assert.equal((await fs.readdir(uploadsDir)).length, 0, 'nada no diretorio publico');

    assert.match(up.url, /&r=1$/, 'foto pendente: URL de revisao (curta)');
    const res = await binary(up.url).expect(200);
    assert.equal(res.headers['content-type'], 'image/webp');
    assert.equal(res.headers['cache-control'], 'private, max-age=300', 'nao aprovada: cache curto');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['content-disposition'], 'inline');
    assert.match(res.headers['content-security-policy'], /sandbox/);
    assert.equal((await sharp(res.body as Buffer).metadata()).exif, undefined, 'servido sem EXIF');
    await binary(up.thumbUrl).expect(200);

    // Assinatura: adulterada, outra variante, outro grupo, expirada, sem parametros => o MESMO 404.
    const u = new URL(up.url, 'http://x');
    const e = Number(u.searchParams.get('e'));
    const s = u.searchParams.get('s') as string;
    const id = up.mediaId as number;
    const bad = [
      `/api/feed/media/${id}?e=${e}&s=${s.slice(0, 42)}${s[42] === 'A' ? 'B' : 'A'}`,
      `/api/feed/media/${id}?e=${e + 3600}&s=${s}`,
      `/api/feed/media/${id}/thumb?e=${e}&s=${s}`,
      `/api/feed/media/${id}?e=${e}&s=${mediaSignature(orgB, id, 'full', e)}`,
      `/api/feed/media/${id + 1}?e=${e}&s=${s}`,
      `/api/feed/media/${id}?e=${Math.floor(Date.now() / 1000) - 10}&s=${mediaSignature(orgA, id, 'full', Math.floor(Date.now() / 1000) - 10)}`,
      `/api/feed/media/${id}`,
      `/api/feed/media/abc?e=${e}&s=${s}`,
      `/api/feed/media/${id}?e=${e}&s=${s}&s=${s}`,
    ];
    for (const url of bad) assert.equal((await http().get(url).expect(404)).body.code, 'NOT_FOUND', url);
    // foto NAO aprovada so com URL de revisao: a mesma assinatura em escopo "membro" (6 h) nao serve
    await http().get(`/api/feed/media/${id}?e=${e}&s=${mediaSignature(orgA, id, 'full', e)}`).expect(404);
    const far = Math.floor(Date.now() / 1000) + 3 * 3600;
    await http().get(`/api/feed/media/${id}?e=${far}&s=${mediaSignature(orgA, id, 'full', far, undefined, 'review')}&r=1`).expect(404);
    await http().get(`${up.url.replace('&r=1', '')}&r=2`).expect(404);
    // assinatura valida gerada com o segredo do servidor, nao expirada: 200 (prova que o 404 acima nao e por acaso)
    await binary(`/api/feed/media/${id}?e=${e}&s=${mediaSignature(orgA, id, 'full', e, undefined, 'review')}&r=1`).expect(200);
    // publicado: URL de membro (validade FEED_MEDIA_URL_TTL_HOURS) e cache de 1 h
    const published = await created(m.adult, { mediaIds: [id], visibility: 'GROUP' });
    assert.equal(published.status, 'PUBLISHED');
    assert.equal(published.media[0].url.includes('&r=1'), false);
    const pub = await binary(published.media[0].url).expect(200);
    assert.equal(pub.headers['cache-control'], 'private, max-age=3600');
  });

  it('mediaIds: so do proprio autor, pendentes, do grupo, nao usadas e nao expiradas; foto de post oculto = 404', async () => {
    const mine = (await upload(m.adult, await jpeg()).expect(201)).body;
    const other = (await upload(m.extra, await jpeg()).expect(201)).body;
    const otherOrg = (await upload(m.alunoB, await jpeg()).expect(201)).body;
    const expired = (await upload(m.adult, await jpeg()).expect(201)).body;
    await prisma.feedPostMedia.update({ where: { id: expired.mediaId }, data: { pendingExpiresAt: new Date(Date.now() - 1000) } });
    for (const ids of [[other.mediaId], [otherOrg.mediaId], [expired.mediaId], [mine.mediaId, other.mediaId], [987654321]]) {
      assert.equal((await post(m.adult, { body: 'x', mediaIds: ids, visibility: 'GROUP' }).expect(400)).body.code, 'MEDIA_INVALID', JSON.stringify(ids));
    }
    assert.equal((await prisma.feedPostMedia.findUniqueOrThrow({ where: { id: mine.mediaId } })).postId, null, 'transacao desfeita: a foto valida continua pendente');
    await post(m.adult, { mediaIds: [1, 2, 3, 4, 5, 6, 7], visibility: 'GROUP' }).expect(400);
    await post(m.adult, { mediaIds: [mine.mediaId, mine.mediaId], visibility: 'GROUP' }).expect(400);
    await binary(expired.url).expect(404);

    const withPhoto = await created(m.adult, { mediaIds: [mine.mediaId], visibility: 'GROUP' });
    assert.equal(withPhoto.status, 'PUBLISHED', 'modo ALL, adulto');
    assert.equal(withPhoto.body, null);
    assert.equal(withPhoto.media.length, 1);
    assert.equal((await post(m.adult, { body: 'de novo', mediaIds: [mine.mediaId], visibility: 'GROUP' }).expect(400)).body.code, 'MEDIA_INVALID', 'foto ja usada');
    await binary(withPhoto.media[0].url).expect(200);
    await http().post(`/api/feed/posts/${withPhoto.id}/hide`).set(auth(m.mestre.token)).expect(200);
    await binary(withPhoto.media[0].url).expect(404);
    await binary(withPhoto.media[0].thumbUrl).expect(404);
    // o moderador ve a foto do post oculto na fila (URL de revisao, curta)
    const hiddenQueue = (await http().get('/api/feed/moderation/queue').query({ kind: 'HIDDEN', limit: 30 }).set(auth(m.mestre.token)).expect(200)).body;
    const reviewed = hiddenQueue.items.find((i: { post: Post }) => i.post.id === withPhoto.id).post.media[0].url as string;
    assert.match(reviewed, /&r=1$/);
    await binary(reviewed).expect(200);
    await http().post(`/api/feed/posts/${withPhoto.id}/restore`).set(auth(m.mestre.token)).expect(200);
    await binary(withPhoto.media[0].url).expect(200);

    // teto de pendentes por usuario
    const pending = await prisma.feedPostMedia.count({ where: { uploaderUserId: m.extra.id, postId: null } });
    await withEnv({ FEED_MEDIA_USER_PENDING_MAX: String(pending) }, async () => {
      assert.equal((await upload(m.extra, await jpeg()).expect(429)).body.code, 'MEDIA_LIMIT');
    });
  });

  it('feed: visibilidade GROUP/UNIT/CLASS por tipo de usuario, pendente so do autor, isolamento entre grupos, cursor', async () => {
    const g = await created(m.mestre, { body: `G ${SECRET}`, visibility: 'GROUP' });
    const pu1 = await created(m.mestre, { body: `U1 ${SECRET}`, visibility: 'UNIT', unitId: u1 });
    const pu2 = await created(m.mestre, { body: `U2 ${SECRET}`, visibility: 'UNIT', unitId: u2 });
    const pc1 = await created(m.mestre, { body: `C1 ${SECRET}`, visibility: 'CLASS', classId: c1 });
    const pc2 = await created(m.mestre, { body: `C2 ${SECRET}`, visibility: 'CLASS', classId: c2 });
    const all = { g: g.id, u1: pu1.id, u2: pu2.id, c1: pc1.id, c2: pc2.id };
    const expect = async (who: Member, visible: Array<keyof typeof all>, label: string) => {
      const ids = await seen(who);
      for (const [k, id] of Object.entries(all)) assert.equal(ids.has(id), visible.includes(k as keyof typeof all), `${label}: ${k}`);
    };
    await expect(m.adult, ['g', 'u1', 'c1'], 'aluno U1/T1');
    await expect(m.extra, ['g', 'u1'], 'aluno U1 sem turma');
    await expect(m.u2, ['g', 'u2', 'c2'], 'aluno U2/T2');
    await expect(m.resp, ['g', 'u1', 'c1'], 'responsavel do menor U1/T1');
    await expect(m.prof1, ['g', 'u1', 'c1'], 'professor restrito a U1 (responsavel da T1)');
    await expect(m.prof2, ['g', 'u2', 'c2'], 'professor restrito a U2');
    await expect(m.monitor, ['g', 'u1', 'u2'], 'monitor sem unidade atribuida: todas as unidades, nenhuma turma');
    await expect(m.mestre, ['g', 'u1', 'u2', 'c1', 'c2'], 'mestre');
    await expect(m.mestreB, [], 'outro grupo');
    await expect(m.alunoB, [], 'aluno de outro grupo');

    // pendente: so o autor ve (com status); nem o MESTRE ve no feed (so na fila de moderacao)
    await settings({ postingMode: 'MODERATED' });
    const pend = await created(m.adult, { body: `pendente ${SECRET}`, visibility: 'GROUP' });
    assert.equal((await seen(m.adult)).get(pend.id)?.status, 'PENDING_APPROVAL');
    assert.equal((await seen(m.extra)).has(pend.id), false);
    assert.equal((await seen(m.mestre)).has(pend.id), false);
    for (const p of (await seen(m.u2)).values()) assert.equal(p.status, 'PUBLISHED', 'membro comum so recebe PUBLISHED de terceiros');
    await settings({ postingMode: 'ALL' });

    // isolamento: post do grupo A pelo grupo B = 404 identico ao inexistente
    for (const who of [m.mestreB, m.alunoB]) {
      await http().put(`/api/feed/posts/${g.id}/reaction`).set(auth(who.token)).send({ type: 'AXE' }).expect(404);
      await http().get(`/api/feed/posts/${g.id}/comments`).set(auth(who.token)).expect(404);
      await http().post(`/api/feed/posts/${g.id}/report`).set(auth(who.token)).send({ reason: 'SPAM' }).expect(404);
      await http().delete(`/api/feed/posts/${g.id}`).set(auth(who.token)).expect(404);
      await http().patch(`/api/feed/posts/${g.id}`).set(auth(who.token)).send({ body: 'x' }).expect(404);
    }
    await http().post(`/api/feed/posts/${pend.id}/approve`).set(auth(m.mestreB.token)).expect(404);
    const nf1 = await http().put(`/api/feed/posts/${pu2.id}/reaction`).set(auth(m.adult.token)).send({ type: 'AXE' }).expect(404);
    const nf2 = await http().put('/api/feed/posts/999999999/reaction').set(auth(m.adult.token)).send({ type: 'AXE' }).expect(404);
    assert.deepEqual(nf1.body, nf2.body, 'fora do alcance = mesmo 404 do inexistente');

    // cursor estavel: paginas de 2 sem repeticao, na ordem (pinned desc, createdAt desc, id desc)
    const order: Post[] = [];
    let cursor: string | null = null;
    do {
      const res = await http().get('/api/feed').query({ limit: 2, ...(cursor ? { cursor } : {}) }).set(auth(m.mestre.token)).expect(200);
      assert.ok(res.body.items.length <= 2);
      order.push(...res.body.items);
      cursor = res.body.nextCursor;
    } while (cursor);
    assert.equal(new Set(order.map((p) => p.id)).size, order.length, 'sem repeticao');
    const total = await prisma.feedPost.count({ where: { organizationId: orgA, status: 'PUBLISHED', deletedAt: null } });
    assert.equal(order.length, total, 'percorre tudo');
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1] as unknown as { pinned: boolean; createdAt: string; id: number };
      const b = order[i] as unknown as { pinned: boolean; createdAt: string; id: number };
      const key = (p: typeof a) => [p.pinned ? 1 : 0, new Date(p.createdAt).getTime(), p.id];
      const [ka, kb] = [key(a), key(b)];
      assert.ok(ka[0] > kb[0] || (ka[0] === kb[0] && (ka[1] > kb[1] || (ka[1] === kb[1] && ka[2] > kb[2]))), 'ordem');
    }
    assert.equal((await http().get('/api/feed').query({ cursor: 'lixo-invalido' }).set(auth(m.mestre.token)).expect(400)).body.code, 'INVALID_CURSOR');
    await http().get('/api/feed').query({ limit: 31 }).set(auth(m.mestre.token)).expect(400);
    // formato do FeedPost
    const one = (await http().get('/api/feed').query({ limit: 1 }).set(auth(m.adult.token)).expect(200)).body.items[0];
    for (const k of ['id', 'type', 'author', 'body', 'media', 'visibility', 'unitId', 'classId', 'pinned', 'status', 'createdAt', 'edited', 'reactions', 'commentsCount', 'canEdit', 'canDelete', 'canModerate']) {
      assert.ok(k in one, k);
    }
    assert.equal(one.type, 'POST');
    assert.deepEqual(Object.keys(one.author).sort(), ['name', 'nickname', 'photo', 'roleLabel', 'userId']);
  });

  it('reacoes: uma por usuario, troca e remocao; contagens agregadas e `mine`', async () => {
    const p = await created(m.mestre, { body: `reacoes ${SECRET}`, visibility: 'GROUP' });
    const react = (who: Member, type: string | null) => http().put(`/api/feed/posts/${p.id}/reaction`).set(auth(who.token)).send({ type });
    let r = (await react(m.adult, 'AXE').expect(200)).body;
    assert.deepEqual(r, { counts: { AXE: 1, SALVE: 0, GINGA: 0, PARABENS: 0, CORACAO: 0 }, total: 1, mine: 'AXE' });
    await react(m.adult, 'AXE').expect(200);
    await react(m.extra, 'AXE').expect(200);
    r = (await react(m.u2, 'SALVE').expect(200)).body;
    assert.equal(r.counts.AXE, 2);
    assert.equal(r.total, 3);
    assert.equal(r.mine, 'SALVE');
    r = (await react(m.adult, 'GINGA').expect(200)).body;
    assert.equal(r.counts.AXE, 1);
    assert.equal(r.counts.GINGA, 1);
    assert.equal(await prisma.feedReaction.count({ where: { postId: p.id, userId: m.adult.id } }), 1, 'uma por usuario');
    r = (await react(m.adult, null).expect(200)).body;
    assert.equal(r.total, 2);
    assert.equal(r.mine, null);
    await http().put(`/api/feed/posts/${p.id}/reaction`).set(auth(m.adult.token)).send({}).expect(400);
    await react(m.adult, 'LIKE').expect(400);
    const inFeed = (await seen(m.extra)).get(p.id);
    assert.equal(inFeed?.reactions && (inFeed.reactions as { mine: string }).mine, 'AXE');
    assert.equal((inFeed?.reactions as { total: number }).total, 2);
  });

  it('comentarios: um nivel, limite diario, allowComments, apagar (autor/moderador), pendente nao comenta', async () => {
    const p = await created(m.mestre, { body: `comentarios ${SECRET}`, visibility: 'GROUP' });
    const c = (await http().post(`/api/feed/posts/${p.id}/comments`).set(auth(m.adult.token)).send({ body: `  comentario   ${SECRET} ` }).expect(201)).body;
    assert.deepEqual(Object.keys(c).sort(), ['author', 'body', 'canDelete', 'createdAt', 'id', 'parentId']);
    assert.equal(c.body, `comentario ${SECRET}`);
    const reply = (await http().post(`/api/feed/posts/${p.id}/comments`).set(auth(m.minor.token)).send({ body: 'resposta', parentId: c.id }).expect(201)).body;
    assert.equal(reply.parentId, c.id);
    await http().post(`/api/feed/posts/${p.id}/comments`).set(auth(m.extra.token)).send({ body: 'resposta da resposta', parentId: reply.id }).expect(400);
    await http().post(`/api/feed/posts/${p.id}/comments`).set(auth(m.extra.token)).send({ body: 'x'.repeat(501) }).expect(400);
    await http().post(`/api/feed/posts/${p.id}/comments`).set(auth(m.extra.token)).send({ body: '   ' }).expect(400);
    const list = (await http().get(`/api/feed/posts/${p.id}/comments`).query({ limit: 1 }).set(auth(m.extra.token)).expect(200)).body;
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].id, c.id);
    assert.equal(list.items[0].canDelete, false);
    const page2 = (await http().get(`/api/feed/posts/${p.id}/comments`).query({ limit: 1, cursor: list.nextCursor }).set(auth(m.extra.token)).expect(200)).body;
    assert.equal(page2.items[0].id, reply.id);
    assert.equal((await seen(m.extra)).get(p.id)?.commentsCount, 2);

    const mine = await prisma.feedComment.count({ where: { organizationId: orgA, authorUserId: m.extra.id } });
    await withEnv({ FEED_COMMENTS_PER_DAY: String(mine + 1) }, async () => {
      await http().post(`/api/feed/posts/${p.id}/comments`).set(auth(m.extra.token)).send({ body: 'um' }).expect(201);
      assert.equal((await http().post(`/api/feed/posts/${p.id}/comments`).set(auth(m.extra.token)).send({ body: 'dois' }).expect(429)).body.code, 'COMMENT_LIMIT');
    });
    await settings({ allowComments: false });
    assert.equal((await http().post(`/api/feed/posts/${p.id}/comments`).set(auth(m.adult.token)).send({ body: 'x' }).expect(403)).body.code, 'COMMENTS_DISABLED');
    await settings({ allowComments: true });

    await http().delete(`/api/feed/comments/${c.id}`).set(auth(m.extra.token)).expect(403);
    await http().delete(`/api/feed/comments/${c.id}`).set(auth(m.alunoB.token)).expect(404);
    await http().delete(`/api/feed/comments/${reply.id}`).set(auth(m.minor.token)).expect(204);
    await http().delete(`/api/feed/comments/${c.id}`).set(auth(m.mestre.token)).expect(204);
    const gone = await prisma.feedComment.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(gone.status, 'REMOVED');
    assert.equal(gone.body, null, 'texto apagado');
    assert.equal(await prisma.auditLog.count({ where: { organizationId: orgA, action: 'FEED_COMMENT_DELETE', resourceId: String(c.id) } }), 1);

    await settings({ postingMode: 'MODERATED' });
    const pend = await created(m.adult, { body: `pendente sem comentario ${SECRET}`, visibility: 'GROUP' });
    await http().post(`/api/feed/posts/${pend.id}/comments`).set(auth(m.extra.token)).send({ body: 'x' }).expect(404);
    await settings({ postingMode: 'ALL' });
  });

  it('denuncias: uma por usuario e alvo; 3 distintas ocultam; fila REPORTED sem denunciante; resolve DISMISS/HIDE/REMOVE', async () => {
    const p = await created(m.adult, { body: `denunciavel ${SECRET}`, visibility: 'GROUP' });
    const report = (who: Member, id: number, body: Record<string, unknown> = { reason: 'OFENSIVO', note: `nota ${SECRET}` }) =>
      http().post(`/api/feed/posts/${id}/report`).set(auth(who.token)).send(body);
    assert.deepEqual((await report(m.extra, p.id).expect(200)).body, { ok: true });
    assert.deepEqual((await report(m.extra, p.id).expect(200)).body, { ok: true }, 'repetida: ok sem gravar');
    assert.equal(await prisma.feedReport.count({ where: { postId: p.id } }), 1);
    await report(m.adult, p.id).expect(400);
    await report(m.extra, p.id, { reason: 'QUALQUER' }).expect(400);
    await report(m.u2, p.id, { reason: 'SPAM' }).expect(200);
    assert.equal((await prisma.feedPost.findUniqueOrThrow({ where: { id: p.id } })).status, 'PUBLISHED', '2 denuncias ainda nao ocultam');
    await report(m.resp, p.id, { reason: 'MENOR' }).expect(200);
    assert.equal((await prisma.feedPost.findUniqueOrThrow({ where: { id: p.id } })).status, 'HIDDEN', '3 distintas ocultam');
    assert.equal((await seen(m.monitor)).has(p.id), false);
    assert.equal((await seen(m.adult)).has(p.id), false, 'nem o autor recebe HIDDEN no feed');

    const queue = (await http().get('/api/feed/moderation/queue').query({ kind: 'REPORTED' }).set(auth(m.mestre.token)).expect(200)).body;
    const item = queue.items.find((i: { post: Post }) => i.post.id === p.id);
    assert.ok(item);
    assert.equal(item.reportsCount, 3);
    assert.equal(item.post.status, 'HIDDEN', 'moderador ve o status real');
    assert.deepEqual(Object.keys(item.reports[0]).sort(), ['createdAt', 'note', 'reason'], 'sem quem denunciou');
    assert.ok((await http().get('/api/feed/moderation/queue').query({ kind: 'HIDDEN' }).set(auth(m.mestre.token)).expect(200)).body.items.some((i: { post: Post }) => i.post.id === p.id));
    await http().post(`/api/feed/moderation/reports/${p.id}/resolve`).set(auth(m.mestre.token)).send({ action: 'DISMISS' }).expect(200);
    assert.equal((await prisma.feedPost.findUniqueOrThrow({ where: { id: p.id } })).status, 'PUBLISHED', 'DISMISS devolve o que foi oculto pelas denuncias');
    assert.equal(await prisma.feedReport.count({ where: { postId: p.id, status: 'DISMISSED' } }), 3);

    // HIDE
    const p2 = await created(m.adult, { body: `ocultar ${SECRET}`, visibility: 'GROUP' });
    await report(m.extra, p2.id).expect(200);
    await http().post(`/api/feed/moderation/reports/${p2.id}/resolve`).set(auth(m.mestre.token)).send({ action: 'HIDE' }).expect(200);
    assert.equal((await prisma.feedPost.findUniqueOrThrow({ where: { id: p2.id } })).status, 'HIDDEN');
    await http().post(`/api/feed/moderation/reports/${p2.id}/resolve`).set(auth(m.mestre.token)).send({ action: 'APAGAR' }).expect(400);

    // REMOVE (com foto): texto e fotos apagados (banco e disco), foto 404, autor avisado
    const photo = (await upload(m.adult, await jpeg()).expect(201)).body;
    const p3 = await created(m.adult, { body: `remover ${SECRET}`, mediaIds: [photo.mediaId], visibility: 'GROUP' });
    const files = await mediaPaths(photo.mediaId);
    await report(m.extra, p3.id).expect(200);
    await http().post(`/api/feed/moderation/reports/${p3.id}/resolve`).set(auth(m.mestre.token)).send({ action: 'REMOVE' }).expect(200);
    const removed = await prisma.feedPost.findUniqueOrThrow({ where: { id: p3.id } });
    assert.equal(removed.status, 'REMOVED');
    assert.equal(removed.body, null);
    assert.equal(await prisma.feedPostMedia.count({ where: { postId: p3.id } }), 0);
    for (const f of files) assert.equal(await exists(f), false, 'arquivo apagado do disco');
    await binary(p3.media[0].url).expect(404);
    assert.ok((await notifications(m.adult.id, 'FEED_HIDDEN')).some((n) => (n.data as { postId?: number } | null)?.postId === p3.id));

    // comentario denunciado: 3 distintas ocultam; aparece na fila com `comment`; DISMISS por commentId devolve
    const host = await created(m.mestre, { body: `post do comentario ${SECRET}`, visibility: 'GROUP' });
    const cm = (await http().post(`/api/feed/posts/${host.id}/comments`).set(auth(m.adult.token)).send({ body: 'comentario denunciado' }).expect(201)).body;
    for (const who of [m.extra, m.u2, m.resp]) await http().post(`/api/feed/comments/${cm.id}/report`).set(auth(who.token)).send({ reason: 'OFENSIVO' }).expect(200);
    assert.equal((await prisma.feedComment.findUniqueOrThrow({ where: { id: cm.id } })).status, 'HIDDEN');
    const q2 = (await http().get('/api/feed/moderation/queue').query({ kind: 'REPORTED', limit: 30 }).set(auth(m.mestre.token)).expect(200)).body;
    const ci = q2.items.find((i: { comment?: { id: number } }) => i.comment?.id === cm.id);
    assert.ok(ci);
    assert.equal(ci.reportsCount, 3);
    await http().post(`/api/feed/moderation/reports/${host.id}/resolve`).set(auth(m.mestre.token)).send({ action: 'DISMISS', commentId: cm.id }).expect(200);
    assert.equal((await prisma.feedComment.findUniqueOrThrow({ where: { id: cm.id } })).status, 'PUBLISHED');

    const audit = await prisma.auditLog.findMany({ where: { organizationId: orgA, action: 'FEED_POST_REPORT' } });
    assert.ok(audit.length >= 6);
    assert.ok(audit.every((a) => !JSON.stringify(a.metadata).includes(SECRET)), 'auditoria sem a nota');

    // M3: denunciante protegido tambem na trilha (o Mestre le /audit-logs/me-group): sem usuario e sem IP
    assert.ok(audit.every((a) => a.userId === null && a.ipAddress === null), 'denuncia gravada sem userId/ip do denunciante');
    const reporters = [m.extra.id, m.u2.id, m.resp.id];
    assert.ok(audit.every((a) => !JSON.stringify(a.metadata).match(new RegExp(`"(user|reporter)[A-Za-z]*":\\s*(${reporters.join('|')})`))), 'meta sem id do denunciante');
    const trail = (await http().get('/api/audit-logs/me-group').query({ action: 'FEED_POST_REPORT', limit: 50 }).set(auth(m.mestre.token)).expect(200)).body;
    const trailItems = trail as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(trail) && trailItems.length >= 6, 'a trilha lista as denuncias');
    assert.equal(JSON.stringify(trailItems).includes(DOMAIN), false, 'e-mail do denunciante fora da trilha');
    assert.ok(trailItems.every((r) => r.userId === null && r.userName === null && r.userEmail === null && r.ip === null), 'trilha sem denunciante nem IP');
  });

  it('moderacao: permissoes por papel e escopo; aprovar/ocultar/restaurar/fixar; FEED_APPROVED/FEED_HIDDEN', async () => {
    await settings({ postingMode: 'MODERATED' });
    const pU1 = await created(m.adult, { body: `pendente U1 ${SECRET}`, visibility: 'UNIT', unitId: u1 });
    const pG = await created(m.adult, { body: `pendente G ${SECRET}`, visibility: 'GROUP' });
    for (const who of [m.monitor, m.adult, m.resp]) {
      assert.equal((await http().get('/api/feed/moderation/queue').set(auth(who.token)).expect(403)).body.code, 'MODERATION_NOT_ALLOWED');
      await http().post(`/api/feed/posts/${pU1.id}/approve`).set(auth(who.token)).expect(403);
    }
    const q1 = (await http().get('/api/feed/moderation/queue').query({ kind: 'PENDING', limit: 30 }).set(auth(m.prof1.token)).expect(200)).body.items.map((i: { post: Post }) => i.post.id);
    assert.ok(q1.includes(pU1.id), 'professor ve pendente da unidade dele');
    assert.equal(q1.includes(pG.id), false, 'GROUP so o MESTRE modera');
    const q2 = (await http().get('/api/feed/moderation/queue').query({ kind: 'PENDING', limit: 30 }).set(auth(m.prof2.token)).expect(200)).body.items.map((i: { post: Post }) => i.post.id);
    assert.equal(q2.includes(pU1.id), false, 'outra unidade fora da fila');
    await http().post(`/api/feed/posts/${pU1.id}/approve`).set(auth(m.prof2.token)).expect(404);
    await http().post(`/api/feed/posts/${pG.id}/approve`).set(auth(m.prof1.token)).expect(404);
    const groupPublished = await created(m.mestre, { body: `grupo ${SECRET}`, visibility: 'GROUP' });
    assert.equal((await http().post(`/api/feed/posts/${groupPublished.id}/hide`).set(auth(m.prof1.token)).expect(403)).body.code, 'FORBIDDEN', 'visivel mas fora do poder');
    await http().delete(`/api/feed/posts/${groupPublished.id}`).set(auth(m.prof1.token)).expect(403);

    const approved = (await http().post(`/api/feed/posts/${pU1.id}/approve`).set(auth(m.prof1.token)).expect(200)).body;
    assert.equal(approved.status, 'PUBLISHED');
    assert.equal(approved.canModerate, true);
    assert.equal((await http().post(`/api/feed/posts/${pU1.id}/approve`).set(auth(m.prof1.token)).expect(409)).body.code, 'INVALID_STATE');
    const ap = await notifications(m.adult.id, 'FEED_APPROVED');
    assert.ok(ap.some((n) => (n.data as { postId?: number } | null)?.postId === pU1.id));

    await http().post(`/api/feed/posts/${pG.id}/approve`).set(auth(m.mestre.token)).expect(200);
    const hidden = (await http().post(`/api/feed/posts/${pG.id}/hide`).set(auth(m.mestre.token)).expect(200)).body;
    assert.equal(hidden.status, 'HIDDEN');
    const hn = (await notifications(m.adult.id, 'FEED_HIDDEN')).filter((n) => (n.data as { postId?: number } | null)?.postId === pG.id);
    assert.equal(hn.length, 1);
    assert.ok(!/viol|culpa|proib/i.test(hn[0].body), 'texto neutro');
    assert.equal((await seen(m.adult)).has(pG.id), false);
    assert.equal((await http().post(`/api/feed/posts/${pG.id}/pin`).set(auth(m.mestre.token)).expect(409)).body.code, 'INVALID_STATE');
    await http().post(`/api/feed/posts/${pG.id}/restore`).set(auth(m.mestre.token)).expect(200);
    const pinned = (await http().post(`/api/feed/posts/${pG.id}/pin`).set(auth(m.mestre.token)).expect(200)).body;
    assert.equal(pinned.pinned, true);
    const first = (await http().get('/api/feed').query({ limit: 1 }).set(auth(m.u2.token)).expect(200)).body.items[0];
    assert.equal(first.id, pG.id, 'fixado vem primeiro');
    await http().post(`/api/feed/posts/${pG.id}/unpin`).set(auth(m.mestre.token)).expect(200);
    for (const action of ['FEED_POST_APPROVE', 'FEED_POST_HIDE', 'FEED_POST_RESTORE', 'FEED_POST_PIN']) {
      assert.ok((await prisma.auditLog.count({ where: { organizationId: orgA, action, resourceId: String(pG.id) } })) >= 1, action);
    }

    // editar: so o autor; volta para aprovacao no modo moderado; marca edited
    await http().patch(`/api/feed/posts/${pG.id}`).set(auth(m.extra.token)).send({ body: 'x' }).expect(403);
    const edited = (await http().patch(`/api/feed/posts/${pG.id}`).set(auth(m.adult.token)).send({ body: `editado ${SECRET}` }).expect(200)).body;
    assert.equal(edited.edited, true);
    assert.equal(edited.status, 'PENDING_APPROVAL', 'edicao de aluno no modo moderado volta para aprovacao');
    // pendente nao se edita (a aprovacao vale para o texto que o moderador leu)
    assert.equal((await http().patch(`/api/feed/posts/${pG.id}`).set(auth(m.adult.token)).send({ body: 'troca na fila' }).expect(409)).body.code, 'INVALID_STATE');
    assert.equal((await prisma.feedPost.findUniqueOrThrow({ where: { id: pG.id } })).body, `editado ${SECRET}`);
    // apagar pelo autor: 204, sai do feed
    await http().delete(`/api/feed/posts/${pG.id}`).set(auth(m.adult.token)).expect(204);
    await http().delete(`/api/feed/posts/${pG.id}`).set(auth(m.adult.token)).expect(404);
    assert.equal((await prisma.feedPost.findUniqueOrThrow({ where: { id: pG.id } })).status, 'REMOVED');
    await settings({ postingMode: 'ALL' });
  });

  it('M4 hierarquia: professor nao desfaz o que o Mestre ocultou nem apaga de vez post do Mestre; DISMISS so republica o que as denuncias ocultaram; pin preservado; canEdit so PUBLISHED', async () => {
    await settings({ postingMode: 'ALL' });
    const asProf = (id: number) => http().post(`/api/feed/posts/${id}/restore`).set(auth(m.prof1.token));
    const status = async (id: number) => prisma.feedPost.findUniqueOrThrow({ where: { id } });
    const resolve = (who: Member, id: number, body: Record<string, unknown>) => http().post(`/api/feed/moderation/reports/${id}/resolve`).set(auth(who.token)).send(body);

    // O Mestre oculta o post do aluno (unidade 1): o professor da unidade ve na fila, mas NAO devolve ao feed.
    const pu = await created(m.adult, { body: `hierarquia ${SECRET}`, visibility: 'UNIT', unitId: u1 });
    await http().post(`/api/feed/posts/${pu.id}/hide`).set(auth(m.mestre.token)).expect(200);
    let row = await status(pu.id);
    assert.equal(row.status, 'HIDDEN');
    assert.equal(row.hiddenById, m.mestre.id, 'guarda quem ocultou');
    assert.equal((await asProf(pu.id).expect(403)).body.code, 'MODERATION_NOT_ALLOWED');
    await resolve(m.prof1, pu.id, { action: 'DISMISS' }).expect(200);
    assert.equal((await status(pu.id)).status, 'HIDDEN', 'DISMISS do professor nao republica o que o Mestre ocultou');
    assert.equal((await http().delete(`/api/feed/posts/${pu.id}`).set(auth(m.prof1.token)).expect(403)).body.code, 'MODERATION_NOT_ALLOWED', 'remocao e irreversivel: so o Mestre');
    assert.equal((await resolve(m.prof1, pu.id, { action: 'REMOVE' }).expect(403)).body.code, 'MODERATION_NOT_ALLOWED');
    assert.equal((await status(pu.id)).status, 'HIDDEN', 'nada foi removido');
    const back = (await http().post(`/api/feed/posts/${pu.id}/restore`).set(auth(m.mestre.token)).expect(200)).body;
    assert.equal(back.status, 'PUBLISHED');
    row = await status(pu.id);
    assert.equal(row.hiddenById, null, 'restaurar limpa quem ocultou');

    // O professor desfaz o que ELE MESMO (ou outro professor) ocultou.
    await http().post(`/api/feed/posts/${pu.id}/hide`).set(auth(m.prof1.token)).expect(200);
    assert.equal((await status(pu.id)).hiddenById, m.prof1.id);
    await asProf(pu.id).expect(200);
    assert.equal((await status(pu.id)).status, 'PUBLISHED');
    // recusa de um pendente pelo Mestre tambem vale: o professor nao aprova de volta via restore
    await settings({ postingMode: 'MODERATED' });
    const pend = await created(m.adult, { body: `recusado ${SECRET}`, visibility: 'UNIT', unitId: u1 });
    assert.equal((await seen(m.adult)).get(pend.id)?.canEdit, false, 'pendente: o PATCH daria 409, entao nao oferece editar');
    await http().post(`/api/feed/posts/${pend.id}/hide`).set(auth(m.mestre.token)).expect(200);
    await asProf(pend.id).expect(403);
    await settings({ postingMode: 'ALL' });
    const live = await created(m.adult, { body: `publicado ${SECRET}`, visibility: 'GROUP' });
    assert.equal((await seen(m.adult)).get(live.id)?.canEdit, true);

    // Post do MESTRE: o professor (da unidade) nao apaga de vez; ao aluno, apaga.
    const byMestre = await created(m.mestre, { body: `do mestre ${SECRET}`, visibility: 'UNIT', unitId: u1 });
    assert.equal((await http().delete(`/api/feed/posts/${byMestre.id}`).set(auth(m.prof1.token)).expect(403)).body.code, 'MODERATION_NOT_ALLOWED');
    assert.equal((await resolve(m.prof1, byMestre.id, { action: 'REMOVE' }).expect(403)).body.code, 'MODERATION_NOT_ALLOWED');
    assert.equal((await status(byMestre.id)).status, 'PUBLISHED');
    const byAluno = await created(m.adult, { body: `do aluno ${SECRET}`, visibility: 'UNIT', unitId: u1 });
    await http().delete(`/api/feed/posts/${byAluno.id}`).set(auth(m.prof1.token)).expect(204);
    assert.equal((await status(byAluno.id)).status, 'REMOVED');

    // Comentarios (post do Mestre na unidade 1): DISMISS so republica o que as DENUNCIAS ocultaram e que tem denuncia ABERTA.
    const comment = async (body: string) => (await http().post(`/api/feed/posts/${byMestre.id}/comments`).set(auth(m.adult.token)).send({ body }).expect(201)).body.id as number;
    const reportThrice = async (id: number) => {
      for (const who of [m.extra, m.minor, m.resp]) await http().post(`/api/feed/comments/${id}/report`).set(auth(who.token)).send({ reason: 'OFENSIVO' }).expect(200);
    };
    const cstatus = async (id: number) => prisma.feedComment.findUniqueOrThrow({ where: { id } });
    const c1id = await comment('comentario ocultado pelo professor');
    await resolve(m.prof1, byMestre.id, { action: 'HIDE', commentId: c1id }).expect(200);
    assert.deepEqual([(await cstatus(c1id)).status, (await cstatus(c1id)).hiddenById], ['HIDDEN', m.prof1.id]);
    await resolve(m.mestre, byMestre.id, { action: 'DISMISS', commentId: c1id }).expect(200);
    assert.equal((await cstatus(c1id)).status, 'HIDDEN', 'oculto por moderador: DISMISS nao republica');
    const c2id = await comment('comentario sem denuncia aberta');
    await reportThrice(c2id);
    assert.deepEqual([(await cstatus(c2id)).status, (await cstatus(c2id)).hiddenById], ['HIDDEN', null], 'oculto pelas denuncias: hiddenById nulo');
    await prisma.feedReport.updateMany({ where: { commentId: c2id }, data: { status: 'DISMISSED' } });
    await resolve(m.prof1, byMestre.id, { action: 'DISMISS', commentId: c2id }).expect(200);
    assert.equal((await cstatus(c2id)).status, 'HIDDEN', 'sem denuncia aberta: DISMISS nao republica');
    const c3id = await comment('comentario com denuncias abertas');
    await reportThrice(c3id);
    await resolve(m.prof1, byMestre.id, { action: 'DISMISS', commentId: c3id }).expect(200);
    assert.equal((await cstatus(c3id)).status, 'PUBLISHED', 'denuncias abertas + oculto por denuncias: republica');
    assert.equal(await prisma.feedReport.count({ where: { commentId: c3id, status: 'DISMISSED' } }), 3);

    // Fixado e ocultado pelas 3 denuncias: o DISMISS devolve ainda FIXADO.
    const pinned = await created(m.mestre, { body: `fixado ${SECRET}`, visibility: 'GROUP' });
    await http().post(`/api/feed/posts/${pinned.id}/pin`).set(auth(m.mestre.token)).expect(200);
    for (const who of [m.extra, m.u2, m.resp]) await http().post(`/api/feed/posts/${pinned.id}/report`).set(auth(who.token)).send({ reason: 'SPAM' }).expect(200);
    row = await status(pinned.id);
    assert.deepEqual([row.status, row.pinned, row.hiddenById], ['HIDDEN', true, null], 'ocultacao automatica preserva o pin');
    await resolve(m.mestre, pinned.id, { action: 'DISMISS' }).expect(200);
    row = await status(pinned.id);
    assert.deepEqual([row.status, row.pinned], ['PUBLISHED', true], 'DISMISS devolve o post ainda fixado');
    await http().post(`/api/feed/posts/${pinned.id}/unpin`).set(auth(m.mestre.token)).expect(200);
  });

  it('notificacoes agrupadas: varias reacoes/comentarios = 1 notificacao por janela; autor nao se notifica; nova janela apos 30 min', async () => {
    const p = await created(m.adult, { body: `agrupar ${SECRET}`, visibility: 'GROUP' });
    const react = (who: Member, type: string) => http().put(`/api/feed/posts/${p.id}/reaction`).set(auth(who.token)).send({ type }).expect(200);
    const mine = async () => (await notifications(m.adult.id, 'FEED_ACTIVITY')).filter((n) => (n.data as { postId?: number } | null)?.postId === p.id);
    await react(m.adult, 'AXE');
    assert.equal((await mine()).length, 0, 'reagir ao proprio post nao notifica');
    await react(m.minor, 'AXE');
    await react(m.extra, 'SALVE');
    assert.match((await mine())[0].body, /e mais 1 pessoa interagiu com o seu post\.$/, 'singular concorda: "1 pessoa interagiu"');
    await react(m.u2, 'GINGA');
    await react(m.extra, 'CORACAO');
    await http().post(`/api/feed/posts/${p.id}/comments`).set(auth(m.resp.token)).send({ body: 'parabens' }).expect(201);
    let list = await mine();
    assert.equal(list.length, 1, 'uma notificacao na janela');
    assert.match(list[0].body, /e mais 3 pessoas interagiram/);
    assert.equal(list[0].readAt, null);
    const notice = await prisma.feedActivityNotice.findUniqueOrThrow({ where: { postId_authorUserId: { postId: p.id, authorUserId: m.adult.id } } });
    assert.equal(notice.count, 4);
    assert.equal(notice.lastActorUserId, m.resp.id);
    await prisma.feedActivityNotice.update({ where: { id: notice.id }, data: { windowStartedAt: new Date(Date.now() - 31 * 60 * 1000) } });
    await react(m.mestre, 'PARABENS');
    list = await mine();
    assert.equal(list.length, 2, 'nova janela = nova notificacao');
    assert.match(list[1].body, /reagiu ao seu post/);
  });

  it('LGPD: anonimizar o titular apaga texto e fotos (banco e disco) dos posts/comentarios dele, reacoes e pendentes', async () => {
    const photo = (await upload(m.lgpd, await jpeg()).expect(201)).body;
    const pendingPhoto = (await upload(m.lgpd, await jpeg()).expect(201)).body;
    const files = [...(await mediaPaths(photo.mediaId)), ...(await mediaPaths(pendingPhoto.mediaId))];
    const p = await created(m.lgpd, { body: `post do titular ${SECRET}`, mediaIds: [photo.mediaId], visibility: 'GROUP' });
    const host = await created(m.mestre, { body: `host lgpd ${SECRET}`, visibility: 'GROUP' });
    const c = (await http().post(`/api/feed/posts/${host.id}/comments`).set(auth(m.lgpd.token)).send({ body: `comentario do titular ${SECRET}` }).expect(201)).body;
    await http().put(`/api/feed/posts/${host.id}/reaction`).set(auth(m.lgpd.token)).send({ type: 'AXE' }).expect(200);
    await http().post(`/api/feed/posts/${host.id}/report`).set(auth(m.lgpd.token)).send({ reason: 'OUTRO', note: 'nota do titular' }).expect(200);

    const req = await prisma.dataDeletionRequest.create({ data: { userId: m.lgpd.id, organizationId: orgA } });
    await app.get(AnonymizationService).anonymizeRequest(req.id, m.mestre.id);

    const after = await prisma.feedPost.findUniqueOrThrow({ where: { id: p.id } });
    assert.equal(after.authorUserId, null);
    assert.equal(after.authorPersonId, null);
    assert.equal(after.body, null);
    assert.equal(after.status, 'REMOVED');
    assert.equal(await prisma.feedPostMedia.count({ where: { id: { in: [photo.mediaId, pendingPhoto.mediaId] } } }), 0);
    for (const f of files) assert.equal(await exists(f), false, 'foto do titular apagada do disco');
    const comment = await prisma.feedComment.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(comment.authorUserId, null);
    assert.equal(comment.body, null);
    assert.equal(await prisma.feedReaction.count({ where: { userId: m.lgpd.id } }), 0);
    const rep = await prisma.feedReport.findFirstOrThrow({ where: { postId: host.id, reason: 'OUTRO' } });
    assert.equal(rep.reporterUserId, null);
    assert.equal(rep.note, null);
    assert.equal((await seen(m.extra)).has(p.id), false);
    // aviso de atividade no post do MESTRE que trazia o nome do titular: texto neutro, sem o id dele
    const hostNotices = (await notifications(m.mestre.id, 'FEED_ACTIVITY')).filter((n) => (n.data as { postId?: number } | null)?.postId === host.id);
    assert.ok(hostNotices.length >= 1);
    for (const n of hostNotices) {
      assert.equal(n.body.includes('lgpd'), false, n.body);
      assert.equal((n.data as { actorUserId?: number }).actorUserId, undefined);
    }
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'PERSON_ANONYMIZE', userId: m.mestre.id }, orderBy: { id: 'desc' } });
    assert.equal((audit.metadata as { feedPostsAnonymized?: number }).feedPostsAnonymized, 1);
  });

  it('limpeza agendada: pendente vencida sai do banco e do disco; FEED_MEDIA_CLEANUP=false nao roda', async () => {
    const up = (await upload(m.adult, await jpeg()).expect(201)).body;
    const files = await mediaPaths(up.mediaId);
    await prisma.feedPostMedia.update({ where: { id: up.mediaId }, data: { pendingExpiresAt: new Date(Date.now() - 1000) } });
    const cron = new FeedMediaCleanupCronService(app.get(PrismaService));
    assert.equal(await cron.run({ organizationId: orgA }), null, 'desligado nos testes (env-setup)');
    const result = await withEnv({ FEED_MEDIA_CLEANUP: 'true' }, () => cron.run({ organizationId: orgA }));
    assert.ok(result && result.pendingDeleted >= 1);
    assert.equal(await prisma.feedPostMedia.count({ where: { id: up.mediaId } }), 0);
    for (const f of files) assert.equal(await exists(f), false);

    // varredura disco x banco: arquivo sem linha e com mais de 24 h sai; arquivo com linha fica
    const keep = (await upload(m.adult, await jpeg()).expect(201)).body;
    const kept = await mediaPaths(keep.mediaId);
    const orphan = path.join(feedDir, `org-${orgA}`, '0f0f0f0f-0000-4000-8000-000000000000.webp');
    await fs.writeFile(orphan, Buffer.from('x'));
    const old = new Date(Date.now() - 2 * 86_400_000);
    await fs.utimes(orphan, old, old);
    for (const f of kept) await fs.utimes(f, old, old);
    const swept = await withEnv({ FEED_MEDIA_CLEANUP: 'true' }, () => cron.sweepOrphans());
    assert.ok(swept !== null && swept >= 1);
    assert.equal(await exists(orphan), false);
    for (const f of kept) assert.equal(await exists(f), true, 'arquivo com registro nao e tocado');
  });

  it('apagar a turma: posts da turma saem do feed (REMOVED), nao viram do grupo; a turma apaga sem erro de FK', async () => {
    const c3 = (await prisma.class.create({ data: { organizationId: orgA, unitId: u1, name: 'Turma 3', autoGenerateLessons: false } })).id;
    const p = await created(m.mestre, { body: `turma 3 ${SECRET}`, visibility: 'CLASS', classId: c3 });
    await http().delete(`/api/classes/${c3}`).set(auth(m.mestre.token)).expect(200);
    const row = await prisma.feedPost.findUniqueOrThrow({ where: { id: p.id } });
    assert.equal(row.status, 'REMOVED');
    assert.equal(row.classId, null);
    assert.equal(row.body, null);
    assert.equal((await seen(m.adult)).has(p.id), false);
  });

  it('M1: apagar a turma inativa os comunicados dela (nao viram "de todos"); CLASS sem turma nunca aparece no mural', async () => {
    const c4 = (await prisma.class.create({ data: { organizationId: orgA, unitId: u1, name: 'Turma 4', autoGenerateLessons: false } })).id;
    const base = { organizationId: orgA, body: 'Aviso da turma', status: 'SENT' as const, publishedAt: new Date(Date.now() - 60_000), isActive: true };
    const sent = await prisma.announcement.create({ data: { ...base, title: `[e2e-feed] turma ${stamp}`, scopeType: 'CLASS', classId: c4, createdByUserId: m.mestre.id } });
    const legacy = await prisma.announcement.create({ data: { ...base, title: `[e2e-feed] legado ${stamp}`, classId: c4, createdByUserId: m.mestre.id } });
    const titles = async (who: Member) => ((await http().get('/api/announcements').query({ limit: 100 }).set(auth(who.token)).expect(200)).body as Array<{ id: number }>).map((a) => a.id);
    await http().delete(`/api/classes/${c4}`).set(auth(m.mestre.token)).expect(200);
    for (const id of [sent.id, legacy.id]) {
      const row = await prisma.announcement.findUniqueOrThrow({ where: { id } });
      assert.deepEqual([row.classId, row.isActive], [null, false], 'sem turma e inativo');
      assert.equal((await titles(m.extra)).includes(id), false, 'aluno da unidade nao ve o comunicado de turma apagada');
    }
    // defesa em profundidade: mesmo ativo, scopeType CLASS sem turma nao vira visivel a todos
    const orphan = await prisma.announcement.create({ data: { ...base, title: `[e2e-feed] orfao ${stamp}`, scopeType: 'CLASS', classId: null, createdByUserId: m.mestre.id } });
    assert.equal((await titles(m.extra)).includes(orphan.id), false);
    assert.equal((await titles(m.mestre)).includes(orphan.id), true, 'o Mestre (staff) continua vendo o registro');
  });

  it('auditoria do feed sem conteudo; throttle de escrita por usuario (429 TOO_MANY_REQUESTS)', async () => {
    const rows = await prisma.auditLog.findMany({ where: { organizationId: orgA, action: { startsWith: 'FEED_' } } });
    assert.ok(rows.some((r) => r.action === 'FEED_POST_CREATE'));
    assert.ok(rows.some((r) => r.action === 'FEED_POST_DELETE'));
    assert.ok(rows.every((r) => !JSON.stringify(r.metadata ?? {}).includes(SECRET)), 'nenhum texto/nota/foto do usuario na auditoria');

    await withEnv({ FEED_WRITE_THROTTLE_LIMIT: '2' }, async () => {
      await http().post('/api/feed/comments/999999999/report').set(auth(m.mestreB.token)).send({ reason: 'SPAM' }).expect(404);
      await http().post('/api/feed/comments/999999999/report').set(auth(m.mestreB.token)).send({ reason: 'SPAM' }).expect(404);
      const r = await http().post('/api/feed/comments/999999999/report').set(auth(m.mestreB.token)).send({ reason: 'SPAM' }).expect(429);
      assert.equal(r.body.code, 'TOO_MANY_REQUESTS');
    });
  });
});
