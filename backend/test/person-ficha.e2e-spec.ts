import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { backfillPersons } from '../src/interface/http/people/person-linker';
import { personDocumentKey } from '../src/shared/security/person-document';
import { SecondOrg, createSecondOrg } from './utils/list-helpers';
import { createPlatformUser, platformLogin } from './utils/platform-team-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * FICHA UNICA - Fase 1 (docs/FICHA_UNICA.md): cadastro sem duplicar (409 com preview minimo), ficha da equipe e da
 * propria pessoa, mescla (super admin), backfill (mesmo login / mesmo CPF / idempotente) e CSV por linha. Tres grupos
 * PROPRIOS desta suite (nunca o ginga-brasil nem o demo). Fixtures "[e2e-ficha]" / "@e2e-ficha.local", removidas no after().
 */
const PREFIX = '[e2e-ficha]';
const DOMAIN = '@e2e-ficha.local';
const PASSWORD = 'Prov@Senha2026x';

/** CPF valido aleatorio (so digitos). */
function makeCpf(): string {
  for (;;) {
    const base = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
    if (/^(\d)\1{8}$/.test(base)) continue;
    const digit = (s: string) => {
      let sum = 0;
      for (let i = 0; i < s.length; i++) sum += Number(s[i]) * (s.length + 1 - i);
      const rest = (sum * 10) % 11;
      return rest === 10 ? 0 : rest;
    };
    const d1 = digit(base);
    return base + d1 + digit(base + d1);
  }
}
const fmt = (d: string) => `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
const PREVIEW_KEYS = ['currentGroups', 'currentLevel', 'name', 'nickname', 'personId', 'photo'];

describe('ficha unica do capoeirista - fase 1 (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let orgA: SecondOrg;
  let orgB: SecondOrg;
  let orgC: SecondOrg;
  let superToken: string;
  const stamp = Date.now();
  const anaCpf = makeCpf();
  const anaEmail = `ana-${stamp}${DOMAIN}`;
  let ana: { id: number; personId: number; person: { id: number; gingappCode: string } };

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const create = (token: string, body: Record<string, unknown>) => http().post('/api/students').set(auth(token)).send(body);

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    orgA = await createSecondOrg(app, prisma, 'ficha-a');
    orgB = await createSecondOrg(app, prisma, 'ficha-b');
    orgC = await createSecondOrg(app, prisma, 'ficha-c');
    await prisma.organization.update({ where: { id: orgA.organizationId }, data: { name: `${PREFIX} Grupo A ${stamp}`, logo: '/api/uploads/logo-a.png' } });
    const admin = await createPlatformUser(prisma, `ficha-super-${stamp}`, { isSuperAdmin: true });
    superToken = await platformLogin(app, admin.email);
  });

  after(async () => {
    const orgIds = [orgA.organizationId, orgB.organizationId, orgC.organizationId];
    const students = await prisma.student.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true, personId: true } });
    const studentIds = students.map((s) => s.id);
    const personIds = new Set(students.map((s) => s.personId).filter((id): id is number => id !== null));
    for (const p of await prisma.person.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } })) personIds.add(p.id);
    await prisma.studentGuardian.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    await prisma.person.updateMany({ where: { id: { in: [...personIds] } }, data: { mergedIntoId: null } });
    await prisma.person.deleteMany({ where: { id: { in: [...personIds] } } });
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: orgIds } }, { userId: { in: userIds } }, { action: 'PERSON_MERGE', resourceId: { in: [...personIds].map(String) } }] } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await orgA.cleanup();
    await orgB.cleanup();
    await orgC.cleanup();
    await prisma.user.deleteMany({ where: { email: { startsWith: `ficha-super-${stamp}` } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('cadastro com CPF cria a ficha: codigo GingApp, CPF so cifrado/hash na Person, CPF formatado na matricula', async () => {
    const res = await create(orgA.token, {
      name: `${PREFIX} Ana Ficha`,
      document: anaCpf,
      birthDate: '2001-02-03',
      email: anaEmail,
      phone: '(61) 98888-7777',
    }).expect(201);
    ana = res.body;
    assert.match(ana.person.gingappCode, /^GING-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    assert.equal(ana.personId, ana.person.id);
    const person = await prisma.person.findUniqueOrThrow({ where: { id: ana.person.id } });
    assert.equal(person.documentKind, 'CPF');
    assert.equal(person.documentHash, personDocumentKey('CPF', anaCpf).hash);
    assert.equal(person.documentLast4, anaCpf.slice(-4));
    assert.ok(!JSON.stringify(person).includes(anaCpf), 'CPF em claro nao fica na Person');
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: ana.id } })).document, fmt(anaCpf));
  });

  it('mesmo CPF no MESMO grupo => 409 PERSON_ALREADY_IN_GROUP (com o id da matricula), nada criado', async () => {
    const before = await prisma.student.count({ where: { organizationId: orgA.organizationId } });
    const res = await create(orgA.token, { name: `${PREFIX} Outro Nome`, document: fmt(anaCpf) }).expect(409);
    assert.equal(res.body.code, 'PERSON_ALREADY_IN_GROUP');
    assert.equal(res.body.studentId, ana.id);
    assert.equal(res.body.studentStatus, 'ACTIVE');
    assert.equal(await prisma.student.count({ where: { organizationId: orgA.organizationId } }), before);
  });

  it('mesmo CPF (ou codigo GingApp) em OUTRO grupo => 409 PERSON_EXISTS_ELSEWHERE com preview minimo, sem vazamento', async () => {
    const before = await prisma.student.count({ where: { organizationId: orgB.organizationId } });
    for (const body of [
      { name: `${PREFIX} Tentativa B`, document: anaCpf },
      { name: `${PREFIX} Tentativa B`, gingappCode: ana.person.gingappCode.toLowerCase() },
    ]) {
      const res = await create(orgB.token, body).expect(409);
      assert.equal(res.body.code, 'PERSON_EXISTS_ELSEWHERE');
      assert.equal(res.body.transferAvailable, false);
      assert.deepEqual(Object.keys(res.body.person).sort(), PREVIEW_KEYS);
      assert.equal(res.body.person.personId, ana.person.id);
      assert.equal(res.body.person.name, `${PREFIX} Ana Ficha`);
      assert.deepEqual(res.body.person.currentGroups, [{ id: orgA.organizationId, name: `${PREFIX} Grupo A ${stamp}`, logoUrl: '/api/uploads/logo-a.png' }]);
      assert.equal(res.body.person.currentLevel, null);
      const text = JSON.stringify(res.body);
      for (const secret of [anaCpf, fmt(anaCpf), anaCpf.slice(-4), anaEmail, '98888', '2001-02-03', 'document', 'birthDate', 'email', 'phone']) {
        assert.ok(!text.includes(secret), `vazou: ${secret}`);
      }
    }
    assert.equal(await prisma.student.count({ where: { organizationId: orgB.organizationId } }), before);
    const audits = await prisma.auditLog.count({ where: { organizationId: orgB.organizationId, action: 'PERSON_LOOKUP_MATCH' } });
    assert.ok(audits >= 2, 'consulta que achou alguem fica na auditoria');
  });

  it('validacao: CPF invalido 400 INVALID_CPF; CPF do responsavel sem nascimento 400; codigo inexistente 400', async () => {
    let res = await create(orgA.token, { name: `${PREFIX} Invalido`, document: '123.456.789-00' }).expect(400);
    assert.equal(res.body.code, 'INVALID_CPF');
    res = await create(orgA.token, { name: `${PREFIX} Invalido`, document: 'RG 1234' }).expect(400);
    assert.equal(res.body.code, 'INVALID_CPF');
    res = await create(orgA.token, { name: `${PREFIX} Crianca`, guardianDocument: makeCpf() }).expect(400);
    assert.equal(res.body.code, 'BIRTHDATE_REQUIRED_FOR_GUARDIAN_DOCUMENT');
    res = await create(orgA.token, { name: `${PREFIX} Codigo`, gingappCode: 'GING-2222-2222' }).expect(400);
    assert.equal(res.body.code, 'GINGAPP_CODE_NOT_FOUND');
  });

  it('mesmo nome + nascimento em outro grupo => 409 POSSIBLE_DUPLICATE; confirmNew:true cadastra e audita', async () => {
    await create(orgA.token, { name: `${PREFIX} Fulano Beltrano da Silva`, birthDate: '1999-09-09' }).expect(201);
    // No MESMO grupo, nome + nascimento nao bloqueia (comportamento antigo preservado; a sugestao e so entre grupos).
    await create(orgA.token, { name: `${PREFIX} Fulano Beltrano da Silva`, birthDate: '1999-09-09' }).expect(201);
    const body ={ name: `${PREFIX}   fulano beltrano DA SILVA`, birthDate: '1999-09-09' };
    const dup = await create(orgB.token, body).expect(409);
    assert.equal(dup.body.code, 'POSSIBLE_DUPLICATE');
    assert.equal(dup.body.canConfirmNew, true);
    assert.equal(dup.body.possibleMatches.length, 2);
    assert.deepEqual(Object.keys(dup.body.possibleMatches[0]).sort(), PREVIEW_KEYS);
    const ok = await create(orgB.token, { ...body, confirmNew: true }).expect(201);
    assert.ok(
      dup.body.possibleMatches.every((m: { personId: number }) => m.personId !== ok.body.person.id),
      'ficha nova (nao junta por nome)',
    );
    assert.equal(
      await prisma.auditLog.count({ where: { organizationId: orgB.organizationId, action: 'PERSON_DUPLICATE_CONFIRMED' } }),
      1,
    );
  });

  it('crianca sem CPF: CPF do responsavel + nascimento identifica a ficha; irmao (outro nascimento) e outra ficha', async () => {
    const guardian = makeCpf();
    const child = await create(orgA.token, { name: `${PREFIX} Joaozinho`, birthDate: '2016-04-05', guardianDocument: fmt(guardian) }).expect(201);
    const person = await prisma.person.findUniqueOrThrow({ where: { id: child.body.person.id } });
    assert.equal(person.documentKind, 'GUARDIAN_CPF');
    const elsewhere = await create(orgB.token, { name: `${PREFIX} Joaozinho`, birthDate: '2016-04-05', guardianDocument: guardian }).expect(409);
    assert.equal(elsewhere.body.code, 'PERSON_EXISTS_ELSEWHERE');
    const sibling = await create(orgA.token, { name: `${PREFIX} Mariazinha`, birthDate: '2018-07-08', guardianDocument: guardian }).expect(201);
    assert.notEqual(sibling.body.person.id, child.body.person.id);
    // Gemeo (mesmo responsavel e nascimento, outro nome): so suspeita; confirmando vira ficha SEM essa chave.
    const twin = await create(orgA.token, { name: `${PREFIX} Pedrinho`, birthDate: '2016-04-05', guardianDocument: guardian }).expect(409);
    assert.equal(twin.body.code, 'POSSIBLE_DUPLICATE');
    const twinOk = await create(orgA.token, { name: `${PREFIX} Pedrinho`, birthDate: '2016-04-05', guardianDocument: guardian, confirmNew: true }).expect(201);
    assert.equal((await prisma.person.findUniqueOrThrow({ where: { id: twinOk.body.person.id } })).documentHash, null);
  });

  it('ficha da equipe: identidade + matricula do grupo, CPF mascarado; outro grupo 404; aluno 403', async () => {
    const res = await http().get(`/api/students/${ana.id}/ficha`).set(auth(orgA.token)).expect(200);
    assert.equal(res.body.scope, 'OWN_GROUP');
    assert.equal(res.body.person.gingappCode, ana.person.gingappCode);
    assert.equal(res.body.person.documentMasked, `***.***.***-${anaCpf.slice(-2)}`);
    assert.equal(res.body.person.documentKind, 'CPF');
    assert.deepEqual(res.body.sharedFromOtherGroups, []);
    assert.equal(res.body.enrollments.length, 1);
    assert.equal(res.body.enrollments[0].organization.id, orgA.organizationId);
    assert.equal(res.body.enrollments[0].isCurrent, true);
    assert.ok(!JSON.stringify(res.body).includes(anaCpf));
    await http().get(`/api/students/${ana.id}/ficha`).set(auth(orgB.token)).expect(404);
  });

  it('mesmo login nos dois grupos une as fichas; /people/me/ficha (SELF) mostra as duas matriculas; staff so a sua', async () => {
    await http().post(`/api/students/${ana.id}/account`).set(auth(orgA.token)).send({ email: anaEmail, password: PASSWORD }).expect(201);
    const user = await prisma.user.findFirstOrThrow({ where: { email: anaEmail } });
    await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: false } });
    assert.equal((await prisma.person.findUniqueOrThrow({ where: { id: ana.person.id } })).userId, user.id);

    // Grupo B cadastrou a mesma pessoa SEM CPF (outro nome): ao ligar o mesmo login, a ficha do B e mesclada na da Ana.
    const inB = await create(orgB.token, { name: `${PREFIX} Ana Apelido B` }).expect(201);
    await http().post(`/api/students/${inB.body.id}/account`).set(auth(orgB.token)).send({ email: anaEmail }).expect(201);
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: inB.body.id } })).personId, ana.person.id);
    assert.equal((await prisma.person.findUniqueOrThrow({ where: { id: inB.body.person.id } })).mergedIntoId, ana.person.id);

    const slugA = (await prisma.organization.findUniqueOrThrow({ where: { id: orgA.organizationId } })).slug;
    const login = await http().post('/api/auth/login').send({ email: anaEmail, password: PASSWORD, organizationSlug: slugA }).expect(200);
    const token = login.body.accessToken;
    const mine = await http().get('/api/people/me/ficha').set(auth(token)).expect(200);
    assert.equal(mine.body.scope, 'SELF');
    assert.equal(mine.body.person.id, ana.person.id);
    assert.deepEqual(
      mine.body.enrollments.map((e: { organization: { id: number }; isCurrent: boolean }) => [e.organization.id, e.isCurrent]).sort(),
      [
        [orgA.organizationId, true],
        [orgB.organizationId, false],
      ].sort(),
    );
    const code = await http().get('/api/people/me/code').set(auth(token)).expect(200);
    assert.equal(code.body.gingappCode, ana.person.gingappCode);
    assert.match(code.body.qrDataUrl, /^data:image\/png;base64,/);
    // ?studentId= de quem nao e o proprio/dependente = 404.
    await http().get(`/api/people/me/ficha?studentId=${inB.body.id}`).set(auth(token)).expect(404);
    // Aluno nao acessa a ficha pela rota da equipe.
    await http().get(`/api/students/${ana.id}/ficha`).set(auth(token)).expect(403);
    // A equipe do B continua vendo so a matricula do B (compartilhamento so na fase 2).
    const staffB = await http().get(`/api/students/${inB.body.id}/ficha`).set(auth(orgB.token)).expect(200);
    assert.deepEqual(staffB.body.enrollments.map((e: { studentId: number }) => e.studentId), [inB.body.id]);
  });

  it('mesclar: so super admin; move matriculas, o codigo antigo continua achando a ficha; conflito no mesmo grupo 409', async () => {
    const one = await create(orgA.token, { name: `${PREFIX} Mescla Um`, birthDate: '1988-08-08' }).expect(201);
    const two = await create(orgC.token, { name: `${PREFIX} Mescla Um`, birthDate: '1988-08-08', confirmNew: true }).expect(201);
    const dups = await http().get('/api/people/duplicates').set(auth(superToken)).expect(200);
    const group = dups.body.groups.find((g: { people: { id: number }[] }) => g.people.some((p) => p.id === one.body.person.id));
    assert.ok(group, 'par aparece como candidato');
    assert.ok(group.people.some((p: { id: number }) => p.id === two.body.person.id));
    assert.ok(!JSON.stringify(dups.body).includes(anaCpf));

    await http().post('/api/people/merge').set(auth(orgA.token)).send({ keepId: one.body.person.id, mergeId: two.body.person.id }).expect(403);
    const merged = await http().post('/api/people/merge').set(auth(superToken)).send({ keepId: one.body.person.id, mergeId: two.body.person.id }).expect(200);
    assert.equal(merged.body.movedStudents, 1);
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: two.body.id } })).personId, one.body.person.id);
    const old = await prisma.person.findUniqueOrThrow({ where: { id: two.body.person.id } });
    assert.equal(old.mergedIntoId, one.body.person.id, 'a ficha mesclada nao e apagada');
    assert.equal(await prisma.auditLog.count({ where: { action: 'PERSON_MERGE', resourceId: String(one.body.person.id) } }), 1);
    // Codigo da ficha mesclada leva a ficha mantida (ja tem matricula no A => 409 no A).
    const byOldCode = await create(orgA.token, { name: `${PREFIX} X`, gingappCode: two.body.person.gingappCode }).expect(409);
    assert.equal(byOldCode.body.code, 'PERSON_ALREADY_IN_GROUP');
    assert.equal(byOldCode.body.studentId, one.body.id);
    const again = await http().post('/api/people/merge').set(auth(superToken)).send({ keepId: one.body.person.id, mergeId: two.body.person.id }).expect(409);
    assert.equal(again.body.code, 'PERSON_ALREADY_MERGED');

    const c1 = await create(orgA.token, { name: `${PREFIX} Conflito Um` }).expect(201);
    const c2 = await create(orgA.token, { name: `${PREFIX} Conflito Dois` }).expect(201);
    const clash = await http().post('/api/people/merge').set(auth(superToken)).send({ keepId: c1.body.person.id, mergeId: c2.body.person.id }).expect(409);
    assert.equal(clash.body.code, 'PERSON_MERGE_SAME_GROUP');
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: c2.body.id } })).personId, c2.body.person.id, 'nada mudou');
  });

  it('backfill: mesmo login => 1 ficha; mesmo CPF => 1 ficha; nao junta por nome; idempotente', async () => {
    const user = await prisma.user.create({
      data: { email: `bf-${stamp}${DOMAIN}`, passwordHash: await bcrypt.hash(PASSWORD, 4), name: `${PREFIX} BF`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    const cpf = makeCpf();
    const mk = (organizationId: number, name: string, extra: Record<string, unknown> = {}) =>
      prisma.student.create({ data: { organizationId, name: `${PREFIX} ${name}`, ...extra } });
    const s1 = await mk(orgC.organizationId, 'BF Login C', { userId: user.id });
    const s2 = await mk(orgB.organizationId, 'BF Login B', { userId: user.id });
    const s3 = await mk(orgC.organizationId, 'BF Cpf C', { document: fmt(cpf) });
    const s4 = await mk(orgB.organizationId, 'BF Cpf B', { document: cpf });
    const s5 = await mk(orgC.organizationId, 'BF Nome', { birthDate: new Date('1977-07-07T00:00:00Z') });
    const s6 = await mk(orgB.organizationId, 'BF Nome', { birthDate: new Date('1977-07-07T00:00:00Z') });

    const first = await backfillPersons(prisma, undefined, { organizationIds: [orgB.organizationId, orgC.organizationId] });
    assert.equal(first.scanned, 6);
    assert.equal(first.personsCreated, 4); // login, cpf, nome C, nome B
    assert.equal(first.linkedByUser, 1);
    assert.equal(first.linkedByDocument, 1);
    assert.equal(first.remainingWithoutPerson, 0);
    const row = async (id: number) => (await prisma.student.findUniqueOrThrow({ where: { id } })).personId!;
    assert.equal(await row(s1.id), await row(s2.id));
    assert.equal(await row(s3.id), await row(s4.id));
    assert.notEqual(await row(s5.id), await row(s6.id), 'nome + nascimento nunca junta sozinho');
    const loginPerson = await prisma.person.findUniqueOrThrow({ where: { id: await row(s1.id) } });
    assert.equal(loginPerson.userId, user.id);
    const cpfPerson = await prisma.person.findUniqueOrThrow({ where: { id: await row(s3.id) } });
    assert.equal(cpfPerson.documentHash, personDocumentKey('CPF', cpf).hash);
    assert.ok(first.possibleDuplicateGroups >= 1);

    const second = await backfillPersons(prisma, undefined, { organizationIds: [orgB.organizationId, orgC.organizationId] });
    assert.equal(second.scanned, 0);
    assert.equal(second.personsCreated, 0);
    assert.equal(await row(s1.id), loginPerson.id);
  });

  it('importacao CSV: as mesmas regras por linha (erros/ignorados por linha) e uma ficha por linha criada', async () => {
    const fresh = makeCpf();
    const already = await prisma.student.findFirstOrThrow({ where: { organizationId: orgC.organizationId, name: `${PREFIX} BF Cpf C` } });
    const res = await http()
      .post('/api/students/import')
      .set(auth(orgC.token))
      .send({
        rows: [
          { line: 2, name: `${PREFIX} CSV Ana`, document: anaCpf },
          { line: 3, name: `${PREFIX} CSV Novo`, document: fmt(fresh) },
          { line: 4, name: `${PREFIX} CSV Ja Aqui`, document: already.document },
          { line: 5, name: `${PREFIX} CSV Repetido`, document: fresh },
          { line: 6, name: `${PREFIX} CSV Crianca`, guardianDocument: makeCpf() },
        ],
      })
      .expect(200);
    const byLine = new Map(res.body.items.map((i: { line: number }) => [i.line, i]));
    const item = (line: number) => byLine.get(line) as { action: string; code?: string; messages: string[] };
    assert.equal(item(2).action, 'ERROR');
    assert.equal(item(2).code, 'PERSON_EXISTS_ELSEWHERE');
    assert.equal(item(3).action, 'CREATE');
    assert.equal(item(4).action, 'IGNORE');
    assert.equal(item(4).code, 'PERSON_ALREADY_IN_GROUP');
    assert.equal(item(5).action, 'IGNORE');
    assert.equal(item(6).action, 'ERROR');
    assert.deepEqual(item(6).messages, ['Informe a data de nascimento para usar o CPF do responsável.']);
    assert.equal(res.body.created, 1);
    const created = await prisma.student.findFirstOrThrow({ where: { organizationId: orgC.organizationId, name: `${PREFIX} CSV Novo` } });
    const person = await prisma.person.findUniqueOrThrow({ where: { id: created.personId! } });
    assert.equal(person.documentHash, personDocumentKey('CPF', fresh).hash);
    assert.equal(await prisma.student.count({ where: { name: `${PREFIX} CSV Ana` } }), 0);
  });

  it('PATCH do CPF: invalido 400; CPF de outra ficha 409; CPF novo vai para a ficha; valor legado reenviado igual passa', async () => {
    const s = await create(orgA.token, { name: `${PREFIX} Patch` }).expect(201);
    let res = await http().patch(`/api/students/${s.body.id}`).set(auth(orgA.token)).send({ document: '123' }).expect(400);
    assert.equal(res.body.code, 'INVALID_CPF');
    res = await http().patch(`/api/students/${s.body.id}`).set(auth(orgA.token)).send({ document: anaCpf }).expect(409);
    assert.equal(res.body.code, 'DOCUMENT_BELONGS_TO_OTHER_PERSON');
    const cpf = makeCpf();
    await http().patch(`/api/students/${s.body.id}`).set(auth(orgA.token)).send({ document: cpf }).expect(200);
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: s.body.id } })).document, fmt(cpf));
    assert.equal((await prisma.person.findUniqueOrThrow({ where: { id: s.body.person.id } })).documentHash, personDocumentKey('CPF', cpf).hash);
    await prisma.student.update({ where: { id: s.body.id }, data: { document: 'RG 99.999' } });
    await http().patch(`/api/students/${s.body.id}`).set(auth(orgA.token)).send({ document: 'RG 99.999', name: `${PREFIX} Patch Dois` }).expect(200);
    assert.equal((await prisma.person.findUniqueOrThrow({ where: { id: s.body.person.id } })).name, `${PREFIX} Patch Dois`, 'unica matricula sincroniza a ficha');
  });
});
