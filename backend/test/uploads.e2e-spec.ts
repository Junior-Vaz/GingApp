import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import request from 'supertest';
import { ALUNO_EMAIL, MESTRE_EMAIL, loginAs } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Upload de imagens (disco local, sem servico externo). Grava num diretorio temporario proprio
 * (UPLOADS_DIR) e apaga no after() tanto os arquivos quanto as linhas Upload e o aluno que cria.
 * Nao altera o seed ginga-brasil (so loga com as contas dele).
 */
describe('Upload de imagens (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let dir = '';
  let mestre: Awaited<ReturnType<typeof loginAs>>;
  let aluno: Awaited<ReturnType<typeof loginAs>>;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const filenames: string[] = [];
  const studentIds: number[] = [];

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-uploads-e2e-'));
    process.env.UPLOADS_DIR = dir;
    app = await createTestApp({ disableThrottle: true });
    mestre = await loginAs(app, MESTRE_EMAIL);
    aluno = await loginAs(app, ALUNO_EMAIL);
  });

  after(async () => {
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    await prisma.upload.deleteMany({ where: { filename: { in: filenames } } });
    await fs.rm(dir, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
    await prisma.$disconnect();
    await app.close();
  });

  const jpeg = (width = 800, height = 600) =>
    sharp({ create: { width, height, channels: 3, background: '#d33' } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'segredo-exif' } } })
      .toBuffer();

  it('envio feliz: devolve /api/uploads/<uuid>.webp, grava Upload do grupo e o GET publico devolve a imagem com cache longo e nosniff', async () => {
    const res = await http()
      .post('/api/uploads')
      .set(auth(mestre.token))
      .attach('file', await jpeg(), { filename: '../../foto-do-cliente.jpg', contentType: 'image/jpeg' })
      .expect(201);
    assert.match(res.body.url, /^\/api\/uploads\/[0-9a-f-]{36}\.webp$/);
    assert.ok(!res.body.url.includes('foto-do-cliente'), 'nunca usa o nome do cliente');
    filenames.push(res.body.filename);

    const row = await prisma.upload.findUnique({ where: { filename: res.body.filename } });
    assert.equal(row?.organizationId, mestre.organizationId);
    assert.equal(row?.userId, mestre.userId);
    assert.equal(row?.mimeType, 'image/webp');

    const got = await http().get(res.body.url).buffer(true).expect(200); // sem token: publico
    assert.equal(got.headers['content-type'], 'image/webp');
    assert.match(got.headers['cache-control'], /max-age=31536000/);
    assert.equal(got.headers['x-content-type-options'], 'nosniff');
    const meta = await sharp(got.body as Buffer).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.exif, undefined, 'EXIF removido');
  });

  it('imagem grande e reduzida a 1600px no maior lado; o ALUNO tambem pode enviar (foto de perfil no app)', async () => {
    const big = await sharp({ create: { width: 3200, height: 1800, channels: 3, background: '#36c' } }).png().toBuffer();
    const res = await http()
      .post('/api/uploads')
      .set(auth(aluno.token))
      .attach('file', big, { filename: 'grande.png', contentType: 'image/png' })
      .expect(201);
    filenames.push(res.body.filename);
    assert.equal(res.body.width, 1600);
    assert.equal(res.body.height, 900);
  });

  it('tipo invalido por MAGIC BYTES: texto/HTML/SVG com mimetype e extensao de imagem => 415; sem arquivo => 400', async () => {
    const fake = Buffer.from('<html><script>alert(1)</script></html> conteudo falso de imagem');
    await http()
      .post('/api/uploads')
      .set(auth(mestre.token))
      .attach('file', fake, { filename: 'foto.jpg', contentType: 'image/jpeg' })
      .expect(415);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>1</script></svg>');
    await http().post('/api/uploads').set(auth(mestre.token)).attach('file', svg, { filename: 'a.png', contentType: 'image/png' }).expect(415);
    await http().post('/api/uploads').set(auth(mestre.token)).field('x', '1').expect(400);
    // assinatura valida mas conteudo corrompido: recusado ao reprocessar
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
    await http().post('/api/uploads').set(auth(mestre.token)).attach('file', broken, { filename: 'q.jpg', contentType: 'image/jpeg' }).expect(400);
  });

  it('tamanho excedido (> 5 MB) => 413 e nada e gravado', async () => {
    const before = (await fs.readdir(dir)).length;
    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5 * 1024 * 1024 + 10, 1)]);
    await http().post('/api/uploads').set(auth(mestre.token)).attach('file', huge, { filename: 'enorme.jpg', contentType: 'image/jpeg' }).expect(413);
    assert.equal((await fs.readdir(dir)).length, before);
  });

  it('sem token => 401', async () => {
    await http().post('/api/uploads').attach('file', await jpeg(50, 50), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(401);
  });

  it('GET: nome fora do formato, path traversal e listagem do diretorio => 404; arquivo inexistente => 404', async () => {
    await http().get('/api/uploads').expect(404);
    await http().get('/api/uploads/..%2F..%2Fpackage.json').expect(404);
    await http().get('/api/uploads/%2e%2e%2f%2e%2e%2f.env').expect(404);
    await http().get('/api/uploads/nao-e-uuid.webp').expect(404);
    await http().get('/api/uploads/00000000-0000-4000-8000-000000000000.webp').expect(404);
  });

  it('campos de imagem aceitam o caminho do upload e URL http(s); recusam outros valores', async () => {
    const up = await http().post('/api/uploads').set(auth(mestre.token)).attach('file', await jpeg(100, 100), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(201);
    filenames.push(up.body.filename);
    const created = await http().post('/api/students').set(auth(mestre.token)).send({ name: '[e2e-upload] Aluno', photo: up.body.url }).expect(201);
    studentIds.push(created.body.id);
    assert.equal(created.body.photo, up.body.url);
    await http().patch(`/api/students/${created.body.id}`).set(auth(mestre.token)).send({ photo: 'https://exemplo.com/foto.png' }).expect(200);
    await http().patch(`/api/students/${created.body.id}`).set(auth(mestre.token)).send({ photo: '/api/uploads/../../etc/passwd' }).expect(400);
    await http().patch(`/api/students/${created.body.id}`).set(auth(mestre.token)).send({ photo: 'javascript:alert(1)' }).expect(400);
  });
});
