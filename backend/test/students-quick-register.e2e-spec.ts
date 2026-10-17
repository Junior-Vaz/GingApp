import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { DEV_PASSWORD, MESTRE_EMAIL, SecondOrg, createSecondOrg, loginAs } from './utils/list-helpers';

/**
 * Cadastro rápido do aluno: POST /students com `createAccess` (login já criado, senha provisória FÁCIL gerada pelo servidor)
 * e `classIds` (já matriculado), mais `password`/`newPassword` OPCIONAIS em POST /students/:id/account e nos resets de senha
 * de aluno/responsável. HTTP real + 2ª via independente no Postgres. A senha provisória só pode existir na resposta HTTP:
 * conferimos que NÃO aparece no AuditLog nem na saída (stdout/stderr) do processo. Fixtures "[e2e-qr] ..." e e-mails
 * "@e2e-qr.local", removidos no after(). A única mexida na matriz de permissões (INSTRUTOR students.edit) é restaurada.
 */
const DOMAIN = '@e2e-qr.local';
const PASSWORD_SHAPE = /^[A-Z][a-z]+[A-Z][a-z]+[2-9]{2}$/;
const NEW_PASSWORD = 'Nova@Senha2026y';
const PLATFORM_EMAIL = 'owner@gingapp.com.br';
const ALUNO_SEED_EMAIL = 'aluno@gingabrasil.com.br';

describe('Cadastro rápido de aluno: acesso com senha provisória gerada + turmas (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestre: Awaited<ReturnType<typeof loginAs>>;
  let alunoSeedToken: string;
  let orgB: SecondOrg;
  let orgId: number;
  let unitA: number;
  let unitB: number;
  let classA1: number;
  let classA2: number;
  let classUnitB: number;
  let classOtherOrg: number;
  let profScopedToken: string;
  let instrutorToken: string;
  let monitorToken: string;
  const stamp = `${Date.now()}`;
  let seq = 0;
  const email = (kind: string) => `${kind}-${stamp}-${++seq}${DOMAIN}`;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const studentsNamed = (name: string) => prisma.student.count({ where: { name } });
  const loginRaw = (emailAddr: string, password: string) => http().post('/api/auth/login').send({ email: emailAddr, password });

  /** Captura TUDO o que o processo escreve em stdout/stderr enquanto `fn` roda (para provar que a senha nunca vai a log). */
  async function captureOutput<T>(fn: () => Promise<T>): Promise<{ result: T; output: string }> {
    let output = '';
    const out = process.stdout.write.bind(process.stdout);
    const err = process.stderr.write.bind(process.stderr);
    const grab = (orig: typeof process.stdout.write) =>
      ((chunk: unknown, ...rest: unknown[]) => {
        output += typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8');
        return (orig as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof process.stdout.write;
    process.stdout.write = grab(out);
    process.stderr.write = grab(err);
    try {
      return { result: await fn(), output };
    } finally {
      process.stdout.write = out;
      process.stderr.write = err;
    }
  }

  /** Nenhuma linha de auditoria do grupo (recente) pode conter a senha provisória em claro. */
  async function assertPasswordNotAudited(secret: string): Promise<void> {
    const rows = await prisma.auditLog.findMany({ where: { organizationId: orgId }, orderBy: { id: 'desc' }, take: 300 });
    assert.ok(!JSON.stringify(rows).includes(secret), 'a senha provisória apareceu no AuditLog');
  }

  async function makeUser(emailAddr: string, role: OrgRole, extra: { unitIds?: number[] } = {}) {
    const user = await prisma.user.create({
      data: {
        email: emailAddr,
        passwordHash: await bcrypt.hash(DEV_PASSWORD, 4),
        name: `[e2e-qr] ${emailAddr}`,
        userType: 'MEMBER',
        status: 'ACTIVE',
      },
    });
    await prisma.organizationUser.create({ data: { organizationId: orgId, userId: user.id, role, status: 'ACTIVE' } });
    for (const unitId of extra.unitIds ?? []) {
      await prisma.userUnitAccess.create({ data: { organizationId: orgId, userId: user.id, unitId } });
    }
    return user;
  }
  const tokenOf = async (emailAddr: string) => (await loginRaw(emailAddr, DEV_PASSWORD).expect(200)).body.accessToken as string;

  before(async () => {
    app = await createTestApp();
    mestre = await loginAs(app, MESTRE_EMAIL);
    orgId = mestre.organizationId;
    alunoSeedToken = (await loginAs(app, ALUNO_SEED_EMAIL)).token;
    orgB = await createSecondOrg(app, prisma, 'qr');
    unitA = (await prisma.unit.create({ data: { organizationId: orgId, name: '[e2e-qr] Unidade A' } })).id;
    unitB = (await prisma.unit.create({ data: { organizationId: orgId, name: '[e2e-qr] Unidade B' } })).id;
    classA1 = (await prisma.class.create({ data: { organizationId: orgId, name: '[e2e-qr] Turma 1', unitId: unitA } })).id;
    classA2 = (await prisma.class.create({ data: { organizationId: orgId, name: '[e2e-qr] Turma 2' } })).id;
    classUnitB = (await prisma.class.create({ data: { organizationId: orgId, name: '[e2e-qr] Turma da B', unitId: unitB } })).id;
    classOtherOrg = (await prisma.class.create({ data: { organizationId: orgB.organizationId, name: '[e2e-qr] Turma alheia' } })).id;
    const profEmail = email('prof');
    await makeUser(profEmail, OrgRole.PROFESSOR, { unitIds: [unitA] });
    profScopedToken = await tokenOf(profEmail);
    const instrEmail = email('instrutor');
    await makeUser(instrEmail, OrgRole.INSTRUTOR);
    instrutorToken = await tokenOf(instrEmail);
    const monEmail = email('monitor');
    await makeUser(monEmail, OrgRole.MONITOR);
    monitorToken = await tokenOf(monEmail);
  });

  after(async () => {
    // Garante a matriz de permissões original mesmo se um teste falhou no meio.
    await prisma.rolePermission.updateMany({ where: { role: OrgRole.INSTRUTOR, resource: 'students' }, data: { canEdit: true } });
    const students = await prisma.student.findMany({ where: { name: { startsWith: '[e2e-qr]' } }, select: { id: true } });
    const studentIds = students.map((s) => s.id);
    const classIds = [classA1, classA2, classUnitB, classOtherOrg];
    await prisma.classStudent.deleteMany({ where: { OR: [{ classId: { in: classIds } }, { studentId: { in: studentIds } }] } });
    await prisma.studentGuardian.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    await prisma.class.deleteMany({ where: { id: { in: classIds } } });
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    await prisma.userUnitAccess.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.unit.deleteMany({ where: { id: { in: [unitA, unitB] } } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('sanidade do teste: captureOutput realmente enxerga o que o processo escreve em stdout/stderr', async () => {
    const { output } = await captureOutput(async () => {
      process.stdout.write('sonda-stdout-xyz\n');
      process.stderr.write('sonda-stderr-xyz\n');
    });
    assert.ok(output.includes('sonda-stdout-xyz') && output.includes('sonda-stderr-xyz'));
  });

  describe('POST /students com createAccess + classIds', () => {
    it('cria aluno + login (senha provisória fácil) + matrículas; a senha FAZ LOGIN e exige troca; nunca em AuditLog nem em log', async () => {
      const e = email('feliz');
      const name = '[e2e-qr] Aluno feliz';
      const { result: res, output } = await captureOutput(() =>
        http().post('/api/students').set(auth(mestre.token)).send({ name, email: e.toUpperCase().replace(DOMAIN.toUpperCase(), DOMAIN), createAccess: true, classIds: [classA1, classA2] }).expect(201),
      );
      const access = res.body.access;
      assert.equal(access.status, 'CREATED');
      assert.equal(access.email, e);
      assert.equal(access.mustChangePassword, true);
      assert.match(access.temporaryPassword, PASSWORD_SHAPE);
      assert.equal(access.reason, undefined);
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.equal(res.body.name, name);
      assert.ok(res.body.id);

      // 2ª via: o que ficou no Postgres.
      const student = await prisma.student.findUniqueOrThrow({ where: { id: res.body.id } });
      assert.ok(student.userId, 'Student.userId preenchido');
      const user = await prisma.user.findUniqueOrThrow({ where: { id: student.userId! } });
      assert.equal(user.email, e);
      assert.equal(user.mustChangePassword, true);
      assert.notEqual(user.passwordHash, access.temporaryPassword);
      assert.ok(await bcrypt.compare(access.temporaryPassword, user.passwordHash), 'o hash é da senha devolvida');
      const membership = await prisma.organizationUser.findFirstOrThrow({ where: { userId: user.id } });
      assert.equal(membership.role, OrgRole.ALUNO);
      assert.equal(membership.organizationId, orgId);
      const enrollments = await prisma.classStudent.findMany({ where: { studentId: student.id }, orderBy: { classId: 'asc' } });
      assert.deepEqual(enrollments.map((r) => [r.classId, r.status, r.organizationId]), [
        [classA1, 'ACTIVE', orgId],
        [classA2, 'ACTIVE', orgId],
      ].sort((a, b) => (a[0] as number) - (b[0] as number)));

      // Login real com a senha gerada + troca obrigatória imposta no servidor.
      const login = await loginRaw(e, access.temporaryPassword).expect(200);
      assert.equal(login.body.user.role, 'ALUNO');
      assert.equal(login.body.user.mustChangePassword, true);
      const gated = await http().get('/api/students/me').set(auth(login.body.accessToken)).expect(403);
      assert.equal(gated.body.code, 'MUST_CHANGE_PASSWORD');
      const changed = await http()
        .post('/api/auth/change-password')
        .set(auth(login.body.accessToken))
        .send({ currentPassword: access.temporaryPassword, newPassword: NEW_PASSWORD })
        .expect(200);
      const me = await http().get('/api/students/me').set(auth(changed.body.accessToken)).expect(200);
      assert.deepEqual(me.body.map((s: { id: number }) => s.id), [student.id]);
      await loginRaw(e, access.temporaryPassword).expect(401);

      // Sigilo: nada de senha na auditoria nem na saída do processo; a ação de auditoria é a mesma de POST /account.
      await assertPasswordNotAudited(access.temporaryPassword);
      assert.ok(!output.includes(access.temporaryPassword), 'a senha provisória apareceu em log (stdout/stderr)');
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: 'STUDENT_ACCOUNT_CREATE', resourceId: String(student.id) } });
      const meta = audit.metadata as Record<string, unknown>;
      assert.equal(meta.generated, true);
      assert.equal(meta.via, 'quick-register');
      assert.equal(meta.linkedExistingUser, false);
      assert.ok(!('temporaryPassword' in meta) && !('password' in meta));
    });

    it('sem createAccess a resposta é a de sempre (sem `access`, sem senha) e classIds sozinho só matricula', async () => {
      const res = await http()
        .post('/api/students')
        .set(auth(mestre.token))
        .send({ name: '[e2e-qr] Só turma', email: email('soturma'), classIds: [classA2] })
        .expect(201);
      assert.equal('access' in res.body, false);
      assert.ok(!JSON.stringify(res.body).includes('temporaryPassword'));
      assert.equal(res.headers['cache-control'], undefined);
      assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: res.body.id } })).userId, null);
      assert.equal(await prisma.classStudent.count({ where: { studentId: res.body.id, classId: classA2, status: 'ACTIVE' } }), 1);
      // createAccess:false explícito = mesmo comportamento
      const off = await http().post('/api/students').set(auth(mestre.token)).send({ name: '[e2e-qr] Acesso off', email: email('off'), createAccess: false }).expect(201);
      assert.equal('access' in off.body, false);
    });

    it('sem e-mail => SKIPPED_NO_EMAIL com o texto combinado; o aluno é criado normalmente (e matriculado)', async () => {
      const res = await http().post('/api/students').set(auth(mestre.token)).send({ name: '[e2e-qr] Sem email', createAccess: true, classIds: [classA1] }).expect(201);
      assert.deepEqual(res.body.access, {
        status: 'SKIPPED_NO_EMAIL',
        reason: 'Sem e-mail: cadastre um e-mail para criar o acesso depois.',
      });
      assert.equal(res.headers['cache-control'], undefined);
      assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: res.body.id } })).userId, null);
      assert.equal(await prisma.classStudent.count({ where: { studentId: res.body.id, classId: classA1 } }), 1);
    });

    it('e-mail de usuário que já existe => LINKED: sem senha na resposta, senha e nome dele intactos', async () => {
      const e = email('existente');
      const existing = await prisma.user.create({
        data: { email: e, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: 'Pessoa Existente', userType: 'MEMBER', status: 'ACTIVE' },
      });
      const usersBefore = await prisma.user.count({ where: { email: { endsWith: DOMAIN } } });
      const res = await http().post('/api/students').set(auth(mestre.token)).send({ name: '[e2e-qr] Vinculado', email: e, createAccess: true }).expect(201);
      assert.equal(res.body.access.status, 'LINKED');
      assert.equal(res.body.access.email, e);
      assert.equal(res.body.access.temporaryPassword, undefined);
      assert.ok(!JSON.stringify(res.body).includes('emporaryPassword'));
      assert.equal(res.headers['cache-control'], undefined);
      assert.equal(await prisma.user.count({ where: { email: { endsWith: DOMAIN } } }), usersBefore, 'nunca duplica User');
      const after = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
      assert.equal(after.passwordHash, existing.passwordHash);
      assert.equal(after.name, existing.name);
      assert.equal(after.mustChangePassword, false);
      assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: res.body.id } })).userId, existing.id);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: 'STUDENT_ACCOUNT_LINK', resourceId: String(res.body.id) } });
      assert.equal((audit.metadata as Record<string, unknown>).generated, undefined);
      await loginRaw(e, DEV_PASSWORD).expect(200); // continua com a senha DELE
    });

    it('falha ao criar o acesso (e-mail de PLATFORM) => FAILED com motivo, e o aluno É criado mesmo assim', async () => {
      const res = await http().post('/api/students').set(auth(mestre.token)).send({ name: '[e2e-qr] Falha acesso', email: PLATFORM_EMAIL, createAccess: true, classIds: [classA2] }).expect(201);
      assert.equal(res.body.access.status, 'FAILED');
      assert.equal(res.body.access.reason, 'Este e-mail não pode ser usado para criar um acesso.');
      assert.equal(res.body.access.temporaryPassword, undefined);
      const student = await prisma.student.findUniqueOrThrow({ where: { id: res.body.id } });
      assert.equal(student.userId, null);
      assert.equal(await prisma.classStudent.count({ where: { studentId: student.id } }), 1);
    });

    it('turma de OUTRO grupo / inexistente => 404 e o aluno NÃO é criado (nem login, nem matrícula)', async () => {
      const usersBefore = await prisma.user.count({ where: { email: { endsWith: DOMAIN } } });
      const enrollBefore = await prisma.classStudent.count({ where: { organizationId: orgId } });
      for (const classIds of [[classOtherOrg], [classA1, classOtherOrg], [999999999]]) {
        const res = await http()
          .post('/api/students')
          .set(auth(mestre.token))
          .send({ name: '[e2e-qr] Turma ruim', email: email('ruim'), createAccess: true, classIds })
          .expect(404);
        assert.match(res.body.message, /Turma não encontrada/);
      }
      assert.equal(await studentsNamed('[e2e-qr] Turma ruim'), 0);
      assert.equal(await prisma.user.count({ where: { email: { endsWith: DOMAIN } } }), usersBefore);
      assert.equal(await prisma.classStudent.count({ where: { organizationId: orgId } }), enrollBefore);
    });

    it('validação de classIds: >10, não-inteiro, <1, não-array => 400 e nada é criado; duplicados viram uma matrícula só', async () => {
      const bad: unknown[] = [Array.from({ length: 11 }, (_, i) => i + 1), ['a'], [1.5], [0], 'x', [-3]];
      for (const classIds of bad) {
        await http().post('/api/students').set(auth(mestre.token)).send({ name: '[e2e-qr] Ids ruins', classIds }).expect(400);
      }
      await http().post('/api/students').set(auth(mestre.token)).send({ name: '[e2e-qr] Ids ruins', createAccess: 'sim' }).expect(400);
      assert.equal(await studentsNamed('[e2e-qr] Ids ruins'), 0);
      const dup = await http().post('/api/students').set(auth(mestre.token)).send({ name: '[e2e-qr] Dup turma', classIds: [classA1, classA1, classA1] }).expect(201);
      assert.equal(await prisma.classStudent.count({ where: { studentId: dup.body.id } }), 1);
      const empty = await http().post('/api/students').set(auth(mestre.token)).send({ name: '[e2e-qr] Lista vazia', classIds: [] }).expect(201);
      assert.equal(await prisma.classStudent.count({ where: { studentId: empty.body.id } }), 0);
    });

    it('escopo de unidade: professor restrito à unidade A não matricula em turma da B (404, aluno não criado) e cria normalmente na A', async () => {
      const ruim = await http()
        .post('/api/students')
        .set(auth(profScopedToken))
        .send({ name: '[e2e-qr] Escopo ruim', email: email('esc'), createAccess: true, classIds: [classUnitB] })
        .expect(404);
      assert.match(ruim.body.message, /Turma não encontrada/);
      assert.equal(await studentsNamed('[e2e-qr] Escopo ruim'), 0);
      // O mesmo professor em turma da A (e turma sem unidade, visível ao escopo) funciona e o PROFESSOR tem students.edit => CREATED.
      const e = email('esc-ok');
      const ok = await http()
        .post('/api/students')
        .set(auth(profScopedToken))
        .send({ name: '[e2e-qr] Escopo ok', email: e, createAccess: true, classIds: [classA1, classA2] })
        .expect(201);
      assert.equal(ok.body.access.status, 'CREATED');
      assert.equal(ok.body.unitId, unitA, 'o restrito grava na própria unidade');
      assert.equal(await prisma.classStudent.count({ where: { studentId: ok.body.id } }), 2);
      // O Mestre enxerga todas as turmas.
      const m = await http().post('/api/students').set(auth(mestre.token)).send({ name: '[e2e-qr] Mestre turma B', classIds: [classUnitB] }).expect(201);
      assert.equal(await prisma.classStudent.count({ where: { studentId: m.body.id, classId: classUnitB } }), 1);
    });

    it('ator com students.create mas SEM a permissão de criar acesso (students.edit) => SKIPPED_NO_PERMISSION, aluno criado; matriz restaurada', async () => {
      const where = { role_resource: { role: OrgRole.INSTRUTOR, resource: 'students' } };
      const original = await prisma.rolePermission.findUniqueOrThrow({ where });
      assert.equal(original.canCreate, true);
      assert.equal(original.canEdit, true);
      await prisma.rolePermission.update({ where, data: { canEdit: false } });
      try {
        const usersBefore = await prisma.user.count({ where: { email: { endsWith: DOMAIN } } });
        const res = await http()
          .post('/api/students')
          .set(auth(instrutorToken))
          .send({ name: '[e2e-qr] Sem permissao', email: email('semperm'), createAccess: true, classIds: [classA2] })
          .expect(201);
        assert.equal(res.body.access.status, 'SKIPPED_NO_PERMISSION');
        assert.ok(res.body.access.reason);
        assert.equal(res.body.access.temporaryPassword, undefined);
        assert.equal(res.headers['cache-control'], undefined);
        assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: res.body.id } })).userId, null);
        assert.equal(await prisma.user.count({ where: { email: { endsWith: DOMAIN } } }), usersBefore);
        assert.equal(await prisma.classStudent.count({ where: { studentId: res.body.id } }), 1, 'o aluno foi criado e matriculado');
        // A rota de criar acesso continua fechada para ele pelo @CanAccess.
        await http().post(`/api/students/${res.body.id}/account`).set(auth(instrutorToken)).send({ email: email('semperm2') }).expect(403);
      } finally {
        await prisma.rolePermission.update({ where, data: { canEdit: original.canEdit } });
      }
      assert.equal((await prisma.rolePermission.findUniqueOrThrow({ where })).canEdit, true, 'matriz restaurada');
    });

    it('papéis sem students.create seguem barrados (ALUNO, MONITOR 403; sem token 401) e nada é criado', async () => {
      const payload = { name: '[e2e-qr] Barrado', email: email('barrado'), createAccess: true, classIds: [classA1] };
      await http().post('/api/students').send(payload).expect(401);
      await http().post('/api/students').set(auth(alunoSeedToken)).send(payload).expect(403);
      await http().post('/api/students').set(auth(monitorToken)).send(payload).expect(403);
      assert.equal(await studentsNamed('[e2e-qr] Barrado'), 0);
    });

    it('isolamento multi-tenant: o aluno e o acesso nascem no grupo do token; o Mestre de outro grupo não vê nem altera', async () => {
      const e = email('tenant');
      const res = await http().post('/api/students').set(auth(mestre.token)).send({ name: '[e2e-qr] Tenant', email: e, createAccess: true }).expect(201);
      assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: res.body.id } })).organizationId, orgId);
      const membership = await prisma.organizationUser.findFirstOrThrow({ where: { user: { email: e } } });
      assert.equal(membership.organizationId, orgId);
      await http().get(`/api/students/${res.body.id}`).set(auth(orgB.token)).expect(404);
      await http().post(`/api/students/${res.body.id}/reset-password`).set(auth(orgB.token)).send({}).expect(404);
      await loginRaw(e, res.body.access.temporaryPassword).expect(200); // nada mudou
    });
  });

  describe('POST /students/:id/account com password opcional', () => {
    async function newStudent(extra: Record<string, unknown> = {}) {
      return (await http().post('/api/students').set(auth(mestre.token)).send({ name: `[e2e-qr] Conta ${++seq}`, ...extra }).expect(201)).body as { id: number };
    }

    it('sem password (e-mail novo): gera a provisória, devolve temporaryPassword (no-store), faz login, exige troca; audita só a bandeira', async () => {
      const student = await newStudent();
      const e = email('gen');
      const { result: res, output } = await captureOutput(() =>
        http().post(`/api/students/${student.id}/account`).set(auth(mestre.token)).send({ email: e }).expect(201),
      );
      assert.match(res.body.temporaryPassword, PASSWORD_SHAPE);
      assert.equal(res.headers['cache-control'], 'no-store');
      // O formato atual da resposta continua o mesmo.
      assert.equal(res.body.studentId, student.id);
      assert.equal(res.body.linkedExistingUser, false);
      assert.equal(res.body.inviteSent, false);
      assert.equal(res.body.account.role, 'ALUNO');
      assert.equal(res.body.account.mustChangePassword, true);
      assert.ok(!('passwordHash' in res.body.account));
      const login = await loginRaw(e, res.body.temporaryPassword).expect(200);
      assert.equal(login.body.user.mustChangePassword, true);
      assert.equal((await http().get('/api/students/me').set(auth(login.body.accessToken)).expect(403)).body.code, 'MUST_CHANGE_PASSWORD');
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: 'STUDENT_ACCOUNT_CREATE', resourceId: String(student.id) } });
      assert.equal((audit.metadata as Record<string, unknown>).generated, true);
      await assertPasswordNotAudited(res.body.temporaryPassword);
      assert.ok(!output.includes(res.body.temporaryPassword), 'a senha provisória apareceu em log');
    });

    it('com password informada: segue valendo e NÃO devolve temporaryPassword; e-mail existente sem password só vincula (sem senha)', async () => {
      const student = await newStudent();
      const e = email('inf');
      const res = await http().post(`/api/students/${student.id}/account`).set(auth(mestre.token)).send({ email: e, password: 'Prov@Senha2026x' }).expect(201);
      assert.equal('temporaryPassword' in res.body, false);
      assert.equal(res.headers['cache-control'], undefined);
      await loginRaw(e, 'Prov@Senha2026x').expect(200);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: 'STUDENT_ACCOUNT_CREATE', resourceId: String(student.id) } });
      assert.equal((audit.metadata as Record<string, unknown>).generated, undefined);

      const existingEmail = email('inf-existente');
      const existing = await makeUser(existingEmail, OrgRole.RESPONSAVEL);
      const other = await newStudent();
      const linked = await http().post(`/api/students/${other.id}/account`).set(auth(mestre.token)).send({ email: existingEmail }).expect(201);
      assert.equal(linked.body.linkedExistingUser, true);
      assert.equal('temporaryPassword' in linked.body, false, 'a senha gerada é descartada ao vincular');
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: existing.id } })).passwordHash, existing.passwordHash);
      await loginRaw(existingEmail, DEV_PASSWORD).expect(200);
    });

    it('sem password e sem e-mail (nem no cadastro) => 400; password fraca ainda => 400', async () => {
      const student = await newStudent();
      const semEmail = await http().post(`/api/students/${student.id}/account`).set(auth(mestre.token)).send({}).expect(400);
      assert.equal(semEmail.body.message, 'Informe o e-mail de acesso.');
      await http().post(`/api/students/${student.id}/account`).set(auth(mestre.token)).send({ email: email('fraca'), password: 'curta' }).expect(400);
      assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).userId, null);
    });
  });

  describe('Reset de senha com newPassword opcional', () => {
    it('aluno: sem newPassword gera a provisória (200 + no-store), a antiga para de funcionar, sessões caem, exige troca; com newPassword segue 204', async () => {
      const e = email('reset');
      const created = await http().post('/api/students').set(auth(mestre.token)).send({ name: '[e2e-qr] Reset', email: e, createAccess: true }).expect(201);
      const first = created.body.access.temporaryPassword as string;
      const session = (await loginRaw(e, first).expect(200)).body.accessToken as string;
      await http().get('/api/auth/me').set(auth(session)).expect(200);

      const { result: res, output } = await captureOutput(() =>
        http().post(`/api/students/${created.body.id}/reset-password`).set(auth(mestre.token)).send({}).expect(200),
      );
      assert.match(res.body.temporaryPassword, PASSWORD_SHAPE);
      assert.equal(res.body.mustChangePassword, true);
      assert.deepEqual(Object.keys(res.body).sort(), ['mustChangePassword', 'temporaryPassword']);
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.notEqual(res.body.temporaryPassword, first);

      await http().get('/api/auth/me').set(auth(session)).expect(401); // sessão revogada
      await loginRaw(e, first).expect(401); // a senha antiga parou de funcionar
      const login = await loginRaw(e, res.body.temporaryPassword).expect(200);
      assert.equal(login.body.user.mustChangePassword, true);
      await http().get('/api/students/me').set(auth(login.body.accessToken)).expect(403);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: e } });
      assert.equal(user.mustChangePassword, true);
      assert.ok(await bcrypt.compare(res.body.temporaryPassword, user.passwordHash));

      const audits = await prisma.auditLog.findMany({ where: { organizationId: orgId, action: 'MEMBER_PASSWORD_RESET', resourceId: String(created.body.id) } });
      assert.equal(audits.length, 1);
      assert.equal((audits[0].metadata as Record<string, unknown>).generated, true);
      for (const secret of [first, res.body.temporaryPassword]) await assertPasswordNotAudited(secret);
      assert.ok(!output.includes(res.body.temporaryPassword), 'a senha provisória apareceu em log');

      // Compatibilidade: com newPassword informada continua 204 sem corpo e sem generated.
      const informed = await http().post(`/api/students/${created.body.id}/reset-password`).set(auth(mestre.token)).send({ newPassword: NEW_PASSWORD }).expect(204);
      assert.equal(informed.text, '');
      assert.equal(informed.headers['cache-control'], undefined);
      await loginRaw(e, NEW_PASSWORD).expect(200);
      const audits2 = await prisma.auditLog.findMany({ where: { organizationId: orgId, action: 'MEMBER_PASSWORD_RESET', resourceId: String(created.body.id) }, orderBy: { id: 'asc' } });
      assert.equal(audits2.length, 2);
      assert.equal((audits2[1].metadata as Record<string, unknown>).generated, undefined);
    });

    it('aluno sem conta => 409 e nada é gerado; ALUNO 403; outro grupo 404', async () => {
      const semConta = await http().post('/api/students').set(auth(mestre.token)).send({ name: '[e2e-qr] Reset sem conta' }).expect(201);
      const r = await http().post(`/api/students/${semConta.body.id}/reset-password`).set(auth(mestre.token)).send({}).expect(409);
      assert.equal(r.body.message, 'Este aluno ainda não tem conta de acesso.');
      await http().post(`/api/students/${semConta.body.id}/reset-password`).set(auth(alunoSeedToken)).send({}).expect(403);
      await http().post(`/api/students/${semConta.body.id}/reset-password`).set(auth(orgB.token)).send({}).expect(404);
    });

    it('responsável: sem newPassword gera a provisória (200 + no-store); com newPassword segue 204', async () => {
      const student = await http().post('/api/students').set(auth(mestre.token)).send({ name: '[e2e-qr] Dependente' }).expect(201);
      const gEmail = email('resp');
      const guardian = await http()
        .post(`/api/students/${student.body.id}/guardians`)
        .set(auth(mestre.token))
        .send({ name: 'Responsavel QR', email: gEmail, createAccount: true, password: 'Prov@Senha2026x' })
        .expect(201);
      const gid = guardian.body.guardian.id;
      const res = await http().post(`/api/students/${student.body.id}/guardians/${gid}/reset-password`).set(auth(mestre.token)).send({}).expect(200);
      assert.match(res.body.temporaryPassword, PASSWORD_SHAPE);
      assert.equal(res.body.mustChangePassword, true);
      assert.equal(res.headers['cache-control'], 'no-store');
      await loginRaw(gEmail, 'Prov@Senha2026x').expect(401);
      const login = await loginRaw(gEmail, res.body.temporaryPassword).expect(200);
      assert.equal(login.body.user.mustChangePassword, true);
      await assertPasswordNotAudited(res.body.temporaryPassword);
      await http().post(`/api/students/${student.body.id}/guardians/${gid}/reset-password`).set(auth(mestre.token)).send({ newPassword: NEW_PASSWORD }).expect(204);
      await http().post(`/api/students/${student.body.id}/guardians/${gid}/reset-password`).set(auth(mestre.token)).send({ newPassword: 'curta' }).expect(400);
      await loginRaw(gEmail, NEW_PASSWORD).expect(200);
    });

    it('POST /teachers/:id/reset-password continua EXIGINDO newPassword (a opcionalidade é só de aluno/responsável)', async () => {
      const t = await http()
        .post('/api/teachers')
        .set(auth(mestre.token))
        .send({ name: '[e2e-qr] Professor', email: email('teacher'), password: 'Prov@Senha2026x', role: OrgRole.PROFESSOR })
        .expect(201);
      await http().post(`/api/teachers/${t.body.id}/reset-password`).set(auth(mestre.token)).send({}).expect(400);
    });
  });
});
