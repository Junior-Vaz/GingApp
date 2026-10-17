import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { DEV_PASSWORD, MESTRE_EMAIL, SecondOrg, createSecondOrg, loginAs } from './utils/list-helpers';

/**
 * E01/E05 mínimo: acesso (login) do aluno, responsáveis (StudentGuardian) e redefinição de senha pelo
 * Mestre. Tudo via HTTP real + conferência independente no Postgres (PrismaClient próprio). Fixtures:
 * alunos "[e2e-access] ..." e e-mails "@e2e-access.local", removidos no after().
 */
const TEMP_PASSWORD = 'Prov@Senha2026x';
const NEW_PASSWORD = 'Nova@Senha2026y';
const PROFESSOR_EMAIL = 'professor@gingabrasil.com.br';
const ALUNO_SEED_EMAIL = 'aluno@gingabrasil.com.br';
const PLATFORM_EMAIL = 'owner@gingapp.com.br';
const DOMAIN = '@e2e-access.local';

describe('Acesso do aluno, responsáveis e reset de senha (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestre: Awaited<ReturnType<typeof loginAs>>;
  let professorToken: string;
  let alunoSeedToken: string;
  let orgB: SecondOrg;
  let orgASlug: string;
  const stamp = `${Date.now()}`;
  let seq = 0;
  const email = (kind: string) => `${kind}-${stamp}-${++seq}${DOMAIN}`;

  // Contagens restritas às fixtures desta suíte (outros agentes/suítes mexem em User no mesmo banco).
  const countUsers = () => prisma.user.count({ where: { email: { endsWith: DOMAIN } } });
  const countMemberships = () => prisma.organizationUser.count({ where: { user: { email: { endsWith: DOMAIN } } } });
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function loginRaw(emailAddr: string, password: string, organizationSlug?: string) {
    return http().post('/api/auth/login').send({ email: emailAddr, password, organizationSlug });
  }
  async function loginToken(emailAddr: string, password: string): Promise<string> {
    const res = await loginRaw(emailAddr, password).expect(200);
    return res.body.accessToken;
  }
  async function newStudent(extra: Record<string, unknown> = {}): Promise<{ id: number; email?: string }> {
    const res = await http()
      .post('/api/students')
      .set(auth(mestre.token))
      .send({ name: `[e2e-access] Aluno ${++seq}`, ...extra })
      .expect(201);
    return res.body;
  }
  /** Usuário MEMBER direto no banco (sem passar pela API), para os cenários de "e-mail já existe". */
  async function makeUser(emailAddr: string, opts: { orgId?: number; role?: OrgRole; status?: string } = {}) {
    const user = await prisma.user.create({
      data: {
        email: emailAddr,
        passwordHash: await bcrypt.hash(DEV_PASSWORD, 4),
        name: `E2E access ${emailAddr}`,
        userType: 'MEMBER',
        status: 'ACTIVE',
      },
    });
    if (opts.orgId) {
      await prisma.organizationUser.create({
        data: { organizationId: opts.orgId, userId: user.id, role: opts.role ?? OrgRole.ALUNO, status: opts.status ?? 'ACTIVE' },
      });
    }
    return user;
  }

  before(async () => {
    app = await createTestApp();
    mestre = await loginAs(app, MESTRE_EMAIL);
    professorToken = (await loginAs(app, PROFESSOR_EMAIL)).token;
    alunoSeedToken = (await loginAs(app, ALUNO_SEED_EMAIL)).token;
    orgB = await createSecondOrg(app, prisma, 'access');
    orgASlug = (await prisma.organization.findUniqueOrThrow({ where: { id: mestre.organizationId } })).slug;
  });

  after(async () => {
    const students = await prisma.student.findMany({ where: { name: { startsWith: '[e2e-access]' } }, select: { id: true } });
    const studentIds = students.map((s) => s.id);
    await prisma.publicProfile.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.studentGuardian.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    const teachers = await prisma.user.findMany({ where: { name: { startsWith: '[e2e-access]' } }, select: { id: true } });
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    const userIds = [...users, ...teachers].map((u) => u.id);
    await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /students/:id/account', () => {
    it('cria o login do aluno: User + OrganizationUser ALUNO + Student.userId; login real e /students/me funcionam', async () => {
      const student = await newStudent();
      const loginEmail = email('aluno').toUpperCase().replace('@E2E-ACCESS.LOCAL', '@e2e-access.local'); // caixa mista no corpo
      const usersBefore = await countUsers();

      const res = await http()
        .post(`/api/students/${student.id}/account`)
        .set(auth(mestre.token))
        .send({ email: loginEmail, password: TEMP_PASSWORD })
        .expect(201);
      assert.equal(res.body.studentId, student.id);
      assert.equal(res.body.linkedExistingUser, false);
      assert.equal(res.body.account.role, 'ALUNO');
      assert.equal(res.body.account.mustChangePassword, true);
      assert.equal(res.body.account.email, loginEmail.toLowerCase());
      assert.ok(!JSON.stringify(res.body).includes(TEMP_PASSWORD), 'senha nunca volta na resposta');
      assert.ok(!('passwordHash' in res.body.account));

      // 2ª via independente: o que ficou no Postgres.
      assert.equal(await countUsers(), usersBefore + 1);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: res.body.account.userId } });
      assert.equal(user.email, loginEmail.toLowerCase());
      assert.equal(user.mustChangePassword, true);
      assert.equal(user.userType, 'MEMBER');
      assert.notEqual(user.passwordHash, TEMP_PASSWORD);
      const membership = await prisma.organizationUser.findFirstOrThrow({ where: { userId: user.id } });
      assert.equal(membership.organizationId, mestre.organizationId);
      assert.equal(membership.role, OrgRole.ALUNO);
      assert.equal(membership.status, 'ACTIVE');
      const persisted = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
      assert.equal(persisted.userId, user.id);

      // Login real do aluno criado (e-mail digitado em outra caixa) e acesso ao próprio vínculo.
      const login = await loginRaw(loginEmail.toUpperCase(), TEMP_PASSWORD).expect(200);
      assert.equal(login.body.user.role, 'ALUNO');
      assert.equal(login.body.user.organizationId, mestre.organizationId);
      assert.equal(login.body.user.mustChangePassword, true);
      // Senha provisória pendente: o servidor barra tudo (403 MUST_CHANGE_PASSWORD) até a troca da própria senha.
      const gated = await http().get('/api/students/me').set(auth(login.body.accessToken)).expect(403);
      assert.equal(gated.body.code, 'MUST_CHANGE_PASSWORD');
      const changed = await http()
        .post('/api/auth/change-password')
        .set(auth(login.body.accessToken))
        .send({ currentPassword: TEMP_PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);
      const me = await http().get('/api/students/me').set(auth(changed.body.accessToken)).expect(200);
      assert.deepEqual(
        me.body.map((s: { id: number }) => s.id),
        [student.id],
      );
      // Menor privilégio: o aluno continua sem acesso administrativo.
      await http().get('/api/students').set(auth(changed.body.accessToken)).expect(403);

      const account = await http().get(`/api/students/${student.id}/account`).set(auth(mestre.token)).expect(200);
      assert.equal(account.body.hasAccount, true);
      assert.equal(account.body.account.userId, user.id);
    });

    it('usa o e-mail do cadastro do aluno quando o corpo não traz e-mail', async () => {
      const e = email('cad');
      const student = await newStudent({ email: e });
      const res = await http()
        .post(`/api/students/${student.id}/account`)
        .set(auth(mestre.token))
        .send({ password: TEMP_PASSWORD })
        .expect(201);
      assert.equal(res.body.account.email, e);
      await loginRaw(e, TEMP_PASSWORD).expect(200);
    });

    it('é idempotente: segunda chamada devolve 409 claro e não cria nada', async () => {
      const student = await newStudent();
      await http().post(`/api/students/${student.id}/account`).set(auth(mestre.token)).send({ email: email('idem'), password: TEMP_PASSWORD }).expect(201);
      const usersBefore = await countUsers();
      const membershipsBefore = await countMemberships();
      const res = await http()
        .post(`/api/students/${student.id}/account`)
        .set(auth(mestre.token))
        .send({ email: email('idem2'), password: TEMP_PASSWORD })
        .expect(409);
      assert.equal(res.body.message, 'Este aluno já tem uma conta de acesso.');
      assert.equal(await countUsers(), usersBefore);
      assert.equal(await countMemberships(), membershipsBefore);
    });

    it('política de senha: curta, Dev@12345 e ausente (e-mail novo) => 400 e nada é criado', async () => {
      const student = await newStudent();
      const usersBefore = await countUsers();
      for (const password of ['curta', 'Dev@12345', 'xxDEV@12345xx']) {
        await http().post(`/api/students/${student.id}/account`).set(auth(mestre.token)).send({ email: email('pol'), password }).expect(400);
      }
      // (senha AUSENTE com e-mail novo não é mais erro: o servidor gera a provisória — ver students-quick-register.e2e-spec.ts)
      const semEmail = await http().post(`/api/students/${student.id}/account`).set(auth(mestre.token)).send({ password: TEMP_PASSWORD }).expect(400);
      assert.equal(semEmail.body.message, 'Informe o e-mail de acesso.');
      await http().post(`/api/students/${student.id}/account`).set(auth(mestre.token)).send({ email: 'nao-e-email', password: TEMP_PASSWORD }).expect(400);
      await http().post(`/api/students/${student.id}/account`).set(auth(mestre.token)).send({ email: email('pol'), password: TEMP_PASSWORD, userId: 1 }).expect(400);
      assert.equal(await countUsers(), usersBefore);
      assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).userId, null);
    });

    it('e-mail que já é usuário do sistema: só VINCULA (sem duplicar User, senha e nome intactos), mesmo em outra caixa', async () => {
      const existingEmail = email('existente');
      const existing = await makeUser(existingEmail);
      const student = await newStudent();
      const usersBefore = await countUsers();

      const res = await http()
        .post(`/api/students/${student.id}/account`)
        .set(auth(mestre.token))
        .send({ email: existingEmail.toUpperCase().replace('@E2E-ACCESS.LOCAL', '@E2E-ACCESS.local'), password: TEMP_PASSWORD })
        .expect(201);
      assert.equal(res.body.linkedExistingUser, true);
      assert.equal(res.body.account.userId, existing.id);
      assert.equal(await countUsers(), usersBefore, 'nunca duplica User');

      const after = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
      assert.equal(after.passwordHash, existing.passwordHash, 'a senha do usuário existente não muda');
      assert.equal(after.name, existing.name);
      assert.equal(after.mustChangePassword, false);
      const membership = await prisma.organizationUser.findFirstOrThrow({ where: { userId: existing.id, organizationId: mestre.organizationId } });
      assert.equal(membership.role, OrgRole.ALUNO);
      assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).userId, existing.id);
      // Continua entrando com a senha DELE (a provisória enviada foi ignorada).
      await loginRaw(existingEmail, DEV_PASSWORD).expect(200);
      await loginRaw(existingEmail, TEMP_PASSWORD).expect(401);
    });

    it('recusa 409: usuário já vinculado a outro aluno, PLATFORM/super admin e vínculo inativo', async () => {
      // já vinculado a outro aluno (o aluno do seed)
      const s1 = await newStudent();
      const dup = await http().post(`/api/students/${s1.id}/account`).set(auth(mestre.token)).send({ email: ALUNO_SEED_EMAIL }).expect(409);
      assert.equal(dup.body.message, 'Este usuário já está vinculado a outro aluno.');
      assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: s1.id } })).userId, null);

      const platform = await http().post(`/api/students/${s1.id}/account`).set(auth(mestre.token)).send({ email: PLATFORM_EMAIL, password: TEMP_PASSWORD }).expect(409);
      assert.equal(platform.body.message, 'Este e-mail não pode ser usado para criar um acesso.');

      const inactiveEmail = email('inativo');
      const inactive = await makeUser(inactiveEmail, { orgId: mestre.organizationId, role: OrgRole.ALUNO, status: 'INACTIVE' });
      const inat = await http().post(`/api/students/${s1.id}/account`).set(auth(mestre.token)).send({ email: inactiveEmail }).expect(409);
      assert.equal(inat.body.message, 'O vínculo deste usuário com o grupo está inativo.');
      assert.equal((await prisma.organizationUser.findFirstOrThrow({ where: { userId: inactive.id } })).status, 'INACTIVE');
    });

    it('RBAC: ALUNO 403; PROFESSOR pode (students.edit); sem token 401', async () => {
      const student = await newStudent();
      await http().post(`/api/students/${student.id}/account`).send({ email: email('rbac'), password: TEMP_PASSWORD }).expect(401);
      await http().post(`/api/students/${student.id}/account`).set(auth(alunoSeedToken)).send({ email: email('rbac'), password: TEMP_PASSWORD }).expect(403);
      await http().get(`/api/students/${student.id}/account`).set(auth(alunoSeedToken)).expect(403);
      await http().post(`/api/students/${student.id}/reset-password`).set(auth(alunoSeedToken)).send({ newPassword: NEW_PASSWORD }).expect(403);
      await http().get(`/api/students/${student.id}/guardians`).set(auth(alunoSeedToken)).expect(403);
      await http().post(`/api/students/${student.id}/guardians`).set(auth(alunoSeedToken)).send({ name: 'Fulano' }).expect(403);
      assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).userId, null);
      await http().post(`/api/students/${student.id}/account`).set(auth(professorToken)).send({ email: email('rbac'), password: TEMP_PASSWORD }).expect(201);
    });

    it('isolamento multi-tenant: o Mestre de outro grupo recebe 404 em tudo e nada muda', async () => {
      const student = await newStudent();
      const created = await http().post(`/api/students/${student.id}/account`).set(auth(mestre.token)).send({ email: email('iso'), password: TEMP_PASSWORD }).expect(201);
      const guardian = await http().post(`/api/students/${student.id}/guardians`).set(auth(mestre.token)).send({ name: 'Responsavel Iso' }).expect(201);
      const gid = guardian.body.guardian.id;
      const before = await prisma.user.findUniqueOrThrow({ where: { id: created.body.account.userId } });

      const b = auth(orgB.token);
      await http().get(`/api/students/${student.id}/account`).set(b).expect(404);
      await http().post(`/api/students/${student.id}/account`).set(b).send({ email: email('iso-b'), password: TEMP_PASSWORD }).expect(404);
      await http().post(`/api/students/${student.id}/reset-password`).set(b).send({ newPassword: NEW_PASSWORD }).expect(404);
      await http().get(`/api/students/${student.id}/guardians`).set(b).expect(404);
      await http().post(`/api/students/${student.id}/guardians`).set(b).send({ name: 'Intruso' }).expect(404);
      await http().patch(`/api/students/${student.id}/guardians/${gid}`).set(b).send({ name: 'Intruso' }).expect(404);
      await http().delete(`/api/students/${student.id}/guardians/${gid}`).set(b).expect(404);
      await http().post(`/api/students/${student.id}/guardians/${gid}/account`).set(b).send({ email: email('iso-b'), password: TEMP_PASSWORD }).expect(404);
      await http().post(`/api/students/${student.id}/guardians/${gid}/reset-password`).set(b).send({ newPassword: NEW_PASSWORD }).expect(404);

      const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: created.body.account.userId } });
      assert.equal(unchanged.passwordHash, before.passwordHash);
      assert.equal(await prisma.studentGuardian.count({ where: { studentId: student.id } }), 1);
      assert.equal((await prisma.studentGuardian.findUniqueOrThrow({ where: { id: gid } })).name, 'Responsavel Iso');
      // O guardianId do grupo A usado com um aluno do grupo B (path misto) também é 404.
      const studentB = await prisma.student.create({ data: { organizationId: orgB.organizationId, name: '[e2e-access] Aluno B' } });
      await http().patch(`/api/students/${studentB.id}/guardians/${gid}`).set(b).send({ name: 'Intruso' }).expect(404);
    });
  });

  describe('POST /students/:id/reset-password', () => {
    it('redefine a senha, revoga sessões antigas, exige troca e a troca limpa a flag', async () => {
      const student = await newStudent();
      const e = email('reset');
      await http().post(`/api/students/${student.id}/account`).set(auth(mestre.token)).send({ email: e, password: TEMP_PASSWORD }).expect(201);
      const oldToken = await loginToken(e, TEMP_PASSWORD);
      // (a conta nasce com senha provisória: só /auth/me responde 200; o resto é 403 até a troca)
      await http().get('/api/auth/me').set(auth(oldToken)).expect(200);

      // senha fraca / corpo inválido
      await http().post(`/api/students/${student.id}/reset-password`).set(auth(mestre.token)).send({ newPassword: 'curta' }).expect(400);
      await http().post(`/api/students/${student.id}/reset-password`).set(auth(mestre.token)).send({ newPassword: 'Dev@12345' }).expect(400);
      // (newPassword AUSENTE não é mais erro: o servidor gera a provisória — ver students-quick-register.e2e-spec.ts)
      await http().post(`/api/students/${student.id}/reset-password`).set(auth(mestre.token)).send({ newPassword: 123456789012 }).expect(400);
      await http().get('/api/auth/me').set(auth(oldToken)).expect(200); // nada mudou

      const res = await http().post(`/api/students/${student.id}/reset-password`).set(auth(mestre.token)).send({ newPassword: NEW_PASSWORD }).expect(204);
      assert.equal(res.text, '');

      await http().get('/api/auth/me').set(auth(oldToken)).expect(401); // sessão revogada
      await loginRaw(e, TEMP_PASSWORD).expect(401);
      const login = await loginRaw(e, NEW_PASSWORD).expect(200);
      assert.equal(login.body.user.mustChangePassword, true);
      await http().get('/api/auth/me').set(auth(login.body.accessToken)).expect(200);
      await http().get('/api/students/me').set(auth(login.body.accessToken)).expect(403); // exige a troca antes

      // A troca da PRÓPRIA senha limpa a flag.
      await http().post('/api/auth/change-password').set(auth(login.body.accessToken)).send({ currentPassword: NEW_PASSWORD, newPassword: 'Definitiva@2026z' }).expect(200);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: e } });
      assert.equal(user.mustChangePassword, false);
      const again = await loginRaw(e, 'Definitiva@2026z').expect(200);
      assert.equal(again.body.user.mustChangePassword, false);
    });

    it('aluno sem conta => 409; conta de equipe (PROFESSOR) via rota de aluno => 403; conta de outro grupo => 409', async () => {
      const semConta = await newStudent();
      const r1 = await http().post(`/api/students/${semConta.id}/reset-password`).set(auth(mestre.token)).send({ newPassword: NEW_PASSWORD }).expect(409);
      assert.equal(r1.body.message, 'Este aluno ainda não tem conta de acesso.');

      // Aluno ligado a um usuário PROFESSOR do grupo (fixture própria, nunca o professor do seed): esta rota não
      // pode redefinir a senha de quem é da equipe.
      const staffEmail = email('equipe');
      const staffUser = await makeUser(staffEmail, { orgId: mestre.organizationId, role: OrgRole.PROFESSOR });
      const linkedToStaff = await newStudent();
      await http().post(`/api/students/${linkedToStaff.id}/account`).set(auth(mestre.token)).send({ email: staffEmail }).expect(201);
      const r2 = await http().post(`/api/students/${linkedToStaff.id}/reset-password`).set(auth(professorToken)).send({ newPassword: NEW_PASSWORD }).expect(403);
      assert.match(r2.body.message, /equipe do grupo/);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: staffUser.id } })).passwordHash, staffUser.passwordHash);
      await loginRaw(staffEmail, DEV_PASSWORD).expect(200);
      // O vínculo não rebaixou o papel do professor.
      assert.equal((await prisma.organizationUser.findFirstOrThrow({ where: { userId: staffUser.id, organizationId: mestre.organizationId } })).role, OrgRole.PROFESSOR);

      // Conta que também pertence a outro grupo: a senha é do usuário => recusa.
      const sharedEmail = email('shared');
      const shared = await makeUser(sharedEmail, { orgId: orgB.organizationId, role: OrgRole.PROFESSOR });
      const sharedStudent = await newStudent();
      await http().post(`/api/students/${sharedStudent.id}/account`).set(auth(mestre.token)).send({ email: sharedEmail }).expect(201);
      const r3 = await http().post(`/api/students/${sharedStudent.id}/reset-password`).set(auth(mestre.token)).send({ newPassword: NEW_PASSWORD }).expect(409);
      assert.match(r3.body.message, /outro grupo/);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: shared.id } })).passwordHash, shared.passwordHash);
      await loginRaw(sharedEmail, DEV_PASSWORD, orgASlug).expect(200); // usuário em 2 grupos: precisa do slug
    });
  });

  describe('Responsáveis: /students/:id/guardians', () => {
    it('CRUD sem login: cria, lista, edita (null limpa), consentimento só leitura, remove', async () => {
      const student = await newStudent();
      const created = await http()
        .post(`/api/students/${student.id}/guardians`)
        .set(auth(mestre.token))
        .send({ name: 'Maria Responsavel', relationship: 'Mãe', phone: '11999990000', email: email('mae') })
        .expect(201);
      const g = created.body.guardian;
      assert.equal(g.hasAccount, false);
      assert.equal(g.account, null);
      assert.equal(g.consentPublicProfile, false);
      assert.equal(g.relationship, 'Mãe');

      const row = await prisma.studentGuardian.findUniqueOrThrow({ where: { id: g.id } });
      assert.equal(row.organizationId, mestre.organizationId);
      assert.equal(row.studentId, student.id);
      assert.equal(row.userId, null);
      assert.equal(row.consentPublicProfile, false);

      // consentimento NÃO pode ser setado pelo painel (whitelist global => 400) e a coluna segue false.
      await http().post(`/api/students/${student.id}/guardians`).set(auth(mestre.token)).send({ name: 'Fraude', consentPublicProfile: true }).expect(400);
      await http().patch(`/api/students/${student.id}/guardians/${g.id}`).set(auth(mestre.token)).send({ consentPublicProfile: true }).expect(400);
      await http().patch(`/api/students/${student.id}/guardians/${g.id}`).set(auth(mestre.token)).send({ userId: 1 }).expect(400);
      assert.equal((await prisma.studentGuardian.findUniqueOrThrow({ where: { id: g.id } })).consentPublicProfile, false);
      assert.equal(await prisma.studentGuardian.count({ where: { studentId: student.id } }), 1);

      const patched = await http()
        .patch(`/api/students/${student.id}/guardians/${g.id}`)
        .set(auth(mestre.token))
        .send({ name: 'Maria Silva', phone: null, relationship: 'Avó' })
        .expect(200);
      assert.equal(patched.body.name, 'Maria Silva');
      assert.equal(patched.body.phone, null);
      assert.equal(patched.body.relationship, 'Avó');
      await http().patch(`/api/students/${student.id}/guardians/${g.id}`).set(auth(mestre.token)).send({ name: null }).expect(400);
      await http().patch(`/api/students/${student.id}/guardians/${g.id}`).set(auth(mestre.token)).send({ name: 'M' }).expect(400);

      const list = await http().get(`/api/students/${student.id}/guardians`).set(auth(mestre.token)).expect(200);
      assert.deepEqual(list.body.map((x: { id: number }) => x.id), [g.id]);

      await http().delete(`/api/students/${student.id}/guardians/${g.id}`).set(auth(mestre.token)).expect(204);
      assert.equal(await prisma.studentGuardian.count({ where: { id: g.id } }), 0);
      await http().delete(`/api/students/${student.id}/guardians/${g.id}`).set(auth(mestre.token)).expect(404);
      await http().get(`/api/students/99999999/guardians`).set(auth(mestre.token)).expect(404);
    });

    it('createAccount: cria o login RESPONSAVEL; login real e acesso ao dependente em /students/me; reset de senha', async () => {
      const student = await newStudent();
      const gEmail = email('resp');
      const res = await http()
        .post(`/api/students/${student.id}/guardians`)
        .set(auth(mestre.token))
        .send({ name: 'Joao Responsavel', email: gEmail, createAccount: true, password: TEMP_PASSWORD })
        .expect(201);
      assert.equal(res.body.linkedExistingUser, false);
      assert.equal(res.body.guardian.hasAccount, true);
      assert.equal(res.body.guardian.account.mustChangePassword, true);
      assert.equal(res.body.guardian.consentPublicProfile, false);
      assert.ok(!JSON.stringify(res.body).includes(TEMP_PASSWORD));

      const user = await prisma.user.findUniqueOrThrow({ where: { email: gEmail } });
      const membership = await prisma.organizationUser.findFirstOrThrow({ where: { userId: user.id } });
      assert.equal(membership.role, OrgRole.RESPONSAVEL);
      assert.equal(membership.organizationId, mestre.organizationId);
      const row = await prisma.studentGuardian.findUniqueOrThrow({ where: { id: res.body.guardian.id } });
      assert.equal(row.userId, user.id);

      const login = await loginRaw(gEmail, TEMP_PASSWORD).expect(200);
      assert.equal(login.body.user.role, 'RESPONSAVEL');
      assert.equal(login.body.user.mustChangePassword, true);
      await http().get('/api/students/me').set(auth(login.body.accessToken)).expect(403); // senha provisória pendente
      const changed = await http()
        .post('/api/auth/change-password')
        .set(auth(login.body.accessToken))
        .send({ currentPassword: TEMP_PASSWORD, newPassword: 'Troca@Intermed2026q' })
        .expect(200);
      const me = await http().get('/api/students/me').set(auth(changed.body.accessToken)).expect(200);
      assert.deepEqual(me.body.map((s: { id: number }) => s.id), [student.id]);
      await http().get('/api/students').set(auth(changed.body.accessToken)).expect(403);

      // Responsável duplicado (mesmo usuário) no mesmo aluno => 409.
      const dup = await http().post(`/api/students/${student.id}/guardians`).set(auth(mestre.token)).send({ name: 'Joao de novo', email: gEmail, createAccount: true }).expect(409);
      assert.equal(dup.body.message, 'Este usuário já é responsável por este aluno.');
      assert.equal(await prisma.studentGuardian.count({ where: { studentId: student.id } }), 1, 'a transação desfez o segundo registro');

      // Reset de senha do responsável: revoga a sessão e troca a senha.
      await http().post(`/api/students/${student.id}/guardians/${res.body.guardian.id}/reset-password`).set(auth(mestre.token)).send({ newPassword: 'curta' }).expect(400);
      await http().post(`/api/students/${student.id}/guardians/${res.body.guardian.id}/reset-password`).set(auth(mestre.token)).send({ newPassword: NEW_PASSWORD }).expect(204);
      await http().get('/api/students/me').set(auth(login.body.accessToken)).expect(401);
      await loginRaw(gEmail, TEMP_PASSWORD).expect(401);
      await loginRaw(gEmail, NEW_PASSWORD).expect(200);
    });

    it('validações do createAccount e acesso criado depois (POST .../account); 409 se já tem conta; vincula usuário existente', async () => {
      const student = await newStudent();
      // createAccount sem e-mail => 400, e nada é criado
      const usersBefore = await countUsers();
      await http().post(`/api/students/${student.id}/guardians`).set(auth(mestre.token)).send({ name: 'Sem Email', createAccount: true, password: TEMP_PASSWORD }).expect(400);
      // senha sem createAccount => 400
      await http().post(`/api/students/${student.id}/guardians`).set(auth(mestre.token)).send({ name: 'Sem Flag', password: TEMP_PASSWORD }).expect(400);
      // e-mail novo sem senha / senha fraca
      await http().post(`/api/students/${student.id}/guardians`).set(auth(mestre.token)).send({ name: 'Sem Senha', email: email('x'), createAccount: true }).expect(400);
      await http().post(`/api/students/${student.id}/guardians`).set(auth(mestre.token)).send({ name: 'Fraca', email: email('x'), createAccount: true, password: 'Dev@12345' }).expect(400);
      assert.equal(await countUsers(), usersBefore);
      assert.equal(await prisma.studentGuardian.count({ where: { studentId: student.id } }), 0);

      // Responsável cadastrado sem login e acesso criado depois.
      const gEmail = email('depois');
      const g = (await http().post(`/api/students/${student.id}/guardians`).set(auth(mestre.token)).send({ name: 'Cadastro Primeiro', email: gEmail }).expect(201)).body.guardian;
      const acc = await http().post(`/api/students/${student.id}/guardians/${g.id}/account`).set(auth(mestre.token)).send({ password: TEMP_PASSWORD }).expect(201);
      assert.equal(acc.body.guardian.hasAccount, true);
      await loginRaw(gEmail, TEMP_PASSWORD).expect(200);
      const again = await http().post(`/api/students/${student.id}/guardians/${g.id}/account`).set(auth(mestre.token)).send({ password: TEMP_PASSWORD }).expect(409);
      assert.equal(again.body.message, 'Este responsável já tem uma conta de acesso.');

      // Mesmo responsável (usuário) para um 2º aluno: VINCULA o User existente, sem duplicar nem trocar a senha.
      const student2 = await newStudent();
      const before = await prisma.user.findUniqueOrThrow({ where: { email: gEmail } });
      const usersMid = await countUsers();
      const second = await http()
        .post(`/api/students/${student2.id}/guardians`)
        .set(auth(mestre.token))
        .send({ name: 'Cadastro Primeiro', email: gEmail, createAccount: true, password: NEW_PASSWORD })
        .expect(201);
      assert.equal(second.body.linkedExistingUser, true);
      assert.equal(await countUsers(), usersMid);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { email: gEmail } })).passwordHash, before.passwordHash);
      const provisional = await loginToken(gEmail, TEMP_PASSWORD);
      const changedGuardian = await http()
        .post('/api/auth/change-password')
        .set(auth(provisional))
        .send({ currentPassword: TEMP_PASSWORD, newPassword: 'Troca@Responsavel2026r' })
        .expect(200);
      const token = changedGuardian.body.accessToken as string;
      const me = await http().get('/api/students/me').set(auth(token)).expect(200);
      assert.deepEqual(me.body.map((s: { id: number }) => s.id).sort(), [student.id, student2.id].sort());

      // O próprio aluno não vira responsável de si mesmo.
      const own = await newStudent();
      const ownEmail = email('proprio');
      await http().post(`/api/students/${own.id}/account`).set(auth(mestre.token)).send({ email: ownEmail, password: TEMP_PASSWORD }).expect(201);
      await http().post(`/api/students/${own.id}/guardians`).set(auth(mestre.token)).send({ name: 'Eu mesmo', email: ownEmail, createAccount: true }).expect(409);
    });

    it('remover o responsável que deu o consentimento despublica o perfil público e limpa a referência', async () => {
      const student = await newStudent();
      const g = (await http().post(`/api/students/${student.id}/guardians`).set(auth(mestre.token)).send({ name: 'Quem Consentiu' }).expect(201)).body.guardian;
      // Estado criado pelo fluxo do Passaporte (aqui direto no banco): perfil publicado com consentimento deste responsável.
      await prisma.studentGuardian.update({ where: { id: g.id }, data: { consentPublicProfile: true } });
      await prisma.publicProfile.create({
        data: { organizationId: mestre.organizationId, studentId: student.id, displayName: 'x', isPublished: true, consentByGuardianId: g.id },
      });
      await http().delete(`/api/students/${student.id}/guardians/${g.id}`).set(auth(mestre.token)).expect(204);
      const profile = await prisma.publicProfile.findUniqueOrThrow({ where: { studentId: student.id } });
      assert.equal(profile.isPublished, false);
      assert.equal(profile.consentByGuardianId, null);
      assert.equal(await prisma.studentGuardian.count({ where: { id: g.id } }), 0);
    });
  });

  describe('POST /teachers/:id/reset-password (E05 mínimo)', () => {
    async function newTeacher(role: OrgRole = OrgRole.PROFESSOR) {
      const e = email('prof');
      const res = await http()
        .post('/api/teachers')
        .set(auth(mestre.token))
        .send({ name: '[e2e-access] Professor', email: e, password: TEMP_PASSWORD, role })
        .expect(201);
      return { id: res.body.id as number, userId: res.body.user.id as number, email: e };
    }

    it('MESTRE redefine a senha do professor: 204, sessão antiga revogada, senha nova funciona e exige troca', async () => {
      const t = await newTeacher();
      const oldToken = await loginToken(t.email, TEMP_PASSWORD);
      await http().get('/api/students').set(auth(oldToken)).expect(200);

      await http().post(`/api/teachers/${t.id}/reset-password`).set(auth(mestre.token)).send({ newPassword: 'curta' }).expect(400);
      await http().post(`/api/teachers/${t.id}/reset-password`).set(auth(mestre.token)).send({ newPassword: 'Dev@12345' }).expect(400);
      await http().get('/api/students').set(auth(oldToken)).expect(200); // nada mudou

      await http().post(`/api/teachers/${t.id}/reset-password`).set(auth(mestre.token)).send({ newPassword: NEW_PASSWORD }).expect(204);
      await http().get('/api/students').set(auth(oldToken)).expect(401);
      await loginRaw(t.email, TEMP_PASSWORD).expect(401);
      const login = await loginRaw(t.email, NEW_PASSWORD).expect(200);
      assert.equal(login.body.user.mustChangePassword, true);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: t.userId } })).mustChangePassword, true);
    });

    it('recusas: PROFESSOR (sem teachers.edit) 403, alvo MESTRE 403, outro grupo 404, conta compartilhada 409, id inexistente 404', async () => {
      const t = await newTeacher();
      await http().post(`/api/teachers/${t.id}/reset-password`).set(auth(professorToken)).send({ newPassword: NEW_PASSWORD }).expect(403);
      await http().post(`/api/teachers/${t.id}/reset-password`).set(auth(alunoSeedToken)).send({ newPassword: NEW_PASSWORD }).expect(403);
      await http().post(`/api/teachers/${t.id}/reset-password`).send({ newPassword: NEW_PASSWORD }).expect(401);
      await loginRaw(t.email, TEMP_PASSWORD).expect(200);

      const outroMestre = await newTeacher(OrgRole.MESTRE);
      const r = await http().post(`/api/teachers/${outroMestre.id}/reset-password`).set(auth(mestre.token)).send({ newPassword: NEW_PASSWORD }).expect(403);
      assert.match(r.body.message, /equipe GingApp/);
      await loginRaw(outroMestre.email, TEMP_PASSWORD).expect(200);

      // Mestre do grupo B tentando o professor do grupo A => 404.
      await http().post(`/api/teachers/${t.id}/reset-password`).set(auth(orgB.token)).send({ newPassword: NEW_PASSWORD }).expect(404);
      await loginRaw(t.email, TEMP_PASSWORD).expect(200);

      // Aluno (não-equipe) do próprio grupo pelo id da membership dele => 404 (nem é professor).
      const alunoMembership = await prisma.organizationUser.findFirstOrThrow({ where: { user: { email: ALUNO_SEED_EMAIL } } });
      await http().post(`/api/teachers/${alunoMembership.id}/reset-password`).set(auth(mestre.token)).send({ newPassword: NEW_PASSWORD }).expect(404);
      await http().post('/api/teachers/99999999/reset-password').set(auth(mestre.token)).send({ newPassword: NEW_PASSWORD }).expect(404);

      // Professor que também pertence a outro grupo: a senha é do usuário => 409.
      await prisma.organizationUser.create({ data: { organizationId: orgB.organizationId, userId: t.userId, role: OrgRole.ALUNO, status: 'ACTIVE' } });
      const shared = await http().post(`/api/teachers/${t.id}/reset-password`).set(auth(mestre.token)).send({ newPassword: NEW_PASSWORD }).expect(409);
      assert.match(shared.body.message, /outro grupo/);
      await loginRaw(t.email, TEMP_PASSWORD, orgASlug).expect(200); // usuário em 2 grupos: precisa do slug
    });
  });
});
