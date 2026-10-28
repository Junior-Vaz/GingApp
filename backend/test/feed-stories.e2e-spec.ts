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
import { resolveFeedMediaDir } from '../src/interface/http/feed/feed-media-storage';
import { FeedMediaCleanupCronService } from '../src/jobs/feed-media-cleanup-cron.service';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { DEV_PASSWORD } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Stories do feed (docs/CONTRATO_FEED_ANIVERSARIOS_COMUNICACAO.md secao 9). Grupos, unidades, turmas, usuarios e diretorios
 * PROPRIOS (UPLOADS_DIR/PRIVATE_UPLOADS_DIR temporarios). Nao toca no seed. Limpa tudo (banco + disco) no after() e confere
 * por consulta.
 */
const DOMAIN = '@e2e-fstories.local';
const SECRET = `LEGENDA-SECRETA-${Date.now()}`;

type Member = { id: number; token: string };
type Media = { id: number; url: string; thumbUrl: string; width: number; height: number };
type StoryPost = {
  id: number;
  type: string;
  kind: string;
  expiresAt: string | null;
  status: string;
  body: string | null;
  createdAt: string;
  media: Media[];
  [k: string]: unknown;
};
type StoryItem = { id: number; media: Media; caption: string | null; createdAt: string; expiresAt: string; seen: boolean; status: string };
type StoryGroup = { author: { userId: number; name: string; nickname: string | null; photo: string | null; roleLabel: string | null } | null; isMine: boolean; hasUnseen: boolean; items: StoryItem[] };

describe('Stories do feed (e2e)', () => {
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
  let photo: Buffer;
  const personIds: number[] = [];
  const userIds: number[] = [];
  const m = {} as Record<'mestre' | 'prof1' | 'prof2' | 'monitor' | 'adult' | 'minor' | 'resp' | 'u2' | 'extra' | 'lgpd' | 'mestreB' | 'alunoB', Member>;
  const oldEnv: Record<string, string | undefined> = {};
  /** Stories criados no teste de visibilidade (reusados por varios testes seguintes). */
  const S = {} as Record<'g1' | 'un1' | 'cl1' | 'un2' | 'cl2' | 'minorPending' | 'adultPub', StoryPost>;

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
      data: { email: `${tag}-${stamp}${DOMAIN}`, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `[e2e-fstories] ${tag}`, userType: 'MEMBER' },
    });
    userIds.push(user.id);
    await prisma.organizationUser.create({ data: { organizationId: org, userId: user.id, role, status: 'ACTIVE' } });
    if (birthDate !== undefined) {
      const p = await prisma.person.create({ data: { gingappCode: `E2EFST-${stamp}-${++seq}`, name: `[e2e-fstories] ${tag}`, nickname: tag, birthDate, userId: user.id } });
      personIds.push(p.id);
    }
    return { id: user.id, token: await login(user.email) };
  };
  const student = async (org: number, unitId: number, userId: number | null, tag: string, classId?: number) => {
    const s = await prisma.student.create({ data: { organizationId: org, unitId, userId, name: `[e2e-fstories] aluno ${tag}`, status: 'ACTIVE' } });
    if (classId) await prisma.classStudent.create({ data: { organizationId: org, classId, studentId: s.id, status: 'ACTIVE' } });
    return s;
  };

  const settings = (body: Record<string, unknown>) => http().put('/api/feed/settings').set(auth(m.mestre.token)).send(body).expect(200);
  const upload = (who: Member, buf: Buffer = photo) => http().post('/api/feed/media').set(auth(who.token)).attach('file', buf, { filename: 'foto.jpg', contentType: 'image/jpeg' });
  const newMedia = async (who: Member): Promise<number> => (await upload(who).expect(201)).body.mediaId as number;
  const postStory = (who: Member, body: Record<string, unknown>) => http().post('/api/feed/stories').set(auth(who.token)).send(body);
  /** Sobe a foto e publica o story; `extra` completa/sobrescreve o corpo. */
  const mkStory = async (who: Member, extra: Record<string, unknown> = {}): Promise<StoryPost> => {
    const mediaId = await newMedia(who);
    return (await postStory(who, { mediaId, visibility: 'GROUP', ...extra }).expect(201)).body as StoryPost;
  };
  const groupsOf = async (who: Member): Promise<StoryGroup[]> => (await http().get('/api/feed/stories').set(auth(who.token)).expect(200)).body.groups as StoryGroup[];
  const itemsOf = async (who: Member): Promise<Map<number, StoryItem>> => new Map((await groupsOf(who)).flatMap((g) => g.items).map((i) => [i.id, i]));
  const view = (who: Member, id: number) => http().post(`/api/feed/stories/${id}/view`).set(auth(who.token));
  const binary = (url: string) =>
    http()
      .get(url)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  const notifications = (userId: number, type: string) => prisma.notification.findMany({ where: { userId, type }, orderBy: { id: 'asc' } });
  const mediaPaths = async (mediaId: number) => {
    const row = await prisma.feedPostMedia.findUniqueOrThrow({ where: { id: mediaId } });
    return [path.join(feedDir, ...row.storageKey.split('/')), path.join(feedDir, ...row.thumbKey.split('/'))];
  };
  const exists = (p: string) => fs.stat(p).then(() => true, () => false);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  before(async () => {
    uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-fst-pub-'));
    privateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-fst-priv-'));
    const keys = ['UPLOADS_DIR', 'PRIVATE_UPLOADS_DIR', 'FEED_MEDIA_DIR', 'FEED_POSTS_PER_DAY', 'FEED_COMMENTS_PER_DAY', 'FEED_STORIES_PER_DAY', 'FEED_STORY_TTL_HOURS'];
    for (const k of [...keys, 'FEED_MEDIA_USER_PER_DAY', 'FEED_MEDIA_STAFF_PER_DAY', 'FEED_MEDIA_ORG_PER_DAY', 'FEED_MEDIA_USER_PENDING_MAX', 'FEED_MEDIA_ORG_PENDING_MAX']) oldEnv[k] = process.env[k];
    process.env.UPLOADS_DIR = uploadsDir;
    process.env.PRIVATE_UPLOADS_DIR = privateDir;
    delete process.env.FEED_MEDIA_DIR;
    delete process.env.FEED_STORY_TTL_HOURS;
    process.env.FEED_POSTS_PER_DAY = '500';
    process.env.FEED_COMMENTS_PER_DAY = '500';
    process.env.FEED_STORIES_PER_DAY = '500';
    // Cotas de FOTO (nao de story): o spec sobe dezenas de fotos com poucos usuarios.
    process.env.FEED_MEDIA_USER_PER_DAY = '1000';
    process.env.FEED_MEDIA_STAFF_PER_DAY = '1000';
    process.env.FEED_MEDIA_ORG_PER_DAY = '5000';
    process.env.FEED_MEDIA_USER_PENDING_MAX = '100';
    process.env.FEED_MEDIA_ORG_PENDING_MAX = '1000';
    feedDir = resolveFeedMediaDir();
    photo = await sharp({ create: { width: 120, height: 200, channels: 3, background: '#3a6' } }).jpeg().toBuffer();
    app = await createTestApp();

    // Grupo A usa o PADRAO do banco (feed DESLIGADO); o B liga direto.
    orgA = (await prisma.organization.create({ data: { name: `E2E fstories A ${stamp}`, slug: `e2e-fst-a-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE } })).id;
    orgB = (await prisma.organization.create({ data: { name: `E2E fstories B ${stamp}`, slug: `e2e-fst-b-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE, feedEnabled: true } })).id;
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
    await prisma.studentGuardian.create({ data: { organizationId: orgA, studentId: minorStudent.id, userId: m.resp.id, name: '[e2e-fstories] resp' } });
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
    await prisma.feedStoryView.deleteMany({ where: { OR: [{ post: { organizationId: { in: orgs } } }, { userId: { in: userIds } }] } });
    await prisma.feedComment.deleteMany({ where: { organizationId: { in: orgs }, parentId: { not: null } } });
    await prisma.feedComment.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.feedPostMedia.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.feedPost.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.notification.deleteMany({ where: { OR: [{ organizationId: { in: orgs } }, { userId: { in: userIds } }] } });
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
      prisma.feedStoryView.count({ where: { userId: { in: userIds } } }),
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

  it('feed desligado (padrao do grupo novo): listar, publicar e marcar visto = 403 FEED_DISABLED; sem token = 401', async () => {
    assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: orgA }, select: { feedEnabled: true } })).feedEnabled, false);
    const mediaId = 1;
    assert.equal((await http().get('/api/feed/stories').set(auth(m.adult.token)).expect(403)).body.code, 'FEED_DISABLED');
    assert.equal((await postStory(m.prof1, { mediaId, visibility: 'GROUP' }).expect(403)).body.code, 'FEED_DISABLED');
    assert.equal((await view(m.adult, 1).expect(403)).body.code, 'FEED_DISABLED');
    await http().get('/api/feed/stories').expect(401);
    await http().post('/api/feed/stories').send({ mediaId, visibility: 'GROUP' }).expect(401);
    await http().post('/api/feed/stories/1/view').expect(401);
    assert.equal(await prisma.feedPost.count({ where: { organizationId: orgA } }), 0);
    await settings({ enabled: true, blockedWords: ['Palavrão'] });
  });

  it('criar story: validacao do corpo (400), legenda <= 140 como texto puro, formato do FeedPost e validade de 24 h', async () => {
    const mediaId = await newMedia(m.prof1);
    const base = { mediaId, visibility: 'GROUP' };
    await postStory(m.prof1, { visibility: 'GROUP' }).expect(400); // sem foto
    await postStory(m.prof1, { ...base, mediaId: 'abc' }).expect(400);
    await postStory(m.prof1, { ...base, mediaId: 0 }).expect(400);
    await postStory(m.prof1, { ...base, caption: 'x'.repeat(141) }).expect(400);
    await postStory(m.prof1, { ...base, caption: 123 }).expect(400);
    await postStory(m.prof1, { ...base, visibility: 'TODOS' }).expect(400);
    await postStory(m.prof1, { ...base, extra: 1 }).expect(400);
    await postStory(m.prof1, { ...base, mediaIds: [mediaId] }).expect(400);
    await postStory(m.prof1, { ...base, unitId: u1 }).expect(400); // GROUP nao leva unidade
    await postStory(m.prof1, { mediaId, visibility: 'UNIT' }).expect(400);
    assert.equal(await prisma.feedPost.count({ where: { organizationId: orgA, kind: 'STORY' } }), 0, 'nenhum 400 deixou story');

    const caption140 = 'x'.repeat(140);
    const res = (await postStory(m.prof1, { ...base, caption: `  <b>oi</b>\n\n  ${SECRET}   ` }).expect(201)).body as StoryPost;
    assert.equal(res.body, `<b>oi</b> ${SECRET}`, 'legenda como texto puro (HTML literal), numa linha, espacos normalizados');
    assert.deepEqual(Object.keys(res).sort(), [
      'author', 'body', 'canDelete', 'canEdit', 'canModerate', 'classId', 'commentsCount', 'createdAt', 'edited', 'expiresAt', 'id', 'kind', 'media', 'pinned',
      'reactions', 'recentComments', 'status', 'type', 'unitId', 'visibility',
    ]);
    assert.deepEqual(res.recentComments, [], 'story nao tem comentarios');
    assert.equal(res.kind, 'STORY');
    assert.equal(res.type, 'POST');
    assert.equal(res.status, 'PUBLISHED', 'equipe publica direto');
    assert.equal(res.media.length, 1);
    assert.equal(res.media[0].id, mediaId);
    assert.deepEqual(Object.keys(res.media[0]).sort(), ['height', 'id', 'thumbUrl', 'url', 'width']);
    assert.equal(res.canEdit, false, 'story nao se edita');
    assert.equal(res.canDelete, true);
    const hours = (new Date(res.expiresAt as string).getTime() - new Date(res.createdAt).getTime()) / 3_600_000;
    assert.ok(Math.abs(hours - 24) < 0.05, `validade padrao 24 h (deu ${hours})`);
    // 140 exatos passam; sem legenda tambem
    const exact = await mkStory(m.prof1, { caption: caption140 });
    assert.equal(exact.body?.length, 140);
    assert.equal((await mkStory(m.prof1)).body, null);
    const row = await prisma.feedPost.findUniqueOrThrow({ where: { id: res.id } });
    assert.equal(row.kind, 'STORY');
    assert.ok(row.expiresAt);
    assert.equal(row.pinned, false);
  });

  it('status por modo de postagem: MODERATED -> pendente; ALL -> direto; menor SEMPRE pendente; palavra bloqueada; STAFF_ONLY 403', async () => {
    const mkAs = (who: Member, extra: Record<string, unknown> = {}) => mkStory(who, extra);
    assert.equal((await mkAs(m.adult)).status, 'PENDING_APPROVAL', 'MODERATED: aluno adulto pendente');
    assert.equal((await mkAs(m.monitor)).status, 'PENDING_APPROVAL', 'MONITOR conta como membro');
    assert.equal((await mkAs(m.resp)).status, 'PENDING_APPROVAL');
    assert.equal((await mkAs(m.prof1)).status, 'PUBLISHED');
    assert.equal((await mkAs(m.mestre)).status, 'PUBLISHED');

    await settings({ postingMode: 'ALL' });
    assert.equal((await mkAs(m.adult)).status, 'PUBLISHED', 'ALL: aluno adulto direto');
    assert.equal((await mkAs(m.minor)).status, 'PENDING_APPROVAL', 'menor de 18 SEMPRE pendente');
    const blocked = await mkAs(m.adult, { caption: 'que PALAVRÃO, hein' });
    assert.equal(blocked.status, 'PENDING_APPROVAL', 'palavra bloqueada (sem acento/caixa) na legenda -> pendente');
    assert.equal(Object.keys(blocked).some((k) => /reason|blocked/i.test(k)), false, 'sem dizer o motivo');

    // fotos enviadas ANTES do modo STAFF_ONLY (o upload tambem e barrado la)
    const [adultMedia, monitorMedia, profMedia] = [await newMedia(m.adult), await newMedia(m.monitor), await newMedia(m.prof1)];
    await settings({ postingMode: 'STAFF_ONLY' });
    assert.equal((await postStory(m.adult, { mediaId: adultMedia, visibility: 'GROUP' }).expect(403)).body.code, 'POSTING_NOT_ALLOWED');
    assert.equal((await postStory(m.monitor, { mediaId: monitorMedia, visibility: 'GROUP' }).expect(403)).body.code, 'POSTING_NOT_ALLOWED');
    assert.equal((await postStory(m.prof1, { mediaId: profMedia, visibility: 'GROUP' }).expect(201)).body.status, 'PUBLISHED');
    // a foto recusada continua pendente (nao foi gasta)
    assert.equal((await prisma.feedPostMedia.findUniqueOrThrow({ where: { id: adultMedia } })).postId, null);

    await settings({ enabled: false });
    assert.equal((await postStory(m.mestre, { mediaId: adultMedia, visibility: 'GROUP' }).expect(403)).body.code, 'FEED_DISABLED');
    await settings({ enabled: true, postingMode: 'ALL' });
  });

  it('visibilidade escolhida (IDOR): so unidade/turma a que o autor pertence (403 VISIBILITY_NOT_ALLOWED); a foto nao e gasta', async () => {
    const denied = async (who: Member, body: Record<string, unknown>) => {
      const mediaId = await newMedia(who);
      assert.equal((await postStory(who, { mediaId, ...body }).expect(403)).body.code, 'VISIBILITY_NOT_ALLOWED', JSON.stringify(body));
      assert.equal((await prisma.feedPostMedia.findUniqueOrThrow({ where: { id: mediaId } })).postId, null, 'foto continua pendente');
    };
    await denied(m.adult, { visibility: 'UNIT', unitId: u2 });
    await denied(m.adult, { visibility: 'CLASS', classId: c2 });
    await denied(m.adult, { visibility: 'UNIT', unitId: unitB });
    await denied(m.adult, { visibility: 'UNIT', unitId: 999999999 });
    await denied(m.extra, { visibility: 'CLASS', classId: c1 });
    await denied(m.prof1, { visibility: 'UNIT', unitId: u2 });
    await denied(m.prof1, { visibility: 'CLASS', classId: c2 });
    await denied(m.mestreB, { visibility: 'UNIT', unitId: u1 });
    const ok = await mkStory(m.adult, { visibility: 'CLASS', classId: c1 });
    assert.equal(ok.unitId, u1, 'story de turma guarda a unidade da turma');
    assert.equal(ok.classId, c1);
  });

  it('mediaId: so do proprio autor, deste grupo, pendente, nao usada e nao expirada (senao 400 MEDIA_INVALID, sem story)', async () => {
    const storiesBefore = await prisma.feedPost.count({ where: { organizationId: orgA, kind: 'STORY', authorUserId: m.adult.id } });
    const other = await newMedia(m.extra);
    const otherOrg = await newMedia(m.alunoB);
    const expired = await newMedia(m.adult);
    await prisma.feedPostMedia.update({ where: { id: expired }, data: { pendingExpiresAt: new Date(Date.now() - 1000) } });
    const used = await newMedia(m.adult);
    const first = (await postStory(m.adult, { mediaId: used, visibility: 'GROUP' }).expect(201)).body as StoryPost;
    for (const mediaId of [other, otherOrg, expired, used, 987654321]) {
      assert.equal((await postStory(m.adult, { mediaId, visibility: 'GROUP' }).expect(400)).body.code, 'MEDIA_INVALID', String(mediaId));
    }
    assert.equal(await prisma.feedPost.count({ where: { organizationId: orgA, kind: 'STORY', authorUserId: m.adult.id } }), storiesBefore + 1, 'so o 1o story existe');
    assert.equal((await prisma.feedPostMedia.findUniqueOrThrow({ where: { id: used } })).postId, first.id, 'a foto usada segue no 1o story');
    assert.equal((await prisma.feedPostMedia.findUniqueOrThrow({ where: { id: other } })).postId, null, 'foto alheia intacta');
    // a foto de um story nao serve a um POST (nem o contrario: ja coberto no feed.e2e)
    assert.equal((await http().post('/api/feed/posts').set(auth(m.adult.token)).send({ mediaIds: [used], visibility: 'GROUP' }).expect(400)).body.code, 'MEDIA_INVALID');
  });

  it('cotas: FEED_STORIES_PER_DAY (429 STORY_LIMIT, foto nao e gasta); stories nao gastam a cota de posts nem o contrario', async () => {
    await withEnv({ FEED_STORIES_PER_DAY: '2' }, async () => {
      await mkStory(m.u2);
      await mkStory(m.u2);
      const mediaId = await newMedia(m.u2);
      const res = await postStory(m.u2, { mediaId, visibility: 'GROUP' }).expect(429);
      assert.equal(res.body.code, 'STORY_LIMIT');
      assert.equal(await prisma.feedPost.count({ where: { organizationId: orgA, kind: 'STORY', authorUserId: m.u2.id } }), 2);
      assert.equal((await prisma.feedPostMedia.findUniqueOrThrow({ where: { id: mediaId } })).postId, null);
      // outro usuario nao e afetado
      await mkStory(m.extra);
    });
    // `extra` ja tem stories hoje: com a cota de POSTS em 1, o 1o post passa (stories nao contam), o 2o e barrado, e o story
    // seguinte nao e barrado pela cota de posts.
    await withEnv({ FEED_POSTS_PER_DAY: '1' }, async () => {
      const post = (b: Record<string, unknown>) => http().post('/api/feed/posts').set(auth(m.extra.token)).send(b);
      await post({ body: 'primeiro post', visibility: 'GROUP' }).expect(201); // extra ja tem stories hoje: nao contam
      assert.equal((await post({ body: 'segundo post', visibility: 'GROUP' }).expect(429)).body.code, 'POST_LIMIT');
      await mkStory(m.extra); // e o story nao e barrado pela cota de posts
    });
  });

  it('visibilidade por perfil: GROUP/UNIT/CLASS (aluno, responsavel, professor restrito, monitor, mestre, outro grupo); pendente so do autor', async () => {
    await settings({ postingMode: 'ALL' });
    S.g1 = await mkStory(m.prof1, { caption: `g1 ${SECRET}` });
    S.un1 = await mkStory(m.prof1, { visibility: 'UNIT', unitId: u1 });
    S.cl1 = await mkStory(m.prof1, { visibility: 'CLASS', classId: c1 });
    S.un2 = await mkStory(m.prof2, { visibility: 'UNIT', unitId: u2 });
    S.cl2 = await mkStory(m.prof2, { visibility: 'CLASS', classId: c2 });
    S.minorPending = await mkStory(m.minor);
    S.adultPub = await mkStory(m.adult);
    assert.equal(S.minorPending.status, 'PENDING_APPROVAL');
    assert.equal(S.adultPub.status, 'PUBLISHED');

    const expectations: Array<[string, Member, Array<keyof typeof S>]> = [
      ['mestre', m.mestre, ['g1', 'un1', 'cl1', 'un2', 'cl2', 'adultPub']],
      ['aluno adulto (u1, c1)', m.adult, ['g1', 'un1', 'cl1', 'adultPub']],
      ['aluno menor (u1, c1): ve o PROPRIO pendente', m.minor, ['g1', 'un1', 'cl1', 'adultPub', 'minorPending']],
      ['responsavel do menor', m.resp, ['g1', 'un1', 'cl1', 'adultPub']],
      ['aluno u1 sem turma', m.extra, ['g1', 'un1', 'adultPub']],
      ['aluno u2 (c2)', m.u2, ['g1', 'un2', 'cl2', 'adultPub']],
      ['professor restrito a u1 (responsavel c1)', m.prof1, ['g1', 'un1', 'cl1', 'adultPub']],
      ['professor restrito a u2', m.prof2, ['g1', 'un2', 'cl2', 'adultPub']],
      ['monitor sem unidade atribuida (todas as unidades, nenhuma turma)', m.monitor, ['g1', 'un1', 'un2', 'adultPub']],
      ['Mestre de OUTRO grupo', m.mestreB, []],
      ['aluno de OUTRO grupo', m.alunoB, []],
    ];
    for (const [label, who, visible] of expectations) {
      const got = await itemsOf(who);
      for (const key of Object.keys(S) as Array<keyof typeof S>) {
        assert.equal(got.has(S[key].id), visible.includes(key), `${label}: ${key} ${visible.includes(key) ? 'deveria' : 'NAO deveria'} aparecer`);
      }
    }
    // o pendente aparece COM status PENDING_APPROVAL so para o autor
    assert.equal((await itemsOf(m.minor)).get(S.minorPending.id)?.status, 'PENDING_APPROVAL');
    assert.equal((await itemsOf(m.minor)).get(S.adultPub.id)?.status, 'PUBLISHED');
    // pendente de OUTRO nao vale nem para o Mestre (ele usa a fila de moderacao)
    assert.equal((await itemsOf(m.mestre)).has(S.minorPending.id), false);
    // a foto pendente do autor usa URL de revisao (&r=1); a publicada, URL de membro
    const mine = (await itemsOf(m.minor)).get(S.minorPending.id) as StoryItem;
    assert.ok(mine.media.url.includes('&r=1') && mine.media.thumbUrl.includes('&r=1'));
    await binary(mine.media.thumbUrl).expect(200);
    const pub = (await itemsOf(m.adult)).get(S.g1.id) as StoryItem;
    assert.equal(pub.media.url.includes('&r=1'), false);
    const img = await binary(pub.media.url).expect(200);
    assert.equal(img.headers['content-type'], 'image/webp');
    assert.equal(img.headers['x-content-type-options'], 'nosniff');
    assert.equal(img.headers['cache-control'], 'private, max-age=3600');
    // mestre de outro grupo/aluno de outro grupo: lista vazia, 200
    assert.deepEqual((await http().get('/api/feed/stories').set(auth(m.alunoB.token)).expect(200)).body, { groups: [] });
  });

  it('story fora de GET /feed; nao reage, nao comenta, nao edita, nao fixa; denunciar vale; sem enumeracao (404 para quem nao ve)', async () => {
    // post comum continua no feed, com kind=POST e expiresAt nulo; o story nao
    const post = (await http().post('/api/feed/posts').set(auth(m.prof1.token)).send({ body: `post comum ${SECRET}`, visibility: 'GROUP' }).expect(201)).body as StoryPost;
    assert.equal(post.kind, 'POST');
    assert.equal(post.expiresAt, null);
    for (const who of [m.adult, m.mestre, m.prof1, m.minor]) {
      const seenIds = new Set<number>();
      let cursor: string | null = null;
      for (let i = 0; i < 50; i++) {
        const res: request.Response = await http().get('/api/feed').query({ limit: 30, ...(cursor ? { cursor } : {}) }).set(auth(who.token)).expect(200);
        for (const p of res.body.items as StoryPost[]) {
          assert.equal(p.kind, 'POST', 'o feed so tem POST');
          seenIds.add(p.id);
        }
        cursor = res.body.nextCursor;
        if (!cursor) break;
      }
      assert.equal(seenIds.has(post.id), true);
      for (const key of Object.keys(S) as Array<keyof typeof S>) assert.equal(seenIds.has(S[key].id), false, `story ${key} fora de GET /feed`);
    }

    const r = S.g1.id;
    assert.equal((await http().put(`/api/feed/posts/${r}/reaction`).set(auth(m.adult.token)).send({ type: 'AXE' }).expect(409)).body.code, 'INVALID_STATE');
    assert.equal((await http().put(`/api/feed/posts/${r}/reaction`).set(auth(m.adult.token)).send({ type: null }).expect(409)).body.code, 'INVALID_STATE');
    assert.equal((await http().post(`/api/feed/posts/${r}/comments`).set(auth(m.adult.token)).send({ body: 'oi' }).expect(409)).body.code, 'INVALID_STATE');
    assert.equal((await http().get(`/api/feed/posts/${r}/comments`).set(auth(m.adult.token)).expect(409)).body.code, 'INVALID_STATE');
    assert.equal((await http().patch(`/api/feed/posts/${r}`).set(auth(m.prof1.token)).send({ body: 'novo' }).expect(409)).body.code, 'INVALID_STATE');
    assert.equal((await http().post(`/api/feed/posts/${r}/pin`).set(auth(m.mestre.token)).expect(409)).body.code, 'INVALID_STATE');
    // quem NAO ve o story recebe o 404 de qualquer id (nao revela que existe)
    const nope = (await http().put('/api/feed/posts/999999999/reaction').set(auth(m.u2.token)).send({ type: 'AXE' }).expect(404)).body;
    const hidden = (await http().put(`/api/feed/posts/${S.un1.id}/reaction`).set(auth(m.u2.token)).send({ type: 'AXE' }).expect(404)).body;
    assert.deepEqual(hidden, nope);
    await http().post(`/api/feed/posts/${S.un1.id}/comments`).set(auth(m.u2.token)).send({ body: 'oi' }).expect(404);
    assert.equal(await prisma.feedReaction.count({ where: { postId: r } }), 0);
    assert.equal(await prisma.feedComment.count({ where: { postId: r } }), 0);
    assert.equal((await prisma.feedPost.findUniqueOrThrow({ where: { id: r } })).pinned, false);
    assert.equal((await prisma.feedPost.findUniqueOrThrow({ where: { id: r } })).edited, false);
    assert.equal((await prisma.feedPost.findUniqueOrThrow({ where: { id: r } })).body, `g1 ${SECRET}`);

    // denunciar story vigente: 200 {ok}; a fila REPORTED do Mestre traz o item com kind STORY; o autor nao denuncia o proprio
    assert.deepEqual((await http().post(`/api/feed/posts/${r}/report`).set(auth(m.adult.token)).send({ reason: 'SPAM' }).expect(200)).body, { ok: true });
    await http().post(`/api/feed/posts/${r}/report`).set(auth(m.prof1.token)).send({ reason: 'SPAM' }).expect(400);
    const queue = (await http().get('/api/feed/moderation/queue').query({ kind: 'REPORTED' }).set(auth(m.mestre.token)).expect(200)).body.items as Array<{ post: StoryPost; reportsCount: number }>;
    const item = queue.find((i) => i.post.id === r);
    assert.ok(item, 'story denunciado na fila REPORTED');
    assert.equal(item.post.kind, 'STORY');
    assert.equal(item.reportsCount, 1);
    assert.deepEqual((await http().post(`/api/feed/moderation/reports/${r}/resolve`).set(auth(m.mestre.token)).send({ action: 'DISMISS' }).expect(200)).body, { ok: true });
    assert.equal((await prisma.feedPost.findUniqueOrThrow({ where: { id: r } })).status, 'PUBLISHED');
  });

  it('view: 204 idempotente, so story visivel e vigente; autor nao grava; fora de alcance/pendente alheio/post comum/inexistente = o MESMO 404', async () => {
    await view(m.adult, S.g1.id).expect(204);
    await view(m.adult, S.g1.id).expect(204);
    await Promise.all([view(m.adult, S.un1.id), view(m.adult, S.un1.id), view(m.adult, S.un1.id)].map((p) => p.then((res) => assert.equal(res.status, 204))));
    assert.equal(await prisma.feedStoryView.count({ where: { postId: S.g1.id, userId: m.adult.id } }), 1, 'idempotente: uma linha so');
    assert.equal(await prisma.feedStoryView.count({ where: { postId: S.un1.id, userId: m.adult.id } }), 1, 'chamadas simultaneas: uma linha so');
    // o autor nao precisa marcar: 204 sem gravar
    await view(m.prof1, S.g1.id).expect(204);
    assert.equal(await prisma.feedStoryView.count({ where: { postId: S.g1.id, userId: m.prof1.id } }), 0);
    await view(m.minor, S.minorPending.id).expect(204); // proprio pendente
    assert.equal(await prisma.feedStoryView.count({ where: { postId: S.minorPending.id } }), 0);

    const post = (await http().post('/api/feed/posts').set(auth(m.prof1.token)).send({ body: 'post', visibility: 'GROUP' }).expect(201)).body as StoryPost;
    const nope = (await view(m.adult, 999999999).expect(404)).body;
    assert.equal(nope.code, 'NOT_FOUND');
    const cases: Array<[string, Member, number]> = [
      ['UNIT de outra unidade', m.u2, S.un1.id],
      ['CLASS de outra turma', m.extra, S.cl1.id],
      ['pendente de OUTRO usuario', m.adult, S.minorPending.id],
      ['pendente de outro, ate para o Mestre', m.mestre, S.minorPending.id],
      ['story de OUTRO grupo', m.alunoB, S.g1.id],
      ['Mestre de outro grupo', m.mestreB, S.g1.id],
      ['post comum (nao e story)', m.adult, post.id],
    ];
    for (const [label, who, id] of cases) assert.deepEqual((await view(who, id).expect(404)).body, nope, label);
    for (const [label, who, id] of cases) assert.equal(await prisma.feedStoryView.count({ where: { postId: id, userId: who.id } }), 0, `${label}: nada gravado`);
    await http().post('/api/feed/stories/abc/view').set(auth(m.adult.token)).expect(400);

    // feed desligado -> 403 FEED_DISABLED
    await settings({ enabled: false });
    assert.equal((await view(m.adult, S.g1.id).expect(403)).body.code, 'FEED_DISABLED');
    assert.equal((await http().get('/api/feed/stories').set(auth(m.adult.token)).expect(403)).body.code, 'FEED_DISABLED');
    await settings({ enabled: true });
  });

  it('moderacao: fila inclui story com kind/expiresAt; professor com escopo aprova/oculta/restaura; hierarquia hiddenById; nao fixa; vencido nao se aprova', async () => {
    await settings({ postingMode: 'MODERATED' });
    const pu1 = await mkStory(m.adult, { visibility: 'UNIT', unitId: u1, caption: SECRET });
    const pg = await mkStory(m.adult);
    assert.equal(pu1.status, 'PENDING_APPROVAL');
    const queue = async (who: Member, kind: string) =>
      (await http().get('/api/feed/moderation/queue').query({ kind, limit: 30 }).set(auth(who.token)).expect(200)).body.items as Array<{ post: StoryPost; reports: unknown[]; reportsCount: number }>;
    const mq = await queue(m.mestre, 'PENDING');
    const qi = mq.find((i) => i.post.id === pu1.id);
    assert.ok(qi && mq.some((i) => i.post.id === pg.id));
    assert.equal(qi.post.kind, 'STORY');
    assert.ok(qi.post.expiresAt);
    assert.equal(qi.post.body, SECRET, 'o moderador le a legenda');
    assert.equal(qi.post.media.length, 1);
    await binary(qi.post.media[0].thumbUrl).expect(200); // URL de revisao
    const pq = await queue(m.prof1, 'PENDING');
    assert.ok(pq.some((i) => i.post.id === pu1.id), 'professor com escopo ve o story pendente da unidade dele');
    assert.equal(pq.some((i) => i.post.id === pg.id), false, 'GROUP so o Mestre modera');
    assert.equal((await queue(m.prof2, 'PENDING')).some((i) => i.post.id === pu1.id), false, 'professor de outra unidade nao ve');
    await http().get('/api/feed/moderation/queue').set(auth(m.adult.token)).expect(403);
    await http().post(`/api/feed/posts/${pu1.id}/approve`).set(auth(m.prof2.token)).expect(404);
    await http().post(`/api/feed/posts/${pg.id}/approve`).set(auth(m.prof1.token)).expect(404);

    const approved = (await http().post(`/api/feed/posts/${pu1.id}/approve`).set(auth(m.prof1.token)).expect(200)).body as StoryPost;
    assert.equal(approved.status, 'PUBLISHED');
    assert.equal(approved.kind, 'STORY');
    const ok = await notifications(m.adult.id, 'FEED_APPROVED');
    assert.ok(ok.some((n) => (n.data as { postId?: number } | null)?.postId === pu1.id && n.title === 'Seu story foi publicado'));
    assert.equal((await itemsOf(m.extra)).has(pu1.id), true, 'aprovado aparece para a unidade');
    assert.equal((await itemsOf(m.u2)).has(pu1.id), false);

    // ocultar -> some da lista e a foto de membro deixa de servir; fila HIDDEN traz o story; avisa o autor (texto de story)
    const item = (await itemsOf(m.extra)).get(pu1.id) as StoryItem;
    const hid = (await http().post(`/api/feed/posts/${pu1.id}/hide`).set(auth(m.prof1.token)).expect(200)).body as StoryPost;
    assert.equal(hid.status, 'HIDDEN');
    assert.equal((await itemsOf(m.extra)).has(pu1.id), false);
    assert.equal((await itemsOf(m.adult)).has(pu1.id), false, 'nem o autor ve o oculto');
    await http().get(item.media.url).expect(404);
    assert.ok((await queue(m.prof1, 'HIDDEN')).some((i) => i.post.id === pu1.id && i.post.kind === 'STORY'));
    assert.ok((await notifications(m.adult.id, 'FEED_HIDDEN')).some((n) => n.title === 'Seu story não está visível'));
    assert.equal((await view(m.extra, pu1.id).expect(404)).body.code, 'NOT_FOUND', 'oculto nao se marca como visto');
    // restaurar: quem ocultou restaura
    assert.equal(((await http().post(`/api/feed/posts/${pu1.id}/restore`).set(auth(m.prof1.token)).expect(200)).body as StoryPost).status, 'PUBLISHED');
    // hierarquia: o que o MESTRE ocultou so o MESTRE devolve
    await http().post(`/api/feed/posts/${pu1.id}/hide`).set(auth(m.mestre.token)).expect(200);
    assert.equal((await http().post(`/api/feed/posts/${pu1.id}/restore`).set(auth(m.prof1.token)).expect(403)).body.code, 'MODERATION_NOT_ALLOWED');
    assert.equal((await prisma.feedPost.findUniqueOrThrow({ where: { id: pu1.id } })).status, 'HIDDEN');
    await http().post(`/api/feed/posts/${pu1.id}/restore`).set(auth(m.mestre.token)).expect(200);
    // professor nao apaga de vez o que o Mestre ocultou (DELETE), mas o Mestre sim
    await http().post(`/api/feed/posts/${pu1.id}/hide`).set(auth(m.mestre.token)).expect(200);
    assert.equal((await http().delete(`/api/feed/posts/${pu1.id}`).set(auth(m.prof1.token)).expect(403)).body.code, 'MODERATION_NOT_ALLOWED');
    await http().post(`/api/feed/posts/${pu1.id}/restore`).set(auth(m.mestre.token)).expect(200);
    // story nao e fixavel (Mestre inclusive)
    assert.equal((await http().post(`/api/feed/posts/${pu1.id}/pin`).set(auth(m.mestre.token)).expect(409)).body.code, 'INVALID_STATE');
    assert.equal((await prisma.feedPost.findUniqueOrThrow({ where: { id: pu1.id } })).pinned, false);

    // autor apaga o proprio: REMOVED, legenda e foto (banco + disco) somem
    const files = await mediaPaths(pu1.media[0].id);
    for (const f of files) assert.equal(await exists(f), true);
    await http().delete(`/api/feed/posts/${pu1.id}`).set(auth(m.adult.token)).expect(204);
    const gone = await prisma.feedPost.findUniqueOrThrow({ where: { id: pu1.id } });
    assert.deepEqual([gone.status, gone.body], ['REMOVED', null]);
    assert.equal(await prisma.feedPostMedia.count({ where: { postId: pu1.id } }), 0);
    for (const f of files) assert.equal(await exists(f), false);
    // outro aluno nao apaga story alheio; o Mestre apaga e o autor e avisado com texto de story
    const target = await mkStory(m.adult);
    await settings({ postingMode: 'ALL' });
    assert.equal((await http().delete(`/api/feed/posts/${S.adultPub.id}`).set(auth(m.extra.token)).expect(403)).body.code, 'FORBIDDEN');
    await http().delete(`/api/feed/posts/${S.adultPub.id}`).set(auth(m.mestre.token)).expect(204);
    assert.equal((await prisma.feedPost.findUniqueOrThrow({ where: { id: S.adultPub.id } })).status, 'REMOVED');
    assert.ok(
      (await notifications(m.adult.id, 'FEED_HIDDEN')).some((n) => (n.data as { postId?: number } | null)?.postId === S.adultPub.id && n.body.includes('story')),
      'o autor e avisado, com texto de story',
    );
    await http().delete(`/api/feed/posts/${target.id}`).set(auth(m.adult.token)).expect(204);

    // story pendente que ja venceu: nao se aprova (409) e some da fila PENDING
    await settings({ postingMode: 'MODERATED' });
    const late = await mkStory(m.adult);
    await prisma.feedPost.update({ where: { id: late.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await http().post(`/api/feed/posts/${late.id}/approve`).set(auth(m.mestre.token)).expect(409)).body.code, 'INVALID_STATE');
    assert.equal((await queue(m.mestre, 'PENDING')).some((i) => i.post.id === late.id), false);
    assert.equal((await prisma.feedPost.findUniqueOrThrow({ where: { id: late.id } })).status, 'PENDING_APPROVAL');
    await http().delete(`/api/feed/posts/${pg.id}`).set(auth(m.adult.token)).expect(204);
    await settings({ postingMode: 'ALL' });
  });

  it('vencido: some da lista, a foto assinada (ainda valida) passa a 404, view/denuncia 404; o arquivo fica ate o cron', async () => {
    const item = (await itemsOf(m.adult)).get(S.g1.id) as StoryItem;
    assert.ok(item, 'g1 vigente');
    await binary(item.media.url).expect(200);
    await binary(item.media.thumbUrl).expect(200);
    const files = await mediaPaths(item.media.id);
    // vence TODO story do grupo A (o teste de ordem parte de uma lista limpa)
    const past = new Date(Date.now() - 1000);
    await prisma.feedPost.updateMany({ where: { organizationId: orgA, kind: 'STORY' }, data: { expiresAt: past } });
    assert.equal((await http().get(item.media.url).expect(404)).body.code, 'NOT_FOUND');
    await http().get(item.media.thumbUrl).expect(404);
    for (const who of [m.adult, m.mestre, m.prof1, m.extra]) assert.equal((await itemsOf(who)).has(S.g1.id), false);
    assert.deepEqual((await http().get('/api/feed/stories').set(auth(m.extra.token)).expect(200)).body, { groups: [] });
    assert.equal((await view(m.adult, S.g1.id).expect(404)).body.code, 'NOT_FOUND');
    await http().post(`/api/feed/posts/${S.g1.id}/report`).set(auth(m.extra.token)).send({ reason: 'SPAM' }).expect(404);
    await http().put(`/api/feed/posts/${S.g1.id}/reaction`).set(auth(m.extra.token)).send({ type: 'AXE' }).expect(404);
    // ainda e PUBLISHED no banco e o arquivo existe: quem apaga e o cron (teste mais abaixo)
    assert.equal((await prisma.feedPost.findUniqueOrThrow({ where: { id: S.g1.id } })).status, 'PUBLISHED');
    for (const f of files) assert.equal(await exists(f), true);
  });

  it('ordem de GET /feed/stories: meu grupo, depois hasUnseen (mais recente 1o), depois vistos; itens do mais antigo ao mais novo; formato exato', async () => {
    await settings({ postingMode: 'ALL' });
    const e1 = await mkStory(m.extra, { caption: 'meu' });
    await sleep(15);
    const a1 = await mkStory(m.prof1);
    await sleep(15);
    const b1 = await mkStory(m.prof2);
    await sleep(15);
    const c1s = await mkStory(m.mestre);
    await sleep(15);
    const a2 = await mkStory(m.prof1);
    await sleep(15);
    const c2s = await mkStory(m.mestre);

    const names = (gs: StoryGroup[]) => gs.map((g) => g.author?.userId);
    let groups = await groupsOf(m.extra);
    assert.deepEqual(names(groups), [m.extra.id, m.mestre.id, m.prof1.id, m.prof2.id], 'meu grupo 1o; depois nao vistos, mais recente (c2) primeiro');
    assert.deepEqual(groups.map((g) => g.isMine), [true, false, false, false]);
    assert.deepEqual(groups.map((g) => g.hasUnseen), [false, true, true, true], 'o proprio story nunca e "nao visto"');
    assert.deepEqual(groups[0].items.map((i) => i.id), [e1.id]);
    assert.equal(groups[0].items[0].seen, true);
    assert.deepEqual(groups[1].items.map((i) => i.id), [c1s.id, c2s.id], 'do mais antigo para o mais novo');
    assert.deepEqual(groups[2].items.map((i) => i.id), [a1.id, a2.id]);
    assert.deepEqual(groups[3].items.map((i) => i.id), [b1.id]);
    // formato exato
    assert.deepEqual(Object.keys(groups[0]).sort(), ['author', 'hasUnseen', 'isMine', 'items']);
    assert.deepEqual(Object.keys(groups[1].author as object).sort(), ['name', 'nickname', 'photo', 'roleLabel', 'userId']);
    assert.deepEqual(Object.keys(groups[1].items[0]).sort(), ['caption', 'createdAt', 'expiresAt', 'id', 'media', 'seen', 'status']);
    assert.deepEqual(Object.keys(groups[1].items[0].media).sort(), ['height', 'id', 'thumbUrl', 'url', 'width']);
    assert.equal(groups[0].items[0].caption, 'meu');
    assert.equal(groups[1].items[0].caption, null);
    assert.deepEqual(groups.map((g) => g.author?.roleLabel), [null, 'Mestre', 'Professor', 'Professor']);
    assert.ok(groups.every((g) => g.items.every((i) => !('email' in (g.author ?? {})) && i.status === 'PUBLISHED')));

    // ve b1 e o grupo do mestre inteiro: eles vao para o fim (vistos), prof1 (com nao visto) sobe
    await view(m.extra, b1.id).expect(204);
    await view(m.extra, c1s.id).expect(204);
    groups = await groupsOf(m.extra);
    assert.deepEqual(names(groups), [m.extra.id, m.mestre.id, m.prof1.id, m.prof2.id], 'mestre ainda tem c2 nao visto');
    assert.deepEqual(groups[1].items.map((i) => i.seen), [true, false]);
    await view(m.extra, c2s.id).expect(204);
    groups = await groupsOf(m.extra);
    assert.deepEqual(names(groups), [m.extra.id, m.prof1.id, m.mestre.id, m.prof2.id], 'prof1 (nao visto) antes dos vistos; vistos por recencia (c2 > b1)');
    assert.deepEqual(groups.map((g) => g.hasUnseen), [false, true, false, false]);
    await view(m.extra, a1.id).expect(204);
    assert.equal((await groupsOf(m.extra))[1].hasUnseen, true, 'a2 ainda nao visto');
    await view(m.extra, a2.id).expect(204);
    groups = await groupsOf(m.extra);
    assert.deepEqual(names(groups), [m.extra.id, m.mestre.id, m.prof1.id, m.prof2.id], 'tudo visto: por recencia do ultimo story (c2 > a2 > b1)');
    assert.deepEqual(groups.map((g) => g.hasUnseen), [false, false, false, false]);
    assert.ok(groups.flatMap((g) => g.items).every((i) => i.seen));
    // o "visto" e por usuario: para o aluno adulto continua tudo nao visto
    assert.ok((await groupsOf(m.adult)).filter((g) => !g.isMine).every((g) => g.hasUnseen));
  });

  it('FEED_STORY_TTL_HOURS: padrao 24 h, configuravel e limitado a 1..48', async () => {
    const hours = async () => {
      const s = await mkStory(m.prof1);
      return Math.round(((new Date(s.expiresAt as string).getTime() - new Date(s.createdAt).getTime()) / 3_600_000) * 100) / 100;
    };
    assert.equal(await hours(), 24);
    assert.equal(await withEnv({ FEED_STORY_TTL_HOURS: '2' }, hours), 2);
    assert.equal(await withEnv({ FEED_STORY_TTL_HOURS: '999' }, hours), 48, 'clamp maximo');
    assert.equal(await withEnv({ FEED_STORY_TTL_HOURS: '0' }, hours), 1, 'clamp minimo');
    assert.equal(await withEnv({ FEED_STORY_TTL_HOURS: 'abc' }, hours), 24, 'invalido = padrao');
  });

  it('limpeza agendada (cron do feed): story vencido ha > 1 h vira REMOVED, perde legenda/foto (banco + disco)/vistos; antes disso e os vigentes ficam', async () => {
    const live = await mkStory(m.prof1, { caption: SECRET });
    await settings({ postingMode: 'MODERATED' });
    const pend = await mkStory(m.adult);
    await settings({ postingMode: 'ALL' });
    const toHide = await mkStory(m.prof1);
    await http().post(`/api/feed/posts/${toHide.id}/hide`).set(auth(m.mestre.token)).expect(200);
    const long = await withEnv({ FEED_STORY_TTL_HOURS: '48' }, () => mkStory(m.prof1)); // controle: ainda vigente
    await view(m.extra, live.id).expect(204);
    await http().post(`/api/feed/posts/${live.id}/report`).set(auth(m.u2.token)).send({ reason: 'SPAM' }).expect(200);
    const comic = (await http().post('/api/feed/posts').set(auth(m.prof1.token)).send({ body: 'post antigo', visibility: 'GROUP' }).expect(201)).body as StoryPost;
    await prisma.feedPost.update({ where: { id: comic.id }, data: { createdAt: new Date(Date.now() - 400 * 86_400_000) } });

    const victims = [live, pend, toHide];
    const files = (await Promise.all(victims.map((v) => mediaPaths(v.media[0].id)))).flat();
    const longFiles = await mediaPaths(long.media[0].id);
    const expiry = new Date(live.expiresAt as string).getTime();
    const cron = new FeedMediaCleanupCronService(app.get(PrismaService));
    const rows = () => prisma.feedPost.findMany({ where: { id: { in: [...victims.map((v) => v.id), long.id, comic.id] } }, select: { id: true, status: true, body: true } });

    assert.equal(await cron.run({ organizationId: orgA }), null, 'FEED_MEDIA_CLEANUP=false (env-setup): nao roda');
    // 59 min depois do vencimento (dentro da folga de 1 h): nada muda
    const early = await withEnv({ FEED_MEDIA_CLEANUP: 'true' }, () => cron.run({ now: new Date(expiry + 59 * 60_000), organizationId: orgA }));
    assert.ok(early);
    assert.ok((await rows()).every((r) => r.status !== 'REMOVED'), 'folga de 1 h respeitada');
    for (const f of files) assert.equal(await exists(f), true);

    // 61 min depois: os 3 vencidos saem (qualquer status); o de 48 h e o post antigo ficam
    const late = await withEnv({ FEED_MEDIA_CLEANUP: 'true' }, () => cron.run({ now: new Date(expiry + 61 * 60_000), organizationId: orgA }));
    assert.ok(late && late.expiredStories >= 3, `expiredStories=${late?.expiredStories}`);
    const afterRows = new Map((await rows()).map((r) => [r.id, r]));
    for (const v of victims) {
      assert.equal(afterRows.get(v.id)?.status, 'REMOVED', `story ${v.id} removido`);
      assert.equal(afterRows.get(v.id)?.body, null, 'legenda apagada');
      assert.equal(await prisma.feedPostMedia.count({ where: { postId: v.id } }), 0, 'linha da foto apagada');
      assert.equal(await prisma.feedStoryView.count({ where: { postId: v.id } }), 0, 'vistos apagados');
    }
    for (const f of files) assert.equal(await exists(f), false, 'arquivo apagado do disco');
    assert.equal((await prisma.feedPost.findUniqueOrThrow({ where: { id: live.id } })).hiddenReason, 'EXPIRED');
    assert.equal(await prisma.feedReport.count({ where: { postId: live.id, status: 'OPEN' } }), 0, 'denuncia aberta encerrada');
    assert.equal(afterRows.get(long.id)?.status, 'PUBLISHED', 'story de 48 h segue vigente');
    for (const f of longFiles) assert.equal(await exists(f), true);
    assert.equal(afterRows.get(comic.id)?.status, 'PUBLISHED', 'post antigo nao expira');
    assert.equal(await prisma.feedPostMedia.count({ where: { postId: long.id } }), 1);
    // idempotente
    const again = await withEnv({ FEED_MEDIA_CLEANUP: 'true' }, () => cron.run({ now: new Date(expiry + 62 * 60_000), organizationId: orgA }));
    assert.equal(again?.expiredStories, 0);
  });

  it('LGPD: anonimizar o titular apaga os stories dele (legenda e foto, banco e disco) e os "vistos" dele; some das listas', async () => {
    const mine = await mkStory(m.lgpd, { caption: `lgpd ${SECRET}` });
    const pendingPhoto = await newMedia(m.lgpd);
    const theirs = await mkStory(m.prof1);
    await view(m.lgpd, theirs.id).expect(204);
    assert.equal(await prisma.feedStoryView.count({ where: { userId: m.lgpd.id } }), 1);
    assert.equal((await itemsOf(m.extra)).has(mine.id), true);
    const files = [...(await mediaPaths(mine.media[0].id)), ...(await mediaPaths(pendingPhoto))];

    const req = await prisma.dataDeletionRequest.create({ data: { userId: m.lgpd.id, organizationId: orgA } });
    await app.get(AnonymizationService).anonymizeRequest(req.id, m.mestre.id);

    const row = await prisma.feedPost.findUniqueOrThrow({ where: { id: mine.id } });
    assert.equal(row.authorUserId, null);
    assert.equal(row.authorPersonId, null);
    assert.equal(row.body, null);
    assert.equal(row.status, 'REMOVED');
    assert.equal(await prisma.feedPostMedia.count({ where: { id: { in: [mine.media[0].id, pendingPhoto] } } }), 0);
    for (const f of files) assert.equal(await exists(f), false, 'foto do titular apagada do disco');
    assert.equal(await prisma.feedStoryView.count({ where: { userId: m.lgpd.id } }), 0, 'vistos do titular apagados');
    assert.equal((await itemsOf(m.extra)).has(mine.id), false);
    assert.equal((await view(m.extra, mine.id).expect(404)).body.code, 'NOT_FOUND');
    assert.ok((await itemsOf(m.extra)).has(theirs.id), 'story de terceiro intacto');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'PERSON_ANONYMIZE', userId: m.mestre.id }, orderBy: { id: 'desc' } });
    assert.equal((audit.metadata as { feedPostsAnonymized?: number }).feedPostsAnonymized, 1, 'o story entra na contagem da anonimizacao');
  });

  it('apagar a turma: o story da turma vira REMOVED (nao vira do grupo) e a foto sai na limpeza', async () => {
    const c3 = (await prisma.class.create({ data: { organizationId: orgA, unitId: u1, name: 'Turma 3', autoGenerateLessons: false } })).id;
    const s = await mkStory(m.mestre, { visibility: 'CLASS', classId: c3 });
    const files = await mediaPaths(s.media[0].id);
    await http().delete(`/api/classes/${c3}`).set(auth(m.mestre.token)).expect(200);
    const row = await prisma.feedPost.findUniqueOrThrow({ where: { id: s.id } });
    assert.deepEqual([row.status, row.classId, row.body], ['REMOVED', null, null]);
    assert.equal((await itemsOf(m.mestre)).has(s.id), false);
    const cron = new FeedMediaCleanupCronService(app.get(PrismaService));
    const res = await withEnv({ FEED_MEDIA_CLEANUP: 'true' }, () => cron.run({ organizationId: orgA }));
    assert.ok(res && res.removedPostsMedia >= 1);
    assert.equal(await prisma.feedPostMedia.count({ where: { postId: s.id } }), 0);
    for (const f of files) assert.equal(await exists(f), false);
  });

  it('auditoria FEED_STORY_CREATE sem conteudo (so ids, alcance, status e validade)', async () => {
    const rows = await prisma.auditLog.findMany({ where: { organizationId: orgA, action: 'FEED_STORY_CREATE' } });
    assert.ok(rows.length >= 20, `rows=${rows.length}`);
    assert.ok(rows.every((r) => r.resource === 'feed_post'));
    const allowed = new Set(['visibility', 'unitId', 'classId', 'status', 'expiresAt']);
    for (const r of rows) {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      assert.ok(Object.keys(meta).every((k) => allowed.has(k)), `chaves inesperadas: ${Object.keys(meta)}`);
    }
    const dump = JSON.stringify(rows.map((r) => r.metadata));
    assert.equal(dump.includes(SECRET), false, 'nenhuma legenda na auditoria');
    // nem os eventos de moderacao do feed carregam a legenda
    const all = await prisma.auditLog.findMany({ where: { organizationId: orgA, action: { startsWith: 'FEED_' } } });
    assert.equal(JSON.stringify(all.map((r) => r.metadata ?? {})).includes(SECRET), false);
  });
});
