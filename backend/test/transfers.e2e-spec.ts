import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { TransfersService } from '../src/interface/http/people/transfers.service';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * FICHA UNICA - Fase 2: transferencia entre grupos (docs/FICHA_UNICA.md secao 4). Tres grupos PROPRIOS (A = origem,
 * B = destino, C = estranho); nunca o seed nem o demo. Fixtures "[e2e-transf]" / "@e2e-transf.local", limpas no after().
 */
const PREFIX = '[e2e-transf]';
const DOMAIN = '@e2e-transf.local';
const PASSWORD = 'Prov@Senha2026x';

function makeCpf(): string {
  for (;;) {
    const base = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
    if (/^(\d)\1{8}$/.test(base)) continue;
    const digit = (s: string) => {
      let sum = 0;
      for (let i = 0; i < s.length; i++) sum += Number(s[i]) * (s.length + 1 - i);
      const rest = (sum * 10) % 11;
      return rest === 10 ? 0 : rest;
    };
    const d1 = digit(base);
    return base + d1 + digit(base + d1);
  }
}

describe('transferencia entre grupos - fase 2 (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let A: ReportOrg;
  let B: ReportOrg;
  let C: ReportOrg;
  let slugA: string;
  let slugB: string;
  const stamp = Date.now();
  const FINANCE_MARK = `Mensalidade sigilosa ${stamp}`;
  const anaCpf = makeCpf();
  let ana: { id: number; personId: number; userId: number; token: string };
  let anaTransferId: number;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (email: string, slug: string) =>
    (await http().post('/api/auth/login').send({ email, password: PASSWORD, organizationSlug: slug }).expect(200)).body.accessToken as string;

  /** Aluno adulto no grupo A, criado pela API (com ficha) e, opcionalmente, com login proprio. */
  async function adultInA(name: string, withLogin: boolean, document?: string) {
    const s = (await http().post('/api/students').set(auth(A.mestre.token)).send({ name: `${PREFIX} ${name}`, birthDate: '1990-01-01', document }).expect(201)).body;
    if (!withLogin) return { id: s.id as number, personId: s.personId as number, userId: 0, token: '' };
    const email = `${name.toLowerCase()}-${stamp}${DOMAIN}`;
    await http().post(`/api/students/${s.id}/account`).set(auth(A.mestre.token)).send({ email, password: PASSWORD }).expect(201);
    const user = await prisma.user.update({ where: { email }, data: { mustChangePassword: false } });
    return { id: s.id as number, personId: s.personId as number, userId: user.id, token: await login(email, slugA), email };
  }
  const requestTransfer = (personId: number, extra: Record<string, unknown> = {}) =>
    http().post('/api/transfers').set(auth(B.mestre.token)).send({ personId, ...extra });
  const svc = () => app.get(TransfersService);

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    A = await createReportOrg(app, prisma, 'transf-a');
    B = await createReportOrg(app, prisma, 'transf-b');
    C = await createReportOrg(app, prisma, 'transf-c');
    slugA = (await prisma.organization.findUniqueOrThrow({ where: { id: A.organizationId } })).slug;
    slugB = (await prisma.organization.findUniqueOrThrow({ where: { id: B.organizationId } })).slug;
    ana = await adultInA('Ana', true, anaCpf);

    // Historico da Ana no grupo A: 1 presenca, 1 graduacao, 1 certificado e 1 mensalidade (que NUNCA pode vazar).
    const cls = await prisma.class.create({ data: { organizationId: A.organizationId, name: `${PREFIX} Turma A`, autoGenerateLessons: false } });
    const lesson = await prisma.lesson.create({ data: { organizationId: A.organizationId, classId: cls.id, date: new Date('2026-09-01T00:00:00Z') } });
    await prisma.attendance.create({ data: { organizationId: A.organizationId, lessonId: lesson.id, studentId: ana.id, present: true } });
    const system = await prisma.graduationSystem.create({ data: { organizationId: A.organizationId, name: `${PREFIX} Sistema A` } });
    const level = await prisma.graduationLevel.create({
      data: { organizationId: A.organizationId, graduationSystemId: system.id, name: 'Verde', order: 2, color: '#00AA00', colors: ['#00AA00'] },
    });
    await prisma.studentGraduation.create({ data: { organizationId: A.organizationId, studentId: ana.id, graduationLevelId: level.id, graduatedAt: new Date('2026-06-01T00:00:00Z') } });
    await prisma.certificate.create({ data: { organizationId: A.organizationId, studentId: ana.id, title: `${PREFIX} Certificado Verde` } });
    await prisma.financialRecord.create({ data: { organizationId: A.organizationId, studentId: ana.id, description: FINANCE_MARK, amountCents: 98765, dueDate: new Date() } });
  });

  after(async () => {
    const orgIds = [A.organizationId, B.organizationId, C.organizationId];
    await prisma.transferRequest.deleteMany({ where: { OR: [{ toOrganizationId: { in: orgIds } }, { fromOrganizationId: { in: orgIds } }] } });
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    await prisma.notification.deleteMany({ where: { userId: { in: [...userIds, A.mestre.userId, B.mestre.userId, C.mestre.userId] } } });
    await A.cleanup();
    await B.cleanup();
    await C.cleanup();
    await prisma.person.deleteMany({ where: { name: { startsWith: PREFIX }, students: { none: {} } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('cadastro no grupo novo devolve 409 PERSON_EXISTS_ELSEWHERE com transferAvailable e o caminho do pedido', async () => {
    const res = await http().post('/api/students').set(auth(B.mestre.token)).send({ name: `${PREFIX} Ana`, document: anaCpf }).expect(409);
    assert.equal(res.body.code, 'PERSON_EXISTS_ELSEWHERE');
    assert.equal(res.body.transferAvailable, true);
    assert.deepEqual(res.body.transfer, { method: 'POST', path: '/api/transfers', body: { personId: ana.personId } });
  });

  it('pedido: so MESTRE; 201 novo e 200 idempotente (1 pedido aberto por pessoa+grupo); avisa a pessoa e o grupo antigo', async () => {
    await requestTransfer(ana.personId).set(auth(B.aluno.token)).expect(403);
    await http().post('/api/transfers').set(auth(B.professor.token)).send({ personId: ana.personId }).expect(403);
    const first = await requestTransfer(ana.personId, { unitId: B.unitA.id, note: 'Mudou de cidade' }).expect(201);
    anaTransferId = first.body.id;
    assert.equal(first.body.status, 'PENDING_PERSON');
    assert.equal(first.body.direction, 'SENT');
    assert.equal(first.body.canCancel, true);
    assert.deepEqual(first.body.toUnit, { id: B.unitA.id, name: B.unitA.name });
    assert.equal(first.body.fromOrganization.id, A.organizationId);
    const again = await http().post('/api/transfers').set(auth(B.mestre.token)).send({ document: anaCpf }).expect(200);
    assert.equal(again.body.id, anaTransferId);
    assert.equal(await prisma.transferRequest.count({ where: { personId: ana.personId, toOrganizationId: B.organizationId } }), 1);
    assert.equal(await prisma.notification.count({ where: { userId: ana.userId, type: 'TRANSFER_REQUEST' } }), 1);
    assert.equal(await prisma.notification.count({ where: { userId: A.mestre.userId, type: 'TRANSFER_REQUEST' } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { action: 'TRANSFER_REQUEST', resourceId: String(anaTransferId) } }), 1);
    // Pessoa ja no grupo => 409; sem matricula em outro grupo => 409.
    const inB = (await http().post('/api/students').set(auth(B.mestre.token)).send({ name: `${PREFIX} So do B` }).expect(201)).body;
    const self = await http().post('/api/transfers').set(auth(B.mestre.token)).send({ personId: inB.personId }).expect(409);
    assert.equal(self.body.code, 'PERSON_ALREADY_IN_GROUP');
    const none = await http().post('/api/transfers').set(auth(C.mestre.token)).send({ personId: inB.personId, fromOrganizationId: A.organizationId }).expect(400);
    assert.equal(none.body.code, 'FROM_ORGANIZATION_REQUIRED');
    await http().post('/api/transfers').set(auth(B.mestre.token)).send({}).expect(400);
  });

  it('privacidade ANTES da aprovacao: o grupo novo nao ve a matricula/historico do grupo antigo; grupo estranho 404', async () => {
    await http().get(`/api/students/${ana.id}/ficha`).set(auth(B.mestre.token)).expect(404);
    await http().get(`/api/students/${ana.id}`).set(auth(B.mestre.token)).expect(404);
    const view = await http().get(`/api/transfers/${anaTransferId}`).set(auth(B.mestre.token)).expect(200);
    const text = JSON.stringify(view.body);
    for (const leak of [FINANCE_MARK, '98765', anaCpf, 'Certificado Verde', 'Turma A']) assert.ok(!text.includes(leak), `vazou: ${leak}`);
    await http().get(`/api/transfers/${anaTransferId}`).set(auth(C.mestre.token)).expect(404);
    await http().post(`/api/transfers/${anaTransferId}/cancel`).set(auth(C.mestre.token)).expect(404);
  });

  it('contestacao: so o MESTRE do grupo antigo, motivo estruturado; nao bloqueia e aparece para a pessoa e o grupo novo', async () => {
    const received = await http().get('/api/transfers?direction=received').set(auth(A.mestre.token)).expect(200);
    const item = received.body.find((t: { id: number }) => t.id === anaTransferId);
    assert.equal(item.direction, 'RECEIVED');
    assert.equal(item.canContest, true);
    assert.equal(item.canCancel, false);
    await http().post(`/api/transfers/${anaTransferId}/contest`).set(auth(B.mestre.token)).send({ reason: 'OTHER' }).expect(403);
    await http().post(`/api/transfers/${anaTransferId}/contest`).set(auth(A.mestre.token)).send({ reason: 'INVALIDO' }).expect(400);
    const c = await http().post(`/api/transfers/${anaTransferId}/contest`).set(auth(A.mestre.token)).send({ reason: 'PENDING_PAYMENT', note: '2 meses em aberto' }).expect(201);
    assert.equal(c.body.reason, 'PENDING_PAYMENT');
    const sent = await http().get(`/api/transfers/${anaTransferId}`).set(auth(B.mestre.token)).expect(200);
    assert.equal(sent.body.contests.length, 1);
    assert.equal(sent.body.status, 'PENDING_PERSON', 'contestacao nao muda o pedido');
    const mine = await http().get('/api/people/me/transfers').set(auth(ana.token)).expect(200);
    const forAna = mine.body.find((t: { id: number }) => t.id === anaTransferId);
    assert.equal(forAna.canDecide, true);
    assert.equal(forAna.decidingAs, 'SELF');
    assert.equal(forAna.contests[0].note, '2 meses em aberto');
    assert.deepEqual(forAna.sharedOnApproval, ['ATTENDANCE', 'GRADUATIONS', 'CERTIFICATES']);
  });

  it('isolamento da decisao: outra pessoa (aluno de outro grupo) nao aprova (404); o mestre tambem nao', async () => {
    const other = await adultInA('Outro', true);
    await http().post(`/api/people/me/transfers/${anaTransferId}/approve`).set(auth(other.token)).expect(404);
    await http().post(`/api/people/me/transfers/${anaTransferId}/approve`).set(auth(B.mestre.token)).expect(404);
    assert.equal((await prisma.transferRequest.findUniqueOrThrow({ where: { id: anaTransferId } })).status, 'PENDING_PERSON');
  });

  it('aprovacao: matricula nova no grupo novo (mesma ficha, login ganha o grupo), antiga encerrada, historico compartilhado sem financeiro', async () => {
    const res = await http().post(`/api/people/me/transfers/${anaTransferId}/approve`).set(auth(ana.token)).expect(200);
    assert.equal(res.body.status, 'APPROVED');
    assert.equal(res.body.canDecide, false);
    const req = await prisma.transferRequest.findUniqueOrThrow({ where: { id: anaTransferId } });
    const fresh = await prisma.student.findUniqueOrThrow({ where: { id: req.toStudentId! } });
    assert.equal(fresh.organizationId, B.organizationId);
    assert.equal(fresh.personId, ana.personId);
    assert.equal(fresh.userId, ana.userId);
    assert.equal(fresh.status, 'ACTIVE');
    assert.equal(fresh.unitId, B.unitA.id);
    const old = await prisma.student.findUniqueOrThrow({ where: { id: ana.id } });
    assert.equal(old.status, 'FORMER');
    assert.equal(old.leftReason, 'TRANSFER');
    assert.ok(old.leftAt);
    assert.equal(await prisma.enrollmentShare.count({ where: { fromStudentId: ana.id, toOrganizationId: B.organizationId, revokedAt: null } }), 1);
    assert.equal(await prisma.student.count({ where: { personId: ana.personId } }), 2, 'ninguem duplicado: 2 matriculas, 1 ficha');
    // O login entra no grupo novo.
    const tokenB = await login(`ana-${stamp}${DOMAIN}`, slugB);
    const meB = await http().get('/api/students/me').set(auth(tokenB)).expect(200);
    assert.deepEqual(meB.body.map((s: { id: number }) => s.id), [fresh.id]);
    // Ficha do grupo novo: so a matricula do B + historico compartilhado (frequencia por turma, graduacao, certificado).
    const ficha = await http().get(`/api/students/${fresh.id}/ficha`).set(auth(B.mestre.token)).expect(200);
    assert.deepEqual(ficha.body.enrollments.map((e: { studentId: number }) => e.studentId), [fresh.id]);
    assert.equal(ficha.body.sharedFromOtherGroups.length, 1);
    const shared = ficha.body.sharedFromOtherGroups[0];
    assert.equal(shared.organization.id, A.organizationId);
    assert.equal(shared.leftReason, 'TRANSFER');
    assert.ok(shared.until);
    assert.deepEqual(shared.attendanceByClass.map((c: { present: number; total: number }) => [c.present, c.total]), [[1, 1]]);
    assert.equal(shared.graduations[0].level.name, 'Verde');
    assert.equal(shared.certificates[0].title, `${PREFIX} Certificado Verde`);
    const text = JSON.stringify(ficha.body);
    for (const leak of [FINANCE_MARK, '98765', anaCpf]) assert.ok(!text.includes(leak), `vazou: ${leak}`);
    // O grupo antigo NAO ganha acesso ao grupo novo.
    const fichaA = await http().get(`/api/students/${ana.id}/ficha`).set(auth(A.mestre.token)).expect(200);
    assert.deepEqual(fichaA.body.sharedFromOtherGroups, []);
    assert.equal(fichaA.body.enrollments[0].until !== null, true);
    // O vinculo ALUNO do grupo antigo cai (matricula FORMER): o token antigo deixa de valer; o do grupo novo decide.
    await http().get('/api/students/me').set(auth(ana.token)).expect(401);
    ana.token = tokenB;
    await http().post(`/api/people/me/transfers/${anaTransferId}/approve`).set(auth(ana.token)).expect(409);
    assert.equal(await prisma.notification.count({ where: { userId: B.mestre.userId, type: 'TRANSFER_APPROVED' } }), 1);
    assert.equal(await prisma.notification.count({ where: { userId: A.mestre.userId, type: 'TRANSFER_APPROVED' } }), 1);
  });

  it('recusa: nada muda no grupo novo; cancelamento so do grupo que pediu e so pendente', async () => {
    const caio = await adultInA('Caio', true);
    const t1 = (await requestTransfer(caio.personId).expect(201)).body;
    const declined = await http().post(`/api/people/me/transfers/${t1.id}/decline`).set(auth(caio.token)).expect(200);
    assert.equal(declined.body.status, 'DECLINED');
    assert.equal(await prisma.student.count({ where: { personId: caio.personId, organizationId: B.organizationId } }), 0);
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: caio.id } })).status, 'ACTIVE');

    const t2 = (await requestTransfer(caio.personId).expect(201)).body;
    assert.notEqual(t2.id, t1.id, 'depois de recusado, um novo pedido e permitido');
    await http().post(`/api/transfers/${t2.id}/cancel`).set(auth(A.mestre.token)).expect(403);
    const cancelled = await http().post(`/api/transfers/${t2.id}/cancel`).set(auth(B.mestre.token)).expect(200);
    assert.equal(cancelled.body.status, 'CANCELLED');
    const again = await http().post(`/api/transfers/${t2.id}/cancel`).set(auth(B.mestre.token)).expect(409);
    assert.equal(again.body.code, 'TRANSFER_NOT_PENDING');
    await http().post(`/api/people/me/transfers/${t2.id}/approve`).set(auth(caio.token)).expect(409);
  });

  it('expiracao: o job expira pedidos vencidos (audita/avisa) e conclui aprovacoes com a contestacao encerrada', async () => {
    const eva = await adultInA('Eva', true);
    const t = (await requestTransfer(eva.personId).expect(201)).body;
    await prisma.transferRequest.update({ where: { id: t.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    // Decidir um pedido vencido ainda nao processado pelo job: 409 TRANSFER_EXPIRED e o pedido vira EXPIRED.
    const late = await http().post(`/api/people/me/transfers/${t.id}/approve`).set(auth(eva.token)).expect(409);
    assert.equal(late.body.code, 'TRANSFER_EXPIRED');
    assert.equal((await prisma.transferRequest.findUniqueOrThrow({ where: { id: t.id } })).status, 'EXPIRED');

    const t2 = (await requestTransfer(eva.personId).expect(201)).body;
    await prisma.transferRequest.update({ where: { id: t2.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await prisma.transferRequest.update({ where: { id: anaTransferId }, data: { contestUntil: new Date(Date.now() - 60_000) } });
    const result = await svc().runMaintenance();
    assert.ok(result.expired >= 1 && result.completed >= 1);
    assert.equal((await prisma.transferRequest.findUniqueOrThrow({ where: { id: t2.id } })).status, 'EXPIRED');
    assert.equal((await prisma.transferRequest.findUniqueOrThrow({ where: { id: anaTransferId } })).status, 'COMPLETED');
    assert.ok((await prisma.auditLog.count({ where: { action: 'TRANSFER_EXPIRE', resourceId: String(t2.id) } })) === 1);
    const closed = await http().post(`/api/transfers/${anaTransferId}/contest`).set(auth(A.mestre.token)).send({ reason: 'EQUIPMENT' }).expect(409);
    assert.equal(closed.body.code, 'TRANSFER_CONTEST_CLOSED');
    const again = await svc().runMaintenance();
    assert.equal(again.expired, 0, 'idempotente');
  });

  it('menor: so o responsavel decide (o proprio menor nao); aprovado, o responsavel acompanha no grupo novo', async () => {
    const kid = (await http().post('/api/students').set(auth(A.mestre.token)).send({ name: `${PREFIX} Bia`, birthDate: '2016-03-03' }).expect(201)).body;
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const guardianUser = await prisma.user.create({ data: { email: `resp-${stamp}${DOMAIN}`, passwordHash, name: `${PREFIX} Resp`, userType: 'MEMBER', status: 'ACTIVE' } });
    await prisma.organizationUser.create({ data: { organizationId: A.organizationId, userId: guardianUser.id, role: OrgRole.RESPONSAVEL, status: 'ACTIVE' } });
    await prisma.studentGuardian.create({ data: { organizationId: A.organizationId, studentId: kid.id, userId: guardianUser.id, name: `${PREFIX} Resp`, relationship: 'Mae' } });
    const kidUser = await prisma.user.create({ data: { email: `bia-${stamp}${DOMAIN}`, passwordHash, name: `${PREFIX} Bia`, userType: 'MEMBER', status: 'ACTIVE' } });
    await prisma.organizationUser.create({ data: { organizationId: A.organizationId, userId: kidUser.id, role: OrgRole.ALUNO, status: 'ACTIVE' } });
    await prisma.student.update({ where: { id: kid.id }, data: { userId: kidUser.id } });
    await prisma.person.update({ where: { id: kid.personId }, data: { userId: kidUser.id } });

    const t = (await requestTransfer(kid.personId).expect(201)).body;
    assert.equal(await prisma.notification.count({ where: { userId: guardianUser.id, type: 'TRANSFER_REQUEST' } }), 1);
    const kidToken = await login(`bia-${stamp}${DOMAIN}`, slugA);
    await http().post(`/api/people/me/transfers/${t.id}/approve`).set(auth(kidToken)).expect(404);
    const guardianToken = await login(`resp-${stamp}${DOMAIN}`, slugA);
    const list = await http().get('/api/people/me/transfers').set(auth(guardianToken)).expect(200);
    const item = list.body.find((x: { id: number }) => x.id === t.id);
    assert.equal(item.decidingAs, 'GUARDIAN');
    assert.equal(item.canDecide, true);
    await http().post(`/api/people/me/transfers/${t.id}/approve`).set(auth(guardianToken)).expect(200);
    const fresh = await prisma.student.findFirstOrThrow({ where: { personId: kid.personId, organizationId: B.organizationId } });
    const guardians = await prisma.studentGuardian.findMany({ where: { studentId: fresh.id } });
    assert.deepEqual(guardians.map((g) => g.userId), [guardianUser.id]);
    const membership = await prisma.organizationUser.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: B.organizationId, userId: guardianUser.id } },
    });
    assert.equal(membership.role, 'RESPONSAVEL');
  });

  it('higiene: PATCH /people/me propaga as matriculas; CPF legado sai mascarado; exportacao LGPD traz a ficha sem o CPF', async () => {
    const res = await http().patch('/api/people/me').set(auth(ana.token)).send({ nickname: 'Aninha', phone: '(61) 97777-1111' }).expect(200);
    assert.equal(res.body.person.nickname, 'Aninha');
    assert.equal(res.body.person.documentMasked, `***.***.***-${anaCpf.slice(-2)}`);
    const phones = await prisma.student.findMany({ where: { personId: ana.personId }, select: { phone: true } });
    assert.deepEqual(phones.map((p) => p.phone), ['(61) 97777-1111', '(61) 97777-1111']);

    const student = await http().get(`/api/students/${ana.id}`).set(auth(A.mestre.token)).expect(200);
    assert.equal(student.body.document, `***.***.***-${anaCpf.slice(-2)}`);
    const list = await http().get('/api/students').set(auth(A.mestre.token)).expect(200);
    assert.ok(!JSON.stringify(list.body).includes(anaCpf.slice(0, 9)), 'lista nao traz o CPF inteiro');
    // O formulario que reenvia a mascara nao muda nada.
    await http().patch(`/api/students/${ana.id}`).set(auth(A.mestre.token)).send({ document: `***.***.***-${anaCpf.slice(-2)}` }).expect(200);
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: ana.id } })).document?.replace(/\D/g, ''), anaCpf);

    const exp = await http().get('/api/auth/me/export').set(auth(ana.token)).expect(200);
    const person = exp.body.people.find((p: { id: number }) => p.id === ana.personId);
    assert.ok(person);
    assert.equal(person.documentMasked, `***.***.***-${anaCpf.slice(-2)}`);
    assert.ok(person.transfers.some((t: { id: number }) => t.id === anaTransferId));
    assert.ok(!JSON.stringify(exp.body.people).includes(anaCpf));
  });
});
