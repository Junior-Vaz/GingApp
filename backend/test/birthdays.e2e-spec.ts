import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { BirthdayAutomationService } from '../src/interface/http/birthdays/birthday-automation.service';
import { BirthdaysService } from '../src/interface/http/birthdays/birthdays.service';
import { DEFAULT_GREETING_MESSAGE } from '../src/interface/http/birthdays/birthday-dates';
import type { AuthenticatedUser } from '../src/shared/interfaces/jwt-payload.interface';
import { DEV_PASSWORD, SecondOrg, createSecondOrg, loginAs, todaySaoPaulo } from './utils/list-helpers';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Aniversariantes (contrato secao 2): GET /birthdays, /summary, /week, POST greet/congratulate, GET/PUT settings, a preferencia
 * `birthdayVisible` (GET /people/me/ficha, PATCH /people/me) e a automacao (resumo diario + parabens automaticos, com `now`
 * injetado). Grupos PROPRIOS (A com varias pessoas, B para isolamento); nada do seed/demo e tocado; tudo limpo no after().
 * As datas de nascimento sao RELATIVAS a hoje (America/Sao_Paulo), calculadas aqui por outra via (todaySaoPaulo).
 */
const DOMAIN = '@e2e-bday.local';
const CODE_PREFIX = 'E2E-BDAY';

interface Civil {
  year: number;
  month: number;
  day: number;
}
const civil = (offsetDays: number): Civil => {
  const [year, month, day] = todaySaoPaulo(offsetDays).split('-').map(Number);
  return { year, month, day };
};
const birth = (year: number, c: Civil) => new Date(Date.UTC(year, c.month - 1, c.day));

describe('Aniversariantes (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let org: ReportOrg;
  let orgB: SecondOrg;
  let svc: BirthdaysService;
  let automation: BirthdayAutomationService;

  const today = civil(0);
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const personIds: number[] = [];
  let codeSeq = 0;

  // pessoas (ids de Person) ----------------------------------------------------------------
  let adultToday: { personId: number; studentId: number; userId: number; token: string; name: string };
  let minorToday: { personId: number; studentId: number };
  let unitBToday: { personId: number };
  let adultIn3: { personId: number; studentId: number; userId: number; token: string };
  let optOut: { personId: number };
  let guardian: { personId: number; userId: number };
  let staffProf: { personId: number };
  let unitBWeek: { personId: number };
  let farAway: { personId: number; c: Civil };
  let shared: { personId: number };
  let orgBToday: { personId: number };
  let classA: number;
  let monitor: { userId: number; token: string };

  const mestreUser = (): AuthenticatedUser => ({
    id: org.mestre.userId,
    email: '',
    userType: 'MEMBER',
    isSuperAdmin: false,
    organizationId: org.organizationId,
    role: OrgRole.MESTRE,
  });
  const alunoUser = (): AuthenticatedUser => ({ ...mestreUser(), id: org.aluno.userId, role: OrgRole.ALUNO });

  async function makeUser(kind: string, role: OrgRole, organizationId = org.organizationId) {
    const email = `${kind}-${stamp}${DOMAIN}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `[e2e-bday] ${kind}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    await prisma.organizationUser.create({ data: { organizationId, userId: user.id, role, status: 'ACTIVE' } });
    return { userId: user.id, token: (await loginAs(app, email)).token, email };
  }

  async function makePerson(data: { name: string; birthDate: Date; userId?: number; phone?: string; birthdayVisible?: boolean }) {
    const person = await prisma.person.create({ data: { gingappCode: `${CODE_PREFIX}-${stamp}-${++codeSeq}`, ...data } });
    personIds.push(person.id);
    return person;
  }

  async function makeStudent(
    organizationId: number,
    personId: number,
    data: { name: string; birthDate: Date; unitId?: number; userId?: number; phone?: string; classId?: number },
  ) {
    const { classId, ...rest } = data;
    const student = await prisma.student.create({ data: { organizationId, personId, ...rest } });
    if (classId) await prisma.classStudent.create({ data: { organizationId, classId, studentId: student.id, status: 'ACTIVE' } });
    return student;
  }

  const notificationsOf = (userId: number, type: string) =>
    prisma.notification.findMany({ where: { userId, type, organizationId: org.organizationId }, orderBy: { id: 'asc' } });

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    svc = app.get(BirthdaysService, { strict: false });
    automation = app.get(BirthdayAutomationService, { strict: false });
    org = await createReportOrg(app, prisma, 'bday');
    orgB = await createSecondOrg(app, prisma, 'bday');
    const organizationId = org.organizationId;
    const unitA = org.unitA.id;
    const unitB = org.unitB.id;

    // Professor restrito a unidade A (escopo de unidade) e MONITOR (le alunos, nao envia aviso).
    await prisma.userUnitAccess.create({ data: { organizationId, userId: org.professor.userId, unitId: unitA } });
    monitor = await makeUser('monitor', OrgRole.MONITOR);
    classA = (await prisma.class.create({ data: { organizationId, unitId: unitA, name: 'Turma Aniv A', autoGenerateLessons: false } })).id;

    // P1: adulto que faz aniversario HOJE, com login, telefone e turma.
    const u1 = await makeUser('hoje', OrgRole.ALUNO);
    const p1 = await makePerson({ name: 'Ana Hoje Silva', birthDate: birth(1995, today), userId: u1.userId, phone: '(61) 99999-1234' });
    const s1 = await makeStudent(organizationId, p1.id, { name: 'Ana Hoje Silva', birthDate: p1.birthDate!, unitId: unitA, userId: u1.userId, phone: '(61) 99999-1234', classId: classA });
    adultToday = { personId: p1.id, studentId: s1.id, userId: u1.userId, token: u1.token, name: p1.name };

    // P2: MENOR de 18 que faz aniversario hoje (sem login, sem telefone), na unidade A e na turma; P6 e responsavel dela.
    const p2 = await makePerson({ name: 'Menor Hoje', birthDate: birth(today.year - 12, today) });
    const s2 = await makeStudent(organizationId, p2.id, { name: 'Menor Hoje', birthDate: p2.birthDate!, unitId: unitA, classId: classA });
    minorToday = { personId: p2.id, studentId: s2.id };

    // P3: adulto da unidade B que faz aniversario hoje.
    const p3 = await makePerson({ name: 'Bruno Unidade B', birthDate: birth(1992, today) });
    await makeStudent(organizationId, p3.id, { name: 'Bruno Unidade B', birthDate: p3.birthDate!, unitId: unitB });
    unitBToday = { personId: p3.id };

    // P4: adulto com login, +3 dias.
    const u4 = await makeUser('mais3', OrgRole.ALUNO);
    const p4 = await makePerson({ name: 'Caio Mais Tres', birthDate: birth(1990, civil(3)), userId: u4.userId });
    const s4 = await makeStudent(organizationId, p4.id, { name: 'Caio Mais Tres', birthDate: p4.birthDate!, unitId: unitA, userId: u4.userId, classId: classA });
    adultIn3 = { personId: p4.id, studentId: s4.id, userId: u4.userId, token: u4.token };

    // P5: adulto que optou por NAO aparecer (+2 dias).
    const p5 = await makePerson({ name: 'Dani Oculta', birthDate: birth(1988, civil(2)), birthdayVisible: false });
    await makeStudent(organizationId, p5.id, { name: 'Dani Oculta', birthDate: p5.birthDate!, unitId: unitA });
    optOut = { personId: p5.id };

    // P6: responsavel (login RESPONSAVEL) da menor P2, +1 dia.
    const u6 = await makeUser('resp', OrgRole.RESPONSAVEL);
    const p6 = await makePerson({ name: 'Edu Responsavel', birthDate: birth(1980, civil(1)), userId: u6.userId });
    await prisma.studentGuardian.create({ data: { organizationId, studentId: minorToday.studentId, userId: u6.userId, name: 'Edu Responsavel' } });
    guardian = { personId: p6.id, userId: u6.userId };

    // P7: professor (equipe) +5 dias.
    const p7 = await makePerson({ name: 'Fabio Professor', birthDate: birth(1985, civil(5)), userId: org.professor.userId });
    staffProf = { personId: p7.id };

    // P8: adulto da unidade B, +4 dias.
    const p8 = await makePerson({ name: 'Gil Unidade B Semana', birthDate: birth(1999, civil(4)) });
    await makeStudent(organizationId, p8.id, { name: 'Gil Unidade B Semana', birthDate: p8.birthDate!, unitId: unitB });
    unitBWeek = { personId: p8.id };

    // P9: longe da janela de 7 dias (+20).
    const p9 = await makePerson({ name: 'Helena Longe', birthDate: birth(1991, civil(20)) });
    await makeStudent(organizationId, p9.id, { name: 'Helena Longe', birthDate: p9.birthDate!, unitId: unitA });
    farAway = { personId: p9.id, c: civil(20) };

    // P10: a MESMA pessoa matriculada nos dois grupos (+6 dias): aparece em cada grupo.
    const p10 = await makePerson({ name: 'Igor Dois Grupos', birthDate: birth(1993, civil(6)) });
    await makeStudent(organizationId, p10.id, { name: 'Igor Dois Grupos', birthDate: p10.birthDate!, unitId: unitA });
    await makeStudent(orgB.organizationId, p10.id, { name: 'Igor Dois Grupos', birthDate: p10.birthDate! });
    shared = { personId: p10.id };

    // Grupo B: um aluno que faz aniversario hoje (nunca pode aparecer no grupo A).
    const pb = await makePerson({ name: 'Joana Grupo B', birthDate: birth(1994, today) });
    await makeStudent(orgB.organizationId, pb.id, { name: 'Joana Grupo B', birthDate: pb.birthDate! });
    orgBToday = { personId: pb.id };
  });

  after(async () => {
    const orgIds = [org.organizationId, orgB.organizationId];
    await prisma.birthdayCongrats.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.birthdayGreeting.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.notification.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.student.deleteMany({ where: { organizationId: orgB.organizationId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgB.organizationId } });
    await org.cleanup();
    await orgB.cleanup();
    await prisma.person.deleteMany({ where: { OR: [{ id: { in: personIds } }, { gingappCode: { startsWith: `${CODE_PREFIX}-${stamp}` } }] } });
    const ids = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    // Confirma por consulta Prisma que nada ficou para tras.
    assert.equal(await prisma.organization.count({ where: { id: { in: orgIds } } }), 0);
    assert.equal(await prisma.person.count({ where: { gingappCode: { startsWith: `${CODE_PREFIX}-${stamp}` } } }), 0);
    assert.equal(await prisma.user.count({ where: { email: { endsWith: DOMAIN } } }), 0);
    assert.equal(await prisma.birthdayGreeting.count({ where: { organizationId: { in: orgIds } } }), 0);
    assert.equal(await prisma.birthdayCongrats.count({ where: { organizationId: { in: orgIds } } }), 0);
    assert.equal(await prisma.notification.count({ where: { organizationId: { in: orgIds } } }), 0);
    assert.equal(await prisma.auditLog.count({ where: { organizationId: { in: orgIds } } }), 0);
    await prisma.$disconnect();
    await app.close();
  });

  // -------------------------------------------------------------------------------------------
  // EQUIPE: lista do mes, resumo
  // -------------------------------------------------------------------------------------------
  it('GET /birthdays: lista do mes por dia e nome, idade que FAZ, menor sinalizado, telefone, turma e unidade', async () => {
    const res = await http().get(`/api/birthdays?month=${today.month}`).set(auth(org.mestre.token)).expect(200);
    assert.deepEqual(Object.keys(res.body).sort(), ['items', 'month', 'total']);
    assert.equal(res.body.month, today.month);
    assert.equal(res.body.total, res.body.items.length);
    const byId = new Map<number, Record<string, unknown>>(res.body.items.map((i: { personId: number }) => [i.personId, i as Record<string, unknown>]));

    const a = byId.get(adultToday.personId)!;
    assert.deepEqual(Object.keys(a).sort(), [
      'age', 'classNames', 'day', 'greetedThisYear', 'isMinor', 'kind', 'month', 'name', 'nickname', 'personId', 'phone', 'photo',
      'studentId', 'turnsAge', 'unitId', 'unitName', 'userId',
    ]);
    assert.equal(a.day, today.day);
    assert.equal(a.month, today.month);
    assert.equal(a.turnsAge, today.year - 1995);
    assert.equal(a.age, today.year - 1995);
    assert.equal(a.isMinor, false);
    assert.equal(a.kind, 'STUDENT');
    assert.equal(a.unitId, org.unitA.id);
    assert.equal(a.unitName, org.unitA.name);
    assert.deepEqual(a.classNames, ['Turma Aniv A']);
    assert.equal(a.phone, '(61) 99999-1234');
    assert.equal(a.studentId, adultToday.studentId);
    assert.equal(a.userId, adultToday.userId);
    assert.equal(a.greetedThisYear, false);

    const m = byId.get(minorToday.personId)!;
    assert.equal(m.isMinor, true, 'menor aparece para a equipe, sinalizado');
    assert.equal(m.turnsAge, 12);
    assert.equal(m.phone, null);

    assert.ok(byId.has(unitBToday.personId), 'MESTRE (sem restricao) ve as duas unidades');
    assert.ok(!byId.has(orgBToday.personId), 'pessoa do outro grupo nunca aparece');

    const items = res.body.items as { day: number; name: string }[];
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const cur = items[i];
      assert.ok(prev.day < cur.day || (prev.day === cur.day && prev.name.localeCompare(cur.name, 'pt-BR') <= 0), 'ordenado por dia, depois nome');
    }
  });

  it('GET /birthdays: tipos (aluno/equipe/responsavel), filtros de unidade e turma, mes sem filtro = mes corrente, mes invalido 400', async () => {
    const all = (await http().get('/api/birthdays').set(auth(org.mestre.token)).expect(200)).body;
    assert.equal(all.month, today.month, 'sem month = mes corrente de Sao Paulo');

    // Cada pessoa no mes do seu aniversario: tipo certo.
    const kindOf = async (personId: number, c: Civil) => {
      const r = (await http().get(`/api/birthdays?month=${c.month}`).set(auth(org.mestre.token)).expect(200)).body.items;
      return r.find((i: { personId: number }) => i.personId === personId);
    };
    const guard = await kindOf(guardian.personId, civil(1));
    assert.equal(guard.kind, 'GUARDIAN');
    assert.equal(guard.unitId, org.unitA.id, 'responsavel herda a unidade do dependente');
    assert.equal(guard.studentId, null);
    const staff = await kindOf(staffProf.personId, civil(5));
    assert.equal(staff.kind, 'STAFF');
    assert.equal(staff.unitId, org.unitA.id, 'equipe usa as unidades de acesso');
    const far = await kindOf(farAway.personId, farAway.c);
    assert.equal(far.turnsAge, today.year - 1991);
    assert.equal(far.day, farAway.c.day);

    const unitB = (await http().get(`/api/birthdays?month=${today.month}&unitId=${org.unitB.id}`).set(auth(org.mestre.token)).expect(200)).body.items;
    assert.ok(unitB.some((i: { personId: number }) => i.personId === unitBToday.personId));
    assert.ok(!unitB.some((i: { personId: number }) => i.personId === adultToday.personId));
    const inClass = (await http().get(`/api/birthdays?month=${today.month}&classId=${classA}`).set(auth(org.mestre.token)).expect(200)).body.items;
    const classIds = inClass.map((i: { personId: number }) => i.personId);
    assert.ok(classIds.includes(adultToday.personId) && classIds.includes(minorToday.personId));
    assert.ok(!classIds.includes(unitBToday.personId));

    await http().get('/api/birthdays?month=13').set(auth(org.mestre.token)).expect(400);
    await http().get('/api/birthdays?month=0').set(auth(org.mestre.token)).expect(400);
    await http().get('/api/birthdays?month=abc').set(auth(org.mestre.token)).expect(400);
  });

  it('GET /birthdays/summary: hoje, proximos 7 dias (sem hoje), total do mes e de hoje', async () => {
    const res = await http().get('/api/birthdays/summary').set(auth(org.mestre.token)).expect(200);
    assert.deepEqual(Object.keys(res.body).sort(), ['monthTotal', 'next7Days', 'today', 'todayTotal']);
    const todayIds = res.body.today.map((i: { personId: number }) => i.personId).sort();
    assert.deepEqual(todayIds, [adultToday.personId, minorToday.personId, unitBToday.personId].sort());
    assert.equal(res.body.todayTotal, 3);
    const next = res.body.next7Days.map((i: { personId: number }) => i.personId);
    for (const id of [guardian.personId, optOut.personId, adultIn3.personId, unitBWeek.personId, staffProf.personId, shared.personId]) {
      assert.ok(next.includes(id), `proximos 7 dias deve conter ${id}`);
    }
    assert.ok(!next.includes(farAway.personId) && !next.includes(adultToday.personId));
    assert.equal(res.body.next7Days.length, 6);
    const caio = res.body.next7Days.find((i: { personId: number }) => i.personId === adultIn3.personId);
    assert.equal(caio.turnsAge, civil(3).year - 1990, 'idade pelo ano da ocorrencia');
    assert.equal(caio.day, civil(3).day);
    // total do mes: as pessoas do grupo A (fixture) cujo aniversario cai no mes corrente.
    const offsets = [0, 0, 0, 3, 2, 1, 5, 4, 6, 20];
    assert.equal(res.body.monthTotal, offsets.filter((o) => civil(o).month === today.month).length);
  });

  // -------------------------------------------------------------------------------------------
  // MEMBROS: /week e privacidade
  // -------------------------------------------------------------------------------------------
  it('GET /birthdays/week (ALUNO): sem menores, sem opt-out, sem idade/ano/telefone; so os proximos 7 dias; outro grupo fora', async () => {
    const res = await http().get('/api/birthdays/week').set(auth(org.aluno.token)).expect(200);
    assert.deepEqual(Object.keys(res.body), ['items']);
    const ids = res.body.items.map((i: { personId: number }) => i.personId);
    const expected = [adultToday, unitBToday, guardian, adultIn3, unitBWeek, staffProf, shared].map((p) => p.personId);
    assert.deepEqual([...ids].sort(), [...expected].sort());
    assert.ok(!ids.includes(minorToday.personId), 'menor de 18 nunca aparece para membros');
    assert.ok(!ids.includes(optOut.personId), 'quem optou por nao aparecer fica de fora');
    assert.ok(!ids.includes(farAway.personId) && !ids.includes(orgBToday.personId));

    for (const item of res.body.items) {
      assert.deepEqual(Object.keys(item).sort(), ['canCongratulate', 'congratulatedByMe', 'day', 'isToday', 'month', 'name', 'nickname', 'personId', 'photo']);
    }
    const raw = JSON.stringify(res.body);
    for (const leak of ['(61)', '99999', 'birthDate', 'turnsAge', '"age"', 'isMinor', 'phone']) {
      assert.ok(!raw.includes(leak), `a resposta de /week nao pode conter ${leak}`);
    }
    const hoje = res.body.items.find((i: { personId: number }) => i.personId === adultToday.personId);
    assert.equal(hoje.isToday, true);
    assert.equal(hoje.canCongratulate, true);
    assert.equal(res.body.items.filter((i: { isToday: boolean }) => i.isToday).length, 2, 'Ana e Bruno fazem anos hoje');
    // ordenado por data
    const dates = res.body.items.map((i: { personId: number; day: number }) => i.personId);
    assert.equal(dates[0] === adultToday.personId || dates[0] === unitBToday.personId, true, 'hoje primeiro');
    assert.equal(dates[dates.length - 1], shared.personId, '+6 dias por ultimo');
  });

  it('GET /birthdays/week: o proprio usuario aparece com canCongratulate=false; cada grupo ve so as suas pessoas (e a pessoa nos dois grupos aparece nos dois)', async () => {
    const mine = (await http().get('/api/birthdays/week').set(auth(adultToday.token)).expect(200)).body.items;
    const self = mine.find((i: { personId: number }) => i.personId === adultToday.personId);
    assert.ok(self, 'o proprio usuario aparece');
    assert.equal(self.canCongratulate, false);

    const b = (await http().get('/api/birthdays/week').set(auth(orgB.token)).expect(200)).body.items.map((i: { personId: number }) => i.personId);
    assert.deepEqual([...b].sort(), [orgBToday.personId, shared.personId].sort());
    const aShared = (await http().get('/api/birthdays/week').set(auth(org.aluno.token)).expect(200)).body.items.map((i: { personId: number }) => i.personId);
    assert.ok(aShared.includes(shared.personId));
  });

  it('POST congratulate: ok notifica sem idade; 2a vez 409 ALREADY_CONGRATULATED; menor/opt-out/fora da semana/outro grupo/inexistente 403; a si mesmo 403', async () => {
    const ok = await http().post(`/api/birthdays/${adultIn3.personId}/congratulate`).set(auth(org.aluno.token)).expect(200);
    assert.deepEqual(ok.body, { sent: true });
    const notes = await notificationsOf(adultIn3.userId, 'BIRTHDAY_CONGRATS');
    assert.equal(notes.length, 1);
    assert.match(notes[0].body, /te desejou parabéns/);
    assert.ok(!/\b\d+\b/.test(notes[0].body) && !/anos/.test(notes[0].body), 'sem idade na notificacao');
    assert.equal(notes[0].organizationId, org.organizationId);

    const again = await http().post(`/api/birthdays/${adultIn3.personId}/congratulate`).set(auth(org.aluno.token)).expect(409);
    assert.equal(again.body.code, 'ALREADY_CONGRATULATED');
    assert.equal((await notificationsOf(adultIn3.userId, 'BIRTHDAY_CONGRATS')).length, 1, 'nao notifica de novo');
    assert.equal(await prisma.birthdayCongrats.count({ where: { organizationId: org.organizationId, personId: adultIn3.personId, giverUserId: org.aluno.userId } }), 1);

    const week = (await http().get('/api/birthdays/week').set(auth(org.aluno.token)).expect(200)).body.items;
    const caio = week.find((i: { personId: number }) => i.personId === adultIn3.personId);
    assert.equal(caio.congratulatedByMe, true);
    assert.equal(caio.canCongratulate, false);

    // Outro colega pode parabenizar a mesma pessoa (1 por quem da).
    await http().post(`/api/birthdays/${adultIn3.personId}/congratulate`).set(auth(org.professor.token)).expect(200);

    for (const [label, personId] of [
      ['menor', minorToday.personId],
      ['opt-out', optOut.personId],
      ['fora da semana', farAway.personId],
      ['outro grupo', orgBToday.personId],
      ['inexistente', 2_000_000_000],
    ] as const) {
      const denied = await http().post(`/api/birthdays/${personId}/congratulate`).set(auth(org.aluno.token)).expect(403);
      assert.equal(denied.body.code, 'BIRTHDAY_NOT_VISIBLE', label);
    }
    const self = await http().post(`/api/birthdays/${adultToday.personId}/congratulate`).set(auth(adultToday.token)).expect(403);
    assert.equal(self.body.code, 'CANNOT_CONGRATULATE_SELF');
    await http().post(`/api/birthdays/${adultIn3.personId}/congratulate`).expect(401);
  });

  it('preferencia birthdayVisible: PATCH /people/me e GET /people/me/ficha; opt-out some do /week e bloqueia o parabens; volta ao reativar', async () => {
    const before = (await http().get('/api/people/me/ficha').set(auth(adultIn3.token)).expect(200)).body;
    assert.equal(before.person.birthdayVisible, true, 'padrao true');
    assert.equal(before.birthdayVisible, true);

    await http().patch('/api/people/me').set(auth(adultIn3.token)).send({ birthdayVisible: 'sim' }).expect(400);
    const off = await http().patch('/api/people/me').set(auth(adultIn3.token)).send({ birthdayVisible: false }).expect(200);
    assert.equal(off.body.person.birthdayVisible, false);
    const ficha = (await http().get('/api/people/me/ficha').set(auth(adultIn3.token)).expect(200)).body;
    assert.equal(ficha.person.birthdayVisible, false);
    assert.equal(ficha.birthdayVisible, false);

    const week = (await http().get('/api/birthdays/week').set(auth(org.aluno.token)).expect(200)).body.items.map((i: { personId: number }) => i.personId);
    assert.ok(!week.includes(adultIn3.personId));
    await http().post(`/api/birthdays/${adultIn3.personId}/congratulate`).set(auth(org.mestre.token)).expect(403);
    // A equipe continua vendo no painel.
    const staffList = (await http().get(`/api/birthdays?month=${civil(3).month}`).set(auth(org.mestre.token)).expect(200)).body.items;
    assert.ok(staffList.some((i: { personId: number }) => i.personId === adultIn3.personId));

    await http().patch('/api/people/me').set(auth(adultIn3.token)).send({ birthdayVisible: true }).expect(200);
    const back = (await http().get('/api/birthdays/week').set(auth(org.aluno.token)).expect(200)).body.items.map((i: { personId: number }) => i.personId);
    assert.ok(back.includes(adultIn3.personId));
    // Editar so o apelido nao mexe na preferencia.
    await http().patch('/api/people/me').set(auth(adultIn3.token)).send({ nickname: 'Caio' }).expect(200);
    assert.equal((await prisma.person.findUniqueOrThrow({ where: { id: adultIn3.personId } })).birthdayVisible, true);
  });

  // -------------------------------------------------------------------------------------------
  // EQUIPE: greet
  // -------------------------------------------------------------------------------------------
  it('POST greet: notifica o aniversariante, devolve whatsappUrl com telefone, nao reenvia (alreadyGreeted) e marca greetedThisYear', async () => {
    const res = await http()
      .post(`/api/birthdays/${adultToday.personId}/greet`)
      .set(auth(org.mestre.token))
      .send({ message: 'Feliz aniversário, {nome}!' })
      .expect(200);
    assert.deepEqual(Object.keys(res.body).sort(), ['alreadyGreeted', 'sent', 'whatsappUrl']);
    assert.equal(res.body.sent, true);
    assert.equal(res.body.alreadyGreeted, false);
    assert.equal(res.body.whatsappUrl, `https://wa.me/5561999991234?text=${encodeURIComponent('Feliz aniversário, Ana!')}`);
    const notes = await notificationsOf(adultToday.userId, 'BIRTHDAY_GREETING');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].body, 'Feliz aniversário, Ana!');

    const again = await http().post(`/api/birthdays/${adultToday.personId}/greet`).set(auth(org.mestre.token)).send({}).expect(200);
    assert.equal(again.body.alreadyGreeted, true);
    assert.equal(again.body.sent, false);
    assert.equal((await notificationsOf(adultToday.userId, 'BIRTHDAY_GREETING')).length, 1, 'nao reenvia');
    assert.equal(await prisma.birthdayGreeting.count({ where: { organizationId: org.organizationId, personId: adultToday.personId, source: 'MANUAL' } }), 1);

    const list = (await http().get(`/api/birthdays?month=${today.month}`).set(auth(org.mestre.token)).expect(200)).body.items;
    assert.equal(list.find((i: { personId: number }) => i.personId === adultToday.personId).greetedThisYear, true);
    assert.equal(list.find((i: { personId: number }) => i.personId === minorToday.personId).greetedThisYear, false);
  });

  it('POST greet: sem telefone e sem login => whatsappUrl null, sent false (mas registra); mensagem padrao; >500 caracteres 400; outro grupo/inexistente 404', async () => {
    const res = await http().post(`/api/birthdays/${minorToday.personId}/greet`).set(auth(org.mestre.token)).send({}).expect(200);
    assert.deepEqual(res.body, { sent: false, alreadyGreeted: false, whatsappUrl: null });
    const again = await http().post(`/api/birthdays/${minorToday.personId}/greet`).set(auth(org.mestre.token)).send({}).expect(200);
    assert.equal(again.body.alreadyGreeted, true);

    // Mensagem padrao do grupo (sem corpo): {nome} = primeiro nome, {grupo} = nome do grupo.
    const def = await http().post(`/api/birthdays/${unitBToday.personId}/greet`).set(auth(org.mestre.token)).expect(200);
    assert.equal(def.body.whatsappUrl, null);

    await http().post(`/api/birthdays/${adultIn3.personId}/greet`).set(auth(org.mestre.token)).send({ message: 'x'.repeat(501) }).expect(400);
    await http().post(`/api/birthdays/${orgBToday.personId}/greet`).set(auth(org.mestre.token)).send({}).expect(404);
    await http().post('/api/birthdays/2000000000/greet').set(auth(org.mestre.token)).send({}).expect(404);
    assert.equal(await prisma.birthdayGreeting.count({ where: { personId: orgBToday.personId } }), 0);
  });

  it('corrida: dois greet e dois parabens simultaneos => so um vale (unico do banco), o outro responde alreadyGreeted/409', async () => {
    const greets = await Promise.all([1, 2].map(() => http().post(`/api/birthdays/${unitBWeek.personId}/greet`).set(auth(org.mestre.token)).send({})));
    assert.deepEqual(greets.map((r) => r.status), [200, 200]);
    assert.deepEqual(greets.map((r) => r.body.alreadyGreeted).sort(), [false, true]);
    assert.equal(await prisma.birthdayGreeting.count({ where: { organizationId: org.organizationId, personId: unitBWeek.personId } }), 1);

    const congrats = await Promise.all([1, 2].map(() => http().post(`/api/birthdays/${shared.personId}/congratulate`).set(auth(org.aluno.token))));
    assert.deepEqual(congrats.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await prisma.birthdayCongrats.count({ where: { organizationId: org.organizationId, personId: shared.personId, giverUserId: org.aluno.userId } }), 1);
  });

  // -------------------------------------------------------------------------------------------
  // PERMISSOES e ESCOPO
  // -------------------------------------------------------------------------------------------
  it('permissoes: ALUNO/RESPONSAVEL 403 nas rotas da equipe; MONITOR le mas nao envia; sem token 401; /week e das membros', async () => {
    for (const token of [org.aluno.token, adultToday.token]) {
      await http().get('/api/birthdays').set(auth(token)).expect(403);
      await http().get('/api/birthdays/summary').set(auth(token)).expect(403);
      await http().get('/api/birthdays/settings').set(auth(token)).expect(403);
      await http().put('/api/birthdays/settings').set(auth(token)).send({ autoGreeting: true }).expect(403);
      await http().post(`/api/birthdays/${adultIn3.personId}/greet`).set(auth(token)).send({}).expect(403);
      await http().get('/api/birthdays/week').set(auth(token)).expect(200);
    }
    const resp = await loginAs(app, `resp-${stamp}${DOMAIN}`);
    await http().get('/api/birthdays').set(auth(resp.token)).expect(403);
    await http().get('/api/birthdays/week').set(auth(resp.token)).expect(200);

    await http().get('/api/birthdays').set(auth(monitor.token)).expect(200);
    await http().get('/api/birthdays/summary').set(auth(monitor.token)).expect(200);
    await http().post(`/api/birthdays/${adultIn3.personId}/greet`).set(auth(monitor.token)).send({}).expect(403);
    await http().get('/api/birthdays/settings').set(auth(monitor.token)).expect(403);

    await http().get('/api/birthdays').expect(401);
    await http().get('/api/birthdays/week').expect(401);
    await http().get('/api/birthdays/settings').expect(401);
    assert.equal(await prisma.birthdayGreeting.count({ where: { personId: adultIn3.personId } }), 0, 'nenhuma saudacao saiu pelos 403');
  });

  it('escopo de unidade: PROFESSOR restrito a unidade A nao ve a unidade B (lista, filtro, resumo, greet); a pessoa de outra unidade/ sem unidade segue as regras', async () => {
    const list = (await http().get(`/api/birthdays?month=${today.month}`).set(auth(org.professor.token)).expect(200)).body.items.map((i: { personId: number }) => i.personId);
    assert.ok(list.includes(adultToday.personId) && list.includes(minorToday.personId));
    assert.ok(!list.includes(unitBToday.personId), 'aluno da unidade B fora do escopo do professor');
    await http().get(`/api/birthdays?month=${today.month}&unitId=${org.unitB.id}`).set(auth(org.professor.token)).expect(403);

    const summary = (await http().get('/api/birthdays/summary').set(auth(org.professor.token)).expect(200)).body;
    assert.deepEqual(summary.today.map((i: { personId: number }) => i.personId).sort(), [adultToday.personId, minorToday.personId].sort());
    assert.ok(!summary.next7Days.some((i: { personId: number }) => i.personId === unitBWeek.personId));
    assert.equal(summary.todayTotal, 2);

    await http().post(`/api/birthdays/${unitBToday.personId}/greet`).set(auth(org.professor.token)).send({}).expect(404);
    await http().post(`/api/birthdays/${adultIn3.personId}/greet`).set(auth(org.professor.token)).send({ message: 'Parabéns!' }).expect(200);
  });

  // -------------------------------------------------------------------------------------------
  // CONFIGURACAO
  // -------------------------------------------------------------------------------------------
  it('settings: defaults, so MESTRE altera (parcial), validacoes, mensagem vazia volta ao padrao', async () => {
    const defaults = (await http().get('/api/birthdays/settings').set(auth(org.mestre.token)).expect(200)).body;
    assert.deepEqual(defaults, { dailyDigest: true, autoGreeting: false, autoGreetingMessage: DEFAULT_GREETING_MESSAGE, autoGreetingHour: 8 });

    await http().put('/api/birthdays/settings').set(auth(org.professor.token)).send({ autoGreeting: true }).expect(403);
    await http().put('/api/birthdays/settings').set(auth(org.mestre.token)).send({ autoGreetingHour: 24 }).expect(400);
    await http().put('/api/birthdays/settings').set(auth(org.mestre.token)).send({ autoGreetingHour: -1 }).expect(400);
    await http().put('/api/birthdays/settings').set(auth(org.mestre.token)).send({ autoGreeting: 'sim' }).expect(400);
    await http().put('/api/birthdays/settings').set(auth(org.mestre.token)).send({ autoGreetingMessage: 'x'.repeat(501) }).expect(400);
    await http().put('/api/birthdays/settings').set(auth(org.mestre.token)).send({ naoExiste: 1 }).expect(400);

    const saved = (
      await http()
        .put('/api/birthdays/settings')
        .set(auth(org.mestre.token))
        .send({ autoGreeting: true, autoGreetingHour: 9, autoGreetingMessage: 'Oi {nome}! Do {grupo}.' })
        .expect(200)
    ).body;
    assert.deepEqual(saved, { dailyDigest: true, autoGreeting: true, autoGreetingMessage: 'Oi {nome}! Do {grupo}.', autoGreetingHour: 9 });
    const partial = (await http().put('/api/birthdays/settings').set(auth(org.mestre.token)).send({ dailyDigest: false }).expect(200)).body;
    assert.deepEqual(partial, { dailyDigest: false, autoGreeting: true, autoGreetingMessage: 'Oi {nome}! Do {grupo}.', autoGreetingHour: 9 });
    const reset = (await http().put('/api/birthdays/settings').set(auth(org.mestre.token)).send({ dailyDigest: true, autoGreeting: false, autoGreetingHour: 8, autoGreetingMessage: '' }).expect(200)).body;
    assert.deepEqual(reset, defaults);
    assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: org.organizationId } })).birthdayGreetingMessage, null, 'mensagem padrao = coluna nula');
    // outro grupo nao foi tocado
    const otherDefaults = (await http().get('/api/birthdays/settings').set(auth(orgB.token)).expect(200)).body;
    assert.deepEqual(otherDefaults, defaults);
  });

  // -------------------------------------------------------------------------------------------
  // JOBS (chamada direta, `now` injetado)
  // -------------------------------------------------------------------------------------------
  it('job resumo diario: gestores recebem BIRTHDAY_DIGEST (professor restrito so da sua unidade), idempotente, sem aniversariantes nao envia, desligado nao envia', async () => {
    const now = new Date();
    const first = await automation.sendDailyDigests(now, org.organizationId);
    assert.deepEqual(first, { organizations: 1, notified: 2 }, 'MESTRE e PROFESSOR (announcements:create); MONITOR/ALUNO/RESPONSAVEL nao');
    const forMestre = await notificationsOf(org.mestre.userId, 'BIRTHDAY_DIGEST');
    assert.equal(forMestre.length, 1);
    assert.deepEqual(forMestre[0].data, { count: 3, date: todaySaoPaulo() });
    assert.match(forMestre[0].body, /^Hoje: 3 aniversariantes \(/);
    assert.ok(!/\d{4}/.test(forMestre[0].body), 'sem ano/data de nascimento no texto');
    const forProf = await notificationsOf(org.professor.userId, 'BIRTHDAY_DIGEST');
    assert.equal(forProf.length, 1);
    assert.deepEqual(forProf[0].data, { count: 2, date: todaySaoPaulo() }, 'professor restrito a unidade A nao recebe o aniversariante da B');
    assert.equal((await notificationsOf(monitor.userId, 'BIRTHDAY_DIGEST')).length, 0);
    assert.equal((await notificationsOf(org.aluno.userId, 'BIRTHDAY_DIGEST')).length, 0);

    const second = await automation.sendDailyDigests(now, org.organizationId);
    assert.deepEqual(second, { organizations: 0, notified: 0 }, 'idempotente no mesmo dia');
    assert.equal((await notificationsOf(org.mestre.userId, 'BIRTHDAY_DIGEST')).length, 1);

    // Dia sem nenhum aniversariante do grupo: nada e enviado.
    const quiet = new Date(Date.now() + 100 * 86_400_000);
    assert.deepEqual(await automation.sendDailyDigests(quiet, org.organizationId), { organizations: 0, notified: 0 });

    // Grupo com o resumo desligado: nada (mesmo em dia novo: usa uma data futura com aniversariante nao existente => cobre o filtro).
    await prisma.organization.update({ where: { id: org.organizationId }, data: { birthdayDailyDigest: false } });
    await prisma.notification.deleteMany({ where: { organizationId: org.organizationId, type: 'BIRTHDAY_DIGEST' } });
    assert.deepEqual(await automation.sendDailyDigests(now, org.organizationId), { organizations: 0, notified: 0 });
    await prisma.organization.update({ where: { id: org.organizationId }, data: { birthdayDailyDigest: true } });

    // Varias replicas no mesmo minuto: o resumo do dia sai UMA vez por gestor (advisory lock por grupo + checagem na transacao).
    const racers = await Promise.all(Array.from({ length: 5 }, () => automation.sendDailyDigests(now, org.organizationId)));
    assert.equal(racers.reduce((sum, r) => sum + r.notified, 0), 2, 'MESTRE + PROFESSOR, uma vez cada, somando as 5 execucoes concorrentes');
    assert.equal((await notificationsOf(org.mestre.userId, 'BIRTHDAY_DIGEST')).length, 1);
    assert.equal((await notificationsOf(org.professor.userId, 'BIRTHDAY_DIGEST')).length, 1);
    await prisma.notification.deleteMany({ where: { organizationId: org.organizationId, type: 'BIRTHDAY_DIGEST' } });
    // O outro grupo nao recebe nada pelo job desta organizacao.
    assert.equal(await prisma.notification.count({ where: { organizationId: orgB.organizationId, type: 'BIRTHDAY_DIGEST' } }), 0);
  });

  it('job parabens automaticos: so com a opcao ligada e a hora do grupo; mensagem padrao com {nome}/{grupo}; uma vez por ano (idempotente)', async () => {
    const sp = todaySaoPaulo();
    const at = (hourSp: number) => new Date(`${sp}T${String(hourSp + 3).padStart(2, '0')}:10:00.000Z`); // SP = UTC-3
    const orgRow = await prisma.organization.findUniqueOrThrow({ where: { id: org.organizationId } });

    // Desligado (padrao): nada.
    assert.deepEqual(await automation.sendAutoGreetings(at(12), org.organizationId), { organizations: 0, greeted: 0 });

    await prisma.organization.update({ where: { id: org.organizationId }, data: { birthdayAutoGreeting: true, birthdayGreetingHour: 8 } });
    assert.deepEqual(await automation.sendAutoGreetings(at(7), org.organizationId), { organizations: 0, greeted: 0 }, 'antes da hora do grupo');

    const run = await automation.sendAutoGreetings(at(8), org.organizationId);
    // So Ana (adulta, com login ativo) recebe; a menor e o Bruno nao tem login.
    assert.deepEqual(run, { organizations: 1, greeted: 1 });
    const auto = await prisma.birthdayGreeting.findMany({ where: { organizationId: org.organizationId, source: 'AUTO' } });
    assert.deepEqual(auto.map((g) => g.personId), [adultToday.personId]);
    const notes = await notificationsOf(adultToday.userId, 'BIRTHDAY_GREETING');
    assert.equal(notes.length, 2, 'a manual do teste anterior + a automatica');
    assert.equal(notes[1].body, `Parabéns, Ana! 🎉 A família ${orgRow.name} deseja um ótimo dia.`);

    assert.deepEqual(await automation.sendAutoGreetings(at(15), org.organizationId), { organizations: 0, greeted: 0 }, 'nao repete no mesmo ano');
    assert.equal((await notificationsOf(adultToday.userId, 'BIRTHDAY_GREETING')).length, 2);

    // Mensagem do grupo personalizada vale para quem ainda nao recebeu (apaga o registro AUTO para simular outra pessoa).
    await prisma.birthdayGreeting.deleteMany({ where: { organizationId: org.organizationId, source: 'AUTO' } });
    await prisma.organization.update({ where: { id: org.organizationId }, data: { birthdayGreetingMessage: 'Oi {nome}, do {grupo}!' } });
    await automation.sendAutoGreetings(at(9), org.organizationId);
    const custom = await notificationsOf(adultToday.userId, 'BIRTHDAY_GREETING');
    assert.equal(custom[custom.length - 1].body, `Oi Ana, do ${orgRow.name}!`);
    // Outro grupo nunca e tocado.
    assert.equal(await prisma.birthdayGreeting.count({ where: { organizationId: orgB.organizationId } }), 0);
    await prisma.organization.update({ where: { id: org.organizationId }, data: { birthdayAutoGreeting: false, birthdayGreetingMessage: null } });
  });

  // -------------------------------------------------------------------------------------------
  // 29/02 (servico com `now` injetado)
  // -------------------------------------------------------------------------------------------
  it('29/02: em ano nao bissexto comemora em 28/02 (lista, resumo e /week); em ano bissexto fica em 29/02', async () => {
    const unitA = org.unitA.id;
    const person = await makePerson({ name: 'Leo Bissexto', birthDate: new Date(Date.UTC(2000, 1, 29)) });
    await makeStudent(org.organizationId, person.id, { name: 'Leo Bissexto', birthDate: person.birthDate!, unitId: unitA });
    const noon = (iso: string) => new Date(`${iso}T15:00:00.000Z`);
    const findLeo = (items: { personId: number; day: number; turnsAge?: number | null }[]) => items.find((i) => i.personId === person.id);

    const nonLeap = await svc.list(org.organizationId, mestreUser(), { month: 2 }, noon('2026-02-10'));
    assert.equal(findLeo(nonLeap.items)?.day, 28);
    assert.equal(findLeo(nonLeap.items)?.turnsAge, 26);
    const leap = await svc.list(org.organizationId, mestreUser(), { month: 2 }, noon('2028-02-10'));
    assert.equal(findLeo(leap.items)?.day, 29);
    assert.equal(findLeo(leap.items)?.turnsAge, 28);

    const summary = await svc.summary(org.organizationId, mestreUser(), noon('2026-02-28'));
    assert.ok(findLeo(summary.today), '28/02/2026 e o aniversario dele');
    const earlier = await svc.summary(org.organizationId, mestreUser(), noon('2026-02-27'));
    assert.ok(findLeo(earlier.next7Days) && !findLeo(earlier.today));
    const march = await svc.summary(org.organizationId, mestreUser(), noon('2026-03-01'));
    assert.ok(!findLeo(march.today) && !findLeo(march.next7Days), '01/03 ja passou');

    const week = await svc.week(org.organizationId, alunoUser(), noon('2026-02-24'));
    const leo = week.items.find((i) => i.personId === person.id);
    assert.ok(leo);
    assert.deepEqual([leo.day, leo.month, leo.isToday], [28, 2, false]);
    const weekOnDay = await svc.week(org.organizationId, alunoUser(), noon('2026-02-28'));
    assert.equal(weekOnDay.items.find((i) => i.personId === person.id)?.isToday, true);
    const leapWeek = await svc.week(org.organizationId, alunoUser(), noon('2028-02-26'));
    assert.equal(leapWeek.items.find((i) => i.personId === person.id)?.day, 29);
    // Menor de 18 hoje continua fora mesmo no dia (nasceu em 2000; em 2017 nao existe mais: controle com um menor de 2010).
    const minor = await makePerson({ name: 'Mia Menor Bissexta', birthDate: new Date(Date.UTC(2010, 1, 28)) });
    await makeStudent(org.organizationId, minor.id, { name: 'Mia Menor Bissexta', birthDate: minor.birthDate!, unitId: unitA });
    const w = await svc.week(org.organizationId, alunoUser(), noon('2026-02-24'));
    assert.ok(!w.items.some((i) => i.personId === minor.id), 'menor fora do /week');
    const l = await svc.list(org.organizationId, mestreUser(), { month: 2 }, noon('2026-02-10'));
    assert.equal(l.items.find((i) => i.personId === minor.id)?.isMinor, true);
    // Vira adulto no proprio dia: em 28/02/2028 ela faz 18 e aparece.
    const adultDay = await svc.week(org.organizationId, alunoUser(), noon('2028-02-28'));
    assert.ok(adultDay.items.some((i) => i.personId === minor.id), 'no dia em que completa 18 anos passa a aparecer');
    await prisma.student.deleteMany({ where: { personId: { in: [person.id, minor.id] } } });
    await prisma.person.deleteMany({ where: { id: { in: [person.id, minor.id] } } });
  });

  // -------------------------------------------------------------------------------------------
  // AUDITORIA sem dados de nascimento
  // -------------------------------------------------------------------------------------------
  it('auditoria: BIRTHDAY_GREET e BIRTHDAY_SETTINGS_UPDATE gravados sem data de nascimento, telefone ou texto da mensagem', async () => {
    const greet = await prisma.auditLog.findMany({ where: { organizationId: org.organizationId, action: 'BIRTHDAY_GREET' } });
    const settings = await prisma.auditLog.findMany({ where: { organizationId: org.organizationId, action: 'BIRTHDAY_SETTINGS_UPDATE' } });
    assert.ok(greet.length >= 3, `greets auditados: ${greet.length}`);
    assert.ok(settings.length >= 3);
    assert.ok(greet.some((g) => (g.metadata as { source?: string } | null)?.source === 'AUTO'), 'parabens automaticos tambem auditados (contagem)');
    const raw = JSON.stringify([...greet, ...settings].map((r) => r.metadata));
    for (const leak of ['birthDate', 'birthdate', 'nascimento', 'Feliz aniversário', 'Oi {nome}', 'Parabéns', 'phone']) {
      assert.ok(!raw.includes(leak), `auditoria nao pode conter ${leak}`);
    }
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(raw), 'nenhuma data (de nascimento ou outra) no meta');
    assert.ok(!/\d{8,}/.test(raw), 'nenhum telefone no meta');
    assert.ok(greet.every((g) => g.resource === 'birthday' || g.resource === 'person'));
  });
});
