import { INestApplication } from '@nestjs/common';
import { PrismaClient, StudentStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { RankingService } from '../src/interface/http/ranking/ranking.service';
import { currentSeason, shortName } from '../src/interface/http/ranking/ranking-rules';
import { DEV_PASSWORD, SecondOrg, createSecondOrg, loginAs, todaySaoPaulo } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Ginga Rank (e2e): motor de pontos (por tipo, idempotencia, anti-fraude, sequencia), rankings GROUP x CITY x STATE x
 * COUNTRY (opt-in, menor sem consentimento fora), "me", configuracoes (403 de consentimento, apelido invalido), ranking
 * de grupos (>= 3 alunos ativos), isolamento entre grupos e fechamento de temporada.
 *
 * Tudo PROPRIO da suite: 4 grupos "[e2e-rank]" (cidade/UF unicas desta execucao), alunos/usuarios @e2e-rank.local, uma
 * temporada ficticia (2019-03) para o fechamento — o seed ginga-brasil e o demo nao sao tocados. Limpa tudo no after().
 */
const DOMAIN = '@e2e-rank.local';
const PAST_SEASON = '2019-03';
const DAY = 86_400_000;

describe('Ginga Rank (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let ranking: RankingService;
  const tag = `${Date.now()}`;
  const city = `RankCity${tag}`;
  const otherCity = `RankOther${tag}`;
  const state = `Z${tag.slice(-5)}`;
  const today = todaySaoPaulo();
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const daysAgo = (n: number) => new Date(todayDate.getTime() - n * DAY);
  /** 1o dia do mes anterior (data civil): a graduacao do a1 cai SEMPRE na temporada anterior (rankDelta). */
  const prevMonthStart = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() - 1, 1));

  let orgA: SecondOrg;
  let orgB: SecondOrg;
  let orgC: SecondOrg;
  let orgD: SecondOrg;
  const orgIds = () => [orgA, orgB, orgC, orgD].map((o) => o.organizationId);
  const s: Record<string, number> = {}; // nome curto -> studentId
  const users: Record<string, { id: number; email: string; token: string }> = {};
  let lessonA4: number;
  const created = { rodaIds: [] as number[] };

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (url: string, token: string) => http().get(url).set(auth(token));

  async function newUser(key: string, orgId: number, role: 'ALUNO' | 'RESPONSAVEL') {
    const email = `${key}-${tag}${DOMAIN}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `[e2e-rank] ${key}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    await prisma.organizationUser.create({ data: { organizationId: orgId, userId: user.id, role, status: 'ACTIVE' } });
    const { token } = await loginAs(app, email);
    users[key] = { id: user.id, email, token };
    return user.id;
  }

  async function newStudent(
    key: string,
    org: SecondOrg,
    fullName: string,
    opts: { birth?: Date; status?: StudentStatus; userId?: number; photo?: string } = {},
  ) {
    const student = await prisma.student.create({
      data: {
        organizationId: org.organizationId,
        name: `${fullName}`,
        birthDate: opts.birth ?? new Date('1990-05-05T00:00:00.000Z'),
        status: opts.status ?? 'ACTIVE',
        userId: opts.userId,
        photo: opts.photo,
      },
    });
    s[key] = student.id;
    return student.id;
  }

  async function lessons(org: SecondOrg, n: number, date: Date, classId: number) {
    const ids: number[] = [];
    for (let i = 0; i < n; i += 1) {
      ids.push((await prisma.lesson.create({ data: { organizationId: org.organizationId, classId, date } })).id);
    }
    return ids;
  }

  async function present(org: SecondOrg, studentKey: string, lessonIds: number[], flag = true) {
    for (const lessonId of lessonIds) {
      await prisma.attendance.create({ data: { organizationId: org.organizationId, lessonId, studentId: s[studentKey], present: flag } });
    }
  }

  const pointsOf = async (studentKey: string) =>
    (await prisma.pointEvent.aggregate({ _sum: { points: true }, where: { studentId: s[studentKey] } }))._sum.points ?? 0;

  /** Ordem esperada (pontos da temporada desc, quem atingiu antes, id) calculada direto do banco por outra via. */
  async function expectedOrder(keys: string[], season = currentSeason()) {
    const rows = await prisma.pointEvent.groupBy({
      by: ['studentId'],
      where: { studentId: { in: keys.map((k) => s[k]) }, season },
      _sum: { points: true },
      _max: { occurredAt: true },
    });
    const info = new Map(rows.map((r) => [r.studentId, r]));
    return keys
      .map((k) => ({ k, id: s[k], pts: info.get(s[k])?._sum.points ?? 0, last: info.get(s[k])?._max.occurredAt?.getTime() ?? Number.MAX_SAFE_INTEGER }))
      .sort((x, y) => y.pts - x.pts || x.last - y.last || x.id - y.id);
  }

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    ranking = app.get(RankingService);
    orgA = await createSecondOrg(app, prisma, 'rank-a');
    orgB = await createSecondOrg(app, prisma, 'rank-b');
    orgC = await createSecondOrg(app, prisma, 'rank-c');
    orgD = await createSecondOrg(app, prisma, 'rank-d');
    for (const [org, place, name] of [
      [orgA, city, 'Alfa'],
      [orgB, city, 'Beta'],
      [orgC, city, 'Gama'],
      [orgD, otherCity, 'Delta'],
    ] as const) {
      await prisma.organization.update({ where: { id: org.organizationId }, data: { name: `[e2e-rank] ${name}`, city: place, state } });
    }

    // --- Grupo A: a1 (adulto, login), a2 (adulto), a3/a4 (menores: sem/com consentimento), a5 (sem pontos), a6 (INATIVO) ---
    const a1User = await newUser('a1', orgA.organizationId, 'ALUNO');
    const guardianUser = await newUser('guardian', orgA.organizationId, 'RESPONSAVEL');
    await newStudent('a1', orgA, 'Ana Alfa Silva', { userId: a1User, photo: '/api/uploads/a1.png' });
    await newStudent('a2', orgA, 'Bruno Alfa');
    await newStudent('a3', orgA, 'Caio Menor Sem', { birth: new Date(Date.now() - 11 * 365.25 * DAY) });
    await newStudent('a4', orgA, 'Duda Menor Com', { birth: new Date(Date.now() - 15 * 365.25 * DAY) });
    await newStudent('a5', orgA, 'Eva Sem Pontos');
    await newStudent('a6', orgA, 'Fabio Inativo', { status: 'INACTIVE' });
    await prisma.studentGuardian.create({
      data: { organizationId: orgA.organizationId, studentId: s.a3, userId: guardianUser, name: 'Resp E2E', consentPublicProfile: false },
    });
    await prisma.studentGuardian.create({
      data: { organizationId: orgA.organizationId, studentId: s.a4, userId: guardianUser, name: 'Resp E2E', consentPublicProfile: true },
    });
    const klassA = (await prisma.class.create({ data: { organizationId: orgA.organizationId, name: '[e2e-rank] Turma A' } })).id;
    const [la1, la2, la3] = await lessons(orgA, 3, todayDate, klassA);
    lessonA4 = (await lessons(orgA, 1, todayDate, klassA))[0];
    await present(orgA, 'a1', [la1, la2, la3]);
    await present(orgA, 'a2', [la1, la2]);
    await present(orgA, 'a3', [la1]);
    await present(orgA, 'a4', [la1, la2, la3]);
    await present(orgA, 'a6', [la1]);
    const systemA = await prisma.graduationSystem.create({ data: { organizationId: orgA.organizationId, name: '[e2e-rank] Cordas A' } });
    const levelA2 = await prisma.graduationLevel.create({ data: { organizationId: orgA.organizationId, graduationSystemId: systemA.id, name: 'Verde', order: 2 } });
    await prisma.studentGraduation.create({ data: { organizationId: orgA.organizationId, studentId: s.a1, graduationLevelId: levelA2.id, graduatedAt: prevMonthStart } });
    // roda de hoje (passada) organizada pelo grupo A: o a1 entra pelo app (POST /rodas/:id/participants)
    const roda = await prisma.roda.create({ data: { organizationId: orgA.organizationId, title: `[e2e-rank] Roda ${tag}`, date: new Date(Date.now() - 5 * 60_000) } });
    created.rodaIds.push(roda.id);

    // --- Grupo B (mesma cidade): b1 (opt-in), b2, b3 ---
    await newStudent('b1', orgB, 'Bia Beta');
    await newStudent('b2', orgB, 'Beto Beta');
    await newStudent('b3', orgB, 'Bela Beta');
    const klassB = (await prisma.class.create({ data: { organizationId: orgB.organizationId, name: '[e2e-rank] Turma B' } })).id;
    const lb = await lessons(orgB, 3, todayDate, klassB);
    await present(orgB, 'b1', lb);
    await present(orgB, 'b2', [lb[0]]);
    await prisma.certificate.create({ data: { organizationId: orgB.organizationId, studentId: s.b1, title: '[e2e-rank] Certificado', issuedAt: new Date() } });
    const systemB = await prisma.graduationSystem.create({ data: { organizationId: orgB.organizationId, name: '[e2e-rank] Cordas B' } });
    const levelB5 = await prisma.graduationLevel.create({ data: { organizationId: orgB.organizationId, graduationSystemId: systemB.id, name: 'Roxa', order: 5 } });
    await prisma.studentGraduation.create({ data: { organizationId: orgB.organizationId, studentId: s.b1, graduationLevelId: levelB5.id, graduatedAt: new Date(`${PAST_SEASON}-10T00:00:00.000Z`) } });

    // --- Grupo C (mesma cidade, so 2 alunos => fora do ranking de grupos) ---
    await newStudent('c1', orgC, 'Caca Gama');
    await newStudent('c2', orgC, 'Cris Gama');
    const klassC = (await prisma.class.create({ data: { organizationId: orgC.organizationId, name: '[e2e-rank] Turma C' } })).id;
    const lc = await lessons(orgC, 2, todayDate, klassC);
    await present(orgC, 'c1', lc);

    // --- Grupo D (outra cidade, mesma UF): d1 (opt-in), d2 (login; sequencia + liga), d3 (4 aulas no mesmo dia) ---
    const d2User = await newUser('d2', orgD.organizationId, 'ALUNO');
    await newStudent('d1', orgD, 'Davi Delta');
    await newStudent('d2', orgD, 'Dani Delta', { userId: d2User });
    await newStudent('d3', orgD, 'Dudu Delta');
    const klassD = (await prisma.class.create({ data: { organizationId: orgD.organizationId, name: '[e2e-rank] Turma D' } })).id;
    const ld = await lessons(orgD, 4, todayDate, klassD);
    await present(orgD, 'd1', [ld[0]]);
    await present(orgD, 'd3', ld); // 4 presencas no mesmo dia: so 3 pontuam
    const weekLessons: number[] = [];
    for (const back of [21, 14, 7]) weekLessons.push(...(await lessons(orgD, 1, daysAgo(back), klassD)));
    await present(orgD, 'd2', [...weekLessons, ld[1]]); // 4 semanas seguidas (a de hoje usa ld[1])
    const systemD = await prisma.graduationSystem.create({ data: { organizationId: orgD.organizationId, name: '[e2e-rank] Cordas D' } });
    const levelD4 = await prisma.graduationLevel.create({ data: { organizationId: orgD.organizationId, graduationSystemId: systemD.id, name: 'Azul', order: 4 } });
    const levelD2 = await prisma.graduationLevel.create({ data: { organizationId: orgD.organizationId, graduationSystemId: systemD.id, name: 'Verde', order: 2 } });
    await prisma.studentGraduation.create({ data: { organizationId: orgD.organizationId, studentId: s.d2, graduationLevelId: levelD4.id, graduatedAt: daysAgo(60) } });
    await prisma.studentGraduation.create({ data: { organizationId: orgD.organizationId, studentId: s.d2, graduationLevelId: levelD2.id, graduatedAt: new Date(`${PAST_SEASON}-15T00:00:00.000Z`) } });

    // Opt-in direto no banco (bypass da API de proposito): b1, c1, d1 e o menor SEM consentimento (a3 — deve ficar de fora mesmo assim).
    for (const key of ['b1', 'c1', 'd1', 'a3']) {
      await prisma.rankingProfile.create({ data: { studentId: s[key], optInPublic: true } });
    }

    // Deriva os pontos de todos (fora do fluxo HTTP) — d2 so' sincroniza no teste dedicado (contagem de notificacoes).
    for (const key of Object.keys(s).filter((k) => k !== 'd2')) await ranking.syncStudent(s[key]);
  });

  after(async () => {
    await ranking.idle();
    const orgs = orgIds();
    const studentIds = Object.values(s);
    const userIds = [...Object.values(users).map((u) => u.id), ...[orgA, orgB, orgC, orgD].map((o) => o.userId)];
    await prisma.seasonResult.deleteMany({ where: { OR: [{ season: PAST_SEASON }, { organizationId: { in: orgs } }] } });
    await prisma.rodaParticipant.deleteMany({ where: { rodaId: { in: created.rodaIds } } });
    await prisma.roda.deleteMany({ where: { id: { in: created.rodaIds } } });
    await prisma.certificate.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.studentGraduation.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.graduationLevel.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.graduationSystem.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.attendance.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.lesson.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.class.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.pointEvent.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.studentGuardian.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.student.deleteMany({ where: { organizationId: { in: orgs } } }); // cascata: RankingProfile, Achievement
    await prisma.notification.deleteMany({ where: { OR: [{ organizationId: { in: orgs } }, { userId: { in: userIds } }] } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: orgs } }, { userId: { in: userIds } }] } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: Object.values(users).map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    for (const o of [orgA, orgB, orgC, orgD]) await o.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------
  // Motor
  // ---------------------------------------------------------------------------------------------

  it('motor: pontos por tipo derivados da origem (aula 10, graduacao 100 x ordem, certificado 20) e anti-fraude de 3 por dia', async () => {
    const kinds = async (key: string) =>
      Object.fromEntries(
        (await prisma.pointEvent.groupBy({ by: ['type'], where: { studentId: s[key] }, _sum: { points: true }, _count: true })).map((r) => [r.type, [r._count, r._sum.points]]),
      );
    assert.deepEqual(await kinds('a1'), { CLASS_ATTENDANCE: [3, 30], GRADUATION: [1, 200] });
    assert.deepEqual(await kinds('b1'), { CLASS_ATTENDANCE: [3, 30], CERTIFICATE: [1, 20], GRADUATION: [1, 500] });
    // d3 foi a 4 aulas no MESMO dia: so 3 pontuam (10 cada)
    assert.deepEqual(await kinds('d3'), { CLASS_ATTENDANCE: [3, 30] });
    // aluno inativo e sem presenca nao ganham nada indevido; falta nao pontua
    assert.deepEqual(await kinds('a5'), {});
    assert.equal(await prisma.pointEvent.count({ where: { studentId: s.a2, type: 'GRADUATION' } }), 0);
  });

  it('motor: syncStudent e idempotente (2a execucao nao cria, nao altera, nao remove) e corrige a origem alterada', async () => {
    const before = await prisma.pointEvent.findMany({ where: { studentId: s.a1 }, orderBy: { id: 'asc' } });
    const again = await ranking.syncStudent(s.a1);
    assert.deepEqual([again?.created, again?.updated, again?.removed], [0, 0, 0]);
    const after2 = await prisma.pointEvent.findMany({ where: { studentId: s.a1 }, orderBy: { id: 'asc' } });
    assert.deepEqual(after2.map((p) => p.id), before.map((p) => p.id));

    // presenca desmarcada pelo professor => o ponto sai; remarcada => volta
    const att = await prisma.attendance.findFirstOrThrow({ where: { studentId: s.a2 }, orderBy: { id: 'asc' } });
    await prisma.attendance.update({ where: { id: att.id }, data: { present: false } });
    const removed = await ranking.syncStudent(s.a2);
    assert.equal(removed?.removed, 1);
    assert.equal(await pointsOf('a2'), 10);
    await prisma.attendance.update({ where: { id: att.id }, data: { present: true } });
    assert.equal((await ranking.syncStudent(s.a2))?.created, 1);
    assert.equal(await pointsOf('a2'), 20);
  });

  it('motor: sequencia de semanas (bonus), conquistas e liga com 1 notificacao cada, sem spam em syncs repetidos', async () => {
    for (let i = 0; i < 3; i += 1) await ranking.syncStudent(s.d2);
    const rows = await prisma.pointEvent.findMany({ where: { studentId: s.d2 } });
    const sum = (type: string) => rows.filter((r) => r.type === type).reduce((n, r) => n + r.points, 0);
    assert.equal(sum('CLASS_ATTENDANCE'), 40);
    assert.equal(sum('STREAK_BONUS'), 30); // 5 + 10 + 15 (semanas 2, 3 e 4 seguidas)
    assert.equal(sum('GRADUATION'), 600); // 400 + 200
    const achievements = (await prisma.achievement.findMany({ where: { studentId: s.d2, NOT: { code: { startsWith: 'LEAGUE_' } } } })).map((a) => a.code).sort();
    assert.deepEqual(achievements, ['FIRST_GRADUATION', 'SEQ_4W']);
    const notes = await prisma.notification.findMany({ where: { userId: users.d2.id } });
    assert.equal(notes.filter((n) => n.type === 'RANKING_ACHIEVEMENT').length, 2, 'uma notificacao por conquista');
    assert.equal(notes.filter((n) => n.type === 'RANKING_LEAGUE').length, 1, 'uma notificacao de liga (VERDE)');
    assert.match(notes.find((n) => n.type === 'RANKING_LEAGUE')?.body ?? '', /Verde/);
  });

  it('gatilho: marcar presenca pela API recalcula o ranking do aluno em segundo plano (fire-and-forget)', async () => {
    const before = await pointsOf('a3');
    const res = await http()
      .post(`/api/attendance/lessons/${lessonA4}`)
      .set(auth(orgA.token))
      .send([{ studentId: s.a3, present: true }])
      .expect(201);
    assert.equal(res.body.count, 1);
    await ranking.idle();
    assert.equal(await pointsOf('a3'), before + 10);
  });

  it('gatilho: confirmar presenca em roda pelo app (userId) pontua o aluno da conta (roda passada = 25)', async () => {
    await http().post(`/api/rodas/${created.rodaIds[0]}/participants`).set(auth(users.a1.token)).expect(201);
    await ranking.idle();
    const row = await prisma.pointEvent.findFirstOrThrow({ where: { studentId: s.a1, type: 'RODA_PARTICIPATION' } });
    assert.equal(row.points, 25);
  });

  it('anti-fraude: o proprio aluno nao se inscreve como ATTENDED em evento (so a equipe ou o check-in na janela)', async () => {
    const event = await prisma.event.create({ data: { organizationId: orgA.organizationId, title: `[e2e-rank] Evento ${tag}`, date: new Date(Date.now() + 5 * DAY) } });
    try {
      await http().post(`/api/events/${event.id}/participants`).set(auth(users.a1.token)).send({ studentId: s.a1, status: 'ATTENDED' }).expect(403);
      await http().post(`/api/events/${event.id}/participants`).set(auth(orgA.token)).send({ studentId: s.a1, status: 'ATTENDED' }).expect(201);
    } finally {
      await prisma.eventParticipant.deleteMany({ where: { eventId: event.id } });
      await prisma.event.delete({ where: { id: event.id } });
    }
  });

  // ---------------------------------------------------------------------------------------------
  // GET /ranking/students
  // ---------------------------------------------------------------------------------------------

  it('401 sem token em todas as rotas', async () => {
    for (const path of ['/students', '/groups', '/me', '/seasons', '/hall-of-fame', '/group-overview']) {
      await http().get(`/api/ranking${path}`).expect(401);
    }
    await http().put('/api/ranking/me/settings').send({ optInPublic: true }).expect(401);
  });

  it('GROUP: todos os alunos ATIVOS do proprio grupo (menor tambem), nome curto, ordem de desempate, me/isMe, sem inativo nem aluno de outro grupo', async () => {
    const res = await get('/api/ranking/students?scope=GROUP', users.a1.token).expect(200);
    assert.equal(res.headers['cache-control'], 'private, max-age=30');
    const expected = await expectedOrder(['a1', 'a2', 'a3', 'a4', 'a5']);
    assert.deepEqual(res.body.items.map((i: { studentId: number }) => i.studentId), expected.map((e) => e.id));
    assert.deepEqual(res.body.items.map((i: { rank: number }) => i.rank), [1, 2, 3, 4, 5]);
    assert.deepEqual(res.body.items.map((i: { points: number }) => i.points), expected.map((e) => e.pts));
    assert.equal(res.body.total, 5);
    assert.equal(res.body.scope, 'GROUP');
    assert.equal(res.body.season, currentSeason());
    assert.equal(res.body.category, 'GENERAL');
    assert.equal(res.body.band, null);
    const first = res.body.items.find((i: { studentId: number }) => i.studentId === s.a1);
    assert.equal(first.displayName, shortName('Ana Alfa Silva'));
    assert.equal(first.displayName, 'Ana S.');
    assert.equal(first.avatarUrl, '/api/uploads/a1.png');
    assert.equal(first.groupId, orgA.organizationId);
    assert.equal(first.city, city);
    assert.equal(first.state, state);
    assert.equal(first.isMe, true);
    assert.equal(first.rankDelta, 0, 'a1 era 1o na temporada anterior (graduacao do mes passado) e continua 1o');
    assert.equal(res.body.items.find((i: { studentId: number }) => i.studentId === s.a4).rankDelta, null, 'sem ponto na temporada anterior');
    assert.ok(first.level.code && first.level.name && /^#/.test(first.level.color));
    assert.ok(res.body.items.some((i: { studentId: number }) => i.studentId === s.a3), 'menor aparece no proprio grupo (nome curto + avatar)');
    assert.ok(res.body.items.every((i: { studentId: number }) => i.studentId !== s.a6), 'aluno INATIVO nunca aparece');
    assert.ok(res.body.items.every((i: { groupId: number }) => i.groupId === orgA.organizationId));
    assert.deepEqual(res.body.me, { rank: res.body.items.findIndex((i: { isMe: boolean }) => i.isMe) + 1, points: first.points, inList: true });
    // total tambem no header
    assert.equal(res.headers['x-total-count'], '5');
  });

  it('GROUP: filtros de faixa etaria (KIDS/YOUTH/ADULT), categoria (RODAS) e paginacao com me fora da pagina', async () => {
    const ids = async (qs: string) => (await get(`/api/ranking/students?scope=GROUP&${qs}`, users.a1.token).expect(200)).body.items.map((i: { studentId: number }) => i.studentId).sort();
    assert.deepEqual(await ids('band=KIDS'), [s.a3]);
    assert.deepEqual(await ids('band=YOUTH'), [s.a4]);
    assert.deepEqual(await ids('band=ADULT'), [s.a1, s.a2, s.a5].sort());
    const rodas = await get('/api/ranking/students?scope=GROUP&category=RODAS&season=ALL', users.a1.token).expect(200);
    assert.equal(rodas.body.items[0].studentId, s.a1);
    assert.equal(rodas.body.items[0].points, 25);
    assert.equal(rodas.body.category, 'RODAS');
    // paginacao: pagina 2 de tamanho 2; "me" (a1, 1o) fica fora da lista mas vem com a posicao
    const page = await get('/api/ranking/students?scope=GROUP&limit=2&offset=2&season=ALL', users.a1.token).expect(200);
    assert.equal(page.body.items.length, 2);
    assert.equal(page.body.items[0].rank, 3);
    assert.equal(page.body.total, 5);
    assert.deepEqual([page.body.me.rank, page.body.me.inList], [1, false]);
    await get('/api/ranking/students?limit=101', users.a1.token).expect(400);
    await get('/api/ranking/students?scope=PLANETA', users.a1.token).expect(400);
    await get('/api/ranking/students?season=2026-13', users.a1.token).expect(400);
  });

  it('isolamento: o grupo B ve so os seus alunos em GROUP (nada do grupo A) e vice-versa', async () => {
    const b = await get('/api/ranking/students?scope=GROUP&season=ALL', orgB.token).expect(200);
    assert.deepEqual(b.body.items.map((i: { studentId: number }) => i.studentId).sort(), [s.b1, s.b2, s.b3].sort());
    assert.equal(b.body.me, null, 'mestre sem cadastro de aluno nao tem "me"');
    assert.ok(!b.text.includes('Ana S.') && !b.text.includes('Alfa'));
    const a = await get('/api/ranking/students?scope=GROUP&season=ALL', orgA.token).expect(200);
    assert.ok(a.body.items.every((i: { studentId: number }) => ![s.b1, s.b2, s.b3, s.c1, s.d1].includes(i.studentId)));
  });

  it('CITY/STATE/COUNTRY: so opt-in; adulto sem opt-in e MENOR sem consentimento ficam de fora; outra cidade so no STATE', async () => {
    // a1 faz opt-in pela API (e define um apelido); a4 (menor) so depois que o responsavel consentir (proximo teste)
    await http().put('/api/ranking/me/settings').set(auth(users.a1.token)).send({ optInPublic: true, nickname: 'Ana Capoeira' }).expect(200);
    const city_ = await get('/api/ranking/students?scope=CITY', users.a1.token).expect(200);
    const idsCity = city_.body.items.map((i: { studentId: number }) => i.studentId);
    assert.deepEqual(idsCity, (await expectedOrder(['a1', 'b1', 'c1'])).filter((e) => e.pts > 0).map((e) => e.id));
    assert.ok(!idsCity.includes(s.a2) && !idsCity.includes(s.a3) && !idsCity.includes(s.a5), 'sem opt-in / menor sem consentimento (mesmo com optInPublic=true no banco)');
    assert.ok(!idsCity.includes(s.d1), 'outra cidade nao entra em CITY');
    assert.equal(city_.body.items.find((i: { studentId: number }) => i.studentId === s.a1).displayName, 'Ana Capoeira', 'apelido no lugar do nome');
    assert.ok(city_.body.items.find((i: { studentId: number }) => i.studentId === s.b1).displayName === 'Bia B.');

    const st = await get('/api/ranking/students?scope=STATE', users.a1.token).expect(200);
    assert.deepEqual(
      st.body.items.map((i: { studentId: number }) => i.studentId),
      (await expectedOrder(['a1', 'b1', 'c1', 'd1'])).filter((e) => e.pts > 0).map((e) => e.id),
    );

    const country = await get('/api/ranking/students?scope=COUNTRY&limit=100', users.a1.token).expect(200);
    const mine = country.body.items.map((i: { studentId: number }) => i.studentId).filter((id: number) => Object.values(s).includes(id));
    assert.deepEqual(mine, (await expectedOrder(['a1', 'b1', 'c1', 'd1'])).filter((e) => e.pts > 0).map((e) => e.id));
    assert.ok(!mine.includes(s.a3));
    // me em escopo aberto: a2 (sem opt-in) nao tem posicao, mas ve os proprios pontos? (usa o a1 aqui) a1 esta na lista
    assert.equal(city_.body.me.inList, true);
  });

  it('responsavel: "me" do dependente fora do escopo aberto = rank null com pontos; dependente sem vinculo/de outro grupo = 404', async () => {
    // O responsavel olha o dependente a3 (menor sem consentimento, optInPublic=true no banco): em CITY ele nao esta na lista
    const res = await get(`/api/ranking/students?scope=CITY&studentId=${s.a3}`, users.guardian.token).expect(200);
    assert.equal(res.body.me.rank, null);
    assert.equal(res.body.me.inList, false);
    assert.ok(res.body.me.points > 0);
    // dependente de OUTRO grupo / sem vinculo => 404
    await get(`/api/ranking/students?scope=CITY&studentId=${s.b1}`, users.guardian.token).expect(404);
    await get(`/api/ranking/students?scope=CITY&studentId=${s.a2}`, users.guardian.token).expect(404);
  });

  // ---------------------------------------------------------------------------------------------
  // PUT /ranking/me/settings e GET /ranking/me
  // ---------------------------------------------------------------------------------------------

  it('settings: menor sem consentimento do responsavel => 403 GUARDIAN_CONSENT_REQUIRED; com consentimento (Passaporte) entra e sai do ranking aberto', async () => {
    const denied = await http().put(`/api/ranking/me/settings?studentId=${s.a3}`).set(auth(users.guardian.token)).send({ optInPublic: true }).expect(403);
    assert.equal(denied.body.code, 'GUARDIAN_CONSENT_REQUIRED');
    const g3 = await get(`/api/ranking/me?studentId=${s.a3}`, users.guardian.token).expect(200);
    assert.deepEqual(g3.body.settings, { optInPublic: true, nickname: null, canOptIn: false, requiresGuardianConsent: true });

    const ok = await http().put(`/api/ranking/me/settings?studentId=${s.a4}`).set(auth(users.guardian.token)).send({ optInPublic: true, nickname: 'Duda Mirim' }).expect(200);
    assert.deepEqual(ok.body, { optInPublic: true, nickname: 'Duda Mirim', canOptIn: true, requiresGuardianConsent: false });
    const listed = async () => (await get('/api/ranking/students?scope=CITY', users.a1.token).expect(200)).body.items.map((i: { studentId: number }) => i.studentId);
    assert.ok((await listed()).includes(s.a4), 'menor COM consentimento e opt-in aparece');

    // o responsavel revoga o consentimento do Passaporte => sai do ranking aberto na hora (mesmo consentimento, nenhum fluxo paralelo)
    await http().patch('/api/passport/guardian-consent').set(auth(users.guardian.token)).send({ studentId: s.a4, consent: false }).expect(200);
    assert.ok(!(await listed()).includes(s.a4));
    await http().patch('/api/passport/guardian-consent').set(auth(users.guardian.token)).send({ studentId: s.a4, consent: true }).expect(200);
    assert.ok((await listed()).includes(s.a4));
  });

  it('settings: apelido invalido => 400; apelido valido grava, null limpa; aluno sem vinculo => 404; auditoria so na configuracao', async () => {
    for (const nickname of ['a', 'x'.repeat(21), 'rock<script>', 'Seu Merda', 'p0rr4']) {
      await http().put('/api/ranking/me/settings').set(auth(users.a1.token)).send({ nickname }).expect(400);
    }
    await http().put('/api/ranking/me/settings').set(auth(users.a1.token)).send({ nickname: 123 }).expect(400);
    await http().put('/api/ranking/me/settings').set(auth(users.a1.token)).send({ optInPublic: 'sim' }).expect(400);
    const set = await http().put('/api/ranking/me/settings').set(auth(users.a1.token)).send({ nickname: '  Aninha   Axé ' }).expect(200);
    assert.equal(set.body.nickname, 'Aninha Axé');
    assert.equal(set.body.optInPublic, true, 'campo omitido nao muda');
    const cleared = await http().put('/api/ranking/me/settings').set(auth(users.a1.token)).send({ nickname: null }).expect(200);
    assert.equal(cleared.body.nickname, null);
    await http().put(`/api/ranking/me/settings?studentId=${s.a2}`).set(auth(users.a1.token)).send({ optInPublic: true }).expect(404);
    const logs = await prisma.auditLog.findMany({ where: { organizationId: orgA.organizationId, action: 'RANKING_SETTINGS', resource: 'ranking_profile' } });
    assert.ok(logs.length >= 3);
    assert.ok(logs.every((l) => JSON.stringify(l.metadata ?? {}).indexOf('Axé') === -1), 'o apelido em si nao vai para a auditoria');
  });

  it('GET /ranking/me: pontos, liga, proxima liga, progresso, sequencia, posicoes, conquistas e configuracoes', async () => {
    const res = await get('/api/ranking/me', users.a1.token).expect(200);
    const b = res.body;
    const allTime = await pointsOf('a1');
    assert.equal(allTime, 255); // 3 aulas (30) + roda (25) + graduacao ordem 2 (200)
    assert.equal(b.points.allTime, 255);
    assert.equal(b.points.season, (await prisma.pointEvent.aggregate({ _sum: { points: true }, where: { studentId: s.a1, season: currentSeason() } }))._sum.points);
    assert.deepEqual(b.level, { code: 'CRUA', name: 'Crua', color: '#E5E5E5' });
    assert.deepEqual(b.nextLevel, { code: 'VERDE', name: 'Verde', color: '#22C55E', minPoints: 300 });
    assert.equal(b.pointsToNext, 45);
    assert.equal(b.progressPct, 85);
    assert.equal(b.streakWeeks, 1);
    assert.equal(b.student.id, s.a1);
    assert.equal(b.student.avatarUrl, '/api/uploads/a1.png');
    assert.equal(b.rank.group, 1);
    assert.ok(b.rank.city >= 1 && b.rank.state >= 1 && b.rank.country >= 1);
    assert.deepEqual(b.achievements.map((a: { code: string }) => a.code), ['FIRST_GRADUATION']);
    assert.ok(b.achievements[0].name && b.achievements[0].description && b.achievements[0].earnedAt);
    assert.deepEqual(b.availableAchievements.map((a: { code: string }) => a.code).sort(), ['CENTURION', 'EVENT_5', 'PERFECT_MONTH', 'RODA_10', 'SEQ_4W']);
    assert.deepEqual(Object.keys(b.settings).sort(), ['canOptIn', 'nickname', 'optInPublic', 'requiresGuardianConsent']);
    // mestre sem cadastro de aluno => 404; conta de aluno de outro grupo nao enxerga o a1
    await get('/api/ranking/me', orgA.token).expect(404);
    await get(`/api/ranking/me?studentId=${s.a1}`, users.d2.token).expect(404);
    // dependente: o responsavel ve o a4 (rank do proprio grupo) pelo studentId
    const dep = await get(`/api/ranking/me?studentId=${s.a4}`, users.guardian.token).expect(200);
    assert.equal(dep.body.student.id, s.a4);
  });

  // ---------------------------------------------------------------------------------------------
  // GET /ranking/groups
  // ---------------------------------------------------------------------------------------------

  it('groups: media por aluno ativo; so grupos ACTIVE, visiveis e com >= 3 alunos ativos (C com 2 e D de outra cidade ficam fora de CITY)', async () => {
    const res = await get('/api/ranking/groups?scope=CITY', orgA.token).expect(200);
    assert.equal(res.headers['cache-control'], 'private, max-age=30');
    const sumOf = async (orgId: number) =>
      (await prisma.pointEvent.aggregate({ _sum: { points: true }, where: { season: currentSeason(), student: { organizationId: orgId, status: 'ACTIVE' } } }))._sum.points ?? 0;
    const active = async (orgId: number) => prisma.student.count({ where: { organizationId: orgId, status: 'ACTIVE' } });
    const expected = [orgA.organizationId, orgB.organizationId].map((id) => ({ id, total: 0, n: 0 }));
    for (const e of expected) {
      e.total = await sumOf(e.id);
      e.n = await active(e.id);
    }
    expected.sort((x, y) => y.total / y.n - x.total / x.n || y.total - x.total || x.id - y.id);
    assert.deepEqual(res.body.items.map((i: { groupId: number }) => i.groupId), expected.map((e) => e.id));
    assert.equal(res.body.total, 2);
    assert.equal(res.body.scope, 'CITY');
    for (const item of res.body.items) {
      const e = expected.find((x) => x.id === item.groupId)!;
      assert.equal(item.studentsCount, e.n);
      assert.equal(item.totalPoints, e.total);
      assert.equal(item.avgPoints, Math.round(e.total / e.n));
      assert.equal(item.isMine, item.groupId === orgA.organizationId);
      assert.equal(item.city, city);
    }
    assert.equal(res.body.items.find((i: { groupId: number }) => i.groupId === orgA.organizationId).studentsCount, 5, 'a6 (inativo) nao conta');

    // STATE: inclui o grupo D (outra cidade, mesma UF, 3 alunos); C continua fora (2 alunos)
    const st = await get('/api/ranking/groups?scope=STATE', orgA.token).expect(200);
    assert.deepEqual(st.body.items.map((i: { groupId: number }) => i.groupId).sort(), [orgA.organizationId, orgB.organizationId, orgD.organizationId].sort());

    // mapVisible=false (e' o "aparece em rankings abertos") e grupo INACTIVE saem do ranking de grupos E dos rankings abertos de alunos
    await prisma.organization.update({ where: { id: orgB.organizationId }, data: { mapVisible: false } });
    const hidden = await get('/api/ranking/groups?scope=CITY', orgA.token).expect(200);
    assert.ok(hidden.body.items.every((i: { groupId: number }) => i.groupId !== orgB.organizationId));
    await prisma.organization.update({ where: { id: orgB.organizationId }, data: { mapVisible: true, status: 'INACTIVE' } });
    try {
      const inactive = await get('/api/ranking/groups?scope=CITY', orgA.token).expect(200);
      assert.ok(inactive.body.items.every((i: { groupId: number }) => i.groupId !== orgB.organizationId));
      const students = await get('/api/ranking/students?scope=CITY', users.a1.token).expect(200);
      assert.ok(students.body.items.every((i: { groupId: number }) => i.groupId !== orgB.organizationId), 'aluno de grupo INACTIVE nunca aparece');
    } finally {
      await prisma.organization.update({ where: { id: orgB.organizationId }, data: { status: 'ACTIVE' } });
    }
  });

  // ---------------------------------------------------------------------------------------------
  // group-overview (equipe) e hall da fama
  // ---------------------------------------------------------------------------------------------

  it('group-overview: so equipe (students.view); topStudents, inativos na temporada, total e media', async () => {
    await get('/api/ranking/group-overview', users.a1.token).expect(403);
    const res = await get('/api/ranking/group-overview', orgA.token).expect(200);
    const total = (await prisma.pointEvent.aggregate({ _sum: { points: true }, where: { season: currentSeason(), student: { organizationId: orgA.organizationId, status: 'ACTIVE' } } }))._sum.points ?? 0;
    assert.equal(res.body.activeStudents, 5);
    assert.equal(res.body.totalPoints, total);
    assert.equal(res.body.avgPoints, Math.round(total / 5));
    assert.equal(res.body.inactiveCount, 1, 'a5 nao pontuou na temporada');
    assert.ok(res.body.topStudents.length >= 1 && res.body.topStudents.length <= 10);
    assert.ok(res.body.topStudents.every((i: { points: number }) => i.points > 0));
    assert.equal(res.body.season, currentSeason());
  });

  it('hall da fama: GROUP e o ranking de todos os tempos (season=ALL), COUNTRY so opt-in', async () => {
    const group = await get('/api/ranking/hall-of-fame?scope=GROUP', users.a1.token).expect(200);
    assert.equal(group.body.season, 'ALL');
    const allTime = await Promise.all(['a1', 'a2', 'a3', 'a4', 'a5'].map(async (k) => ({ id: s[k], pts: await pointsOf(k) })));
    assert.deepEqual(group.body.items.map((i: { points: number }) => i.points), allTime.map((x) => x.pts).sort((x, y) => y - x));
    assert.equal(group.body.items[0].studentId, s.a1);
    const country = await get('/api/ranking/hall-of-fame?scope=COUNTRY&limit=100', users.a1.token).expect(200);
    const ids = country.body.items.map((i: { studentId: number }) => i.studentId);
    assert.ok(ids.includes(s.b1) && !ids.includes(s.a3) && !ids.includes(s.a2));
  });

  // ---------------------------------------------------------------------------------------------
  // Temporadas
  // ---------------------------------------------------------------------------------------------

  it('fechamento de temporada: grava o top 10 (GROUP/COUNTRY/GROUPS), avisa o campeao 1x e e idempotente; /seasons lista os campeoes', async () => {
    const first = await ranking.closeSeason(PAST_SEASON, { notify: true });
    assert.ok(first.written >= 2, JSON.stringify(first));
    const rows = await prisma.seasonResult.findMany({ where: { season: PAST_SEASON }, orderBy: [{ scope: 'asc' }, { scopeKey: 'asc' }, { rank: 'asc' }] });
    const groupB = rows.filter((r) => r.scope === 'GROUP' && r.scopeKey === String(orgB.organizationId));
    assert.deepEqual(groupB.map((r) => [r.rank, r.studentId, r.points]), [[1, s.b1, 500]]);
    const groupD = rows.filter((r) => r.scope === 'GROUP' && r.scopeKey === String(orgD.organizationId));
    assert.deepEqual(groupD.map((r) => [r.rank, r.studentId, r.points]), [[1, s.d2, 200]]);
    const country = rows.filter((r) => r.scope === 'COUNTRY');
    assert.deepEqual(country.map((r) => [r.rank, r.studentId, r.points]), [[1, s.b1, 500]], 'so opt-in no Brasil (d2 nao fez opt-in)');
    assert.ok(rows.every((r) => r.rank >= 1 && r.rank <= 10));

    const championNotes = async () => prisma.notification.count({ where: { userId: users.d2.id, type: 'RANKING_SEASON' } });
    assert.equal(await championNotes(), 1, 'campeao do grupo avisado uma vez');
    const second = await ranking.closeSeason(PAST_SEASON, { notify: true });
    assert.equal(second.written, 0);
    assert.equal(second.championsNotified, 0);
    assert.ok(second.skipped >= 1);
    assert.equal(await prisma.seasonResult.count({ where: { season: PAST_SEASON } }), rows.length);
    assert.equal(await championNotes(), 1, 'sem aviso repetido');
    // temporada corrente/futura nao fecha
    assert.equal((await ranking.closeSeason(currentSeason())).written, 0);

    const seasons = await get('/api/ranking/seasons?limit=60', orgB.token).expect(200);
    assert.equal(seasons.body.current, currentSeason());
    const item = seasons.body.items.find((i: { season: string }) => i.season === PAST_SEASON);
    assert.deepEqual(item.champions.country, { studentId: s.b1, displayName: 'Bia B.', points: 500 });
    assert.deepEqual(item.champions.group, { studentId: s.b1, displayName: 'Bia B.', points: 500 });
    const forA = (await get('/api/ranking/seasons?limit=60', orgA.token).expect(200)).body.items.find((i: { season: string }) => i.season === PAST_SEASON);
    assert.equal(forA.champions.group, null, 'o grupo A nao teve ponto em 2019-03');
    // campeao do Brasil perde a identificacao se retirar o opt-in
    await prisma.rankingProfile.update({ where: { studentId: s.b1 }, data: { optInPublic: false } });
    const anon = (await get('/api/ranking/seasons?limit=60', orgB.token).expect(200)).body.items.find((i: { season: string }) => i.season === PAST_SEASON);
    assert.equal(anon.champions.country.studentId, undefined);
    assert.equal(anon.champions.country.displayName, 'Capoeirista anônimo');
    await prisma.rankingProfile.update({ where: { studentId: s.b1 }, data: { optInPublic: true } });
  });
});
