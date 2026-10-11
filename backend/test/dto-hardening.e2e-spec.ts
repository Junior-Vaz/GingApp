import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { DEV_PASSWORD, MESTRE_EMAIL, loginAs } from './utils/list-helpers';

/**
 * Endurecimento de DTOs (auditoria): mensagens de organizations, senha de professor (SSOT
 * @IsNewPassword), horários de turma, expiresAt de avisos da plataforma, limpar limites do plano,
 * mensagem única do login e @Max(INT4) no financeiro/assinaturas.
 */
const INT4_MAX = 2147483647;
const STRONG = 'Prof@Forte2026x';
const tag = `[e2e-dto-${Date.now()}]`;

describe('DTO hardening (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestreToken: string;
  let platformToken: string;
  const classIds: number[] = [];
  const planIds: number[] = [];
  const announcementIds: number[] = [];
  const userIds: number[] = [];
  const server = () => app.getHttpServer();
  const asMestre = (r: request.Test) => r.set('Authorization', `Bearer ${mestreToken}`);
  const asPlatform = (r: request.Test) => r.set('Authorization', `Bearer ${platformToken}`);

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    mestreToken = (await loginAs(app, MESTRE_EMAIL)).token;
    const res = await request(server())
      .post('/api/auth/platform-login')
      .send({ email: 'owner@gingapp.com.br', password: DEV_PASSWORD })
      .expect(200);
    platformToken = res.body.accessToken;
  });

  after(async () => {
    await prisma.class.deleteMany({ where: { id: { in: classIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
    await prisma.platformAnnouncement.deleteMany({ where: { id: { in: announcementIds } } });
    if (userIds.length > 0) {
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  const messages = (res: request.Response): string[] =>
    Array.isArray(res.body.message) ? res.body.message : [String(res.body.message)];

  // 1) organizations: mensagens do mestre sem prefixo duplicado -------------------------------
  describe('1) POST /organizations: mensagens do mestre', () => {
    it('mestre inválido => 400 com "mestre.campo ..." (um único prefixo, nunca "mestre.mestre.")', async () => {
      const res = await asPlatform(request(server()).post('/api/organizations')).send({
        name: `${tag} Org`,
        mestre: { name: 'x', email: 'nao-e-email', password: 'curta' },
      });
      assert.equal(res.status, 400);
      const all = messages(res);
      assert.ok(all.every((m) => !m.includes('mestre.mestre.')), `prefixo duplicado: ${JSON.stringify(all)}`);
      assert.ok(all.includes('mestre.name deve ter no mínimo 2 caracteres.'), JSON.stringify(all));
      assert.ok(all.includes('mestre.email deve ser um e-mail válido.'), JSON.stringify(all));
      assert.ok(all.some((m) => m.startsWith('mestre.password deve ter no mínimo 12 caracteres')), JSON.stringify(all));
    });
  });

  // 2) POST /teachers: política de senha ---------------------------------------------------------
  describe('2) POST /teachers: política de senha SSOT', () => {
    const body = (password: string) => ({
      name: `${tag} Professor`,
      email: `prof-${Math.random().toString(36).slice(2)}@e2e-dto.local`,
      password,
      role: OrgRole.PROFESSOR,
    });

    it('senha de 6 caracteres => 400', async () => {
      const res = await asMestre(request(server()).post('/api/teachers')).send(body('abc123'));
      assert.equal(res.status, 400);
      assert.ok(messages(res).some((m) => m.includes('password deve ter no mínimo 12 caracteres')), JSON.stringify(res.body));
    });

    it('senha padrão de dev (Dev@12345, inclusive embutida) => 400', async () => {
      for (const pw of ['Dev@12345', 'xxDEV@12345xxxx']) {
        const res = await asMestre(request(server()).post('/api/teachers')).send(body(pw));
        assert.equal(res.status, 400, pw);
        assert.ok(messages(res).some((m) => m.includes('senha padrão de desenvolvimento')), JSON.stringify(res.body));
      }
    });

    it('senha forte => 201 e o professor consegue logar', async () => {
      const payload = body(STRONG);
      const res = await asMestre(request(server()).post('/api/teachers')).send(payload);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      userIds.push(res.body.user.id);
      await request(server()).post('/api/auth/login').send({ email: payload.email, password: STRONG }).expect(200);
    });
  });

  // 3) Class: HH:mm e início < fim ------------------------------------------------------------------
  describe('3) Class startTime/endTime', () => {
    const create = (extra: Record<string, unknown>) =>
      asMestre(request(server()).post('/api/classes')).send({ name: `${tag} Turma`, ...extra });

    it('create: "25:99", "24:00", "9:00" => 400; "23:59" e "00:00" ok', async () => {
      for (const t of ['25:99', '24:00', '9:00', '12:60', 'abc']) {
        const res = await create({ startTime: t });
        assert.equal(res.status, 400, t);
        assert.ok(messages(res).some((m) => m.includes('HH:mm')), JSON.stringify(res.body));
      }
      const ok = await create({ startTime: '00:00', endTime: '23:59' });
      assert.equal(ok.status, 201, JSON.stringify(ok.body));
      classIds.push(ok.body.id);
    });

    it('create: início >= fim => 400', async () => {
      for (const [s, e] of [
        ['20:00', '19:00'],
        ['19:00', '19:00'],
      ]) {
        const res = await create({ startTime: s, endTime: e });
        assert.equal(res.status, 400, `${s}-${e}`);
        assert.ok(messages(res).some((m) => m.includes('endTime deve ser posterior a startTime')), JSON.stringify(res.body));
      }
    });

    it('update: formato inválido, janela invertida (no payload e contra o valor gravado) => 400; válido e null => 200', async () => {
      const made = await create({ startTime: '18:00', endTime: '19:00' });
      assert.equal(made.status, 201);
      classIds.push(made.body.id);
      const patch = (b: Record<string, unknown>) => asMestre(request(server()).patch(`/api/classes/${made.body.id}`)).send(b);

      assert.equal((await patch({ startTime: '25:99' })).status, 400);
      assert.equal((await patch({ startTime: '20:00', endTime: '19:00' })).status, 400);
      // só um lado no payload: compara com o gravado (18:00-19:00)
      assert.equal((await patch({ startTime: '19:30' })).status, 400);
      assert.equal((await patch({ endTime: '17:00' })).status, 400);
      assert.equal((await patch({ startTime: '17:00', endTime: '18:30' })).status, 200);
      assert.equal((await patch({ endTime: null })).status, 200);
      const row = await prisma.class.findUniqueOrThrow({ where: { id: made.body.id } });
      assert.equal(row.startTime, '17:00');
      assert.equal(row.endTime, null);
    });
  });

  // 4) expiresAt no passado ----------------------------------------------------------------------------
  describe('4) POST /platform-announcements: expiresAt', () => {
    it('expiresAt no passado => 400 "expiresAt deve ser futuro"; futuro => 201', async () => {
      const past = await asPlatform(request(server()).post('/api/platform-announcements')).send({
        title: `${tag} Aviso`,
        body: 'corpo do aviso',
        expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
      });
      assert.equal(past.status, 400);
      assert.ok(messages(past).includes('expiresAt deve ser futuro'), JSON.stringify(past.body));

      const future = await asPlatform(request(server()).post('/api/platform-announcements')).send({
        title: `${tag} Aviso`,
        body: 'corpo do aviso',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      assert.equal(future.status, 201, JSON.stringify(future.body));
      announcementIds.push(future.body.id);
    });
  });

  // 5) PATCH /plans/:id limpa limites com null -----------------------------------------------------------------
  describe('5) PATCH /plans/:id: null limpa maxStudents/maxUnits', () => {
    it('null limpa; 0 e não inteiro => 400; > INT4 => 400', async () => {
      const created = await asPlatform(request(server()).post('/api/plans')).send({
        name: `${tag} Plano`,
        code: `e2e-dto-${Date.now()}`,
        priceCents: 1000,
        maxStudents: 10,
        maxUnits: 2,
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      planIds.push(created.body.id);
      const patch = (b: Record<string, unknown>) => asPlatform(request(server()).patch(`/api/plans/${created.body.id}`)).send(b);

      assert.equal((await patch({ maxStudents: 0 })).status, 400);
      assert.equal((await patch({ maxUnits: 1.5 })).status, 400);
      assert.equal((await patch({ maxStudents: INT4_MAX + 1 })).status, 400);
      assert.equal((await patch({ priceCents: INT4_MAX + 1 })).status, 400);

      const cleared = await patch({ maxStudents: null, maxUnits: null });
      assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
      const row = await prisma.plan.findUniqueOrThrow({ where: { id: created.body.id } });
      assert.equal(row.maxStudents, null);
      assert.equal(row.maxUnits, null);
    });
  });

  // 6) Login: mensagem única em português ---------------------------------------------------------------------------
  describe('6) Login: validação 400 com string única em português', () => {
    it('/auth/login e /auth/platform-login: message é string (não array) em português', async () => {
      for (const path of ['/api/auth/login', '/api/auth/platform-login']) {
        const res = await request(server()).post(path).send({ email: 'nao-e-email', password: '123' });
        assert.equal(res.status, 400, path);
        assert.equal(typeof res.body.message, 'string', path);
        assert.match(res.body.message, /Informe um e-mail válido\./);
        assert.match(res.body.message, /A senha deve ter no mínimo 6 caracteres\./);
        assert.doesNotMatch(res.body.message, /must be|should not/i);
      }
    });

    it('credenciais erradas válidas no formato continuam 401; campo ausente continua 400', async () => {
      await request(server()).post('/api/auth/login').send({ email: MESTRE_EMAIL, password: 'errada-123' }).expect(401);
      await request(server()).post('/api/auth/login').send({ email: MESTRE_EMAIL }).expect(400);
    });
  });

  // 7) @Max(INT4) -------------------------------------------------------------------------------------------------------
  describe('7) @Max(INT4) no financeiro/assinaturas', () => {
    it('finance create/update com amountCents > INT4 => 400 do validador (não do filtro Prisma)', async () => {
      const res = await asMestre(request(server()).post('/api/finance')).send({
        description: `${tag} x`,
        amountCents: INT4_MAX + 1,
        dueDate: '2030-01-01',
      });
      assert.equal(res.status, 400);
      assert.ok(messages(res).some((m) => m.includes('amountCents must not be greater than')), JSON.stringify(res.body));
      const upd = await asMestre(request(server()).patch('/api/finance/1')).send({ amountCents: INT4_MAX + 1 });
      assert.equal(upd.status, 400);
      assert.ok(messages(upd).some((m) => m.includes('amountCents must not be greater than')), JSON.stringify(upd.body));
    });

    it('subscriptions create com planId/organizationId > INT4 => 400 do validador', async () => {
      const res = await asPlatform(request(server()).post('/api/subscriptions')).send({
        organizationId: INT4_MAX + 1,
        planId: INT4_MAX + 1,
      });
      assert.equal(res.status, 400);
      const all = messages(res);
      assert.ok(all.some((m) => m.startsWith('organizationId must not be greater than')), JSON.stringify(all));
      assert.ok(all.some((m) => m.startsWith('planId must not be greater than')), JSON.stringify(all));
    });
  });
});
