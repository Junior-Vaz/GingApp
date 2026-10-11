import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * "Professor" não é uma tabela própria (PLANO_PROJETO.md §2.2 / teachers.service.ts): é o
 * papel MESTRE ou PROFESSOR de um OrganizationUser. `id` nas rotas é o id do
 * OrganizationUser (a membership), não do User. POST /teachers cria User + OrganizationUser
 * juntos numa transação; DELETE só inativa a membership (o User nunca é apagado).
 *
 * Fixtures desta suíte usam e-mails em "@e2e-teachers-test.local" e são removidas no after()
 * (membership antes do user, por causa da FK).
 */
const DEV_PASSWORD = 'Dev@12345';
/** Senha forte (política de 12+ caracteres, sem a senha padrão de dev) para professores criados via API. */
const TEACHER_PASSWORD = 'Prof@Forte2026x';
const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';

async function login(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: DEV_PASSWORD })
    .expect(200);
  return res.body.accessToken;
}

describe('Teachers CRUD (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestreToken: string;
  let alunoToken: string;
  const createdMembershipIds: number[] = [];
  const createdUserIds: number[] = [];

  before(async () => {
    app = await createTestApp();
    mestreToken = await login(app, MESTRE_EMAIL);
    alunoToken = await login(app, ALUNO_EMAIL);
  });

  after(async () => {
    // Ordem importa: apaga a membership (FK para o User) antes do User.
    if (createdMembershipIds.length > 0) {
      await prisma.organizationUser.deleteMany({ where: { id: { in: createdMembershipIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('POST /teachers cria User + OrganizationUser juntos, com o role certo (confirmado via Prisma)', async () => {
    const email = `professor-novo-${Date.now()}@e2e-teachers-test.local`;

    const res = await request(app.getHttpServer())
      .post('/api/teachers')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: '[e2e-teachers] Professor Novo', email, password: TEACHER_PASSWORD, role: OrgRole.PROFESSOR })
      .expect(201);

    createdMembershipIds.push(res.body.id);

    // Segunda via independente: confirma direto no Postgres que os DOIS registros existem.
    const membership = await prisma.organizationUser.findUnique({
      where: { id: res.body.id },
      include: { user: true },
    });
    assert.ok(membership !== null);
    assert.equal(membership?.role, OrgRole.PROFESSOR);
    assert.equal(membership?.status, 'ACTIVE');
    assert.equal(membership?.user.email, email);
    assert.equal(membership?.user.name, '[e2e-teachers] Professor Novo');

    createdUserIds.push(membership!.user.id);
  });

  it('POST /teachers com e-mail já cadastrado retorna 400 e nada novo é criado', async () => {
    const usersBefore = await prisma.user.count();
    const membershipsBefore = await prisma.organizationUser.count();

    const res = await request(app.getHttpServer())
      .post('/api/teachers')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({
        name: '[e2e-teachers] Duplicado',
        email: ALUNO_EMAIL, // já existe no seed (com outro role/uso)
        password: TEACHER_PASSWORD,
        role: OrgRole.PROFESSOR,
      })
      .expect(400);

    assert.equal(res.body.message, 'E-mail já cadastrado.');

    assert.equal(await prisma.user.count(), usersBefore);
    assert.equal(await prisma.organizationUser.count(), membershipsBefore);
  });

  it('PATCH /teachers/:id atualiza o papel (PROFESSOR → MESTRE), confirmado via Prisma', async () => {
    const email = `professor-para-editar-${Date.now()}@e2e-teachers-test.local`;
    const created = await request(app.getHttpServer())
      .post('/api/teachers')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: '[e2e-teachers] Para Editar', email, password: TEACHER_PASSWORD, role: OrgRole.PROFESSOR })
      .expect(201);
    createdMembershipIds.push(created.body.id);
    createdUserIds.push(created.body.user.id);

    await request(app.getHttpServer())
      .patch(`/api/teachers/${created.body.id}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ role: OrgRole.MESTRE })
      .expect(200);

    const persisted = await prisma.organizationUser.findUniqueOrThrow({ where: { id: created.body.id } });
    assert.equal(persisted.role, OrgRole.MESTRE);
  });

  it('DELETE /teachers/:id é soft delete — membership vira INACTIVE, o User continua existindo', async () => {
    const email = `professor-para-remover-${Date.now()}@e2e-teachers-test.local`;
    const created = await request(app.getHttpServer())
      .post('/api/teachers')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: '[e2e-teachers] Para Remover', email, password: TEACHER_PASSWORD, role: OrgRole.PROFESSOR })
      .expect(201);
    createdMembershipIds.push(created.body.id);
    const userId = created.body.user.id;
    createdUserIds.push(userId);

    await request(app.getHttpServer())
      .delete(`/api/teachers/${created.body.id}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    const membership = await prisma.organizationUser.findUniqueOrThrow({ where: { id: created.body.id } });
    assert.equal(membership.status, 'INACTIVE');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    assert.ok(user !== null); // o User nunca é apagado, só a membership é inativada
  });

  it('ALUNO tentando POST /teachers recebe 403 (RBAC) e nada é gravado', async () => {
    const usersBefore = await prisma.user.count();
    const membershipsBefore = await prisma.organizationUser.count();

    await request(app.getHttpServer())
      .post('/api/teachers')
      .set('Authorization', `Bearer ${alunoToken}`)
      .send({
        name: '[e2e-teachers] Não Deveria Existir',
        email: `nao-deveria-existir-${Date.now()}@e2e-teachers-test.local`,
        password: TEACHER_PASSWORD,
        role: OrgRole.PROFESSOR,
      })
      .expect(403);

    assert.equal(await prisma.user.count(), usersBefore);
    assert.equal(await prisma.organizationUser.count(), membershipsBefore);
  });
});


// ---------------------------------------------------------------------------------------------
// B1 — paginacao + filtros no servidor e limpar campos opcionais no PATCH
// ---------------------------------------------------------------------------------------------
import { createOtherOrg, deleteOtherOrg, list, loginToken } from './utils/page-helpers';

describe('Teachers: paginacao, filtros e limpar campos (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestreToken: string;
  let alunoToken: string;
  let orgId: number;
  let otherOrgId: number;
  const stamp = Date.now();
  const tag = `E2EB1T${stamp}`; // sem espacos/colchetes: tambem entra no e-mail
  const emailDomain = `@b1-${stamp}.local`;

  async function makeTeacher(organizationId: number, label: string, role: OrgRole = OrgRole.PROFESSOR, status = 'ACTIVE', phone: string | null = null) {
    const user = await prisma.user.create({
      data: { email: `${label.toLowerCase()}${emailDomain}`, passwordHash: 'x', name: `${tag} ${label}`, phone },
    });
    const membership = await prisma.organizationUser.create({ data: { organizationId, userId: user.id, role, status } });
    return { user, membership };
  }

  before(async () => {
    app = await createTestApp();
    mestreToken = await loginToken(app, MESTRE_EMAIL);
    alunoToken = await loginToken(app, ALUNO_EMAIL);
    orgId = (await prisma.organizationUser.findFirstOrThrow({ where: { user: { email: MESTRE_EMAIL } } })).organizationId;
    otherOrgId = await createOtherOrg(prisma, 'teachers');

    for (let i = 0; i < 55; i++) await makeTeacher(orgId, `Prof${String(i).padStart(2, '0')}`);
    await makeTeacher(orgId, 'MestreB1', OrgRole.MESTRE);
    await makeTeacher(orgId, 'InativoB1', OrgRole.PROFESSOR, 'INACTIVE');
    await makeTeacher(orgId, 'AlunoB1', OrgRole.ALUNO); // nao e professor: nunca aparece
    for (let i = 0; i < 3; i++) await makeTeacher(otherOrgId, `Alheio${i}`);
  });

  after(async () => {
    const users = await prisma.user.findMany({ where: { email: { endsWith: emailDomain } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await prisma.organizationUser.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await deleteOtherOrg(prisma, otherOrgId);
    await prisma.$disconnect();
    await app.close();
  });

  const q = () => `q=${encodeURIComponent(tag)}`;

  it('sem limit devolve 50 itens (array) e X-Total-Count correto; total NAO inclui outra organizacao nem nao-professores', async () => {
    const r = await list(app, 'teachers', mestreToken, q());
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.equal(r.body.length, 50);
    assert.equal(r.total, 57); // 55 + Mestre + Inativo; Aluno e os 3 da outra org ficam de fora
    const semQ = await list(app, 'teachers', mestreToken);
    assert.equal(semQ.body.length, 50);
    assert.equal(
      semQ.total,
      await prisma.organizationUser.count({ where: { organizationId: orgId, role: { in: [OrgRole.MESTRE, OrgRole.PROFESSOR] } } }),
    );
  });

  it('limit/offset retornam a fatia certa (igual ao Prisma) com o mesmo total; formato do item inalterado', async () => {
    const expected = await prisma.organizationUser.findMany({
      where: { organizationId: orgId, role: { in: [OrgRole.MESTRE, OrgRole.PROFESSOR] }, user: { name: { contains: tag } } },
      orderBy: { id: 'desc' },
      skip: 50,
      take: 10,
    });
    const r = await list(app, 'teachers', mestreToken, `${q()}&limit=10&offset=50`);
    assert.equal(r.total, 57);
    assert.deepEqual(r.body.map((t: { id: number }) => t.id), expected.map((t) => t.id));
    assert.deepEqual(Object.keys(r.body[0]).sort(), ['createdAt', 'id', 'role', 'status', 'user']);
    assert.deepEqual(Object.keys(r.body[0].user).sort(), ['email', 'id', 'name', 'phone', 'photo']);
  });

  it('limit=201, limit=0 e offset=-1 retornam 400', async () => {
    for (const bad of ['limit=201', 'limit=0', 'offset=-1']) {
      assert.equal((await list(app, 'teachers', mestreToken, bad)).status, 400, bad);
    }
  });

  it('filtros role e status (valores fora do dominio => 400)', async () => {
    const m = await list(app, 'teachers', mestreToken, `${q()}&role=MESTRE`);
    assert.equal(m.total, 1);
    assert.equal(m.body[0].user.name, `${tag} MestreB1`);
    const p = await list(app, 'teachers', mestreToken, `${q()}&role=PROFESSOR`);
    assert.equal(p.total, 56);
    const i = await list(app, 'teachers', mestreToken, `${q()}&status=INACTIVE`);
    assert.equal(i.total, 1);
    assert.equal(i.body[0].user.name, `${tag} InativoB1`);
    assert.equal((await list(app, 'teachers', mestreToken, 'role=ALUNO')).status, 400);
    assert.equal((await list(app, 'teachers', mestreToken, 'status=XPTO')).status, 400);
  });

  it('q busca (case-insensitive) em nome e e-mail', async () => {
    assert.equal((await list(app, 'teachers', mestreToken, `q=${tag.toLowerCase()}%20inativob1`)).total, 1);
    assert.equal((await list(app, 'teachers', mestreToken, `q=mestreb1${emailDomain.toUpperCase()}`)).total, 1);
  });

  it('PATCH phone=null LIMPA o telefone (confirmado via Prisma); null em name/role/status => 400', async () => {
    const { user, membership } = await makeTeacher(orgId, 'LimparB1', OrgRole.PROFESSOR, 'ACTIVE', '11999990000');
    const r = await request(app.getHttpServer())
      .patch(`/api/teachers/${membership.id}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ phone: null })
      .expect(200);
    assert.equal(r.body.user.phone, null);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).phone, null);

    for (const body of [{ name: null }, { role: null }, { status: null }]) {
      await request(app.getHttpServer())
        .patch(`/api/teachers/${membership.id}`)
        .set('Authorization', `Bearer ${mestreToken}`)
        .send(body)
        .expect(400);
    }
    const still = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(still.name, `${tag} LimparB1`);
  });

  it('RBAC inalterado: ALUNO recebe 403 em GET /teachers (com ou sem parametros) e sem token 401', async () => {
    await request(app.getHttpServer()).get('/api/teachers').set('Authorization', `Bearer ${alunoToken}`).expect(403);
    await request(app.getHttpServer()).get('/api/teachers?limit=5&q=x').set('Authorization', `Bearer ${alunoToken}`).expect(403);
    await request(app.getHttpServer()).get('/api/teachers?limit=5').expect(401);
  });
});
