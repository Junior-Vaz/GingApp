import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { DEV_PASSWORD } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Escopo por unidade em (1) POST /events/:id/participants e (2) GET /calendar para o PROFESSOR restrito.
 * Grupo PRÓPRIO da suíte (duas unidades A/B). Não toca no seed nem no demo; limpa tudo no after().
 */
const DOMAIN = '@e2e-evscope.local';

describe('Escopo de unidade: inscrição em evento e calendário (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}`;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let orgId: number;
  let unitA: number;
  let unitB: number;
  let stuA: number;
  let stuB: number;
  let eventA: number;
  let eventB: number;
  let eventGroup: number;
  let stateId: number;
  const tokens: Record<string, string> = {};
  const userIds: number[] = [];

  async function makeUser(key: string, role: OrgRole): Promise<number> {
    const user = await prisma.user.create({
      data: {
        email: `${key}-${stamp}${DOMAIN}`,
        passwordHash: await bcrypt.hash(DEV_PASSWORD, 4),
        name: `[e2e-evscope] ${key}`,
        userType: 'MEMBER',
        status: 'ACTIVE',
      },
    });
    userIds.push(user.id);
    await prisma.organizationUser.create({ data: { organizationId: orgId, userId: user.id, role, status: 'ACTIVE' } });
    tokens[key] = (await http().post('/api/auth/login').send({ email: user.email, password: DEV_PASSWORD }).expect(200)).body.accessToken;
    return user.id;
  }

  before(async () => {
    app = await createTestApp();
    orgId = (
      await prisma.organization.create({
        data: { name: `E2E evscope ${stamp}`, slug: `e2e-evscope-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
      })
    ).id;
    unitA = (await prisma.unit.create({ data: { organizationId: orgId, name: 'Filial A', isMain: true } })).id;
    unitB = (await prisma.unit.create({ data: { organizationId: orgId, name: 'Filial B' } })).id;
    await makeUser('mestre', OrgRole.MESTRE);
    const profA = await makeUser('profA', OrgRole.PROFESSOR);
    await prisma.userUnitAccess.create({ data: { organizationId: orgId, userId: profA, unitId: unitA } });

    stateId = (await prisma.state.findFirstOrThrow()).id;
    const m = tokens.mestre;
    const post = async (path: string, body: object) => (await http().post(`/api/${path}`).set(auth(m)).send(body).expect(201)).body;
    stuA = (await post('students', { name: '[e2e-evscope] Aluno A', unitId: unitA })).id;
    stuB = (await post('students', { name: '[e2e-evscope] Aluno B', unitId: unitB })).id;
    const date = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const pub = { date, isPublic: true, stateId };
    eventA = (await post('events', { ...pub, title: `[e2e-evscope] Evento A ${stamp}`, unitId: unitA })).id;
    eventB = (await post('events', { ...pub, title: `[e2e-evscope] Evento B ${stamp}`, unitId: unitB })).id;
    eventGroup = (await post('events', { ...pub, title: `[e2e-evscope] Evento do grupo ${stamp}` })).id;
  });

  after(async () => {
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: orgId }, { userId: { in: userIds } }] } });
    await prisma.notification.deleteMany({ where: { organizationId: orgId } });
    await prisma.eventParticipant.deleteMany({ where: { organizationId: orgId } });
    await prisma.event.deleteMany({ where: { organizationId: orgId } });
    await prisma.student.deleteMany({ where: { organizationId: orgId } });
    await prisma.userUnitAccess.deleteMany({ where: { organizationId: orgId } });
    await prisma.unit.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('professor restrito inscreve aluno da própria unidade (201) e NÃO o de outra unidade (400, nada gravado)', async () => {
    await http().post(`/api/events/${eventA}/participants`).set(auth(tokens.profA)).send({ studentId: stuA }).expect(201);
    const res = await http().post(`/api/events/${eventA}/participants`).set(auth(tokens.profA)).send({ studentId: stuB }).expect(400);
    assert.match(res.body.message, /Aluno inválido/);
    assert.equal(await prisma.eventParticipant.count({ where: { eventId: eventA, studentId: stuB } }), 0);
    // O Mestre (sem restrição) inscreve qualquer aluno do grupo.
    await http().post(`/api/events/${eventA}/participants`).set(auth(tokens.mestre)).send({ studentId: stuB }).expect(201);
  });

  it('GET /calendar: professor restrito não vê evento de outra unidade do PRÓPRIO grupo; Mestre e anônimo veem tudo', async () => {
    const titles = async (token?: string) => {
      const req = http().get(`/api/calendar?scope=week&stateId=${stateId}&limit=200`);
      const res = await (token ? req.set(auth(token)) : req).expect(200);
      return (res.body as Array<{ title: string }>).map((i) => i.title).filter((t) => t.includes(stamp));
    };
    const prof = await titles(tokens.profA);
    assert.deepEqual(prof.sort(), [`[e2e-evscope] Evento A ${stamp}`, `[e2e-evscope] Evento do grupo ${stamp}`].sort());
    assert.equal((await titles(tokens.mestre)).length, 3);
    assert.equal((await titles()).length, 3);
    assert.ok(eventB > 0 && eventGroup > 0);
  });
});
