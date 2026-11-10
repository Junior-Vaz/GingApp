import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { TournamentLiveHub } from '../src/interface/http/tournaments/tournament-live-hub';
import { TournamentPublicService } from '../src/interface/http/tournaments/tournament-public.service';
import { createTestApp } from './utils/test-app';

/**
 * Revisao ADVERSARIAL do chaveamento (reproducoes). Teste que FALHA aqui = defeito confirmado.
 * Banco de dev; tudo o que e criado e apagado no `after`.
 */
const TAG = '[e2e-tourn-adv]';
const PASSWORD = 'Dev@12345';
const DAY = 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Chaveamento: revisao adversarial (e2e)', () => {
  let app: INestApplication;
  let port = 0;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const envBackup = { ...process.env };
  const orgIds: number[] = [];
  const userIds: number[] = [];
  const eventIds: number[] = [];
  let orgA = 0;
  let token = '';
  let hub: TournamentLiveHub;
  let publicService: TournamentPublicService;

  const server = () => app.getHttpServer();
  const as = {
    get: (p: string) => request(server()).get(`/api${p}`).set({ Authorization: `Bearer ${token}` }),
    post: (p: string, body?: object) => request(server()).post(`/api${p}`).set({ Authorization: `Bearer ${token}` }).send(body ?? {}),
    patch: (p: string, body: object) => request(server()).patch(`/api${p}`).set({ Authorization: `Bearer ${token}` }).send(body),
  };

  const newTournament = async () => {
    const event = await prisma.event.create({
      data: { organizationId: orgA, title: `${TAG} ${stamp}`, type: 'CAMPEONATO', date: new Date(Date.now() + DAY), status: 'PUBLISHED' },
    });
    eventIds.push(event.id);
    const t = (await as.post(`/events/${event.id}/tournament`).expect(201)).body;
    return { base: `/events/${event.id}/tournament`, id: t.id as number, publicToken: t.publicToken as string };
  };
  const mkCat = async (base: string, body: Record<string, unknown>) =>
    (await as.post(`${base}/categories`, { name: `Cat ${Math.random().toString(36).slice(2, 8)}`, ...body }).expect(201)).body;
  const addGuests = async (base: string, cid: number, n: number) => {
    let cat: any;
    for (let i = 1; i <= n; i++) {
      cat = (await as.post(`${base}/categories/${cid}/competitors`, { guest: { displayName: `Atleta ${i}`, ageGroup: 'ADULT' } }).expect(201)).body;
    }
    return cat;
  };

  before(async () => {
    process.env.TOURNAMENT_SNAPSHOT_TTL_MS = '60000';
    app = await createTestApp({ disableThrottle: true });
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;
    hub = app.get(TournamentLiveHub);
    publicService = app.get(TournamentPublicService);
    const org = await prisma.organization.create({
      data: { name: `${TAG} Grupo ${stamp}`, slug: `e2e-tourn-adv-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
    });
    orgIds.push(org.id);
    orgA = org.id;
    const email = `mestre-${stamp}@e2e-tourn-adv.local`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(PASSWORD, 4), name: `${TAG} mestre`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    userIds.push(user.id);
    await prisma.organizationUser.create({ data: { organizationId: orgA, userId: user.id, role: OrgRole.MESTRE, status: 'ACTIVE' } });
    token = (await request(server()).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken;
  });

  after(async () => {
    process.env = { ...envBackup };
    await app.close();
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: orgIds } }, { userId: { in: userIds } }] } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------------------------------------------
  it('SSE: cliente que desconecta ANTES do stream abrir (durante a leitura do snapshot) nao pode deixar ouvinte no hub', async () => {
    const t = await newTournament();
    await as.patch(t.base, { publicEnabled: true }).expect(200);
    const prevMax = process.env.TOURNAMENT_SSE_MAX_MS;
    process.env.TOURNAMENT_SSE_MAX_MS = String(6 * 3_600_000);
    try {
      await request(server()).get(`/api/public/tournaments/${t.publicToken}`).expect(200); // cache quente
      for (let i = 0; i < 30; i++) {
        if (i >= 15) publicService.invalidate(t.id); // 15 com cache quente, 15 forcando a ida ao banco
        await new Promise<void>((resolve) => {
          const sock = net.connect(port, '127.0.0.1', () => {
            sock.write(`GET /api/public/tournaments/${t.publicToken}/stream HTTP/1.1\r\nHost: x\r\nAccept: text/event-stream\r\n\r\n`, () => {
              sock.destroy();
              resolve();
            });
          });
          sock.on('error', () => resolve());
        });
      }
      await sleep(1500);
      const leaked = hub.listenerCount(t.id);
      assert.equal(leaked, 0, `${leaked} ouvinte(s) presos no hub depois de 30 clientes que ja foram embora (contam no limite de 300 por ate 6 h)`);
    } finally {
      hub.closeAll(t.id, 'shutdown'); // limpa os vazados
      if (prevMax === undefined) delete process.env.TOURNAMENT_SSE_MAX_MS;
      else process.env.TOURNAMENT_SSE_MAX_MS = prevMax;
    }
  });

  // ---------------------------------------------------------------------------------------------------------------
  it('banco: FKs de TournamentMatch que recebem ON DELETE SET NULL tem indice (senao cada exclusao varre a tabela inteira)', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`SELECT indexdef FROM pg_indexes WHERE tablename = 'TournamentMatch'`;
    const defs = rows.map((r) => r.indexdef).join('\n');
    const missing = ['nextMatchId', 'loserNextMatchId', 'slotAId', 'slotBId', 'winnerId'].filter((col) => !new RegExp(`\\(\\s*"${col}"`).test(defs));
    assert.deepEqual(missing, [], `colunas FK sem indice inicial: ${missing.join(', ')}`);
  });

  // ---------------------------------------------------------------------------------------------------------------
  it('banco: luta nao pode ter vencedor fora dos dois lados (CHECK; a parte de atleta de OUTRA categoria e risco aceito)', async () => {
    const t = await newTournament();
    const c1 = await mkCat(t.base, { format: 'SINGLE_ELIMINATION' });
    const c2 = await mkCat(t.base, { format: 'SINGLE_ELIMINATION' });
    const cat1 = await addGuests(t.base, c1.id, 2);
    const cat2 = await addGuests(t.base, c2.id, 2);
    const g1 = (await as.post(`${t.base}/categories/${c1.id}/generate`, { seeding: 'RANDOM' }).expect(200)).body;
    const m = g1.matches[0];
    const foreign = cat2.competitors[0].id;
    const accepted: string[] = [];
    // RISCO ACEITO (decisao do dono): o banco NAO impede um slot apontar para atleta de OUTRA categoria (exigiria FK composta);
    // a API valida isso. Defesa em profundidade fica para depois. So o vencedor-fora-dos-slots e imposto por CHECK.
    try {
      await prisma.$executeRawUnsafe(`UPDATE "TournamentMatch" SET "winnerId" = $1, "status" = 'FINISHED' WHERE id = $2`, foreign, m.id);
      accepted.push('winnerId fora dos slots');
    } catch { /* rejeitado: ok */ }
    assert.deepEqual(accepted, [], `o banco aceitou: ${accepted.join('; ')}`);
  });

  // ---------------------------------------------------------------------------------------------------------------
  it('resultado numa FOLGA com o proprio vencedor da folga = 409 (contrato: resultado em folga e recusado)', async () => {
    const t = await newTournament();
    const c = await mkCat(t.base, { format: 'SINGLE_ELIMINATION' });
    await addGuests(t.base, c.id, 3);
    const cat = (await as.post(`${t.base}/categories/${c.id}/generate`, { seeding: 'RANDOM' }).expect(200)).body;
    const bye = cat.matches.find((x: any) => x.isBye);
    const before = (await as.get(t.base).expect(200)).body.revision;
    const res = await as.post(`${t.base}/matches/${bye.id}/result`, { winnerId: bye.winnerId });
    const afterRev = (await as.get(t.base).expect(200)).body.revision;
    assert.equal(afterRev, before);
    assert.equal(res.status, 409, `folga aceitou "resultado" com status ${res.status}`);
  });
});
