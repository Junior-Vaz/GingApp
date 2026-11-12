import { INestApplication } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TournamentPublicService } from '../src/interface/http/tournaments/tournament-public.service';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import sharp from 'sharp';
import request from 'supertest';
import { TournamentPhotosCronService } from '../src/jobs/tournament-photos-cron.service';
import { setTournamentPhotoSharpForTests } from '../src/interface/http/tournaments/tournament-photo-storage';
import { TournamentPhotoSource } from '../src/interface/http/tournaments/tournament-photo-source';
import { TournamentLiveHub } from '../src/interface/http/tournaments/tournament-live-hub';
import { TournamentsService } from '../src/interface/http/tournaments/tournaments.service';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { createTestApp } from './utils/test-app';

/**
 * Foto PROPRIA do atleta de fora do chaveamento (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md 1, 1b e 7), HTTP real contra o Postgres de
 * dev e um diretorio temporario de fotos: envio/troca/remocao, magic bytes (HEIC/GIF/SVG/HTML renomeado = 415), gigante (413),
 * ilegivel, sharp indisponivel (503 sem gravar nada), cota (com corrida), isolamento entre grupos, papeis, a rota PUBLICA da foto
 * (so serve foto visivel; mesmo 404 para todo o resto), apagar atleta/categoria/evento, anonimizacao, GC, expiracao, importacao
 * com foto da inscricao (provedor falso), concorrencia de envios. Com TOURNAMENT_CAPTURE_DIR grava o JSON REAL com foto.
 */
const TAG = '[e2e-tphoto]';
const PASSWORD = 'Dev@12345';
const DAY = 86_400_000;
const MB = 1024 * 1024;
const UNKNOWN_FILE = '00000000-0000-4000-8000-000000000000.webp';

describe('Foto própria do atleta de fora (e2e)', () => {
  let app: INestApplication;
  let port = 0;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const envBackup = { ...process.env };
  const orgIds: number[] = [];
  const userIds: number[] = [];
  const eventIds: number[] = [];
  const dirs: string[] = [];
  const tokens: Record<string, string> = {};
  let orgA = 0;
  let orgB = 0;
  let orgC = 0;
  let hub: TournamentLiveHub;
  let tournaments: TournamentsService;
  let photosDir = '';

  const CAPTURE = process.env.TOURNAMENT_CAPTURE_DIR;
  const capture = (name: string, value: unknown) => {
    if (!CAPTURE) return;
    fs.mkdirSync(CAPTURE, { recursive: true });
    fs.writeFileSync(path.join(CAPTURE, `${name}.json`), JSON.stringify(value, null, 2), 'utf8');
  };

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const as = (who: string) => ({
    get: (p: string) => request(server()).get(`/api${p}`).set(auth(tokens[who])),
    post: (p: string, body?: object) => request(server()).post(`/api${p}`).set(auth(tokens[who])).send(body ?? {}),
    patch: (p: string, body: object) => request(server()).patch(`/api${p}`).set(auth(tokens[who])).send(body),
    del: (p: string) => request(server()).delete(`/api${p}`).set(auth(tokens[who])),
  });
  const pub = (token: string) => request(server()).get(`/api/public/tournaments/${token}`);
  const pubPhoto = (token: string, file: string) => request(server()).get(`/api/public/tournaments/${token}/photos/${file}`).buffer(true).parse(binaryParser);
  const photoPath = (token: string, file: string) => `/api/public/tournaments/${token}/photos/${file}`;

  // supertest: resposta binaria como Buffer
  function binaryParser(res: any, cb: (err: Error | null, body: Buffer) => void): void {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  }

  // ---- imagens ----
  const jpegOf = (color: string, w = 200, h = 160) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();
  const noisyJpeg = (w = 320, h = 320) =>
    sharp({ create: { width: w, height: h, channels: 3, background: '#000', noise: { type: 'gaussian', mean: 128, sigma: 70 } } }).jpeg({ quality: 90 }).toBuffer();
  const upload = (who: string, base: string, cid: number, id: number, buf: Buffer, filename = 'foto.jpg', field = 'file') =>
    request(server())
      .post(`/api${base}/categories/${cid}/competitors/${id}/photo`)
      .set(auth(tokens[who]))
      .attach(field, buf, { filename, contentType: 'image/jpeg' });
  const photoUrlOf = (base: string, cid: number, id: number) => `${base}/categories/${cid}/competitors/${id}/photo`;

  // ---- disco ----
  const freshDir = (): string => {
    photosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tphoto-e2e-'));
    dirs.push(photosDir);
    process.env.TOURNAMENT_PHOTOS_DIR = photosDir;
    return photosDir;
  };
  const filesInDir = (): string[] => fs.readdirSync(photosDir).sort();
  const rowOf = (id: number) => prisma.tournamentCompetitor.findUniqueOrThrow({ where: { id } });
  const revisionOf = async (tournamentId: number) => (await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } })).revision;

  // ---- dados ----
  const mkUser = async (orgId: number, role: OrgRole, label: string): Promise<string> => {
    const email = `${label}-${stamp}@e2e-tphoto.local`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(PASSWORD, 4), name: `${TAG} ${label}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    userIds.push(user.id);
    await prisma.organizationUser.create({ data: { organizationId: orgId, userId: user.id, role, status: 'ACTIVE' } });
    const res = await request(server()).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  };
  const mkEvent = async (orgId: number, over: Record<string, unknown> = {}) => {
    const event = await prisma.event.create({
      data: { organizationId: orgId, title: `${TAG} campeonato ${stamp}`, type: 'CAMPEONATO', date: new Date(Date.now() + DAY), status: 'PUBLISHED', ...over },
    });
    eventIds.push(event.id);
    return event;
  };
  const newTournament = async (who = 'mestre', orgId = orgA, eventOver: Record<string, unknown> = {}) => {
    const event = await mkEvent(orgId, eventOver);
    const t = (await as(who).post(`/events/${event.id}/tournament`).expect(201)).body;
    return { eventId: event.id, base: `/events/${event.id}/tournament`, tournamentId: t.id as number, token: t.publicToken as string };
  };
  const mkCategory = async (base: string, body: Record<string, unknown> = {}, who = 'mestre') =>
    (await as(who).post(`${base}/categories`, { name: `Cat ${Math.random().toString(36).slice(2, 8)}`, format: 'ROUND_ROBIN', ...body }).expect(201)).body;
  const addGuest = async (base: string, cid: number, guest: Record<string, unknown> = {}, who = 'mestre'): Promise<number> => {
    const res = await as(who).post(`${base}/categories/${cid}/competitors`, { guest: { displayName: `Atleta ${Math.random().toString(36).slice(2, 6)}`, ageGroup: 'ADULT', ...guest } }).expect(201);
    return res.body.competitors.at(-1).id as number;
  };
  const getCat = async (base: string, cid: number, who = 'mestre') => (await as(who).get(`${base}/categories/${cid}`).expect(200)).body;
  const enablePublic = (base: string) => as('mestre').patch(base, { publicEnabled: true }).expect(200);

  /** Primeiro `snapshot` de um stream SSE real (porta efemera). */
  const firstSseSnapshot = (token: string): Promise<any> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => { req.destroy(); reject(new Error('SSE: timeout')); }, 8000);
      const req = http.get({ host: '127.0.0.1', port, path: `/api/public/tournaments/${token}/stream`, headers: { Accept: 'text/event-stream' } }, (res) => {
        res.setEncoding('utf8');
        let buf = '';
        res.on('data', (chunk: string) => {
          buf += chunk;
          const i = buf.indexOf('event: snapshot');
          const end = i >= 0 ? buf.indexOf('\n\n', i) : -1;
          if (i >= 0 && end >= 0) {
            const line = buf.slice(i, end).split('\n').find((l) => l.startsWith('data: '))!;
            clearTimeout(timer);
            req.destroy();
            resolve(JSON.parse(line.slice(6)));
          }
        });
      });
      req.on('error', () => undefined);
    });

  before(async () => {
    freshDir();
    app = await createTestApp();
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;
    hub = app.get(TournamentLiveHub);
    tournaments = app.get(TournamentsService);
    const mkOrg = async (label: string) => {
      const org = await prisma.organization.create({
        data: { name: `${TAG} Grupo ${label} ${stamp}`, slug: `e2e-tphoto-${label}-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
      });
      orgIds.push(org.id);
      return org.id;
    };
    orgA = await mkOrg('a');
    orgB = await mkOrg('b');
    orgC = await mkOrg('c');
    tokens.mestre = await mkUser(orgA, OrgRole.MESTRE, 'mestre-a');
    tokens.professor = await mkUser(orgA, OrgRole.PROFESSOR, 'prof-a');
    tokens.instrutor = await mkUser(orgA, OrgRole.INSTRUTOR, 'instr-a');
    tokens.monitor = await mkUser(orgA, OrgRole.MONITOR, 'monitor-a');
    tokens.aluno = await mkUser(orgA, OrgRole.ALUNO, 'aluno-a');
    tokens.mestreB = await mkUser(orgB, OrgRole.MESTRE, 'mestre-b');
    tokens.mestreC = await mkUser(orgC, OrgRole.MESTRE, 'mestre-c');
  });

  afterEach(() => {
    setTournamentPhotoSharpForTests(undefined);
    process.env.TOURNAMENT_PHOTOS_QUOTA_MB = envBackup.TOURNAMENT_PHOTOS_QUOTA_MB as string;
    if (envBackup.TOURNAMENT_PHOTOS_QUOTA_MB === undefined) delete process.env.TOURNAMENT_PHOTOS_QUOTA_MB;
  });

  after(async () => {
    process.env = { ...envBackup };
    await app.close();
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: orgIds } }, { userId: { in: userIds } }] } });
    await prisma.eventParticipant.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.student.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });

  // =================================================================================================================
  describe('operador: enviar, ler, trocar e remover', () => {
    it('envia (WebP 800 sem EXIF, 0600), lê com cabeçalhos do contrato, troca (arquivo antigo some DEPOIS do commit) e remove; auditoria sem dado pessoal', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base, { name: 'Fotos' });
      const id = await addGuest(t.base, cat.id, { displayName: 'Atleta Foto' });
      const none = await as('mestre').get(photoUrlOf(t.base, cat.id, id)).expect(404);
      assert.equal(none.body.code, 'PHOTO_NOT_FOUND');

      // o hub so e avisado DEPOIS do commit: no instante do aviso, outra conexao ja ve o arquivo no banco
      const seen: Array<Promise<string | null>> = [];
      const original = hub.notifyChanged.bind(hub);
      hub.notifyChanged = (tid: number) => {
        seen.push(prisma.tournamentCompetitor.findUnique({ where: { id }, select: { photoFile: true } }).then((r) => r?.photoFile ?? null));
        original(tid);
      };
      let first: any;
      let firstFile = '';
      try {
        const rev0 = (await getCat(t.base, cat.id)).revision;
        const withExif = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#c33' } })
          .jpeg()
          .withExif({ IFD0: { Copyright: 'SENTINELA-EXIF-GPS' } })
          .toBuffer();
        const res = await upload('mestre', t.base, cat.id, id, withExif).expect(200);
        first = res.body;
        assert.equal(first.id, cat.id, 'devolve a categoria completa');
        assert.equal(first.revision, rev0 + 1, 'revision sobe');
        const c1 = first.competitors.find((c: any) => c.id === id);
        assert.deepEqual([c1.hasOwnPhoto, typeof c1.photoVersion, c1.photoUrl, c1.photoPublic], [true, 'number', null, true]);
        const row = await rowOf(id);
        firstFile = row.photoFile!;
        assert.match(firstFile, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/);
        assert.equal(row.photoUpdatedAt!.getTime(), c1.photoVersion);
        assert.deepEqual(filesInDir(), [firstFile]);
        const stored = fs.readFileSync(path.join(photosDir, firstFile));
        assert.equal(row.photoBytes, stored.length);
        const meta = await sharp(stored).metadata();
        assert.equal(meta.format, 'webp');
        assert.equal(Math.max(meta.width!, meta.height!), 800);
        assert.equal(meta.exif, undefined);
        assert.ok(!stored.includes(Buffer.from('SENTINELA-EXIF-GPS')));
        if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(photosDir, firstFile)).mode & 0o777, 0o600);
        assert.ok(!JSON.stringify(first).includes(firstFile), 'o nome do arquivo nunca vai na visao do operador');
        assert.deepEqual(await Promise.all(seen), [firstFile], 'hub avisado so depois do commit');
      } finally {
        hub.notifyChanged = original;
      }

      // leitura do operador (cabecalhos do contrato)
      const get = await as('mestre').get(photoUrlOf(t.base, cat.id, id)).buffer(true).parse(binaryParser).expect(200);
      assert.equal(get.headers['content-type'], 'image/webp');
      assert.equal(get.headers['cache-control'], 'private, no-store');
      assert.equal(get.headers['x-content-type-options'], 'nosniff');
      assert.equal(get.headers['content-security-policy'], "default-src 'none'; sandbox");
      assert.equal(get.headers['cross-origin-resource-policy'], 'same-origin');
      assert.deepEqual(get.body, fs.readFileSync(path.join(photosDir, firstFile)));

      // troca: arquivo novo, antigo apagado, versao muda
      await new Promise((r) => setTimeout(r, 15));
      const second = (await upload('professor', t.base, cat.id, id, await jpegOf('#3c3', 640, 480)).expect(200)).body;
      const row2 = await rowOf(id);
      assert.notEqual(row2.photoFile, firstFile);
      assert.deepEqual(filesInDir(), [row2.photoFile], 'o arquivo antigo foi apagado');
      assert.equal(second.revision, first.revision + 1);
      assert.ok(second.competitors.find((c: any) => c.id === id).photoVersion > first.competitors.find((c: any) => c.id === id).photoVersion);

      // remover
      const removed = (await as('mestre').del(photoUrlOf(t.base, cat.id, id)).expect(200)).body;
      const rc = removed.competitors.find((c: any) => c.id === id);
      assert.deepEqual([rc.hasOwnPhoto, rc.photoVersion, rc.photoPublic], [false, null, false]);
      assert.equal(removed.revision, second.revision + 1);
      assert.deepEqual(filesInDir(), []);
      const row3 = await rowOf(id);
      assert.deepEqual([row3.photoFile, row3.photoBytes, row3.photoUpdatedAt], [null, null, null]);
      // remover de novo: idempotente (200, sem revisao nova)
      const again = (await as('mestre').del(photoUrlOf(t.base, cat.id, id)).expect(200)).body;
      assert.equal(again.revision, removed.revision);
      assert.equal((await as('mestre').get(photoUrlOf(t.base, cat.id, id)).expect(404)).body.code, 'PHOTO_NOT_FOUND');

      // auditoria: sem nome de arquivo nem dado pessoal
      const audits = await prisma.auditLog.findMany({ where: { organizationId: orgA, resourceId: String(id), action: { in: ['TOURNAMENT_COMPETITOR_PHOTO_SET', 'TOURNAMENT_COMPETITOR_PHOTO_REMOVED'] } }, orderBy: { id: 'asc' } });
      assert.deepEqual(audits.map((a) => a.action), ['TOURNAMENT_COMPETITOR_PHOTO_SET', 'TOURNAMENT_COMPETITOR_PHOTO_SET', 'TOURNAMENT_COMPETITOR_PHOTO_REMOVED']);
      assert.deepEqual((audits[0].metadata as any).replaced, false);
      assert.deepEqual((audits[1].metadata as any).replaced, true);
      const rawAudit = JSON.stringify(audits);
      assert.ok(!rawAudit.includes(firstFile) && !rawAudit.includes(row2.photoFile!) && !rawAudit.includes('Atleta Foto'));
    });

    it('atleta ligado a aluno = 400 PHOTO_FROM_STUDENT (nada é gravado); id de outra categoria/inexistente = 404', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base, { name: 'A' });
      const other = await mkCategory(t.base, { name: 'B' });
      const student = await prisma.student.create({ data: { organizationId: orgA, name: 'Aluno Ligado', status: 'ACTIVE', photo: '/api/uploads/aaaaaaaa-aaaa-4aaa-8aaa-000000000009.webp', birthDate: new Date('1990-01-01T00:00:00Z') } });
      const linked = (await as('mestre').post(`${t.base}/categories/${cat.id}/competitors`, { studentId: student.id }).expect(201)).body.competitors.at(-1).id;
      const guest = await addGuest(t.base, cat.id);
      const r = await upload('mestre', t.base, cat.id, linked, await jpegOf('#333')).expect(400);
      assert.equal(r.body.code, 'PHOTO_FROM_STUDENT');
      assert.deepEqual(filesInDir(), []);
      assert.equal((await rowOf(linked)).photoFile, null);
      const op = (await getCat(t.base, cat.id)).competitors.find((c: any) => c.id === linked);
      assert.deepEqual([op.photoUrl, op.hasOwnPhoto], ['/api/uploads/aaaaaaaa-aaaa-4aaa-8aaa-000000000009.webp', false], 'photoUrl do operador = SO a foto do aluno');
      // atleta de outra categoria na URL / inexistente / outro evento
      assert.equal((await upload('mestre', t.base, other.id, guest, await jpegOf('#333')).expect(404)).body.code, 'COMPETITOR_NOT_FOUND');
      assert.equal((await upload('mestre', t.base, cat.id, guest + 99999, await jpegOf('#333')).expect(404)).body.code, 'COMPETITOR_NOT_FOUND');
      assert.equal((await as('mestre').get(photoUrlOf(t.base, other.id, guest)).expect(404)).body.code, 'COMPETITOR_NOT_FOUND');
      assert.equal((await as('mestre').del(photoUrlOf(t.base, other.id, guest)).expect(404)).body.code, 'COMPETITOR_NOT_FOUND');
      assert.deepEqual(filesInDir(), []);
    });

    it('papéis: MONITOR lê e não escreve; ALUNO 403 em tudo; anônimo 401; PROFESSOR/INSTRUTOR escrevem', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base);
      const id = await addGuest(t.base, cat.id);
      await upload('professor', t.base, cat.id, id, await jpegOf('#111')).expect(200);
      await upload('instrutor', t.base, cat.id, id, await jpegOf('#222')).expect(200);
      const url = photoUrlOf(t.base, cat.id, id);
      assert.equal((await as('monitor').get(url).expect(200)).headers['content-type'], 'image/webp');
      await upload('monitor', t.base, cat.id, id, await jpegOf('#333')).expect(403);
      await as('monitor').del(url).expect(403);
      await as('aluno').get(url).expect(403);
      await upload('aluno', t.base, cat.id, id, await jpegOf('#333')).expect(403);
      await as('aluno').del(url).expect(403);
      await request(server()).get(`/api${url}`).expect(401);
      await request(server()).post(`/api${url}`).attach('file', await jpegOf('#333'), 'f.jpg').expect(401);
      await request(server()).delete(`/api${url}`).expect(401);
      assert.equal(filesInDir().length, 1, 'so a ultima troca bem-sucedida ficou');
    });

    it('isolamento entre grupos: o outro grupo nunca lê, envia nem apaga (404), nem pelo id do próprio evento', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base);
      const id = await addGuest(t.base, cat.id);
      await upload('mestre', t.base, cat.id, id, await jpegOf('#a55')).expect(200);
      const before = await rowOf(id);
      // evento do grupo A visto pelo grupo B
      await as('mestreB').get(photoUrlOf(t.base, cat.id, id)).expect(404);
      await upload('mestreB', t.base, cat.id, id, await jpegOf('#555')).expect(404);
      await as('mestreB').del(photoUrlOf(t.base, cat.id, id)).expect(404);
      // evento do grupo B com ids do grupo A
      const tb = await newTournament('mestreB', orgB);
      const catB = await mkCategory(tb.base, {}, 'mestreB');
      assert.equal((await as('mestreB').get(photoUrlOf(tb.base, catB.id, id)).expect(404)).body.code, 'COMPETITOR_NOT_FOUND');
      assert.equal((await upload('mestreB', tb.base, catB.id, id, await jpegOf('#555')).expect(404)).body.code, 'COMPETITOR_NOT_FOUND');
      assert.equal((await as('mestreB').del(photoUrlOf(tb.base, catB.id, id)).expect(404)).body.code, 'COMPETITOR_NOT_FOUND');
      const after = await rowOf(id);
      assert.equal(after.photoFile, before.photoFile);
      assert.equal(filesInDir().length, 1);
    });
  });

  // =================================================================================================================
  describe('validação da imagem: nada inválido chega ao disco', () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(64)]);
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(64, 1)]);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    const html = Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>');

    it('HEIC, GIF, SVG, HTML renomeado = 415 PHOTO_TYPE_NOT_ALLOWED', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base);
      const id = await addGuest(t.base, cat.id);
      let captured = false;
      for (const [name, buf, filename] of [['heic', heic, 'foto.heic'], ['gif', gif, 'foto.gif'], ['svg', svg, 'foto.svg'], ['html', html, 'foto.jpg'], ['texto', Buffer.from('nao sou imagem'), 'foto.jpg']] as const) {
        const r = await upload('mestre', t.base, cat.id, id, buf, filename).expect(415);
        assert.equal(r.body.code, 'PHOTO_TYPE_NOT_ALLOWED', name);
        assert.deepEqual(Object.keys(r.body).sort(), ['code', 'message', 'statusCode']);
        if (!captured) { capture('error-415-photo-type-not-allowed', r.body); captured = true; }
      }
      assert.deepEqual(filesInDir(), []);
      assert.equal((await rowOf(id)).photoFile, null);
    });

    it('arquivo gigante = 413 PHOTO_TOO_LARGE (limite 5 MB; nada gravado)', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base);
      const id = await addGuest(t.base, cat.id);
      const jpegHead = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const big = Buffer.concat([jpegHead, Buffer.alloc(6 * MB, 7)]);
      const r = await upload('mestre', t.base, cat.id, id, big).expect(413);
      assert.equal(r.body.code, 'PHOTO_TOO_LARGE');
      assert.deepEqual(Object.keys(r.body).sort(), ['code', 'message', 'statusCode']);
      capture('error-413-photo-too-large', r.body);
      const justOver = Buffer.concat([jpegHead, Buffer.alloc(5 * MB - 3, 7)]); // 5 MB + 1 byte
      assert.equal(justOver.length, 5 * MB + 1);
      assert.equal((await upload('mestre', t.base, cat.id, id, justOver).expect(413)).body.code, 'PHOTO_TOO_LARGE');
      assert.deepEqual(filesInDir(), []);
    });

    it('imagem ilegível (cortada, lixo, bomba de pixels) = 415 PHOTO_UNREADABLE; sem arquivo / campo errado = 400', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base);
      const id = await addGuest(t.base, cat.id);
      const good = await jpegOf('#369', 400, 400);
      const truncated = good.subarray(0, Math.floor(good.length / 3));
      const junk = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 9)]);
      const bomb = await sharp({ create: { width: 5200, height: 5000, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer();
      assert.ok(bomb.length < 5 * MB, 'a bomba cabe no limite de bytes');
      for (const [name, buf] of [['cortada', truncated], ['lixo', junk], ['bomba', bomb]] as const) {
        assert.equal((await upload('mestre', t.base, cat.id, id, buf).expect(415)).body.code, 'PHOTO_UNREADABLE', name);
      }
      assert.equal((await request(server()).post(`/api${photoUrlOf(t.base, cat.id, id)}`).set(auth(tokens.mestre)).expect(400)).body.code, 'PHOTO_FILE_REQUIRED');
      await upload('mestre', t.base, cat.id, id, good, 'x.jpg', 'foto').expect(400);
      assert.deepEqual(filesInDir(), []);
    });

    it('sharp indisponível (simulado) = 503 PHOTO_PROCESSING_UNAVAILABLE e NADA é gravado (nunca o original)', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base);
      const id = await addGuest(t.base, cat.id);
      setTournamentPhotoSharpForTests(null);
      const r = await upload('mestre', t.base, cat.id, id, await jpegOf('#963')).expect(503);
      assert.equal(r.body.code, 'PHOTO_PROCESSING_UNAVAILABLE');
      capture('error-503-photo-processing-unavailable', r.body);
      assert.deepEqual(filesInDir(), [], 'nenhum arquivo, nem o original');
      assert.equal((await rowOf(id)).photoFile, null);
      // magic bytes continuam vindo antes: formato errado segue 415 mesmo sem sharp
      assert.equal((await upload('mestre', t.base, cat.id, id, gif).expect(415)).body.code, 'PHOTO_TYPE_NOT_ALLOWED');
      setTournamentPhotoSharpForTests(undefined);
      await upload('mestre', t.base, cat.id, id, await jpegOf('#963')).expect(200);
      assert.equal(filesInDir().length, 1);
    });
  });

  // =================================================================================================================
  describe('cota por grupo (TOURNAMENT_PHOTOS_QUOTA_MB)', () => {
    it('estourou = 429 PHOTO_QUOTA sem gravar; trocar pela mesma foto cabe; outro grupo não é afetado; liberar espaço devolve', async () => {
      freshDir();
      const tb = await newTournament('mestreB', orgB);
      const cat = await mkCategory(tb.base, {}, 'mestreB');
      const [a, b, c] = [await addGuest(tb.base, cat.id, {}, 'mestreB'), await addGuest(tb.base, cat.id, {}, 'mestreB'), await addGuest(tb.base, cat.id, {}, 'mestreB')];
      const img = await noisyJpeg();
      await upload('mestreB', tb.base, cat.id, a, img).expect(200);
      const size = (await rowOf(a)).photoBytes!;
      assert.ok(size > 2000, `foto de ruido tem corpo (${size} bytes)`);
      process.env.TOURNAMENT_PHOTOS_QUOTA_MB = String((size * 1.5) / MB);
      const r = await upload('mestreB', tb.base, cat.id, b, img).expect(429);
      assert.equal(r.body.code, 'PHOTO_QUOTA');
      capture('error-429-photo-quota', r.body);
      assert.deepEqual(Object.keys(r.body).sort(), ['code', 'message', 'statusCode']);
      assert.equal(filesInDir().length, 1, 'nada foi gravado para o recusado');
      assert.equal((await rowOf(b)).photoFile, null);
      // trocar a PROPRIA foto por uma do mesmo tamanho cabe (delta zero)
      await upload('mestreB', tb.base, cat.id, a, img).expect(200);
      assert.equal(filesInDir().length, 1);
      // o grupo A (soma propria) nao e afetado pela cota do B ocupada: cabe uma foto de ~size
      const ta = await newTournament();
      const catA = await mkCategory(ta.base);
      const idA = await addGuest(ta.base, catA.id);
      await upload('mestre', ta.base, catA.id, idA, img).expect(200);
      // liberar espaco devolve
      await as('mestreB').del(photoUrlOf(tb.base, cat.id, a)).expect(200);
      await upload('mestreB', tb.base, cat.id, c, img).expect(200);
      await as('mestreB').del(photoUrlOf(tb.base, cat.id, c)).expect(200);
    });

    it('corrida: dois envios ao mesmo tempo (categorias diferentes) quando só cabe um = exatamente um 200 e um 429', async () => {
      freshDir();
      const tb = await newTournament('mestreB', orgB);
      const [c1, c2] = [await mkCategory(tb.base, {}, 'mestreB'), await mkCategory(tb.base, {}, 'mestreB')];
      const [a, b] = [await addGuest(tb.base, c1.id, {}, 'mestreB'), await addGuest(tb.base, c2.id, {}, 'mestreB')];
      const img = await noisyJpeg();
      await upload('mestreB', tb.base, c1.id, a, img).expect(200);
      const size = (await rowOf(a)).photoBytes!;
      await as('mestreB').del(photoUrlOf(tb.base, c1.id, a)).expect(200);
      process.env.TOURNAMENT_PHOTOS_QUOTA_MB = String((size * 1.5) / MB);
      for (let round = 0; round < 3; round++) {
        const results = await Promise.all([upload('mestreB', tb.base, c1.id, a, img), upload('mestreB', tb.base, c2.id, b, img)]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 429], `rodada ${round}`);
        const used = (await prisma.tournamentCompetitor.aggregate({ where: { organizationId: orgB }, _sum: { photoBytes: true } }))._sum.photoBytes ?? 0;
        assert.ok(used <= Math.floor(size * 1.5), 'a soma nunca passa da cota');
        assert.equal(filesInDir().length, 1, 'nenhum arquivo orfao do envio recusado');
        for (const [cid, id] of [[c1.id, a], [c2.id, b]] as const) {
          if ((await rowOf(id)).photoFile) await as('mestreB').del(photoUrlOf(tb.base, cid, id)).expect(200);
        }
        assert.deepEqual(filesInDir(), []);
      }
    });
  });

  // =================================================================================================================
  describe('concorrência de envios no mesmo atleta', () => {
    it('vários POST ao mesmo tempo = um estado coerente e nenhum arquivo órfão; POST x DELETE idem', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base);
      const id = await addGuest(t.base, cat.id);
      for (let round = 0; round < 3; round++) {
        const imgs = await Promise.all(['#e33', '#3e3', '#33e', '#ee3'].map((c) => jpegOf(c, 300 + round, 200)));
        const results = await Promise.all(imgs.map((b) => upload('mestre', t.base, cat.id, id, b)));
        assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.status)));
        const row = await rowOf(id);
        assert.deepEqual(filesInDir(), [row.photoFile], `rodada ${round}: so o arquivo referenciado existe`);
        assert.equal(row.photoBytes, fs.statSync(path.join(photosDir, row.photoFile!)).size);
      }
      for (let round = 0; round < 3; round++) {
        const results = await Promise.all([
          upload('mestre', t.base, cat.id, id, await jpegOf('#abc', 220 + round, 180)),
          as('mestre').del(photoUrlOf(t.base, cat.id, id)),
          upload('professor', t.base, cat.id, id, await jpegOf('#cba', 230 + round, 180)),
        ]);
        assert.ok(results.every((r) => r.status === 200));
        const row = await rowOf(id);
        assert.deepEqual(filesInDir(), row.photoFile ? [row.photoFile] : [], `rodada ${round}: arquivo = coluna`);
        assert.equal(row.photoBytes === null, row.photoFile === null);
      }
    });
  });

  // =================================================================================================================
  describe('rota PÚBLICA da foto: só serve foto visível', () => {
    it('menor sem autorização = 404 idêntico ao de arquivo inexistente; autorizar = 200; remover autorização = 404; snapshot e SSE acompanham', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base, { name: 'Publica' });
      const minor = await addGuest(t.base, cat.id, { displayName: 'Menor Com Foto', ageGroup: 'MINOR' });
      await addGuest(t.base, cat.id, { displayName: 'Outro Atleta' });
      await upload('mestre', t.base, cat.id, minor, await jpegOf('#d33', 500, 400)).expect(200);
      const file = (await rowOf(minor)).photoFile!;
      await enablePublic(t.base);
      const same = fs.readFileSync(path.join(photosDir, file));

      const unknown = await pubPhoto(t.token, UNKNOWN_FILE).expect(404);
      const denied = await pubPhoto(t.token, file).expect(404);
      assert.deepEqual(denied.body, unknown.body, 'mesmo corpo (e nao e a imagem)');
      assert.equal(JSON.parse(denied.text ?? JSON.stringify(denied.body)).code ?? 'TOURNAMENT_NOT_FOUND', 'TOURNAMENT_NOT_FOUND');
      for (const h of ['content-type', 'cache-control', 'x-robots-tag']) assert.equal(denied.headers[h], unknown.headers[h], h);
      let snap = (await pub(t.token).expect(200)).body;
      assert.equal(snap.categories[0].competitors.find((c: any) => c.name === 'Menor Com Foto').photoUrl, null);
      assert.ok(!JSON.stringify(snap).includes(file), 'snapshot nao vaza o nome do arquivo do menor');
      const sse1 = await firstSseSnapshot(t.token);
      assert.ok(!JSON.stringify(sse1).includes(file), 'SSE nao vaza o nome do arquivo do menor');
      const etag0 = (await pub(t.token).expect(200)).headers.etag;

      // autorizar: 200 e a URL aparece no snapshot
      await as('mestre').patch(`${t.base}/competitors/${minor}`, { photoAuthorized: true }).expect(200);
      const ok = await pubPhoto(t.token, file).expect(200);
      assert.equal(ok.headers['content-type'], 'image/webp');
      assert.equal(ok.headers['cache-control'], 'public, max-age=300');
      assert.equal(ok.headers['x-content-type-options'], 'nosniff');
      assert.equal(ok.headers['content-security-policy'], "default-src 'none'; sandbox");
      assert.equal(ok.headers['cross-origin-resource-policy'], 'cross-origin');
      assert.equal(ok.headers['x-robots-tag'], 'noindex');
      assert.deepEqual(ok.body, same);
      assert.equal(((await sharp(ok.body as Buffer).metadata()).format), 'webp');
      const res2 = await pub(t.token).expect(200);
      snap = res2.body;
      assert.notEqual(res2.headers.etag, etag0, 'ETag muda quando a foto passa a aparecer');
      const url = snap.categories[0].competitors.find((c: any) => c.name === 'Menor Com Foto').photoUrl;
      assert.equal(url, photoPath(t.token, file));
      assert.equal((await pubPhoto(t.token, String(url).split('/').pop() as string).expect(200)).body.length, same.length, 'a URL do snapshot funciona');
      const sse2 = await firstSseSnapshot(t.token);
      assert.equal(sse2.categories[0].competitors.find((c: any) => c.name === 'Menor Com Foto').photoUrl, url);

      // remover a autorizacao: 404 NA HORA (sem cache do servidor) e o snapshot volta a null
      await as('mestre').patch(`${t.base}/competitors/${minor}`, { photoAuthorized: false }).expect(200);
      const gone = await pubPhoto(t.token, file).expect(404);
      assert.deepEqual(gone.body, unknown.body);
      snap = (await pub(t.token).expect(200)).body;
      assert.equal(snap.categories[0].competitors.find((c: any) => c.name === 'Menor Com Foto').photoUrl, null);
      assert.ok(!JSON.stringify(snap).includes(file));
    });

    it('adulto serve sem autorização; virar menor tira; MINOR/UNKNOWN autorizados servem; trocar a foto invalida o nome antigo', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base);
      const adult = await addGuest(t.base, cat.id, { displayName: 'Adulto Foto', ageGroup: 'ADULT' });
      const unknown = await addGuest(t.base, cat.id, { displayName: 'Sem Idade Foto', ageGroup: 'UNKNOWN' });
      await upload('mestre', t.base, cat.id, adult, await jpegOf('#2a2')).expect(200);
      await upload('mestre', t.base, cat.id, unknown, await jpegOf('#22a')).expect(200);
      const fAdult = (await rowOf(adult)).photoFile!;
      const fUnknown = (await rowOf(unknown)).photoFile!;
      await enablePublic(t.base);
      await pubPhoto(t.token, fAdult).expect(200);
      await pubPhoto(t.token, fUnknown).expect(404);
      await as('mestre').patch(`${t.base}/competitors/${unknown}`, { photoAuthorized: true }).expect(200);
      await pubPhoto(t.token, fUnknown).expect(200);
      await as('mestre').patch(`${t.base}/competitors/${adult}`, { ageGroup: 'MINOR' }).expect(200);
      await pubPhoto(t.token, fAdult).expect(404);
      await as('mestre').patch(`${t.base}/competitors/${adult}`, { ageGroup: 'ADULT' }).expect(200);
      await pubPhoto(t.token, fAdult).expect(200);
      // trocar a foto: o nome antigo morre (arquivo apagado), o novo serve
      await upload('mestre', t.base, cat.id, adult, await jpegOf('#a22')).expect(200);
      const fNew = (await rowOf(adult)).photoFile!;
      assert.notEqual(fNew, fAdult);
      await pubPhoto(t.token, fAdult).expect(404);
      await pubPhoto(t.token, fNew).expect(200);
      // remover a foto: nome some
      await as('mestre').del(photoUrlOf(t.base, cat.id, adult)).expect(200);
      await pubPhoto(t.token, fNew).expect(404);
    });

    it('token rotacionado = 404 (o antigo morre; o novo serve e o snapshot novo traz a URL nova); telão desligado, evento rascunho/cancelado/antigo = 404', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base);
      const id = await addGuest(t.base, cat.id, { displayName: 'Rotacao Foto', ageGroup: 'ADULT' });
      await upload('mestre', t.base, cat.id, id, await jpegOf('#2aa')).expect(200);
      const file = (await rowOf(id)).photoFile!;
      await enablePublic(t.base);
      await pubPhoto(t.token, file).expect(200);
      const oldSnap = (await pub(t.token).expect(200)).body; // aquece o cache do token antigo
      assert.equal(oldSnap.categories[0].competitors[0].photoUrl, photoPath(t.token, file));

      const rotated = (await as('mestre').post(`${t.base}/rotate-token`).expect(200)).body;
      const newToken = rotated.publicToken as string;
      assert.notEqual(newToken, t.token);
      await pubPhoto(t.token, file).expect(404);
      await pub(t.token).expect(404);
      await pubPhoto(newToken, file).expect(200);
      const fresh = (await pub(newToken).expect(200)).body;
      assert.equal(fresh.categories[0].competitors[0].photoUrl, photoPath(newToken, file));
      assert.ok(!JSON.stringify(fresh).includes(t.token), 'o token antigo nao aparece no snapshot novo');

      // desligar o telao
      await as('mestre').patch(t.base, { publicEnabled: false }).expect(200);
      await pubPhoto(newToken, file).expect(404);
      await as('mestre').patch(t.base, { publicEnabled: true }).expect(200);
      await pubPhoto(newToken, file).expect(200);
      // evento rascunho / cancelado / mais de 30 dias
      for (const [status, date] of [['DRAFT', new Date(Date.now() + DAY)], ['CANCELLED', new Date(Date.now() + DAY)], ['PUBLISHED', new Date(Date.now() - 31 * DAY)]] as const) {
        await prisma.event.update({ where: { id: t.eventId }, data: { status, date } });
        await pubPhoto(newToken, file).expect(404);
      }
      await prisma.event.update({ where: { id: t.eventId }, data: { status: 'PUBLISHED', date: new Date(Date.now() + DAY) } });
      await pubPhoto(newToken, file).expect(200);
    });

    it('torneio/grupo errados e nomes maliciosos = 404; atleta ligado a aluno com arquivo "plantado" não serve', async () => {
      freshDir();
      const t1 = await newTournament();
      const t2 = await newTournament(); // mesmo grupo, outro torneio
      const tb = await newTournament('mestreB', orgB); // outro grupo
      const cat = await mkCategory(t1.base);
      const id = await addGuest(t1.base, cat.id, { displayName: 'Do Torneio Um', ageGroup: 'ADULT' });
      await upload('mestre', t1.base, cat.id, id, await jpegOf('#5a5')).expect(200);
      const file = (await rowOf(id)).photoFile!;
      for (const x of [t1, t2]) await enablePublic(x.base);
      await as('mestreB').patch(tb.base, { publicEnabled: true }).expect(200);
      await pubPhoto(t1.token, file).expect(200);
      const ref = await pubPhoto(t1.token, UNKNOWN_FILE).expect(404);
      for (const wrongToken of [t2.token, tb.token]) {
        const r = await pubPhoto(wrongToken, file).expect(404);
        assert.deepEqual(r.body, ref.body);
      }
      for (const bad of ['..%2f..%2fetc%2fpasswd', `..%2F${file}`, file.toUpperCase(), file.replace('.webp', '.png'), `${file}%00`, `${file}.exe`, 'x.webp', `%2e%2e/${file}`]) {
        const r = await request(server()).get(`/api/public/tournaments/${t1.token}/photos/${bad}`).buffer(true).parse(binaryParser);
        assert.equal(r.status, 404, bad);
      }
      await request(server()).get(`/api/public/tournaments/${'x'.repeat(10)}/photos/${file}`).expect(404);
      // defesa em profundidade: arquivo plantado em atleta LIGADO A ALUNO (nunca deveria existir) nao serve
      const student = await prisma.student.create({ data: { organizationId: orgA, name: 'Aluno Plantado', status: 'ACTIVE', birthDate: new Date('1985-01-01T00:00:00Z') } });
      const linked = (await as('mestre').post(`${t1.base}/categories/${cat.id}/competitors`, { studentId: student.id }).expect(201)).body.competitors.at(-1).id;
      const planted = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).webp().toBuffer();
      const plantedName = '11111111-2222-4333-8444-555555555555.webp';
      fs.writeFileSync(path.join(photosDir, plantedName), planted);
      await prisma.tournamentCompetitor.update({ where: { id: linked }, data: { photoFile: plantedName, photoBytes: planted.length, photoUpdatedAt: new Date() } });
      await pubPhoto(t1.token, plantedName).expect(404);
      const snap = (await pub(t1.token).expect(200)).body;
      assert.ok(!JSON.stringify(snap).includes(plantedName), 'snapshot nao usa foto propria de atleta ligado a aluno');
      assert.equal((await as('mestre').get(photoUrlOf(t1.base, cat.id, linked)).expect(404)).body.code, 'PHOTO_NOT_FOUND');
    });

    it('log de requisição da rota da foto: só o padrão da rota, sem token, sem nome do arquivo, sem IP/usuário', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base);
      const id = await addGuest(t.base, cat.id, { ageGroup: 'ADULT' });
      await upload('mestre', t.base, cat.id, id, await jpegOf('#5aa')).expect(200);
      const file = (await rowOf(id)).photoFile!;
      await enablePublic(t.base);
      const lines: string[] = [];
      const originalWrite = process.stdout.write.bind(process.stdout);
      const prevLog = process.env.REQUEST_LOG;
      process.env.REQUEST_LOG = 'true';
      (process.stdout as unknown as { write: (c: unknown) => boolean }).write = (chunk: unknown) => {
        const text = String(chunk);
        if (text.includes('"msg":"http_request"')) {
          lines.push(text);
          return true;
        }
        return originalWrite(chunk as string);
      };
      try {
        await pubPhoto(t.token, file).expect(200);
        await pubPhoto(t.token, UNKNOWN_FILE).expect(404);
      } finally {
        (process.stdout as unknown as { write: unknown }).write = originalWrite;
        process.env.REQUEST_LOG = prevLog;
      }
      const all = lines.join('');
      const mine = lines.map((l) => JSON.parse(l)).filter((l: any) => String(l.route).startsWith('/api/public/tournaments'));
      assert.equal(mine.length, 2, all);
      for (const l of mine) {
        assert.equal(l.route, '/api/public/tournaments/:token/photos/:file');
        assert.equal(l.userId, null);
        assert.equal(l.ip, null);
      }
      assert.ok(!all.includes(t.token) && !all.includes(file) && !all.includes(UNKNOWN_FILE), 'token/arquivo no log');
    });
  });

  // =================================================================================================================
  describe('apagar junto: atleta, categoria, evento', () => {
    it('apagar atleta / categoria / EVENTO apaga os arquivos (depois do commit); só os do que foi apagado', async () => {
      freshDir();
      const t = await newTournament();
      const c1 = await mkCategory(t.base, { name: 'C1' });
      const c2 = await mkCategory(t.base, { name: 'C2' });
      const [a1, a2] = [await addGuest(t.base, c1.id), await addGuest(t.base, c1.id)];
      const [b1, b2] = [await addGuest(t.base, c2.id), await addGuest(t.base, c2.id)];
      for (const [c, id] of [[c1.id, a1], [c1.id, a2], [c2.id, b1], [c2.id, b2]] as const) await upload('mestre', t.base, c, id, await noisyJpeg(80, 80)).expect(200);
      const f = Object.fromEntries(await Promise.all([a1, a2, b1, b2].map(async (id) => [id, (await rowOf(id)).photoFile!])));
      assert.equal(filesInDir().length, 4);
      // atleta (so em SETUP)
      await as('mestre').del(`${t.base}/competitors/${a1}`).expect(200);
      assert.deepEqual(filesInDir(), [f[a2], f[b1], f[b2]].sort());
      // categoria
      await as('mestre').del(`${t.base}/categories/${c1.id}`).expect(200);
      assert.deepEqual(filesInDir(), [f[b1], f[b2]].sort());
      // evento inteiro (cascata): localiza antes, apaga depois
      await as('mestre').del(`/events/${t.eventId}`).expect(200);
      assert.deepEqual(filesInDir(), []);
      assert.equal(await prisma.tournamentCompetitor.count({ where: { id: { in: [a1, a2, b1, b2] } } }), 0);
      eventIds.splice(eventIds.indexOf(t.eventId), 1);
    });

    it('evento de OUTRO grupo / evento sem torneio: apagar não toca nos arquivos alheios', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base);
      const id = await addGuest(t.base, cat.id);
      await upload('mestre', t.base, cat.id, id, await jpegOf('#999')).expect(200);
      const plain = await mkEvent(orgA, { type: 'CAMPEONATO' });
      await as('mestre').del(`/events/${plain.id}`).expect(200);
      eventIds.splice(eventIds.indexOf(plain.id), 1);
      const evB = await mkEvent(orgB);
      await as('mestreB').del(`/events/${evB.id}`).expect(200);
      eventIds.splice(eventIds.indexOf(evB.id), 1);
      assert.equal(filesInDir().length, 1);
      assert.ok((await rowOf(id)).photoFile);
    });
  });

  // =================================================================================================================
  describe('anonymizeCompetitors (LGPD)', () => {
    it('apaga a foto própria, vira "Atleta removido", zera autorização, sobe a revision, avisa o hub e o telão para de servir', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base);
      const student = await prisma.student.create({ data: { organizationId: orgA, name: 'Aluno Anonimizar', status: 'ACTIVE', photo: '/api/uploads/aaaaaaaa-aaaa-4aaa-8aaa-000000000010.webp', birthDate: new Date('1990-01-01T00:00:00Z') } });
      const participant = await prisma.eventParticipant.create({ data: { organizationId: orgA, eventId: t.eventId, guestName: 'Participante Anonimizar', status: 'CONFIRMED' } });
      const studentComp = (await as('mestre').post(`${t.base}/categories/${cat.id}/competitors`, { studentId: student.id }).expect(201)).body.competitors.at(-1).id;
      const partComp = (await as('mestre').post(`${t.base}/categories/${cat.id}/competitors`, { eventParticipantId: participant.id }).expect(201)).body.competitors.at(-1).id;
      const bystander = await addGuest(t.base, cat.id, { displayName: 'Quem Fica', ageGroup: 'ADULT' });
      await as('mestre').patch(`${t.base}/competitors/${partComp}`, { ageGroup: 'ADULT', photoAuthorized: true, groupName: 'Academia Sigilo', graduationLabel: 'Preta' }).expect(200);
      await upload('mestre', t.base, cat.id, partComp, await jpegOf('#b4b')).expect(200);
      await upload('mestre', t.base, cat.id, bystander, await jpegOf('#4b4')).expect(200);
      const fPart = (await rowOf(partComp)).photoFile!;
      const fBy = (await rowOf(bystander)).photoFile!;
      await enablePublic(t.base);
      await pubPhoto(t.token, fPart).expect(200);
      const rev0 = await revisionOf(t.tournamentId);
      const notified: number[] = [];
      const original = hub.notifyChanged.bind(hub);
      hub.notifyChanged = (tid: number) => { notified.push(tid); original(tid); };
      let result;
      try {
        // sem nada para anonimizar: nao mexe em nada
        assert.deepEqual(await tournaments.anonymizeCompetitors({}), { competitors: 0, photosDeleted: 0, tournaments: 0 });
        assert.deepEqual(await tournaments.anonymizeCompetitors({ studentIds: [999999999], eventParticipantIds: [999999999] }), { competitors: 0, photosDeleted: 0, tournaments: 0 });
        assert.equal(await revisionOf(t.tournamentId), rev0);
        result = await tournaments.anonymizeCompetitors({ studentIds: [student.id], eventParticipantIds: [participant.id] });
      } finally {
        hub.notifyChanged = original;
      }
      assert.deepEqual(result, { competitors: 2, photosDeleted: 1, tournaments: 1 });
      assert.deepEqual(notified, [t.tournamentId]);
      assert.equal(await revisionOf(t.tournamentId), rev0 + 1);
      const rows = await Promise.all([studentComp, partComp, bystander].map(rowOf));
      assert.deepEqual(rows.map((r) => r.displayName), ['Atleta removido', 'Atleta removido', rows[2].displayName]);
      assert.equal(rows[2].displayName, 'Quem Fica');
      assert.deepEqual([rows[1].photoFile, rows[1].photoBytes, rows[1].photoUpdatedAt, rows[1].photoAuthorized, rows[1].photoAuthorizedAt, rows[1].groupName, rows[1].graduationLabel], [null, null, null, false, null, null, null]);
      assert.deepEqual(filesInDir(), [fBy], 'so o arquivo do anonimizado saiu');
      await pubPhoto(t.token, fPart).expect(404);
      const snap = (await pub(t.token).expect(200)).body;
      const names = snap.categories[0].competitors.map((c: any) => c.name).sort();
      assert.deepEqual(names, ['Atleta removido', 'Atleta removido', 'Quem Fica']);
      assert.ok(!JSON.stringify(snap).includes('Aluno Anonimizar') && !JSON.stringify(snap).includes('Participante Anonimizar') && !JSON.stringify(snap).includes(fPart));
      // idempotente: de novo nao muda mais nada (nome ja anonimizado; sem arquivo)
      const again = await tournaments.anonymizeCompetitors({ eventParticipantIds: [participant.id] });
      assert.equal(again.photosDeleted, 0);
      assert.equal(await rowOf(bystander).then((r) => r.photoFile), fBy);
    });
  });

  // =================================================================================================================
  describe('inscrição removida do evento e reconciliação da anonimização', () => {
    it('cancelar a inscrição: categoria em SETUP remove o atleta (e a foto); categoria já sorteada anonimiza e preserva a chave; aluno mantém o vínculo', async () => {
      freshDir();
      const t = await newTournament();
      const setup = await mkCategory(t.base, { name: 'Setup' });
      const drawn = await mkCategory(t.base, { name: 'Sorteada' });
      const mkPart = (guestName: string) => prisma.eventParticipant.create({ data: { organizationId: orgA, eventId: t.eventId, guestName, status: 'CONFIRMED' } });
      const [pSetup, pDrawn, pOther] = [await mkPart('Sai Da Chave Setup'), await mkPart('Anonimizada Na Chave'), await mkPart('Outro Participante')];
      const addP = async (cid: number, p: { id: number }) => (await as('mestre').post(`${t.base}/categories/${cid}/competitors`, { eventParticipantId: p.id }).expect(201)).body.createdCompetitorId as number;
      const cSetup = await addP(setup.id, pSetup);
      const cDrawn = await addP(drawn.id, pDrawn);
      const cOther = await addP(drawn.id, pOther);
      await upload('mestre', t.base, setup.id, cSetup, await jpegOf('#a11')).expect(200);
      await upload('mestre', t.base, drawn.id, cDrawn, await jpegOf('#1a1')).expect(200);
      await upload('mestre', t.base, drawn.id, cOther, await jpegOf('#11a')).expect(200);
      await as('mestre').post(`${t.base}/categories/${drawn.id}/generate`, { seeding: 'RANDOM' }).expect(200);
      const fOther = (await rowOf(cOther)).photoFile;
      const rev0 = await revisionOf(t.tournamentId);
      await as('mestre').del(`/events/${t.eventId}/participants/${pSetup.id}`).expect(200);
      assert.equal(await prisma.tournamentCompetitor.count({ where: { id: cSetup } }), 0, 'SETUP: atleta removido');
      assert.equal(filesInDir().length, 2, 'foto do removido apagada');
      await as('mestre').del(`/events/${t.eventId}/participants/${pDrawn.id}`).expect(200);
      const kept = await rowOf(cDrawn);
      assert.deepEqual([kept.displayName, kept.photoFile, kept.groupName, kept.graduationLabel, kept.photoAuthorized, kept.eventParticipantId], ['Atleta removido', null, null, null, false, null]);
      const view = await getCat(t.base, drawn.id);
      assert.equal(view.competitors.length, 2, 'a chave sorteada preserva o atleta anonimizado');
      assert.ok(view.matches.length > 0);
      assert.deepEqual(filesInDir(), [fOther], 'so o arquivo do atleta que fica');
      assert.equal(await revisionOf(t.tournamentId), rev0 + 2);
      assert.equal((await rowOf(cOther)).displayName.includes('Outro'), true);
      // participante sem atleta: segue normal
      const lone = await mkPart('Sem Atleta');
      await as('mestre').del(`/events/${t.eventId}/participants/${lone.id}`).expect(200);
    });

    it('reconciliação: completa anonimizações devidas (aluno, convidado "Participante anonimizado", usuário, inscrição anonimizada) e é idempotente; TOURNAMENT_ANON_RECONCILE=false desliga', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base);
      const student = await prisma.student.create({ data: { organizationId: orgA, name: 'Aluno Reconciliar', status: 'ACTIVE' } });
      const mkPart = (data: Record<string, unknown>) => prisma.eventParticipant.create({ data: { organizationId: orgA, eventId: t.eventId, status: 'CONFIRMED', ...data } as any });
      const user = await prisma.user.create({ data: { email: `anonimizado-${stamp}@anonimizado.invalid`, passwordHash: 'x', name: 'Pessoa removida', userType: 'MEMBER', status: 'INACTIVE' } });
      userIds.push(user.id);
      const pGuest = await mkPart({ guestName: 'Participante anonimizado' });
      const pUser = await mkPart({ userId: user.id });
      const pSubmission = await mkPart({ guestName: 'Nome Ainda Visivel' });
      const pOk = await mkPart({ guestName: 'Participante Normal' });
      const form = await prisma.registrationForm.create({ data: { organizationId: orgA, slug: `tphoto-${stamp}`, title: 'Form', status: 'OPEN' } });
      const post = async (body: object) => (await as('mestre').post(`${t.base}/categories/${cat.id}/competitors`, body).expect(201)).body.createdCompetitorId as number;
      const cStudent = await post({ studentId: student.id });
      const cGuest = await post({ eventParticipantId: pGuest.id });
      const cUser = await post({ eventParticipantId: pUser.id });
      const cSub = await post({ eventParticipantId: pSubmission.id });
      await prisma.student.update({ where: { id: student.id }, data: { anonymizedAt: new Date() } }); // a anonimizacao do aluno aconteceu DEPOIS de entrar na chave
      const cOk = await post({ eventParticipantId: pOk.id });
      for (const id of [cGuest, cUser, cSub, cOk]) await upload('mestre', t.base, cat.id, id, await jpegOf('#c4c')).expect(200);
      {
        await prisma.registrationSubmission
          .create({ data: { organizationId: orgA, formId: form.id, eventParticipantId: pSubmission.id, anonymizedAt: new Date(), consentAt: new Date(), consentVersion: 1, protocol: `TPH-${stamp}`, answers: {}, name: 'Participante anonimizado' } as any });
      }
      const hasSubmission = !!(await prisma.registrationSubmission.findFirst({ where: { eventParticipantId: pSubmission.id, anonymizedAt: { not: null } } }));
      const cron = new TournamentPhotosCronService(app.get(PrismaService), app.get(ModuleRef));
      const prev = process.env.TOURNAMENT_ANON_RECONCILE;
      try {
        process.env.TOURNAMENT_ANON_RECONCILE = 'false';
        assert.equal(await cron.runReconcile(), null);
        process.env.TOURNAMENT_ANON_RECONCILE = 'true';
        const rev0 = await revisionOf(t.tournamentId);
        const r = await cron.runReconcile();
        const expected = [cStudent, cGuest, cUser, ...(hasSubmission ? [cSub] : [])];
        assert.equal(r!.competitors, expected.length);
        for (const id of expected) {
          const row = await rowOf(id);
          assert.deepEqual([row.displayName, row.photoFile, row.groupName], ['Atleta removido', null, null], `atleta ${id}`);
        }
        assert.notEqual((await rowOf(cOk)).displayName, 'Atleta removido', 'quem nao foi anonimizado nao e tocado');
        assert.ok((await rowOf(cOk)).photoFile);
        assert.equal(await revisionOf(t.tournamentId), rev0 + 1);
        const again = await cron.runReconcile();
        assert.equal(again!.competitors, 0, 'idempotente');
        assert.equal(await revisionOf(t.tournamentId), rev0 + 1);
      } finally {
        if (prev === undefined) delete process.env.TOURNAMENT_ANON_RECONCILE;
        else process.env.TOURNAMENT_ANON_RECONCILE = prev;
      }
      assert.equal(hasSubmission, true, 'o ramo da inscricao anonimizada foi exercitado');
      await prisma.registrationSubmission.deleteMany({ where: { eventParticipantId: pSubmission.id } });
      await prisma.registrationForm.delete({ where: { id: form.id } });
    });

    it('rota pública da foto: token inexistente entra no cache negativo (404 idêntico, sem nova consulta); token rotacionado continua 404', async () => {
      freshDir();
      const svc = app.get(TournamentPublicService);
      const bogus = 'Q'.repeat(32);
      const first = await pubPhoto(bogus, UNKNOWN_FILE).expect(404);
      const sizeAfterFirst = svc.negativeSize();
      assert.ok(sizeAfterFirst >= 1, 'token inexistente memoizado');
      const second = await pubPhoto(bogus, UNKNOWN_FILE).expect(404);
      assert.deepEqual(second.body, first.body);
      assert.equal(svc.negativeSize(), sizeAfterFirst);
      // token valido com arquivo errado NAO vai para o cache negativo
      const t = await newTournament();
      await enablePublic(t.base);
      const before = svc.negativeSize();
      await pubPhoto(t.token, UNKNOWN_FILE).expect(404);
      assert.equal(svc.negativeSize(), before, 'token valido nao e memoizado como inexistente');
      const cat = await mkCategory(t.base);
      const id = await addGuest(t.base, cat.id, { ageGroup: 'ADULT' });
      await upload('mestre', t.base, cat.id, id, await jpegOf('#5a5')).expect(200);
      const file = (await rowOf(id)).photoFile!;
      await pubPhoto(t.token, file).expect(200);
      await as('mestre').post(`${t.base}/rotate-token`).expect(200);
      await pubPhoto(t.token, file).expect(404);
    });
  });

  // =================================================================================================================
  describe('GC semanal e expiração (dry-run e real)', () => {
    const makeCron = () => new TournamentPhotosCronService(app.get(PrismaService), app.get(ModuleRef));
    const writeFile = (name: string, ageDays: number) => {
      const full = path.join(photosDir, name);
      fs.writeFileSync(full, 'x');
      const when = new Date(Date.now() - ageDays * DAY);
      fs.utimesSync(full, when, when);
    };

    it('GC: só apaga arquivo SEM atleta e com mais de 24 h; dry-run só conta; false desliga; nome fora do padrão nunca é tocado', async () => {
      freshDir();
      const t = await newTournament('mestreC', orgC);
      const cat = await mkCategory(t.base, {}, 'mestreC');
      const id = await addGuest(t.base, cat.id, {}, 'mestreC');
      await upload('mestreC', t.base, cat.id, id, await jpegOf('#808')).expect(200);
      const referenced = (await rowOf(id)).photoFile!;
      const old = fs.statSync(path.join(photosDir, referenced));
      const past = new Date(Date.now() - 10 * DAY);
      fs.utimesSync(path.join(photosDir, referenced), past, past); // referenciado e antigo: fica
      void old;
      const orphanOld = 'aaaaaaaa-0000-4000-8000-000000000001.webp';
      const orphanFresh = 'aaaaaaaa-0000-4000-8000-000000000002.webp';
      writeFile(orphanOld, 3);
      writeFile(orphanFresh, 0);
      fs.writeFileSync(path.join(photosDir, 'LEIAME.txt'), 'nao e nosso');
      const cron = makeCron();
      const prev = process.env.TOURNAMENT_PHOTOS_GC;
      try {
        process.env.TOURNAMENT_PHOTOS_GC = 'false';
        assert.equal(await cron.runGc(), null);
        process.env.TOURNAMENT_PHOTOS_GC = 'dry-run';
        const dry = await cron.runGc();
        assert.deepEqual([dry!.dryRun, dry!.orphanFiles, dry!.orphanFilesDeleted], [true, 1, 0]);
        assert.deepEqual(filesInDir(), [referenced, orphanOld, orphanFresh, 'LEIAME.txt'].sort(), 'dry-run nao apaga nada');
        delete process.env.TOURNAMENT_PHOTOS_GC; // padrao = dry-run
        assert.equal((await cron.runGc())!.dryRun, true);
        assert.equal(filesInDir().length, 4);
        process.env.TOURNAMENT_PHOTOS_GC = 'true';
        const real = await cron.runGc();
        assert.deepEqual([real!.dryRun, real!.orphanFiles, real!.orphanFilesDeleted], [false, 1, 1]);
        assert.deepEqual(filesInDir(), [referenced, orphanFresh, 'LEIAME.txt'].sort());
        // 48 h depois da execucao, o arquivo "novo" tambem e orfao
        const later = await cron.runGc({ now: new Date(Date.now() + 2 * DAY) });
        assert.equal(later!.orphanFilesDeleted, 1);
        assert.deepEqual(filesInDir(), [referenced, 'LEIAME.txt'].sort(), 'o referenciado e o que nao e nosso ficam sempre');
      } finally {
        if (prev === undefined) delete process.env.TOURNAMENT_PHOTOS_GC;
        else process.env.TOURNAMENT_PHOTOS_GC = prev;
      }
    });

    it('expiração: fotos de torneios com evento há mais de 30 dias saem (arquivo + colunas, revision sobe); recentes ficam; dry-run só conta', async () => {
      freshDir();
      const oldT = await newTournament('mestreC', orgC, { date: new Date(Date.now() - 45 * DAY) });
      const newT = await newTournament('mestreC', orgC, { date: new Date(Date.now() - 5 * DAY) });
      const oldCat = await mkCategory(oldT.base, {}, 'mestreC');
      const newCat = await mkCategory(newT.base, {}, 'mestreC');
      const [o1, o2] = [await addGuest(oldT.base, oldCat.id, {}, 'mestreC'), await addGuest(oldT.base, oldCat.id, {}, 'mestreC')];
      const n1 = await addGuest(newT.base, newCat.id, {}, 'mestreC');
      for (const [b, c, id] of [[oldT.base, oldCat.id, o1], [oldT.base, oldCat.id, o2], [newT.base, newCat.id, n1]] as const) await upload('mestreC', b, c, id, await noisyJpeg(60, 60)).expect(200);
      const files = Object.fromEntries(await Promise.all([o1, o2, n1].map(async (id) => [id, (await rowOf(id)).photoFile!])));
      const revOld = await revisionOf(oldT.tournamentId);
      const revNew = await revisionOf(newT.tournamentId);
      const cron = makeCron();
      const prev = process.env.TOURNAMENT_PHOTOS_PURGE;
      try {
        process.env.TOURNAMENT_PHOTOS_PURGE = 'false';
        assert.equal(await cron.runPurge({ organizationId: orgC }), null);
        delete process.env.TOURNAMENT_PHOTOS_PURGE; // padrao dry-run
        const dry = await cron.runPurge({ organizationId: orgC });
        assert.deepEqual(dry, { dryRun: true, tournaments: 1, competitors: 2, filesDeleted: 0 });
        assert.equal(filesInDir().length, 3);
        assert.ok((await rowOf(o1)).photoFile);
        assert.equal(await revisionOf(oldT.tournamentId), revOld);
        process.env.TOURNAMENT_PHOTOS_PURGE = 'true';
        const real = await cron.runPurge({ organizationId: orgC });
        assert.deepEqual(real, { dryRun: false, tournaments: 1, competitors: 2, filesDeleted: 2 });
      } finally {
        if (prev === undefined) delete process.env.TOURNAMENT_PHOTOS_PURGE;
        else process.env.TOURNAMENT_PHOTOS_PURGE = prev;
      }
      for (const id of [o1, o2]) {
        const r = await rowOf(id);
        assert.deepEqual([r.photoFile, r.photoBytes, r.photoUpdatedAt], [null, null, null]);
      }
      assert.deepEqual(filesInDir(), [files[n1]]);
      assert.equal((await rowOf(n1)).photoFile, files[n1]);
      assert.equal(await revisionOf(oldT.tournamentId), revOld + 1);
      assert.equal(await revisionOf(newT.tournamentId), revNew);
      const op = await getCat(oldT.base, oldCat.id, 'mestreC');
      assert.ok(op.competitors.every((c: any) => c.hasOwnPhoto === false && c.photoVersion === null));
    });
  });

  // =================================================================================================================
  describe('importação from-participants com a foto da inscrição (provedor FALSO)', () => {
    type Spec = { photo: Buffer | null; birthDate: Date | null } | 'throw';
    const withProvider = async <T>(plan: Map<number, Spec>, fn: (calls: any[]) => Promise<T>): Promise<T> => {
      const calls: any[] = [];
      const fake: TournamentPhotoSource = {
        async readForParticipant(input) {
          calls.push(input);
          const spec = plan.get(input.eventParticipantId);
          if (spec === 'throw') throw new Error('falha simulada do provedor');
          return spec ?? null;
        },
      };
      const svc = tournaments as unknown as { photoSource?: TournamentPhotoSource };
      const prev = svc.photoSource;
      svc.photoSource = fake;
      try {
        return await fn(calls);
      } finally {
        svc.photoSource = prev;
      }
    };

    it('com foto e nascimento (ageGroup derivado, photoAuthorized=false), sem foto, provedor que falha, foto inválida, aluno (provedor não é chamado), cancelado; photosImported na resposta', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base, { name: 'Importadas' });
      const mk = (guestName: string, over: Record<string, unknown> = {}) =>
        prisma.eventParticipant.create({ data: { organizationId: orgA, eventId: t.eventId, guestName, status: 'CONFIRMED', ...over } });
      const student = await prisma.student.create({ data: { organizationId: orgA, name: 'Aluno Participante', status: 'ACTIVE', birthDate: new Date('1990-01-01T00:00:00Z') } });
      const [pAdult, pMinor, pNoPhoto, pThrows, pBad, pStudent, pCancelled] = [
        await mk('Adulta Com Foto'), await mk('Menor Com Foto'), await mk('Sem Foto Mas Nasceu'), await mk('Provedor Falha'), await mk('Foto Invalida'),
        await mk('x', { guestName: null, studentId: student.id }), await mk('Cancelada', { status: 'CANCELLED' }),
      ];
      const plan = new Map<number, Spec>([
        [pAdult.id, { photo: await jpegOf('#e91', 900, 600), birthDate: new Date('1985-06-01T00:00:00Z') }],
        [pMinor.id, { photo: await jpegOf('#19e', 700, 700), birthDate: new Date(Date.now() - 10 * 365 * DAY) }],
        [pNoPhoto.id, { photo: null, birthDate: new Date('1980-01-01T00:00:00Z') }],
        [pThrows.id, 'throw'],
        [pBad.id, { photo: Buffer.from('GIF89a---------------------------'), birthDate: null }],
        [pStudent.id, { photo: await jpegOf('#000'), birthDate: new Date('2015-01-01T00:00:00Z') }],
        [pCancelled.id, { photo: await jpegOf('#111'), birthDate: null }],
      ]);
      const ids = [pAdult, pMinor, pNoPhoto, pThrows, pBad, pStudent, pCancelled].map((p) => p.id);
      const body = await withProvider(plan, async (calls) => {
        const res = (await as('mestre').post(`${t.base}/categories/${cat.id}/competitors/from-participants`, { eventParticipantIds: ids }).expect(200)).body;
        assert.deepEqual(calls.map((c) => c.eventParticipantId).sort((a: number, b: number) => a - b), [pAdult.id, pMinor.id, pNoPhoto.id, pThrows.id, pBad.id].sort((a, b) => a - b), 'so quem NAO e aluno e esta elegivel');
        for (const c of calls) assert.deepEqual([c.organizationId, c.eventId], [orgA, t.eventId]);
        return res;
      });
      assert.deepEqual([body.added, body.skipped, body.photosImported], [6, 1, 2]);
      capture('operator-import-participants-with-photos', body);
      assert.deepEqual(Object.keys(body).sort(), ['added', 'addedCompetitorIds', 'category', 'photosImported', 'skipped']);
      const createdRows = await prisma.tournamentCompetitor.findMany({ where: { categoryId: cat.id }, select: { id: true } });
      assert.deepEqual(body.addedCompetitorIds, createdRows.map((r) => r.id).sort((a, b) => a - b), 'ids dos criados, em ordem');
      assert.equal(body.addedCompetitorIds.length, body.added);
      for (const id of body.addedCompetitorIds) assert.ok(body.category.competitors.some((c: any) => c.id === id));
      const view = (id: number) => body.category.competitors.find((c: any) => c.eventParticipantId === id);
      assert.deepEqual([view(pAdult.id).ageGroup, view(pAdult.id).hasOwnPhoto, view(pAdult.id).photoAuthorized, view(pAdult.id).photoPublic], ['ADULT', true, false, true]);
      assert.deepEqual([view(pMinor.id).ageGroup, view(pMinor.id).hasOwnPhoto, view(pMinor.id).photoAuthorized, view(pMinor.id).photoPublic], ['MINOR', true, false, false]);
      assert.deepEqual([view(pNoPhoto.id).ageGroup, view(pNoPhoto.id).hasOwnPhoto], ['ADULT', false]);
      assert.deepEqual([view(pThrows.id).ageGroup, view(pThrows.id).hasOwnPhoto], ['UNKNOWN', false], 'falha do provedor nao derruba o atleta');
      assert.deepEqual([view(pBad.id).ageGroup, view(pBad.id).hasOwnPhoto], ['UNKNOWN', false], 'foto invalida: atleta entra sem foto');
      assert.equal(view(pStudent.id).hasOwnPhoto, false);
      assert.equal(body.category.competitors.length, 6);
      const rows = await prisma.tournamentCompetitor.findMany({ where: { categoryId: cat.id } });
      assert.deepEqual(filesInDir(), rows.map((r) => r.photoFile).filter(Boolean).sort() as string[], 'arquivos = fotos ligadas (nenhum orfao)');
      for (const r of rows) assert.equal(r.photoAuthorized, false);
      // a foto importada e a PROPRIA, ja sanitizada (WebP <= 800)
      const stored = fs.readFileSync(path.join(photosDir, rows.find((r) => r.eventParticipantId === pAdult.id)!.photoFile!));
      const meta = await sharp(stored).metadata();
      assert.deepEqual([meta.format, Math.max(meta.width!, meta.height!)], ['webp', 800]);
      // importar de novo: ja existem (skipped), o provedor nem e chamado e nada novo no disco
      await withProvider(plan, async (calls) => {
        const again = (await as('mestre').post(`${t.base}/categories/${cat.id}/competitors/from-participants`, { eventParticipantIds: ids }).expect(200)).body;
        assert.deepEqual([again.added, again.photosImported, again.addedCompetitorIds], [0, 0, []]);
        assert.deepEqual(calls, []);
      });
      assert.equal(filesInDir().length, 2);
    });

    it('sem inscrição com foto (ou sem provedor) a importação segue sem foto e photosImported = 0; cota cheia = atleta entra sem foto e o arquivo é apagado', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base);
      const p = await prisma.eventParticipant.create({ data: { organizationId: orgA, eventId: t.eventId, guestName: 'Sem Provedor', status: 'CONFIRMED' } });
      const res = (await as('mestre').post(`${t.base}/categories/${cat.id}/competitors/from-participants`, { eventParticipantIds: [p.id] }).expect(200)).body;
      assert.deepEqual([res.added, res.skipped, res.photosImported], [1, 0, 0]);
      assert.deepEqual(filesInDir(), []);
      // cota: a foto nao cabe
      const cat2 = await mkCategory(t.base, { name: 'Cota' });
      const p2 = await prisma.eventParticipant.create({ data: { organizationId: orgA, eventId: t.eventId, guestName: 'Cota Cheia', status: 'CONFIRMED' } });
      process.env.TOURNAMENT_PHOTOS_QUOTA_MB = String(500 / MB);
      const plan = new Map<number, Spec>([[p2.id, { photo: await noisyJpeg(), birthDate: null }]]);
      const r2 = await withProvider(plan, async () => (await as('mestre').post(`${t.base}/categories/${cat2.id}/competitors/from-participants`, { eventParticipantIds: [p2.id] }).expect(200)).body);
      assert.deepEqual([r2.added, r2.photosImported], [1, 0]);
      assert.deepEqual(filesInDir(), [], 'arquivo que nao coube foi apagado');
    });
  });

  // =================================================================================================================
  describe('createdCompetitorId na resposta do POST de atleta', () => {
    it('as 3 formas devolvem o id do atleta recém-criado (campo de topo, ao lado da categoria completa); POST simultâneos: cada resposta traz o id do SEU atleta', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base, { name: 'Ids' });
      const post = (body: object) => as('mestre').post(`${t.base}/categories/${cat.id}/competitors`, body).expect(201);
      const student = await prisma.student.create({ data: { organizationId: orgA, name: 'Aluno Com Id', status: 'ACTIVE' } });
      const participant = await prisma.eventParticipant.create({ data: { organizationId: orgA, eventId: t.eventId, guestName: 'Participante Com Id', status: 'CONFIRMED' } });
      const g = (await post({ guest: { displayName: 'Convidado Com Id', ageGroup: 'ADULT' } })).body;
      capture('operator-add-competitor-response', g);
      const s = (await post({ studentId: student.id })).body;
      const p = (await post({ eventParticipantId: participant.id })).body;
      const nameOf = (body: any, id: number) => body.competitors.find((c: any) => c.id === id)?.displayName;
      assert.equal(nameOf(g, g.createdCompetitorId), 'Convidado Com Id');
      assert.equal(nameOf(s, s.createdCompetitorId), 'Aluno Com Id');
      assert.equal(nameOf(p, p.createdCompetitorId), 'Participante Com Id');
      assert.equal(typeof g.createdCompetitorId, 'number');
      // so o campo novo foi acrescentado: o resto e a categoria completa de sempre
      const { createdCompetitorId, ...rest } = g;
      void createdCompetitorId;
      assert.deepEqual(Object.keys(rest), Object.keys(await getCat(t.base, cat.id)));

      // simultaneos: cada resposta tem o id do seu atleta
      const names = Array.from({ length: 8 }, (_, i) => `Simultaneo ${i + 1}`);
      const results = await Promise.all(names.map((displayName) => as('mestre').post(`${t.base}/categories/${cat.id}/competitors`, { guest: { displayName, ageGroup: 'ADULT' } })));
      for (const [i, r] of results.entries()) {
        assert.equal(r.status, 201);
        assert.equal(nameOf(r.body, r.body.createdCompetitorId), names[i], `resposta ${i} traz o id do seu atleta`);
      }
      assert.equal(new Set(results.map((r) => r.body.createdCompetitorId)).size, names.length, 'ids distintos');
    });
  });

  // =================================================================================================================
  describe('JSON real com foto própria (capturas para o painel e o app)', () => {
    it('operador e snapshot público com atletas de foto própria visível, menor sem autorização e menor autorizado', async () => {
      freshDir();
      const t = await newTournament();
      const cat = await mkCategory(t.base, { name: 'Com fotos', format: 'SINGLE_ELIMINATION', thirdPlace: true });
      const adult = await addGuest(t.base, cat.id, { displayName: 'Rafaela Adulta', groupName: 'Academia Central', graduationLabel: 'Azul', ageGroup: 'ADULT' });
      const minor = await addGuest(t.base, cat.id, { displayName: 'Pedro Menor Sem Autorizacao', groupName: 'Academia Norte', graduationLabel: 'Verde', ageGroup: 'MINOR' });
      const minorAuth = await addGuest(t.base, cat.id, { displayName: 'Lia Menor Autorizada', groupName: 'Academia Sul', graduationLabel: 'Amarela', ageGroup: 'MINOR', photoAuthorized: true });
      const noPhoto = await addGuest(t.base, cat.id, { displayName: 'Caio Sem Foto', groupName: 'Academia Leste', ageGroup: 'ADULT' });
      for (const [id, color] of [[adult, '#d62'], [minor, '#26d'], [minorAuth, '#2d6']] as const) await upload('mestre', t.base, cat.id, id, await jpegOf(color, 640, 480)).expect(200);
      await as('mestre').post(`${t.base}/categories/${cat.id}/generate`, { seeding: 'RANDOM' }).expect(200);
      const op = await getCat(t.base, cat.id);
      capture('operator-category-with-photo', op);
      await enablePublic(t.base);
      const res = await pub(t.token).expect(200);
      capture('public-snapshot-with-photo', res.body);

      const byName = (n: string) => res.body.categories[0].competitors.find((c: any) => c.name === n);
      const files = Object.fromEntries(await Promise.all([adult, minor, minorAuth].map(async (id) => [id, (await rowOf(id)).photoFile!])));
      assert.equal(byName('Rafaela Adulta').photoUrl, photoPath(t.token, files[adult]));
      assert.equal(byName('Lia Menor Autorizada').photoUrl, photoPath(t.token, files[minorAuth]));
      assert.equal(byName('Pedro Menor Sem Autorizacao').photoUrl, null);
      assert.equal(byName('Caio Sem Foto').photoUrl, null);
      assert.ok(!JSON.stringify(res.body).includes(files[minor]));
      assert.ok(!JSON.stringify(op).includes(files[adult]) && !JSON.stringify(op).includes(files[minor]));
      const o = (id: number) => op.competitors.find((c: any) => c.id === id);
      assert.deepEqual([o(adult).hasOwnPhoto, o(adult).photoPublic, o(minor).hasOwnPhoto, o(minor).photoPublic, o(minorAuth).photoPublic, o(noPhoto).hasOwnPhoto], [true, true, true, false, true, false]);
      // as 3 fotos baixam (adulto, autorizada) e a negada nao
      await pubPhoto(t.token, files[adult]).expect(200);
      await pubPhoto(t.token, files[minorAuth]).expect(200);
      await pubPhoto(t.token, files[minor]).expect(404);
      capture('error-400-photo-url-not-allowed', (await as('mestre').post(`${t.base}/categories/${cat.id}/competitors`, { guest: { displayName: 'Tentou URL', photoUrl: 'https://exemplo.com/a.png' } }).expect(400)).body);
    });
  });
});
