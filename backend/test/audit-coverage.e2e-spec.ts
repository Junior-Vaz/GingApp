import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import request from 'supertest';
import { AUDIT_ACTION_CODES } from '../src/shared/audit/audit-actions';
import { DEV_PASSWORD } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Cobertura da auditoria nas escritas de turmas, graduacoes, certificados, comunicados, upload de imagem e conta de
 * aluno ligada a usuario existente. Grupo e usuarios PROPRIOS (nao toca no seed ginga-brasil nem no demo). Limpa tudo.
 */
const DOMAIN = '@e2e-auditcov.local';

describe('Auditoria: cobertura das escritas (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}`;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let orgId: number;
  let token = '';
  let mestreId: number;
  let uploadDir = '';
  const userIds: number[] = [];
  const uploadFiles: string[] = [];

  /** Linhas de auditoria do grupo para a acao (e o id da entidade, se informado). */
  const rows = (action: string, entityId?: string | number) =>
    prisma.auditLog.findMany({
      where: { organizationId: orgId, action, ...(entityId !== undefined ? { resourceId: String(entityId) } : {}) },
    });

  before(async () => {
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-auditcov-'));
    process.env.UPLOADS_DIR = uploadDir;
    app = await createTestApp();
    orgId = (
      await prisma.organization.create({
        data: { name: `E2E auditcov ${stamp}`, slug: `e2e-auditcov-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
      })
    ).id;
    const mestre = await prisma.user.create({
      data: { email: `mestre-${stamp}${DOMAIN}`, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: '[e2e-auditcov]', userType: 'MEMBER' },
    });
    mestreId = mestre.id;
    userIds.push(mestre.id);
    await prisma.organizationUser.create({ data: { organizationId: orgId, userId: mestre.id, role: OrgRole.MESTRE, status: 'ACTIVE' } });
    const login = await http().post('/api/auth/login').send({ email: mestre.email, password: DEV_PASSWORD }).expect(200);
    token = login.body.accessToken;
  });

  after(async () => {
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: orgId }, { userId: { in: ids } }] } });
    await prisma.certificate.deleteMany({ where: { organizationId: orgId } });
    await prisma.studentGraduation.deleteMany({ where: { organizationId: orgId } });
    await prisma.graduationLevel.deleteMany({ where: { organizationId: orgId } });
    await prisma.graduationSystem.deleteMany({ where: { organizationId: orgId } });
    await prisma.notification.deleteMany({ where: { organizationId: orgId } });
    await prisma.announcement.deleteMany({ where: { organizationId: orgId } });
    await prisma.class.deleteMany({ where: { organizationId: orgId } });
    await prisma.upload.deleteMany({ where: { organizationId: orgId } });
    await prisma.student.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await fs.rm(uploadDir, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
    await prisma.$disconnect();
    await app.close();
  });

  it('o catalogo central tem os codigos novos (rotulos do admin/painel dependem deles)', () => {
    for (const code of [
      'CLASS_CREATE', 'CLASS_UPDATE', 'CLASS_INACTIVATE', 'GRADUATION_SYSTEM_CREATE', 'GRADUATION_SYSTEM_UPDATE',
      'GRADUATION_SYSTEM_DELETE', 'GRADUATION_LEVEL_CREATE', 'GRADUATION_LEVEL_UPDATE', 'GRADUATION_LEVEL_DELETE',
      'STUDENT_GRADUATION_CREATE', 'STUDENT_GRADUATION_UPDATE', 'STUDENT_GRADUATION_DELETE', 'CERTIFICATE_ISSUE',
      'CERTIFICATE_DOWNLOAD', 'ANNOUNCEMENT_CREATE', 'ANNOUNCEMENT_UPDATE', 'UPLOAD_CREATE', 'STUDENT_ACCOUNT_LINK',
      'TWO_FACTOR_ENABLE', 'TWO_FACTOR_DISABLE', 'TWO_FACTOR_RECOVERY_USED', 'TWO_FACTOR_FAILURE', 'AUDIT_PURGE',
    ]) {
      assert.ok(AUDIT_ACTION_CODES.includes(code), code);
    }
  });

  it('turma: criar, editar e inativar gravam autor e grupo; pedido invalido (400) nao grava nada', async () => {
    await http().post('/api/classes').set(auth(token)).send({ name: 'x' }).expect(400);
    assert.equal((await rows('CLASS_CREATE')).length, 0);

    const created = await http().post('/api/classes').set(auth(token)).send({ name: 'Turma Auditada' }).expect(201);
    const id = created.body.id;
    await http().patch(`/api/classes/${id}`).set(auth(token)).send({ name: 'Turma Auditada 2' }).expect(200);
    await http().delete(`/api/classes/${id}`).set(auth(token)).expect(200);
    const [create] = await rows('CLASS_CREATE', id);
    assert.equal(create.userId, mestreId);
    assert.equal(create.resource, 'class');
    assert.equal((await rows('CLASS_UPDATE', id)).length, 1);
    assert.equal((await rows('CLASS_INACTIVATE', id)).length, 1);
  });

  it('graduacoes: sistema, nivel e graduacao de aluno (criar/editar/remover) e certificado emitido/baixado', async () => {
    const system = await http().post('/api/graduations/systems').set(auth(token)).send({ name: 'Cordas' }).expect(201);
    await http().patch(`/api/graduations/systems/${system.body.id}`).set(auth(token)).send({ description: 'novo' }).expect(200);
    const level = await http()
      .post(`/api/graduations/systems/${system.body.id}/levels`)
      .set(auth(token))
      .send({ name: 'Crua', order: 1 })
      .expect(201);
    await http().post(`/api/graduations/systems/${system.body.id}/levels`).set(auth(token)).send({ name: 'Crua', order: 1 }).expect(409); // ordem repetida: nao audita
    await http().patch(`/api/graduations/levels/${level.body.id}`).set(auth(token)).send({ name: 'Crua 2' }).expect(200);

    const student = await prisma.student.create({ data: { organizationId: orgId, name: 'Aluno Auditado' } });
    const grad = await http()
      .post(`/api/graduations/students/${student.id}`)
      .set(auth(token))
      .send({ graduationLevelId: level.body.id, graduatedAt: '2026-10-01' })
      .expect(201);
    await http().patch(`/api/graduations/students/${student.id}/${grad.body.id}`).set(auth(token)).send({ notes: 'ok' }).expect(200);

    const cert = await http()
      .post('/api/certificates')
      .set(auth(token))
      .send({ studentId: student.id, title: 'Certificado de Cordao', studentGraduationId: grad.body.id })
      .expect(201);
    await http().get(`/api/certificates/${cert.body.id}/pdf`).set(auth(token)).buffer(true).expect(200);
    await http().get('/api/certificates/999999999/pdf').set(auth(token)).expect(404); // nao audita o que nao existe

    await http().delete(`/api/certificates/${cert.body.id}`).set(auth(token)).expect(200);
    await http().delete(`/api/graduations/students/${student.id}/${grad.body.id}`).set(auth(token)).expect(200);
    await http().delete(`/api/graduations/levels/${level.body.id}`).set(auth(token)).expect(200);
    await http().delete(`/api/graduations/systems/${system.body.id}`).set(auth(token)).expect(200);

    assert.equal((await rows('GRADUATION_SYSTEM_CREATE', system.body.id)).length, 1);
    assert.equal((await rows('GRADUATION_SYSTEM_UPDATE', system.body.id)).length, 1);
    assert.equal((await rows('GRADUATION_SYSTEM_DELETE', system.body.id)).length, 1);
    assert.equal((await rows('GRADUATION_LEVEL_CREATE')).length, 1, 'o 409 de ordem repetida nao gerou registro');
    assert.equal((await rows('GRADUATION_LEVEL_UPDATE', level.body.id)).length, 1);
    assert.equal((await rows('GRADUATION_LEVEL_DELETE', level.body.id)).length, 1);
    assert.equal((await rows('STUDENT_GRADUATION_CREATE', grad.body.id)).length, 1);
    assert.equal((await rows('STUDENT_GRADUATION_UPDATE', grad.body.id)).length, 1);
    assert.equal((await rows('STUDENT_GRADUATION_DELETE', grad.body.id)).length, 1);
    assert.equal((await rows('CERTIFICATE_ISSUE', cert.body.id)).length, 1);
    assert.equal((await rows('CERTIFICATE_DOWNLOAD', cert.body.id)).length, 1);
  });

  it('comunicado (criar/editar) e envio de imagem; o upload audita o nome do arquivo, nunca o conteudo', async () => {
    const created = await http().post('/api/announcements').set(auth(token)).send({ title: 'Aviso auditado', body: 'Corpo do aviso' }).expect(201);
    await http().patch(`/api/announcements/${created.body.id}`).set(auth(token)).send({ title: 'Aviso auditado 2' }).expect(200);
    await http().post('/api/announcements').set(auth(token)).send({ title: 'a' }).expect(400);
    assert.equal((await rows('ANNOUNCEMENT_CREATE', created.body.id)).length, 1);
    assert.equal((await rows('ANNOUNCEMENT_UPDATE', created.body.id)).length, 1);

    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fa0' } }).png().toBuffer();
    const up = await http().post('/api/uploads').set(auth(token)).attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(201);
    uploadFiles.push(up.body.filename);
    const [row] = await rows('UPLOAD_CREATE', up.body.filename);
    assert.equal(row.userId, mestreId);
    assert.equal(row.resource, 'upload');
    await http().post('/api/uploads').set(auth(token)).attach('file', Buffer.from('nao e imagem'), { filename: 'a.png', contentType: 'image/png' }).expect(415);
    assert.equal((await rows('UPLOAD_CREATE')).length, 1, 'envio recusado nao audita');
  });

  it('conta de aluno ligada a um usuario JA existente grava STUDENT_ACCOUNT_LINK (usuario novo continua STUDENT_ACCOUNT_CREATE)', async () => {
    const existing = await prisma.user.create({
      data: { email: `existente-${stamp}${DOMAIN}`, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: '[e2e-auditcov] existente', userType: 'MEMBER' },
    });
    userIds.push(existing.id);
    const linked = await prisma.student.create({ data: { organizationId: orgId, name: 'Aluno Ligado', email: existing.email } });
    const fresh = await prisma.student.create({ data: { organizationId: orgId, name: 'Aluno Novo', email: `novo-${stamp}${DOMAIN}` } });

    await http().post(`/api/students/${linked.id}/account`).set(auth(token)).send({}).expect(201);
    await http().post(`/api/students/${fresh.id}/account`).set(auth(token)).send({ password: 'Senha-Provisoria-2026!x' }).expect(201);
    assert.equal((await rows('STUDENT_ACCOUNT_LINK', linked.id)).length, 1);
    assert.equal((await rows('STUDENT_ACCOUNT_CREATE', linked.id)).length, 0);
    assert.equal((await rows('STUDENT_ACCOUNT_CREATE', fresh.id)).length, 1);
    // o usuario criado agora tambem precisa ser limpo
    const created = await prisma.user.findUnique({ where: { email: `novo-${stamp}${DOMAIN}` } });
    if (created) userIds.push(created.id);
  });
});
