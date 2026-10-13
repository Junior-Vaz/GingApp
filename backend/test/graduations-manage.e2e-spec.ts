import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { ALUNO_EMAIL, createSecondOrg, loginAs, MESTRE_EMAIL, SecondOrg } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * PATCH/DELETE de sistema, nível e graduação concedida (graduations.controller.ts):
 * edit/delete na matriz, soft-delete do sistema com histórico, 409 em nível/graduação com
 * referência e isolamento multi-tenant (outra org => 404).
 */
describe('Graduations manage (PATCH/DELETE) (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const tag = `gm${Date.now()}`;

  let mestreToken: string;
  let professorToken: string;
  let alunoToken: string;
  let orgId: number;
  let studentId: number;
  let orgB: SecondOrg;

  let systemId: number; // com histórico de aluno
  let levelAId: number;
  let levelBId: number;
  let graduationId: number;
  let emptySystemId: number;

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  before(async () => {
    app = await createTestApp();
    const m = await loginAs(app, MESTRE_EMAIL);
    mestreToken = m.token;
    orgId = m.organizationId;
    professorToken = (await loginAs(app, 'professor@gingabrasil.com.br')).token;
    alunoToken = (await loginAs(app, ALUNO_EMAIL)).token;
    studentId = (await prisma.student.findFirstOrThrow({ where: { organizationId: orgId, user: { email: ALUNO_EMAIL } } })).id;
    orgB = await createSecondOrg(app, prisma, 'gradmanage');

    const sys = await prisma.graduationSystem.create({ data: { organizationId: orgId, name: `${tag} sistema` } });
    systemId = sys.id;
    levelAId = (await prisma.graduationLevel.create({ data: { organizationId: orgId, graduationSystemId: systemId, name: `${tag} A`, order: 1 } })).id;
    levelBId = (await prisma.graduationLevel.create({ data: { organizationId: orgId, graduationSystemId: systemId, name: `${tag} B`, order: 2 } })).id;
    graduationId = (
      await prisma.studentGraduation.create({
        data: { organizationId: orgId, studentId, graduationLevelId: levelAId, graduatedAt: new Date('2025-01-10T12:00:00Z'), notes: 'x' },
      })
    ).id;
    emptySystemId = (await prisma.graduationSystem.create({ data: { organizationId: orgId, name: `${tag} vazio` } })).id;
    await prisma.graduationLevel.create({ data: { organizationId: orgId, graduationSystemId: emptySystemId, name: `${tag} V`, order: 1 } });
  });

  after(async () => {
    await prisma.certificate.deleteMany({ where: { studentGraduation: { organizationId: orgId, graduationLevel: { name: { startsWith: tag } } } } });
    await prisma.studentGraduation.deleteMany({ where: { graduationLevel: { name: { startsWith: tag } } } });
    await prisma.graduationLevel.deleteMany({ where: { name: { startsWith: tag } } });
    await prisma.graduationSystem.deleteMany({ where: { name: { startsWith: tag } } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('PATCH /systems/:id edita nome/descricao e persiste; null limpa a descricao', async () => {
    const res = await api().patch(`/api/graduations/systems/${systemId}`).set(auth(mestreToken)).send({ name: `${tag} renomeado`, description: 'd' }).expect(200);
    assert.equal(res.body.name, `${tag} renomeado`);
    await api().patch(`/api/graduations/systems/${systemId}`).set(auth(mestreToken)).send({ description: null }).expect(200);
    const db = await prisma.graduationSystem.findUniqueOrThrow({ where: { id: systemId } });
    assert.equal(db.name, `${tag} renomeado`);
    assert.equal(db.description, null);
  });

  it('PATCH /systems/:id com name null — 400', async () => {
    await api().patch(`/api/graduations/systems/${systemId}`).set(auth(mestreToken)).send({ name: null }).expect(400);
  });

  it('PATCH /levels/:id edita nome/cor; ordem repetida no sistema — 409', async () => {
    await api().patch(`/api/graduations/levels/${levelAId}`).set(auth(mestreToken)).send({ name: `${tag} A2`, color: '#fff' }).expect(200);
    const db = await prisma.graduationLevel.findUniqueOrThrow({ where: { id: levelAId } });
    assert.equal(db.name, `${tag} A2`);
    // color legado (#RGB) é normalizado para #RRGGBB maiúsculo e vira corda SOLID com colors = [color].
    assert.equal(db.color, '#FFFFFF');
    assert.deepEqual(db.colors, ['#FFFFFF']);
    assert.equal(db.style, 'SOLID');
    await api().patch(`/api/graduations/levels/${levelAId}`).set(auth(mestreToken)).send({ order: 2 }).expect(409);
  });

  it('PATCH /students/:sid/:gid corrige nivel e data; nivel de outra org — 400', async () => {
    const res = await api()
      .patch(`/api/graduations/students/${studentId}/${graduationId}`)
      .set(auth(mestreToken))
      .send({ graduationLevelId: levelBId, graduatedAt: '2025-02-20T12:00:00.000Z', notes: null })
      .expect(200);
    assert.equal(res.body.graduationLevel.id, levelBId);
    const db = await prisma.studentGraduation.findUniqueOrThrow({ where: { id: graduationId } });
    assert.equal(db.graduationLevelId, levelBId);
    assert.equal(db.graduatedAt.toISOString(), '2025-02-20T12:00:00.000Z');
    assert.equal(db.notes, null);

    const foreignLevel = await prisma.graduationLevel.create({
      data: {
        organizationId: orgB.organizationId,
        graduationSystemId: (await prisma.graduationSystem.create({ data: { organizationId: orgB.organizationId, name: `${tag} B-sys` } })).id,
        name: `${tag} B-lvl`,
        order: 1,
      },
    });
    await api().patch(`/api/graduations/students/${studentId}/${graduationId}`).set(auth(mestreToken)).send({ graduationLevelId: foreignLevel.id }).expect(400);
    await prisma.graduationLevel.delete({ where: { id: foreignLevel.id } });
    await prisma.graduationSystem.deleteMany({ where: { organizationId: orgB.organizationId } });
  });

  it('PATCH com aluno errado na URL — 404 e nada muda', async () => {
    await api().patch(`/api/graduations/students/999999/${graduationId}`).set(auth(mestreToken)).send({ notes: 'hack' }).expect(404);
    const db = await prisma.studentGraduation.findUniqueOrThrow({ where: { id: graduationId } });
    assert.notEqual(db.notes, 'hack');
  });

  it('RBAC: ESTRUTURA do sistema e so do MESTRE (PROFESSOR 403, MESTRE 201/200); ALUNO nao edita nem remove (403)', async () => {
    await api().post('/api/graduations/systems').set(auth(professorToken)).send({ name: `${tag} prof` }).expect(403);
    await api().post(`/api/graduations/systems/${systemId}/levels`).set(auth(professorToken)).send({ name: `${tag} prof` }).expect(403);
    await api().post('/api/graduations/systems/from-template').set(auth(professorToken)).send({ code: 'x' }).expect(403);
    await api().patch(`/api/graduations/systems/${systemId}`).set(auth(professorToken)).send({ name: `${tag} prof` }).expect(403);
    await api().patch(`/api/graduations/levels/${levelAId}`).set(auth(professorToken)).send({ color: '#000' }).expect(403);
    await api().post(`/api/graduations/levels/${levelAId}/duplicate`).set(auth(professorToken)).expect(403);
    const created = await api().post('/api/graduations/systems').set(auth(mestreToken)).send({ name: `${tag} mestre` }).expect(201);
    assert.ok(created.body.id);
    await api().patch(`/api/graduations/levels/${levelAId}`).set(auth(mestreToken)).send({ color: '#000' }).expect(200);
    await api().delete(`/api/graduations/levels/${levelAId}`).set(auth(professorToken)).expect(403);
    await api().delete(`/api/graduations/systems/${systemId}`).set(auth(professorToken)).expect(403);
    await api().delete(`/api/graduations/students/${studentId}/${graduationId}`).set(auth(professorToken)).expect(403);
    await api().patch(`/api/graduations/systems/${systemId}`).set(auth(alunoToken)).send({ name: 'xx' }).expect(403);
    await api().delete(`/api/graduations/students/${studentId}/${graduationId}`).set(auth(alunoToken)).expect(403);
  });

  it('isolamento multi-tenant: MESTRE de outra org recebe 404 em todos os PATCH/DELETE e nada muda', async () => {
    const t = orgB.token;
    await api().patch(`/api/graduations/systems/${systemId}`).set(auth(t)).send({ name: 'invadido' }).expect(404);
    await api().delete(`/api/graduations/systems/${emptySystemId}`).set(auth(t)).expect(404);
    await api().patch(`/api/graduations/levels/${levelAId}`).set(auth(t)).send({ name: 'invadido' }).expect(404);
    await api().delete(`/api/graduations/levels/${levelBId}`).set(auth(t)).expect(404);
    await api().patch(`/api/graduations/students/${studentId}/${graduationId}`).set(auth(t)).send({ notes: 'invadido' }).expect(404);
    await api().delete(`/api/graduations/students/${studentId}/${graduationId}`).set(auth(t)).expect(404);
    assert.equal((await prisma.graduationSystem.findUniqueOrThrow({ where: { id: systemId } })).name, `${tag} renomeado`);
    assert.ok(await prisma.graduationSystem.findUnique({ where: { id: emptySystemId } }));
    assert.ok(await prisma.graduationLevel.findUnique({ where: { id: levelBId } }));
    assert.ok(await prisma.studentGraduation.findUnique({ where: { id: graduationId } }));
  });

  it('DELETE /levels/:id de nivel ja concedido — 409 e o nivel continua no banco', async () => {
    await api().delete(`/api/graduations/levels/${levelBId}`).set(auth(mestreToken)).expect(409);
    assert.ok(await prisma.graduationLevel.findUnique({ where: { id: levelBId } }));
  });

  it('DELETE /systems/:id com historico de aluno inativa (soft) e preserva niveis/graduacoes; inativo nao recebe niveis; reativar volta', async () => {
    const res = await api().delete(`/api/graduations/systems/${systemId}`).set(auth(mestreToken)).expect(200);
    assert.equal(res.body.isActive, false);
    assert.equal((await prisma.graduationSystem.findUniqueOrThrow({ where: { id: systemId } })).isActive, false);
    assert.equal(await prisma.graduationLevel.count({ where: { graduationSystemId: systemId } }), 2);
    assert.ok(await prisma.studentGraduation.findUnique({ where: { id: graduationId } }));
    await api().post(`/api/graduations/systems/${systemId}/levels`).set(auth(mestreToken)).send({ name: `${tag} C`, order: 3 }).expect(400);
    await api().patch(`/api/graduations/systems/${systemId}`).set(auth(mestreToken)).send({ isActive: true }).expect(200);
    assert.equal((await prisma.graduationSystem.findUniqueOrThrow({ where: { id: systemId } })).isActive, true);
  });

  it('DELETE /systems/:id sem graduacoes concedidas apaga de verdade (sistema + niveis)', async () => {
    const res = await api().delete(`/api/graduations/systems/${emptySystemId}`).set(auth(mestreToken)).expect(200);
    assert.equal(res.body.deleted, true);
    assert.equal(await prisma.graduationSystem.count({ where: { id: emptySystemId } }), 0);
    assert.equal(await prisma.graduationLevel.count({ where: { graduationSystemId: emptySystemId } }), 0);
  });

  it('DELETE /students/:sid/:gid com certificado emitido — 409; sem certificado — apaga e some do historico', async () => {
    const cert = await prisma.certificate.create({
      data: { organizationId: orgId, studentId, studentGraduationId: graduationId, title: `${tag} cert` },
    });
    await api().delete(`/api/graduations/students/${studentId}/${graduationId}`).set(auth(mestreToken)).expect(409);
    assert.ok(await prisma.studentGraduation.findUnique({ where: { id: graduationId } }));
    await prisma.certificate.delete({ where: { id: cert.id } });

    await api().delete(`/api/graduations/students/${studentId}/${graduationId}`).set(auth(mestreToken)).expect(200);
    assert.equal(await prisma.studentGraduation.count({ where: { id: graduationId } }), 0);
    const hist = await api().get(`/api/graduations/students/${studentId}`).set(auth(mestreToken)).expect(200);
    assert.ok(!hist.body.some((g: { id: number }) => g.id === graduationId));
    await api().delete(`/api/graduations/students/${studentId}/${graduationId}`).set(auth(mestreToken)).expect(404);
  });

  it('DELETE /levels/:id sem graduacoes apaga de verdade', async () => {
    await api().delete(`/api/graduations/levels/${levelBId}`).set(auth(mestreToken)).expect(200);
    assert.equal(await prisma.graduationLevel.count({ where: { id: levelBId } }), 0);
  });
});
