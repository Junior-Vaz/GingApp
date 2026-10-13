import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus, RopeStyle } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createSecondOrg, DEV_PASSWORD, loginAs, SecondOrg } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * GET /graduations/hierarchy (Jornada do app): ordem dos níveis (mais alto primeiro), "me", contagens, limite de 12
 * alunos por nível (com "me" sempre incluído), mestres/professores (isMyTeacher, level), privacidade (só ACTIVE do
 * MESMO grupo, nome curto/apelido, nada de contato/documento/nascimento) e isolamento entre grupos.
 * Monta um grupo próprio (org A) + um grupo "vizinho" (org B) e limpa tudo no final.
 */
describe('Graduations hierarchy (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const tag = `hier${Date.now()}`;

  let orgA: SecondOrg; // MESTRE da org A
  let orgB: SecondOrg; // outro grupo (vizinho): MESTRE de B
  let orgAId: number;
  let systemId: number;
  let l1: number;
  let l2: number;
  let l3: number;
  const userIds: number[] = [];
  const studentIds: number[] = [];
  const tokens: Record<string, string> = {};
  const ids: Record<string, number> = {};
  const SECRET = {
    document: `DOC-${tag}`,
    phone: `+55 61 9${tag.slice(-8)}`,
    email: `segredo-${tag}@sentinela.local`,
    birth: '1999-09-09',
    surname: `Sobrenomesecreto${tag}`,
  };
  const OTHER_GROUP = `Forasteiro${tag}`;

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (path: string, token: string) => api().get(path).set(auth(token));

  async function makeUser(key: string, name: string, role: OrgRole | null, orgId: number, photo?: string) {
    const user = await prisma.user.create({
      data: {
        email: `${key}-${tag}@hier.local`,
        passwordHash: await bcrypt.hash(DEV_PASSWORD, 4),
        name,
        photo,
        userType: 'MEMBER',
        status: 'ACTIVE',
      },
    });
    userIds.push(user.id);
    if (role) await prisma.organizationUser.create({ data: { organizationId: orgId, userId: user.id, role, status: 'ACTIVE' } });
    ids[key] = user.id;
    return user;
  }

  async function makeStudent(key: string, name: string, opts: { userId?: number; status?: 'ACTIVE' | 'INACTIVE'; photo?: string; org?: number } = {}) {
    const s = await prisma.student.create({
      data: {
        organizationId: opts.org ?? orgAId,
        userId: opts.userId,
        name,
        status: opts.status ?? 'ACTIVE',
        photo: opts.photo,
        document: SECRET.document,
        phone: SECRET.phone,
        email: SECRET.email,
        birthDate: new Date(`${SECRET.birth}T00:00:00.000Z`),
      },
    });
    studentIds.push(s.id);
    ids[key] = s.id;
    return s;
  }

  const graduate = (studentId: number, levelId: number, daysAgo: number, org = orgAId) =>
    prisma.studentGraduation.create({
      data: { organizationId: org, studentId, graduationLevelId: levelId, graduatedAt: new Date(Date.now() - daysAgo * 86_400_000), notes: `nota-${tag}` },
    });

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    orgA = await createSecondOrg(app, prisma, `${tag}a`);
    orgB = await createSecondOrg(app, prisma, `${tag}b`);
    orgAId = orgA.organizationId;
    await prisma.organization.update({ where: { id: orgAId }, data: { name: `Grupo Hier ${tag}`, logo: `/api/uploads/logo-${tag}.png` } });

    // Sistema ATIVO com 3 níveis (SOLID, SPLIT, BRAIDED 3 cores) + um sistema inativo criado ANTES (não pode ser escolhido).
    const inactive = await prisma.graduationSystem.create({ data: { organizationId: orgAId, name: `${tag} inativo`, isActive: false } });
    await prisma.graduationLevel.create({ data: { organizationId: orgAId, graduationSystemId: inactive.id, name: `${tag} inativo L1`, order: 1, color: '#000000', colors: ['#000000'] } });
    systemId = (await prisma.graduationSystem.create({ data: { organizationId: orgAId, name: `${tag} sistema` } })).id;
    const mk = (name: string, order: number, style: RopeStyle, colors: string[]) =>
      prisma.graduationLevel.create({ data: { organizationId: orgAId, graduationSystemId: systemId, name: `${tag} ${name}`, order, color: colors[0], style, colors } }).then((l) => l.id);
    l1 = await mk('Crua', 1, 'SOLID', ['#E8DFC8']);
    l2 = await mk('Verde/Amarela', 2, 'SPLIT', ['#16A34A', '#FACC15']);
    l3 = await mk('Tricolor', 3, 'BRAIDED', ['#16A34A', '#FACC15', '#2563EB']);

    // Staff: o MESTRE (orgA.userId) também treina (Student ligado, corda mais alta); 2 professores (1 com turma de Ana).
    const mestreStudent = await makeStudent('mestreStudent', `Mestre Treinador ${SECRET.surname}`, { userId: orgA.userId });
    await graduate(mestreStudent.id, l3, 900);
    await prisma.user.update({ where: { id: orgA.userId }, data: { photo: `/api/uploads/mestre-${tag}.png` } });
    await makeUser('prof1', `Professora Um ${tag}`, OrgRole.PROFESSOR, orgAId, `/api/uploads/prof1-${tag}.png`);
    await makeUser('prof2', `Professor Dois ${tag}`, OrgRole.PROFESSOR, orgAId);
    await makeUser('profInativo', `Professor Inativo ${tag}`, null, orgAId);
    await prisma.organizationUser.create({ data: { organizationId: orgAId, userId: ids.profInativo, role: OrgRole.PROFESSOR, status: 'INACTIVE' } });

    // Alunos. Ana (aluno com login) é a MAIS ANTIGA do nível 1; outros 13 no nível 1 (14 no total > limite de 12).
    const anaUser = await makeUser('anaUser', `Ana Hierarquia ${SECRET.surname}`, OrgRole.ALUNO, orgAId);
    const ana = await makeStudent('ana', `Ana Hierarquia ${SECRET.surname}`, { userId: anaUser.id, photo: `/api/uploads/ana-${tag}.png` });
    await graduate(ana.id, l1, 800);
    for (let i = 1; i <= 13; i++) {
      const s = await makeStudent(`n1_${i}`, `Aluno${String(i).padStart(2, '0')} ${SECRET.surname}`);
      await graduate(s.id, l1, 100 - i);
    }
    const bia = await makeStudent('bia', `Bia Nivel Dois ${SECRET.surname}`);
    await graduate(bia.id, l2, 50);
    const cida = await makeStudent('cida', `Cida Nivel Dois ${SECRET.surname}`);
    await graduate(cida.id, l2, 40);
    await prisma.rankingProfile.create({ data: { studentId: cida.id, nickname: `Capi${tag.slice(-4)}` } });
    const dino = await makeStudent('dino', `Dino Nivel Tres ${SECRET.surname}`);
    await graduate(dino.id, l3, 30);
    const velho = await makeStudent('velho', `Velho Inativo ${SECRET.surname}`, { status: 'INACTIVE' });
    await graduate(velho.id, l3, 20);
    await makeStudent('novato', `Novato Sem Corda ${SECRET.surname}`);
    // Graduação antiga + nova da Bia: a ATUAL é a mais recente (nível 2), não a de maior ordem do histórico.
    await graduate(bia.id, l1, 400);

    // Turma da professora 1 com a Ana matriculada (ACTIVE); a do professor 2 tem a Bia (não a Ana).
    const cls1 = await prisma.class.create({ data: { organizationId: orgAId, name: `${tag} turma 1`, teacherUserId: ids.prof1 } });
    const cls2 = await prisma.class.create({ data: { organizationId: orgAId, name: `${tag} turma 2`, teacherUserId: ids.prof2 } });
    await prisma.classStudent.create({ data: { organizationId: orgAId, classId: cls1.id, studentId: ana.id } });
    await prisma.classStudent.create({ data: { organizationId: orgAId, classId: cls2.id, studentId: bia.id } });

    // Responsável pela Ana (e pela Bia? não: só a Ana) — com login.
    const carla = await makeUser('carla', `Carla Responsavel ${tag}`, OrgRole.RESPONSAVEL, orgAId);
    await prisma.studentGuardian.create({ data: { organizationId: orgAId, studentId: ana.id, userId: carla.id, name: carla.name } });

    // Grupo vizinho B: aluno graduado que NUNCA pode aparecer em A; e um aluno que olha a hierarquia de B.
    const orgBId = orgB.organizationId;
    const sysB = await prisma.graduationSystem.create({ data: { organizationId: orgBId, name: `${tag} sistema B` } });
    const lvlB = await prisma.graduationLevel.create({ data: { organizationId: orgBId, graduationSystemId: sysB.id, name: `${tag} Nivel B`, order: 1, color: '#FF0000', colors: ['#FF0000'] } });
    const forasteiro = await makeStudent('forasteiro', `${OTHER_GROUP} Silva`, { org: orgBId });
    await graduate(forasteiro.id, lvlB.id, 10, orgBId);

    // Tokens
    tokens.ana = (await loginAs(app, `anaUser-${tag}@hier.local`)).token;
    tokens.carla = (await loginAs(app, `carla-${tag}@hier.local`)).token;
    tokens.prof1 = (await loginAs(app, `prof1-${tag}@hier.local`)).token;
    tokens.mestre = orgA.token;
    tokens.mestreB = orgB.token;
  });

  after(async () => {
    const orgBId = orgB.organizationId;
    const allOrgs = [orgAId, orgBId];
    await prisma.classStudent.deleteMany({ where: { organizationId: { in: allOrgs } } });
    await prisma.class.deleteMany({ where: { organizationId: { in: allOrgs } } });
    await prisma.studentGraduation.deleteMany({ where: { organizationId: { in: allOrgs } } });
    await prisma.studentGuardian.deleteMany({ where: { organizationId: { in: allOrgs } } });
    await prisma.student.deleteMany({ where: { organizationId: { in: allOrgs } } }); // RankingProfile cai em cascata
    await prisma.graduationLevel.deleteMany({ where: { organizationId: { in: allOrgs } } });
    await prisma.graduationSystem.deleteMany({ where: { organizationId: { in: allOrgs } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await orgA.cleanup();
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('401 sem token', async () => {
    await api().get('/api/graduations/hierarchy').expect(401);
  });

  it('aluno (Ana): grupo, sistema, níveis do MAIS ALTO ao mais baixo, "me", contagens e Cache-Control privado', async () => {
    const res = await get('/api/graduations/hierarchy', tokens.ana).expect(200);
    assert.equal(res.headers['cache-control'], 'private, max-age=30');
    const h = res.body;
    assert.deepEqual(h.group, { id: orgAId, name: `Grupo Hier ${tag}`, logoUrl: `/api/uploads/logo-${tag}.png` });
    assert.deepEqual(h.system, { id: systemId, name: `${tag} sistema` });
    assert.deepEqual(h.levels.map((l: { id: number }) => l.id), [l3, l2, l1], 'maior order primeiro');
    assert.deepEqual(h.levels.map((l: { order: number }) => l.order), [3, 2, 1]);
    const top = h.levels[0];
    assert.deepEqual(Object.keys(top).sort(), ['color', 'colors', 'count', 'id', 'isMine', 'name', 'order', 'students', 'style', 'tipEnd', 'tipStart']);
    assert.deepEqual([top.style, top.colors, top.color], ['BRAIDED', ['#16A34A', '#FACC15', '#2563EB'], '#16A34A']);
    // Contagens: nível 3 = mestre-aluno + Dino (o inativo NÃO conta); nível 2 = Bia + Cida; nível 1 = Ana + 13 (Bia migrou p/ nível 2).
    assert.deepEqual(h.levels.map((l: { count: number }) => l.count), [2, 2, 14]);
    assert.deepEqual(h.levels.map((l: { isMine: boolean }) => l.isMine), [false, false, true]);
    // me
    assert.equal(h.me.studentId, ids.ana);
    assert.equal(h.me.photo, `/api/uploads/ana-${tag}.png`);
    assert.equal(h.me.order, 1);
    assert.equal(h.me.level.id, l1);
    assert.deepEqual(Object.keys(h.me.level).sort(), ['color', 'colors', 'id', 'name', 'order', 'style', 'tipEnd', 'tipStart']);
    assert.match(h.me.displayName, /^Ana [A-Z]\.$/, 'nome curto: primeiro nome + inicial do último sobrenome');
  });

  it('higherCount e totalStudents: alunos acima da Ana e total de ATIVOS do grupo', async () => {
    const h = (await get('/api/graduations/hierarchy', tokens.ana).expect(200)).body;
    assert.equal(h.higherCount, 4, 'mestre-aluno + Dino (nível 3) + Bia + Cida (nível 2)');
    // ativos: mestre-aluno, Ana, 13, Bia, Cida, Dino, Novato = 19 (Velho está INATIVO; Forasteiro é de outro grupo)
    assert.equal(h.totalStudents, 19);
    const dbActive = await prisma.student.count({ where: { organizationId: orgAId, status: 'ACTIVE' } });
    assert.equal(h.totalStudents, dbActive, '2ª via: contagem direta no banco');
  });

  it('limite de 12 alunos por nível, com a Ana (a mais antiga) SEMPRE incluída e marcada isMe', async () => {
    const h = (await get('/api/graduations/hierarchy', tokens.ana).expect(200)).body;
    const lvl1 = h.levels.find((l: { id: number }) => l.id === l1);
    assert.equal(lvl1.count, 14);
    assert.equal(lvl1.students.length, 12);
    const me = lvl1.students.filter((s: { isMe: boolean }) => s.isMe);
    assert.equal(me.length, 1);
    assert.equal(me[0].studentId, ids.ana);
    assert.equal(lvl1.students[0].studentId, ids.ana, 'o próprio aluno vem primeiro');
    assert.equal(new Set(lvl1.students.map((s: { studentId: number }) => s.studentId)).size, 12);
    // os demais níveis cabem inteiros
    assert.equal(h.levels[0].students.length, 2);
    assert.ok(h.levels[0].students.every((s: { isMe: boolean }) => !s.isMe));
  });

  it('nomes curtos / apelido, foto só do aluno e nada de contato, documento, nascimento ou nota', async () => {
    const res = await get('/api/graduations/hierarchy', tokens.ana).expect(200);
    const text = res.text;
    for (const secret of [SECRET.document, SECRET.phone, SECRET.email, SECRET.birth, SECRET.surname, `nota-${tag}`, '"email"', '"phone"', '"document"', '"birthDate"']) {
      assert.ok(!text.includes(secret), `vazou: ${secret}`);
    }
    const lvl2 = res.body.levels.find((l: { id: number }) => l.id === l2);
    const names = lvl2.students.map((s: { displayName: string }) => s.displayName).sort();
    assert.deepEqual(names, [`Capi${tag.slice(-4)}`, 'Bia S.'].sort(), 'Bia: nome curto; Cida: apelido do RankingProfile');
    assert.deepEqual(Object.keys(lvl2.students[0]).sort(), ['displayName', 'isMe', 'photo', 'studentId']);
    // Inativo (Velho) e aluno de outro grupo nunca aparecem
    assert.ok(!text.includes('Velho'));
    assert.ok(!text.includes(OTHER_GROUP));
    assert.ok(!text.includes(`${tag} sistema B`));
  });

  it('mestres e professores: nome/foto públicos, level pela graduação do Student ligado, isMyTeacher pela turma', async () => {
    const h = (await get('/api/graduations/hierarchy', tokens.ana).expect(200)).body;
    assert.equal(h.masters.length, 1);
    assert.equal(h.masters[0].id, orgA.userId);
    assert.equal(h.masters[0].photo, `/api/uploads/mestre-${tag}.png`);
    assert.equal(h.masters[0].level.id, l3, 'mestre que também treina mostra a sua corda');
    assert.deepEqual(Object.keys(h.masters[0]).sort(), ['displayName', 'id', 'level', 'photo']);
    // Professores ativos: 2 (o inativo e o sem vínculo não entram)
    assert.deepEqual(h.teachers.map((t: { id: number }) => t.id).sort(), [ids.prof1, ids.prof2].sort());
    const p1 = h.teachers.find((t: { id: number }) => t.id === ids.prof1);
    const p2 = h.teachers.find((t: { id: number }) => t.id === ids.prof2);
    assert.equal(p1.isMyTeacher, true, 'turma da professora 1 tem a Ana matriculada');
    assert.equal(p2.isMyTeacher, false);
    assert.equal(p1.photo, `/api/uploads/prof1-${tag}.png`);
    assert.equal(p1.level, null, 'professor sem Student ligado não tem corda');
    assert.ok(!JSON.stringify(h).includes('@hier.local'), 'sem e-mail de ninguém');
  });

  it('?studentId=: responsável escolhe o dependente; aluno sem vínculo / de outro grupo => 404; inexistente => 404', async () => {
    const dep = (await get(`/api/graduations/hierarchy?studentId=${ids.ana}`, tokens.carla).expect(200)).body;
    assert.equal(dep.me.studentId, ids.ana);
    assert.equal(dep.levels.find((l: { id: number }) => l.id === l1).students[0].isMe, true);
    // Carla sem studentId: o primeiro dependente ligado (Ana)
    assert.equal((await get('/api/graduations/hierarchy', tokens.carla).expect(200)).body.me.studentId, ids.ana);
    // sem vínculo
    await get(`/api/graduations/hierarchy?studentId=${ids.bia}`, tokens.carla).expect(404);
    await get(`/api/graduations/hierarchy?studentId=${ids.bia}`, tokens.ana).expect(404);
    // de outro grupo e inexistente: o MESMO 404
    await get(`/api/graduations/hierarchy?studentId=${ids.forasteiro}`, tokens.ana).expect(404);
    await get('/api/graduations/hierarchy?studentId=99999999', tokens.ana).expect(404);
    await get('/api/graduations/hierarchy?studentId=abc', tokens.ana).expect(400);
  });

  it('staff sem aluno ligado (professora) recebe a visão do grupo SEM "me" (nenhum nível isMine)', async () => {
    const h = (await get('/api/graduations/hierarchy', tokens.prof1).expect(200)).body;
    assert.equal(h.me, null);
    assert.equal(h.higherCount, 0);
    assert.deepEqual(h.system, { id: systemId, name: `${tag} sistema` }, 'primeiro sistema ATIVO do grupo (o inativo é ignorado)');
    assert.ok(h.levels.every((l: { isMine: boolean; students: Array<{ isMe: boolean }> }) => !l.isMine && l.students.every((s) => !s.isMe)));
    assert.deepEqual(h.levels.map((l: { count: number }) => l.count), [2, 2, 14]);
    // professora vê isMyTeacher=false para todos (não é aluna)
    assert.ok(h.teachers.every((t: { isMyTeacher: boolean }) => t.isMyTeacher === false));
  });

  it('isolamento: o MESTRE do grupo vizinho só vê o PRÓPRIO grupo; nada do grupo A vaza', async () => {
    const res = await get('/api/graduations/hierarchy', tokens.mestreB).expect(200);
    assert.equal(res.body.group.id, orgB.organizationId);
    assert.deepEqual(res.body.levels.map((l: { name: string }) => l.name), [`${tag} Nivel B`]);
    assert.equal(res.body.levels[0].count, 1);
    assert.equal(res.body.levels[0].students[0].displayName, `${OTHER_GROUP} S.`);
    for (const leak of [SECRET.surname, 'Ana ', 'Capi', `Grupo Hier ${tag}`, `"${tag} sistema"`, 'Professora Um']) {
      assert.ok(!res.text.includes(leak), `vazou do grupo A: ${leak}`);
    }
    assert.equal(res.body.masters.length, 1);
    assert.equal(res.body.masters[0].id, orgB.userId);
  });

  it('sem nenhum sistema ativo: system null, levels vazio, mas mestres/professores seguem', async () => {
    const emptyOrg = await createSecondOrg(app, prisma, `${tag}c`);
    try {
      const h = (await get('/api/graduations/hierarchy', emptyOrg.token).expect(200)).body;
      assert.equal(h.system, null);
      assert.deepEqual(h.levels, []);
      assert.equal(h.me, null);
      assert.equal(h.masters.length, 1);
      assert.equal(h.totalStudents, 0);
    } finally {
      await emptyOrg.cleanup();
    }
  });

  it('GET /graduations/templates: qualquer MEMBER lê (estático, sem dado pessoal); sem token 401', async () => {
    const res = await get('/api/graduations/templates', tokens.ana).expect(200);
    assert.ok(res.body.length >= 5);
    await api().get('/api/graduations/templates').expect(401);
  });

  it('o nome curto confere: primeiro nome + inicial do último sobrenome', async () => {
    // Ana Hierarquia <Sobrenomesecreto…> -> "Ana S."
    const h = (await get('/api/graduations/hierarchy', tokens.ana).expect(200)).body;
    assert.equal(h.me.displayName, 'Ana S.');
  });
});
