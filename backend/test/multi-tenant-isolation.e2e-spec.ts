import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus, StudentStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * O teste de segurança mais importante do projeto (PLANO_PROJETO.md §8 / projeto.txt §95):
 *
 *   "Um usuário de uma organização nunca deve conseguir acessar dados privados de outra
 *    organização."
 *
 * Cria uma SEGUNDA organização isolada (própria desta suíte, apagada no final) e confirma
 * que o MESTRE da organização A (seed de dev) não enxerga nada da organização B, e
 * vice-versa — tanto em listagem (GET /students) quanto em acesso direto por id
 * (GET /students/:id) e em mutação (PATCH/DELETE /students/:id).
 */
const DEV_PASSWORD = 'Dev@12345';
const ORG_A_MESTRE_EMAIL = 'mestre@gingabrasil.com.br'; // seed de dev — organização "Grupo Ginga Brasil"
const ORG_B_MESTRE_EMAIL = 'mestre-b@e2e-isolation-test.local';

describe('Isolamento multi-tenant (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let orgAToken: string;
  let orgBToken: string;
  let orgAStudentId: number;
  let orgBStudentId: number;
  let orgBId: number;
  let orgBUserId: number;
  let orgAAlunoToken: string;
  let orgAAnnouncementId: number;
  let orgBAnnouncementId: number;
  const ANN_TAG = `iso-ann-${Date.now()}`;

  before(async () => {
    app = await createTestApp();

    // --- Organização B, isolada, criada só para este teste ---
    const orgB = await prisma.organization.create({
      data: {
        name: 'E2E Isolation Org B',
        slug: `e2e-isolation-org-b-${Date.now()}`,
        type: OrganizationType.GROUP,
        status: RecordStatus.ACTIVE,
      },
    });
    orgBId = orgB.id;

    const passwordHash = await bcrypt.hash(DEV_PASSWORD, 4); // custo baixo só para acelerar o teste
    const userB = await prisma.user.create({
      data: {
        email: ORG_B_MESTRE_EMAIL,
        passwordHash,
        name: 'Mestre E2E Org B',
        userType: 'MEMBER',
        status: 'ACTIVE',
      },
    });
    orgBUserId = userB.id;

    await prisma.organizationUser.create({
      data: { organizationId: orgB.id, userId: userB.id, role: OrgRole.MESTRE, status: 'ACTIVE' },
    });

    const studentB = await prisma.student.create({
      data: { organizationId: orgB.id, name: 'Aluno Secreto da Org B', status: StudentStatus.ACTIVE },
    });
    orgBStudentId = studentB.id;

    // --- Login nas duas organizações (via API real, não direto no banco) ---
    const loginA = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ORG_A_MESTRE_EMAIL, password: DEV_PASSWORD })
      .expect(200);
    orgAToken = loginA.body.accessToken;

    const loginB = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ORG_B_MESTRE_EMAIL, password: DEV_PASSWORD })
      .expect(200);
    orgBToken = loginB.body.accessToken;

    // Um aluno qualquer já existente na organização A (seed de dev) para o teste simétrico.
    const anyOrgAStudent = await prisma.student.findFirstOrThrow({
      where: { organizationId: loginA.body.user.organizationId },
    });
    orgAStudentId = anyOrgAStudent.id;

    // Comunicados (um por organização) + um ALUNO da organização A (papel sem permissão de escrita).
    orgAAnnouncementId = (
      await prisma.announcement.create({
        data: { organizationId: loginA.body.user.organizationId, createdByUserId: loginA.body.user.id, title: `${ANN_TAG} A`, body: 'segredo da org A' },
      })
    ).id;
    orgBAnnouncementId = (
      await prisma.announcement.create({
        data: { organizationId: orgB.id, createdByUserId: userB.id, title: `${ANN_TAG} B`, body: 'segredo da org B' },
      })
    ).id;
    const loginAluno = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'aluno@gingabrasil.com.br', password: DEV_PASSWORD })
      .expect(200);
    orgAAlunoToken = loginAluno.body.accessToken;
  });

  after(async () => {
    // Limpa só o que esta suíte criou — nunca mexe nos dados do seed de dev (organização A).
    await prisma.announcement.deleteMany({ where: { title: { startsWith: ANN_TAG } } });
    await prisma.student.deleteMany({ where: { organizationId: orgBId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: orgBId } });
    await prisma.organization.delete({ where: { id: orgBId } });
    await prisma.user.delete({ where: { id: orgBUserId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('GET /students da organização A nunca inclui o aluno da organização B', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/students')
      .set('Authorization', `Bearer ${orgAToken}`)
      .expect(200);

    const ids = res.body.map((s: { id: number }) => s.id);
    assert.ok(!ids.includes(orgBStudentId));
  });

  it('GET /students da organização B nunca inclui o aluno da organização A', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/students')
      .set('Authorization', `Bearer ${orgBToken}`)
      .expect(200);

    const ids = res.body.map((s: { id: number }) => s.id);
    assert.ok(!ids.includes(orgAStudentId));
  });

  it('organização A não consegue LER o aluno da organização B por id direto (404, não 200 nem 403)', async () => {
    await request(app.getHttpServer())
      .get(`/api/students/${orgBStudentId}`)
      .set('Authorization', `Bearer ${orgAToken}`)
      .expect(404);
  });

  it('organização B não consegue LER o aluno da organização A por id direto', async () => {
    await request(app.getHttpServer())
      .get(`/api/students/${orgAStudentId}`)
      .set('Authorization', `Bearer ${orgBToken}`)
      .expect(404);
  });

  it('organização A não consegue EDITAR o aluno da organização B', async () => {
    await request(app.getHttpServer())
      .patch(`/api/students/${orgBStudentId}`)
      .set('Authorization', `Bearer ${orgAToken}`)
      .send({ name: 'Nome Adulterado Pela Org A' })
      .expect(404);

    const stillIntact = await prisma.student.findUniqueOrThrow({ where: { id: orgBStudentId } });
    assert.equal(stillIntact.name, 'Aluno Secreto da Org B');
  });

  it('organização A não consegue APAGAR (inativar) o aluno da organização B', async () => {
    await request(app.getHttpServer())
      .delete(`/api/students/${orgBStudentId}`)
      .set('Authorization', `Bearer ${orgAToken}`)
      .expect(404);

    const stillActive = await prisma.student.findUniqueOrThrow({ where: { id: orgBStudentId } });
    assert.equal(stillActive.status, 'ACTIVE');
  });

  it('comunicados: a lista de cada organização (MESTRE e ALUNO) nunca inclui a da outra, e o X-Total-Count não conta a outra', async () => {
    const ask = (token: string) =>
      request(app.getHttpServer()).get(`/api/announcements?q=${ANN_TAG}&limit=200`).set('Authorization', `Bearer ${token}`).expect(200);

    const mestreA = await ask(orgAToken);
    assert.deepEqual(mestreA.body.map((a: { id: number }) => a.id), [orgAAnnouncementId]);
    assert.equal(mestreA.headers['x-total-count'], '1');
    assert.ok(!mestreA.text.includes('segredo da org B'));

    const alunoA = await ask(orgAAlunoToken);
    assert.deepEqual(alunoA.body.map((a: { id: number }) => a.id), [orgAAnnouncementId]);
    assert.equal(alunoA.headers['x-total-count'], '1');
    assert.ok(!alunoA.text.includes('segredo da org B'));

    const mestreB = await ask(orgBToken);
    assert.deepEqual(mestreB.body.map((a: { id: number }) => a.id), [orgBAnnouncementId]);
    assert.equal(mestreB.headers['x-total-count'], '1');
    assert.ok(!mestreB.text.includes('segredo da org A'));
  });

  it('comunicados: ler por id de outra organização dá o MESMO 404 de um id inexistente (MESTRE e ALUNO); o da própria organização abre', async () => {
    const get = (id: number | string, token: string) =>
      request(app.getHttpServer()).get(`/api/announcements/${id}`).set('Authorization', `Bearer ${token}`);
    const ghost = await get(2147483000, orgAToken).expect(404);
    for (const token of [orgAToken, orgAAlunoToken]) {
      const foreign = await get(orgBAnnouncementId, token).expect(404);
      assert.deepEqual(foreign.body, ghost.body);
      await get(orgAAnnouncementId, token).expect(200);
    }
    const reverse = await get(orgAAnnouncementId, orgBToken).expect(404);
    assert.deepEqual(reverse.body, ghost.body);
  });

  it('comunicados: organização A não consegue EDITAR nem APAGAR (inativar) o comunicado da organização B', async () => {
    await request(app.getHttpServer())
      .patch(`/api/announcements/${orgBAnnouncementId}`)
      .set('Authorization', `Bearer ${orgAToken}`)
      .send({ title: 'Adulterado pela Org A' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/announcements/${orgBAnnouncementId}`)
      .set('Authorization', `Bearer ${orgAToken}`)
      .expect(404);
    const intact = await prisma.announcement.findUniqueOrThrow({ where: { id: orgBAnnouncementId } });
    assert.equal(intact.title, `${ANN_TAG} B`);
    assert.equal(intact.isActive, true);
  });
});
