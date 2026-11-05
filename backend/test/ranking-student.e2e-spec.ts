import { INestApplication } from '@nestjs/common';
import { PrismaClient, StudentStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { RankingStudentService } from '../src/interface/http/ranking/ranking-student.service';
import { RankingService } from '../src/interface/http/ranking/ranking.service';
import { ACHIEVEMENTS, rankingRules } from '../src/interface/http/ranking/ranking-rules';
import { DEV_PASSWORD, SecondOrg, createSecondOrg, loginAs, todaySaoPaulo } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Ginga Rank — lado do aluno (docs/CONTRATO_RANK_ALUNO.md), e2e contra o Postgres real: GET /ranking/rules, extrato
 * (/me/points), evolucao, meta do mes, conquistas (progresso/raridade/vitrine), check-in diario (GET/POST) e a vitrine no
 * PUT /ranking/me/settings e no GET /ranking/students. Grupos/usuarios PROPRIOS ("[e2e-rstu]", @e2e-rstu.local); limpa tudo.
 *
 * Os valores esperados sao recalculados por OUTRA via (consultas diretas ao banco + calculo de semana/dia independente do
 * service), nunca copiando a saida da API.
 */
const DOMAIN = '@e2e-rstu.local';
const DAY = 86_400_000;
const SP = 'America/Sao_Paulo';

/** Dia civil de SP de um instante (calculo independente do service: toLocaleDateString). */
const spDayOf = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: SP });
/** Segunda-feira da semana do dia civil (independente do service). */
const mondayOf = (dayStr: string) => {
  const d = new Date(`${dayStr}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * DAY).toISOString().slice(0, 10);
};
const plusDays = (dayStr: string, n: number) => new Date(new Date(`${dayStr}T12:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);

describe('Ginga Rank — lado do aluno (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let ranking: RankingService;
  let studentService: RankingStudentService;
  const tag = `${Date.now()}`;
  const city = `RstuCity${tag}`;
  const state = `Y${tag.slice(-5)}`;
  const today = todaySaoPaulo();
  const season = today.slice(0, 7);
  const [cy, cm] = season.split('-').map(Number);
  const lastDayOfMonth = new Date(Date.UTC(cy, cm, 0)).toISOString().slice(0, 10);
  const prevMonthDay = new Date(Date.UTC(cy, cm - 2, 15)).toISOString().slice(0, 10);

  let orgA: SecondOrg;
  let orgB: SecondOrg;
  const s: Record<string, number> = {};
  const users: Record<string, { id: number; email: string; token: string }> = {};
  const created = { rodaIds: [] as number[], eventIds: [] as number[] };
  let otherGroupEventId = 0;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (url: string, token: string) => http().get(url).set(auth(token));
  const post = (url: string, token: string) => http().post(url).set(auth(token));

  async function newUser(key: string, orgId: number, role: 'ALUNO' | 'RESPONSAVEL') {
    const email = `${key}-${tag}${DOMAIN}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `[e2e-rstu] ${key}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    await prisma.organizationUser.create({ data: { organizationId: orgId, userId: user.id, role, status: 'ACTIVE' } });
    const { token } = await loginAs(app, email);
    users[key] = { id: user.id, email, token };
    return user.id;
  }

  async function newStudent(key: string, org: SecondOrg, name: string, opts: { birth?: Date; status?: StudentStatus; userId?: number; joinedAt?: Date } = {}) {
    const st = await prisma.student.create({
      data: {
        organizationId: org.organizationId,
        name,
        birthDate: opts.birth ?? new Date('1990-05-05T00:00:00.000Z'),
        status: opts.status ?? 'ACTIVE',
        userId: opts.userId,
        joinedAt: opts.joinedAt,
      },
    });
    s[key] = st.id;
    return st.id;
  }

  const lesson = async (org: SecondOrg, classId: number, dayStr: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') =>
    (await prisma.lesson.create({ data: { organizationId: org.organizationId, classId, date: new Date(`${dayStr}T00:00:00.000Z`), status } })).id;
  const mark = (org: SecondOrg, key: string, lessonId: number, present = true) =>
    prisma.attendance.create({ data: { organizationId: org.organizationId, lessonId, studentId: s[key], present } });

  before(async () => {
    app = await createTestApp(); // throttle LIGADO (o spec prova o 429 do check-in diario)
    ranking = app.get(RankingService);
    studentService = app.get(RankingStudentService);
    orgA = await createSecondOrg(app, prisma, 'rstu-a');
    orgB = await createSecondOrg(app, prisma, 'rstu-b');
    await prisma.organization.update({ where: { id: orgA.organizationId }, data: { name: '[e2e-rstu] Alfa', city, state } });
    await prisma.organization.update({ where: { id: orgB.organizationId }, data: { name: '[e2e-rstu] Beta' } });

    // --- Grupo A ---
    const a1User = await newUser('a1', orgA.organizationId, 'ALUNO');
    const guardianUser = await newUser('guardian', orgA.organizationId, 'RESPONSAVEL');
    const capperUser = await newUser('capper', orgA.organizationId, 'ALUNO');
    const inactiveUser = await newUser('inactive', orgA.organizationId, 'ALUNO');
    const thrUser = await newUser('thr', orgA.organizationId, 'ALUNO');
    const thr2User = await newUser('thr2', orgA.organizationId, 'ALUNO');
    await newStudent('a1', orgA, 'Ana Rstu Silva', { userId: a1User, joinedAt: new Date(new Date(`${today}T00:00:00Z`).getTime() - 400 * DAY) });
    await newStudent('kid', orgA, 'Kiko Rstu Menor', { birth: new Date(Date.now() - 10 * 365.25 * DAY) });
    await prisma.studentGuardian.create({
      data: { organizationId: orgA.organizationId, studentId: s.kid, userId: guardianUser, name: 'Resp Rstu', consentPublicProfile: false },
    });
    // dependente INATIVO do mesmo responsavel (o responsavel segue entrando pelo dependente ativo)
    await newStudent('kidOff', orgA, 'Kika Rstu Inativa', { birth: new Date(Date.now() - 9 * 365.25 * DAY), status: 'INACTIVE' });
    await prisma.studentGuardian.create({
      data: { organizationId: orgA.organizationId, studentId: s.kidOff, userId: guardianUser, name: 'Resp Rstu', consentPublicProfile: false },
    });
    await newStudent('capper', orgA, 'Caio Rstu Teto', { userId: capperUser });
    await newStudent('inactive', orgA, 'Ines Rstu Inativa', { userId: inactiveUser, status: 'INACTIVE' });
    await newStudent('thr', orgA, 'Tito Rstu Limite', { userId: thrUser });
    await newStudent('thr2', orgA, 'Tina Rstu Limite', { userId: thr2User });
    for (let i = 0; i < 6; i += 1) await newStudent(`f${i}`, orgA, `Filler Rstu ${i}`); // grupo A com >= 10 alunos ativos (raridade)

    // Turma A (matricula ATIVA do a1 e do capper): aulas do mes corrente.
    const klassA = (await prisma.class.create({ data: { organizationId: orgA.organizationId, name: '[e2e-rstu] Turma A', autoGenerateLessons: false } })).id;
    const klassHist = (await prisma.class.create({ data: { organizationId: orgA.organizationId, name: '[e2e-rstu] Turma Hist', autoGenerateLessons: false } })).id;
    const klassOther = (await prisma.class.create({ data: { organizationId: orgA.organizationId, name: '[e2e-rstu] Turma Outra', autoGenerateLessons: false } })).id;
    for (const key of ['a1', 'capper']) {
      await prisma.classStudent.create({ data: { organizationId: orgA.organizationId, classId: klassA, studentId: s[key], status: 'ACTIVE' } });
    }
    await prisma.classStudent.create({ data: { organizationId: orgA.organizationId, classId: klassHist, studentId: s.a1, status: 'INACTIVE' } });
    const l1 = await lesson(orgA, klassA, today);
    const l2 = await lesson(orgA, klassA, today);
    for (let i = 0; i < 3; i += 1) await lesson(orgA, klassA, lastDayOfMonth); // ainda por vir (sem chamada)
    await lesson(orgA, klassA, today, 'INACTIVE'); // cancelada: nao conta
    await lesson(orgA, klassA, prevMonthDay); // outro mes: nao conta
    await lesson(orgA, klassOther, today); // turma sem matricula: nao conta
    await mark(orgA, 'a1', l1, true);
    await mark(orgA, 'a1', l2, false);

    // Historico do a1 (turma antiga): marco/2025 com 4 aulas 100% (mes consistente + mes perfeito + 4 semanas seguidas)
    // e abril/2025 com 3 semanas seguidas. A presenca de hoje vem depois de > 30 dias sem aula (COMEBACK).
    for (const d of ['2025-03-03', '2025-03-10', '2025-03-17', '2025-03-24', '2025-04-07', '2025-04-14', '2025-04-21']) {
      await mark(orgA, 'a1', await lesson(orgA, klassHist, d), true);
    }
    const ev = await prisma.event.create({ data: { organizationId: orgA.organizationId, title: `[e2e-rstu] Evento ${tag}`, date: new Date('2025-03-10T18:00:00.000Z') } });
    created.eventIds.push(ev.id);
    await prisma.eventParticipant.create({ data: { organizationId: orgA.organizationId, eventId: ev.id, studentId: s.a1, status: 'ATTENDED' } });
    await prisma.eventParticipant.create({ data: { organizationId: orgA.organizationId, eventId: ev.id, studentId: s.kid, status: 'ATTENDED' } });
    const roda = await prisma.roda.create({ data: { organizationId: orgA.organizationId, title: `[e2e-rstu] Roda ${tag}`, date: new Date('2025-05-01T18:00:00.000Z') } });
    created.rodaIds.push(roda.id);
    await prisma.rodaParticipant.create({ data: { rodaId: roda.id, studentId: s.a1, status: 'ATTENDED' } });
    const system = await prisma.graduationSystem.create({ data: { organizationId: orgA.organizationId, name: '[e2e-rstu] Cordas' } });
    const verde = await prisma.graduationLevel.create({ data: { organizationId: orgA.organizationId, graduationSystemId: system.id, name: 'Verde', order: 1 } });
    await prisma.studentGraduation.create({ data: { organizationId: orgA.organizationId, studentId: s.a1, graduationLevelId: verde.id, graduatedAt: new Date('2025-06-10T00:00:00.000Z') } });
    await prisma.certificate.create({ data: { organizationId: orgA.organizationId, studentId: s.a1, title: '[e2e-rstu] Certificado', issuedAt: new Date('2025-06-11T15:00:00.000Z') } });
    // check-ins diarios antigos: semana de 2025-06-02 com 5 dias (encerrada => +5)
    for (const d of ['2025-06-02', '2025-06-03', '2025-06-04', '2025-06-05', '2025-06-06']) {
      await prisma.dailyCheckin.create({ data: { organizationId: orgA.organizationId, studentId: s.a1, day: d } });
    }
    // Conquista de raridade conhecida entre os fillers (RODA_1 gravada direto: 2 de 6 fillers).
    for (const key of ['f0', 'f1']) await prisma.achievement.create({ data: { studentId: s[key], code: 'RODA_1', earnedAt: new Date('2025-01-01T00:00:00Z') } });

    // --- Grupo B (2 alunos ativos: raridade oculta) ---
    const b1User = await newUser('b1', orgB.organizationId, 'ALUNO');
    await newStudent('b1', orgB, 'Bia Rstu Beta', { userId: b1User });
    await newStudent('b2', orgB, 'Beto Rstu Beta');
    const evB = await prisma.event.create({ data: { organizationId: orgB.organizationId, title: `[e2e-rstu] Evento sigiloso B ${tag}`, date: new Date('2025-02-01T18:00:00.000Z') } });
    created.eventIds.push(evB.id);
    otherGroupEventId = evB.id;
    await prisma.eventParticipant.create({ data: { organizationId: orgB.organizationId, eventId: evB.id, studentId: s.b1, status: 'ATTENDED' } });

    for (const key of Object.keys(s)) await ranking.syncStudent(s[key]);
  });

  after(async () => {
    await ranking.idle();
    const orgs = [orgA.organizationId, orgB.organizationId];
    const studentIds = Object.values(s);
    const userIds = [...Object.values(users).map((u) => u.id), orgA.userId, orgB.userId];
    await prisma.rodaParticipant.deleteMany({ where: { rodaId: { in: created.rodaIds } } });
    await prisma.roda.deleteMany({ where: { id: { in: created.rodaIds } } });
    await prisma.eventParticipant.deleteMany({ where: { eventId: { in: created.eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: created.eventIds } } });
    await prisma.certificate.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.studentGraduation.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.graduationLevel.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.graduationSystem.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.attendance.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.lesson.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.classStudent.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.class.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.pointEvent.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.studentGuardian.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.student.deleteMany({ where: { organizationId: { in: orgs } } }); // cascata: DailyCheckin, RankingProfile, Achievement
    await prisma.notification.deleteMany({ where: { OR: [{ organizationId: { in: orgs } }, { userId: { in: userIds } }] } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: orgs } }, { userId: { in: userIds } }] } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: Object.values(users).map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    for (const o of [orgA, orgB]) await o.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------

  it('401 sem token em todas as rotas novas', async () => {
    for (const path of ['/rules', '/me/points', '/me/evolution', '/me/goal', '/me/achievements', '/me/daily-checkin']) {
      await http().get(`/api/ranking${path}`).expect(401);
    }
    await http().post('/api/ranking/me/daily-checkin').expect(401);
  });

  it('GET /ranking/rules: as constantes REAIS de ranking-rules.ts, cache privado', async () => {
    const res = await get('/api/ranking/rules', users.a1.token).expect(200);
    assert.equal(res.headers['cache-control'], 'private, max-age=30');
    assert.deepEqual(res.body, JSON.parse(JSON.stringify(rankingRules())));
    assert.equal(res.body.points.dailyCheckin, 1);
    assert.equal(res.body.points.dailyWeekBonus, 5);
    assert.deepEqual([res.body.limits.dailyWeekTarget, res.body.limits.dailyMonthCapDays, res.body.limits.consistencyMinRate], [5, 20, 0.8]);
    assert.equal(res.body.achievements.length, ACHIEVEMENTS.length);
    // qualquer membro (mestre sem cadastro de aluno tambem)
    await get('/api/ranking/rules', orgA.token).expect(200);
  });

  it('sync: conquistas retroativas novas NAO notificam (fora da janela de 7 dias); recente e as 6 originais notificam como sempre', async () => {
    const codes = (await prisma.achievement.findMany({ where: { studentId: s.a1, NOT: { code: { startsWith: 'LEAGUE_' } } } })).map((a) => a.code).sort();
    assert.deepEqual(codes, ['COMEBACK', 'EVENT_1', 'FIRST_GRADUATION', 'PERFECT_MONTH', 'RODA_1', 'SEQ_4W', 'YEARS_1']);
    const bodies = (await prisma.notification.findMany({ where: { userId: users.a1.id, type: 'RANKING_ACHIEVEMENT' } })).map((n) => n.body);
    const notified = (name: string) => bodies.filter((b) => b.includes(`"${name}"`)).length;
    assert.equal(notified('Voltei!'), 1, 'COMEBACK atingido hoje: notifica');
    assert.equal(notified('Primeiro evento'), 0, 'EVENT_1 de 2025: retroativo, sem notificacao');
    assert.equal(notified('Primeira roda'), 0);
    assert.equal(notified('Um ano de capoeira'), 0);
    assert.equal(notified('Mês perfeito'), 1, 'original: comportamento de sempre');
    assert.equal(notified('Primeira corda'), 1);
    // idempotente: novo sync nao cria nem notifica de novo
    const again = await ranking.syncStudent(s.a1);
    assert.deepEqual([again?.created, again?.updated, again?.removed, again?.newAchievements.length], [0, 0, 0, 0]);
    assert.equal((await prisma.notification.count({ where: { userId: users.a1.id, type: 'RANKING_ACHIEVEMENT' } })), bodies.length);
  });

  // ---------------------------------------------------------------------------------------------
  // Extrato
  // ---------------------------------------------------------------------------------------------

  it('extrato: paginacao (ordem occurredAt desc, id desc), total + X-Total-Count, totais por temporada, allTime', async () => {
    const dbRows = await prisma.pointEvent.findMany({ where: { studentId: s.a1 }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] });
    const first = await get('/api/ranking/me/points?limit=3', users.a1.token).expect(200);
    assert.equal(first.headers['cache-control'], 'private, max-age=30');
    assert.equal(first.headers['x-total-count'], String(dbRows.length));
    assert.equal(first.body.total, dbRows.length);
    assert.deepEqual(first.body.items.map((i: { id: number }) => i.id), dbRows.slice(0, 3).map((r) => r.id));
    const second = await get('/api/ranking/me/points?limit=3&offset=3', users.a1.token).expect(200);
    assert.deepEqual(second.body.items.map((i: { id: number }) => i.id), dbRows.slice(3, 6).map((r) => r.id));
    const def = await get('/api/ranking/me/points', users.a1.token).expect(200);
    assert.equal(def.body.items.length, Math.min(20, dbRows.length), 'limite padrao 20');
    assert.equal(def.body.allTimePoints, dbRows.reduce((n, r) => n + r.points, 0));
    const bySeason = new Map<string, number>();
    for (const r of dbRows) bySeason.set(r.season, (bySeason.get(r.season) ?? 0) + r.points);
    assert.deepEqual(def.body.seasonTotals, [...bySeason.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([season_, points]) => ({ season: season_, points })));
    // filtro de temporada
    const march = await get('/api/ranking/me/points?season=2025-03&limit=50', users.a1.token).expect(200);
    assert.equal(march.body.total, dbRows.filter((r) => r.season === '2025-03').length);
    assert.ok(march.body.items.every((i: { season: string }) => i.season === '2025-03'));
    for (const bad of ['limit=51', 'limit=0', 'offset=-1', 'season=2025-13', 'season=hoje', 'extra=1']) {
      await get(`/api/ranking/me/points?${bad}`, users.a1.token).expect(400);
    }
  });

  it('extrato: rotulos pt-BR montados no servidor; origem de outro grupo = rotulo generico (sem dado de terceiros)', async () => {
    // ponto "orfao" apontando para evento de OUTRO grupo (nunca deve vazar o titulo dele)
    const orphan = await prisma.pointEvent.create({
      data: {
        organizationId: orgA.organizationId, studentId: s.a1, type: 'EVENT_ATTENDANCE', points: 30, refType: 'Event',
        refId: String(otherGroupEventId), occurredAt: new Date('2024-01-05T15:00:00.000Z'), season: '2024-01',
      },
    });
    const gone = await prisma.pointEvent.create({
      data: {
        organizationId: orgA.organizationId, studentId: s.a1, type: 'CLASS_ATTENDANCE', points: 10, refType: 'Lesson',
        refId: '987654321', occurredAt: new Date('2024-01-04T00:00:00.000Z'), season: '2024-01',
      },
    });
    try {
      const all = await get('/api/ranking/me/points?limit=50', users.a1.token).expect(200);
      const labels = new Map<string, string>(all.body.items.map((i: { type: string; occurredAt: string; label: string }) => [`${i.type}|${i.occurredAt.slice(0, 10)}`, i.label]));
      const labelOf = (type: string, d: string) => labels.get(`${type}|${d}`);
      assert.equal(labelOf('CLASS_ATTENDANCE', today), 'Aula: [e2e-rstu] Turma A');
      assert.equal(labelOf('CLASS_ATTENDANCE', '2025-03-03'), 'Aula: [e2e-rstu] Turma Hist');
      assert.equal(labelOf('EVENT_ATTENDANCE', '2025-03-10'), `Evento: [e2e-rstu] Evento ${tag}`);
      assert.equal(labelOf('RODA_PARTICIPATION', '2025-05-01'), `Roda: [e2e-rstu] Roda ${tag}`);
      assert.equal(labelOf('GRADUATION', '2025-06-10'), 'Graduação: Verde');
      assert.equal(labelOf('CERTIFICATE', '2025-06-11'), 'Certificado: [e2e-rstu] Certificado');
      assert.equal(labelOf('MONTHLY_CONSISTENCY', '2025-03-31'), 'Mês consistente: março/2025');
      assert.equal(labelOf('STREAK_BONUS', '2025-03-24'), 'Bônus de sequência (4ª semana seguida)');
      assert.equal(labelOf('STREAK_BONUS', '2025-04-21'), 'Bônus de sequência (3ª semana seguida)');
      assert.equal(labelOf('DAILY_CHECKIN', '2025-06-03'), 'Check-in do dia 03/06');
      assert.equal(labelOf('DAILY_WEEK_BONUS', '2025-06-08'), 'Semana em dia (5 check-ins)');
      const item = (id: number) => all.body.items.find((i: { id: number }) => i.id === id);
      assert.equal(item(orphan.id).label, 'Evento', 'evento de outro grupo => generico');
      assert.equal(item(gone.id).label, 'Aula', 'aula apagada => generico, nunca erro');
      assert.ok(!all.text.includes('sigiloso'), 'nenhum dado do outro grupo');
      assert.deepEqual(Object.keys(item(orphan.id)).sort(), ['id', 'label', 'occurredAt', 'points', 'season', 'type']);
    } finally {
      await prisma.pointEvent.deleteMany({ where: { id: { in: [orphan.id, gone.id] } } });
    }
  });

  it('extrato: dependente pelo responsavel; aluno alheio/de outro grupo = 404 (mesma regra do /ranking/me)', async () => {
    const dep = await get(`/api/ranking/me/points?studentId=${s.kid}`, users.guardian.token).expect(200);
    assert.equal(dep.body.total, await prisma.pointEvent.count({ where: { studentId: s.kid } }));
    assert.ok(dep.body.total > 0);
    await get(`/api/ranking/me/points?studentId=${s.a1}`, users.guardian.token).expect(404);
    await get(`/api/ranking/me/points?studentId=${s.kid}`, users.a1.token).expect(404);
    await get(`/api/ranking/me/points?studentId=${s.b1}`, users.a1.token).expect(404);
    await get('/api/ranking/me/points', orgA.token).expect(404); // mestre sem cadastro de aluno
  });

  // ---------------------------------------------------------------------------------------------
  // Evolucao
  // ---------------------------------------------------------------------------------------------

  /** Esperado por outra via: linhas do banco + dia/semana calculados aqui. */
  async function expectedEvolution(studentId: number, granularity: 'WEEK' | 'MONTH', count: number) {
    const rows = await prisma.pointEvent.findMany({ where: { studentId } });
    const dayOf = (r: (typeof rows)[number]) =>
      r.type === 'CLASS_ATTENDANCE' || r.type === 'GRADUATION' ? r.occurredAt.toISOString().slice(0, 10) : spDayOf(r.occurredAt);
    const keyOf = (r: (typeof rows)[number]) => (granularity === 'WEEK' ? mondayOf(dayOf(r)) : r.season);
    const keys: string[] = [];
    for (let i = count - 1; i >= 0; i -= 1) {
      keys.push(granularity === 'WEEK' ? plusDays(mondayOf(today), -7 * i) : new Date(Date.UTC(cy, cm - 1 - i, 1)).toISOString().slice(0, 7));
    }
    return keys.map((key) => ({
      key,
      points: rows.filter((r) => keyOf(r) === key).reduce((n, r) => n + r.points, 0),
      cumulative: rows.filter((r) => keyOf(r) <= key).reduce((n, r) => n + r.points, 0),
      lessons: rows.filter((r) => keyOf(r) === key && r.type === 'CLASS_ATTENDANCE').length,
    }));
  }

  it('evolucao: sempre `count` pontos (zeros incluidos), do mais antigo ao mais novo, cumulativo de todos os tempos', async () => {
    const week = await get('/api/ranking/me/evolution', users.a1.token).expect(200);
    assert.equal(week.headers['cache-control'], 'private, max-age=30');
    assert.equal(week.body.granularity, 'WEEK');
    assert.deepEqual(week.body.points, await expectedEvolution(s.a1, 'WEEK', 12));
    assert.equal(week.body.points.length, 12);
    assert.equal(week.body.points[11].key, mondayOf(today));
    assert.ok(week.body.points.some((p: { points: number }) => p.points === 0), 'semanas sem ponto aparecem com zero');
    const allTime = (await prisma.pointEvent.aggregate({ _sum: { points: true }, where: { studentId: s.a1 } }))._sum.points ?? 0;
    assert.equal(week.body.points[11].cumulative, allTime);

    const four = await get('/api/ranking/me/evolution?count=4', users.a1.token).expect(200);
    assert.deepEqual(four.body.points, await expectedEvolution(s.a1, 'WEEK', 4));
    const month = await get('/api/ranking/me/evolution?granularity=MONTH&count=26', users.a1.token).expect(200);
    assert.deepEqual(month.body.points, await expectedEvolution(s.a1, 'MONTH', 26));
    assert.equal(month.body.points[25].key, season);
    assert.ok(month.body.points.find((p: { key: string }) => p.key === '2025-03').lessons === 4);
    // sequencias: as semanas de marco/2025 (4 seguidas) sao a melhor; a atual = 1 (presenca de hoje)
    assert.equal(month.body.bestStreakWeeks, 4);
    assert.equal(month.body.currentStreakWeeks, 1);
    assert.ok(month.body.bestWeek && month.body.bestWeek.points > 0);
    for (const bad of ['count=3', 'count=27', 'granularity=DAY']) await get(`/api/ranking/me/evolution?${bad}`, users.a1.token).expect(400);
    await get(`/api/ranking/me/evolution?studentId=${s.kid}`, users.a1.token).expect(404);
  });

  // ---------------------------------------------------------------------------------------------
  // Meta do mes
  // ---------------------------------------------------------------------------------------------

  it('meta: planejadas (so ativas, das turmas com matricula ativa, do mes), feitas, presentes, necessario, ainda da', async () => {
    const res = await get('/api/ranking/me/goal', users.a1.token).expect(200);
    assert.equal(res.headers['cache-control'], 'private, max-age=30');
    const present = await prisma.pointEvent.count({ where: { studentId: s.a1, type: 'CLASS_ATTENDANCE', season } });
    assert.equal(present, 1);
    const b = res.body;
    assert.equal(b.season, season);
    assert.equal(b.lessonsPlanned, 5, '2 hoje + 3 por vir (cancelada, outro mes e turma sem matricula fora)');
    assert.equal(b.lessonsDone, 2, 'as 2 de hoje tem chamada');
    assert.equal(b.present, present);
    assert.equal(b.neededForBonus, 4, 'ceil(0.8 x 5) = 4');
    assert.equal(b.remainingForBonus, 3);
    assert.equal(b.canStillReach, true, '1 presente + 3 por vir >= 4');
    assert.equal(b.bonusPoints, 50);
    assert.equal(b.hasGoal, true);
    const allTime = (await prisma.pointEvent.aggregate({ _sum: { points: true }, where: { studentId: s.a1 } }))._sum.points ?? 0;
    assert.equal(b.league.pointsToNext, b.league.next ? b.league.next.minPoints - allTime : 0);
    assert.ok(b.league.current.code && b.league.current.color && b.league.progressPct >= 0);
    // capper: mesma turma, nenhuma presenca => 0 + 3 < 4
    const capper = await get('/api/ranking/me/goal', users.capper.token).expect(200);
    assert.deepEqual([capper.body.lessonsPlanned, capper.body.present, capper.body.neededForBonus, capper.body.canStillReach], [5, 0, 4, false]);
    // dependente sem turma: mes sem aulas = sem meta
    const kid = await get(`/api/ranking/me/goal?studentId=${s.kid}`, users.guardian.token).expect(200);
    assert.deepEqual(
      [kid.body.hasGoal, kid.body.lessonsPlanned, kid.body.neededForBonus, kid.body.remainingForBonus, kid.body.canStillReach],
      [false, 0, 0, 0, false],
    );
    await get(`/api/ranking/me/goal?studentId=${s.a1}`, users.guardian.token).expect(404);
  });

  // ---------------------------------------------------------------------------------------------
  // Conquistas
  // ---------------------------------------------------------------------------------------------

  it('conquistas: todas (ganhas ou nao), ordem familia/nivel, progresso dos contadores, raridade agregada do grupo', async () => {
    const res = await get('/api/ranking/me/achievements', users.a1.token).expect(200);
    assert.equal(res.headers['cache-control'], 'private, max-age=30');
    const b = res.body;
    assert.equal(b.totalCount, ACHIEVEMENTS.length);
    assert.equal(b.items.length, ACHIEVEMENTS.length);
    assert.equal(b.items[0].code, 'AULAS_25');
    assert.equal(b.items[b.items.length - 1].family, 'DIARIO');
    const earnedDb = await prisma.achievement.findMany({ where: { studentId: s.a1, NOT: { code: { startsWith: 'LEAGUE_' } } } });
    assert.equal(b.earnedCount, earnedDb.length);
    const item = (code: string) => b.items.find((i: { code: string }) => i.code === code);
    // ganha
    const perfect = item('PERFECT_MONTH');
    assert.deepEqual([perfect.earned, perfect.tier, perfect.family, perfect.icon, perfect.progress], [true, 'GOLD', 'MES', 'mes', null]);
    assert.equal(perfect.earnedAt, earnedDb.find((a) => a.code === 'PERFECT_MONTH')?.earnedAt.toISOString());
    // bloqueada com progresso (contagem independente: CLASS_ATTENDANCE no banco)
    const lessons = await prisma.pointEvent.count({ where: { studentId: s.a1, type: 'CLASS_ATTENDANCE' } });
    assert.equal(lessons, 8);
    assert.deepEqual([item('AULAS_25').earned, item('AULAS_25').earnedAt, item('AULAS_25').progress], [false, null, { current: 8, target: 25 }]);
    assert.deepEqual(item('SEQ_8W').progress, { current: 4, target: 8 });
    assert.deepEqual(item('DAILY_7').progress, { current: 5, target: 7 });
    assert.deepEqual(item('RODA_1').progress, { current: 1, target: 1 });
    // raridade: % dos alunos ATIVOS do grupo com a conquista (1 casa), calculada aqui por outra via
    const active = await prisma.student.count({ where: { organizationId: orgA.organizationId, status: 'ACTIVE' } });
    assert.ok(active >= 10);
    for (const code of ['RODA_1', 'PERFECT_MONTH', 'AULAS_1000']) {
      const holders = await prisma.achievement.count({ where: { code, student: { organizationId: orgA.organizationId, status: 'ACTIVE' } } });
      assert.equal(item(code).rarityPct, Math.round((holders / active) * 1000) / 10, code);
    }
    assert.equal(item('RODA_1').rarityPct, Math.round((3 / active) * 1000) / 10, 'a1 + 2 fillers');
    assert.equal(item('AULAS_1000').rarityPct, 0);
    assert.deepEqual(b.showcase, []);
  });

  it('conquistas: grupo com < 10 alunos ativos => rarityPct null em todas; dependente alheio = 404', async () => {
    const res = await get('/api/ranking/me/achievements', users.b1.token).expect(200);
    assert.ok(res.body.items.every((i: { rarityPct: number | null }) => i.rarityPct === null));
    assert.equal(res.body.items.find((i: { code: string }) => i.code === 'EVENT_1').earned, true);
    await get(`/api/ranking/me/achievements?studentId=${s.a1}`, users.b1.token).expect(404);
  });

  // ---------------------------------------------------------------------------------------------
  // Check-in diario
  // ---------------------------------------------------------------------------------------------

  it('check-in diario: 1o toque pontua (+1), 2o e idempotente; dia SO do servidor (SP); corpo com campo = 400', async () => {
    const before = await get('/api/ranking/me/daily-checkin', users.a1.token).expect(200);
    assert.equal(before.headers['cache-control'], 'private, max-age=30');
    assert.equal(before.body.today, today);
    assert.equal(before.body.checkedInToday, false);
    assert.deepEqual([before.body.weekTarget, before.body.monthCapDays], [5, 20]);
    assert.deepEqual(before.body.last7.map((d: { day: string }) => d.day), Array.from({ length: 7 }, (_, i) => plusDays(today, i - 6)));

    await post('/api/ranking/me/daily-checkin', users.a1.token).send({ day: '2020-01-01' }).expect(400);
    await post('/api/ranking/me/daily-checkin', users.a1.token).send({ studentId: s.a1 }).expect(400);
    assert.equal(await prisma.dailyCheckin.count({ where: { studentId: s.a1, day: { gte: '2026-01-01' } } }), 0, 'nada gravado pelos 400');

    const first = await post('/api/ranking/me/daily-checkin', users.a1.token).expect(200);
    assert.equal(first.body.alreadyCheckedIn, false);
    assert.equal(first.body.pointsToday, 1);
    assert.equal(first.body.checkedInToday, true);
    assert.equal(first.body.today, today);
    assert.deepEqual(first.body.last7[6], { day: today, done: true });
    assert.equal(first.body.weekDays, 1);
    assert.equal(first.body.monthDays, 1);
    const second = await post('/api/ranking/me/daily-checkin', users.a1.token).expect(200);
    assert.deepEqual([second.body.alreadyCheckedIn, second.body.pointsToday, second.body.checkedInToday], [true, 0, true]);
    assert.equal(await prisma.dailyCheckin.count({ where: { studentId: s.a1, day: today } }), 1);

    await ranking.idle(); // queueSync (fire-and-forget) do POST
    const pt = await prisma.pointEvent.findMany({ where: { studentId: s.a1, type: 'DAILY_CHECKIN', refId: today } });
    assert.deepEqual(pt.map((p) => [p.points, p.refType, p.season]), [[1, 'Day', season]]);
    assert.equal(
      await prisma.pointEvent.count({ where: { studentId: s.a1, type: 'DAILY_WEEK_BONUS', refId: mondayOf(today) } }),
      0,
      'semana corrente (nao encerrada) nao da bonus',
    );
    // check-in nao entra em TRAINING
    const training = await get('/api/ranking/students?scope=GROUP&category=TRAINING&season=ALL&limit=100', users.a1.token).expect(200);
    const mine = training.body.items.find((i: { studentId: number }) => i.studentId === s.a1);
    assert.equal(mine.points, (await prisma.pointEvent.aggregate({ _sum: { points: true }, where: { studentId: s.a1, type: { in: ['CLASS_ATTENDANCE', 'STREAK_BONUS', 'MONTHLY_CONSISTENCY'] } } }))._sum.points);
  });

  it('check-in diario: concorrencia (5 toques simultaneos) grava 1 linha e pontua 1 vez; dependente pelo responsavel', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => post(`/api/ranking/me/daily-checkin?studentId=${s.kid}`, users.guardian.token)));
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(results.filter((r) => r.body.alreadyCheckedIn === false).length, 1);
    assert.equal(results.filter((r) => r.body.pointsToday === 1).length, 1);
    assert.equal(await prisma.dailyCheckin.count({ where: { studentId: s.kid } }), 1);
    await post(`/api/ranking/me/daily-checkin?studentId=${s.a1}`, users.guardian.token).expect(404);
    await get(`/api/ranking/me/daily-checkin?studentId=${s.a1}`, users.guardian.token).expect(404);
  });

  it('check-in diario: dependente INATIVO = 403 STUDENT_NOT_ACTIVE; aluno inativo com login proprio nem autentica (401); sem aluno = 404', async () => {
    const g = await get(`/api/ranking/me/daily-checkin?studentId=${s.kidOff}`, users.guardian.token).expect(403);
    assert.equal(g.body.code, 'STUDENT_NOT_ACTIVE');
    const p = await post(`/api/ranking/me/daily-checkin?studentId=${s.kidOff}`, users.guardian.token).expect(403);
    assert.equal(p.body.code, 'STUDENT_NOT_ACTIVE');
    assert.equal(await prisma.dailyCheckin.count({ where: { studentId: s.kidOff } }), 0);
    // regra existente (student-inactive-login.e2e-spec.ts): o token do aluno cujo unico vinculo esta INATIVO e' recusado
    await post('/api/ranking/me/daily-checkin', users.inactive.token).expect(401);
    assert.equal(await prisma.dailyCheckin.count({ where: { studentId: s.inactive } }), 0);
    await post('/api/ranking/me/daily-checkin', orgA.token).expect(404);
  });

  it('check-in diario: teto de 20 dias por mes (21o nao pontua) e bonus so de semana encerrada com >= 5 dias (relogio injetado no service)', async () => {
    const capperUser = { id: users.capper.id, email: users.capper.email, userType: 'MEMBER' as const, isSuperAdmin: false, organizationId: orgA.organizationId };
    for (let d = 1; d <= 20; d += 1) {
      await prisma.dailyCheckin.create({ data: { organizationId: orgA.organizationId, studentId: s.capper, day: `2025-08-${String(d).padStart(2, '0')}` } });
    }
    for (let d = 1; d <= 19; d += 1) {
      await prisma.dailyCheckin.create({ data: { organizationId: orgA.organizationId, studentId: s.capper, day: `2025-09-${String(d).padStart(2, '0')}` } });
    }
    const over = await studentService.dailyCheckin(capperUser, undefined, new Date('2025-08-25T15:00:00.000Z'));
    assert.deepEqual([over.today, over.alreadyCheckedIn, over.monthDays, over.pointsToday], ['2025-08-25', false, 21, 0]);
    const atCap = await studentService.dailyCheckin(capperUser, undefined, new Date('2025-09-25T15:00:00.000Z'));
    assert.deepEqual([atCap.today, atCap.monthDays, atCap.pointsToday], ['2025-09-25', 20, 1]);
    await ranking.idle();
    await ranking.syncStudent(s.capper);
    const count = (season_: string, type: 'DAILY_CHECKIN' | 'DAILY_WEEK_BONUS') => prisma.pointEvent.count({ where: { studentId: s.capper, season: season_, type } });
    assert.equal(await count('2025-08', 'DAILY_CHECKIN'), 20, '21 dias em agosto: so 20 pontuam');
    assert.equal(await count('2025-09', 'DAILY_CHECKIN'), 20);
    assert.equal(
      await prisma.pointEvent.count({ where: { studentId: s.capper, type: 'DAILY_CHECKIN', refId: '2025-08-25' } }),
      0,
      'o dia acima do teto nao pontua',
    );
    // semanas (segunda a domingo) com >= 5 dias: 04/08 e 11/08 (7 dias cada); 28/07 (01..03/08 = 3), 18/08 (18..20 = 3) e
    // 25/08 (so o dia 25) nao; setembro: 01, 08 (7 dias) e 15 (15..19 = 5); 22/09 (so o 25) nao.
    const weeks = (await prisma.pointEvent.findMany({ where: { studentId: s.capper, type: 'DAILY_WEEK_BONUS' }, orderBy: { refId: 'asc' } })).map((p) => [p.refId, p.points]);
    assert.deepEqual(weeks, [['2025-08-04', 5], ['2025-08-11', 5], ['2025-09-01', 5], ['2025-09-08', 5], ['2025-09-15', 5]]);
    const achievements = (await prisma.achievement.findMany({ where: { studentId: s.capper } })).map((a) => a.code);
    assert.ok(achievements.includes('DAILY_30'), '41 dias de check-in (inclusive os acima do teto)');
    assert.ok(!achievements.includes('WEEK_OK_4'), 'no maximo 3 semanas em dia SEGUIDAS (01, 08, 15/09)');
  });

  it('check-in diario: throttle 429 TOO_MANY_REQUESTS por USUARIO (outro usuario do mesmo IP segue livre)', async () => {
    process.env.RANKING_DAILY_CHECKIN_THROTTLE_LIMIT = '2';
    try {
      await post('/api/ranking/me/daily-checkin', users.thr.token).expect(200);
      await post('/api/ranking/me/daily-checkin', users.thr.token).expect(200);
      const limited = await post('/api/ranking/me/daily-checkin', users.thr.token).expect(429);
      assert.equal(limited.body.code, 'TOO_MANY_REQUESTS');
      await post('/api/ranking/me/daily-checkin', users.thr2.token).expect(200);
    } finally {
      process.env.RANKING_DAILY_CHECKIN_THROTTLE_LIMIT = '1000';
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Vitrine
  // ---------------------------------------------------------------------------------------------

  it('vitrine: 0..3 conquistas ja ganhas; nao ganha/marcador/desconhecida = 400 ACHIEVEMENT_NOT_EARNED; >3/duplicada/invalida = 400', async () => {
    const put = (body: unknown, token = users.a1.token, qs = '') => http().put(`/api/ranking/me/settings${qs}`).set(auth(token)).send(body as object);
    for (const showcase of [['CENTURION'], ['FIRST_GRADUATION', 'AULAS_25'], ['LEAGUE_VERDE'], ['NAO_EXISTE']]) {
      const r = await put({ showcase }).expect(400);
      assert.equal(r.body.code, 'ACHIEVEMENT_NOT_EARNED', JSON.stringify(showcase));
    }
    await put({ showcase: ['FIRST_GRADUATION', 'RODA_1', 'EVENT_1', 'SEQ_4W'] }).expect(400); // > 3
    await put({ showcase: ['RODA_1', 'RODA_1'] }).expect(400); // duplicada
    await put({ showcase: 'RODA_1' }).expect(400);
    await put({ showcase: [1] }).expect(400);
    assert.deepEqual((await prisma.rankingProfile.findUnique({ where: { studentId: s.a1 } }))?.showcase ?? [], [], 'nada gravado pelos 400');

    const ok = await put({ showcase: ['PERFECT_MONTH', 'RODA_1', 'COMEBACK'] }).expect(200);
    assert.deepEqual(ok.body, { optInPublic: false, nickname: null, canOptIn: true, requiresGuardianConsent: false, showcase: ['PERFECT_MONTH', 'RODA_1', 'COMEBACK'] });
    assert.deepEqual((await get('/api/ranking/me', users.a1.token).expect(200)).body.showcase, ['PERFECT_MONTH', 'RODA_1', 'COMEBACK']);
    assert.deepEqual((await get('/api/ranking/me/achievements', users.a1.token).expect(200)).body.showcase, ['PERFECT_MONTH', 'RODA_1', 'COMEBACK']);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgA.organizationId, action: 'RANKING_SETTINGS', resourceId: String(s.a1) }, orderBy: { id: 'desc' } });
    assert.deepEqual((audit.metadata as { showcase?: string[] }).showcase, ['PERFECT_MONTH', 'RODA_1', 'COMEBACK']);
    // vazia limpa
    assert.deepEqual((await put({ showcase: [] }).expect(200)).body.showcase, []);
    await put({ showcase: ['RODA_1'] }).expect(200);
  });

  it('vitrine: menor SEM consentimento grava a vitrine (nao dispara a regra de consentimento; so optInPublic dispara)', async () => {
    const r = await http().put(`/api/ranking/me/settings?studentId=${s.kid}`).set(auth(users.guardian.token)).send({ showcase: ['EVENT_1'] }).expect(200);
    assert.deepEqual([r.body.showcase, r.body.optInPublic, r.body.requiresGuardianConsent], [['EVENT_1'], false, true]);
    const denied = await http().put(`/api/ranking/me/settings?studentId=${s.kid}`).set(auth(users.guardian.token)).send({ optInPublic: true }).expect(403);
    assert.equal(denied.body.code, 'GUARDIAN_CONSENT_REQUIRED');
  });

  it('vitrine em /ranking/students: so para entradas ja visiveis (GROUP mostra; CITY so com opt-in)', async () => {
    const group = await get('/api/ranking/students?scope=GROUP&limit=100', users.a1.token).expect(200);
    const of = (body: { items: Array<{ studentId: number; showcase: string[] }> }, id: number) => body.items.find((i) => i.studentId === id);
    assert.deepEqual(of(group.body, s.a1)?.showcase, ['RODA_1']);
    assert.deepEqual(of(group.body, s.kid)?.showcase, ['EVENT_1']);
    assert.deepEqual(of(group.body, s.f0)?.showcase, []);
    // CITY: sem opt-in ninguem do grupo A aparece (nem a vitrine)
    const cityBefore = await get('/api/ranking/students?scope=CITY&limit=100', users.a1.token).expect(200);
    assert.equal(of(cityBefore.body, s.a1), undefined);
    assert.ok(!JSON.stringify(cityBefore.body.items).includes('RODA_1'));
    await http().put('/api/ranking/me/settings').set(auth(users.a1.token)).send({ optInPublic: true }).expect(200);
    const cityAfter = await get('/api/ranking/students?scope=CITY&limit=100', users.a1.token).expect(200);
    assert.deepEqual(of(cityAfter.body, s.a1)?.showcase, ['RODA_1']);
    assert.equal(of(cityAfter.body, s.kid), undefined, 'menor sem consentimento continua fora do ranking aberto');
    // outro grupo nao enxerga o grupo A em GROUP
    const b = await get('/api/ranking/students?scope=GROUP', users.b1.token).expect(200);
    assert.ok(b.body.items.every((i: { studentId: number }) => i.studentId !== s.a1));
  });
});
