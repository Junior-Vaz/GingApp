import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { MESTRE_EMAIL, loginAs } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * /platform-settings — CRUD de PlatformSetting (somente PLATFORM). Segredos nunca saem da API.
 * Todas as chaves criadas aqui usam o prefixo próprio `e2e-settings-<timestamp>` e são removidas
 * no after(); nenhuma asserção depende de contagem global.
 */
const DEV_PASSWORD = 'Dev@12345';
const PLATFORM_EMAIL = 'owner@gingapp.com.br';
const PREFIX = `e2e-settings-${Date.now()}`;
const key = (name: string) => `${PREFIX}.${name}`;
const SECRET_VALUE = { apiKey: 'sk_live_NUNCA_VAZAR_123' };

describe('Platform settings (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let platformToken: string;
  let platformUserId: number;
  let memberToken: string;

  const api = (method: 'get' | 'put' | 'delete', path: string, token?: string) => {
    const req = request(app.getHttpServer())[method](`/api/platform-settings${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  before(async () => {
    app = await createTestApp();
    const platform = await request(app.getHttpServer())
      .post('/api/auth/platform-login')
      .send({ email: PLATFORM_EMAIL, password: DEV_PASSWORD })
      .expect(200);
    platformToken = platform.body.accessToken;
    platformUserId = platform.body.user.id;
    memberToken = (await loginAs(app, MESTRE_EMAIL)).token;
  });

  after(async () => {
    await prisma.platformSetting.deleteMany({ where: { key: { startsWith: PREFIX } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('sem token => 401 e MEMBER (MESTRE) => 403 em todos os endpoints', async () => {
    const k = key('guard');
    for (const token of [undefined, memberToken]) {
      const expected = token ? 403 : 401;
      await api('get', '', token).expect(expected);
      await api('get', `/${k}`, token).expect(expected);
      await (token ? api('put', `/${k}`, token) : api('put', `/${k}`)).send({ value: 1 }).expect(expected);
      await api('delete', `/${k}`, token).expect(expected);
    }
    assert.equal(await prisma.platformSetting.count({ where: { key: key('guard') } }), 0);
  });

  it('PUT cria (200), registra updatedByUserId do token e GET /:key devolve o valor', async () => {
    const k = key('plain');
    const res = await api('put', `/${k}`, platformToken).send({ value: { theme: 'dark', n: [1, 2] } }).expect(200);
    assert.equal(res.body.key, k);
    assert.deepEqual(res.body.value, { theme: 'dark', n: [1, 2] });
    assert.equal(res.body.isSecret, false);
    assert.equal(res.body.hasValue, true);
    assert.equal(res.body.updatedByUserId, platformUserId);

    const got = await api('get', `/${k}`, platformToken).expect(200);
    assert.deepEqual(got.body.value, { theme: 'dark', n: [1, 2] });

    const row = await prisma.platformSetting.findUniqueOrThrow({ where: { key: k } });
    assert.equal(row.updatedByUserId, platformUserId);
  });

  it('aceita qualquer JSON (string, número, booleano, array) exceto null', async () => {
    for (const [name, value] of [['str', 'texto'], ['num', 42], ['bool', false], ['arr', [1, 'a']]] as const) {
      const res = await api('put', `/${key(name)}`, platformToken).send({ value }).expect(200);
      assert.deepEqual(res.body.value, value);
    }
  });

  it('segredo: grava, mas lista, GET /:key e PUT devolvem value null + hasValue true', async () => {
    const k = key('secret');
    const put = await api('put', `/${k}`, platformToken).send({ value: SECRET_VALUE, isSecret: true }).expect(200);
    assert.equal(put.body.value, null);
    assert.equal(put.body.isSecret, true);
    assert.equal(put.body.hasValue, true);

    const row = await prisma.platformSetting.findUniqueOrThrow({ where: { key: k } });
    assert.deepEqual(row.value, SECRET_VALUE, 'o valor real está no banco');

    const got = await api('get', `/${k}`, platformToken).expect(200);
    assert.equal(got.body.value, null);
    assert.equal(got.body.hasValue, true);
    assert.ok(!JSON.stringify(got.body).includes('NUNCA_VAZAR'));

    const list = await api('get', `?q=${encodeURIComponent(PREFIX)}&limit=200`, platformToken).expect(200);
    const item = list.body.find((s: { key: string }) => s.key === k);
    assert.ok(item);
    assert.equal(item.value, null);
    assert.equal(item.hasValue, true);
    assert.ok(!JSON.stringify(list.body).includes('NUNCA_VAZAR'), 'segredo nunca aparece na lista');
    // Os não-secretos continuam com valor na mesma lista.
    const plain = list.body.find((s: { key: string }) => s.key === key('plain'));
    assert.deepEqual(plain.value, { theme: 'dark', n: [1, 2] });
  });

  it('upsert: PUT existente atualiza; isSecret omitido mantém, isSecret:false desmascara', async () => {
    const k = key('secret');
    const kept = await api('put', `/${k}`, platformToken).send({ value: { apiKey: 'novo' } }).expect(200);
    assert.equal(kept.body.isSecret, true);
    assert.equal(kept.body.value, null);
    const row = await prisma.platformSetting.findUniqueOrThrow({ where: { key: k } });
    assert.deepEqual(row.value, { apiKey: 'novo' });

    const unmasked = await api('put', `/${k}`, platformToken).send({ value: 'agora-publico', isSecret: false }).expect(200);
    assert.equal(unmasked.body.isSecret, false);
    assert.equal(unmasked.body.value, 'agora-publico');
    assert.equal(await prisma.platformSetting.count({ where: { key: k } }), 1, 'upsert não duplica a chave');
  });

  it('lista: q em key, paginação e X-Total-Count batem com o Prisma', async () => {
    const expected = await prisma.platformSetting.count({ where: { key: { contains: PREFIX, mode: 'insensitive' } } });
    assert.ok(expected >= 6);

    const all = await api('get', `?q=${encodeURIComponent(PREFIX.toUpperCase())}&limit=200`, platformToken).expect(200);
    assert.equal(Number(all.headers['x-total-count']), expected);
    assert.equal(all.body.length, expected);
    assert.deepEqual(
      all.body.map((s: { key: string }) => s.key),
      [...all.body.map((s: { key: string }) => s.key)].sort(),
      'ordenada por key',
    );

    const page = await api('get', `?q=${encodeURIComponent(PREFIX)}&limit=2&offset=1`, platformToken).expect(200);
    assert.equal(page.body.length, 2);
    assert.equal(Number(page.headers['x-total-count']), expected);
    assert.deepEqual(
      page.body.map((s: { key: string }) => s.key),
      all.body.slice(1, 3).map((s: { key: string }) => s.key),
    );

    const none = await api('get', `?q=${encodeURIComponent(PREFIX)}-nao-existe`, platformToken).expect(200);
    assert.deepEqual(none.body, []);
    assert.equal(none.headers['x-total-count'], '0');

    await api('get', '?limit=0', platformToken).expect(400);
    await api('get', '?foo=1', platformToken).expect(400);
  });

  it('chave inválida => 400 (PUT, GET e DELETE)', async () => {
    const invalid = ['UPPER', 'com espaco', 'a$b', 'x'.repeat(101), 'acentu%C3%A7%C3%A3o'];
    for (const bad of invalid) {
      const path = `/${bad.includes('%') ? bad : encodeURIComponent(bad)}`;
      await api('put', path, platformToken).send({ value: 1 }).expect(400);
      await api('get', path, platformToken).expect(400);
      await api('delete', path, platformToken).expect(400);
    }
    // limites válidos: 1 e 100 caracteres, com . _ -
    const k100 = `${PREFIX}-`.padEnd(100, 'a');
    assert.equal(k100.length, 100);
    await api('put', `/${k100}`, platformToken).send({ value: 1 }).expect(200);
    await api('put', `/${key('a_b-c.d')}`, platformToken).send({ value: 1 }).expect(200);
  });

  it('corpo inválido => 400 (value ausente/null, campo extra, isSecret não booleano, > ~10KB)', async () => {
    const k = key('invalid-body');
    await api('put', `/${k}`, platformToken).send({}).expect(400);
    await api('put', `/${k}`, platformToken).send({ value: null }).expect(400);
    await api('put', `/${k}`, platformToken).send({ value: 1, extra: true }).expect(400);
    await api('put', `/${k}`, platformToken).send({ value: 1, isSecret: 'sim' }).expect(400);
    await api('put', `/${k}`, platformToken).send({ value: 'x'.repeat(10 * 1024) }).expect(400); // 10240 + 2 aspas
    await api('put', `/${k}`, platformToken).send({ value: { blob: 'x'.repeat(20 * 1024) } }).expect(400);
    await api('put', `/${k}`, platformToken).send({ value: 'x'.repeat(10 * 1024 - 2) }).expect(200); // exatamente 10240 bytes
    assert.equal(await prisma.platformSetting.count({ where: { key: k } }), 1);
  });

  it('DELETE remove (200), repetir => 404 e GET => 404', async () => {
    const k = key('to-delete');
    await api('put', `/${k}`, platformToken).send({ value: 'x' }).expect(200);
    const del = await api('delete', `/${k}`, platformToken).expect(200);
    assert.deepEqual(del.body, { key: k, deleted: true });
    assert.equal(await prisma.platformSetting.count({ where: { key: k } }), 0);
    await api('delete', `/${k}`, platformToken).expect(404);
    await api('get', `/${k}`, platformToken).expect(404);
  });
});
