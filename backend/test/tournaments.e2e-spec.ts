import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { PublicTournamentsController } from '../src/interface/http/tournaments/public-tournaments.controller';
import { TournamentLiveHub } from '../src/interface/http/tournaments/tournament-live-hub';
import { TournamentPublicService } from '../src/interface/http/tournaments/tournament-public.service';
import { PUBLIC_SNAPSHOT_KEYS } from '../src/interface/http/tournaments/tournament-snapshot';
import { AuditAction } from '../src/shared/audit/audit-actions';
import { createTestApp } from './utils/test-app';

/**
 * Chaveamento de campeonato ao vivo (docs/CONTRATO_CHAVEAMENTO.md secao 8), HTTP real contra o Postgres de dev:
 * fluxo completo dos 3 formatos do cadastro ao podio, folgas, desfazer com cada regra, DEPENDENT_MATCH_PLAYED, resultados
 * concorrentes, isolamento entre grupos (ids cruzados = 404), papeis, privacidade com SENTINELAS (JSON publico, SSE e logs),
 * token rotacionado, ETag/304, memoizacao, SSE por HTTP REAL (porta efemera), limite de conexoes e 404 uniforme.
 * Com TOURNAMENT_CAPTURE_DIR definido grava o JSON REAL (snapshots, categoria do operador, um 409, um evento SSE) para as
 * fixtures do painel/app.
 */
const TAG = '[e2e-tourn]';
const PASSWORD = 'Dev@12345';
const DAY = 86_400_000;

interface SseEvent {
  event: string;
  id: string | null;
  data: string;
}
interface SseClient {
  status: number;
  headers: http.IncomingHttpHeaders;
  events: SseEvent[];
  comments: string[];
  body: string;
  waitFor(pred: (events: SseEvent[], comments: string[]) => boolean, ms?: number): Promise<void>;
  close(): void;
  closed: Promise<void>;
}

describe('Chaveamento de campeonato (e2e)', () => {
  let app: INestApplication;
  let port = 0;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const envBackup = { ...process.env };
  const orgIds: number[] = [];
  const userIds: number[] = [];
  const eventIds: number[] = [];

  let orgA = 0;
  let orgB = 0;
  const tokens: Record<string, string> = {};
  let hub: TournamentLiveHub;
  let publicService: TournamentPublicService;

  const SENT = {
    cpf: `CPF-SENT-${stamp}-123.456.789-00`,
    email: `sentinela-${stamp}@vazamento.test`,
    phone: `+55 11 98888-${stamp.slice(-4)}`,
    note: `NOTA-INTERNA-SENT-${stamp}`,
    birthMinor: '2015-03-04',
    birthAdult: '1990-05-06',
  };
  const PHOTO = (n: number) => `/api/uploads/aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}.webp`;
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

  const mkUser = async (orgId: number, role: OrgRole, label: string): Promise<string> => {
    const email = `${label}-${stamp}@e2e-tourn.local`;
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

  /** Torneio novo (evento + POST /tournament + categoria), pronto para receber atletas. */
  const newTournament = async (who = 'mestre', orgId = orgA) => {
    const event = await mkEvent(orgId);
    const t = (await as(who).post(`/events/${event.id}/tournament`).expect(201)).body;
    return { eventId: event.id, base: `/events/${event.id}/tournament`, tournament: t as { id: number; publicToken: string } };
  };
  const mkCategory = async (base: string, body: Record<string, unknown>, who = 'mestre') =>
    (await as(who).post(`${base}/categories`, { name: `Cat ${Math.random().toString(36).slice(2, 8)}`, ...body }).expect(201)).body;
  const addGuests = async (base: string, cid: number, n: number, over: (i: number) => Record<string, unknown> = () => ({})) => {
    let cat: any;
    for (let i = 1; i <= n; i++) {
      cat = (await as('mestre').post(`${base}/categories/${cid}/competitors`, { guest: { displayName: `Atleta ${i}`, groupName: `Academia ${i % 3}`, ageGroup: 'ADULT', ...over(i) } }).expect(201)).body;
    }
    return cat;
  };
  const getCat = async (base: string, cid: number, who = 'mestre') => (await as(who).get(`${base}/categories/${cid}`).expect(200)).body;

  /** Joga tudo: sempre o slot A vence (com placar), ate nao haver luta READY/LIVE. */
  const playAll = async (base: string, cid: number, pick: (m: any) => number = (m) => m.slotAId) => {
    for (let i = 0; i < 400; i++) {
      const cat = await getCat(base, cid);
      const next = cat.matches.find((m: any) => m.status === 'READY' || m.status === 'LIVE');
      if (!next) return cat;
      await as('mestre').post(`${base}/matches/${next.id}/result`, { winnerId: pick(next), scoreA: 3, scoreB: 1 }).expect(200);
    }
    throw new Error('playAll nao terminou');
  };

  /** Liga o telao e captura o snapshot PUBLICO real (so grava com TOURNAMENT_CAPTURE_DIR). */
  const capturePublic = async (base: string, publicToken: string, name: string) => {
    await as('mestre').patch(base, { publicEnabled: true }).expect(200);
    const res = await pub(publicToken).expect(200);
    capture(name, res.body);
  };

  const keysDeep = (value: unknown, acc = new Set<string>()): Set<string> => {
    if (Array.isArray(value)) value.forEach((v) => keysDeep(v, acc));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { acc.add(k); keysDeep(v, acc); }
    return acc;
  };

  // ---- Cliente SSE sobre HTTP real ----
  const openSse = (token: string): Promise<SseClient> =>
    new Promise((resolve, reject) => {
      const events: SseEvent[] = [];
      const comments: string[] = [];
      let body = '';
      let buffer = '';
      let resolveClosed: () => void = () => undefined;
      const closed = new Promise<void>((r) => (resolveClosed = r));
      const waiters: Array<() => void> = [];
      const req = http.get({ host: '127.0.0.1', port, path: `/api/public/tournaments/${token}/stream`, headers: { Accept: 'text/event-stream' } }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
          buffer += chunk;
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const ev: SseEvent = { event: 'message', id: null, data: '' };
            let any = false;
            for (const line of block.split('\n')) {
              if (line.startsWith(':')) comments.push(line);
              else if (line.startsWith('event: ')) { ev.event = line.slice(7); any = true; }
              else if (line.startsWith('id: ')) { ev.id = line.slice(4); any = true; }
              else if (line.startsWith('data: ')) { ev.data += line.slice(6); any = true; }
              else if (line.startsWith('retry:')) any = false;
            }
            if (any) events.push(ev);
          }
          waiters.splice(0).forEach((w) => w());
        });
        res.on('close', () => { resolveClosed(); waiters.splice(0).forEach((w) => w()); });
        const client: SseClient = {
          status: res.statusCode ?? 0,
          headers: res.headers,
          events,
          comments,
          get body() { return body; },
          closed,
          close: () => req.destroy(),
          waitFor: (pred, ms = 8000) =>
            new Promise<void>((ok, fail) => {
              const timer = setTimeout(() => fail(new Error(`SSE: timeout esperando condicao. recebido: ${JSON.stringify(events.map((e) => [e.event, e.id]))} ${comments.join('|')}`)), ms);
              const check = () => { if (pred(events, comments)) { clearTimeout(timer); ok(); } else waiters.push(check); };
              check();
            }),
        };
        resolve(client);
      });
      req.on('error', reject);
    });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  before(async () => {
    process.env.TOURNAMENT_SNAPSHOT_TTL_MS = '60000';
    app = await createTestApp();
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;
    hub = app.get(TournamentLiveHub);
    publicService = app.get(TournamentPublicService);

    const mkOrg = async (label: string) => {
      const org = await prisma.organization.create({
        data: { name: `${TAG} Grupo ${label} ${stamp}`, slug: `e2e-tourn-${label}-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
      });
      orgIds.push(org.id);
      return org.id;
    };
    orgA = await mkOrg('a');
    orgB = await mkOrg('b');
    tokens.mestre = await mkUser(orgA, OrgRole.MESTRE, 'mestre-a');
    tokens.professor = await mkUser(orgA, OrgRole.PROFESSOR, 'prof-a');
    tokens.monitor = await mkUser(orgA, OrgRole.MONITOR, 'monitor-a');
    tokens.aluno = await mkUser(orgA, OrgRole.ALUNO, 'aluno-a');
    tokens.mestreB = await mkUser(orgB, OrgRole.MESTRE, 'mestre-b');
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
  });

  // =================================================================================================================
  describe('permissões, evento e validação', () => {
    it('anônimo = 401; ALUNO = 403 (até para ler); MONITOR só lê; PROFESSOR escreve; evento de outro grupo = 404', async () => {
      const event = await mkEvent(orgA);
      const base = `/events/${event.id}/tournament`;
      await request(server()).get(`/api${base}`).expect(401);
      await as('aluno').get(base).expect(403);
      await as('aluno').post(base).expect(403);
      await as('monitor').post(base).expect(403);
      // MONITOR le: sem torneio ainda = 404 TOURNAMENT_NOT_FOUND (nao 403)
      const missing = await as('monitor').get(base).expect(404);
      assert.equal(missing.body.code, 'TOURNAMENT_NOT_FOUND');
      assert.equal(missing.body.statusCode, 404);
      const created = await as('professor').post(base).expect(201);
      assert.equal(created.body.publicEnabled, false);
      assert.ok(created.body.publicToken.length >= 24);
      capture('operator-tournament-created', created.body);
      assert.deepEqual(created.body.categories, []);
      await as('monitor').get(base).expect(200);
      await as('aluno').get(base).expect(403);
      const dup = await as('mestre').post(base).expect(409);
      assert.equal(dup.body.code, 'TOURNAMENT_EXISTS');
      // MONITOR e ALUNO nao escrevem em nenhuma rota
      const cat = await mkCategory(base, { format: 'SINGLE_ELIMINATION' });
      for (const who of ['monitor', 'aluno']) {
        await as(who).post(`${base}/categories`, { name: 'x', format: 'ROUND_ROBIN' }).expect(403);
        await as(who).patch(base, { publicEnabled: true }).expect(403);
        await as(who).post(`${base}/rotate-token`).expect(403);
        await as(who).patch(`${base}/categories/${cat.id}`, { name: 'novo' }).expect(403);
        await as(who).del(`${base}/categories/${cat.id}`).expect(403);
        await as(who).post(`${base}/categories/${cat.id}/competitors`, { guest: { displayName: 'Fulano' } }).expect(403);
        await as(who).post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM' }).expect(403);
        await as(who).post(`${base}/matches/1/result`, { winnerId: 1 }).expect(403);
      }
      await as('aluno').get(`${base}/categories/${cat.id}`).expect(403);
      assert.equal((await as('monitor').get(`${base}/categories/${cat.id}`)).status, 200);
      // evento de outro grupo
      const foreign = await mkEvent(orgB);
      assert.equal((await as('mestre').get(`/events/${foreign.id}/tournament`).expect(404)).body.code, 'EVENT_NOT_FOUND');
      await as('mestre').post(`/events/${foreign.id}/tournament`).expect(404);
    });

    it('evento que não é CAMPEONATO = 400 EVENT_NOT_TOURNAMENT', async () => {
      const event = await mkEvent(orgA, { type: 'BATIZADO' });
      const res = await as('mestre').post(`/events/${event.id}/tournament`).expect(400);
      assert.equal(res.body.code, 'EVENT_NOT_TOURNAMENT');
    });

    it('DTOs: campos extras, nomes, grupos, fotos perigosas e URLs de upload', async () => {
      const { base } = await newTournament();
      const bad = (body: object) => as('mestre').post(`${base}/categories`, body);
      await bad({ name: 'A', format: 'SINGLE_ELIMINATION', extra: 1 }).expect(400);
      await bad({ name: '', format: 'SINGLE_ELIMINATION' }).expect(400);
      await bad({ name: 'x'.repeat(81), format: 'SINGLE_ELIMINATION' }).expect(400);
      await bad({ name: 'A', format: 'DUPLA' }).expect(400);
      await bad({ name: 'A', format: 'GROUPS_KNOCKOUT' }).expect(400); // sem grupos
      await bad({ name: 'A', format: 'GROUPS_KNOCKOUT', groupCount: 1, advancePerGroup: 2 }).expect(400);
      await bad({ name: 'A', format: 'GROUPS_KNOCKOUT', groupCount: 17, advancePerGroup: 2 }).expect(400);
      await bad({ name: 'A', format: 'GROUPS_KNOCKOUT', groupCount: 2, advancePerGroup: 5 }).expect(400);
      const noProduct = await bad({ name: 'A', format: 'GROUPS_KNOCKOUT', groupCount: 2, advancePerGroup: 0 });
      assert.equal(noProduct.status, 400);
      const cat = await mkCategory(base, { name: 'Peso leve', format: 'SINGLE_ELIMINATION' });
      // nome duplicado sem diferenciar maiusculas
      const dup = await bad({ name: 'PESO LEVE', format: 'ROUND_ROBIN' }).expect(409);
      assert.equal(dup.body.code, 'CATEGORY_NAME_TAKEN');
      const add = (guest: object) => as('mestre').post(`${base}/categories/${cat.id}/competitors`, { guest });
      await add({ displayName: 'A' }).expect(400);
      await add({ displayName: 'Fulano', extra: true }).expect(400);
      for (const photoUrl of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://exemplo.com/a.png', '//exemplo.com/a.png', '/api/uploads/../../etc/passwd', '/api/uploads/qualquer.png', '/outro/caminho.png', 'https://u:p@exemplo.com/a.png', 'https://exemplo.com/a b.png']) {
        const r = await add({ displayName: 'Fulano', photoUrl });
        assert.equal(r.status, 400, photoUrl);
      }
      await add({ displayName: 'Fulano', photoUrl: 'https://exemplo.com/foto.png' }).expect(201);
      await add({ displayName: 'Beltrano', photoUrl: PHOTO(7) }).expect(201);
      // exatamente UMA forma
      await as('mestre').post(`${base}/categories/${cat.id}/competitors`, {}).expect(400);
      await as('mestre').post(`${base}/categories/${cat.id}/competitors`, { studentId: 1, guest: { displayName: 'Dois' } }).expect(400);
      // gerar: corpo invalido
      await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'X' }).expect(400);
      await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM', foo: 1 }).expect(400);
      // resultado: placar fora do intervalo / tipo invalido
      await as('mestre').post(`${base}/matches/1/result`, { winnerId: 1, scoreA: 1000 }).expect(400);
      await as('mestre').post(`${base}/matches/1/result`, { winnerId: 1, resultType: 'XX' }).expect(400);
      await as('mestre').patch(`${base}/matches/1`, { mat: 41 }).expect(400);
    });
  });

  // =================================================================================================================
  describe('eliminatória simples (N=5, com 3º lugar e folgas) do cadastro ao pódio', () => {
    it('gera a chave com folgas, propaga vencedor/perdedor, termina FINISHED com pódio de 3', async () => {
      const { base, tournament } = await newTournament();
      const cat = await mkCategory(base, { name: 'Adulto até 70 kg', format: 'SINGLE_ELIMINATION', thirdPlace: true });
      assert.equal(cat.status, 'SETUP');
      assert.deepEqual(cat.matches, []);
      await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM' }).then((r) => {
        assert.equal(r.status, 409);
        assert.equal(r.body.code, 'NOT_ENOUGH_COMPETITORS');
      });
      await addGuests(base, cat.id, 5);
      // semente 1 e 2
      const ready = await getCat(base, cat.id);
      await as('mestre').patch(`${base}/competitors/${ready.competitors[0].id}`, { seed: 1 }).expect(200);
      const seedDup = await as('mestre').patch(`${base}/competitors/${ready.competitors[1].id}`, { seed: 1 }).expect(409);
      assert.equal(seedDup.body.code, 'SEED_TAKEN');
      await as('mestre').patch(`${base}/competitors/${ready.competitors[1].id}`, { seed: 2 }).expect(200);

      const gen = (await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'BY_SEED' }).expect(200)).body;
      assert.equal(gen.status, 'RUNNING');
      assert.equal(gen.matches.length, 8, 'P-1 = 7 lutas da chave + 1 disputa de 3º (3 folgas incluidas)');
      const byes = gen.matches.filter((m: any) => m.isBye);
      assert.equal(byes.length, 3);
      assert.ok(byes.every((m: any) => m.status === 'FINISHED' && m.winnerId !== null && m.round === 1));
      // as 2 melhores sementes tem folga
      const byeWinners = new Set(byes.map((m: any) => m.winnerId));
      assert.ok(byeWinners.has(ready.competitors[0].id) && byeWinners.has(ready.competitors[1].id), 'folgas para as melhores sementes');
      for (const m of gen.matches.filter((x: any) => !x.isBye)) {
        assert.equal(m.status, m.slotAId !== null && m.slotBId !== null ? 'READY' : 'PENDING', m.key);
      }
      // gerar de novo sem regenerate = 409 ALREADY_GENERATED
      assert.equal((await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM' }).expect(409)).body.code, 'ALREADY_GENERATED');
      // atletas nao mudam depois de gerado
      assert.equal((await as('mestre').post(`${base}/categories/${cat.id}/competitors`, { guest: { displayName: 'Tardio' } }).expect(409)).body.code, 'NOT_IN_SETUP');
      assert.equal((await as('mestre').patch(`${base}/competitors/${ready.competitors[2].id}`, { seed: 3 }).expect(409)).body.code, 'NOT_IN_SETUP');
      assert.equal((await as('mestre').del(`${base}/competitors/${ready.competitors[2].id}`).expect(409)).body.code, 'NOT_IN_SETUP');
      capture('operator-category-single-running', gen);
      await capturePublic(base, tournament.publicToken, 'public-snapshot-single-running');

      // joga ate o fim; confere avanco passo a passo
      const final = await playAll(base, cat.id);
      assert.equal(final.status, 'FINISHED');
      assert.ok(final.matches.every((m: any) => m.status === 'FINISHED'));
      assert.equal(final.matches.filter((m: any) => !m.isBye).length, 5, 'N-1 + 3º lugar = 5 lutas reais');
      assert.deepEqual(final.podium.map((p: any) => p.place), [1, 2, 3]);
      const finalMatch = final.matches.find((m: any) => m.stage === 'MAIN' && m.nextMatchId === null);
      assert.equal(final.podium[0].competitorId, finalMatch.winnerId);
      const third = final.matches.find((m: any) => m.stage === 'THIRD_PLACE');
      assert.equal(final.podium[2].competitorId, third.winnerId);
      // perdedores das semis foram para o 3º lugar
      const semis = final.matches.filter((m: any) => m.stage === 'MAIN' && m.round === 2);
      const losers = semis.map((s: any) => (s.winnerId === s.slotAId ? s.slotBId : s.slotAId)).sort();
      assert.deepEqual([third.slotAId, third.slotBId].sort(), losers);
      capture('operator-category-single-finished', final);
      await capturePublic(base, tournament.publicToken, 'public-snapshot-single-finished');

      // categoria FINISHED: nao exclui; generate = HAS_RESULTS
      assert.equal((await as('mestre').del(`${base}/categories/${cat.id}`).expect(409)).body.code, 'HAS_RESULTS');
      assert.equal((await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM', regenerate: true }).expect(409)).body.code, 'HAS_RESULTS');
      const summary = (await as('mestre').get(base).expect(200)).body;
      assert.equal(summary.id, tournament.id);
      assert.equal(summary.categories[0].status, 'FINISHED');
      assert.equal(summary.categories[0].matchesCount, 5);
      assert.equal(summary.categories[0].finishedMatchesCount, 5);
    });

    it('N=2 (só a final) e N=3 funcionam; 129 atletas = CATEGORY_FULL', async () => {
      const { base } = await newTournament();
      const two = await mkCategory(base, { format: 'SINGLE_ELIMINATION' });
      await addGuests(base, two.id, 2);
      const g2 = (await as('mestre').post(`${base}/categories/${two.id}/generate`, { seeding: 'RANDOM' }).expect(200)).body;
      assert.equal(g2.matches.length, 1);
      const done = await playAll(base, two.id);
      assert.equal(done.status, 'FINISHED');
      assert.equal(done.podium.length >= 2, true);
      const three = await mkCategory(base, { format: 'SINGLE_ELIMINATION' });
      await addGuests(base, three.id, 3);
      const g3 = (await as('mestre').post(`${base}/categories/${three.id}/generate`, { seeding: 'RANDOM' }).expect(200)).body;
      assert.equal(g3.matches.filter((m: any) => !m.isBye).length, 2);
      assert.equal((await playAll(base, three.id)).status, 'FINISHED');
      const big = await mkCategory(base, { format: 'ROUND_ROBIN' });
      await prisma.tournamentCompetitor.createMany({
        data: Array.from({ length: 128 }, (_, i) => ({ organizationId: orgA, categoryId: big.id, displayName: `Massa ${i + 10}` })),
      });
      const full = await as('mestre').post(`${base}/categories/${big.id}/competitors`, { guest: { displayName: 'Um a mais' } }).expect(409);
      assert.equal(full.body.code, 'CATEGORY_FULL');
    });
  });

  // =================================================================================================================
  describe('todos contra todos (N=4)', () => {
    it('6 lutas, empate só nos grupos, classificação ao vivo e pódio depois da última', async () => {
      const { base, tournament } = await newTournament();
      const cat = await mkCategory(base, { name: 'Round robin', format: 'ROUND_ROBIN', thirdPlace: true });
      assert.equal(cat.thirdPlace, false, 'todos contra todos nao guarda 3º lugar');
      await addGuests(base, cat.id, 4);
      const gen = (await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM' }).expect(200)).body;
      assert.equal(gen.matches.length, 6);
      assert.ok(gen.matches.every((m: any) => m.stage === 'GROUP' && m.groupIndex === 0 && m.status === 'READY' && m.nextMatchId === null));
      assert.equal(gen.standings.length, 1);
      assert.equal(gen.standings[0].rows.length, 4);
      assert.deepEqual(gen.podium, []);
      // empate com vencedor = 400; empate placar diferente = 400
      const first = gen.matches[0];
      assert.equal((await as('mestre').post(`${base}/matches/${first.id}/result`, { resultType: 'DRAW', winnerId: first.slotAId }).expect(400)).body.code, 'INVALID_RESULT');
      assert.equal((await as('mestre').post(`${base}/matches/${first.id}/result`, { resultType: 'DRAW', scoreA: 1, scoreB: 2 }).expect(400)).body.code, 'INVALID_RESULT');
      // vencedor fora da luta / sem vencedor = 400
      assert.equal((await as('mestre').post(`${base}/matches/${first.id}/result`, { winnerId: 99999999 }).expect(400)).body.code, 'INVALID_RESULT');
      assert.equal((await as('mestre').post(`${base}/matches/${first.id}/result`, {}).expect(400)).body.code, 'INVALID_RESULT');
      const draw = (await as('mestre').post(`${base}/matches/${first.id}/result`, { resultType: 'DRAW', scoreA: 2, scoreB: 2 }).expect(200)).body;
      const row = draw.standings[0].rows.find((r: any) => r.competitorId === first.slotAId);
      assert.equal(row.draws, 1);
      assert.equal(row.points, 1);
      assert.equal(draw.status, 'RUNNING');
      // W.O. conta vitoria
      const second = draw.matches.find((m: any) => m.status === 'READY');
      const wo = (await as('mestre').post(`${base}/matches/${second.id}/result`, { winnerId: second.slotBId, resultType: 'WALKOVER' }).expect(200)).body;
      assert.equal(wo.standings[0].rows.find((r: any) => r.competitorId === second.slotBId).wins, 1);
      capture('operator-category-roundrobin-running', wo);
      await capturePublic(base, tournament.publicToken, 'public-snapshot-roundrobin-running-4');
      const finished = await playAll(base, cat.id);
      assert.equal(finished.status, 'FINISHED');
      assert.deepEqual(finished.podium.map((p: any) => p.place), [1, 2, 3]);
      assert.equal(finished.podium[0].competitorId, finished.standings[0].rows[0].competitorId);
      assert.deepEqual(finished.standings[0].rows.map((r: any) => r.rank), [1, 2, 3, 4]);
      await capturePublic(base, tournament.publicToken, 'public-snapshot-roundrobin-finished');
      // empate fora de grupo (mata-mata) e rejeitado
      const { base: base2 } = await newTournament();
      const se = await mkCategory(base2, { format: 'SINGLE_ELIMINATION' });
      await addGuests(base2, se.id, 2);
      const g = (await as('mestre').post(`${base2}/categories/${se.id}/generate`, { seeding: 'RANDOM' }).expect(200)).body;
      assert.equal((await as('mestre').post(`${base2}/matches/${g.matches[0].id}/result`, { resultType: 'DRAW' }).expect(400)).body.code, 'INVALID_RESULT');
    });
  });

  // =================================================================================================================
  describe('grupos + mata-mata (8 atletas, 2 grupos, 2 classificados por grupo)', () => {
    it('gera o mata-mata sozinho no último jogo de grupo; desfazer regenera/apaga; DEPENDENT_MATCH_PLAYED', async () => {
      const { base, tournament } = await newTournament();
      assert.equal((await as('mestre').post(`${base}/categories`, { name: 'G', format: 'GROUPS_KNOCKOUT', groupCount: 2, advancePerGroup: 1 }).expect(201)).body.groupCount, 2);
      const cat = await mkCategory(base, { name: 'Grupos', format: 'GROUPS_KNOCKOUT', groupCount: 2, advancePerGroup: 2, thirdPlace: true });
      await addGuests(base, cat.id, 3);
      // 3 atletas e 2 grupos: algum grupo com < 2 -> INVALID_GROUP_CONFIG
      assert.equal((await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM' }).expect(409)).body.code, 'INVALID_GROUP_CONFIG');
      for (let i = 4; i <= 8; i++) {
        await as('mestre').post(`${base}/categories/${cat.id}/competitors`, { guest: { displayName: `Atleta ${i}`, ageGroup: 'ADULT' } }).expect(201);
      }
      const gen = (await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM' }).expect(200)).body;
      assert.equal(gen.matches.length, 12, '2 grupos de 4 = 12 jogos');
      assert.ok(gen.matches.every((m: any) => m.stage === 'GROUP'));
      assert.deepEqual([...new Set(gen.competitors.map((c: any) => c.poolIndex))].sort(), [0, 1]);
      assert.equal(gen.standings.length, 2);
      capture('operator-category-groups-running', gen);
      await capturePublic(base, tournament.publicToken, 'public-snapshot-groups-running');

      // joga os 11 primeiros jogos: nada de mata-mata ainda
      let cur = gen;
      for (let i = 0; i < 11; i++) {
        const m = cur.matches.find((x: any) => x.status === 'READY');
        cur = (await as('mestre').post(`${base}/matches/${m.id}/result`, { winnerId: m.slotAId, scoreA: 2, scoreB: 0 }).expect(200)).body;
      }
      assert.equal(cur.matches.filter((m: any) => m.stage !== 'GROUP').length, 0);
      // o ultimo jogo gera o mata-mata (2 semis + final + 3º) na MESMA resposta
      const last = cur.matches.find((x: any) => x.status === 'READY');
      const withKo = (await as('mestre').post(`${base}/matches/${last.id}/result`, { winnerId: last.slotAId, scoreA: 2, scoreB: 0 }).expect(200)).body;
      const ko = withKo.matches.filter((m: any) => m.stage !== 'GROUP');
      assert.equal(ko.length, 4);
      assert.equal(withKo.status, 'RUNNING');
      const semis = ko.filter((m: any) => m.stage === 'MAIN' && m.round === 1);
      assert.equal(semis.length, 2);
      assert.ok(semis.every((m: any) => m.status === 'READY' && m.slotAId !== null && m.slotBId !== null));
      // 1ºs de grupos em semifinais diferentes e cruzamento 1ºA x 2ºB
      const rank = (g: number) => withKo.standings.find((s: any) => s.groupIndex === g).rows;
      const [a1, a2, b1, b2] = [rank(0)[0].competitorId, rank(0)[1].competitorId, rank(1)[0].competitorId, rank(1)[1].competitorId];
      const pairs = semis.map((m: any) => [m.slotAId, m.slotBId].sort((x: number, y: number) => x - y).join('-'));
      assert.ok(pairs.includes([a1, b2].sort((x, y) => x - y).join('-')) && pairs.includes([b1, a2].sort((x, y) => x - y).join('-')), `cruzamento 1ºA x 2ºB: ${pairs}`);

      // desfazer um jogo de grupo apaga o mata-mata (nenhuma luta dele jogada)
      const undone = (await as('mestre').post(`${base}/matches/${last.id}/undo`).expect(200)).body;
      assert.equal(undone.matches.filter((m: any) => m.stage !== 'GROUP').length, 0);
      assert.equal(undone.matches.find((m: any) => m.id === last.id).status, 'READY');
      // refazer regenera
      const regen = (await as('mestre').post(`${base}/matches/${last.id}/result`, { winnerId: last.slotAId, scoreA: 2, scoreB: 0 }).expect(200)).body;
      assert.equal(regen.matches.filter((m: any) => m.stage !== 'GROUP').length, 4);

      // joga uma semifinal -> desfazer jogo de grupo = DEPENDENT_MATCH_PLAYED
      const semi = regen.matches.find((m: any) => m.stage === 'MAIN' && m.round === 1 && m.status === 'READY');
      await as('mestre').post(`${base}/matches/${semi.id}/start`).expect(200);
      const blocked = await as('mestre').post(`${base}/matches/${last.id}/undo`).expect(409);
      assert.equal(blocked.body.code, 'DEPENDENT_MATCH_PLAYED');
      capture('error-409-dependent-match-played', blocked.body);
      const stillThere = await getCat(base, cat.id);
      assert.equal(stillThere.matches.filter((m: any) => m.stage !== 'GROUP').length, 4, 'nada mudou');
      // mesmo LIVE bloqueia; desfazendo a semifinal (LIVE -> READY) libera
      await as('mestre').post(`${base}/matches/${semi.id}/undo`).expect(200);
      await as('mestre').post(`${base}/matches/${last.id}/undo`).expect(200);
      await as('mestre').post(`${base}/matches/${last.id}/result`, { winnerId: last.slotAId, scoreA: 2, scoreB: 0 }).expect(200);

      const finished = await playAll(base, cat.id);
      assert.equal(finished.status, 'FINISHED');
      assert.deepEqual(finished.podium.map((p: any) => p.place), [1, 2, 3]);
      capture('operator-category-groups-finished', finished);
      await capturePublic(base, tournament.publicToken, 'public-snapshot-groups-finished');
    });

    it('mata-mata com folgas (3 grupos x 2 = 6 classificados) nasce com folgas FINISHED e o desfazer ignora as folgas', async () => {
      const { base } = await newTournament();
      const cat = await mkCategory(base, { name: 'G3', format: 'GROUPS_KNOCKOUT', groupCount: 3, advancePerGroup: 2 });
      await addGuests(base, cat.id, 9);
      let cur = (await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM' }).expect(200)).body;
      assert.equal(cur.matches.length, 9, '3 grupos de 3 = 9 jogos');
      let lastGroup: any;
      while (true) {
        const m = cur.matches.find((x: any) => x.status === 'READY' && x.stage === 'GROUP');
        if (!m) break;
        lastGroup = m;
        cur = (await as('mestre').post(`${base}/matches/${m.id}/result`, { winnerId: m.slotAId }).expect(200)).body;
      }
      const ko = cur.matches.filter((m: any) => m.stage !== 'GROUP');
      assert.ok(ko.length > 0);
      const byes = ko.filter((m: any) => m.isBye);
      assert.equal(byes.length, 2, '6 classificados numa chave de 8 = 2 folgas');
      assert.ok(byes.every((m: any) => m.status === 'FINISHED'));
      // as folgas nao impedem desfazer o ultimo jogo de grupo
      const undone = (await as('mestre').post(`${base}/matches/${lastGroup.id}/undo`).expect(200)).body;
      assert.equal(undone.matches.filter((m: any) => m.stage !== 'GROUP').length, 0);
    });
  });

  // =================================================================================================================
  describe('regras de resultado e desfazer (eliminatória)', () => {
    it('idempotência, MATCH_NOT_READY, MATCH_ALREADY_FINISHED, undo por regra e categoria FINISHED <-> RUNNING', async () => {
      const { base } = await newTournament();
      const cat = await mkCategory(base, { name: 'Undo', format: 'SINGLE_ELIMINATION', thirdPlace: true });
      await addGuests(base, cat.id, 4);
      const gen = (await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM' }).expect(200)).body;
      assert.equal(gen.matches.filter((m: any) => m.isBye).length, 0, 'N=4: sem folgas');
      const semis = gen.matches.filter((m: any) => m.round === 1 && m.stage === 'MAIN');
      const final = gen.matches.find((m: any) => m.stage === 'MAIN' && m.round === 2);
      const third = gen.matches.find((m: any) => m.stage === 'THIRD_PLACE');
      assert.equal(final.status, 'PENDING');

      // luta sem os dois atletas
      const notReady = await as('mestre').post(`${base}/matches/${final.id}/result`, { winnerId: semis[0].slotAId }).expect(409);
      assert.equal(notReady.body.code, 'MATCH_NOT_READY');
      assert.equal((await as('mestre').post(`${base}/matches/${final.id}/start`).expect(409)).body.code, 'MATCH_NOT_READY');
      // undo de luta nao iniciada
      assert.equal((await as('mestre').post(`${base}/matches/${semis[0].id}/undo`).expect(409)).body.code, 'NOTHING_TO_UNDO');

      // semifinal 1: start (LIVE), start de novo idempotente, undo LIVE -> READY, start e resultado
      await as('mestre').post(`${base}/matches/${semis[0].id}/start`).expect(200);
      await as('mestre').post(`${base}/matches/${semis[0].id}/start`).expect(200);
      const back = (await as('mestre').post(`${base}/matches/${semis[0].id}/undo`).expect(200)).body;
      assert.equal(back.matches.find((m: any) => m.id === semis[0].id).status, 'READY');
      await as('mestre').post(`${base}/matches/${semis[0].id}/start`).expect(200);
      const winner0 = semis[0].slotAId;
      const loser0 = semis[0].slotBId;
      const body = { winnerId: winner0, scoreA: 5, scoreB: 2, note: SENT.note };
      const r1 = (await as('mestre').post(`${base}/matches/${semis[0].id}/result`, body).expect(200)).body;
      const rev1 = r1.revision;
      const sf = r1.matches.find((m: any) => m.id === semis[0].id);
      assert.equal(sf.status, 'FINISHED');
      assert.equal(sf.note, SENT.note, 'operador ve a nota');
      assert.equal(r1.matches.find((m: any) => m.id === final.id).slotAId ?? r1.matches.find((m: any) => m.id === final.id).slotBId, winner0);
      assert.ok([r1.matches.find((m: any) => m.id === third.id).slotAId, r1.matches.find((m: any) => m.id === third.id).slotBId].includes(loser0));
      assert.equal(r1.matches.find((m: any) => m.id === final.id).status, 'PENDING', 'final ainda sem o outro finalista');
      // repetir o MESMO resultado = 200 sem mudanca (revisao igual)
      const again = (await as('mestre').post(`${base}/matches/${semis[0].id}/result`, body).expect(200)).body;
      assert.equal(again.revision, rev1, 'idempotente: nao sobe a revisao');
      assert.equal((await as('mestre').post(`${base}/matches/${semis[0].id}/result`, { winnerId: winner0 }).expect(200)).body.revision, rev1);
      // resultado diferente = 409
      const other = await as('mestre').post(`${base}/matches/${semis[0].id}/result`, { winnerId: loser0 }).expect(409);
      assert.equal(other.body.code, 'MATCH_ALREADY_FINISHED');
      assert.equal(other.body.statusCode, 409);
      capture('error-409-match-already-finished', other.body);
      // start em luta FINISHED
      assert.equal((await as('mestre').post(`${base}/matches/${semis[0].id}/start`).expect(409)).body.code, 'MATCH_ALREADY_FINISHED');

      // semifinal 2 + final
      await as('mestre').post(`${base}/matches/${semis[1].id}/result`, { winnerId: semis[1].slotBId, resultType: 'DISQUALIFICATION' }).expect(200);
      const f = await getCat(base, cat.id);
      const finalNow = f.matches.find((m: any) => m.id === final.id);
      assert.equal(finalNow.status, 'READY');
      await as('mestre').post(`${base}/matches/${final.id}/result`, { winnerId: finalNow.slotAId }).expect(200);
      const tp = f.matches.find((m: any) => m.id === third.id);
      await as('mestre').post(`${base}/matches/${tp.id}/result`, { winnerId: tp.slotBId }).expect(200);
      assert.equal((await getCat(base, cat.id)).status, 'FINISHED');

      // desfazer a semifinal com a final jogada = DEPENDENT_MATCH_PLAYED; ordem inversa libera
      assert.equal((await as('mestre').post(`${base}/matches/${semis[0].id}/undo`).expect(409)).body.code, 'DEPENDENT_MATCH_PLAYED');
      const undoThird = (await as('mestre').post(`${base}/matches/${tp.id}/undo`).expect(200)).body;
      assert.equal(undoThird.status, 'RUNNING', 'FINISHED volta a RUNNING ao desfazer');
      assert.equal((await as('mestre').post(`${base}/matches/${semis[0].id}/undo`).expect(409)).body.code, 'DEPENDENT_MATCH_PLAYED', 'a final ainda esta FINISHED');
      await as('mestre').post(`${base}/matches/${final.id}/undo`).expect(200);
      // com a final desfeita (READY) a semifinal pode ser desfeita? a final esta READY (nao jogada) e a disputa de 3º tem os dois
      // perdedores e esta READY (desfeita): liberar a semifinal tira o vencedor da final e o perdedor do 3º lugar.
      const afterSemi = (await as('mestre').post(`${base}/matches/${semis[0].id}/undo`).expect(200)).body;
      const finalAfter = afterSemi.matches.find((m: any) => m.id === final.id);
      assert.equal(finalAfter.status, 'PENDING');
      assert.ok(![finalAfter.slotAId, finalAfter.slotBId].includes(winner0));
      const thirdAfter = afterSemi.matches.find((m: any) => m.id === third.id);
      assert.equal(thirdAfter.status, 'PENDING');
      assert.ok(![thirdAfter.slotAId, thirdAfter.slotBId].includes(loser0));
      const sfAfter = afterSemi.matches.find((m: any) => m.id === semis[0].id);
      assert.deepEqual([sfAfter.winnerId, sfAfter.scoreA, sfAfter.scoreB, sfAfter.resultType, sfAfter.note], [null, null, null, null, null]);
      // refaz tudo e termina
      assert.equal((await playAll(base, cat.id)).status, 'FINISHED');
    });

    it('folga: nasce FINISHED, resultado nela = 409 MATCH_IS_BYE e desfazer = MATCH_IS_BYE; regenerate só sem resultados', async () => {
      const { base } = await newTournament();
      const cat = await mkCategory(base, { name: 'Folga', format: 'SINGLE_ELIMINATION' });
      await addGuests(base, cat.id, 3);
      const gen = (await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM' }).expect(200)).body;
      const bye = gen.matches.find((m: any) => m.isBye);
      assert.equal(bye.status, 'FINISHED');
      assert.equal((await as('mestre').post(`${base}/matches/${bye.id}/undo`).expect(409)).body.code, 'MATCH_IS_BYE');
      const byeRes = await as('mestre').post(`${base}/matches/${bye.id}/result`, { winnerId: bye.winnerId }).expect(409);
      assert.equal(byeRes.body.code, 'MATCH_IS_BYE', 'folga nao aceita resultado, nem o mesmo vencedor');
      assert.equal((await getCat(base, cat.id)).revision, gen.revision, 'recusa nao sobe a revisao');
      const diff = bye.slotAId === bye.winnerId ? bye.slotBId : bye.slotAId;
      assert.equal((await as('mestre').post(`${base}/matches/${bye.id}/result`, { winnerId: diff ?? 999999 }).expect(409)).body.code, 'MATCH_IS_BYE');
      // so as folgas FINISHED + nenhuma luta jogada: regenerate=true funciona (e muda o desenho/semente)
      const regen = (await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM', regenerate: true }).expect(200)).body;
      assert.equal(regen.matches.length, gen.matches.length);
      assert.notEqual(regen.drawSeed, gen.drawSeed);
      // com uma luta LIVE: HAS_RESULTS
      const live = regen.matches.find((m: any) => m.status === 'READY');
      await as('mestre').post(`${base}/matches/${live.id}/start`).expect(200);
      assert.equal((await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM', regenerate: true }).expect(409)).body.code, 'HAS_RESULTS');
      assert.equal((await as('mestre').del(`${base}/categories/${cat.id}`).expect(409)).body.code, 'HAS_RESULTS');
      await as('mestre').post(`${base}/matches/${live.id}/undo`).expect(200);
      await as('mestre').del(`${base}/categories/${cat.id}`).expect(200); // RUNNING sem resultado pode excluir
      await as('mestre').get(`${base}/categories/${cat.id}`).expect(404);
    });

    it('troca de atletas na 1ª rodada: permutação sem duplicar, folga acompanha, bloqueada depois de resultado', async () => {
      const { base } = await newTournament();
      const cat = await mkCategory(base, { name: 'Troca', format: 'SINGLE_ELIMINATION' });
      await addGuests(base, cat.id, 6); // P=8, 2 folgas, 2 lutas reais na rodada 1
      const gen = (await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM' }).expect(200)).body;
      const r1 = gen.matches.filter((m: any) => m.round === 1 && m.stage === 'MAIN');
      const real = r1.filter((m: any) => !m.isBye);
      const byeMatch = r1.find((m: any) => m.isBye);
      assert.equal(real.length, 2);
      // troca simples entre duas lutas reais
      const target = real[0];
      const other = real[1];
      const swapped = (await as('mestre').patch(`${base}/matches/${target.id}/slots`, { slotAId: other.slotAId, slotBId: target.slotBId }).expect(200)).body;
      const t2 = swapped.matches.find((m: any) => m.id === target.id);
      const o2 = swapped.matches.find((m: any) => m.id === other.id);
      assert.equal(t2.slotAId, other.slotAId);
      assert.equal(o2.slotAId, target.slotAId, 'quem estava la foi para o lugar do outro');
      const ids = swapped.matches.filter((m: any) => m.round === 1 && m.stage === 'MAIN').flatMap((m: any) => [m.slotAId, m.slotBId]).filter((x: any) => x !== null);
      assert.equal(new Set(ids).size, 6);
      // troca com uma folga: o vencedor da folga acompanha
      const winnerBefore = byeMatch.winnerId;
      const toBye = swapped.matches.find((m: any) => m.id === target.id);
      const sw2 = (await as('mestre').patch(`${base}/matches/${toBye.id}/slots`, { slotAId: winnerBefore }).expect(200)).body;
      const byeAfter = sw2.matches.find((m: any) => m.id === byeMatch.id);
      assert.notEqual(byeAfter.winnerId, winnerBefore, 'a folga passou a ser de outro atleta');
      assert.equal(byeAfter.status, 'FINISHED');
      const next = sw2.matches.find((m: any) => m.id === byeMatch.nextMatchId);
      assert.ok([next.slotAId, next.slotBId].includes(byeAfter.winnerId));
      assert.ok(![next.slotAId, next.slotBId].includes(winnerBefore));
      // ids invalidos
      assert.equal((await as('mestre').patch(`${base}/matches/${target.id}/slots`, { slotAId: 99999999 }).expect(404)).body.code, 'COMPETITOR_NOT_FOUND');
      assert.equal((await as('mestre').patch(`${base}/matches/${target.id}/slots`, { slotAId: t2.slotBId, slotBId: t2.slotBId }).expect(400)).body.code, 'INVALID_COMPETITOR');
      await as('mestre').patch(`${base}/matches/${target.id}/slots`, {}).expect(400);
      // luta de outra rodada
      const final = sw2.matches.find((m: any) => m.round === 3);
      assert.equal((await as('mestre').patch(`${base}/matches/${final.id}/slots`, { slotAId: 1 }).expect(409)).body.code, 'SWAP_NOT_ALLOWED');
      // depois de um resultado: SWAP_NOT_ALLOWED
      const ready = sw2.matches.find((m: any) => m.status === 'READY');
      await as('mestre').post(`${base}/matches/${ready.id}/result`, { winnerId: ready.slotAId }).expect(200);
      assert.equal((await as('mestre').patch(`${base}/matches/${target.id}/slots`, { slotAId: t2.slotBId }).expect(409)).body.code, 'SWAP_NOT_ALLOWED');
    });

    it('resultados CONCORRENTES na mesma luta: um grava, o outro é idempotente ou 409; estado final coerente', async () => {
      const { base } = await newTournament();
      const cat = await mkCategory(base, { name: 'Corrida', format: 'SINGLE_ELIMINATION' });
      await addGuests(base, cat.id, 4);
      const gen = (await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM' }).expect(200)).body;
      const semi = gen.matches.find((m: any) => m.round === 1 && m.stage === 'MAIN');
      // mesmo vencedor 6x: todos 200, uma unica mudanca
      const same = await Promise.all(Array.from({ length: 6 }, () => as('mestre').post(`${base}/matches/${semi.id}/result`, { winnerId: semi.slotAId, scoreA: 1, scoreB: 0 })));
      assert.ok(same.every((r) => r.status === 200), same.map((r) => r.status).join());
      const afterSame = await getCat(base, cat.id);
      assert.equal(afterSame.revision, gen.revision + 1, 'so uma revisao nova');
      // vencedores DIFERENTES ao mesmo tempo na outra semifinal
      const semi2 = gen.matches.find((m: any) => m.round === 1 && m.stage === 'MAIN' && m.id !== semi.id);
      const results = await Promise.all([
        as('mestre').post(`${base}/matches/${semi2.id}/result`, { winnerId: semi2.slotAId }),
        as('mestre').post(`${base}/matches/${semi2.id}/result`, { winnerId: semi2.slotBId }),
      ]);
      const statuses = results.map((r) => r.status).sort();
      assert.deepEqual(statuses, [200, 409]);
      const loser = results.find((r) => r.status === 409)!;
      assert.equal(loser.body.code, 'MATCH_ALREADY_FINISHED');
      const winnerWon = results.find((r) => r.status === 200)!;
      const final = await getCat(base, cat.id);
      const saved = final.matches.find((m: any) => m.id === semi2.id);
      assert.equal(saved.status, 'FINISHED');
      const winnerId = winnerWon.body.matches.find((m: any) => m.id === semi2.id).winnerId;
      assert.equal(saved.winnerId, winnerId);
      const nextMatch = final.matches.find((m: any) => m.id === semi2.nextMatchId);
      assert.ok([nextMatch.slotAId, nextMatch.slotBId].includes(winnerId));
      assert.equal(nextMatch.status, 'READY');
      // nunca o mesmo atleta nos dois lados e cada atleta aparece uma vez na final
      assert.notEqual(nextMatch.slotAId, nextMatch.slotBId);
    });

    it('PATCH da luta (tatame/ordem) e auditoria sem dados pessoais', async () => {
      const { base, eventId } = await newTournament();
      const cat = await mkCategory(base, { name: 'Tatame', format: 'ROUND_ROBIN' });
      await addGuests(base, cat.id, 3, (i) => ({ displayName: `Pessoa Auditada ${i}` }));
      const gen = (await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM' }).expect(200)).body;
      const m = gen.matches[0];
      const upd = (await as('mestre').patch(`${base}/matches/${m.id}`, { mat: 2, queueOrder: 5 }).expect(200)).body;
      const um = upd.matches.find((x: any) => x.id === m.id);
      assert.deepEqual([um.mat, um.queueOrder], [2, 5]);
      assert.equal((await as('mestre').patch(`${base}/matches/${m.id}`, { mat: 2 }).expect(200)).body.revision, upd.revision, 'sem mudanca = sem revisao');
      assert.equal((await as('mestre').patch(`${base}/matches/${m.id}`, { mat: null }).expect(200)).body.matches.find((x: any) => x.id === m.id).mat, null);
      await as('mestre').post(`${base}/matches/${m.id}/result`, { winnerId: m.slotAId, note: SENT.note }).expect(200);
      const logs = await prisma.auditLog.findMany({ where: { organizationId: orgA, action: { startsWith: 'TOURNAMENT_' } } });
      assert.ok(logs.length >= 6);
      const codes = new Set(logs.map((l) => l.action));
      for (const c of ['TOURNAMENT_CREATE', 'TOURNAMENT_CATEGORY_CREATE', 'TOURNAMENT_COMPETITOR_ADD', 'TOURNAMENT_GENERATE', 'TOURNAMENT_MATCH_UPDATE', 'TOURNAMENT_MATCH_RESULT']) assert.ok(codes.has(c), c);
      const raw = JSON.stringify(logs.map((l) => l.metadata));
      assert.ok(!raw.includes('Pessoa Auditada') && !raw.includes(SENT.note) && !raw.includes('publicToken'), 'auditoria sem dados pessoais/nota/token');
      assert.ok(logs.every((l) => l.userId !== null), 'autor registrado');
      assert.ok(eventId > 0);
      for (const c of Object.values(AuditAction).filter((a) => a.startsWith('TOURNAMENT_'))) assert.ok(typeof c === 'string');
    });
  });

  // =================================================================================================================
  describe('isolamento entre grupos e vínculos de atletas', () => {
    it('ids do grupo A usados pelo grupo B (e vice-versa) = 404 em TODAS as rotas; estado de A intacto', async () => {
      const a = await newTournament('mestre', orgA);
      const catA = await mkCategory(a.base, { name: 'Iso A', format: 'SINGLE_ELIMINATION' });
      await addGuests(a.base, catA.id, 4);
      const genA = (await as('mestre').post(`${a.base}/categories/${catA.id}/generate`, { seeding: 'RANDOM' }).expect(200)).body;
      const matchA = genA.matches.find((m: any) => m.status === 'READY');
      const compA = genA.competitors[0];
      const b = await newTournament('mestreB', orgB);
      const catB = await mkCategory(b.base, { name: 'Iso B', format: 'SINGLE_ELIMINATION' }, 'mestreB');

      const revBefore = (await getCat(a.base, catA.id)).revision;
      // B usando o evento de A
      for (const [m, p, body] of [
        ['get', `${a.base}`, undefined],
        ['get', `${a.base}/categories/${catA.id}`, undefined],
        ['post', `${a.base}/categories`, { name: 'Invasora', format: 'ROUND_ROBIN' }],
        ['patch', `${a.base}`, { publicEnabled: true }],
        ['post', `${a.base}/rotate-token`, {}],
        ['post', `${a.base}/categories/${catA.id}/competitors`, { guest: { displayName: 'Invasor' } }],
        ['post', `${a.base}/categories/${catA.id}/generate`, { seeding: 'RANDOM', regenerate: true }],
        ['patch', `${a.base}/competitors/${compA.id}`, { displayName: 'Hackeado' }],
        ['patch', `${a.base}/matches/${matchA.id}/slots`, { slotAId: compA.id }],
        ['post', `${a.base}/matches/${matchA.id}/start`, {}],
        ['post', `${a.base}/matches/${matchA.id}/result`, { winnerId: matchA.slotAId }],
        ['post', `${a.base}/matches/${matchA.id}/undo`, {}],
        ['patch', `${a.base}/matches/${matchA.id}`, { mat: 1 }],
      ] as Array<[string, string, object | undefined]>) {
        const r = await (as('mestreB') as any)[m](p, body);
        assert.equal(r.status, 404, `B ${m} ${p} -> ${r.status}`);
      }
      await as('mestreB').del(`${a.base}/competitors/${compA.id}`).expect(404);
      await as('mestreB').del(`${a.base}/categories/${catA.id}`).expect(404);
      // B usando ids de A no PROPRIO evento (ids "cruzados"): categoria/atleta/luta de A com o eventId de B
      for (const [m, p, body] of [
        ['get', `${b.base}/categories/${catA.id}`, undefined],
        ['patch', `${b.base}/competitors/${compA.id}`, { displayName: 'Hackeado' }],
        ['post', `${b.base}/matches/${matchA.id}/result`, { winnerId: matchA.slotAId }],
        ['post', `${b.base}/categories/${catA.id}/competitors`, { guest: { displayName: 'Invasor' } }],
      ] as Array<[string, string, object | undefined]>) {
        const r = await (as('mestreB') as any)[m](p, body);
        assert.equal(r.status, 404, `B(evento B) ${m} ${p} -> ${r.status}`);
      }
      assert.equal((await getCat(a.base, catA.id)).revision, revBefore, 'nenhuma tentativa do grupo B mexeu no torneio de A');
      // A usando o evento de A com ids da categoria de B
      await as('mestre').get(`${a.base}/categories/${catB.id}`).expect(404);
      await as('mestre').post(`${a.base}/categories/${catB.id}/competitors`, { guest: { displayName: 'Invasor' } }).expect(404);
      // aluno/participante de outro grupo ou de outro evento = 404
      const studentB = await prisma.student.create({ data: { organizationId: orgB, name: 'Aluno do B', status: 'ACTIVE' } });
      const catSetupFirst = await mkCategory(a.base, { name: 'Setup aluno de fora', format: 'ROUND_ROBIN' });
      await as('mestre').post(`${a.base}/categories/${catSetupFirst.id}/competitors`, { studentId: studentB.id }).expect(404);
      const eventOther = await mkEvent(orgA);
      const studentA = await prisma.student.create({ data: { organizationId: orgA, name: 'Aluno do A', status: 'ACTIVE' } });
      const partOther = await prisma.eventParticipant.create({ data: { organizationId: orgA, eventId: eventOther.id, studentId: studentA.id, status: 'CONFIRMED' } });
      const catSetup = await mkCategory(a.base, { name: 'Setup iso', format: 'ROUND_ROBIN' });
      await as('mestre').post(`${a.base}/categories/${catSetup.id}/competitors`, { eventParticipantId: partOther.id }).expect(404);
      const partB = await prisma.eventParticipant.create({ data: { organizationId: orgB, eventId: (await mkEvent(orgB)).id, guestName: 'Convidado B', status: 'CONFIRMED' } });
      await as('mestre').post(`${a.base}/categories/${catSetup.id}/competitors`, { eventParticipantId: partB.id }).expect(404);
      // importacao em lote ignora (skipped) o que e de outro evento/grupo
      const imp = (await as('mestre').post(`${a.base}/categories/${catSetup.id}/competitors/from-participants`, { eventParticipantIds: [partOther.id, partB.id] }).expect(200)).body;
      assert.equal(imp.added, 0);
      assert.equal(imp.skipped, 2);
      assert.equal((await prisma.tournamentCompetitor.count({ where: { categoryId: catSetup.id } })), 0);
      // nada de A mudou
      const after = await getCat(a.base, catA.id);
      assert.equal(after.competitors[0].displayName, compA.displayName);
      assert.deepEqual(after.matches.map((m: any) => m.status), genA.matches.map((m: any) => m.status));
    });

    it('atletas do evento: aluno, inscrito e importação em lote (duplicados e inelegíveis ignorados)', async () => {
      const { base, eventId } = await newTournament();
      const cat = await mkCategory(base, { name: 'Do evento', format: 'ROUND_ROBIN' });
      const [s1, s2, s3] = await Promise.all(['Ana Aluna', 'Bruno Aluno', 'Carla Aluna'].map((name) => prisma.student.create({ data: { organizationId: orgA, name, status: 'ACTIVE' } })));
      const p1 = await prisma.eventParticipant.create({ data: { organizationId: orgA, eventId, studentId: s1.id, status: 'CONFIRMED' } });
      const p2 = await prisma.eventParticipant.create({ data: { organizationId: orgA, eventId, studentId: s2.id, status: 'ATTENDED' } });
      const p3 = await prisma.eventParticipant.create({ data: { organizationId: orgA, eventId, studentId: s3.id, status: 'CANCELLED' } });
      const p4 = await prisma.eventParticipant.create({ data: { organizationId: orgA, eventId, guestName: 'Convidado Externo', status: 'CONFIRMED' } });
      const one = (await as('mestre').post(`${base}/categories/${cat.id}/competitors`, { eventParticipantId: p1.id }).expect(201)).body;
      const c1 = one.competitors[0];
      assert.equal(c1.displayName, 'Ana Aluna');
      assert.equal(c1.studentId, s1.id);
      assert.equal(c1.eventParticipantId, p1.id);
      assert.match(c1.groupName, /Grupo a/);
      assert.equal((await as('mestre').post(`${base}/categories/${cat.id}/competitors`, { eventParticipantId: p1.id }).expect(409)).body.code, 'COMPETITOR_EXISTS');
      assert.equal((await as('mestre').post(`${base}/categories/${cat.id}/competitors`, { studentId: s1.id }).expect(409)).body.code, 'COMPETITOR_EXISTS');
      assert.equal((await as('mestre').post(`${base}/categories/${cat.id}/competitors`, { eventParticipantId: p3.id }).expect(400)).body.code, 'PARTICIPANT_NOT_ELIGIBLE');
      const imp = (await as('mestre').post(`${base}/categories/${cat.id}/competitors/from-participants`, { eventParticipantIds: [p1.id, p2.id, p3.id, p4.id] }).expect(200)).body;
      assert.deepEqual([imp.added, imp.skipped], [2, 2]);
      assert.equal(imp.category.competitors.length, 3);
      assert.equal((await as('mestre').post(`${base}/categories/${cat.id}/competitors/from-participants`, { eventParticipantIds: [p1.id] }).expect(200)).body.added, 0);
      await as('mestre').post(`${base}/categories/${cat.id}/competitors/from-participants`, { eventParticipantIds: [] }).expect(400);
      await as('mestre').post(`${base}/categories/${cat.id}/competitors/from-participants`, { eventParticipantIds: [1, 1] }).expect(400);
      // aluno direto
      const s5 = await prisma.student.create({ data: { organizationId: orgA, name: 'Diego Direto', status: 'ACTIVE' } });
      await as('mestre').post(`${base}/categories/${cat.id}/competitors`, { studentId: s5.id }).expect(201);
      // aluno anonimizado nao entra
      const anon = await prisma.student.create({ data: { organizationId: orgA, name: 'Pessoa removida', status: 'ACTIVE', anonymizedAt: new Date() } });
      assert.equal((await as('mestre').post(`${base}/categories/${cat.id}/competitors`, { studentId: anon.id }).expect(400)).body.code, 'STUDENT_NOT_ELIGIBLE');
      // PATCH de atleta ligado a aluno: foto nao se define (vem do aluno)
      const withStudent = (await getCat(base, cat.id)).competitors.find((c: any) => c.studentId === s5.id);
      assert.equal((await as('mestre').patch(`${base}/competitors/${withStudent.id}`, { photoUrl: PHOTO(1) }).expect(400)).body.code, 'INVALID_PHOTO_URL');
      // editar texto a qualquer momento, inclusive depois de gerar
      await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM' }).expect(200);
      const edited = (await as('mestre').patch(`${base}/competitors/${withStudent.id}`, { displayName: 'Diego Direto Silva', graduationLabel: 'Contramestre', groupName: '' }).expect(200)).body;
      const ec = edited.competitors.find((c: any) => c.id === withStudent.id);
      assert.deepEqual([ec.displayName, ec.graduationLabel, ec.groupName], ['Diego Direto Silva', 'Contramestre', null]);
      assert.equal((await as('mestre').patch(`${base}/competitors/${withStudent.id}`, { displayName: null }).expect(400)).body.code, 'INVALID_COMPETITOR');
    });
  });

  // =================================================================================================================
  describe('atleta de aluno e exclusão em cascata', () => {
    it('PATCH de atleta ligado a aluno: ageGroup/photoUrl diferentes do que o operador vê = 400; iguais = ignorado', async () => {
      const { base } = await newTournament();
      const cat = await mkCategory(base, { name: 'Aluno derivado', format: 'ROUND_ROBIN' });
      const s = await prisma.student.create({ data: { organizationId: orgA, name: 'Aluno Derivado', status: 'ACTIVE', photo: PHOTO(2), birthDate: new Date('2015-03-04T00:00:00.000Z') } });
      const added = (await as('mestre').post(`${base}/categories/${cat.id}/competitors`, { studentId: s.id }).expect(201)).body;
      const c = added.competitors[0];
      assert.equal(c.ageGroup, 'MINOR');
      const bad = await as('mestre').patch(`${base}/competitors/${c.id}`, { ageGroup: 'ADULT' }).expect(400);
      assert.equal(bad.body.code, 'AGE_GROUP_FROM_STUDENT');
      assert.equal((await as('mestre').patch(`${base}/competitors/${c.id}`, { photoUrl: PHOTO(3) }).expect(400)).body.code, 'INVALID_PHOTO_URL');
      const same = (await as('mestre').patch(`${base}/competitors/${c.id}`, { ageGroup: 'MINOR', photoUrl: PHOTO(2) }).expect(200)).body;
      assert.equal(same.revision, added.revision, 'mesmo valor que o operador ve = ignorado, sem mudanca');
      // convidado continua gravando
      const g = (await as('mestre').post(`${base}/categories/${cat.id}/competitors`, { guest: { displayName: 'Convidado Edit' } }).expect(201)).body;
      const gid = g.competitors.find((x: any) => x.displayName === 'Convidado Edit').id;
      const upd = (await as('mestre').patch(`${base}/competitors/${gid}`, { ageGroup: 'ADULT', photoUrl: PHOTO(4) }).expect(200)).body;
      const gc = upd.competitors.find((x: any) => x.id === gid);
      assert.deepEqual([gc.ageGroup, gc.photoUrl], ['ADULT', PHOTO(4)]);
    });

    it('POST de atleta já com seed e photoAuthorized (guest) e seed nas formas studentId/eventParticipantId; SEED_TAKEN na criação', async () => {
      const { base, eventId } = await newTournament();
      const cat = await mkCategory(base, { name: 'Criacao completa', format: 'SINGLE_ELIMINATION' });
      const post = (body: object) => as('mestre').post(`${base}/categories/${cat.id}/competitors`, body);
      const g = (await post({ guest: { displayName: 'Convidada Menor', ageGroup: 'MINOR', photoUrl: PHOTO(5), seed: 1, photoAuthorized: true } }).expect(201)).body;
      const gc = g.competitors.find((c: any) => c.displayName === 'Convidada Menor');
      assert.equal(gc.seed, 1);
      assert.equal(gc.photoAuthorized, true);
      assert.ok(gc.photoAuthorizedAt);
      assert.equal(gc.photoPublic, true, 'menor autorizado: foto publica');
      const row = await prisma.tournamentCompetitor.findUniqueOrThrow({ where: { id: gc.id } });
      const mestreUser = await prisma.user.findFirstOrThrow({ where: { email: `mestre-a-${stamp}@e2e-tourn.local` } });
      assert.equal(row.photoAuthorizedById, mestreUser.id, 'grava quem autorizou');
      assert.ok(row.photoAuthorizedAt);
      // sem photoAuthorized: continua falso e sem autor
      const g2 = (await post({ guest: { displayName: 'Convidado Comum', seed: 2 } }).expect(201)).body;
      const c2 = g2.competitors.find((c: any) => c.displayName === 'Convidado Comum');
      assert.deepEqual([c2.seed, c2.photoAuthorized, c2.photoAuthorizedAt], [2, false, null]);
      // SEED_TAKEN na criacao (nada e criado)
      const dup = await post({ guest: { displayName: 'Outro Com Seed 1', seed: 1 } }).expect(409);
      assert.equal(dup.body.code, 'SEED_TAKEN');
      assert.equal((await getCat(base, cat.id)).competitors.length, 2);
      // validacao: fora de 1..128, nao inteiro, photoAuthorized nao booleano
      for (const guest of [{ displayName: 'Seed Zero', seed: 0 }, { displayName: 'Seed Alto', seed: 129 }, { displayName: 'Seed Quebrado', seed: 1.5 }, { displayName: 'Auth Texto', photoAuthorized: 'sim' }]) {
        assert.equal((await post({ guest }).expect(400)).status, 400, JSON.stringify(guest));
      }
      // seed no topo + guest = 400 (no convidado vai dentro de guest)
      assert.equal((await post({ guest: { displayName: 'Dois Seeds' }, seed: 3 }).expect(400)).body.code, 'INVALID_COMPETITOR');
      // seed nas formas studentId e eventParticipantId
      const [s1, s2] = await Promise.all(['Aluno Seed Tres', 'Aluno Seed Quatro'].map((name) => prisma.student.create({ data: { organizationId: orgA, name, status: 'ACTIVE' } })));
      const part = await prisma.eventParticipant.create({ data: { organizationId: orgA, eventId, studentId: s2.id, status: 'CONFIRMED' } });
      const a = (await post({ studentId: s1.id, seed: 3 }).expect(201)).body;
      assert.equal(a.competitors.find((c: any) => c.studentId === s1.id).seed, 3);
      const b = (await post({ eventParticipantId: part.id, seed: 4 }).expect(201)).body;
      assert.equal(b.competitors.find((c: any) => c.studentId === s2.id).seed, 4);
      const s3 = await prisma.student.create({ data: { organizationId: orgA, name: 'Aluno Seed Repetido', status: 'ACTIVE' } });
      assert.equal((await post({ studentId: s3.id, seed: 3 }).expect(409)).body.code, 'SEED_TAKEN');
      assert.equal(await prisma.tournamentCompetitor.count({ where: { categoryId: cat.id, studentId: s3.id } }), 0);
      // corrida: dois POSTs simultaneos com a mesma semente = 1 criado e 1 SEED_TAKEN
      const race = await Promise.all([post({ guest: { displayName: 'Corredor Um', seed: 9 } }), post({ guest: { displayName: 'Corredor Dois', seed: 9 } })]);
      assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
      assert.equal(race.find((r) => r.status === 409)!.body.code, 'SEED_TAKEN');
      // o torneio gera usando as sementes informadas na criacao
      const gen = (await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'BY_SEED' }).expect(200)).body;
      assert.equal(gen.status, 'RUNNING');
    });

    it('excluir categoria/evento com lutas JÁ DECIDIDAS (vencedores) não esbarra no CHECK vencedor-nos-lados', async () => {
      const { base, eventId } = await newTournament();
      const cat = await mkCategory(base, { name: 'Cascata com vencedores', format: 'SINGLE_ELIMINATION' });
      await addGuests(base, cat.id, 4);
      await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM' }).expect(200);
      const cur = await getCat(base, cat.id);
      const m = cur.matches.find((x: any) => x.status === 'READY');
      await as('mestre').post(`${base}/matches/${m.id}/result`, { winnerId: m.slotAId }).expect(200);
      await prisma.tournamentCategory.delete({ where: { id: cat.id } }); // cascata direta (atletas e lutas juntos)
      assert.equal(await prisma.tournamentMatch.count({ where: { categoryId: cat.id } }), 0);
      const cat2 = await mkCategory(base, { name: 'Cascata evento', format: 'SINGLE_ELIMINATION' });
      await addGuests(base, cat2.id, 4);
      await as('mestre').post(`${base}/categories/${cat2.id}/generate`, { seeding: 'RANDOM' }).expect(200);
      const cur2 = await getCat(base, cat2.id);
      const m2 = cur2.matches.find((x: any) => x.status === 'READY');
      await as('mestre').post(`${base}/matches/${m2.id}/result`, { winnerId: m2.slotBId }).expect(200);
      await as('mestre').del(`/events/${eventId}`).expect(200);
      assert.equal(await prisma.tournamentMatch.count({ where: { categoryId: cat2.id } }), 0);
    });
  });

  // =================================================================================================================
  describe('categorias (CRUD, limites) e escopo de unidade', () => {
    it('editar só em SETUP (nome vale sempre), nome duplicado, excluir, ordem e limite de 40 categorias', async () => {
      const { base } = await newTournament();
      const a = await mkCategory(base, { name: 'Primeira', format: 'SINGLE_ELIMINATION', thirdPlace: true });
      const b = await mkCategory(base, { name: 'Segunda', format: 'ROUND_ROBIN' });
      assert.deepEqual([a.position, b.position], [0, 1]);
      const patched = (await as('mestre').patch(`${base}/categories/${a.id}`, { format: 'GROUPS_KNOCKOUT', groupCount: 2, advancePerGroup: 2 }).expect(200)).body;
      assert.deepEqual([patched.format, patched.groupCount, patched.advancePerGroup, patched.thirdPlace], ['GROUPS_KNOCKOUT', 2, 2, true]);
      const back = (await as('mestre').patch(`${base}/categories/${a.id}`, { format: 'SINGLE_ELIMINATION' }).expect(200)).body;
      assert.deepEqual([back.groupCount, back.advancePerGroup], [null, null], 'sai de grupos = zera a configuracao');
      assert.equal((await as('mestre').patch(`${base}/categories/${a.id}`, { format: 'GROUPS_KNOCKOUT' }).expect(400)).body.code, 'INVALID_GROUP_CONFIG');
      assert.equal((await as('mestre').patch(`${base}/categories/${a.id}`, { name: 'segunda' }).expect(409)).body.code, 'CATEGORY_NAME_TAKEN');
      assert.equal((await as('mestre').patch(`${base}/categories/${a.id}`, { name: '   ' }).expect(400)).status, 400);
      await as('mestre').patch(`${base}/categories/${a.id}`, { name: 'x'.repeat(81) }).expect(400);
      // gerar e depois: so o nome muda
      await addGuests(base, a.id, 4);
      await as('mestre').post(`${base}/categories/${a.id}/generate`, { seeding: 'RANDOM' }).expect(200);
      assert.equal((await as('mestre').patch(`${base}/categories/${a.id}`, { thirdPlace: false }).expect(409)).body.code, 'NOT_IN_SETUP');
      assert.equal((await as('mestre').patch(`${base}/categories/${a.id}`, { name: 'Renomeada' }).expect(200)).body.name, 'Renomeada');
      const same = (await as('mestre').patch(`${base}/categories/${a.id}`, { name: 'Renomeada' }).expect(200)).body;
      assert.equal(same.name, 'Renomeada');
      // excluir uma em SETUP devolve o resumo do torneio
      capture('operator-tournament-summary', (await as('mestre').get(base).expect(200)).body); // resumo com 2 categorias (RUNNING e SETUP)
      const summary = (await as('mestre').del(`${base}/categories/${b.id}`).expect(200)).body;
      capture('operator-delete-category-summary', summary);
      assert.deepEqual(summary.categories.map((c: any) => c.name), ['Renomeada']);
      // limite de 40
      for (let i = 0; i < 39; i++) await mkCategory(base, { name: `Lote ${i}`, format: 'ROUND_ROBIN' });
      const over = await as('mestre').post(`${base}/categories`, { name: 'Quadragésima primeira', format: 'ROUND_ROBIN' }).expect(409);
      assert.equal(over.body.code, 'CATEGORY_LIMIT');
      // criacoes simultaneas respeitam o limite e a unicidade do nome
      const { base: base2 } = await newTournament();
      const same2 = await Promise.all(Array.from({ length: 5 }, () => as('mestre').post(`${base2}/categories`, { name: 'Corrida', format: 'ROUND_ROBIN' })));
      assert.deepEqual(same2.map((r) => r.status).sort(), [201, 409, 409, 409, 409]);
    });

    it('excluir o evento leva o campeonato junto (cascata) sem erro', async () => {
      const { base, eventId } = await newTournament();
      const cat = await mkCategory(base, { name: 'Cascata', format: 'ROUND_ROBIN' });
      await addGuests(base, cat.id, 3);
      await as('mestre').post(`${base}/categories/${cat.id}/generate`, { seeding: 'RANDOM' }).expect(200);
      await as('mestre').del(`/events/${eventId}`).expect(200);
      assert.equal(await prisma.tournament.count({ where: { eventId } }), 0);
      assert.equal(await prisma.tournamentMatch.count({ where: { categoryId: cat.id } }), 0);
      assert.equal(await prisma.tournamentCompetitor.count({ where: { categoryId: cat.id } }), 0);
    });

    it('escopo de unidade: professor restrito a outra unidade não vê o evento (404); evento do grupo inteiro é visível', async () => {
      const unitX = await prisma.unit.create({ data: { organizationId: orgA, name: `${TAG} Unidade X` } });
      const unitY = await prisma.unit.create({ data: { organizationId: orgA, name: `${TAG} Unidade Y` } });
      const restricted = await mkUser(orgA, OrgRole.PROFESSOR, 'prof-restrito');
      const profUser = await prisma.user.findFirstOrThrow({ where: { email: `prof-restrito-${stamp}@e2e-tourn.local` } });
      await prisma.userUnitAccess.create({ data: { organizationId: orgA, userId: profUser.id, unitId: unitY.id } });
      tokens.restrito = restricted;
      const evX = await mkEvent(orgA, { unitId: unitX.id });
      const evY = await mkEvent(orgA, { unitId: unitY.id });
      const evAll = await mkEvent(orgA);
      await as('mestre').post(`/events/${evX.id}/tournament`).expect(201);
      await as('restrito').get(`/events/${evX.id}/tournament`).expect(404);
      await as('restrito').post(`/events/${evX.id}/tournament`).expect(404);
      await as('restrito').post(`/events/${evY.id}/tournament`).expect(201);
      await as('restrito').post(`/events/${evAll.id}/tournament`).expect(201);
      await prisma.userUnitAccess.deleteMany({ where: { userId: profUser.id } });
      await prisma.tournament.deleteMany({ where: { eventId: { in: [evX.id, evY.id, evAll.id] } } });
      await prisma.event.deleteMany({ where: { id: { in: [evX.id, evY.id, evAll.id] } } });
      await prisma.unit.deleteMany({ where: { id: { in: [unitX.id, unitY.id] } } });
    });
  });

  // =================================================================================================================
  describe('telão público: privacidade, 404 uniforme, ETag, token, memoização', () => {
    let ctx: { eventId: number; base: string; tournament: { id: number; publicToken: string } };
    let cid = 0;
    const comp: Record<string, number> = {};

    before(async () => {
      ctx = await newTournament();
      const cat = await mkCategory(ctx.base, { name: 'Privacidade', format: 'ROUND_ROBIN' });
      cid = cat.id;
      const mkStudent = (name: string, birth: string | null, photo: string | null) =>
        prisma.student.create({
          data: {
            organizationId: orgA, name, status: 'ACTIVE', photo, document: SENT.cpf, email: SENT.email, phone: SENT.phone,
            birthDate: birth ? new Date(`${birth}T00:00:00.000Z`) : null,
          },
        });
      const sMinor = await mkStudent('Menor Sem Autorizacao', SENT.birthMinor, PHOTO(1));
      const sAdult = await mkStudent('Adulto Com Foto', SENT.birthAdult, PHOTO(2));
      const sUnknown = await mkStudent('Sem Data De Nascimento', null, PHOTO(3));
      const sMinorAuth = await mkStudent('Menor Autorizado', SENT.birthMinor, PHOTO(4));
      for (const [key, s] of [['minor', sMinor], ['adult', sAdult], ['unknown', sUnknown], ['minorAuth', sMinorAuth]] as const) {
        const r = (await as('mestre').post(`${ctx.base}/categories/${cid}/competitors`, { studentId: s.id }).expect(201)).body;
        comp[key] = r.competitors.find((c: any) => c.studentId === s.id).id;
      }
      await as('mestre').patch(`${ctx.base}/competitors/${comp.minorAuth}`, { photoAuthorized: true }).expect(200);
      // convidados: menor sem autorizacao (com foto), adulto com foto https
      const g1 = (await as('mestre').post(`${ctx.base}/categories/${cid}/competitors`, { guest: { displayName: 'Convidado Menor', ageGroup: 'MINOR', photoUrl: PHOTO(5), groupName: 'Academia X', graduationLabel: 'Azul' } }).expect(201)).body;
      comp.guestMinor = g1.competitors.at(-1).id;
      const g2 = (await as('mestre').post(`${ctx.base}/categories/${cid}/competitors`, { guest: { displayName: 'Convidado Adulto', ageGroup: 'ADULT', photoUrl: 'https://cdn.exemplo.com/foto.jpg' } }).expect(201)).body;
      comp.guestAdult = g2.competitors.at(-1).id;
      const g3 = (await as('mestre').post(`${ctx.base}/categories/${cid}/competitors`, { guest: { displayName: 'Convidado Desconhecido', photoUrl: PHOTO(6) } }).expect(201)).body;
      comp.guestUnknown = g3.competitors.at(-1).id;
      const operator = (await as('mestre').get(`${ctx.base}/categories/${cid}`).expect(200)).body;
      const op = (id: number) => operator.competitors.find((c: any) => c.id === id);
      assert.equal(op(comp.minor).ageGroup, 'MINOR', 'operador ve a faixa etaria RECALCULADA do aluno');
      assert.equal(op(comp.adult).ageGroup, 'ADULT');
      assert.equal(op(comp.unknown).ageGroup, 'UNKNOWN');
      assert.equal(op(comp.minor).photoUrl, PHOTO(1), 'operador ve a foto do aluno (derivada de Student.photo)');
      assert.equal(op(comp.minor).photoPublic, false);
      assert.equal(op(comp.minorAuth).photoPublic, true);
      assert.ok(op(comp.minorAuth).photoAuthorizedAt);
      await as('mestre').post(`${ctx.base}/categories/${cid}/generate`, { seeding: 'RANDOM' }).expect(200);
      // luta com nota interna
      const m = operator.matches.length ? operator.matches[0] : (await getCat(ctx.base, cid)).matches[0];
      void m;
      const cur = await getCat(ctx.base, cid);
      await as('mestre').post(`${ctx.base}/matches/${cur.matches[0].id}/result`, { winnerId: cur.matches[0].slotAId, note: SENT.note, scoreA: 3, scoreB: 1 }).expect(200);
    });

    const assertPrivate = (raw: string, body: any) => {
      const t = (id: number) => body.categories[0].competitors.find((c: any) => c.id === id);
      assert.equal(t(comp.minor).photoUrl, null, 'menor sem autorizacao');
      assert.equal(t(comp.adult).photoUrl, PHOTO(2));
      assert.equal(t(comp.unknown).photoUrl, null, 'sem data de nascimento = UNKNOWN = sem foto');
      assert.equal(t(comp.minorAuth).photoUrl, PHOTO(4), 'menor COM autorizacao');
      assert.equal(t(comp.guestMinor).photoUrl, null);
      assert.equal(t(comp.guestAdult).photoUrl, 'https://cdn.exemplo.com/foto.jpg');
      assert.equal(t(comp.guestUnknown).photoUrl, null);
      // as URLs das fotos negadas nao aparecem EM LUGAR NENHUM do JSON
      for (const n of [1, 3, 5, 6]) assert.ok(!raw.includes(PHOTO(n)), `foto ${n} vazou`);
      // sentinelas e campos proibidos
      for (const s of [SENT.cpf, SENT.email, SENT.phone, SENT.note, SENT.birthMinor, SENT.birthAdult, '2015-03', 'vazamento.test', 'CPF-SENT']) {
        assert.ok(!raw.includes(s), `sentinela vazou: ${s}`);
      }
      const keys = keysDeep(body);
      for (const k of ['studentId', 'eventParticipantId', 'ageGroup', 'photoAuthorized', 'photoAuthorizedById', 'photoAuthorizedAt', 'birthDate', 'email', 'phone', 'note', 'organizationId', 'publicToken', 'document', 'guardian', 'drawSeed', 'loserNextMatchId', 'startedAt', 'finishedAt', 'displayName', 'groupName', 'graduationLabel', 'tournamentId']) {
        assert.ok(!keys.has(k), `campo proibido no publico: ${k}`);
      }
      assert.ok(!raw.includes(ctx.tournament.publicToken), 'o token nao aparece no corpo');
    };
    const assertShape = (body: any) => {
      assert.deepEqual(Object.keys(body), [...PUBLIC_SNAPSHOT_KEYS.top]);
      assert.deepEqual(Object.keys(body.event), [...PUBLIC_SNAPSHOT_KEYS.event]);
      for (const c of body.categories) {
        assert.deepEqual(Object.keys(c), [...PUBLIC_SNAPSHOT_KEYS.category]);
        for (const x of c.competitors) assert.deepEqual(Object.keys(x), [...PUBLIC_SNAPSHOT_KEYS.competitor]);
        for (const x of c.matches) {
          assert.deepEqual(Object.keys(x), [...PUBLIC_SNAPSHOT_KEYS.match]);
          assert.ok(x.mat === null || typeof x.mat === 'string');
        }
        for (const g of c.standings) {
          assert.deepEqual(Object.keys(g), [...PUBLIC_SNAPSHOT_KEYS.standingsGroup]);
          for (const r of g.rows) assert.deepEqual(Object.keys(r), [...PUBLIC_SNAPSHOT_KEYS.standingRow]);
        }
        for (const p of c.podium) assert.deepEqual(Object.keys(p), [...PUBLIC_SNAPSHOT_KEYS.podium]);
      }
    };

    it('telão desligado = 404; ligado: snapshot no formato exato, cabeçalhos e privacidade (foto de menor = null)', async () => {
      const token = ctx.tournament.publicToken;
      assert.equal((await pub(token).expect(404)).body.code, 'TOURNAMENT_NOT_FOUND');
      const on = (await as('mestre').patch(ctx.base, { publicEnabled: true }).expect(200)).body;
      capture('operator-tournament-patch-public', on);
      assert.equal(on.publicEnabled, true);
      const res = await pub(token).expect(200);
      assert.match(res.headers['content-type'], /application\/json/);
      assert.match(res.headers.etag, /^"\d+-[0-9a-f]{10}"$/);
      assert.equal(res.headers['cache-control'], 'no-cache');
      assert.equal(res.headers['x-robots-tag'], 'noindex');
      assertShape(res.body);
      assertPrivate(res.text, res.body);
      assert.equal(res.body.categories[0].competitors.length, 7);
      assert.equal(res.body.categories[0].matches.length, 21, '7 atletas todos contra todos');
      assert.equal(res.body.event.title.startsWith(TAG), true);
      assert.ok(res.body.organizationName.includes(TAG));
      const first = res.body.categories[0].matches.find((m: any) => m.status === 'FINISHED');
      assert.deepEqual([first.scoreA, first.scoreB], [3, 1]);
      assert.equal(res.body.categories[0].standings[0].rows.length, 7);
      assert.ok(new Date(res.body.serverTime).getTime() <= Date.now());
      assert.equal(res.body.revision, (await getCat(ctx.base, cid)).revision);
      capture('public-snapshot-roundrobin-running', res.body);
    });

    it('a regra da foto acompanha a data de nascimento (aluno que virou adulto), URL perigosa, autorização e anonimização', async () => {
      const token = ctx.tournament.publicToken;
      const prevTtl = process.env.TOURNAMENT_SNAPSHOT_TTL_MS;
      process.env.TOURNAMENT_SNAPSHOT_TTL_MS = '0'; // sem memoizacao: dado EXTERNO (nascimento) muda sem mutacao
      try {
        const studentId = (await getCat(ctx.base, cid)).competitors.find((c: any) => c.id === comp.minor).studentId;
        const adultSince = new Date(Date.now() - 19 * 366 * DAY);
        await prisma.student.update({ where: { id: studentId }, data: { birthDate: adultSince } });
        let body = (await pub(token).expect(200)).body;
        assert.equal(body.categories[0].competitors.find((c: any) => c.id === comp.minor).photoUrl, PHOTO(1), 'virou adulto = foto aparece');
        await prisma.student.update({ where: { id: studentId }, data: { birthDate: new Date(`${SENT.birthMinor}T00:00:00.000Z`) } });
        body = (await pub(token).expect(200)).body;
        assert.equal(body.categories[0].competitors.find((c: any) => c.id === comp.minor).photoUrl, null);
        // Student.photo trocada por URL perigosa = nunca publica (reavaliada na leitura)
        await prisma.student.update({ where: { id: studentId }, data: { birthDate: adultSince, photo: 'javascript:alert(1)' } });
        const evil = await pub(token).expect(200);
        assert.equal(evil.body.categories[0].competitors.find((c: any) => c.id === comp.minor).photoUrl, null);
        assert.ok(!evil.text.includes('javascript:'));
        await prisma.student.update({ where: { id: studentId }, data: { birthDate: new Date(`${SENT.birthMinor}T00:00:00.000Z`), photo: PHOTO(1) } });
        // menor autorizado perde a autorizacao = foto some
        await as('mestre').patch(`${ctx.base}/competitors/${comp.minorAuth}`, { photoAuthorized: false }).expect(200);
        body = (await pub(token).expect(200)).body;
        assert.equal(body.categories[0].competitors.find((c: any) => c.id === comp.minorAuth).photoUrl, null);
        await as('mestre').patch(`${ctx.base}/competitors/${comp.minorAuth}`, { photoAuthorized: true }).expect(200);
        body = (await pub(token).expect(200)).body;
        assert.equal(body.categories[0].competitors.find((c: any) => c.id === comp.minorAuth).photoUrl, PHOTO(4));
        // aluno anonimizado: nome e foto somem do publico
        const anon = await prisma.student.create({ data: { organizationId: orgA, name: 'Fulana de Tal Anonimizada', status: 'ACTIVE', photo: PHOTO(9), birthDate: new Date(adultSince) } });
        const cat2 = await mkCategory(ctx.base, { name: 'Anonimo', format: 'ROUND_ROBIN' });
        await as('mestre').post(`${ctx.base}/categories/${cat2.id}/competitors`, { studentId: anon.id }).expect(201);
        await prisma.student.update({ where: { id: anon.id }, data: { anonymizedAt: new Date(), name: 'Pessoa removida' } });
        const anonBody = await pub(token).expect(200);
        assert.ok(!anonBody.text.includes('Fulana de Tal Anonimizada') && !anonBody.text.includes(PHOTO(9)));
        assert.ok(anonBody.text.includes('Atleta removido'));
        await as('mestre').del(`${ctx.base}/categories/${cat2.id}`).expect(200);
      } finally {
        process.env.TOURNAMENT_SNAPSHOT_TTL_MS = prevTtl;
      }
    });

    it('404 UNIFORME: token inexistente/mal formado, desligado, evento rascunho/cancelado/antigo — mesmo status e mesmo corpo', async () => {
      const prevTtl = process.env.TOURNAMENT_SNAPSHOT_TTL_MS;
      process.env.TOURNAMENT_SNAPSHOT_TTL_MS = '0';
      process.env.TOURNAMENT_NEGATIVE_TTL_MS = '0'; // mudancas diretas no banco (evento) valem na hora neste teste
      try {
        const bodies: string[] = [];
        const check = async (token: string) => {
          const res = await pub(token);
          assert.equal(res.status, 404, token);
          bodies.push(res.text);
          assert.equal(res.headers['x-robots-tag'], 'noindex');
        };
        await check('A'.repeat(32)); // inexistente
        await check('curto');
        await check('x'.repeat(200));
        await check('%00%00');
        // desligado
        const off = await newTournament();
        await check(off.tournament.publicToken);
        // ligado, mas com o evento em cada estado "indisponivel"
        const ev = await newTournament();
        await as('mestre').patch(ev.base, { publicEnabled: true }).expect(200);
        await pub(ev.tournament.publicToken).expect(200);
        for (const over of [{ status: 'DRAFT' }, { status: 'CANCELLED' }, { status: 'PUBLISHED', date: new Date(Date.now() - 31 * DAY) }]) {
          await prisma.event.update({ where: { id: ev.eventId }, data: over as object });
          await check(ev.tournament.publicToken);
        }
        // dentro da janela de 30 dias volta (29 dias) e CLOSED tambem vale
        await prisma.event.update({ where: { id: ev.eventId }, data: { status: 'CLOSED', date: new Date(Date.now() - 29 * DAY) } });
        await pub(ev.tournament.publicToken).expect(200);
        assert.equal(new Set(bodies).size, 1, `corpos diferentes: ${[...new Set(bodies)].join(' | ')}`);
        assert.deepEqual(JSON.parse(bodies[0]), { statusCode: 404, message: 'Campeonato não encontrado.', code: 'TOURNAMENT_NOT_FOUND' });
        // o stream tambem: 404 identico, sem abrir SSE
        for (const t of ['A'.repeat(32), off.tournament.publicToken]) {
          const s = await openSse(t);
          assert.equal(s.status, 404);
          await s.closed;
          assert.equal(s.body, bodies[0]);
          assert.ok(!String(s.headers['content-type']).includes('event-stream'));
        }
      } finally {
        process.env.TOURNAMENT_SNAPSHOT_TTL_MS = prevTtl;
        delete process.env.TOURNAMENT_NEGATIVE_TTL_MS;
      }
    });

    it('cache negativo: 404 repetido não vai ao banco; ligar o telão / rotacionar vale na hora (sem esperar o TTL)', async () => {
      process.env.TOURNAMENT_NEGATIVE_TTL_MS = '60000';
      const svc = publicService as unknown as { build: (...a: unknown[]) => Promise<unknown> };
      const original = svc.build.bind(publicService);
      let builds = 0;
      svc.build = (...args: unknown[]) => { builds++; return original(...args); };
      try {
        const t = await newTournament();
        const unknown = 'N'.repeat(32);
        const bodies: string[] = [];
        for (let i = 0; i < 5; i++) bodies.push((await pub(t.tournament.publicToken).expect(404)).text);
        for (let i = 0; i < 5; i++) bodies.push((await pub(unknown).expect(404)).text);
        assert.equal(builds, 2, '1 leitura por token ruim (desligado e inexistente); o resto vem do cache negativo');
        assert.equal(new Set(bodies).size, 1, 'corpo identico com e sem cache');
        assert.equal((await openSse(t.tournament.publicToken)).status, 404);
        // ligar o telao: visivel NA HORA
        await as('mestre').patch(t.base, { publicEnabled: true }).expect(200);
        await pub(t.tournament.publicToken).expect(200);
        // desligar: some na hora, e volta a ligar
        await as('mestre').patch(t.base, { publicEnabled: false }).expect(200);
        await pub(t.tournament.publicToken).expect(404);
        await as('mestre').patch(t.base, { publicEnabled: true }).expect(200);
        await pub(t.tournament.publicToken).expect(200);
        // rotacionar: o antigo continua 404 e o novo abre na hora
        const old = t.tournament.publicToken;
        const rotated = (await as('mestre').post(`${t.base}/rotate-token`).expect(200)).body;
        await pub(old).expect(404);
        await pub(rotated.publicToken).expect(200);
      } finally {
        svc.build = original;
        delete process.env.TOURNAMENT_NEGATIVE_TTL_MS;
      }
    });

    it('ETag/304: igual = 304 sem corpo; depois de uma mutação, 200 com ETag novo', async () => {
      const token = ctx.tournament.publicToken;
      const first = await pub(token).expect(200);
      const etag = first.headers.etag;
      const notModified = await pub(token).set('If-None-Match', etag).expect(304);
      assert.equal(notModified.text, '');
      assert.equal(notModified.headers.etag, etag);
      await pub(token).set('If-None-Match', `W/${etag}`).expect(304);
      await pub(token).set('If-None-Match', `"nada", ${etag}`).expect(304);
      await pub(token).set('If-None-Match', '*').expect(304);
      assert.equal((await pub(token).set('If-None-Match', '"0-0000000000"')).status, 200);
      const cur = await getCat(ctx.base, cid);
      const next = cur.matches.find((m: any) => m.status === 'READY');
      await as('mestre').post(`${ctx.base}/matches/${next.id}/result`, { winnerId: next.slotAId }).expect(200);
      const after = await pub(token).set('If-None-Match', etag).expect(200);
      assert.notEqual(after.headers.etag, etag);
      assert.equal(after.body.revision, cur.revision + 1);
      assert.match(after.headers.etag, new RegExp(`^"${cur.revision + 1}-`));
      await pub(token).set('If-None-Match', after.headers.etag).expect(304);
    });

    it('memoização: 40 leituras simultâneas = 1 montagem; após mutação nunca serve snapshot velho', async () => {
      const token = ctx.tournament.publicToken;
      const svc = publicService as unknown as { build: (...a: unknown[]) => Promise<unknown> };
      const original = svc.build.bind(publicService);
      let builds = 0;
      svc.build = (...args: unknown[]) => { builds++; return original(...args); };
      try {
        publicService.invalidate(ctx.tournament.id);
        const all = await Promise.all(Array.from({ length: 40 }, () => pub(token)));
        assert.ok(all.every((r) => r.status === 200));
        assert.equal(builds, 1, 'single-flight + cache');
        assert.equal(new Set(all.map((r) => r.headers.etag)).size, 1);
        await pub(token).expect(200);
        assert.equal(builds, 1, 'segunda rodada vem do cache');
        const cur = await getCat(ctx.base, cid);
        const next = cur.matches.find((m: any) => m.status === 'READY');
        // leituras concorrentes com a mutacao: depois dela, TODA leitura ja ve a revisao nova
        const readers = Promise.all(Array.from({ length: 10 }, () => pub(token)));
        await as('mestre').post(`${ctx.base}/matches/${next.id}/result`, { winnerId: next.slotAId }).expect(200);
        await readers;
        for (let i = 0; i < 5; i++) {
          const r = await pub(token).expect(200);
          assert.equal(r.body.revision, cur.revision + 1, 'nunca o snapshot velho depois da mutacao');
        }
      } finally {
        svc.build = original;
      }
    });

    it('log de requisição: sem token, sem IP/usuário, sem sentinela, sem foto de menor', async () => {
      const token = ctx.tournament.publicToken;
      const lines: string[] = [];
      const originalWrite = process.stdout.write.bind(process.stdout);
      const prevLog = process.env.REQUEST_LOG;
      process.env.REQUEST_LOG = 'true';
      (process.stdout as unknown as { write: (c: unknown) => boolean }).write = (chunk: unknown) => {
        const text = String(chunk);
        // So captura as linhas do log de requisicao; o resto (relatorio do runner de testes) segue para o stdout de verdade.
        if (text.includes('"msg":"http_request"')) {
          lines.push(text);
          return true;
        }
        return originalWrite(chunk as string);
      };
      try {
        await pub(token).expect(200);
        await pub('Z'.repeat(32)).expect(404);
        await as('mestre').get(`${ctx.base}/categories/${cid}`).expect(200);
      } finally {
        (process.stdout as unknown as { write: unknown }).write = originalWrite;
        process.env.REQUEST_LOG = prevLog;
      }
      const all = lines.join('');
      const mine = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const publicLines = mine.filter((l: any) => String(l.route).startsWith('/api/public/tournaments'));
      assert.equal(publicLines.length, 2, all);
      for (const l of publicLines) {
        assert.equal(l.route, '/api/public/tournaments/:token');
        assert.equal(l.userId, null);
        assert.equal(l.ip, null);
      }
      assert.ok(!all.includes(token) && !all.includes('Z'.repeat(32)), 'token no log');
      for (const s of [SENT.cpf, SENT.email, SENT.phone, SENT.note, PHOTO(1), 'Menor Sem Autorizacao']) assert.ok(!all.includes(s), `vazou no log: ${s}`);
    });

    it('SSE por HTTP real: primeiro snapshot na hora, mutação gera o seguinte, privacidade no stream, ping e limpeza do ouvinte', async () => {
      const token = ctx.tournament.publicToken;
      const prevPing = process.env.TOURNAMENT_SSE_PING_MS;
      process.env.TOURNAMENT_SSE_PING_MS = '300';
      try {
        assert.equal(hub.listenerCount(ctx.tournament.id), 0);
        const sse = await openSse(token);
        assert.equal(sse.status, 200);
        assert.match(String(sse.headers['content-type']), /^text\/event-stream/);
        assert.equal(sse.headers['cache-control'], 'no-cache, no-transform');
        assert.equal(sse.headers['x-accel-buffering'], 'no');
        assert.equal(sse.headers['connection'], 'keep-alive');
        assert.equal(sse.headers['x-robots-tag'], 'noindex');
        await sse.waitFor((ev) => ev.some((e) => e.event === 'snapshot'));
        const snap1 = sse.events.find((e) => e.event === 'snapshot')!;
        const body1 = JSON.parse(snap1.data);
        assert.equal(snap1.id, String(body1.revision), 'id = revisao');
        assertShape(body1);
        assertPrivate(snap1.data, body1);
        assert.equal(hub.listenerCount(ctx.tournament.id), 1);
        capture('sse-event-snapshot-raw', { event: snap1.event, id: snap1.id, data: snap1.data });

        const cur = await getCat(ctx.base, cid);
        const next = cur.matches.find((m: any) => m.status === 'READY');
        await as('mestre').post(`${ctx.base}/matches/${next.id}/result`, { winnerId: next.slotAId }).expect(200);
        await sse.waitFor((ev) => ev.filter((e) => e.event === 'snapshot').length >= 2);
        const snap2 = sse.events.filter((e) => e.event === 'snapshot')[1];
        const body2 = JSON.parse(snap2.data);
        assert.equal(body2.revision, body1.revision + 1);
        assertPrivate(snap2.data, body2);
        assert.equal(body2.categories[0].matches.find((m: any) => m.id === next.id).status, 'FINISHED');
        // mutacao que NAO muda nada nao gera snapshot; falha nao notifica
        const count = sse.events.length;
        await as('mestre').post(`${ctx.base}/matches/${next.id}/result`, { winnerId: next.slotAId }).expect(200);
        await as('mestre').post(`${ctx.base}/matches/${next.id}/result`, { winnerId: next.slotBId }).expect(409);
        await sleep(250);
        assert.equal(sse.events.length, count, 'idempotente/falha: nada novo no stream');
        await sse.waitFor((_e, c) => c.some((l) => l.startsWith(': ping')));
        // desconectar libera o ouvinte
        sse.close();
        await sse.closed;
        for (let i = 0; i < 40 && hub.listenerCount(ctx.tournament.id) > 0; i++) await sleep(50);
        assert.equal(hub.listenerCount(ctx.tournament.id), 0, 'hub liberou o ouvinte');
        assert.equal(hub.totalListeners(), 0);
      } finally {
        process.env.TOURNAMENT_SSE_PING_MS = prevPing;
      }
    });

    it('hub só é notificado DEPOIS do commit e nunca quando a transação falha', async () => {
      let changes = 0;
      const off = hub.subscribe(ctx.tournament.id, { onChange: () => void changes++, onClose: () => undefined })!;
      try {
        const cur = await getCat(ctx.base, cid);
        const finished = cur.matches.find((m: any) => m.status === 'FINISHED');
        await as('mestre').post(`${ctx.base}/matches/${finished.id}/result`, { winnerId: finished.slotBId }).expect(409);
        await as('mestre').patch(`${ctx.base}/competitors/${comp.minor}`, { seed: 5000 }).expect(400);
        await as('mestre').post(`${ctx.base}/categories/${cid}/competitors`, { guest: { displayName: 'Tardio' } }).expect(409);
        assert.equal(changes, 0, 'falhas nao notificam');
        await as('mestre').patch(`${ctx.base}/competitors/${comp.guestUnknown}`, { graduationLabel: 'Verde' }).expect(200);
        assert.equal(changes, 1, 'um sucesso = uma notificacao');
        await as('mestre').patch(`${ctx.base}/competitors/${comp.guestUnknown}`, { graduationLabel: 'Verde' }).expect(200);
        assert.equal(changes, 1, 'sem mudanca = sem notificacao');
      } finally {
        off();
      }
    });

    it('limite de conexões por torneio: a excedente recebe 503 TOO_MANY_VIEWERS e as abertas continuam', async () => {
      const token = ctx.tournament.publicToken;
      const prev = process.env.TOURNAMENT_MAX_VIEWERS;
      process.env.TOURNAMENT_MAX_VIEWERS = '2';
      const clients: SseClient[] = [];
      try {
        clients.push(await openSse(token), await openSse(token));
        for (const c of clients) {
          assert.equal(c.status, 200);
          await c.waitFor((ev) => ev.length >= 1);
        }
        const third = await openSse(token);
        assert.equal(third.status, 503);
        await third.closed;
        assert.deepEqual(JSON.parse(third.body), { statusCode: 503, message: 'Muitas pessoas assistindo agora. Tente de novo em instantes.', code: 'TOO_MANY_VIEWERS' });
        assert.equal(hub.listenerCount(ctx.tournament.id), 2);
        clients[0].close();
        await clients[0].closed;
        for (let i = 0; i < 40 && hub.listenerCount(ctx.tournament.id) > 1; i++) await sleep(50);
        const again = await openSse(token);
        assert.equal(again.status, 200);
        clients.push(again);
      } finally {
        process.env.TOURNAMENT_MAX_VIEWERS = prev;
        clients.forEach((c) => c.close());
        for (let i = 0; i < 40 && hub.listenerCount(ctx.tournament.id) > 0; i++) await sleep(50);
      }
      assert.equal(hub.listenerCount(ctx.tournament.id), 0);
    });

    it('SSE: dado EXTERNO muda sem mutação (aluno vira adulto) e o stream manda o snapshot novo no próximo tick; teto de duração fecha com "closed"', async () => {
      const token = ctx.tournament.publicToken;
      const prev = { ttl: process.env.TOURNAMENT_SNAPSHOT_TTL_MS, ping: process.env.TOURNAMENT_SSE_PING_MS, max: process.env.TOURNAMENT_SSE_MAX_MS };
      process.env.TOURNAMENT_SNAPSHOT_TTL_MS = '0';
      process.env.TOURNAMENT_SSE_PING_MS = '150';
      const studentId = (await getCat(ctx.base, cid)).competitors.find((c: any) => c.id === comp.minor).studentId;
      try {
        const sse = await openSse(token);
        await sse.waitFor((ev) => ev.some((e) => e.event === 'snapshot'));
        const first = JSON.parse(sse.events.find((e) => e.event === 'snapshot')!.data);
        assert.equal(first.categories[0].competitors.find((c: any) => c.id === comp.minor).photoUrl, null);
        await prisma.student.update({ where: { id: studentId }, data: { birthDate: new Date(Date.now() - 20 * 366 * DAY) } });
        await sse.waitFor((ev) => ev.filter((e) => e.event === 'snapshot').length >= 2);
        const second = JSON.parse(sse.events.filter((e) => e.event === 'snapshot')[1].data);
        assert.equal(second.revision, first.revision, 'nenhuma mutacao: mesma revisao, conteudo novo');
        assert.equal(second.categories[0].competitors.find((c: any) => c.id === comp.minor).photoUrl, PHOTO(1));
        await prisma.student.update({ where: { id: studentId }, data: { birthDate: new Date(`${SENT.birthMinor}T00:00:00.000Z`) } });
        await sse.waitFor((ev) => ev.filter((e) => e.event === 'snapshot').length >= 3);
        const third = JSON.parse(sse.events.filter((e) => e.event === 'snapshot')[2].data);
        assert.equal(third.categories[0].competitors.find((c: any) => c.id === comp.minor).photoUrl, null, 'voltou a ser menor: a foto some do stream');
        sse.close();
        await sse.closed;
        // teto de duracao
        process.env.TOURNAMENT_SSE_MAX_MS = '400';
        const capped = await openSse(token);
        await capped.waitFor((ev) => ev.some((e) => e.event === 'closed'), 4000);
        assert.deepEqual(JSON.parse(capped.events.find((e) => e.event === 'closed')!.data), { reason: 'max-duration' });
        await capped.closed;
      } finally {
        await prisma.student.update({ where: { id: studentId }, data: { birthDate: new Date(`${SENT.birthMinor}T00:00:00.000Z`) } });
        process.env.TOURNAMENT_SNAPSHOT_TTL_MS = prev.ttl;
        process.env.TOURNAMENT_SSE_PING_MS = prev.ping;
        if (prev.max === undefined) delete process.env.TOURNAMENT_SSE_MAX_MS;
        else process.env.TOURNAMENT_SSE_MAX_MS = prev.max;
      }
      for (let i = 0; i < 40 && hub.listenerCount(ctx.tournament.id) > 0; i++) await sleep(50);
      assert.equal(hub.listenerCount(ctx.tournament.id), 0);
    });

    it('token rotacionado: o antigo morre na hora (GET 404, stream recebe "closed"), o novo funciona; desligar também fecha', async () => {
      const oldToken = ctx.tournament.publicToken;
      const sse = await openSse(oldToken);
      await sse.waitFor((ev) => ev.some((e) => e.event === 'snapshot'));
      const rotated = (await as('mestre').post(`${ctx.base}/rotate-token`).expect(200)).body;
      capture('operator-rotate-token', rotated);
      assert.notEqual(rotated.publicToken, oldToken);
      assert.ok(rotated.publicToken.length >= 24);
      await sse.waitFor((ev) => ev.some((e) => e.event === 'closed'));
      assert.deepEqual(JSON.parse(sse.events.find((e) => e.event === 'closed')!.data), { reason: 'token-rotated' });
      await sse.closed;
      assert.equal((await pub(oldToken).expect(404)).body.code, 'TOURNAMENT_NOT_FOUND');
      assert.equal((await openSse(oldToken)).status, 404);
      const fresh = await pub(rotated.publicToken).expect(200);
      assertShape(fresh.body);
      ctx.tournament.publicToken = rotated.publicToken;
      // desligar o telao fecha os streams abertos
      const sse2 = await openSse(rotated.publicToken);
      await sse2.waitFor((ev) => ev.some((e) => e.event === 'snapshot'));
      await as('mestre').patch(ctx.base, { publicEnabled: false }).expect(200);
      await sse2.waitFor((ev) => ev.some((e) => e.event === 'closed'));
      assert.deepEqual(JSON.parse(sse2.events.find((e) => e.event === 'closed')!.data), { reason: 'disabled' });
      await pub(rotated.publicToken).expect(404);
      for (let i = 0; i < 40 && hub.listenerCount(ctx.tournament.id) > 0; i++) await sleep(50);
      assert.equal(hub.listenerCount(ctx.tournament.id), 0);
      await as('mestre').patch(ctx.base, { publicEnabled: true }).expect(200);
      const logs = JSON.stringify(await prisma.auditLog.findMany({ where: { organizationId: orgA, action: 'TOURNAMENT_TOKEN_ROTATE' } }));
      assert.ok(!logs.includes(rotated.publicToken) && !logs.includes(oldToken));
    });

    it('limite de requisições do telão: 429 acima do TOURNAMENT_PUBLIC_THROTTLE_LIMIT (lido a cada pedido)', async () => {
      const token = ctx.tournament.publicToken;
      const prev = process.env.TOURNAMENT_PUBLIC_THROTTLE_LIMIT;
      process.env.TOURNAMENT_PUBLIC_THROTTLE_LIMIT = '3';
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 8; i++) statuses.push((await pub(token)).status);
        assert.ok(statuses.includes(429), statuses.join());
      } finally {
        process.env.TOURNAMENT_PUBLIC_THROTTLE_LIMIT = prev;
      }
      assert.ok(PublicTournamentsController);
    });
  });
});
