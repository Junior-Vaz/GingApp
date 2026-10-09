import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { MeFixture, createMeFixture } from './utils/me-fixtures';
import { todaySaoPaulo } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Frequência (attendance.service.ts / attendance.controller.ts) é diferente do padrão CRUD
 * item-a-item dos outros módulos: é registro em LOTE por aula (roster de chamada),
 * PLANO_PROJETO.md §10.5. Reaproveita a turma/aluno do seed de dev, mas cria uma Lesson
 * própria (via Prisma direto) para não sujar aulas reais.
 */
const DEV_PASSWORD = 'Dev@12345';
const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';
const INVALID_STUDENT_ID = 999999;

async function login(app: INestApplication, email: string) {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: DEV_PASSWORD })
    .expect(200);
  return res.body as { accessToken: string; user: { id: number; organizationId: number } };
}

describe('Attendance (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let mestreToken: string;
  let alunoToken: string;
  let organizationId: number;
  let anaStudentId: number;
  let testLessonId: number;

  before(async () => {
    app = await createTestApp();

    const mestreLogin = await login(app, MESTRE_EMAIL);
    mestreToken = mestreLogin.accessToken;
    organizationId = mestreLogin.user.organizationId;

    const alunoLogin = await login(app, ALUNO_EMAIL);
    alunoToken = alunoLogin.accessToken;

    const ana = await prisma.student.findFirstOrThrow({
      where: { organizationId, user: { email: ALUNO_EMAIL } },
    });
    anaStudentId = ana.id;

    // Turma do seed em que a Ana está matriculada (prisma/seed.ts, passo 8).
    const turma = await prisma.class.findFirstOrThrow({
      where: { organizationId, name: 'Adulto — Quinta 19h' },
    });

    // Lesson de teste própria — mais simples que passar pela API, e evita sujar aulas reais.
    const lesson = await prisma.lesson.create({
      data: { organizationId, classId: turma.id, date: new Date() },
    });
    testLessonId = lesson.id;
  });

  after(async () => {
    await prisma.attendance.deleteMany({ where: { lessonId: testLessonId } });
    await prisma.lesson.delete({ where: { id: testLessonId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('GET /attendance/lessons/:lessonId antes de registrar — cada aluno matriculado aparece com present: null', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/attendance/lessons/${testLessonId}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    const anaEntry = res.body.find((entry: { studentId: number }) => entry.studentId === anaStudentId);
    assert.ok(anaEntry, 'Ana deveria aparecer no roster (está matriculada na turma)');
    assert.equal(anaEntry.present, null);
  });

  it('POST /attendance/lessons/:lessonId registra presença — 201, e a linha é criada de verdade no banco', async () => {
    await request(app.getHttpServer())
      .post(`/api/attendance/lessons/${testLessonId}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send([{ studentId: anaStudentId, present: true }])
      .expect(201);

    const persisted = await prisma.attendance.findUnique({
      where: { lessonId_studentId: { lessonId: testLessonId, studentId: anaStudentId } },
    });
    assert.ok(persisted !== null);
    assert.equal(persisted?.present, true);
  });

  it('GET /attendance/lessons/:lessonId depois de registrar — agora present: true para a Ana', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/attendance/lessons/${testLessonId}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    const anaEntry = res.body.find((entry: { studentId: number }) => entry.studentId === anaStudentId);
    assert.equal(anaEntry.present, true);
  });

  it('POST /attendance/lessons/:lessonId com studentId inexistente — 400, e nenhuma linha nova é criada', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/attendance/lessons/${testLessonId}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send([{ studentId: INVALID_STUDENT_ID, present: true }])
      .expect(400);

    assert.equal(res.body.message, 'Aluno inválido para esta organização.');

    const invalidRow = await prisma.attendance.findFirst({
      where: { lessonId: testLessonId, studentId: INVALID_STUDENT_ID },
    });
    assert.equal(invalidRow, null);
  });

  it('GET /attendance/me logado como o aluno — inclui o registro recém-criado, com last30dPercent calculado', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/attendance/me')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);

    assert.ok(Array.isArray(res.body.records));
    const record = res.body.records.find((r: { lessonId: number }) => r.lessonId === testLessonId);
    assert.ok(record, 'o registro de presença criado neste teste deveria aparecer em /attendance/me');
    assert.equal(record.present, true);

    const isNumberOrNull = typeof res.body.last30dPercent === 'number' || res.body.last30dPercent === null;
    assert.ok(isNumberOrNull, `last30dPercent deveria ser number ou null, veio: ${typeof res.body.last30dPercent}`);
  });
});

/**
 * "Minha frequência" com >50 registros: antes /attendance/me devolvia só os 50 mais recentes e
 * calculava last30dPercent em cima deles; o app calculava mês/sequência em cima da mesma lista
 * truncada. Agora records é paginado (from/to + limit/offset + X-Total-Count) e os indicadores
 * (last30dPercent, currentStreak) são agregados no banco sobre todo o histórico.
 */
describe('Attendance /me — paginação, filtro por período e indicadores agregados (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let fx: MeFixture;
  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(`/api${path}`).set('Authorization', `Bearer ${token}`);
  const civil = (daysAgo: number) => new Date(`${todaySaoPaulo(-daysAgo)}T00:00:00.000Z`);
  const day = (daysAgo: number) => todaySaoPaulo(-daysAgo);

  // Aluno: 60 registros (d = 0..59 dias atrás), faltas em d = 12, 30 e 45.
  const ABSENT = new Set([12, 30, 45]);

  before(async () => {
    app = await createTestApp();
    fx = await createMeFixture(app, prisma, 'attme');
    const org = fx.organizationId;

    // 70 aulas da turma do aluno/dependente (d = 0..69) e 3 da turma alheia.
    await prisma.lesson.createMany({
      data: Array.from({ length: 70 }, (_, d) => ({ organizationId: org, classId: fx.classMineId, date: civil(d) })),
    });
    await prisma.lesson.createMany({
      data: [0, 1, 2].map((d) => ({ organizationId: org, classId: fx.classOtherId, date: civil(d) })),
    });
    const mine = await prisma.lesson.findMany({ where: { classId: fx.classMineId } });
    const other = await prisma.lesson.findMany({ where: { classId: fx.classOtherId } });
    const byDay = new Map(mine.map((l) => [l.date.toISOString().slice(0, 10), l.id]));
    const lessonOf = (d: number) => byDay.get(day(d))!;

    await prisma.attendance.createMany({
      data: [
        ...Array.from({ length: 60 }, (_, d) => ({
          organizationId: org,
          lessonId: lessonOf(d),
          studentId: fx.self.studentId,
          present: !ABSENT.has(d),
          justification: ABSENT.has(d) ? `falta ${d}` : null,
        })),
        // dependente: 58 presenças seguidas (sequência maior que uma página)
        ...Array.from({ length: 58 }, (_, d) => ({
          organizationId: org,
          lessonId: lessonOf(d),
          studentId: fx.guardian.dependentId,
          present: true,
        })),
        // aluno alheio: faltas nas aulas de hoje/ontem/anteontem — não podem vazar na sequência de ninguém
        ...other.map((l) => ({ organizationId: org, lessonId: l.id, studentId: fx.strangerId, present: false })),
      ],
    });
  });

  after(async () => {
    await fx.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('60 registros: sem limit vêm 50 (mais recentes primeiro por data da AULA), X-Total-Count = 60 e a 2ª página completa sem repetir', async () => {
    const first = await get('/attendance/me', fx.self.token).expect(200);
    assert.equal(first.body.records.length, 50);
    assert.equal(first.headers['x-total-count'], '60');
    const dates = first.body.records.map((r: { lesson: { date: string } }) => r.lesson.date.slice(0, 10));
    assert.deepEqual(dates, [...dates].sort().reverse()); // data da aula decrescente
    assert.equal(dates[0], day(0));

    const rest = await get('/attendance/me?offset=50&limit=50', fx.self.token).expect(200);
    assert.equal(rest.body.records.length, 10);
    assert.equal(rest.headers['x-total-count'], '60');

    const ids = [...first.body.records, ...rest.body.records].map((r: { id: number }) => r.id);
    assert.equal(new Set(ids).size, 60);
    const db = await prisma.attendance.findMany({
      where: { studentId: fx.self.studentId },
      orderBy: [{ lesson: { date: 'desc' } }, { id: 'desc' }],
    });
    assert.deepEqual(ids, db.map((r) => r.id));
    // formato dos registros mantido (o app lê lesson.date/classId, present, justification)
    const r0 = first.body.records[0];
    for (const k of ['id', 'lessonId', 'studentId', 'present', 'justification', 'lesson']) assert.ok(k in r0, k);
    assert.deepEqual(Object.keys(r0.lesson).sort(), ['classId', 'date']);
  });

  it('indicadores vêm do banco e NÃO dependem da página: last30dPercent (borda 30 dias) e sequência > 1 página', async () => {
    // d=0..29 => 30 aulas, 1 falta (d=12) => 29/30 = 97%. A falta de d=30 está FORA da janela
    // (se entrasse seria 29/31 = 94%). Sequência: d=0..11 presentes, falta em d=12 => 12.
    const full = await get('/attendance/me', fx.self.token).expect(200);
    assert.equal(full.body.last30dPercent, 97);
    assert.equal(full.body.currentStreak, 12);
    const tiny = await get('/attendance/me?limit=1', fx.self.token).expect(200);
    assert.equal(tiny.body.records.length, 1);
    assert.equal(tiny.body.last30dPercent, 97);
    assert.equal(tiny.body.currentStreak, 12);
    const filtered = await get(`/attendance/me?from=${day(9)}&to=${day(5)}`, fx.self.token).expect(200);
    assert.equal(filtered.body.last30dPercent, 97);
    assert.equal(filtered.body.currentStreak, 12);

    // dependente: 58 presenças seguidas (> 50 da página) => sequência 58 e 100% — o app jamais
    // chegaria a 58 contando a lista de 50.
    const dep = await get('/attendance/me', fx.guardian.token).expect(200);
    assert.equal(dep.body.records.length, 50);
    assert.equal(dep.headers['x-total-count'], '58');
    assert.equal(dep.body.currentStreak, 58);
    assert.equal(dep.body.last30dPercent, 100);

    // conferência independente (Prisma + JS) do mesmo número
    const rows = await prisma.attendance.findMany({
      where: { studentId: fx.self.studentId },
      include: { lesson: true },
      orderBy: [{ lesson: { date: 'desc' } }, { id: 'desc' }],
    });
    let streak = 0;
    for (const r of rows) {
      if (!r.present) break;
      streak++;
    }
    assert.equal(streak, full.body.currentStreak);
    const since = day(29);
    const win = rows.filter((r) => r.lesson.date.toISOString().slice(0, 10) >= since);
    assert.equal(Math.round((win.filter((r) => r.present).length / win.length) * 100), full.body.last30dPercent);
  });

  it('from/to filtram pela data da AULA (inclusivo; `to` só com data inclui o dia) e o total acompanha o filtro', async () => {
    const range = await get(`/attendance/me?from=${day(9)}&to=${day(5)}`, fx.self.token).expect(200);
    assert.equal(range.headers['x-total-count'], '5'); // d = 5..9
    const dates = range.body.records.map((r: { lesson: { date: string } }) => r.lesson.date.slice(0, 10));
    assert.deepEqual(dates, [day(5), day(6), day(7), day(8), day(9)]);

    const onlyFrom = await get(`/attendance/me?from=${day(9)}`, fx.self.token).expect(200);
    assert.equal(onlyFrom.headers['x-total-count'], '10'); // d = 0..9
    const oneDay = await get(`/attendance/me?from=${day(12)}&to=${day(12)}`, fx.self.token).expect(200);
    assert.equal(oneDay.body.records.length, 1);
    assert.equal(oneDay.body.records[0].present, false);
    assert.equal(oneDay.body.records[0].justification, 'falta 12');

    // um "mês" inteiro vem completo mesmo com o total geral > 50 (o app busca por período)
    const wide = await get(`/attendance/me?from=${day(59)}&to=${day(0)}&limit=200`, fx.self.token).expect(200);
    assert.equal(wide.body.records.length, 60);
    const none = await get(`/attendance/me?from=${day(-30)}`, fx.self.token).expect(200); // futuro
    assert.deepEqual(none.body.records, []);
    assert.equal(none.headers['x-total-count'], '0');
  });

  it('isolamento: aluno só vê o dele (alheio não vaza na lista nem na sequência), responsável só o dependente, sem vínculo nada', async () => {
    const self = await get('/attendance/me?limit=200', fx.self.token).expect(200);
    assert.ok(self.body.records.every((r: { studentId: number }) => r.studentId === fx.self.studentId));
    const dep = await get('/attendance/me?limit=200', fx.guardian.token).expect(200);
    assert.ok(dep.body.records.every((r: { studentId: number }) => r.studentId === fx.guardian.dependentId));
    assert.equal(dep.body.records.length, 58);
    // se as faltas do aluno alheio (hoje/ontem/anteontem) vazassem, a sequência seria 0
    assert.equal(self.body.currentStreak, 12);
    assert.equal(dep.body.currentStreak, 58);

    const orphan = await get('/attendance/me', fx.orphan.token).expect(200);
    assert.deepEqual(orphan.body, { records: [], last30dPercent: null, currentStreak: 0 });
    assert.equal(orphan.headers['x-total-count'], '0');
  });

  it('parâmetros inválidos => 400 (limit=201/0/abc, offset=-1, from/to inválidos, desconhecido); sem token 401', async () => {
    for (const qs of ['limit=201', 'limit=0', 'limit=abc', 'offset=-1', 'from=ontem', 'to=amanha', 'foo=1']) {
      await get(`/attendance/me?${qs}`, fx.self.token).expect(400);
    }
    await get('/attendance/me?limit=200&offset=0', fx.self.token).expect(200);
    await request(app.getHttpServer()).get('/api/attendance/me').expect(401);
  });
});
