import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { hashPasswordToken } from '../src/shared/security/password-reset-token';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { MemoryMailTransport, createTestApp } from './utils/test-app';

/**
 * FICHA UNICA - convite guiado: link de aprovacao de uso unico para ADULTO SEM LOGIN (docs/FICHA_UNICA.md secao 12.A).
 * Dois grupos PROPRIOS (A = origem, B = destino); nunca o seed nem o demo. Fixtures "[e2e-tlink]" / "@e2e-tlink.local".
 */
const PREFIX = '[e2e-tlink]';
const DOMAIN = '@e2e-tlink.local';
const STRONG = 'Senha#Forte2026xy';

describe('transferencia - link de aprovacao para adulto sem login (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const mail = new MemoryMailTransport();
  let A: ReportOrg;
  let B: ReportOrg;
  const stamp = Date.now();

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const tokenOfUrl = (url: string) => decodeURIComponent(/token=([^&]+)/.exec(url)![1]);

  async function personInA(name: string, extra: Record<string, unknown> = {}) {
    const s = (await http().post('/api/students').set(auth(A.mestre.token)).send({ name: `${PREFIX} ${name}`, birthDate: '1990-01-01', ...extra }).expect(201)).body;
    return { studentId: s.id as number, personId: s.personId as number };
  }
  const requestTransfer = (personId: number) => http().post('/api/transfers').set(auth(B.mestre.token)).send({ personId });

  before(async () => {
    app = await createTestApp({ disableThrottle: true, mailTransport: mail });
    A = await createReportOrg(app, prisma, 'tlink-a');
    B = await createReportOrg(app, prisma, 'tlink-b');
  });

  after(async () => {
    const orgIds = [A.organizationId, B.organizationId];
    await prisma.transferRequest.deleteMany({ where: { OR: [{ toOrganizationId: { in: orgIds } }, { fromOrganizationId: { in: orgIds } }] } });
    const userIds = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
    await prisma.notification.deleteMany({ where: { userId: { in: [...userIds, A.mestre.userId, B.mestre.userId] } } });
    await A.cleanup();
    await B.cleanup();
    await prisma.person.deleteMany({ where: { name: { startsWith: PREFIX }, students: { none: {} } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('feliz: pedido devolve o link; o token fica so como hash; resumo publico minimo; aprova criando o login', async () => {
    const ana = await personInA('Ana', { email: `ana-${stamp}${DOMAIN}` });
    const created = await requestTransfer(ana.personId).expect(201);
    assert.equal(created.body.needsApprovalLink, true);
    const link = created.body.approvalLink;
    assert.match(link.url, /^https:\/\/app\.e2e\.test\/aprovar-transferencia\?token=/);
    assert.equal(link.emailed, true, 'SMTP em memoria ativo e a ficha tem e-mail: envia tambem');
    const sentMail = mail.to(`ana-${stamp}${DOMAIN}`);
    assert.equal(sentMail.length, 1);
    assert.ok(sentMail[0].text.includes(link.url));
    const token = tokenOfUrl(link.url);
    const row = await prisma.transferApprovalToken.findFirstOrThrow({ where: { requestId: created.body.id } });
    assert.equal(row.tokenHash, hashPasswordToken(token));
    assert.notEqual(row.tokenHash, token);
    assert.equal(row.expiresAt.getTime(), new Date(created.body.expiresAt).getTime(), 'expira junto com o pedido');

    const summary = (await http().get(`/api/public/transfer-approval/${token}`).expect(200)).body;
    assert.equal(summary.groupName, (await prisma.organization.findUniqueOrThrow({ where: { id: B.organizationId } })).name);
    assert.equal(summary.isMinor, false);
    assert.equal(summary.canApproveByLink, true);
    assert.deepEqual(summary.sharedOnApproval, ['ATTENDANCE', 'GRADUATIONS', 'CERTIFICATES']);
    for (const leak of ['person', 'name', 'document', 'email', 'phone', 'fromOrganization']) assert.equal(summary[leak], undefined, `vazou ${leak}`);

    // Senha fraca -> 400; sem e-mail e ficha sem e-mail -> ver caso abaixo.
    await http().post(`/api/public/transfer-approval/${token}/approve`).send({ newPassword: 'curta' }).expect(400);
    const done = await http().post(`/api/public/transfer-approval/${token}/approve`).send({ newPassword: STRONG }).expect(200);
    assert.equal(done.body.status, 'APPROVED');

    const person = await prisma.person.findUniqueOrThrow({ where: { id: ana.personId } });
    assert.ok(person.userId, 'login criado e ligado a ficha');
    const enrolled = await prisma.student.findFirst({ where: { personId: ana.personId, organizationId: B.organizationId } });
    assert.equal(enrolled?.status, 'ACTIVE');
    assert.equal((await prisma.transferRequest.findUniqueOrThrow({ where: { id: created.body.id } })).status, 'APPROVED');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'TRANSFER_APPROVE', resourceId: String(created.body.id) } });
    assert.equal((audit?.metadata as { via?: string } | null)?.via, 'approval-link');
    // O login funciona no grupo novo.
    const slugB = (await prisma.organization.findUniqueOrThrow({ where: { id: B.organizationId } })).slug;
    await http().post('/api/auth/login').send({ email: `ana-${stamp}${DOMAIN}`, password: STRONG, organizationSlug: slugB }).expect(200);
    // Uso unico: o mesmo link nao vale de novo.
    const again = await http().get(`/api/public/transfer-approval/${token}`).expect(404);
    assert.equal(again.body.code, 'TRANSFER_APPROVAL_INVALID');
  });

  it('erros: token inventado 404; e-mail obrigatorio 400; e-mail de conta existente 409 e nada e criado', async () => {
    const bad = await http().get('/api/public/transfer-approval/token-inexistente-0123456789abcdef').expect(404);
    assert.equal(bad.body.code, 'TRANSFER_APPROVAL_INVALID');
    await http().post('/api/public/transfer-approval/curto/decline').expect(404);

    const bia = await personInA('Bia');
    const created = await requestTransfer(bia.personId).expect(201);
    assert.equal(created.body.approvalLink.emailed, false, 'sem e-mail na ficha: so o link');
    const token = tokenOfUrl(created.body.approvalLink.url);
    assert.equal((await http().get(`/api/public/transfer-approval/${token}`).expect(200)).body.emailRequired, true);
    const noEmail = await http().post(`/api/public/transfer-approval/${token}/approve`).send({ newPassword: STRONG }).expect(400);
    assert.equal(noEmail.body.code, 'EMAIL_REQUIRED');
    const taken = await http().post(`/api/public/transfer-approval/${token}/approve`).send({ newPassword: STRONG, email: A.mestre.email }).expect(409);
    assert.equal(taken.body.code, 'EMAIL_IN_USE');
    // Falhou: o pedido continua pendente, sem login e o link ainda vale.
    assert.equal((await prisma.person.findUniqueOrThrow({ where: { id: bia.personId } })).userId, null);
    assert.equal((await prisma.transferRequest.findUniqueOrThrow({ where: { id: created.body.id } })).status, 'PENDING_PERSON');
    await http().get(`/api/public/transfer-approval/${token}`).expect(200);
    // Agora aprova com e-mail proprio.
    await http().post(`/api/public/transfer-approval/${token}/approve`).send({ newPassword: STRONG, email: `bia-${stamp}${DOMAIN}` }).expect(200);
    assert.ok((await prisma.person.findUniqueOrThrow({ where: { id: bia.personId } })).userId);
  });

  it('recusar usa o link uma vez; gerar link novo invalida o anterior; so o grupo que pediu gera', async () => {
    const caio = await personInA('Caio');
    const created = await requestTransfer(caio.personId).expect(201);
    const first = tokenOfUrl(created.body.approvalLink.url);
    await http().post(`/api/transfers/${created.body.id}/approval-link`).set(auth(A.mestre.token)).expect(403);
    const regen = await http().post(`/api/transfers/${created.body.id}/approval-link`).set(auth(B.mestre.token)).expect(200);
    const second = tokenOfUrl(regen.body.url);
    assert.notEqual(first, second);
    await http().get(`/api/public/transfer-approval/${first}`).expect(404);
    await http().get(`/api/public/transfer-approval/${second}`).expect(200);

    const declined = await http().post(`/api/public/transfer-approval/${second}/decline`).expect(200);
    assert.equal(declined.body.status, 'DECLINED');
    assert.equal((await prisma.transferRequest.findUniqueOrThrow({ where: { id: created.body.id } })).status, 'DECLINED');
    assert.equal(await prisma.student.count({ where: { personId: caio.personId, organizationId: B.organizationId } }), 0);
    await http().post(`/api/public/transfer-approval/${second}/decline`).expect(404);
    const afterDecline = await http().post(`/api/transfers/${created.body.id}/approval-link`).set(auth(B.mestre.token)).expect(409);
    assert.equal(afterDecline.body.code, 'TRANSFER_NOT_PENDING');
  });

  it('menor nao ganha link e nao aprova por link (mesmo com token forjado no banco); quem tem login nao precisa de link', async () => {
    const kid = await personInA('Duda', { birthDate: '2015-05-05' });
    const created = await requestTransfer(kid.personId).expect(201);
    assert.equal(created.body.approvalLink, null);
    assert.equal(created.body.needsApprovalLink, false);
    const notNeeded = await http().post(`/api/transfers/${created.body.id}/approval-link`).set(auth(B.mestre.token)).expect(409);
    assert.equal(notNeeded.body.code, 'APPROVAL_LINK_NOT_NEEDED');
    // Token forjado direto no banco (como se a data de nascimento tivesse mudado depois).
    const forged = 'forjado-0123456789-abcdefghijklmnop';
    await prisma.transferApprovalToken.create({
      data: { requestId: created.body.id, tokenHash: hashPasswordToken(forged), expiresAt: new Date(created.body.expiresAt) },
    });
    const summary = (await http().get(`/api/public/transfer-approval/${forged}`).expect(200)).body;
    assert.equal(summary.isMinor, true);
    assert.equal(summary.canApproveByLink, false);
    const blocked = await http().post(`/api/public/transfer-approval/${forged}/approve`).send({ newPassword: STRONG, email: `duda-${stamp}${DOMAIN}` }).expect(403);
    assert.equal(blocked.body.code, 'MINOR_REQUIRES_GUARDIAN');
    assert.equal(await prisma.student.count({ where: { personId: kid.personId, organizationId: B.organizationId } }), 0);
  });
});
