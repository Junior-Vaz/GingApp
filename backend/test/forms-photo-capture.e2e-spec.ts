import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import request from 'supertest';
import { issueStartedToken } from '../src/interface/http/registration-forms/form-codes';
import { setSharpForTests } from '../src/interface/http/registration-forms/private-storage';
import { DEV_PASSWORD } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * CAPTURA do JSON REAL do formulario publico com o campo "Foto do participante" (PHOTO), para virar fixture do app
 * (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md secoes 2 e 7). Monta um formulario de inscricao com PHOTO obrigatorio e um FILE,
 * faz o GET publico, o upload da foto (PNG gerado em memoria), o upload do arquivo e o envio, e provoca os erros de
 * upload que o app trata (413, 415, 429, 503) e os de envio (foto obrigatoria ausente, token invalido).
 * Com FORM_CAPTURE_DIR definido grava os JSONs reais (o corpo exato da resposta) nessa pasta. Tudo o que cria usa o
 * dominio @e2e-formcap.local / grupo "E2E formcap" e e apagado no after(). Nao toca no seed.
 */
const DOMAIN = '@e2e-formcap.local';

describe('Captura do formulário público com foto do participante (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  let uploadsDir = '';
  let privateDir = '';
  let orgId = 0;
  let mestre = '';
  const captures: Record<string, unknown> = {};
  let formConsentVersion = 1;
  const consentVersion = () => formConsentVersion;

  before(async () => {
    uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-formcap-pub-'));
    privateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-formcap-priv-'));
    process.env.UPLOADS_DIR = uploadsDir;
    process.env.PRIVATE_UPLOADS_DIR = privateDir;
    app = await createTestApp();
    orgId = (await prisma.organization.create({ data: { name: `E2E formcap ${stamp}`, slug: `e2e-formcap-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE } })).id;
    const user = await prisma.user.create({
      data: { email: `mestre-${stamp}${DOMAIN}`, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: '[e2e-formcap] mestre', userType: 'MEMBER' },
    });
    await prisma.organizationUser.create({ data: { organizationId: orgId, userId: user.id, role: OrgRole.MESTRE, status: 'ACTIVE' } });
    const login = await http().post('/api/auth/login').send({ email: user.email, password: DEV_PASSWORD }).expect(200);
    mestre = login.body.accessToken as string;
  });

  after(async () => {
    setSharpForTests(undefined);
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: orgId }, { userId: { in: users.map((u) => u.id) } }] } });
    await prisma.registrationSubmissionFile.deleteMany({ where: { organizationId: orgId } });
    await prisma.registrationSubmission.deleteMany({ where: { organizationId: orgId } });
    await prisma.registrationForm.deleteMany({ where: { organizationId: orgId } });
    await prisma.notification.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await fs.rm(uploadsDir, { recursive: true, force: true });
    await fs.rm(privateDir, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
    delete process.env.PRIVATE_UPLOADS_DIR;
    await prisma.$disconnect();
    await app.close();
  });

  const definition = {
    sections: [{ title: 'Dados do atleta' }, { title: 'Foto e comprovante' }],
    fields: [
      { key: 'nome', type: 'SHORT_TEXT', label: 'Nome completo', required: true, mapsTo: 'name', sectionIndex: 0 },
      { key: 'nascimento', type: 'DATE', label: 'Data de nascimento', required: true, mapsTo: 'birthDate', sectionIndex: 0 },
      { key: 'email', type: 'EMAIL', label: 'E-mail', required: true, mapsTo: 'email', sectionIndex: 0 },
      { key: 'categoria', type: 'SELECT', label: 'Categoria', required: true, options: ['Adulto até 70 kg', 'Adulto acima de 70 kg', 'Infantil'], sectionIndex: 0 },
      {
        key: 'foto',
        type: 'PHOTO',
        label: 'Foto do participante',
        required: true,
        helpText: 'Foto de rosto, bem iluminada. Para menores, tirada ou enviada pelo responsável.',
        sectionIndex: 1,
      },
      { key: 'comprovante', type: 'FILE', label: 'Comprovante do Pix', required: false, helpText: 'Foto ou PDF do comprovante.', sectionIndex: 1 },
    ],
  };

  const openForm = async (title: string, def: Record<string, unknown>) => {
    const created = await http().post('/api/event-forms').set(auth(mestre)).send({ title }).expect(201);
    await http().put(`/api/event-forms/${created.body.id}`).set(auth(mestre)).send(def).expect(200);
    const opened = await http().post(`/api/event-forms/${created.body.id}/open`).set(auth(mestre)).expect(200);
    return opened.body as { id: number; slug: string };
  };
  const upload = (slug: string, buf: Buffer, fieldKey: string, filename: string, contentType: string) =>
    http().post(`/api/public/forms/${slug}/files`).field('fieldKey', fieldKey).attach('file', buf, { filename, contentType });
  const submit = (slug: string, answers: Record<string, unknown>) =>
    http().post(`/api/public/forms/${slug}/submissions`).send({ answers, consent: true, consentVersion: consentVersion(), hp: '', startedToken: issueStartedToken(slug, Date.now() - 5000) });
  const keys = (value: unknown): string[] => Object.keys(value as Record<string, unknown>).sort();

  it('GET público com PHOTO, upload da foto/arquivo, envio e erros: grava o JSON real (FORM_CAPTURE_DIR)', async () => {
    const form = await openForm(`Campeonato formcap ${stamp}`, definition);

    // ---- GET público: o campo PHOTO chega como qualquer outro (type 'PHOTO', required, helpText, sem mapsTo/validation) ----
    const got = await http().get(`/api/public/forms/${form.slug}`).expect(200);
    const photoField = got.body.fields.find((f: { key: string }) => f.key === 'foto');
    assert.equal(photoField.type, 'PHOTO');
    assert.equal(photoField.required, true);
    assert.equal(photoField.mapsTo, null);
    assert.match(photoField.helpText, /rosto/);
    assert.equal(got.body.fields.find((f: { key: string }) => f.key === 'comprovante').type, 'FILE');
    captures['publicFormWithPhoto'] = got.body;
    formConsentVersion = Number(got.body.consent.version);

    // modelo CAMPEONATO: a foto opcional nasce nele (a publicacao do modelo exige configuracao propria; coberto em registration-photo.e2e-spec.ts)

    // ---- upload da foto (PNG gerado em memoria) e do arquivo ----
    const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#2d6a4f' } }).png().toBuffer();
    const photo = await upload(form.slug, png, 'foto', 'IMG_Joao_da_Silva.png', 'image/png').expect(201);
    assert.deepEqual(keys(photo.body), ['fileToken', 'mimeType', 'originalName', 'sizeBytes']);
    assert.equal(photo.body.originalName, 'foto.webp');
    assert.equal(photo.body.mimeType, 'image/webp');
    captures['uploadPhoto201'] = photo.body;

    const proof = await upload(form.slug, png, 'comprovante', 'comprovante.png', 'image/png').expect(201);
    assert.deepEqual(keys(proof.body), ['fileToken', 'mimeType', 'originalName', 'sizeBytes']);
    captures['uploadFile201'] = proof.body;

    // ---- erros de upload da foto ----
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const notAllowed = await upload(form.slug, pdf, 'foto', 'a.pdf', 'application/pdf').expect(415);
    assert.equal(notAllowed.body.code, 'FILE_TYPE_NOT_ALLOWED');
    captures['uploadPhoto415Pdf'] = notAllowed.body;

    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
    const unreadable = await upload(form.slug, broken, 'foto', 'a.jpg', 'image/jpeg').expect(415);
    assert.equal(unreadable.body.code, 'FILE_TYPE_NOT_ALLOWED');
    captures['uploadPhoto415Unreadable'] = unreadable.body;

    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5 * 1024 * 1024 + 10, 1)]);
    const tooLarge = await upload(form.slug, huge, 'foto', 'a.jpg', 'image/jpeg').expect(413);
    assert.equal(tooLarge.body.code, 'FILE_TOO_LARGE');
    captures['uploadPhoto413'] = tooLarge.body;

    setSharpForTests(null);
    try {
      const unavailable = await upload(form.slug, png, 'foto', 'a.png', 'image/png').expect(503);
      assert.equal(unavailable.body.code, 'PHOTO_PROCESSING_UNAVAILABLE');
      captures['uploadPhoto503'] = unavailable.body;
    } finally {
      setSharpForTests(undefined);
    }

    const old = process.env.FORMS_PENDING_FILES_PER_IP;
    process.env.FORMS_PENDING_FILES_PER_IP = '1';
    try {
      // este formulario ja tem 2 pendentes do mesmo IP: o teto de 1 recusa o proximo
      const tooMany = await upload(form.slug, png, 'foto', 'a.png', 'image/png').expect(429);
      assert.equal(tooMany.body.code, 'TOO_MANY_REQUESTS');
      captures['uploadPhoto429'] = tooMany.body;
    } finally {
      if (old === undefined) delete process.env.FORMS_PENDING_FILES_PER_IP;
      else process.env.FORMS_PENDING_FILES_PER_IP = old;
    }

    // ---- envio: foto obrigatoria ausente (400 VALIDATION com fields.foto) e token invalido ----
    const base = { nome: 'Rafaela Souza', nascimento: '1995-04-12', email: `rafaela-${stamp}${DOMAIN}`, categoria: 'Adulto até 70 kg' };
    const missing = await submit(form.slug, base).expect(400);
    assert.equal(missing.body.code, 'VALIDATION');
    assert.ok(missing.body.fields.foto, 'foto obrigatória ausente');
    captures['submission400PhotoMissing'] = missing.body;

    const badToken = await submit(form.slug, { ...base, foto: { fileToken: 'token-que-nao-existe' } }).expect(400);
    assert.ok(badToken.body.fields.foto);
    captures['submission400PhotoInvalidToken'] = badToken.body;

    // ---- envio de verdade: so o fileToken da foto (e do comprovante) ----
    const sent = await submit(form.slug, { ...base, foto: { fileToken: photo.body.fileToken }, comprovante: { fileToken: proof.body.fileToken } }).expect(201);
    assert.ok(sent.body.protocol);
    captures['submission201'] = sent.body;
    const row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: sent.body.protocol }, include: { files: true } });
    assert.deepEqual(
      row.files.map((f) => f.fieldKey).sort(),
      ['comprovante', 'foto'],
    );
    // o token da foto nao serve duas vezes
    const reuse = await submit(form.slug, { ...base, email: `outra-${stamp}${DOMAIN}`, foto: { fileToken: photo.body.fileToken } }).expect(400);
    assert.ok(reuse.body.fields.foto);

    const dir = process.env.FORM_CAPTURE_DIR;
    if (dir) {
      await fs.mkdir(dir, { recursive: true });
      for (const [name, body] of Object.entries(captures)) {
        await fs.writeFile(path.join(dir, `${name}.json`), `${JSON.stringify(body, null, 2)}\n`, 'utf8');
      }
    }
  });
});
