import { INestApplication } from '@nestjs/common';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { assertMatchObject } from './utils/assert-helpers';

/**
 * Reaproveita os usuários do seed de desenvolvimento (prisma/seed.ts, garantido pelo
 * global-setup.ts desta suíte) em vez de criar fixtures próprias — são dados estáveis e
 * já usados manualmente durante o desenvolvimento (PLANO_PROJETO.md §10.2).
 */
const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';
const PLATFORM_EMAIL = 'owner@gingapp.com.br';
const DEV_PASSWORD = 'Dev@12345';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  before(async () => {
    app = await createTestApp();
  });

  after(async () => {
    await app.close();
  });

  it('POST /auth/login com credenciais válidas de MEMBER retorna token + dados do usuário', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: MESTRE_EMAIL, password: DEV_PASSWORD })
      .expect(200);

    assert.equal(typeof res.body.accessToken, 'string');
    assertMatchObject(res.body.user, { email: MESTRE_EMAIL, userType: 'MEMBER', role: 'MESTRE' });
    assert.equal(typeof res.body.user.organizationId, 'number');
  });

  it('login e GET /auth/me trazem `photo` (null ou string) e o nome do grupo, sem vazar segredos', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: MESTRE_EMAIL, password: DEV_PASSWORD })
      .expect(200);
    assert.ok('photo' in login.body.user, 'login deve devolver photo');
    assert.ok(login.body.user.photo === null || typeof login.body.user.photo === 'string');
    assert.equal(typeof login.body.user.organizationName, 'string');
    assert.equal('passwordHash' in login.body.user, false);

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    assert.ok('photo' in me.body);
    assert.equal(me.body.organizationName, login.body.user.organizationName);
    assert.equal('passwordHash' in me.body, false);
  });

  it('POST /auth/login com senha errada retorna 401 com mensagem genérica', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: MESTRE_EMAIL, password: 'senha-errada-qualquer' })
      .expect(401);

    assert.equal(res.body.message, 'Credenciais inválidas.');
  });

  it('POST /auth/login com e-mail inexistente retorna a MESMA mensagem genérica (não vaza existência)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nao-existe@gingabrasil.com.br', password: DEV_PASSWORD })
      .expect(401);

    assert.equal(res.body.message, 'Credenciais inválidas.');
  });

  it('POST /auth/platform-login com uma conta MEMBER (não PLATFORM) é rejeitado', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/platform-login')
      .send({ email: ALUNO_EMAIL, password: DEV_PASSWORD })
      .expect(401);
  });

  it('POST /auth/login com uma conta PLATFORM (não MEMBER) é rejeitado', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: PLATFORM_EMAIL, password: DEV_PASSWORD })
      .expect(401);
  });

  it('POST /auth/platform-login com credenciais válidas de PLATFORM retorna token de super admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/platform-login')
      .send({ email: PLATFORM_EMAIL, password: DEV_PASSWORD })
      .expect(200);

    assertMatchObject(res.body.user, { userType: 'PLATFORM', isSuperAdmin: true });
  });

  it('rota protegida sem token retorna 401', async () => {
    await request(app.getHttpServer()).get('/api/organizations').expect(401);
  });

  it('rota pública (rodas) não exige token', async () => {
    await request(app.getHttpServer()).get('/api/rodas').expect(200);
  });
});
