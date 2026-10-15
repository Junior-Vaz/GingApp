import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { MeFixture, createMeFixture } from './utils/me-fixtures';
import { todaySaoPaulo } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * CRUD de Aulas (Lesson, src/interface/http/lessons/) — mesmo padrão de classes.e2e-spec.ts.
 * `teacherUserId` não é FK para uma tabela Teacher (não existe): é o User.id de alguém com
 * membership MESTRE/PROFESSOR na organização (lessons.service.ts). Para testar o caminho
 * inválido, buscamos direto via Prisma o id do usuário aluno@ (que não é MESTRE/PROFESSOR) —
 * não há endpoint que exponha esse id de forma mais direta que consultar o banco.
 *
 * Reaproveita a turma do seed ("Adulto — Quinta 19h") como classId válido — é a mesma em que
 * Ana (aluno@) está matriculada, usada também no teste de GET /lessons/me. Fixtures desta
 * suíte são prefixadas com "[e2e-lessons]" (nas notes) e apagadas no after().
 */
const DEV_PASSWORD = 'Dev@12345';
const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';
const PROFESSOR_EMAIL = 'professor@gingabrasil.com.br';
const SEED_CLASS_NAME = 'Adulto — Quinta 19h';

async function loginFull(app: INestApplication, email: string) {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: DEV_PASSWORD })
    .expect(200);
  return res.body as { accessToken: string; user: { organizationId: number } };
}

describe('Lessons CRUD (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestreToken: string;
  let alunoToken: string;
  let organizationId: number;
  let seedClassId: number;
  let alunoUserId: number;
  let professorUserId: number;
  const createdLessonIds: number[] = [];

  before(async () => {
    app = await createTestApp();

    const mestreLogin = await loginFull(app, MESTRE_EMAIL);
    mestreToken = mestreLogin.accessToken;
    organizationId = mestreLogin.user.organizationId;

    alunoToken = (await loginFull(app, ALUNO_EMAIL)).accessToken;

    const seedClass = await prisma.class.findFirstOrThrow({
      where: { organizationId, name: SEED_CLASS_NAME },
    });
    seedClassId = seedClass.id;

    const alunoUser = await prisma.user.findUniqueOrThrow({ where: { email: ALUNO_EMAIL } });
    alunoUserId = alunoUser.id;

    const professorUser = await prisma.user.findUniqueOrThrow({ where: { email: PROFESSOR_EMAIL } });
    professorUserId = professorUser.id;
  });

  after(async () => {
    // Limpa só as fixtures criadas por esta suíte — nunca mexe na turma/aula do seed.
    if (createdLessonIds.length > 0) {
      await prisma.lesson.deleteMany({ where: { id: { in: createdLessonIds } } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('POST /lessons com classId do seed e sem professor cria a aula de verdade', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/lessons')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ classId: seedClassId, date: new Date(Date.now() + 7 * 86400000).toISOString(), notes: '[e2e-lessons] sem professor' })
      .expect(201);

    createdLessonIds.push(res.body.id);

    const persisted = await prisma.lesson.findUnique({ where: { id: res.body.id } });
    assert.ok(persisted !== null);
    assert.equal(persisted?.classId, seedClassId);
    assert.equal(persisted?.teacherUserId, null);
  });

  it('POST /lessons com classId inexistente retorna 400 e nada é gravado', async () => {
    const beforeCount = await prisma.lesson.count();

    const res = await request(app.getHttpServer())
      .post('/api/lessons')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ classId: 999999, date: new Date().toISOString() })
      .expect(400);

    assert.equal(res.body.message, 'Turma inválida para esta organização.');

    assert.equal(await prisma.lesson.count(), beforeCount);
  });

  it('POST /lessons com teacherUserId de quem não é MESTRE/PROFESSOR retorna 400 e nada é gravado', async () => {
    const beforeCount = await prisma.lesson.count();

    const res = await request(app.getHttpServer())
      .post('/api/lessons')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ classId: seedClassId, teacherUserId: alunoUserId, date: new Date().toISOString() })
      .expect(400);

    assert.equal(res.body.message, 'Professor inválido para esta organização.');

    assert.equal(await prisma.lesson.count(), beforeCount);
  });

  it('POST /lessons com teacherUserId válido (professor@) retorna 201 e persiste o vínculo', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/lessons')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({
        classId: seedClassId,
        teacherUserId: professorUserId,
        date: new Date(Date.now() + 8 * 86400000).toISOString(),
        notes: '[e2e-lessons] com professor',
      })
      .expect(201);

    createdLessonIds.push(res.body.id);

    const persisted = await prisma.lesson.findUniqueOrThrow({ where: { id: res.body.id } });
    assert.equal(persisted.teacherUserId, professorUserId);
  });

  it('PATCH status INACTIVE cancela a aula — o registro continua existindo (apagar de verdade é DELETE, ver lessons-delete.e2e-spec.ts)', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/lessons')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ classId: seedClassId, date: new Date(Date.now() + 9 * 86400000).toISOString(), notes: '[e2e-lessons] para remover' })
      .expect(201);
    createdLessonIds.push(created.body.id);

    await request(app.getHttpServer())
      .patch(`/api/lessons/${created.body.id}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ status: 'INACTIVE' })
      .expect(200);

    const persisted = await prisma.lesson.findUniqueOrThrow({ where: { id: created.body.id } });
    assert.ok(persisted !== null); // continua existindo — nunca é apagada de verdade
    assert.equal(persisted.status, 'INACTIVE');
  });

  it('GET /lessons/me logado como aluno inclui a aula da turma em que ele está matriculado', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/lessons')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ classId: seedClassId, date: new Date(Date.now() + 10 * 86400000).toISOString(), notes: '[e2e-lessons] para /me' })
      .expect(201);
    createdLessonIds.push(created.body.id);

    const res = await request(app.getHttpServer())
      .get('/api/lessons/me')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);

    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.some((l: { id: number }) => l.id === created.body.id));
  });

  it('aula CANCELADA some da lista do aluno 2 dias depois do cancelamento (a equipe continua vendo)', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/lessons')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ classId: seedClassId, date: new Date(Date.now() + 12 * 86400000).toISOString(), notes: '[e2e-lessons] cancelada' })
      .expect(201);
    createdLessonIds.push(created.body.id);
    const id = created.body.id as number;
    const ids = async () =>
      (await request(app.getHttpServer()).get('/api/lessons/me').set('Authorization', `Bearer ${alunoToken}`).expect(200)).body.map(
        (l: { id: number }) => l.id,
      );

    await request(app.getHttpServer()).patch(`/api/lessons/${id}`).set('Authorization', `Bearer ${mestreToken}`).send({ status: 'INACTIVE' }).expect(200);
    assert.ok((await prisma.lesson.findUniqueOrThrow({ where: { id } })).cancelledAt, 'cancelledAt gravado ao cancelar');
    assert.ok((await ids()).includes(id), 'recém-cancelada ainda aparece (com status INACTIVE)');

    // 3 dias depois do cancelamento: some para o aluno, mas continua para a equipe.
    await prisma.lesson.update({ where: { id }, data: { cancelledAt: new Date(Date.now() - 3 * 86400000) } });
    assert.ok(!(await ids()).includes(id), 'cancelada há 3 dias não aparece para o aluno');
    const staff = await request(app.getHttpServer()).get(`/api/lessons/${id}`).set('Authorization', `Bearer ${mestreToken}`).expect(200);
    assert.equal(staff.body.status, 'INACTIVE');

    // Reativar limpa o cancelamento e a aula volta.
    await request(app.getHttpServer()).patch(`/api/lessons/${id}`).set('Authorization', `Bearer ${mestreToken}`).send({ status: 'ACTIVE' }).expect(200);
    assert.equal((await prisma.lesson.findUniqueOrThrow({ where: { id } })).cancelledAt, null);
    assert.ok((await ids()).includes(id));
  });
});


// ---------------------------------------------------------------------------------------------
// B1 — paginacao + filtros no servidor e limpar campos opcionais no PATCH
// ---------------------------------------------------------------------------------------------
import { createOtherOrg, deleteOtherOrg, list, loginToken } from './utils/page-helpers';

describe('Lessons: paginacao, filtros e limpar campos (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestreToken: string;
  let alunoToken: string;
  let orgId: number;
  let otherOrgId: number;
  let unitId: number;
  let class1Id: number;
  let class2Id: number;
  let professorUserId: number;
  const tag = `[e2e-b1-lessons-${Date.now()}]`;

  before(async () => {
    app = await createTestApp();
    mestreToken = await loginToken(app, MESTRE_EMAIL);
    alunoToken = await loginToken(app, ALUNO_EMAIL);
    orgId = (await prisma.organizationUser.findFirstOrThrow({ where: { user: { email: MESTRE_EMAIL } } })).organizationId;
    professorUserId = (await prisma.user.findUniqueOrThrow({ where: { email: PROFESSOR_EMAIL } })).id;
    unitId = (await prisma.unit.create({ data: { organizationId: orgId, name: `${tag} unit` } })).id;
    otherOrgId = await createOtherOrg(prisma, 'lessons');
    class1Id = (await prisma.class.create({ data: { organizationId: orgId, name: `${tag} C1` } })).id;
    class2Id = (await prisma.class.create({ data: { organizationId: orgId, name: `${tag} C2` } })).id;
    const classOther = await prisma.class.create({ data: { organizationId: otherOrgId, name: `${tag} CX` } });

    await prisma.lesson.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        organizationId: orgId, classId: class1Id, date: new Date('2031-01-01T12:00:00Z'), notes: `${tag} aula ${i}`,
      })),
    });
    await prisma.lesson.createMany({
      data: Array.from({ length: 3 }, (_, i) => ({
        organizationId: otherOrgId, classId: classOther.id, date: new Date('2031-01-01T12:00:00Z'), notes: `${tag} alheia ${i}`,
      })),
    });
    await prisma.lesson.create({
      data: { organizationId: orgId, classId: class2Id, date: new Date('2032-06-15T15:00:00Z'), notes: `${tag} Especial RODA`, status: 'INACTIVE' },
    });
  });

  after(async () => {
    await prisma.lesson.deleteMany({ where: { notes: { contains: tag } } });
    await prisma.lesson.deleteMany({ where: { classId: { in: [class1Id, class2Id] } } });
    await prisma.class.deleteMany({ where: { name: { contains: tag } } });
    await prisma.unit.deleteMany({ where: { id: unitId } });
    await deleteOtherOrg(prisma, otherOrgId);
    await prisma.$disconnect();
    await app.close();
  });

  const q = () => `q=${encodeURIComponent(tag)}`;

  it('sem limit devolve 50 itens (array) e X-Total-Count correto; total NAO inclui outra organizacao', async () => {
    const r = await list(app, 'lessons', mestreToken, q());
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.equal(r.body.length, 50);
    assert.equal(r.total, 56); // 55 + a especial; as 3 da outra org nao entram
    const semQ = await list(app, 'lessons', mestreToken);
    assert.equal(semQ.body.length, 50);
    assert.equal(semQ.total, await prisma.lesson.count({ where: { organizationId: orgId } }));
  });

  it('limit/offset retornam a fatia certa (igual ao Prisma) com o mesmo total', async () => {
    const expected = await prisma.lesson.findMany({
      where: { organizationId: orgId, notes: { contains: tag } },
      orderBy: { id: 'desc' },
      skip: 50,
      take: 10,
    });
    const r = await list(app, 'lessons', mestreToken, `${q()}&limit=10&offset=50`);
    assert.equal(r.total, 56);
    assert.deepEqual(r.body.map((l: { id: number }) => l.id), expected.map((l) => l.id));
    assert.equal(r.body.length, 6);
  });

  it('order=nearest: de hoje em diante (data crescente) e so depois as passadas (da mais recente); paginacao atravessa as duas faixas; order invalido => 400', async () => {
    const past = await prisma.lesson.create({ data: { organizationId: orgId, classId: class2Id, date: new Date('2020-02-01T12:00:00Z'), notes: `${tag} passada nova` } });
    const older = await prisma.lesson.create({ data: { organizationId: orgId, classId: class2Id, date: new Date('2020-01-01T12:00:00Z'), notes: `${tag} passada velha` } });
    try {
      const only = `${q()}&classId=${class2Id}&order=nearest`;
      const all = await list(app, 'lessons', mestreToken, only);
      assert.equal(all.total, 3);
      // futura (2032) primeiro; depois a passada mais recente (2020-02) e por fim a mais antiga (2020-01)
      assert.deepEqual(all.body.map((l: { id: number }) => l.id).slice(1), [past.id, older.id]);
      assert.equal(new Date(all.body[0].date).getUTCFullYear(), 2032);
      // a paginacao atravessa as duas faixas
      const p2 = await list(app, 'lessons', mestreToken, `${only}&limit=1&offset=1`);
      assert.deepEqual(p2.body.map((l: { id: number }) => l.id), [past.id]);
      const p3 = await list(app, 'lessons', mestreToken, `${only}&limit=5&offset=2`);
      assert.deepEqual(p3.body.map((l: { id: number }) => l.id), [older.id]);
      // periodo atual (so hoje, aqui): as aulas de 2020/2031/2032 ficam FORA
      const win = await list(app, 'lessons', mestreToken, `${q()}&order=nearest&from=${todaySaoPaulo()}&to=${todaySaoPaulo()}`);
      assert.equal(win.total, 0);
      assert.equal((await list(app, 'lessons', mestreToken, 'order=sideways')).status, 400);
    } finally {
      await prisma.lesson.deleteMany({ where: { id: { in: [past.id, older.id] } } });
    }
  });

  it('limit=201, limit=0 e offset=-1 retornam 400', async () => {
    for (const bad of ['limit=201', 'limit=0', 'offset=-1']) {
      assert.equal((await list(app, 'lessons', mestreToken, bad)).status, 400, bad);
    }
  });

  it('filtros classId, status, from/to (to so com data inclui o dia inteiro) e q em observacoes', async () => {
    assert.equal((await list(app, 'lessons', mestreToken, `${q()}&classId=${class1Id}`)).total, 55);
    assert.equal((await list(app, 'lessons', mestreToken, `${q()}&classId=${class2Id}`)).total, 1);
    assert.equal((await list(app, 'lessons', mestreToken, `${q()}&status=INACTIVE`)).total, 1);
    assert.equal((await list(app, 'lessons', mestreToken, `${q()}&from=2032-01-01`)).total, 1);
    assert.equal((await list(app, 'lessons', mestreToken, `${q()}&to=2031-12-31`)).total, 55);
    assert.equal((await list(app, 'lessons', mestreToken, `${q()}&from=2031-01-01&to=2031-01-01`)).total, 55);
    assert.equal((await list(app, 'lessons', mestreToken, `${q()}&to=2032-06-15`)).total, 56); // dia inteiro, 15:00Z incluso
    assert.equal((await list(app, 'lessons', mestreToken, `${q()}&from=2032-06-16`)).total, 0);
    assert.equal((await list(app, 'lessons', mestreToken, `q=${encodeURIComponent(tag.toUpperCase())}%20especial%20roda`)).total, 1);
    assert.equal((await list(app, 'lessons', mestreToken, 'from=ontem')).status, 400);
    assert.equal((await list(app, 'lessons', mestreToken, 'status=XPTO')).status, 400);
    assert.equal((await list(app, 'lessons', mestreToken, 'classId=abc')).status, 400);
  });

  it('PATCH com null LIMPA os campos opcionais (confirmado via Prisma) e null em classId/date/status => 400', async () => {
    const created = await prisma.lesson.create({
      data: {
        organizationId: orgId, classId: class1Id, unitId, teacherUserId: professorUserId,
        date: new Date('2031-03-03T12:00:00Z'), startTime: '19:00', endTime: '20:00', notes: `${tag} limpar`,
      },
    });
    await request(app.getHttpServer())
      .patch(`/api/lessons/${created.id}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ unitId: null, teacherUserId: null, startTime: null, endTime: null, notes: null })
      .expect(200);
    const persisted = await prisma.lesson.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(persisted.unitId, null);
    assert.equal(persisted.teacherUserId, null);
    assert.equal(persisted.startTime, null);
    assert.equal(persisted.endTime, null);
    assert.equal(persisted.notes, null);
    assert.equal(persisted.classId, class1Id);

    for (const body of [{ classId: null }, { date: null }, { status: null }]) {
      await request(app.getHttpServer())
        .patch(`/api/lessons/${created.id}`)
        .set('Authorization', `Bearer ${mestreToken}`)
        .send(body)
        .expect(400);
    }
    await prisma.lesson.delete({ where: { id: created.id } });
  });

  it('RBAC inalterado: ALUNO nao edita aula (403), listagem do ALUNO segue o mesmo status com ou sem query; sem token 401', async () => {
    const alvo = await prisma.lesson.findFirstOrThrow({ where: { notes: { contains: tag } } });
    await request(app.getHttpServer())
      .patch(`/api/lessons/${alvo.id}`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .send({ notes: null })
      .expect(403);
    const a = await list(app, 'lessons', alunoToken);
    const b = await list(app, 'lessons', alunoToken, 'limit=5');
    assert.equal(a.status, b.status);
    await request(app.getHttpServer()).get('/api/lessons?limit=5').expect(401);
  });
});

/**
 * "Minhas aulas" com >50 aulas: /lessons/me ordenava por data CRESCENTE e cortava em 50, então com
 * histórico longo as aulas FUTURAS (a "próxima aula") ficavam de fora. Agora: limit/offset,
 * X-Total-Count e from/to/status/order para o app buscar "a partir de hoje" e "anteriores".
 */
describe('Lessons /me — paginação, período, status e ordem (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let fx: MeFixture;
  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(`/api${path}`).set('Authorization', `Bearer ${token}`);
  const day = (offset: number) => todaySaoPaulo(offset);
  const civil = (offset: number) => new Date(`${day(offset)}T00:00:00.000Z`);
  const dateOf = (l: { date: string }) => l.date.slice(0, 10);

  before(async () => {
    app = await createTestApp();
    fx = await createMeFixture(app, prisma, 'lesme');
    const org = fx.organizationId;
    // Turma do aluno: 60 passadas (-60..-1), hoje e 9 futuras (+1..+9) = 70; duas INACTIVE (-1 e +2).
    // (A cancelada passada fica em -1: aulas canceladas há mais de 2 dias somem da lista do aluno.)
    const offsets = [...Array.from({ length: 60 }, (_, i) => i - 60), 0, ...Array.from({ length: 9 }, (_, i) => i + 1)];
    await prisma.lesson.createMany({
      data: offsets.map((o) => ({
        organizationId: org,
        classId: fx.classMineId,
        date: civil(o),
        notes: `lesme ${o}`,
        status: o === -1 || o === 2 ? ('INACTIVE' as const) : ('ACTIVE' as const),
      })),
    });
    // Turma alheia: nunca pode aparecer.
    await prisma.lesson.createMany({
      data: [0, 1].map((o) => ({ organizationId: org, classId: fx.classOtherId, date: civil(o), notes: `lesme alheia ${o}` })),
    });
  });

  after(async () => {
    await fx.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('70 aulas: sem limit vêm as 50 MAIS ANTIGAS (ordem crescente histórica) e X-Total-Count = 70 — a próxima aula só aparece com from', async () => {
    const res = await get('/lessons/me', fx.self.token).expect(200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 50);
    assert.equal(res.headers['x-total-count'], '70');
    const dates = res.body.map(dateOf);
    assert.deepEqual(dates, [...dates].sort()); // crescente
    assert.equal(dates[0], day(-60));
    assert.ok(!dates.includes(day(0)), 'sem from, a aula de hoje não cabe nas 50 mais antigas');

    const rest = await get('/lessons/me?offset=50', fx.self.token).expect(200);
    assert.equal(rest.body.length, 20);
    const ids = [...res.body, ...rest.body].map((l: { id: number }) => l.id);
    const db = await prisma.lesson.findMany({
      where: { classId: fx.classMineId },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
    assert.deepEqual(ids, db.map((l) => l.id));
  });

  it('from=hoje traz exatamente hoje + futuras (10, total 10); status=ACTIVE&limit=1 acha a PRÓXIMA aula mesmo com >50 aulas', async () => {
    const upcoming = await get(`/lessons/me?from=${day(0)}&limit=200`, fx.self.token).expect(200);
    assert.equal(upcoming.headers['x-total-count'], '10');
    assert.deepEqual(upcoming.body.map(dateOf), Array.from({ length: 10 }, (_, i) => day(i)));

    const next = await get(`/lessons/me?from=${day(0)}&status=ACTIVE&limit=1`, fx.self.token).expect(200);
    assert.equal(next.body.length, 1);
    assert.equal(dateOf(next.body[0]), day(0));
    assert.equal(next.headers['x-total-count'], '9'); // a INACTIVE de +2 fica de fora

    const tomorrowOn = await get(`/lessons/me?from=${day(1)}&status=ACTIVE&limit=1`, fx.self.token).expect(200);
    assert.equal(dateOf(tomorrowOn.body[0]), day(1));
  });

  it('order=desc + to=ontem: as 10 aulas anteriores mais recentes (total 60); `to` só com data inclui o dia', async () => {
    const past = await get(`/lessons/me?to=${day(-1)}&order=desc&limit=10`, fx.self.token).expect(200);
    assert.equal(past.headers['x-total-count'], '60');
    assert.deepEqual(past.body.map(dateOf), Array.from({ length: 10 }, (_, i) => day(-1 - i)));
    const one = await get(`/lessons/me?from=${day(-1)}&to=${day(-1)}`, fx.self.token).expect(200);
    assert.equal(one.body.length, 1);
    assert.equal(one.body[0].status, 'INACTIVE');
    const inactive = await get(`/lessons/me?status=INACTIVE&limit=200`, fx.self.token).expect(200);
    assert.deepEqual(inactive.body.map(dateOf), [day(-1), day(2)]);
  });

  it('isolamento: nunca vem aula da turma alheia; responsável vê as da turma do dependente; sem vínculo nada', async () => {
    const self = await get('/lessons/me?limit=200', fx.self.token).expect(200);
    assert.equal(self.body.length, 70);
    assert.ok(self.body.every((l: { classId: number }) => l.classId === fx.classMineId));
    assert.ok(self.body.every((l: { notes: string }) => !l.notes.includes('alheia')));

    const guardian = await get('/lessons/me?limit=200', fx.guardian.token).expect(200);
    assert.equal(guardian.headers['x-total-count'], '70');
    assert.ok(guardian.body.every((l: { classId: number }) => l.classId === fx.classMineId));

    const orphan = await get('/lessons/me', fx.orphan.token).expect(200);
    assert.deepEqual(orphan.body, []);
    assert.equal(orphan.headers['x-total-count'], '0');
  });

  it('parâmetros inválidos => 400 (limit=201/0, offset=-1, order, status, from/to, desconhecido); sem token 401', async () => {
    for (const qs of ['limit=201', 'limit=0', 'offset=-1', 'order=sideways', 'status=XYZ', 'from=ontem', 'to=x', 'foo=1', 'q=x']) {
      await get(`/lessons/me?${qs}`, fx.self.token).expect(400);
    }
    await get('/lessons/me?limit=200&order=desc', fx.self.token).expect(200);
    await request(app.getHttpServer()).get('/api/lessons/me').expect(401);
  });
});
