import { INestApplication } from '@nestjs/common';
import { FinancialStatus, OrganizationType, OrgRole, PrismaClient, RecordStatus, StudentStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * Dashboard administrativo (dashboard.service.ts, projeto.txt §30). Para os números serem
 * determinísticos (não afetados por dados que outras suítes ou sessões manuais já colocaram
 * na organização do seed de dev), esta suíte cria uma ORGANIZAÇÃO ISOLADA PRÓPRIA — mesmo
 * padrão de multi-tenant-isolation.e2e-spec.ts — e popula exatamente os dados conferidos.
 */
const DEV_PASSWORD = 'Dev@12345';
const MESTRE_EMAIL = 'mestre-dashboard@e2e-dashboard-test.local';

describe('Dashboard (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let orgId: number;
  let mestreUserId: number;
  let mestreToken: string;

  const studentIds: number[] = [];
  let classId: number;
  const financeIds: number[] = [];
  let eventId: number;

  before(async () => {
    app = await createTestApp();

    const org = await prisma.organization.create({
      data: {
        name: 'E2E Dashboard Org',
        slug: `e2e-dashboard-org-${Date.now()}`,
        type: OrganizationType.GROUP,
        status: RecordStatus.ACTIVE,
      },
    });
    orgId = org.id;

    const passwordHash = await bcrypt.hash(DEV_PASSWORD, 4); // custo baixo só para acelerar o teste
    const mestreUser = await prisma.user.create({
      data: {
        email: MESTRE_EMAIL,
        passwordHash,
        name: 'Mestre E2E Dashboard',
        userType: 'MEMBER',
        status: 'ACTIVE',
      },
    });
    mestreUserId = mestreUser.id;

    await prisma.organizationUser.create({
      data: { organizationId: orgId, userId: mestreUserId, role: OrgRole.MESTRE, status: 'ACTIVE' },
    });

    // 2 Student: 1 ACTIVE, 1 INACTIVE.
    const activeStudent = await prisma.student.create({
      data: { organizationId: orgId, name: 'Aluno Ativo E2E', status: StudentStatus.ACTIVE },
    });
    const inactiveStudent = await prisma.student.create({
      data: { organizationId: orgId, name: 'Aluno Inativo E2E', status: StudentStatus.INACTIVE },
    });
    studentIds.push(activeStudent.id, inactiveStudent.id);

    // 1 Class ACTIVE.
    const turma = await prisma.class.create({
      data: { organizationId: orgId, name: 'Turma E2E Dashboard', status: RecordStatus.ACTIVE },
    });
    classId = turma.id;

    // 1 FinancialRecord PENDING com dueDate no futuro (conta como "pendente", não "atrasado").
    const pendingFuture = await prisma.financialRecord.create({
      data: {
        organizationId: orgId,
        description: 'Pendente futuro E2E',
        amountCents: 10000,
        status: FinancialStatus.PENDING,
        dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      },
    });
    // 1 FinancialRecord PENDING com dueDate no passado (conta como "atrasado" — ver comentário
    // no dashboard.service.ts: PENDING + dueDate < now soma em overdueCount).
    const pendingPastDue = await prisma.financialRecord.create({
      data: {
        organizationId: orgId,
        description: 'Pendente vencido E2E',
        amountCents: 20000,
        status: FinancialStatus.PENDING,
        dueDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    });
    financeIds.push(pendingFuture.id, pendingPastDue.id);

    // 1 Event com date no futuro.
    const event = await prisma.event.create({
      data: {
        organizationId: orgId,
        title: 'Evento E2E Dashboard',
        date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      },
    });
    eventId = event.id;

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: MESTRE_EMAIL, password: DEV_PASSWORD })
      .expect(200);
    mestreToken = login.body.accessToken;
  });

  after(async () => {
    // Limpa TODA a organização isolada criada por esta suíte — nunca mexe nos dados do seed.
    await prisma.event.deleteMany({ where: { organizationId: orgId } });
    await prisma.financialRecord.deleteMany({ where: { organizationId: orgId } });
    await prisma.class.deleteMany({ where: { organizationId: orgId } });
    await prisma.student.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.delete({ where: { id: mestreUserId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('GET /dashboard retorna os números exatos da organização isolada criada por este teste', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    assert.equal(res.body.students.active, 1);
    assert.equal(res.body.students.inactive, 1);
    assert.equal(res.body.classes.active, 1);
    assert.equal(res.body.finance.pendingCount, 1);
    assert.equal(res.body.finance.overdueCount, 1);

    const upcomingIds = res.body.upcomingEvents.map((e: { id: number }) => e.id);
    assert.ok(upcomingIds.includes(eventId), 'o evento futuro criado neste teste deveria aparecer em upcomingEvents');
  });
});
