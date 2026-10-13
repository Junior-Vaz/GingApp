import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Dados que o painel espera (docs/FICHA_UNICA.md secao 12.E): GET /students traz classNames (turmas ATIVAS) e currentCord
 * (graduacao mais recente) por aluno; GET /graduations/systems/:id traz studentCount por nivel (alunos ATIVOS). Grupo PROPRIO.
 */
describe('listas do painel: classNames, currentCord e studentCount (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let org: ReportOrg;
  let systemId: number;
  const ids: Record<string, number> = {};

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    org = await createReportOrg(app, prisma, 'extras');
    const organizationId = org.organizationId;
    const system = await prisma.graduationSystem.create({ data: { organizationId, name: 'Sistema extras' } });
    systemId = system.id;
    const mk = (name: string, order: number, style: 'SOLID' | 'SPLIT', colors: string[]) =>
      prisma.graduationLevel.create({ data: { organizationId, graduationSystemId: systemId, name, order, color: colors[0], style, colors } });
    const verde = await mk('Verde', 1, 'SOLID', ['#00AA00']);
    const azul = await mk('Verde-azul', 2, 'SPLIT', ['#00AA00', '#0000FF']);
    ids.azul = azul.id;
    ids.verde = verde.id;
    const mkStudent = async (key: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') => {
      ids[key] = (await prisma.student.create({ data: { organizationId, name: `[e2e-extras] ${key}`, status } })).id;
    };
    await mkStudent('ana');
    await mkStudent('bia');
    await mkStudent('cris', 'INACTIVE');
    await mkStudent('sem');
    const turmaA = await prisma.class.create({ data: { organizationId, name: 'Turma A', autoGenerateLessons: false } });
    const turmaB = await prisma.class.create({ data: { organizationId, name: 'Turma B', autoGenerateLessons: false } });
    const velha = await prisma.class.create({ data: { organizationId, name: 'Turma velha', status: 'INACTIVE', autoGenerateLessons: false } });
    await prisma.classStudent.createMany({
      data: [
        { organizationId, classId: turmaB.id, studentId: ids.ana, status: 'ACTIVE' },
        { organizationId, classId: turmaA.id, studentId: ids.ana, status: 'ACTIVE' },
        { organizationId, classId: velha.id, studentId: ids.ana, status: 'ACTIVE' },
        { organizationId, classId: turmaA.id, studentId: ids.bia, status: 'INACTIVE' },
      ],
    });
    const grad = (studentId: number, levelId: number, at: string) =>
      prisma.studentGraduation.create({ data: { organizationId, studentId, graduationLevelId: levelId, graduatedAt: new Date(at) } });
    await grad(ids.ana, verde.id, '2025-01-01T00:00:00Z');
    await grad(ids.ana, azul.id, '2026-01-01T00:00:00Z'); // a mais recente
    await grad(ids.bia, verde.id, '2026-02-01T00:00:00Z');
    await grad(ids.cris, azul.id, '2026-02-01T00:00:00Z'); // inativo: nao conta no studentCount
  });

  after(async () => {
    await org.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('GET /students: classNames so de turmas ativas (ordenadas) e currentCord da graduacao mais recente; sem dados = [] / null', async () => {
    const res = await http().get('/api/students?limit=100').set(auth(org.mestre.token)).expect(200);
    const by = (id: number) => (res.body as Array<Record<string, unknown>>).find((s) => s.id === id)!;
    assert.deepEqual(by(ids.ana).classNames, ['Turma A', 'Turma B']);
    assert.deepEqual(by(ids.ana).currentCord, { name: 'Verde-azul', style: 'SPLIT', colors: ['#00AA00', '#0000FF'] });
    assert.deepEqual(by(ids.bia).classNames, []);
    assert.deepEqual(by(ids.bia).currentCord, { name: 'Verde', style: 'SOLID', colors: ['#00AA00'] });
    assert.deepEqual(by(ids.sem).classNames, []);
    assert.equal(by(ids.sem).currentCord, null);
  });

  it('GET /graduations/systems/:id: studentCount por nivel conta so ATIVOS pela graduacao mais recente; outro grupo 404', async () => {
    const res = await http().get(`/api/graduations/systems/${systemId}`).set(auth(org.mestre.token)).expect(200);
    const count = (id: number) => res.body.levels.find((l: { id: number }) => l.id === id).studentCount;
    assert.equal(count(ids.azul), 1, 'ana (cris e inativa)');
    assert.equal(count(ids.verde), 1, 'so bia: a ana ja subiu para o azul');
    const other = await createReportOrg(app, prisma, 'extras-b');
    try {
      await http().get(`/api/graduations/systems/${systemId}`).set(auth(other.mestre.token)).expect(404);
    } finally {
      await other.cleanup();
    }
  });
});
