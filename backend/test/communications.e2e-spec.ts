import { ConflictException, INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { generateGingappCode } from '../src/interface/http/people/gingapp-code';
import { CommunicationsService } from '../src/interface/http/communications/communications.service';
import { CommunicationsSchedulerService } from '../src/jobs/communications-scheduler.service';
import { DEV_PASSWORD, SecondOrg, createSecondOrg, loginAs, todaySaoPaulo } from './utils/list-helpers';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Comunicar (docs/CONTRATO_FEED_ANIVERSARIOS_COMUNICACAO.md secao 3): previa por alcance, envio imediato, agendamento +
 * agendador, confirmCount, cotas, confirmacao (ack), fixados, historico/estatisticas, reenvio aos nao lidos, cancelar,
 * permissoes, isolamento, legado /announcements intacto e auditoria sem texto. Grupo PROPRIO (createReportOrg) +
 * segundo grupo; fixtures "@e2e-comm.local"; tudo limpo no after().
 */
const DOMAIN = '@e2e-comm.local';
const HOUR = 3_600_000;

describe('Comunicar (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let org: ReportOrg;
  let orgB: SecondOrg;
  const stamp = Date.now();
  const tag = (n: string) => `[e2e-comm] ${n} ${stamp}`;
  const personIds: number[] = [];

  type U = { userId: number; token: string };
  let mestre: U;
  let p1: U; // PROFESSOR, responsavel pela turma A
  let p2: U; // PROFESSOR, responsavel pela turma B
  let p3: U; // PROFESSOR restrito a unidade A, responsavel pela turma C (unidade B)
  let monitor: U;
  let alunoA: U; // unidade A, turma A, nascimento neste mes (adulto, visivel)
  let respA: U; // responsavel do aluno A
  let alunoB: U; // unidade B, turma B, nascimento neste mes mas com opt-out
  let kid: U; // menor de 18, nascimento neste mes
  let alunoM: U; // unidade B, nascimento em OUTRO mes
  let inativo: { userId: number }; // vinculo INACTIVE, aluno da turma A
  let semVinculo: U; // aluno sem matricula (org.aluno)
  let unitBOther: number; // unidade do grupo B
  let classOther: number; // turma do grupo B
  let classA: number;
  let classB: number;
  let classC: number;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (token: string, body: Record<string, unknown>) => http().post('/api/communications').set(auth(token)).send(body);
  const preview = (token: string, qs: Record<string, unknown>) => http().get('/api/communications/preview').set(auth(token)).query(qs);
  const getOne = (token: string, id: number) => http().get(`/api/communications/${id}`).set(auth(token));
  const ack = (token: string, id: number, response: string) => http().post(`/api/communications/${id}/ack`).set(auth(token)).send({ response });
  const msg = (extra: Record<string, unknown> = {}) => ({ title: tag('msg'), body: 'Corpo da mensagem de teste', scope: { type: 'GROUP' }, ...extra });
  const notifsOf = (id: number) => prisma.notification.findMany({ where: { announcementId: id }, orderBy: [{ userId: 'asc' }, { id: 'asc' }] });
  const userIdsOf = async (id: number) => [...new Set((await notifsOf(id)).map((n) => n.userId))].sort((a, b) => a - b);
  const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);
  const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
  const activeMemberIds = async () =>
    sorted((await prisma.organizationUser.findMany({ where: { organizationId: org.organizationId, status: 'ACTIVE' }, select: { userId: true } })).map((m) => m.userId));

  async function makeUser(kind: string, role: OrgRole, status = 'ACTIVE'): Promise<U> {
    const email = `${kind}-${stamp}${DOMAIN}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `[e2e-comm] ${kind}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    await prisma.organizationUser.create({ data: { organizationId: org.organizationId, userId: user.id, role, status } });
    return { userId: user.id, token: status === 'ACTIVE' ? (await loginAs(app, email)).token : '' };
  }
  async function makePerson(name: string, birthDate: Date | null, extra: { birthdayVisible?: boolean; userId?: number } = {}) {
    const person = await prisma.person.create({ data: { gingappCode: generateGingappCode(), name, birthDate, ...extra } });
    personIds.push(person.id);
    return person;
  }

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    org = await createReportOrg(app, prisma, 'comm');
    orgB = await createSecondOrg(app, prisma, 'comm');
    const organizationId = org.organizationId;
    mestre = org.mestre;
    p1 = org.professor;
    semVinculo = org.aluno;
    p2 = await makeUser('prof2', OrgRole.PROFESSOR);
    p3 = await makeUser('prof3', OrgRole.PROFESSOR);
    monitor = await makeUser('monitor', OrgRole.MONITOR);
    alunoA = await makeUser('alunoA', OrgRole.ALUNO);
    respA = await makeUser('respA', OrgRole.RESPONSAVEL);
    alunoB = await makeUser('alunoB', OrgRole.ALUNO);
    kid = await makeUser('kid', OrgRole.ALUNO);
    alunoM = await makeUser('alunoM', OrgRole.ALUNO);
    inativo = await makeUser('inativo', OrgRole.ALUNO, 'INACTIVE');

    // Aniversarios (America/Sao_Paulo): "este mes" = o mes civil de hoje; alunoM faz em OUTRO mes.
    const today = todaySaoPaulo();
    const month = Number(today.slice(5, 7));
    const year = Number(today.slice(0, 4));
    const otherMonth = (month % 12) + 1;
    const bd = (y: number, m = month) => new Date(Date.UTC(y, m - 1, 15));

    const pA = await makePerson('Aluno A', bd(1990));
    const pB = await makePerson('Aluno B', bd(1985), { birthdayVisible: false });
    const pKid = await makePerson('Kid', bd(year - 10));
    const pM = await makePerson('Aluno M', bd(1992, otherMonth));
    await makePerson('Mestre', bd(1970), { birthdayVisible: false, userId: mestre.userId }); // equipe: entra mesmo com opt-out
    await makePerson('Professor', bd(1980), { userId: p1.userId });

    const sA = await prisma.student.create({ data: { organizationId, userId: alunoA.userId, unitId: org.unitA.id, name: 'Aluno A', personId: pA.id } });
    const sB = await prisma.student.create({ data: { organizationId, userId: alunoB.userId, unitId: org.unitB.id, name: 'Aluno B', personId: pB.id } });
    await prisma.student.create({ data: { organizationId, userId: kid.userId, unitId: org.unitA.id, name: 'Kid', personId: pKid.id } });
    await prisma.student.create({ data: { organizationId, userId: alunoM.userId, unitId: org.unitB.id, name: 'Aluno M', personId: pM.id } });
    const sI = await prisma.student.create({ data: { organizationId, userId: inativo.userId, unitId: org.unitA.id, name: 'Aluno Inativo' } });
    await prisma.studentGuardian.create({ data: { organizationId, studentId: sA.id, userId: respA.userId, name: 'Resp A' } });

    classA = (await prisma.class.create({ data: { organizationId, unitId: org.unitA.id, name: 'Turma A', teacherUserId: p1.userId, autoGenerateLessons: false } })).id;
    classB = (await prisma.class.create({ data: { organizationId, unitId: org.unitB.id, name: 'Turma B', teacherUserId: p2.userId, autoGenerateLessons: false } })).id;
    classC = (await prisma.class.create({ data: { organizationId, unitId: org.unitB.id, name: 'Turma C', teacherUserId: p3.userId, autoGenerateLessons: false } })).id;
    for (const [classId, studentId] of [[classA, sA.id], [classA, sI.id], [classB, sB.id]]) {
      await prisma.classStudent.create({ data: { organizationId, classId, studentId, status: 'ACTIVE' } });
    }
    await prisma.userUnitAccess.create({ data: { organizationId, userId: p3.userId, unitId: org.unitA.id } });

    unitBOther = (await prisma.unit.create({ data: { organizationId: orgB.organizationId, name: 'Unidade do grupo B' } })).id;
    classOther = (await prisma.class.create({ data: { organizationId: orgB.organizationId, unitId: unitBOther, name: 'Turma do grupo B', autoGenerateLessons: false } })).id;
  });

  after(async () => {
    await prisma.announcement.deleteMany({ where: { organizationId: { in: [org.organizationId, orgB.organizationId] } } });
    await prisma.notification.deleteMany({ where: { organizationId: { in: [org.organizationId, orgB.organizationId] } } });
    await prisma.class.deleteMany({ where: { organizationId: orgB.organizationId } });
    await prisma.unit.deleteMany({ where: { organizationId: orgB.organizationId } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: orgB.organizationId }, { userId: orgB.userId }] } });
    await orgB.cleanup();
    await org.cleanup();
    await prisma.person.deleteMany({ where: { id: { in: personIds } } });
    const ids = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('prévia por alcance: contagens por GROUP/UNIT/CLASS/ROLE/BIRTHDAY_MONTH (sem inativos nem outro grupo) e amostra de até 5 nomes', async () => {
    const count = async (qs: Record<string, unknown>) => (await preview(mestre.token, qs).expect(200)).body as { count: number; sample: { name: string }[] };
    const group = await count({ scope: 'GROUP' });
    assert.equal(group.count, 11, 'mestre, 4 professores/monitor... = 11 membros ATIVOS (o INACTIVE fica de fora)');
    assert.equal(group.count, (await activeMemberIds()).length);
    assert.equal(group.sample.length, 5);
    assert.ok(group.sample.every((s) => typeof s.name === 'string' && Object.keys(s).join() === 'name'));
    assert.equal((await count({ scope: 'UNIT', unitId: org.unitB.id })).count, 3, 'mestre + alunoB + alunoM (alunos da unidade B)');
    assert.equal((await count({ scope: 'CLASS', classId: classA })).count, 3, 'alunoA + responsavel + professor da turma (aluno inativo fora)');
    assert.equal((await count({ scope: 'ROLE', role: 'ALUNO' })).count, 5);
    assert.equal((await count({ scope: 'ROLE', role: 'RESPONSAVEL' })).count, 1);
    assert.equal((await count({ scope: 'ROLE', role: 'EQUIPE' })).count, 4, 'MESTRE + 3 professores (monitor nao e equipe)');
    const birthdays = await count({ scope: 'BIRTHDAY_MONTH' });
    assert.equal(birthdays.count, 3, 'alunoA (adulto visivel) + mestre e professor (equipe); opt-out, menor e outro mes ficam de fora');

    await preview(mestre.token, { scope: 'UNIT' }).expect(400);
    await preview(mestre.token, { scope: 'UNIT', unitId: unitBOther }).expect(400);
    await preview(mestre.token, { scope: 'CLASS', classId: classOther }).expect(400);
    await preview(mestre.token, { scope: 'CLASS' }).expect(400);
    await preview(mestre.token, { scope: 'ROLE' }).expect(400);
    await preview(mestre.token, { scope: 'ROLE', role: 'MESTRE' }).expect(400);
    await preview(mestre.token, { scope: 'TODOS' }).expect(400);
    await preview(mestre.token, {}).expect(400);
  });

  it('envio imediato: 201 {id,status,recipients}; UMA notificação COMMUNICATION por destinatário com data/announcementId', async () => {
    const res = await post(mestre.token, msg({ title: tag('imediato'), requiresAck: 'READ' })).expect(201);
    assert.deepEqual(Object.keys(res.body).sort(), ['id', 'recipients', 'status']);
    assert.equal(res.body.status, 'SENT');
    assert.equal(res.body.recipients, 11);
    const id = res.body.id as number;
    const rows = await notifsOf(id);
    assert.equal(rows.length, 11);
    assert.deepEqual(rows.map((r) => r.userId), await activeMemberIds(), 'todo membro ATIVO, uma vez; inativo e outro grupo nao');
    for (const r of rows) {
      assert.equal(r.type, 'COMMUNICATION');
      assert.equal(r.announcementId, id);
      assert.equal(r.organizationId, org.organizationId);
      assert.deepEqual(r.data, { communicationId: id, requiresAck: 'READ' });
      assert.equal(r.readAt, null);
    }
    assert.ok(!rows.some((r) => r.userId === inativo.userId));
    assert.equal(await prisma.notification.count({ where: { organizationId: orgB.organizationId, announcementId: id } }), 0);
    const row = await prisma.announcement.findUniqueOrThrow({ where: { id } });
    assert.equal(row.status, 'SENT');
    assert.ok(row.publishedAt);
    assert.equal(row.scheduledAt, null);
    assert.equal(row.scopeType, 'GROUP');
    assert.equal(row.recipientsCount, 11);
    assert.equal(row.createdByUserId, mestre.userId);
    assert.equal(row.requiresAck, 'READ');
    assert.equal(row.pinToFeed, false);
  });

  it('validações do corpo: título/corpo/imagem/datas/campos extras; imagem válida é gravada', async () => {
    const bad = async (extra: Record<string, unknown>) => post(mestre.token, msg({ scope: { type: 'CLASS', classId: classA }, ...extra })).expect(400);
    await bad({ title: 'x' });
    await bad({ title: 'x'.repeat(81) });
    await bad({ body: 'y' });
    await bad({ body: 'y'.repeat(2001) });
    await bad({ imageUrl: 'javascript:alert(1)' });
    await bad({ imageUrl: '/etc/passwd' });
    await bad({ imageUrl: 'http://rastreador.example.com/pixel.png' }); // so https ou /api/uploads/ (http = mixed content/rastreio)
    await bad({ imageUrl: 'ftp://rastreador.example.com/pixel.png' });
    await bad({ scheduledAt: new Date(Date.now() - HOUR).toISOString() });
    await bad({ scheduledAt: inHours(24 * 91) });
    await bad({ pinToFeed: true, pinnedUntil: new Date(Date.now() - HOUR).toISOString() });
    await bad({ scheduledAt: inHours(48), pinToFeed: true, pinnedUntil: inHours(24) });
    await bad({ requiresAck: 'TALVEZ' });
    await bad({ confirmCount: -1 });
    await bad({ extra: 'campo desconhecido' });
    await post(mestre.token, { title: tag('sem escopo'), body: 'corpo ok' }).expect(400);
    await post(mestre.token, msg({ scope: { type: 'UNIT' } })).expect(400);
    await post(mestre.token, msg({ scope: { type: 'CLASS', classId: classOther } })).expect(400);
    await post(mestre.token, msg({ scope: { type: 'ROLE' } })).expect(400);
    const image = '/api/uploads/123e4567-e89b-42d3-a456-426614174000.webp';
    const ok = await post(mestre.token, msg({ scope: { type: 'CLASS', classId: classB }, imageUrl: image, title: ` ${tag('imagem')} ` })).expect(201);
    const row = await prisma.announcement.findUniqueOrThrow({ where: { id: ok.body.id } });
    assert.equal(row.imageUrl, image);
    assert.equal(row.title, tag('imagem'), 'título é aparado');
    assert.equal(await prisma.announcement.count({ where: { organizationId: org.organizationId, title: 'x' } }), 0);
  });

  it('agendamento + agendador: SCHEDULED sem notificar; só envia vencido; idempotente (inclusive concorrente); audita o envio', async () => {
    const at = new Date(Date.now() + 2 * HOUR);
    const res = await post(mestre.token, msg({ title: tag('agendado'), scope: { type: 'ROLE', role: 'RESPONSAVEL' }, scheduledAt: at.toISOString() })).expect(201);
    assert.equal(res.body.status, 'SCHEDULED');
    assert.equal(res.body.recipients, 1);
    const id = res.body.id as number;
    let row = await prisma.announcement.findUniqueOrThrow({ where: { id } });
    assert.equal(row.status, 'SCHEDULED');
    assert.equal(row.publishedAt, null);
    assert.equal(row.scheduledAt?.getTime(), at.getTime());
    assert.equal((await notifsOf(id)).length, 0, 'nada e enviado antes da hora');

    const service = app.get(CommunicationsService);
    const orgOnly = { organizationId: org.organizationId };
    assert.deepEqual(await service.sendDueScheduled(new Date(at.getTime() - 60_000), orgOnly), { sent: 0, cancelled: 0, failed: 0 });
    assert.equal((await notifsOf(id)).length, 0);

    // Duas execucoes SIMULTANEAS depois da hora: exatamente um envio.
    const sendNow = new Date(at.getTime() + 60_000);
    const [a, b] = await Promise.all([service.sendDueScheduled(sendNow, orgOnly), service.sendDueScheduled(sendNow, orgOnly)]);
    assert.equal(a.sent + b.sent, 1, 'transicao atomica SCHEDULED -> SENT: so um processo envia');
    assert.deepEqual(await userIdsOf(id), [respA.userId]);
    assert.equal((await notifsOf(id)).length, 1);
    row = await prisma.announcement.findUniqueOrThrow({ where: { id } });
    assert.equal(row.status, 'SENT');
    assert.equal(row.publishedAt?.getTime(), sendNow.getTime());
    assert.equal(row.recipientsCount, 1);
    assert.deepEqual((await notifsOf(id))[0].data, { communicationId: id, requiresAck: 'NONE' });

    assert.deepEqual(await service.sendDueScheduled(new Date(sendNow.getTime() + HOUR), orgOnly), { sent: 0, cancelled: 0, failed: 0 }, 'segunda rodada: nada a fazer');
    assert.equal((await notifsOf(id)).length, 1, 'nao duplica');

    const audit = await prisma.auditLog.findMany({ where: { organizationId: org.organizationId, action: 'COMMUNICATION_SEND', resourceId: String(id) } });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].userId, null, 'enviado pelo agendador: sem usuario');
    assert.deepEqual(audit[0].metadata, { scope: 'ROLE', recipients: 1, scheduled: true });

    // Invólucro do job: respeita COMM_SCHEDULER.
    const job = new CommunicationsSchedulerService(service);
    const previous = process.env.COMM_SCHEDULER;
    try {
      process.env.COMM_SCHEDULER = 'false';
      assert.equal(await job.run({ organizationId: org.organizationId }), null);
      process.env.COMM_SCHEDULER = 'true';
      assert.deepEqual(await job.run({ organizationId: org.organizationId }), { sent: 0, cancelled: 0, failed: 0 });
    } finally {
      if (previous === undefined) delete process.env.COMM_SCHEDULER;
      else process.env.COMM_SCHEDULER = previous;
    }

    // Turma apagada antes do envio: cancela em vez de virar envio ao grupo inteiro.
    const orphan = await post(mestre.token, msg({ title: tag('orfao'), scope: { type: 'CLASS', classId: classA }, scheduledAt: inHours(3) })).expect(201);
    await prisma.announcement.update({ where: { id: orphan.body.id }, data: { classId: null } });
    assert.deepEqual(await service.sendDueScheduled(new Date(Date.now() + 4 * HOUR), orgOnly), { sent: 0, cancelled: 1, failed: 0 });
    assert.equal((await prisma.announcement.findUniqueOrThrow({ where: { id: orphan.body.id } })).status, 'CANCELLED');
    assert.equal((await notifsOf(orphan.body.id)).length, 0);
  });

  it('confirmCount: acima de 50 destinatários exige a contagem atual (409 RECIPIENTS_CHANGED com {count})', async () => {
    const created = await prisma.user.createManyAndReturn({
      data: Array.from({ length: 45 }, (_, i) => ({
        email: `extra${i}-${stamp}${DOMAIN}`,
        passwordHash: 'x',
        name: `[e2e-comm] extra ${i}`,
        userType: 'MEMBER' as const,
        status: 'ACTIVE' as const,
      })),
      select: { id: true },
    });
    await prisma.organizationUser.createMany({ data: created.map((u) => ({ organizationId: org.organizationId, userId: u.id, role: OrgRole.ALUNO, status: 'ACTIVE' })) });
    try {
      assert.equal((await preview(mestre.token, { scope: 'GROUP' }).expect(200)).body.count, 56);
      const noConfirm = await post(mestre.token, msg({ title: tag('confirma') })).expect(409);
      assert.equal(noConfirm.body.code, 'RECIPIENTS_CHANGED');
      assert.equal(noConfirm.body.count, 56);
      const wrong = await post(mestre.token, msg({ title: tag('confirma'), confirmCount: 11 })).expect(409);
      assert.equal(wrong.body.count, 56);
      assert.equal(await prisma.announcement.count({ where: { organizationId: org.organizationId, title: tag('confirma') } }), 0, 'nada gravado sem confirmar');
      const ok = await post(mestre.token, msg({ title: tag('confirma'), confirmCount: 56 })).expect(201);
      assert.equal(ok.body.recipients, 56);
      assert.equal((await notifsOf(ok.body.id)).length, 56);
      // Ate 50: nao exige confirmCount (alcance pequeno).
      await post(mestre.token, msg({ title: tag('pequeno'), scope: { type: 'CLASS', classId: classA } })).expect(201);
    } finally {
      await prisma.notification.deleteMany({ where: { userId: { in: created.map((u) => u.id) } } });
      await prisma.organizationUser.deleteMany({ where: { userId: { in: created.map((u) => u.id) } } });
      await prisma.user.deleteMany({ where: { id: { in: created.map((u) => u.id) } } });
    }
    assert.equal((await preview(mestre.token, { scope: 'GROUP' }).expect(200)).body.count, 11);
  });

  it('cotas diárias (dia civil SP): 429 COMM_QUOTA_EXCEEDED por autor e por grupo; cancelar libera a vaga', async () => {
    const dayStart = new Date(`${todaySaoPaulo()}T00:00:00-03:00`);
    const used = (where: Record<string, unknown> = {}) =>
      prisma.announcement.count({ where: { organizationId: org.organizationId, scopeType: { not: null }, status: { not: 'CANCELLED' }, createdAt: { gte: dayStart }, ...where } });
    const prevOrg = process.env.COMM_DAILY_LIMIT_ORG;
    const prevAuthor = process.env.COMM_DAILY_LIMIT_AUTHOR;
    try {
      // Autor: p2 ainda nao enviou nada.
      assert.equal(await used({ createdByUserId: p2.userId }), 0);
      process.env.COMM_DAILY_LIMIT_AUTHOR = '2';
      const classBBody = msg({ title: tag('cota'), scope: { type: 'CLASS', classId: classB } });
      await post(p2.token, classBBody).expect(201);
      await post(p2.token, classBBody).expect(201);
      const blocked = await post(p2.token, classBBody).expect(429);
      assert.equal(blocked.body.code, 'COMM_QUOTA_EXCEEDED');
      assert.equal(blocked.body.scope, 'AUTHOR');
      assert.equal(await used({ createdByUserId: p2.userId }), 2, 'o bloqueado nao grava nada');
      process.env.COMM_DAILY_LIMIT_AUTHOR = '1000';

      // Grupo: limite = o que ja foi usado hoje.
      const scheduled = await post(mestre.token, msg({ title: tag('cota-agendado'), scope: { type: 'CLASS', classId: classA }, scheduledAt: inHours(5) })).expect(201);
      process.env.COMM_DAILY_LIMIT_ORG = String(await used());
      const orgBlocked = await post(mestre.token, msg({ title: tag('cota-grupo'), scope: { type: 'CLASS', classId: classA } })).expect(429);
      assert.equal(orgBlocked.body.code, 'COMM_QUOTA_EXCEEDED');
      assert.equal(orgBlocked.body.scope, 'ORG');
      await http().delete(`/api/communications/${scheduled.body.id}`).set(auth(mestre.token)).expect(200);
      await post(mestre.token, msg({ title: tag('cota-grupo'), scope: { type: 'CLASS', classId: classA } })).expect(201);
      await post(mestre.token, msg({ title: tag('cota-grupo'), scope: { type: 'CLASS', classId: classA } })).expect(429);
      // Outro grupo tem a propria cota.
      process.env.COMM_DAILY_LIMIT_ORG = '1';
      await post(orgB.token, msg({ title: tag('grupoB') })).expect(201);
      await post(orgB.token, msg({ title: tag('grupoB') })).expect(429);
    } finally {
      if (prevOrg === undefined) delete process.env.COMM_DAILY_LIMIT_ORG;
      else process.env.COMM_DAILY_LIMIT_ORG = prevOrg;
      if (prevAuthor === undefined) delete process.env.COMM_DAILY_LIMIT_AUTHOR;
      else process.env.COMM_DAILY_LIMIT_AUTHOR = prevAuthor;
    }
  });

  it('requiresAck + ack: upsert por usuário, troca GOING<->NOT_GOING, READ não sobrescreve presença, validações e marca como lido', async () => {
    const going = await post(p1.token, msg({ title: tag('vou'), scope: { type: 'CLASS', classId: classA }, requiresAck: 'GOING' })).expect(201);
    const id = going.body.id as number;
    assert.deepEqual((await ack(alunoA.token, id, 'GOING').expect(201)).body, { ok: true, response: 'GOING' });
    assert.equal(await prisma.announcementAck.count({ where: { announcementId: id, userId: alunoA.userId } }), 1);
    const mine = (await prisma.notification.findFirstOrThrow({ where: { announcementId: id, userId: alunoA.userId } })).readAt;
    assert.ok(mine, 'responder marca a notificação como lida');

    assert.deepEqual((await ack(alunoA.token, id, 'NOT_GOING').expect(201)).body, { ok: true, response: 'NOT_GOING' });
    assert.deepEqual((await ack(alunoA.token, id, 'GOING').expect(201)).body, { ok: true, response: 'GOING' });
    assert.deepEqual((await ack(alunoA.token, id, 'NOT_GOING').expect(201)).body, { ok: true, response: 'NOT_GOING' });
    assert.equal(await prisma.announcementAck.count({ where: { announcementId: id, userId: alunoA.userId } }), 1, 'uma linha por usuario');
    assert.deepEqual((await ack(alunoA.token, id, 'READ').expect(201)).body, { ok: true, response: 'NOT_GOING' }, '"Li" nao apaga a resposta de presenca');
    assert.equal((await prisma.announcementAck.findFirstOrThrow({ where: { announcementId: id, userId: alunoA.userId } })).response, 'NOT_GOING');
    await ack(respA.token, id, 'GOING').expect(201); // responsavel tambem e destinatario

    await ack(alunoB.token, id, 'GOING').expect(403); // outra turma: nao e destinatario
    await ack(mestre.token, id, 'GOING').expect(403); // nem o mestre, que nao esta no alcance CLASS
    assert.equal((await ack(alunoB.token, id, 'GOING')).body.code, 'NOT_RECIPIENT');
    await ack(alunoA.token, id, 'TALVEZ').expect(400);
    await http().post(`/api/communications/${id}/ack`).set(auth(alunoA.token)).send({}).expect(400);
    await ack(orgB.token, id, 'GOING').expect(404); // outro grupo

    // requiresAck READ: GOING/NOT_GOING nao se aplicam; READ vale.
    const read = await post(mestre.token, msg({ title: tag('li'), scope: { type: 'CLASS', classId: classA }, requiresAck: 'READ' })).expect(201);
    const bad = await ack(alunoA.token, read.body.id, 'GOING').expect(400);
    assert.equal(bad.body.code, 'ACK_NOT_ALLOWED');
    await ack(alunoA.token, read.body.id, 'NOT_GOING').expect(400);
    assert.deepEqual((await ack(alunoA.token, read.body.id, 'READ').expect(201)).body, { ok: true, response: 'READ' });
    // requiresAck NONE: so "Li".
    const none = await post(mestre.token, msg({ title: tag('aviso'), scope: { type: 'CLASS', classId: classA } })).expect(201);
    await ack(alunoA.token, none.body.id, 'GOING').expect(400);
    await ack(alunoA.token, none.body.id, 'READ').expect(201);

    // Agendado/cancelado ainda nao existe para o membro.
    const later = await post(mestre.token, msg({ title: tag('depois'), scope: { type: 'CLASS', classId: classA }, scheduledAt: inHours(6) })).expect(201);
    await ack(alunoA.token, later.body.id, 'READ').expect(404);
    await http().delete(`/api/communications/${later.body.id}`).set(auth(mestre.token)).expect(200);
    await ack(alunoA.token, later.body.id, 'READ').expect(404);
    await ack(alunoA.token, 99999999, 'READ').expect(404);

    // GROUP: qualquer membro do grupo responde, mesmo quem entrou depois do envio.
    const groupMsg = await post(mestre.token, msg({ title: tag('grupo-ack'), requiresAck: 'READ' })).expect(201);
    const late = await makeUser('tarde', OrgRole.ALUNO);
    assert.equal((await notifsOf(groupMsg.body.id)).filter((n) => n.userId === late.userId).length, 0);
    await ack(late.token, groupMsg.body.id, 'READ').expect(201);
    await ack(late.token, id, 'GOING').expect(403);
    await http().post(`/api/communications/${id}/ack`).expect(401);
    // Sai do grupo para nao alterar as contagens dos testes seguintes.
    await prisma.organizationUser.updateMany({ where: { organizationId: org.organizationId, userId: late.userId }, data: { status: 'INACTIVE' } });
  });

  it('fixados: só os vigentes (pinToFeed, SENT, pinnedUntil futuro/nulo) dentro do alcance do usuário; myAck; formato', async () => {
    const pGroup = await post(mestre.token, msg({ title: tag('fixo-grupo'), body: 'Fixado para todos', pinToFeed: true, pinnedUntil: inHours(24) })).expect(201);
    const pClass = await post(mestre.token, msg({ title: tag('fixo-turma'), scope: { type: 'CLASS', classId: classA }, pinToFeed: true, requiresAck: 'GOING' })).expect(201);
    const pUnitB = await post(mestre.token, msg({ title: tag('fixo-unidade-b'), scope: { type: 'UNIT', unitId: org.unitB.id }, pinToFeed: true })).expect(201);
    const expired = await post(mestre.token, msg({ title: tag('fixo-vencido'), pinToFeed: true, pinnedUntil: inHours(1) })).expect(201);
    await prisma.announcement.update({ where: { id: expired.body.id }, data: { pinnedUntil: new Date(Date.now() - HOUR) } });
    const notPinned = await post(mestre.token, msg({ title: tag('nao-fixo') })).expect(201);
    const scheduled = await post(mestre.token, msg({ title: tag('fixo-agendado'), pinToFeed: true, scheduledAt: inHours(8) })).expect(201);
    const cancelled = await post(mestre.token, msg({ title: tag('fixo-cancelado'), pinToFeed: true, scheduledAt: inHours(9) })).expect(201);
    await http().delete(`/api/communications/${cancelled.body.id}`).set(auth(mestre.token)).expect(200);

    const pinnedIds = async (token: string) => ((await http().get('/api/communications/pinned').set(auth(token)).expect(200)).body.items as { id: number }[]).map((i) => i.id);
    const forA = await pinnedIds(alunoA.token);
    assert.ok(forA.includes(pGroup.body.id) && forA.includes(pClass.body.id));
    assert.ok(![pUnitB.body.id, expired.body.id, notPinned.body.id, scheduled.body.id, cancelled.body.id].some((i) => forA.includes(i)));
    const forB = await pinnedIds(alunoB.token);
    assert.ok(forB.includes(pGroup.body.id) && forB.includes(pUnitB.body.id));
    assert.ok(!forB.includes(pClass.body.id), 'turma A nao aparece para o aluno da turma B');
    assert.ok(!forB.includes(expired.body.id));
    assert.deepEqual((await pinnedIds(orgB.token)), [], 'outro grupo nao ve nada');
    assert.ok((await pinnedIds(respA.token)).includes(pClass.body.id), 'responsavel recebe o fixado da turma do dependente');

    await ack(alunoA.token, pClass.body.id, 'GOING').expect(201);
    const body = (await http().get('/api/communications/pinned').set(auth(alunoA.token)).expect(200)).body as { items: Record<string, unknown>[] };
    const item = body.items.find((i) => i.id === pClass.body.id)!;
    assert.deepEqual(Object.keys(item).sort(), ['body', 'createdAt', 'id', 'imageUrl', 'myAck', 'pinnedUntil', 'requiresAck', 'title']);
    assert.equal(item.myAck, 'GOING');
    assert.equal(item.requiresAck, 'GOING');
    assert.equal(item.pinnedUntil, null);
    assert.equal(body.items.find((i) => i.id === pGroup.body.id)!.myAck, null);
    assert.equal(body.items.find((i) => i.id === pGroup.body.id)!.body, 'Fixado para todos');
    assert.equal(typeof body.items.find((i) => i.id === pGroup.body.id)!.pinnedUntil, 'string');

    // Vigencia: estende o prazo do vencido e ele volta; cancelado/desativado some.
    await prisma.announcement.update({ where: { id: expired.body.id }, data: { pinnedUntil: null } });
    assert.ok((await pinnedIds(alunoA.token)).includes(expired.body.id));
    await prisma.announcement.update({ where: { id: expired.body.id }, data: { pinnedUntil: new Date(Date.now() - 1000) } });
    assert.ok(!(await pinnedIds(alunoA.token)).includes(expired.body.id));
    await http().get('/api/communications/pinned').expect(401);
  });

  it('histórico e estatísticas: recipients, lidos (readAt + confirmações), acks por resposta, pending; visibilidade MESTRE x autor', async () => {
    const res = await post(p1.token, msg({ title: tag('stats'), body: 'Treino especial', scope: { type: 'CLASS', classId: classA }, requiresAck: 'GOING' })).expect(201);
    const id = res.body.id as number;
    assert.equal(res.body.recipients, 3);
    // alunoA confirma (vira lido), respA so abre a notificacao (lido sem confirmar), p1 nao faz nada.
    await ack(alunoA.token, id, 'GOING').expect(201);
    const respNotif = await prisma.notification.findFirstOrThrow({ where: { announcementId: id, userId: respA.userId } });
    await http().patch(`/api/notifications/${respNotif.id}/read`).set(auth(respA.token)).expect(200);

    let detail = (await getOne(p1.token, id).expect(200)).body;
    assert.equal(detail.id, id);
    assert.equal(detail.status, 'SENT');
    assert.equal(detail.scopeType, 'CLASS');
    assert.equal(detail.recipientsCount, 3);
    assert.equal(detail.readCount, 2);
    assert.equal(detail.ackCount, 1);
    assert.deepEqual(detail.acks, { READ: 0, GOING: 1, NOT_GOING: 0 });
    assert.equal(detail.pending, 2, 'requiresAck GOING: destinatarios - confirmados');
    assert.equal(detail.requiresAck, 'GOING');
    assert.equal(detail.body, 'Treino especial');
    assert.equal(detail.imageUrl, null);
    assert.equal(detail.scheduledAt, null);
    assert.ok(detail.sentAt);
    assert.equal(detail.createdByName, 'E2E comm professor');
    assert.deepEqual(detail.scope, { type: 'CLASS', unitId: null, unitName: null, classId: classA, className: 'Turma A', role: null });
    await ack(respA.token, id, 'NOT_GOING').expect(201);
    detail = (await getOne(p1.token, id).expect(200)).body;
    assert.deepEqual(detail.acks, { READ: 0, GOING: 1, NOT_GOING: 1 });
    assert.equal(detail.ackCount, 2);
    assert.equal(detail.pending, 1);
    assert.equal(detail.readCount, 2, 'quem confirmou e quem leu contam uma vez so');

    // requiresAck NONE: pending = destinatarios que ainda nao leram.
    const none = await post(mestre.token, msg({ title: tag('stats-none') })).expect(201);
    const n1 = await prisma.notification.findFirstOrThrow({ where: { announcementId: none.body.id, userId: semVinculo.userId } });
    await http().patch(`/api/notifications/${n1.id}/read`).set(auth(semVinculo.token)).expect(200);
    const noneDetail = (await getOne(mestre.token, none.body.id).expect(200)).body;
    assert.equal(noneDetail.readCount, 1);
    assert.equal(noneDetail.ackCount, 0);
    assert.equal(noneDetail.pending, 10);

    // Lista: array + X-Total-Count, filtros, paginacao.
    const dbTotal = await prisma.announcement.count({ where: { organizationId: org.organizationId, scopeType: { not: null } } });
    const list = await http().get('/api/communications?limit=200').set(auth(mestre.token)).expect(200);
    assert.ok(Array.isArray(list.body));
    assert.equal(Number(list.headers['x-total-count']), dbTotal);
    assert.equal(list.body.length, dbTotal);
    const first = list.body.find((i: { id: number }) => i.id === id);
    assert.deepEqual(Object.keys(first).sort(), [
      'ackCount', 'createdAt', 'createdByName', 'id', 'lastResendAt', 'pinToFeed', 'pinnedUntil', 'readCount', 'recipientsCount',
      'requiresAck', 'scheduledAt', 'scopeType', 'sentAt', 'status', 'title',
    ]);
    assert.equal(first.readCount, 2);
    assert.equal(first.ackCount, 2);
    const page = await http().get('/api/communications?limit=2&offset=1').set(auth(mestre.token)).expect(200);
    assert.equal(page.body.length, 2);
    assert.equal(Number(page.headers['x-total-count']), dbTotal);
    const onlyScheduled = await http().get('/api/communications?status=SCHEDULED&limit=200').set(auth(mestre.token)).expect(200);
    assert.ok(onlyScheduled.body.length > 0 && onlyScheduled.body.every((i: { status: string; sentAt: unknown }) => i.status === 'SCHEDULED' && i.sentAt === null));
    const byTitle = await http().get(`/api/communications?q=${encodeURIComponent(tag('stats-none'))}`).set(auth(mestre.token)).expect(200);
    assert.deepEqual(byTitle.body.map((i: { id: number }) => i.id), [none.body.id]);
    await http().get('/api/communications?status=XYZ').set(auth(mestre.token)).expect(400);

    // Visibilidade: o autor ve so os seus; outro professor nao ve nem acessa; mestre ve tudo.
    const mine = await http().get('/api/communications?limit=200').set(auth(p1.token)).expect(200);
    assert.ok(mine.body.length > 0);
    const authored = await prisma.announcement.count({ where: { organizationId: org.organizationId, scopeType: { not: null }, createdByUserId: p1.userId } });
    assert.equal(Number(mine.headers['x-total-count']), authored);
    assert.ok(mine.body.some((i: { id: number }) => i.id === id) && !mine.body.some((i: { id: number }) => i.id === none.body.id));
    const others = await http().get('/api/communications?limit=200').set(auth(p3.token)).expect(200);
    assert.deepEqual(others.body, []);
    await getOne(p2.token, id).expect(404);
    await http().delete(`/api/communications/${id}`).set(auth(p2.token)).expect(404);
    await getOne(p1.token, none.body.id).expect(404);
    await getOne(mestre.token, id).expect(200);
    await getOne(mestre.token, 99999999).expect(404);
  });

  it('reenvio aos não lidos: só quem não leu nem confirmou; 429 RESEND_TOO_SOON dentro de 24h; 0 não consome o direito; 409 se não enviado', async () => {
    const res = await post(p1.token, msg({ title: tag('reenvio'), scope: { type: 'CLASS', classId: classA }, requiresAck: 'GOING' })).expect(201);
    const id = res.body.id as number;
    await ack(alunoA.token, id, 'GOING').expect(201);
    const respNotif = await prisma.notification.findFirstOrThrow({ where: { announcementId: id, userId: respA.userId } });
    await http().patch(`/api/notifications/${respNotif.id}/read`).set(auth(respA.token)).expect(200);

    const resend = () => http().post(`/api/communications/${id}/resend-unread`).set(auth(p1.token));
    assert.deepEqual((await resend().expect(201)).body, { sent: 1 });
    const rows = await notifsOf(id);
    assert.equal(rows.length, 4, '3 originais + 1 lembrete');
    const reminder = rows.filter((r) => r.title.startsWith('Lembrete: '));
    assert.equal(reminder.length, 1);
    assert.equal(reminder[0].userId, p1.userId, 'so o professor (unico que nao leu nem confirmou)');
    assert.deepEqual(reminder[0].data, { communicationId: id, requiresAck: 'GOING', reminder: true });
    assert.equal(reminder[0].announcementId, id);
    assert.equal((await getOne(p1.token, id)).body.recipientsCount, 3, 'o reenvio nao muda a contagem de destinatarios');

    const again = await resend().expect(429);
    assert.equal(again.body.code, 'RESEND_TOO_SOON');
    assert.equal((await notifsOf(id)).length, 4);

    // 25 h depois pode de novo.
    await prisma.announcement.update({ where: { id }, data: { lastResendAt: new Date(Date.now() - 25 * HOUR) } });
    assert.deepEqual((await resend().expect(201)).body, { sent: 1 });
    assert.equal((await notifsOf(id)).length, 5);

    // Todos leram: nada a reenviar e o direito de reenvio nao e gasto.
    await http().patch('/api/notifications/read-all').set(auth(p1.token)).expect(200);
    const backdated = new Date(Date.now() - 26 * HOUR);
    await prisma.announcement.update({ where: { id }, data: { lastResendAt: backdated } });
    assert.deepEqual((await resend().expect(201)).body, { sent: 0 });
    assert.equal((await prisma.announcement.findUniqueOrThrow({ where: { id } })).lastResendAt?.getTime(), backdated.getTime());

    // Agendado: 409; outro professor: 404; auditoria sem texto.
    const sched = await post(mestre.token, msg({ title: tag('reenvio-agendado'), scheduledAt: inHours(7) })).expect(201);
    const notSent = await http().post(`/api/communications/${sched.body.id}/resend-unread`).set(auth(mestre.token)).expect(409);
    assert.equal(notSent.body.code, 'NOT_SENT');
    await http().post(`/api/communications/${id}/resend-unread`).set(auth(p2.token)).expect(404);
    const audit = await prisma.auditLog.findMany({ where: { organizationId: org.organizationId, action: 'COMMUNICATION_RESEND', resourceId: String(id) } });
    assert.equal(audit.length, 2);
    assert.deepEqual(audit.map((a) => a.metadata), [{ sent: 1 }, { sent: 1 }]);
  });

  it('cancelar: só SCHEDULED (200 {id,status}); idempotente; enviado = 409 ALREADY_SENT; o agendador não envia o cancelado', async () => {
    const sched = await post(mestre.token, msg({ title: tag('cancelar'), scope: { type: 'CLASS', classId: classA }, scheduledAt: inHours(2) })).expect(201);
    const id = sched.body.id as number;
    await http().delete(`/api/communications/${id}`).set(auth(p2.token)).expect(404);
    assert.deepEqual((await http().delete(`/api/communications/${id}`).set(auth(mestre.token)).expect(200)).body, { id, status: 'CANCELLED' });
    assert.equal((await prisma.announcement.findUniqueOrThrow({ where: { id } })).status, 'CANCELLED');
    await http().delete(`/api/communications/${id}`).set(auth(mestre.token)).expect(200);
    const swept = await app.get(CommunicationsService).sendDueScheduled(new Date(Date.now() + 3 * HOUR), { organizationId: org.organizationId });
    assert.equal(swept.sent, 0);
    assert.equal((await notifsOf(id)).length, 0);
    assert.equal((await getOne(mestre.token, id).expect(200)).body.status, 'CANCELLED');

    const sent = await post(mestre.token, msg({ title: tag('ja-enviado'), scope: { type: 'CLASS', classId: classA } })).expect(201);
    const conflict = await http().delete(`/api/communications/${sent.body.id}`).set(auth(mestre.token)).expect(409);
    assert.equal(conflict.body.code, 'ALREADY_SENT');
    assert.equal((await prisma.announcement.findUniqueOrThrow({ where: { id: sent.body.id } })).status, 'SENT');
    assert.equal(await prisma.auditLog.count({ where: { organizationId: org.organizationId, action: 'COMMUNICATION_CANCEL', resourceId: String(id) } }), 1);
    await http().delete('/api/communications/99999999').set(auth(mestre.token)).expect(404);
  });

  it('permissões: PROFESSOR só CLASS nas próprias turmas (e no escopo de unidade); ALUNO/MONITOR 403 nas rotas do painel', async () => {
    const asP1 = (scope: Record<string, unknown>) => post(p1.token, msg({ title: tag('perm'), scope }));
    await asP1({ type: 'CLASS', classId: classA }).expect(201); // turma dele (Class.teacherUserId)
    await asP1({ type: 'CLASS', classId: classB }).expect(403); // turma de outro professor
    await asP1({ type: 'CLASS', classId: classOther }).expect(400); // turma de outro grupo
    for (const scope of [{ type: 'GROUP' }, { type: 'UNIT', unitId: org.unitA.id }, { type: 'ROLE', role: 'ALUNO' }, { type: 'BIRTHDAY_MONTH' }]) {
      await asP1(scope).expect(403);
    }
    await preview(p1.token, { scope: 'GROUP' }).expect(403);
    await preview(p1.token, { scope: 'BIRTHDAY_MONTH' }).expect(403);
    await preview(p1.token, { scope: 'CLASS', classId: classB }).expect(403);
    assert.equal((await preview(p1.token, { scope: 'CLASS', classId: classA }).expect(200)).body.count, 3);

    // Aula dele na turma B => turma "propria" (Lesson.teacherUserId, como o resto do sistema).
    await prisma.lesson.create({ data: { organizationId: org.organizationId, classId: classB, unitId: org.unitB.id, teacherUserId: p1.userId, date: new Date() } });
    await asP1({ type: 'CLASS', classId: classB }).expect(201);

    // Professor restrito a unidade A: turma C (unidade B) e dele, mas fora do escopo de unidade.
    await post(p3.token, msg({ title: tag('perm3'), scope: { type: 'CLASS', classId: classC } })).expect(403);
    await preview(p3.token, { scope: 'CLASS', classId: classC }).expect(403);

    for (const user of [alunoA, monitor, respA, semVinculo]) {
      await post(user.token, msg({ scope: { type: 'CLASS', classId: classA } })).expect(403);
      await preview(user.token, { scope: 'CLASS', classId: classA }).expect(403);
      await http().get('/api/communications').set(auth(user.token)).expect(403);
      await http().get('/api/communications/1').set(auth(user.token)).expect(403);
      await http().post('/api/communications/1/resend-unread').set(auth(user.token)).expect(403);
      await http().delete('/api/communications/1').set(auth(user.token)).expect(403);
    }
    // ...mas pinned/ack sao do membro.
    await http().get('/api/communications/pinned').set(auth(alunoA.token)).expect(200);
    await http().get('/api/communications/pinned').set(auth(monitor.token)).expect(200);
    await post(mestre.token, msg({ title: tag('mestre-turma-alheia'), scope: { type: 'CLASS', classId: classC } })).expect(201); // mestre: qualquer turma do grupo
    await http().post('/api/communications').send(msg()).expect(401);
  });

  it('BIRTHDAY_MONTH: envia só a adultos visíveis + equipe do mês (nunca menor, opt-out ou outro mês) e conta igual à prévia', async () => {
    const shown = (await preview(mestre.token, { scope: 'BIRTHDAY_MONTH' }).expect(200)).body.count;
    const res = await post(mestre.token, msg({ title: tag('aniversariantes'), scope: { type: 'BIRTHDAY_MONTH' } })).expect(201);
    assert.equal(res.body.recipients, shown);
    assert.deepEqual(await userIdsOf(res.body.id), sorted([alunoA.userId, mestre.userId, p1.userId]));
    for (const excluded of [kid.userId, alunoB.userId, alunoM.userId, respA.userId]) {
      assert.ok(!(await userIdsOf(res.body.id)).includes(excluded));
    }
  });

  it('isolamento entre grupos: o outro grupo não vê, não confirma, não cancela nem reenvia; alcance de outro grupo é 400', async () => {
    const mine = await post(mestre.token, msg({ title: tag('isolado'), pinToFeed: true, scope: { type: 'CLASS', classId: classA } })).expect(201);
    const id = mine.body.id as number;
    await getOne(orgB.token, id).expect(404);
    await http().delete(`/api/communications/${id}`).set(auth(orgB.token)).expect(404);
    await http().post(`/api/communications/${id}/resend-unread`).set(auth(orgB.token)).expect(404);
    await ack(orgB.token, id, 'READ').expect(404);
    await preview(orgB.token, { scope: 'UNIT', unitId: org.unitA.id }).expect(400);
    await post(orgB.token, msg({ scope: { type: 'CLASS', classId: classA } })).expect(400);
    const list = await http().get('/api/communications?limit=200').set(auth(orgB.token)).expect(200);
    assert.ok(!list.body.some((i: { id: number }) => i.id === id));
    const onlyB = await prisma.announcement.count({ where: { organizationId: orgB.organizationId, scopeType: { not: null } } });
    assert.equal(Number(list.headers['x-total-count']), onlyB);
    assert.deepEqual((await http().get('/api/communications/pinned').set(auth(orgB.token)).expect(200)).body, { items: [] });
    assert.equal(await prisma.notification.count({ where: { organizationId: orgB.organizationId, announcementId: id } }), 0);
  });

  it('legado /announcements intacto: só lista SENT (nunca agendado/cancelado); membro não vê ROLE alheio, EQUIPE nem BIRTHDAY_MONTH', async () => {
    const sentGroup = await post(mestre.token, msg({ title: tag('legado-grupo') })).expect(201);
    const sentEquipe = await post(mestre.token, msg({ title: tag('legado-equipe'), scope: { type: 'ROLE', role: 'EQUIPE' } })).expect(201);
    const sentAlunos = await post(mestre.token, msg({ title: tag('legado-alunos'), scope: { type: 'ROLE', role: 'ALUNO' } })).expect(201);
    const sentPais = await post(mestre.token, msg({ title: tag('legado-pais'), scope: { type: 'ROLE', role: 'RESPONSAVEL' } })).expect(201);
    const sentBday = await post(mestre.token, msg({ title: tag('legado-niver'), scope: { type: 'BIRTHDAY_MONTH' } })).expect(201);
    const sentClassA = await post(mestre.token, msg({ title: tag('legado-turma-a'), scope: { type: 'CLASS', classId: classA } })).expect(201);
    const scheduled = await post(mestre.token, msg({ title: tag('legado-agendado'), scheduledAt: inHours(10) })).expect(201);
    const cancelled = await post(mestre.token, msg({ title: tag('legado-cancelado'), scheduledAt: inHours(11) })).expect(201);
    await http().delete(`/api/communications/${cancelled.body.id}`).set(auth(mestre.token)).expect(200);

    const legacyIds = async (token: string) => ((await http().get('/api/announcements?limit=200').set(auth(token)).expect(200)).body as { id: number }[]).map((a) => a.id);
    const asMestre = await legacyIds(mestre.token);
    for (const r of [sentGroup, sentEquipe, sentAlunos, sentPais, sentBday, sentClassA]) assert.ok(asMestre.includes(r.body.id), 'staff ve os enviados');
    assert.ok(!asMestre.includes(scheduled.body.id) && !asMestre.includes(cancelled.body.id), 'agendado/cancelado nunca no mural legado');
    await http().get(`/api/announcements/${scheduled.body.id}`).set(auth(mestre.token)).expect(404);
    await http().get(`/api/announcements/${cancelled.body.id}`).set(auth(mestre.token)).expect(404);
    await http().get(`/api/announcements/${sentGroup.body.id}`).set(auth(mestre.token)).expect(200);
    await http().patch(`/api/announcements/${scheduled.body.id}`).set(auth(mestre.token)).send({ title: 'novo titulo' }).expect(404);

    const asAluno = await legacyIds(alunoA.token);
    assert.ok(asAluno.includes(sentGroup.body.id) && asAluno.includes(sentAlunos.body.id) && asAluno.includes(sentClassA.body.id));
    for (const r of [sentEquipe, sentPais, sentBday, scheduled, cancelled]) assert.ok(!asAluno.includes(r.body.id));
    const asResp = await legacyIds(respA.token);
    assert.ok(asResp.includes(sentGroup.body.id) && asResp.includes(sentPais.body.id));
    for (const r of [sentEquipe, sentAlunos, sentBday, scheduled]) assert.ok(!asResp.includes(r.body.id));
    const asB = await legacyIds(alunoB.token);
    assert.ok(!asB.includes(sentClassA.body.id), 'turma A nao aparece para o aluno da turma B');
    await http().get(`/api/announcements/${sentEquipe.body.id}`).set(auth(alunoA.token)).expect(404);
    await http().get(`/api/announcements/${sentBday.body.id}`).set(auth(alunoA.token)).expect(404);

    // O fluxo legado continua igual: cria, notifica e entra na lista.
    const legacy = await http().post('/api/announcements').set(auth(mestre.token)).send({ title: tag('legado-novo'), body: 'Aviso do mural antigo' }).expect(201);
    assert.equal(legacy.body.status, 'SENT');
    assert.equal(legacy.body.scopeType, null);
    assert.ok((await legacyIds(mestre.token)).includes(legacy.body.id));
    assert.equal(await prisma.notification.count({ where: { organizationId: org.organizationId, title: tag('legado-novo'), type: 'ANNOUNCEMENT' } }), 11);
    // ...e o historico do Comunicar nao mistura os legados.
    const history = await http().get('/api/communications?limit=200').set(auth(mestre.token)).expect(200);
    assert.ok(!history.body.some((i: { id: number }) => i.id === legacy.body.id));

    // M2: o mural antigo NAO edita nem encerra o que foi criado em Comunicar (alcance/cotas/papeis proprios).
    const rowBefore = await prisma.announcement.findUniqueOrThrow({ where: { id: sentClassA.body.id } });
    for (const call of [
      () => http().patch(`/api/announcements/${sentClassA.body.id}`).set(auth(mestre.token)).send({ title: 'invadido', classId: null, unitId: null }),
      () => http().patch(`/api/announcements/${sentGroup.body.id}`).set(auth(mestre.token)).send({ isActive: false }),
      () => http().delete(`/api/announcements/${sentClassA.body.id}`).set(auth(mestre.token)),
    ]) {
      const res = await call().expect(409);
      assert.equal(res.body.code, 'MANAGED_BY_COMMUNICATIONS');
    }
    const rowAfter = await prisma.announcement.findUniqueOrThrow({ where: { id: sentClassA.body.id } });
    assert.deepEqual([rowAfter.title, rowAfter.classId, rowAfter.isActive, rowAfter.scopeType], [rowBefore.title, rowBefore.classId, true, 'CLASS'], 'alcance e estado intactos');
    assert.equal((await prisma.announcement.findUniqueOrThrow({ where: { id: sentGroup.body.id } })).isActive, true);
    // o legado de verdade (scopeType nulo) continua editavel e encerravel
    await http().patch(`/api/announcements/${legacy.body.id}`).set(auth(mestre.token)).send({ body: 'Aviso do mural antigo, editado' }).expect(200);
    await http().delete(`/api/announcements/${legacy.body.id}`).set(auth(mestre.token)).expect(200);
    assert.equal((await prisma.announcement.findUniqueOrThrow({ where: { id: legacy.body.id } })).isActive, false);
  });

  it('429 do throttler sai com code TOO_MANY_REQUESTS nas rotas do Comunicar (filtro ligado ao controller)', async () => {
    const { ThrottlerException } = await import('@nestjs/throttler');
    const { CommunicationsExceptionFilter } = await import('../src/interface/http/communications/communications-http');
    const { CommunicationsController } = await import('../src/interface/http/communications/communications.controller');
    const filters = Reflect.getMetadata('__exceptionFilters__', CommunicationsController) as unknown[];
    assert.ok(filters.includes(CommunicationsExceptionFilter), 'filtro registrado no controller');
    let status = 0;
    let body: Record<string, unknown> = {};
    const res = { status: (s: number) => ((status = s), res), json: (b: Record<string, unknown>) => ((body = b), res) };
    const host = { switchToHttp: () => ({ getResponse: () => res }) };
    new CommunicationsExceptionFilter().catch(new ThrottlerException(), host as never);
    assert.equal(status, 429);
    assert.equal(body.code, 'TOO_MANY_REQUESTS');
    // erros que ja trazem `code` passam intactos
    new CommunicationsExceptionFilter().catch(new ConflictException({ statusCode: 409, code: 'RECIPIENTS_CHANGED', message: 'x' }), host as never);
    assert.deepEqual([status, body.code], [409, 'RECIPIENTS_CHANGED']);
  });

  it('GET /notifications/audiences?own=1: PROFESSOR so ve as turmas que leciona; sem own=1 e o Mestre veem todas', async () => {
    const classIds = async (token: string, qs = '') =>
      ((await http().get(`/api/notifications/audiences${qs}`).set(auth(token)).expect(200)).body.classes as Array<{ id: number }>).map((c) => c.id);
    assert.deepEqual(await classIds(p2.token, '?own=1'), [classB]);
    assert.deepEqual(await classIds(p1.token, '?own=1'), [classA, classB], 'turma dele + turma em que tem aula (como o envio aceita)');
    assert.deepEqual(await classIds(p3.token, '?own=1'), [], 'a turma C e dele, mas fora do escopo de unidade (o envio dela da 403)');
    const all = await classIds(p2.token);
    assert.ok([classA, classB, classC].every((id) => all.includes(id)), 'sem own=1 (aviso rapido) segue por unidade');
    const mestreOwn = await classIds(mestre.token, '?own=1');
    assert.ok([classA, classB, classC].every((id) => mestreOwn.includes(id)), 'o Mestre ve todas mesmo com own=1');
    // o que o Comunicar oferece e aceito no envio
    await preview(p2.token, { scope: 'CLASS', classId: classB }).expect(200);
  });

  it('auditoria COMMUNICATION_CREATE|SEND|CANCEL|RESEND: alcance e contagens, NUNCA o título nem o texto', async () => {
    const secret = `SEGREDO${stamp}`;
    const res = await post(mestre.token, msg({ title: `Titulo ${secret}`, body: `Texto ${secret}`, scope: { type: 'CLASS', classId: classA } })).expect(201);
    const sched = await post(mestre.token, msg({ title: `Agenda ${secret}`, body: `Texto ${secret}`, scheduledAt: inHours(12) })).expect(201);
    await http().delete(`/api/communications/${sched.body.id}`).set(auth(mestre.token)).expect(200);
    await http().post(`/api/communications/${res.body.id}/resend-unread`).set(auth(mestre.token)).expect(201);

    const rows = await prisma.auditLog.findMany({
      where: { organizationId: org.organizationId, action: { in: ['COMMUNICATION_CREATE', 'COMMUNICATION_SEND', 'COMMUNICATION_CANCEL', 'COMMUNICATION_RESEND'] }, resourceId: { in: [String(res.body.id), String(sched.body.id)] } },
    });
    const byAction = (action: string, id: number) => rows.filter((r) => r.action === action && r.resourceId === String(id));
    assert.equal(byAction('COMMUNICATION_CREATE', res.body.id).length, 1);
    assert.equal(byAction('COMMUNICATION_SEND', res.body.id).length, 1);
    assert.equal(byAction('COMMUNICATION_RESEND', res.body.id).length, 1);
    assert.equal(byAction('COMMUNICATION_CREATE', sched.body.id).length, 1);
    assert.equal(byAction('COMMUNICATION_SEND', sched.body.id).length, 0, 'agendado e cancelado nunca foi enviado');
    assert.equal(byAction('COMMUNICATION_CANCEL', sched.body.id).length, 1);
    assert.deepEqual(byAction('COMMUNICATION_CREATE', res.body.id)[0].metadata, {
      scope: 'CLASS', unitId: null, classId: classA, role: null, requiresAck: 'NONE', scheduled: false, pinToFeed: false, recipients: 3,
    });
    assert.equal(byAction('COMMUNICATION_CREATE', res.body.id)[0].userId, mestre.userId);
    for (const r of rows) {
      assert.ok(!JSON.stringify(r).includes(secret), `auditoria ${r.action} nao pode conter o texto da mensagem`);
      assert.equal(r.resource, 'announcement');
    }
  });
});
