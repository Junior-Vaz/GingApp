import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { backfillGroupRoles } from '../src/interface/http/roles/group-roles';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * CARGOS DO GRUPO (docs/FICHA_UNICA.md secao 13). Grupos PROPRIOS (A e B); nunca o seed/demo.
 * Fixtures "[e2e-gcargos]" / "@e2e-gcargos.local", limpas no after() (GroupRole sai em cascata com o grupo).
 */
const PREFIX = '[e2e-gcargos]';
const DOMAIN = '@e2e-gcargos.local';
const PASSWORD = 'Prov@Senha2026x';

type Role = { id: number; name: string; slug: string; accessRole: string; rank: number; isDefault: boolean; active: boolean; peopleCount: number };

describe('cargos do grupo - secao 13 (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let A: ReportOrg;
  let B: ReportOrg;
  let slugA: string;
  const stamp = Date.now();
  let contramestre: Role;
  let formado: Role;
  let defaults: Record<string, Role>;
  let person: { studentId: number; userId: number; token: string };

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const list = async (token: string) => (await http().get('/api/group-roles').set(auth(token)).expect(200)).body as Role[];

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    A = await createReportOrg(app, prisma, 'gcargos-a');
    B = await createReportOrg(app, prisma, 'gcargos-b');
    slugA = (await prisma.organization.findUniqueOrThrow({ where: { id: A.organizationId } })).slug;
  });

  after(async () => {
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    await prisma.notification.deleteMany({ where: { userId: { in: [...userIds, A.mestre.userId] } } });
    await prisma.pointEvent.deleteMany({ where: { organizationId: { in: [A.organizationId, B.organizationId] } } });
    await A.cleanup();
    await B.cleanup();
    await prisma.person.deleteMany({ where: { name: { startsWith: PREFIX }, students: { none: {} } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('grupo sem cargos ganha os 4 padrao; migracao/backfill liga cargo antigo ao padrao SEM mudar o acesso; idempotente', async () => {
    // Cargo "antigo" (anterior a secao 13): sem groupRoleId.
    await prisma.personRole.create({ data: { organizationId: A.organizationId, userId: A.professor.userId, role: 'PROFESSOR', source: 'MIGRATION' } });
    const first = await backfillGroupRoles(prisma, { organizationIds: [A.organizationId] });
    assert.deepEqual([first.organizations, first.defaultsCreated, first.personRolesLinked], [1, 4, 1]);
    const again = await backfillGroupRoles(prisma, { organizationIds: [A.organizationId] });
    assert.deepEqual([again.defaultsCreated, again.personRolesLinked, again.rulesLinked], [0, 0, 0]);

    const roles = await list(A.mestre.token);
    assert.deepEqual(roles.map((r) => [r.slug, r.accessRole, r.rank, r.isDefault]), [
      ['mestre', 'MESTRE', 40, true],
      ['professor', 'PROFESSOR', 30, true],
      ['instrutor', 'INSTRUTOR', 20, true],
      ['monitor', 'MONITOR', 10, true],
    ]);
    defaults = Object.fromEntries(roles.map((r) => [r.slug, r]));
    assert.equal(defaults.professor!.peopleCount, 1);
    const linked = await prisma.personRole.findFirstOrThrow({ where: { organizationId: A.organizationId, userId: A.professor.userId } });
    assert.equal(linked.groupRoleId, defaults.professor!.id);
    // Acesso intacto: o papel e o mesmo e as permissoes tambem.
    const me = await http().get('/api/auth/me').set(auth(A.professor.token)).expect(200);
    assert.equal(me.body.role, 'PROFESSOR');
    assert.deepEqual(me.body.roleKeys, ['professor']);
    assert.equal(me.body.roles[0].name, 'Professor');
    await http().get('/api/students').set(auth(A.professor.token)).expect(200);
    await http().get('/api/finance').set(auth(A.professor.token)).expect(403);
  });

  it('CRUD: so MESTRE cria; nome 2-30 sem duplicata; icone/cor validados; outro grupo 404', async () => {
    await http().post('/api/group-roles').set(auth(A.professor.token)).send({ name: 'Contramestre', accessRole: 'PROFESSOR' }).expect(403);
    await http().get('/api/group-roles').set(auth(A.aluno.token)).expect(403);
    contramestre = (
      await http()
        .post('/api/group-roles')
        .set(auth(A.mestre.token))
        .send({ name: 'Contramestre', accessRole: 'PROFESSOR', rank: 35, color: '#B91C1C', icon: 'medal' })
        .expect(201)
    ).body;
    assert.deepEqual([contramestre.slug, contramestre.rank, contramestre.isDefault, contramestre.peopleCount], ['contramestre', 35, false, 0]);
    formado = (await http().post('/api/group-roles').set(auth(A.mestre.token)).send({ name: 'Formado', accessRole: 'INSTRUTOR' }).expect(201)).body;
    assert.equal(formado.rank, 21, 'sem rank: logo acima do maior cargo do mesmo perfil');

    const dup = await http().post('/api/group-roles').set(auth(A.mestre.token)).send({ name: '  contramestre ', accessRole: 'MONITOR' }).expect(409);
    assert.equal(dup.body.code, 'GROUP_ROLE_NAME_TAKEN');
    const short = await http().post('/api/group-roles').set(auth(A.mestre.token)).send({ name: 'A', accessRole: 'MONITOR' }).expect(400);
    assert.equal(short.body.code, 'INVALID_GROUP_ROLE_NAME');
    await http().post('/api/group-roles').set(auth(A.mestre.token)).send({ name: 'Ok', accessRole: 'MONITOR', icon: 'bomb' }).expect(400);
    await http().post('/api/group-roles').set(auth(A.mestre.token)).send({ name: 'Ok', accessRole: 'MONITOR', color: 'red' }).expect(400);
    await http().post('/api/group-roles').set(auth(A.mestre.token)).send({ name: 'Ok', accessRole: 'ALUNO' }).expect(400);

    await http().patch(`/api/group-roles/${contramestre.id}`).set(auth(B.mestre.token)).send({ name: 'Invasor' }).expect(404);
    await http().delete(`/api/group-roles/${contramestre.id}`).set(auth(B.mestre.token)).expect(404);
    assert.ok(!(await list(B.mestre.token)).some((r) => r.id === contramestre.id), 'isolamento: B so ve os seus');
    const renamed = await http().patch(`/api/group-roles/${formado.id}`).set(auth(A.mestre.token)).send({ name: 'Formada(o)', rank: 25, color: null }).expect(200);
    assert.deepEqual([renamed.body.name, renamed.body.slug, renamed.body.rank, renamed.body.color], ['Formada(o)', 'formado', 25, null]);
    assert.equal(await prisma.auditLog.count({ where: { organizationId: A.organizationId, action: { in: ['GROUP_ROLE_CREATE', 'GROUP_ROLE_UPDATE'] } } }), 3);
  });

  it('padrao nao se exclui; limite de 20; sempre um cargo ativo com perfil MESTRE', async () => {
    const def = await http().delete(`/api/group-roles/${defaults.monitor!.id}`).set(auth(A.mestre.token)).expect(409);
    assert.equal(def.body.code, 'DEFAULT_GROUP_ROLE');
    const extra: number[] = [];
    for (let i = (await list(A.mestre.token)).length; i < 20; i++) {
      extra.push((await http().post('/api/group-roles').set(auth(A.mestre.token)).send({ name: `Extra ${i}`, accessRole: 'MONITOR' }).expect(201)).body.id);
    }
    const limit = await http().post('/api/group-roles').set(auth(A.mestre.token)).send({ name: 'Vigesimo primeiro', accessRole: 'MONITOR' }).expect(409);
    assert.equal(limit.body.code, 'GROUP_ROLE_LIMIT');
    for (const id of extra) await http().delete(`/api/group-roles/${id}`).set(auth(A.mestre.token)).expect(204);
    assert.equal((await list(A.mestre.token)).length, 6);

    // Grupo B: o Mestre ainda nao tem cargo materializado (cargo padrao sem uso) e e o unico cargo de perfil MESTRE.
    const bRoles = await list(B.mestre.token);
    const bMestre = bRoles.find((r) => r.slug === 'mestre')!;
    const last = await http().patch(`/api/group-roles/${bMestre.id}`).set(auth(B.mestre.token)).send({ active: false }).expect(409);
    assert.equal(last.body.code, 'LAST_MESTRE_ROLE');
    const lastAccess = await http().patch(`/api/group-roles/${bMestre.id}`).set(auth(B.mestre.token)).send({ accessRole: 'PROFESSOR' }).expect(409);
    assert.equal(lastAccess.body.code, 'LAST_MESTRE_ROLE');
    // Com outro cargo de perfil MESTRE ativo, o padrao sem uso pode ser inativado (e reativado).
    const fundador = (await http().post('/api/group-roles').set(auth(B.mestre.token)).send({ name: 'Mestre Fundador', accessRole: 'MESTRE' }).expect(201)).body;
    await http().patch(`/api/group-roles/${bMestre.id}`).set(auth(B.mestre.token)).send({ active: false }).expect(200);
    const delLast = await http().delete(`/api/group-roles/${fundador.id}`).set(auth(B.mestre.token)).expect(409);
    assert.equal(delLast.body.code, 'LAST_MESTRE_ROLE');
    await http().patch(`/api/group-roles/${bMestre.id}`).set(auth(B.mestre.token)).send({ active: true }).expect(200);
    await http().delete(`/api/group-roles/${fundador.id}`).set(auth(B.mestre.token)).expect(204);
  });

  it('conceder/revogar por groupRoleId: acesso = MAIOR perfil; selo = MAIOR rank; em uso nao exclui/inativa/muda perfil', async () => {
    const s = (await http().post('/api/students').set(auth(A.mestre.token)).send({ name: `${PREFIX} Capoeirista` }).expect(201)).body;
    const email = `pessoa-${stamp}${DOMAIN}`;
    const g1 = await http()
      .post('/api/roles/grant')
      .set(auth(A.mestre.token))
      .send({ studentId: s.id, groupRoleId: formado.id, email, password: PASSWORD })
      .expect(201);
    assert.equal(g1.body.accessRole, 'INSTRUTOR');
    assert.deepEqual(g1.body.roleKeys, ['formado']);
    await prisma.user.update({ where: { id: g1.body.userId }, data: { mustChangePassword: false } });
    const token = (await http().post('/api/auth/login').send({ email, password: PASSWORD, organizationSlug: slugA }).expect(200)).body.accessToken as string;
    person = { studentId: s.id, userId: g1.body.userId, token };

    const g2 = await http().post('/api/roles/grant').set(auth(A.mestre.token)).send({ studentId: s.id, groupRoleId: contramestre.id }).expect(201);
    assert.equal(g2.body.accessRole, 'PROFESSOR');
    assert.deepEqual(g2.body.roles.map((r: { name: string }) => r.name), ['Contramestre', 'Formada(o)']);
    const me = await http().get('/api/auth/me').set(auth(token)).expect(200);
    assert.equal(me.body.role, 'PROFESSOR');
    assert.deepEqual(me.body.roleKeys, ['contramestre', 'formado']);
    assert.equal(me.body.roles[0].color, '#B91C1C');
    await http().get('/api/finance').set(auth(token)).expect(403);
    await http().get('/api/teachers').set(auth(token)).expect(200);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: person.userId, type: 'ROLE_GRANTED' }, orderBy: { id: 'desc' } });
    assert.equal(n.title, 'Você agora é Contramestre');
    const grantAudit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: A.organizationId, action: 'ROLE_GRANT' }, orderBy: { id: 'desc' } });
    assert.equal((grantAudit.metadata as { groupRoleName: string }).groupRoleName, 'Contramestre');

    const dup = await http().post('/api/roles/grant').set(auth(A.mestre.token)).send({ studentId: s.id, groupRoleId: contramestre.id }).expect(409);
    assert.equal(dup.body.code, 'ROLE_ALREADY_ACTIVE');
    const bRole = (await list(B.mestre.token))[0]!;
    await http().post('/api/roles/grant').set(auth(A.mestre.token)).send({ studentId: s.id, groupRoleId: bRole.id }).expect(404);

    const inUse = await http().delete(`/api/group-roles/${contramestre.id}`).set(auth(A.mestre.token)).expect(409);
    assert.deepEqual([inUse.body.code, inUse.body.peopleCount], ['GROUP_ROLE_IN_USE', 1]);
    assert.equal((await http().patch(`/api/group-roles/${contramestre.id}`).set(auth(A.mestre.token)).send({ accessRole: 'MESTRE' }).expect(409)).body.code, 'GROUP_ROLE_IN_USE');
    assert.equal((await http().patch(`/api/group-roles/${contramestre.id}`).set(auth(A.mestre.token)).send({ active: false }).expect(409)).body.code, 'GROUP_ROLE_IN_USE');

    // Filtros por cargo do grupo (equipe e alunos) e selos nas listas/ficha.
    const team = await http().get(`/api/teachers?groupRoleId=${contramestre.id}`).set(auth(A.mestre.token)).expect(200);
    assert.deepEqual((team.body.items ?? team.body).map((t: { user: { id: number } }) => t.user.id), [person.userId]);
    const students = await http().get(`/api/students?groupRoleId=${formado.id}`).set(auth(A.mestre.token)).expect(200);
    const items = students.body.items ?? students.body;
    assert.deepEqual(items.map((i: { id: number }) => i.id), [s.id]);
    assert.deepEqual(items[0].staffRoleKeys, ['contramestre', 'formado']);
    const ficha = await http().get(`/api/students/${s.id}/ficha`).set(auth(A.mestre.token)).expect(200);
    assert.equal(ficha.body.enrollments[0].roles[0].name, 'Contramestre');
    assert.ok(ficha.body.roles.every((r: { groupRole: { id: number } }) => r.groupRole.id > 0));

    const r1 = await http().post('/api/roles/revoke').set(auth(A.mestre.token)).send({ studentId: s.id, groupRoleId: contramestre.id }).expect(200);
    assert.equal(r1.body.accessRole, 'INSTRUTOR');
    assert.equal((await http().get('/api/auth/me').set(auth(token)).expect(200)).body.role, 'INSTRUTOR');
    // INSTRUTOR nunca exclui (PROFESSOR excluiria).
    await http().delete(`/api/students/${s.id}`).set(auth(token)).expect(403);
    const notActive = await http().post('/api/roles/revoke').set(auth(A.mestre.token)).send({ studentId: s.id, groupRoleId: contramestre.id }).expect(409);
    assert.equal(notActive.body.code, 'ROLE_NOT_ACTIVE');

    // Cargo inativo nao e concedido.
    const tmp = (await http().post('/api/group-roles').set(auth(A.mestre.token)).send({ name: 'Temporario', accessRole: 'MONITOR', active: false }).expect(201)).body;
    assert.equal((await http().post('/api/roles/grant').set(auth(A.mestre.token)).send({ studentId: s.id, groupRoleId: tmp.id }).expect(409)).body.code, 'GROUP_ROLE_INACTIVE');
    await http().delete(`/api/group-roles/${tmp.id}`).set(auth(A.mestre.token)).expect(204);
  });

  it('migrar pessoas para outro cargo recalcula o acesso; depois o cargo vazio pode ser excluido; reorder', async () => {
    await http().post(`/api/group-roles/${formado.id}/migrate`).set(auth(A.professor.token)).send({ targetGroupRoleId: defaults.monitor!.id }).expect(403);
    const res = await http().post(`/api/group-roles/${formado.id}/migrate`).set(auth(A.mestre.token)).send({ targetGroupRoleId: defaults.monitor!.id }).expect(200);
    assert.equal(res.body.moved, 1);
    assert.equal((await http().get('/api/auth/me').set(auth(person.token)).expect(200)).body.role, 'MONITOR');
    assert.equal((await list(A.mestre.token)).find((r) => r.id === formado.id)!.peopleCount, 0);

    const order = (await list(A.mestre.token)).map((r) => r.id).reverse();
    const bad = await http().put('/api/group-roles/reorder').set(auth(A.mestre.token)).send({ order: order.slice(1) }).expect(400);
    assert.equal(bad.body.code, 'INVALID_ROLE_ORDER');
    const reordered = (await http().put('/api/group-roles/reorder').set(auth(A.mestre.token)).send({ order }).expect(200)).body as Role[];
    assert.deepEqual(reordered.map((r) => r.id), order);
    assert.equal(reordered[0]!.rank, order.length * 10);
    // volta a ordem natural (Mestre no topo) para os proximos testes
    await http().put('/api/group-roles/reorder').set(auth(A.mestre.token)).send({ order: [...order].reverse() }).expect(200);
    assert.equal(await prisma.auditLog.count({ where: { organizationId: A.organizationId, action: { in: ['GROUP_ROLE_MIGRATE', 'GROUP_ROLE_REORDER'] } } }), 3);
  });

  it('regras de corda por cargo do grupo + sugestoes por rank; hierarquia agrupada por cargo', async () => {
    const system = await prisma.graduationSystem.create({ data: { organizationId: A.organizationId, name: `${PREFIX} Sistema` } });
    const levels: number[] = [];
    for (const [order, name] of [[1, 'Crua'], [2, 'Verde'], [3, 'Amarela']] as const) {
      levels.push((await prisma.graduationLevel.create({ data: { organizationId: A.organizationId, graduationSystemId: system.id, name, order, color: '#00AA00', colors: ['#00AA00'] } })).id);
    }
    const bRole = (await list(B.mestre.token))[0]!;
    const foreign = await http().put(`/api/graduations/systems/${system.id}/role-rules`).set(auth(A.mestre.token)).send({ rules: [{ groupRoleId: bRole.id, minLevelOrder: 2 }] }).expect(400);
    assert.equal(foreign.body.code, 'GROUP_ROLE_NOT_FOUND');
    const saved = await http()
      .put(`/api/graduations/systems/${system.id}/role-rules`)
      .set(auth(A.mestre.token))
      .send({ rules: [{ groupRoleId: defaults.monitor!.id, minLevelOrder: 2 }, { groupRoleId: contramestre.id, minLevelOrder: 3 }] })
      .expect(200);
    assert.deepEqual(saved.body.rules.map((r: { groupRole: { name: string }; role: string; level: { name: string } }) => [r.groupRole.name, r.role, r.level.name]), [
      ['Contramestre', 'PROFESSOR', 'Amarela'],
      ['Monitor', 'MONITOR', 'Verde'],
    ]);

    const kid = (await http().post('/api/students').set(auth(A.mestre.token)).send({ name: `${PREFIX} Graduado` }).expect(201)).body;
    await http().post(`/api/graduations/students/${kid.id}`).set(auth(A.mestre.token)).send({ graduationLevelId: levels[2], graduatedAt: '2026-10-01' }).expect(201);
    const sug = (await http().get('/api/roles/suggestions').set(auth(A.mestre.token)).expect(200)).body.filter((x: { studentId: number }) => x.studentId === kid.id);
    assert.deepEqual(sug.map((x: { role: { name: string } }) => x.role.name), ['Contramestre', 'Monitor']);
    // Quem ja e Monitor (rank 10) so recebe sugestao de cargo maior.
    await prisma.studentGraduation.create({ data: { organizationId: A.organizationId, studentId: person.studentId, graduationLevelId: levels[2]!, graduatedAt: new Date() } });
    const sug2 = (await http().get('/api/roles/suggestions').set(auth(A.mestre.token)).expect(200)).body.filter((x: { studentId: number }) => x.studentId === person.studentId);
    assert.deepEqual(sug2.map((x: { role: { name: string } }) => x.role.name), ['Contramestre']);

    // Hierarquia: arvore por cargo do grupo, maior rank primeiro; cada pessoa no seu maior cargo.
    await http().post('/api/roles/grant').set(auth(A.mestre.token)).send({ studentId: person.studentId, groupRoleId: contramestre.id }).expect(201);
    const h = await http().get('/api/graduations/hierarchy').set(auth(A.mestre.token)).expect(200);
    const staff = h.body.staff as { groupRole: { name: string; rank: number }; people: { id: number }[] }[];
    assert.deepEqual(staff.map((g) => g.groupRole.name), ['Mestre', 'Contramestre', 'Professor']);
    assert.ok(staff.every((g, i) => i === 0 || staff[i - 1]!.groupRole.rank >= g.groupRole.rank));
    assert.deepEqual(staff[1]!.people.map((p) => p.id), [person.userId]);
    assert.ok(!staff.some((g) => g.groupRole.name === 'Monitor'), 'Monitor da mesma pessoa nao duplica');
    assert.ok(Array.isArray(h.body.masters) && Array.isArray(h.body.teachers), 'legados mantidos');
  });
});
