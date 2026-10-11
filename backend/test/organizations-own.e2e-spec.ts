import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { loginToken } from './utils/page-helpers';
import { createPlatformUser, platformLogin } from './utils/platform-team-fixtures';

/**
 * PATCH /organizations/me (E04): o MESTRE edita o PRÓPRIO grupo (organização do token). Slug e status são
 * imutáveis por esta rota; PROFESSOR/ALUNO/PLATFORM => 403; o PATCH /organizations/:id do super admin segue
 * intacto. Segunda via independente = Prisma direto. Dois grupos reais (G e H) provam o isolamento.
 */
const TAG = `${Date.now()}`;
const NAME_PREFIX = 'E2E OrgOwn';
const MAIL_DOMAIN = 'e2e-org-own.local';
const MESTRE_PASSWORD = 'Mestre#Seguro2026';

describe('PATCH /organizations/me — Mestre edita o próprio grupo (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const server = () => app.getHttpServer();
  const fixtureUserIds: number[] = [];
  const orgIds: number[] = [];

  let superToken: string;
  let professorToken: string;
  let alunoToken: string;
  const groups: Record<'G' | 'H', { id: number; slug: string; token: string }> = {
    G: { id: 0, slug: '', token: '' },
    H: { id: 0, slug: '', token: '' },
  };

  const patchMe = (token: string | undefined, payload: unknown) => {
    const req = request(server()).patch('/api/organizations/me');
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(payload as object);
  };
  const row = (id: number) => prisma.organization.findUniqueOrThrow({ where: { id } });

  async function createGroup(key: 'G' | 'H') {
    const email = `mestre-${key}-${TAG}@${MAIL_DOMAIN}`;
    const created = await request(server())
      .post('/api/organizations')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ name: `${NAME_PREFIX} ${key} ${TAG}`, mestre: { name: `Mestre ${key}`, email, password: MESTRE_PASSWORD } })
      .expect(201);
    orgIds.push(created.body.id);
    const login = await request(server()).post('/api/auth/login').send({ email, password: MESTRE_PASSWORD }).expect(200);
    groups[key] = { id: created.body.id, slug: created.body.slug, token: login.body.accessToken };
  }

  /** Org do seed (de PROFESSOR/ALUNO): se o guard regredir, o PATCH deles a alteraria — o after() restaura. */
  let seedOrgSnapshot: Awaited<ReturnType<typeof prisma.organization.findUniqueOrThrow>>;

  before(async () => {
    app = await createTestApp();
    seedOrgSnapshot = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ginga-brasil' } });
    const superAdmin = await createPlatformUser(prisma, 'orgown-super', { isSuperAdmin: true });
    fixtureUserIds.push(superAdmin.id);
    superToken = await platformLogin(app, superAdmin.email);
    professorToken = await loginToken(app, 'professor@gingabrasil.com.br');
    alunoToken = await loginToken(app, 'aluno@gingabrasil.com.br');
    await createGroup('G');
    await createGroup('H');
  });

  after(async () => {
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, socialLinks, ...seedFields } = seedOrgSnapshot;
    await prisma.organization.update({
      where: { id: seedOrgSnapshot.id },
      data: { ...seedFields, socialLinks: socialLinks ?? Prisma.DbNull },
    });
    const memberships = await prisma.organizationUser.findMany({ where: { organizationId: { in: orgIds } } });
    await prisma.unit.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: memberships.map((m) => m.userId) } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('autorização', () => {
    it('sem token => 401; PROFESSOR e ALUNO => 403 (e nada muda)', async () => {
      const before = await row(groups.G.id);
      await patchMe(undefined, { name: 'Sem token' }).expect(401);
      await patchMe(professorToken, { name: 'Professor edita' }).expect(403);
      await patchMe(alunoToken, { name: 'Aluno edita' }).expect(403);
      assert.deepEqual(await row(groups.G.id), before);
      assert.equal(await prisma.organization.count({ where: { name: { in: ['Sem token', 'Professor edita', 'Aluno edita'] } } }), 0);
    });

    it('403 vem antes da validação do corpo (PROFESSOR com corpo inválido => 403, não 400)', async () => {
      await patchMe(professorToken, { slug: 'x' }).expect(403);
    });

    it('super admin PLATFORM não usa esta rota (403): ele edita pelo PATCH /organizations/:id', async () => {
      await patchMe(superToken, { name: 'Super edita por me' }).expect(403);
      const viaId = await request(server())
        .patch(`/api/organizations/${groups.G.id}`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ phone: '+55 62 99999-0000' })
        .expect(200);
      assert.equal(viaId.body.phone, '+55 62 99999-0000');
      await prisma.organization.update({ where: { id: groups.G.id }, data: { phone: null } });
    });

    it('o Mestre NÃO usa o PATCH /organizations/:id do super admin (403), nem no próprio grupo', async () => {
      await request(server())
        .patch(`/api/organizations/${groups.G.id}`)
        .set('Authorization', `Bearer ${groups.G.token}`)
        .send({ name: 'Mestre por id' })
        .expect(403);
      assert.notEqual((await row(groups.G.id)).name, 'Mestre por id');
    });
  });

  describe('edição feliz', () => {
    it('200: grava todos os campos (aparados, e-mail minúsculo, UF maiúscula) e devolve a organização inteira', async () => {
      const payload = {
        name: `  ${NAME_PREFIX} G Novo ${TAG} `,
        document: '12.345.678/0001-95',
        email: ' Contato@Grupo-G.Example.com ',
        phone: '+55 (62) 3333-4444',
        description: ' Capoeira Angola e Regional desde 1998. ',
        history: 'Fundado por Mestre João...\nUm texto longo.',
        foundedYear: 1998,
        city: ' Goiânia ',
        state: 'go',
        website: 'https://grupog.example.com',
        logo: 'https://cdn.example.com/logo-g.png',
        socialLinks: { instagram: 'https://instagram.com/grupog', youtube: 'https://youtube.com/@grupog' },
      };
      const res = await patchMe(groups.G.token, payload).expect(200);
      assert.equal(res.body.id, groups.G.id);
      assert.equal(res.body.name, `${NAME_PREFIX} G Novo ${TAG}`);
      assert.equal(res.body.email, 'contato@grupo-g.example.com');
      assert.equal(res.body.state, 'GO');
      assert.equal(res.body.city, 'Goiânia');
      assert.equal(res.body.description, 'Capoeira Angola e Regional desde 1998.');
      assert.equal(res.body.foundedYear, 1998);
      assert.deepEqual(res.body.socialLinks, payload.socialLinks);

      const saved = await row(groups.G.id);
      assert.equal(saved.document, '12.345.678/0001-95');
      assert.equal(saved.phone, '+55 (62) 3333-4444');
      assert.equal(saved.history, payload.history);
      assert.equal(saved.website, payload.website);
      assert.equal(saved.logo, payload.logo);
      assert.deepEqual(saved.socialLinks, payload.socialLinks);
      assert.equal(saved.slug, groups.G.slug, 'slug nunca muda');
      assert.equal(saved.status, 'ACTIVE');
      assert.equal(saved.type, 'GROUP');
    });

    it('GET /organizations (o próprio Mestre) devolve os novos campos', async () => {
      const res = await request(server()).get('/api/organizations').set('Authorization', `Bearer ${groups.G.token}`).expect(200);
      assert.equal(res.body.id, groups.G.id);
      assert.equal(res.body.foundedYear, 1998);
      assert.equal(res.body.website, 'https://grupog.example.com');
      assert.equal(res.body.logo, 'https://cdn.example.com/logo-g.png');
      assert.equal(res.body.history.startsWith('Fundado por'), true);
    });

    it('parcial: só o enviado muda; o resto fica como estava', async () => {
      const before = await row(groups.G.id);
      await patchMe(groups.G.token, { description: 'Nova descrição' }).expect(200);
      const after = await row(groups.G.id);
      assert.equal(after.description, 'Nova descrição');
      assert.deepEqual({ ...after, description: null, updatedAt: null }, { ...before, description: null, updatedAt: null });
    });

    it('null (ou texto vazio) LIMPA os opcionais; socialLinks substitui por inteiro e {} / null zeram a coluna', async () => {
      await patchMe(groups.G.token, { socialLinks: { facebook: 'https://facebook.com/grupog', instagram: null } }).expect(200);
      assert.deepEqual((await row(groups.G.id)).socialLinks, { facebook: 'https://facebook.com/grupog' });
      await patchMe(groups.G.token, { socialLinks: {} }).expect(200);
      assert.equal((await row(groups.G.id)).socialLinks, null);
      await patchMe(groups.G.token, { socialLinks: { tiktok: 'https://tiktok.com/@g' } }).expect(200);
      await patchMe(groups.G.token, { socialLinks: null }).expect(200);
      assert.equal((await row(groups.G.id)).socialLinks, null);

      await patchMe(groups.G.token, {
        document: null, email: null, phone: null, description: '  ', history: null, foundedYear: null,
        city: '', state: null, website: null, logo: null,
      }).expect(200);
      const cleared = await row(groups.G.id);
      for (const field of ['document', 'email', 'phone', 'description', 'history', 'foundedYear', 'city', 'state', 'website', 'logo'] as const) {
        assert.equal(cleared[field], null, field);
      }
      assert.equal(cleared.name, `${NAME_PREFIX} G Novo ${TAG}`, 'nome intacto');
    });
  });

  describe('imutáveis e validação (400, nada gravado)', () => {
    it('slug, status, type, id e organizationId NÃO são editáveis por esta rota', async () => {
      const before = await row(groups.G.id);
      for (const payload of [
        { slug: 'outro-slug' },
        { status: 'INACTIVE' },
        { type: 'SYSTEM' },
        { id: 1 },
        { organizationId: groups.H.id },
        { name: 'Válido', slug: 'outro-slug' },
        { createdAt: '2020-01-01T00:00:00.000Z' },
      ]) {
        const res = await patchMe(groups.G.token, payload);
        assert.equal(res.status, 400, JSON.stringify(payload));
      }
      assert.deepEqual(await row(groups.G.id), before);
    });

    it('corpo vazio e valores inválidos => 400', async () => {
      const before = await row(groups.G.id);
      const bad: Array<Record<string, unknown>> = [
        {},
        { name: null },
        { name: 'A' },
        { name: 'x'.repeat(121) },
        { document: '123' },
        { email: 'nao-e-email' },
        { phone: 'abc' },
        { foundedYear: 1799 },
        { foundedYear: 2101 },
        { foundedYear: 1998.5 },
        { foundedYear: '1998' },
        { state: 'XX' },
        { state: 'Goiás' },
        { website: 'javascript:alert(1)' },
        { website: 'grupo.com.br' },
        { website: 'ftp://grupo.com.br/arquivo' },
        { logo: '/imagens/logo.png' },
        { logo: 'data:image/png;base64,AAAA' },
        { description: 'd'.repeat(1001) },
        { history: 'h'.repeat(10001) },
        { socialLinks: { instagram: 'instagram.com/grupo' } },
        { socialLinks: { myspace: 'https://myspace.com/x' } },
        { socialLinks: 'https://instagram.com/x' },
      ];
      for (const payload of bad) {
        const res = await patchMe(groups.G.token, payload);
        assert.equal(res.status, 400, `${JSON.stringify(payload).slice(0, 70)} => ${res.status}`);
      }
      assert.deepEqual(await row(groups.G.id), before);
    });
  });

  describe('isolamento entre grupos', () => {
    it('o Mestre de H edita só H; G não muda (e vice-versa)', async () => {
      const gBefore = await row(groups.G.id);
      const res = await patchMe(groups.H.token, { name: `${NAME_PREFIX} H Novo ${TAG}`, city: 'Salvador', state: 'BA' }).expect(200);
      assert.equal(res.body.id, groups.H.id);
      assert.deepEqual(await row(groups.G.id), gBefore);
      const h = await row(groups.H.id);
      assert.equal(h.name, `${NAME_PREFIX} H Novo ${TAG}`);
      assert.equal(h.state, 'BA');
      assert.equal(h.slug, groups.H.slug);
    });

    it('o alvo é sempre a organização do token: editar G não toca em H', async () => {
      const hBefore = await row(groups.H.id);
      await patchMe(groups.G.token, { city: 'Anápolis' }).expect(200);
      assert.equal((await row(groups.G.id)).city, 'Anápolis');
      assert.deepEqual(await row(groups.H.id), hBefore);
    });
  });
});
