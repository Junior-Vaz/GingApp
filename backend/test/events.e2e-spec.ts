import { INestApplication } from '@nestjs/common';
import { PrismaClient, StudentStatus } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { ALUNO_EMAIL as ALUNO, MESTRE_EMAIL as MESTRE, SecondOrg, createSecondOrg, loginAs } from './utils/list-helpers';

/**
 * Eventos + participantes (src/interface/http/events/events.service.ts e
 * events.controller.ts). Foco especial na autorização de `addParticipant`/`removeParticipant`,
 * CORRIGIDA na Fase 10.9 (PLANO_PROJETO.md §10.9): a rota `POST .../participants` usava
 * `@CanAccess('events','create')`, o que bloqueava qualquer ALUNO comum de se autoinscrever
 * (só MESTRE/PROFESSOR têm essa permissão na matriz) — "Quero participar" nunca funcionava.
 * A correção removeu o `@CanAccess` dessas duas rotas e moveu a autorização fina para dentro
 * do `EventsService` (`isOrgAdmin` + `StudentsService.findMine`). Este spec prova que o
 * comportamento corrigido continua de pé: ALUNO consegue se autoinscrever (201, não 403), mas
 * não consegue inscrever/remover outro aluno que não seja "seu".
 *
 * Reaproveita os usuários do seed (mestre/aluno, prisma/seed.ts) e cria só o que é exclusivo
 * deste teste: o Event e um segundo Student sem vínculo com o usuário ALUNO (para provar o
 * caminho de "não é seu").
 */
const DEV_PASSWORD = 'Dev@12345';
const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';

interface LoginResult {
  accessToken: string;
  user: { id: number; organizationId: number };
}

async function login(app: INestApplication, email: string): Promise<LoginResult> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: DEV_PASSWORD })
    .expect(200);
  return res.body as LoginResult;
}

describe('Eventos e participantes (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let mestreToken: string;
  let alunoToken: string;
  let organizationId: number;
  let alunoUserId: number;

  let eventId: number;
  let anaStudentId: number;
  let anaParticipantId: number;
  let secondStudentId: number;
  let secondParticipantId: number;

  // Título único (com timestamp) para nunca colidir com dados de outras suítes/execuções
  // rodando contra o mesmo Postgres compartilhado, e para permitir limpeza robusta no after().
  const EVENT_TITLE = `[e2e-test] Evento participantes ${Date.now()}`;

  before(async () => {
    app = await createTestApp();

    const mestreLogin = await login(app, MESTRE_EMAIL);
    mestreToken = mestreLogin.accessToken;
    organizationId = mestreLogin.user.organizationId;

    const alunoLogin = await login(app, ALUNO_EMAIL);
    alunoToken = alunoLogin.accessToken;
    alunoUserId = alunoLogin.user.id;

    // Aluno do seed (Ana), vinculado ao usuário ALUNO — usado no caminho de autoinscrição.
    const anaStudent = await prisma.student.findFirstOrThrow({
      where: { organizationId, userId: alunoUserId },
    });
    anaStudentId = anaStudent.id;

    // Segundo aluno, criado direto via Prisma, SEM vínculo com nenhum usuário — usado para
    // provar que ALUNO não pode inscrever/remover quem não é "seu".
    const secondStudent = await prisma.student.create({
      data: {
        organizationId,
        name: '[e2e-test] Aluno sem vínculo de usuário',
        status: StudentStatus.ACTIVE,
      },
    });
    secondStudentId = secondStudent.id;
  });

  after(async () => {
    // Rede de segurança: o fluxo normal do teste já remove o evento (cascata) e a inscrição
    // da Ana, mas isto cobre a hipótese de uma falha no meio do caminho deixar sobras.
    await prisma.eventParticipant.deleteMany({ where: { event: { title: EVENT_TITLE } } });
    await prisma.event.deleteMany({ where: { title: EVENT_TITLE } });
    await prisma.student.deleteMany({ where: { id: secondStudentId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('POST /events (mestre) cria um evento — confirmado via Prisma', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/events')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({
        title: EVENT_TITLE,
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        location: 'Ginásio da Matriz',
      })
      .expect(201);

    eventId = res.body.id;
    assert.equal(typeof eventId, 'number');

    const persisted = await prisma.event.findUnique({ where: { id: eventId } });
    assert.ok(persisted !== null);
    assert.equal(persisted?.title, EVENT_TITLE);
    assert.equal(persisted?.organizationId, organizationId);
  });

  it('POST /events/:id/participants como ALUNO com o próprio studentId → 201 (bug da Fase 10.9 continua corrigido, não deve dar 403)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/events/${eventId}/participants`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .send({ studentId: anaStudentId })
      .expect(201);

    anaParticipantId = res.body.id;
    assert.equal(res.body.studentId, anaStudentId);

    const persisted = await prisma.eventParticipant.findUnique({ where: { id: anaParticipantId } });
    assert.ok(persisted !== null);
    assert.equal(persisted?.studentId, anaStudentId);
    assert.equal(persisted?.eventId, eventId);
  });

  it('POST /events/:id/participants como ALUNO tentando inscrever OUTRO aluno (sem vínculo) → 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/events/${eventId}/participants`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .send({ studentId: secondStudentId })
      .expect(403);

    assert.equal(res.body.message, 'Você só pode inscrever a si mesmo ou seus dependentes.');

    const persisted = await prisma.eventParticipant.findFirst({
      where: { eventId, studentId: secondStudentId },
    });
    assert.equal(persisted, null);
  });

  it('POST /events/:id/participants como MESTRE inscrevendo o mesmo segundo aluno → 201 (admin pode inscrever qualquer um)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/events/${eventId}/participants`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ studentId: secondStudentId })
      .expect(201);

    secondParticipantId = res.body.id;

    const persisted = await prisma.eventParticipant.findUnique({ where: { id: secondParticipantId } });
    assert.ok(persisted !== null);
    assert.equal(persisted?.studentId, secondStudentId);
  });

  it('PATCH .../participants/:id/check-in como ALUNO → 403 (só MESTRE/PROFESSOR confirma presença)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/events/${eventId}/participants/${secondParticipantId}/check-in`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(403);

    assert.equal(res.body.message, 'Só MESTRE/PROFESSOR pode confirmar presença.');

    const stillConfirmed = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: secondParticipantId } });
    assert.equal(stillConfirmed.status, 'CONFIRMED');
  });

  it('PATCH .../participants/:id/check-in como MESTRE → 200, status vira ATTENDED, confirmado via Prisma', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/events/${eventId}/participants/${secondParticipantId}/check-in`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    assert.equal(res.body.status, 'ATTENDED');

    const persisted = await prisma.eventParticipant.findUniqueOrThrow({ where: { id: secondParticipantId } });
    assert.equal(persisted.status, 'ATTENDED');
  });

  it('DELETE .../participants/:id como ALUNO tentando remover inscrição que não é dela (a do segundo aluno, feita pelo MESTRE) → 403', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/events/${eventId}/participants/${secondParticipantId}`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(403);

    assert.equal(res.body.message, 'Você só pode cancelar a própria inscrição.');

    const stillThere = await prisma.eventParticipant.findUnique({ where: { id: secondParticipantId } });
    assert.ok(stillThere !== null);
  });

  it('DELETE .../participants/:id como ALUNO removendo a PRÓPRIA inscrição → 200, confirmado via Prisma', async () => {
    await request(app.getHttpServer())
      .delete(`/api/events/${eventId}/participants/${anaParticipantId}`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);

    const gone = await prisma.eventParticipant.findUnique({ where: { id: anaParticipantId } });
    assert.equal(gone, null);
  });

  it('POST /events/:id/participants com studentId E guestName juntos → 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/events/${eventId}/participants`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ studentId: secondStudentId, guestName: 'Convidado Duplicado' })
      .expect(400);

    assert.equal(res.body.message, 'Informe studentId ou guestName.');
  });

  it('DELETE /events/:id (mestre) é hard delete em cascata: evento E os EventParticipant restantes somem', async () => {
    // Antes de apagar: o participante do segundo aluno (inscrito pelo mestre) ainda existe —
    // é essa a sobra que a cascata precisa levar junto.
    const beforeDelete = await prisma.eventParticipant.findUnique({ where: { id: secondParticipantId } });
    assert.ok(beforeDelete !== null);

    await request(app.getHttpServer())
      .delete(`/api/events/${eventId}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    const eventGone = await prisma.event.findUnique({ where: { id: eventId } });
    assert.equal(eventGone, null);

    const participantGone = await prisma.eventParticipant.findUnique({ where: { id: secondParticipantId } });
    assert.equal(participantGone, null);
  });
});

/** Paginação + filtros, limpar campos no PATCH e RBAC de GET /events. */
describe('Eventos — lista paginada e limpar campos (e2e)', () => {
  const TAG = `B2EVT${Date.now()}`;
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestre: Awaited<ReturnType<typeof loginAs>>;
  let aluno: Awaited<ReturnType<typeof loginAs>>;
  let orgB: SecondOrg;
  let stateId: number;
  let cityId: number;
  let unitId: number;
  const get = (path: string, token = mestre.token) =>
    request(app.getHttpServer()).get(`/api${path}`).set('Authorization', `Bearer ${token}`);
  const patch = (id: number, body: object) =>
    request(app.getHttpServer()).patch(`/api/events/${id}`).set('Authorization', `Bearer ${mestre.token}`).send(body);

  before(async () => {
    app = await createTestApp();
    mestre = await loginAs(app, MESTRE);
    aluno = await loginAs(app, ALUNO);
    orgB = await createSecondOrg(app, prisma, 'evt');
    const state = await prisma.state.create({ data: { name: `${TAG} UF`, uf: `E${String(Date.now()).slice(-6)}` } });
    stateId = state.id;
    cityId = (await prisma.city.create({ data: { name: `${TAG} Cidade`, stateId } })).id;
    unitId = (await prisma.unit.findFirstOrThrow({ where: { organizationId: mestre.organizationId } })).id;

    // 55 eventos: dia i de 2031-01 (+i dias), tipo BATIZADO nos 5 primeiros, local só nos pares.
    await prisma.event.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        organizationId: mestre.organizationId,
        title: `${TAG} evento ${i}`,
        type: i < 5 ? 'BATIZADO' : 'OUTRO',
        date: new Date(Date.UTC(2031, 0, 1 + i)),
        location: i % 2 === 0 ? `Ginásio ${TAG}Z` : null,
      })),
    });
    await prisma.event.createMany({
      data: Array.from({ length: 3 }, (_, i) => ({
        organizationId: orgB.organizationId,
        title: `${TAG} orgB ${i}`,
        date: new Date(Date.UTC(2031, 0, 1)),
      })),
    });
  });

  after(async () => {
    await prisma.event.deleteMany({ where: { title: { startsWith: TAG } } });
    await prisma.city.deleteMany({ where: { id: cityId } });
    await prisma.state.deleteMany({ where: { id: stateId } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('sem limit: array de 50 e X-Total-Count real; limit/offset fatiam na mesma ordem (id desc)', async () => {
    const res = await get('/events').expect(200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 50);
    assert.equal(res.headers['x-total-count'], String(await prisma.event.count({ where: { organizationId: mestre.organizationId } })));

    const all = await prisma.event.findMany({ where: { organizationId: mestre.organizationId, title: { startsWith: TAG } }, orderBy: { id: 'desc' } });
    const page = await get(`/events?q=${TAG}&limit=10&offset=50`).expect(200);
    assert.equal(page.headers['x-total-count'], '55');
    assert.deepEqual(page.body.map((e: { id: number }) => e.id), all.slice(50).map((e) => e.id));
  });

  it('limit=201, limit=0, offset=-1, type inválido, from inválido e parâmetro desconhecido => 400', async () => {
    for (const qs of ['limit=201', 'limit=0', 'offset=-1', 'type=NADA', 'from=ontem', 'foo=1']) await get(`/events?${qs}`).expect(400);
  });

  it('filtros: type, from/to (inclusivos), q em título e local (insensível a caixa)', async () => {
    assert.equal((await get(`/events?q=${TAG}&type=BATIZADO`).expect(200)).headers['x-total-count'], '5');
    assert.equal((await get(`/events?q=${TAG}&from=2031-01-10&to=2031-01-12`).expect(200)).headers['x-total-count'], '3');
    assert.equal((await get(`/events?q=${TAG}&from=2031-01-30`).expect(200)).headers['x-total-count'], String(55 - 29));
    assert.equal((await get(`/events?q=${TAG}&to=2031-01-01`).expect(200)).headers['x-total-count'], '1');
    assert.equal((await get(`/events?q=${(TAG + 'z').toLowerCase()}`).expect(200)).headers['x-total-count'], '28'); // local, pares 0..54
    assert.equal((await get(`/events?q=${TAG}%20evento%2054`).expect(200)).headers['x-total-count'], '1');
  });

  it('total NÃO inclui outra organização', async () => {
    assert.equal((await get(`/events?q=${TAG}`).expect(200)).headers['x-total-count'], '55');
    assert.equal((await get(`/events?q=${TAG}`, orgB.token).expect(200)).headers['x-total-count'], '3');
  });

  it('PATCH null limpa description/location/unitId/stateId/cityId/imageUrl (2ª via: Prisma) e valida referências só quando não-null', async () => {
    const ev = await prisma.event.create({
      data: { organizationId: mestre.organizationId, title: `${TAG} limpar`, date: new Date(), description: 'd', location: 'l', unitId, stateId, cityId, imageUrl: 'https://exemplo.com/a.png' },
    });
    await patch(ev.id, { description: null, location: null, unitId: null, stateId: null, cityId: null, imageUrl: null }).expect(200);
    const db = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
    assert.deepEqual([db.description, db.location, db.unitId, db.stateId, db.cityId, db.imageUrl], [null, null, null, null, null, null]);
    await patch(ev.id, { stateId: 99999999 }).expect(400); // id inexistente continua 400
    await patch(ev.id, { imageUrl: '' }).expect(400); // vazio não é URL; para limpar use null
  });

  it('null em campo OBRIGATÓRIO => 400 (title, date, type, isPublic) e nada muda', async () => {
    const ev = await prisma.event.create({ data: { organizationId: mestre.organizationId, title: `${TAG} obrig`, date: new Date() } });
    for (const body of [{ title: null }, { date: null }, { type: null }, { isPublic: null }]) await patch(ev.id, body).expect(400);
    const db = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
    assert.equal(db.title, `${TAG} obrig`);
    assert.equal(db.type, 'OUTRO');
  });

  it('RBAC inalterado: sem token 401; ALUNO lista (200) mas não edita (403)', async () => {
    await request(app.getHttpServer()).get('/api/events').expect(401);
    await get('/events', aluno.token).expect(200);
    const ev = await prisma.event.findFirstOrThrow({ where: { title: { startsWith: TAG } } });
    await request(app.getHttpServer()).patch(`/api/events/${ev.id}`).set('Authorization', `Bearer ${aluno.token}`).send({ description: 'x' }).expect(403);
  });
});
/**
 * Ordenação de GET /events. Sem `order` fica a ordem histórica (id desc = cadastrados por último
 * primeiro), da qual o PAINEL depende (lista paginada no servidor, sem parâmetro de ordem: o
 * evento recém-criado precisa aparecer na 1ª página, mesmo com data passada). O app pede
 * `order=asc` (+ `from`) para receber os eventos mais próximos primeiro. As duas ordens por data
 * são totais (desempate por id): "Carregar mais" nunca repete nem perde evento.
 */
describe('Eventos — ordenação por data (e2e)', () => {
  const TAG = `ORDEVT${Date.now()}`;
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestre: Awaited<ReturnType<typeof loginAs>>;
  let aluno: Awaited<ReturnType<typeof loginAs>>;
  let orgB: SecondOrg;
  const get = (qs: string, token = mestre.token) =>
    request(app.getHttpServer()).get(`/api/events?q=${TAG}${qs}`).set('Authorization', `Bearer ${token}`);
  const idsOf = (body: Array<{ id: number }>) => body.map((e) => e.id);
  const day = (d: number) => new Date(Date.UTC(2032, 5, d)); // junho/2032

  // Inserção FORA de ordem cronológica e com empates de data, para a ordenação não sair "de graça".
  const SPEC: Array<[string, number]> = [['c', 20], ['a', 10], ['b', 15], ['a2', 10], ['c2', 20], ['past', 1]];
  let rows: Array<{ id: number; title: string; date: Date }> = [];

  before(async () => {
    app = await createTestApp();
    mestre = await loginAs(app, MESTRE);
    aluno = await loginAs(app, ALUNO);
    orgB = await createSecondOrg(app, prisma, 'ordevt');
    for (const [name, d] of SPEC) {
      await prisma.event.create({ data: { organizationId: mestre.organizationId, title: `${TAG} ${name}`, date: day(d) } });
    }
    await prisma.event.create({ data: { organizationId: orgB.organizationId, title: `${TAG} orgB`, date: day(5) } });
    // Reescreve a linha de MENOR id de cada empate: a versão nova vai para o fim da tabela, então a
    // ordem física deixa de coincidir com a ordem de id (um sort só por data não sairia certo por acaso).
    for (const name of ['a', 'c']) {
      await prisma.event.updateMany({ where: { title: `${TAG} ${name}` }, data: { location: 'reescrito' } });
    }
    rows = await prisma.event.findMany({
      where: { organizationId: mestre.organizationId, title: { startsWith: TAG } },
      select: { id: true, title: true, date: true },
    });
  });

  after(async () => {
    await prisma.event.deleteMany({ where: { title: { startsWith: TAG } } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  // Expectativas calculadas à parte (JS puro), não pelo mesmo orderBy do service.
  const expected = (dir: 'asc' | 'desc', from?: Date) => {
    const f = dir === 'asc' ? 1 : -1;
    return rows
      .filter((r) => !from || r.date >= from)
      .sort((x, y) => f * (x.date.getTime() - y.date.getTime() || x.id - y.id))
      .map((r) => r.id);
  };

  it('sem order: continua id desc (compatível com o painel — recém-cadastrado primeiro, mesmo com data passada)', async () => {
    const res = await get('&limit=200').expect(200);
    assert.deepEqual(idsOf(res.body), rows.map((r) => r.id).sort((a, b) => b - a));
    assert.equal(res.headers['x-total-count'], String(SPEC.length));
  });

  it('order=asc: data crescente, empates por id crescente (os mais próximos primeiro)', async () => {
    const res = await get('&order=asc&limit=200').expect(200);
    const exp = expected('asc');
    assert.deepEqual(idsOf(res.body), exp);
    assert.deepEqual(res.body.map((e: { title: string }) => e.title.slice(TAG.length + 1)), ['past', 'a', 'a2', 'b', 'c', 'c2']);
    assert.equal(res.headers['x-total-count'], String(SPEC.length));
    assert.ok(res.body.every((e: object) => 'participantsCount' in e && 'myParticipation' in e), 'agregados preservados');
  });

  it('order=desc: data decrescente, empates por id decrescente', async () => {
    const res = await get('&order=desc&limit=200').expect(200);
    assert.deepEqual(idsOf(res.body), expected('desc'));
    assert.deepEqual(res.body.map((e: { title: string }) => e.title.slice(TAG.length + 1)), ['c2', 'c', 'b', 'a2', 'a', 'past']);
  });

  it('paginação com order é estável: páginas consecutivas (limit=2, que corta no meio dos empates) recompõem a lista sem repetir nem perder', async () => {
    for (const dir of ['asc', 'desc'] as const) {
      const parts: number[] = [];
      for (const offset of [0, 2, 4, 6]) parts.push(...idsOf((await get(`&order=${dir}&limit=2&offset=${offset}`).expect(200)).body));
      assert.deepEqual(parts, expected(dir));
      assert.equal(new Set(parts).size, SPEC.length);
    }
  });

  it('order=asc combina com from (e to): exclui o passado mantendo a ordem e o total', async () => {
    const res = await get('&order=asc&from=2032-06-10&limit=200').expect(200);
    assert.deepEqual(idsOf(res.body), expected('asc', day(10)));
    assert.equal(res.headers['x-total-count'], '5'); // tudo menos "past"
    const range = await get('&order=asc&from=2032-06-10&to=2032-06-15').expect(200);
    assert.deepEqual(range.body.map((e: { title: string }) => e.title.slice(TAG.length + 1)), ['a', 'a2', 'b']);
    assert.equal(range.headers['x-total-count'], '3');
  });

  it('isolamento e RBAC inalterados com order: outra organização não aparece; ALUNO lista (200); order inválido => 400; sem token => 401', async () => {
    assert.ok(!(await get('&order=asc&limit=200')).text.includes('orgB'));
    assert.equal((await get('&order=asc', orgB.token).expect(200)).body.length, 1);
    assert.deepEqual(idsOf((await get('&order=asc&limit=200', aluno.token).expect(200)).body), expected('asc'));
    for (const bad of ['order=ASC', 'order=date', 'order=', 'order=asc&order=desc']) await get(`&${bad}`).expect(400);
    await request(app.getHttpServer()).get('/api/events?order=asc').expect(401);
  });
});
