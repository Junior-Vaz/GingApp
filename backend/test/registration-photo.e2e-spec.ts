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
import { randomUUID } from 'node:crypto';
import { FormsRetentionCronService } from '../src/jobs/forms-retention-cron.service';
import { AuditService } from '../src/shared/audit/audit.service';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { CompetitorAnonymizer } from '../src/shared/privacy/competitor-anonymizer';
import { issueStartedToken } from '../src/interface/http/registration-forms/form-codes';
import { setSharpForTests } from '../src/interface/http/registration-forms/private-storage';
import { RegistrationPhotoSource } from '../src/interface/http/registration-forms/registration-photo-source.service';
import { TOURNAMENT_PHOTO_SOURCE } from '../src/interface/http/tournaments/tournament-photo-source';
import { TournamentsService } from '../src/interface/http/tournaments/tournaments.service';
import { DEV_PASSWORD } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Campo "Foto do participante" (PHOTO) dos formularios de inscricao + provedor de foto do chaveamento
 * (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md secoes 2 e 7). Grupos, usuarios e diretorios PROPRIOS (UPLOADS_DIR e
 * PRIVATE_UPLOADS_DIR temporarios); nao toca no seed. Limpa tudo no after().
 */
const DOMAIN = '@e2e-regphoto.local';

describe('Foto do participante nos formulários + provedor do chaveamento (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  let uploadsDir = '';
  let privateDir = '';
  let orgA = 0;
  let orgB = 0;
  let mestre = '';
  let professor = '';
  let mestreB = '';
  let seq = 0;
  const email = (tag: string) => `${tag}-${stamp}-${++seq}${DOMAIN}`;
  const startedToken = (slug: string) => issueStartedToken(slug, Date.now() - 5000);

  const login = async (address: string) => (await http().post('/api/auth/login').send({ email: address, password: DEV_PASSWORD }).expect(200)).body.accessToken as string;
  const member = async (org: number, role: OrgRole, tag: string) => {
    const user = await prisma.user.create({
      data: { email: `${tag}-${stamp}${DOMAIN}`, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `[e2e-regphoto] ${tag}`, userType: 'MEMBER' },
    });
    await prisma.organizationUser.create({ data: { organizationId: org, userId: user.id, role, status: 'ACTIVE' } });
    return login(user.email);
  };

  const baseFields = [
    { key: 'nome', type: 'SHORT_TEXT', label: 'Nome', required: true, mapsTo: 'name', sectionIndex: 0 },
    { key: 'email', type: 'EMAIL', label: 'E-mail', required: true, mapsTo: 'email', sectionIndex: 0 },
    { key: 'nascimento', type: 'DATE', label: 'Nascimento', mapsTo: 'birthDate', sectionIndex: 0 },
  ];
  const photoField = (required = false) => ({ key: 'foto', type: 'PHOTO', label: 'Foto do participante', required, sectionIndex: 0 });
  const definition = (extra: Array<Record<string, unknown>> = [photoField()]) => ({ sections: [{ title: 'Dados' }], fields: [...baseFields, ...extra] });

  /** Formulario PUBLICADO (opcionalmente ligado a um evento), com a definicao dada. */
  const openForm = async (def: Record<string, unknown>, opts: { token?: string; eventId?: number } = {}) => {
    const token = opts.token ?? mestre;
    const created = await http()
      .post('/api/event-forms')
      .set(auth(token))
      .send({ title: `Form foto ${++seq}`, ...(opts.eventId ? { eventId: opts.eventId } : {}) })
      .expect(201);
    await http().put(`/api/event-forms/${created.body.id}`).set(auth(token)).send(def).expect(200);
    const opened = await http().post(`/api/event-forms/${created.body.id}/open`).set(auth(token)).expect(200);
    return opened.body as { id: number; slug: string };
  };
  const upload = (slug: string, buf: Buffer, fieldKey = 'foto', filename = 'foto.jpg', contentType = 'image/jpeg') =>
    http().post(`/api/public/forms/${slug}/files`).field('fieldKey', fieldKey).attach('file', buf, { filename, contentType });
  const submit = (slug: string, answers: Record<string, unknown>) =>
    http().post(`/api/public/forms/${slug}/submissions`).send({ answers, consent: true, hp: '', startedToken: startedToken(slug) });
  const bigJpegWithExif = () =>
    sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#3a6' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'SEGREDO-GPS-FOTO', Artist: 'Pessoa Real' } })
      .toBuffer();
  const smallJpeg = () => sharp({ create: { width: 60, height: 40, channels: 3, background: '#a33' } }).jpeg().toBuffer();
  const privateFiles = async (): Promise<string[]> => {
    const out: string[] = [];
    for (const dir of await fs.readdir(privateDir).catch(() => [] as string[])) {
      for (const f of await fs.readdir(path.join(privateDir, dir)).catch(() => [] as string[])) out.push(`${dir}/${f}`);
    }
    return out;
  };

  before(async () => {
    uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-regphoto-pub-'));
    privateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-regphoto-priv-'));
    process.env.UPLOADS_DIR = uploadsDir;
    process.env.PRIVATE_UPLOADS_DIR = privateDir;
    app = await createTestApp();
    orgA = (await prisma.organization.create({ data: { name: `E2E regphoto A ${stamp}`, slug: `e2e-regphoto-a-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE } })).id;
    orgB = (await prisma.organization.create({ data: { name: `E2E regphoto B ${stamp}`, slug: `e2e-regphoto-b-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE } })).id;
    mestre = await member(orgA, OrgRole.MESTRE, 'mestre');
    professor = await member(orgA, OrgRole.PROFESSOR, 'professor');
    mestreB = await member(orgB, OrgRole.MESTRE, 'mestreb');
  });

  after(async () => {
    setSharpForTests(undefined);
    const orgs = [orgA, orgB].filter(Boolean);
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: orgs } }, { userId: { in: users.map((u) => u.id) } }] } });
    await prisma.registrationSubmissionFile.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.registrationSubmission.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.registrationForm.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.eventParticipant.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.event.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.notification.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
    await fs.rm(uploadsDir, { recursive: true, force: true });
    await fs.rm(privateDir, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
    delete process.env.PRIVATE_UPLOADS_DIR;
    await prisma.$disconnect();
    await app.close();
  });

  it('definição: PHOTO aceito; 2º campo PHOTO = 400 (erro de definição claro); sem mapsTo; não pode ser fonte de condição; sem validação/opções', async () => {
    const created = await http().post('/api/event-forms').set(auth(mestre)).send({ title: 'Definição de foto' }).expect(201);
    const put = (fields: unknown[]) => http().put(`/api/event-forms/${created.body.id}`).set(auth(mestre)).send({ sections: [], fields });

    const ok = await put([{ key: 'foto', type: 'PHOTO', label: 'Foto do participante', required: true }]).expect(200);
    assert.equal(ok.body.fields[0].type, 'PHOTO');
    assert.equal(ok.body.fields[0].required, true, 'required funciona como no FILE');

    let res = await put([{ key: 'foto', type: 'PHOTO', label: 'Foto' }, { key: 'foto2', type: 'PHOTO', label: 'Outra foto' }]).expect(400);
    assert.match(res.body.fields.foto2, /1 campo de foto/);
    res = await put([{ key: 'foto', type: 'PHOTO', label: 'Foto', mapsTo: 'name' }]).expect(400);
    assert.match(res.body.fields.foto, /mapeado/);
    res = await put([{ key: 'foto', type: 'PHOTO', label: 'Foto' }, { key: 'outro', type: 'SHORT_TEXT', label: 'Outro', showIf: { fieldKey: 'foto', equals: 'x' } }]).expect(400);
    assert.match(res.body.fields.outro, /foto/);
    res = await put([{ key: 'foto', type: 'PHOTO', label: 'Foto', options: ['a', 'b'] }]).expect(400);
    assert.ok(res.body.fields.foto);
    res = await put([{ key: 'foto', type: 'PHOTO', label: 'Foto', validation: { maxLength: 3 } }]).expect(400);
    assert.ok(res.body.fields.foto);
    // 1 PHOTO + 5 FILE continua valendo (os limites sao independentes)
    await put([
      { key: 'foto', type: 'PHOTO', label: 'Foto' },
      ...Array.from({ length: 5 }, (_, i) => ({ key: `f${i}`, type: 'FILE', label: `Arquivo ${i}` })),
    ]).expect(200);
  });

  it('modelo CAMPEONATO ganha a Foto do participante (opcional, com o texto de ajuda); os outros modelos não mudam', async () => {
    const campeonato = await http().post('/api/event-forms').set(auth(mestre)).send({ title: 'Campeonato com foto', template: 'CAMPEONATO' }).expect(201);
    const foto = campeonato.body.fields.find((f: { key: string }) => f.key === 'foto_participante');
    assert.equal(foto.type, 'PHOTO');
    assert.equal(foto.required, false);
    assert.equal(foto.mapsTo, null);
    assert.match(foto.helpText, /rosto/);
    assert.match(foto.helpText, /responsável/);
    for (const template of ['BATIZADO', 'CURSO', 'RODA', 'SIMPLES']) {
      const other = await http().post('/api/event-forms').set(auth(mestre)).send({ title: `Sem foto ${template}`, template }).expect(201);
      assert.ok(!other.body.fields.some((f: { type: string }) => f.type === 'PHOTO'), template);
    }
    // o painel devolve a definicao como veio e ela continua valida (1 PHOTO)
    await http()
      .put(`/api/event-forms/${campeonato.body.id}`)
      .set(auth(mestre))
      .send({
        sections: campeonato.body.sections.map((s: { id: number; title: string }) => ({ id: s.id, title: s.title })),
        fields: campeonato.body.fields.map((f: Record<string, unknown>) => ({ key: f.key, type: f.type, label: f.label, helpText: f.helpText, required: f.required, options: f.options, showIf: f.showIf, mapsTo: f.mapsTo, sectionId: f.sectionId })),
      })
      .expect(200);
  });

  it('upload da foto: só imagem; WebP lado maior 1200 sem EXIF; nome fixo; PDF/HEIC/GIF/SVG/HTML/ilegível = 415; FILE continua aceitando PDF', async () => {
    const form = await openForm(definition([photoField(), { key: 'comprovante', type: 'FILE', label: 'Comprovante', sectionIndex: 0 }]));
    const input = await bigJpegWithExif();
    assert.ok((await sharp(input).metadata()).exif, 'a entrada TEM EXIF');

    const ok = await upload(form.slug, input, 'foto', '../../Joao_da_Silva_RG.jpg').expect(201);
    assert.match(ok.body.fileToken, /^[A-Za-z0-9_-]{40,}$/);
    assert.equal(ok.body.mimeType, 'image/webp');
    assert.equal(ok.body.originalName, 'foto.webp', 'o nome do celular (pode ter o nome da pessoa) nunca e guardado');
    const row = await prisma.registrationSubmissionFile.findFirstOrThrow({ where: { formId: form.id, fieldKey: 'foto' } });
    assert.match(row.storageKey, /^org-\d+\/[0-9a-f-]{36}\.webp$/);
    assert.equal(row.mimeType, 'image/webp');
    assert.notEqual(row.pendingToken, ok.body.fileToken, 'so o hash do token vai ao banco');
    const stored = await fs.readFile(path.join(privateDir, ...row.storageKey.split('/')));
    const meta = await sharp(stored).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(Math.max(meta.width ?? 0, meta.height ?? 0), 1200, 'lado maior 1200');
    assert.equal(meta.exif, undefined, 'EXIF/GPS removido');
    assert.equal(row.sizeBytes, stored.length);
    // o arquivo NAO e servido pela rota publica de imagens
    await http().get(`/api/uploads/${row.storageKey.split('/')[1]}`).expect(404);

    // PNG e WebP de entrada tambem viram WebP; imagem pequena nao e ampliada
    const png = await sharp({ create: { width: 50, height: 30, channels: 3, background: '#09f' } }).png().toBuffer();
    const fromPng = await upload(form.slug, png, 'foto', 'a.png', 'image/png').expect(201);
    assert.equal(fromPng.body.mimeType, 'image/webp');
    const pngRow = await prisma.registrationSubmissionFile.findFirstOrThrow({ where: { formId: form.id, fieldKey: 'foto' }, orderBy: { id: 'desc' } });
    assert.equal((await sharp(await fs.readFile(path.join(privateDir, ...pngRow.storageKey.split('/')))).metadata()).width, 50);

    // 415 FILE_TYPE_NOT_ALLOWED (por magic bytes, nunca pelo mimetype/extensao informados)
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(32, 1)]);
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40, 1)]);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>1</script></svg>');
    const html = Buffer.from('<html><body>falsa foto</body></html>');
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]); // assinatura JPEG, conteudo ilegivel
    const before = (await privateFiles()).length;
    for (const [name, buf, mime] of [
      ['pdf', pdf, 'application/pdf'],
      ['heic', heic, 'image/heic'],
      ['gif', gif, 'image/gif'],
      ['svg', svg, 'image/jpeg'],
      ['html', html, 'image/jpeg'],
      ['ilegivel', broken, 'image/jpeg'],
    ] as const) {
      const res = await upload(form.slug, buf, 'foto', `a.${name}`, mime).expect(415);
      assert.equal(res.body.code, 'FILE_TYPE_NOT_ALLOWED', name);
    }
    assert.equal((await privateFiles()).length, before, 'nada gravado nos recusados');
    // o campo FILE comum continua aceitando PDF (comportamento antigo)
    const pdfOk = await upload(form.slug, pdf, 'comprovante', 'c.pdf', 'application/pdf').expect(201);
    assert.equal(pdfOk.body.mimeType, 'application/pdf');
    // gigante (> limite) = 413
    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5 * 1024 * 1024 + 10, 1)]);
    assert.equal((await upload(form.slug, huge).expect(413)).body.code, 'FILE_TOO_LARGE');
    // campo que nao existe / nao e de arquivo = 400
    assert.equal((await upload(form.slug, input, 'nome').expect(400)).body.code, 'VALIDATION');
  });

  it('sem o sharp: 503 PHOTO_PROCESSING_UNAVAILABLE, nada gravado (nem o original); FILE segue com o comportamento antigo', async () => {
    const form = await openForm(definition([photoField(), { key: 'comprovante', type: 'FILE', label: 'Comprovante', sectionIndex: 0 }]));
    const files = (await privateFiles()).length;
    const rows = await prisma.registrationSubmissionFile.count({ where: { formId: form.id } });
    setSharpForTests(null);
    try {
      const res = await upload(form.slug, await smallJpeg()).expect(503);
      assert.equal(res.body.code, 'PHOTO_PROCESSING_UNAVAILABLE');
      assert.match(res.body.message, /indispon/i);
      assert.equal((await privateFiles()).length, files, 'o original NAO foi gravado');
      assert.equal(await prisma.registrationSubmissionFile.count({ where: { formId: form.id } }), rows);
      await upload(form.slug, await smallJpeg(), 'comprovante', 'c.jpg').expect(201); // FILE: so avisa e segue
    } finally {
      setSharpForTests(undefined);
    }
    await upload(form.slug, await smallJpeg()).expect(201); // sharp de volta
  });

  it('envio: o token liga a foto à inscrição; token de outro campo/formulário/usado é recusado; obrigatório sem foto = 400; a equipe vê e baixa (auditado)', async () => {
    const form = await openForm(definition([photoField(true), { key: 'comprovante', type: 'FILE', label: 'Comprovante', sectionIndex: 0 }]));
    const other = await openForm(definition([photoField()]));

    // obrigatorio sem resposta
    const missing = await submit(form.slug, { nome: 'Sem Foto', email: email('semfoto') }).expect(400);
    assert.equal(missing.body.code, 'VALIDATION');
    assert.equal(missing.body.fields.foto, 'Campo obrigatório.');
    // resposta que nao e {fileToken}
    const bad = await submit(form.slug, { nome: 'Foto Ruim', email: email('ruim'), foto: 'texto' }).expect(400);
    assert.ok(bad.body.fields.foto);

    // token de OUTRO CAMPO (comprovante) no campo foto
    const fileToken = (await upload(form.slug, await smallJpeg(), 'comprovante', 'c.jpg').expect(201)).body.fileToken as string;
    const wrongField = await submit(form.slug, { nome: 'Campo Errado', email: email('errado'), foto: { fileToken } }).expect(400);
    assert.match(wrongField.body.fields.foto, /inválido ou expirado/);
    // token de OUTRO FORMULARIO
    const otherToken = (await upload(other.slug, await smallJpeg()).expect(201)).body.fileToken as string;
    const wrongForm = await submit(form.slug, { nome: 'Form Errado', email: email('errado2'), foto: { fileToken: otherToken } }).expect(400);
    assert.match(wrongForm.body.fields.foto, /inválido ou expirado/);
    // token inventado
    await submit(form.slug, { nome: 'Inventado', email: email('inv'), foto: { fileToken: 'x'.repeat(43) } }).expect(400);

    // feliz
    const token = (await upload(form.slug, await bigJpegWithExif()).expect(201)).body.fileToken as string;
    const mail = email('feliz');
    const sub = await submit(form.slug, { nome: 'Maria da Foto', email: mail, foto: { fileToken: token } }).expect(201);
    const row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: sub.body.protocol }, include: { files: true } });
    assert.equal(row.files.length, 1);
    assert.equal(row.files[0].fieldKey, 'foto');
    assert.equal(row.files[0].submissionId, row.id);
    assert.equal(row.files[0].pendingToken, null);
    assert.deepEqual((row.answers as Record<string, unknown>).foto, { fileIds: [row.files[0].id] });
    // o mesmo token nao liga duas vezes
    const reuse = await submit(form.slug, { nome: 'Reuso', email: email('reuso'), foto: { fileToken: token } }).expect(400);
    assert.match(reuse.body.fields.foto, /inválido ou expirado/);

    // nada de foto/arquivo nas respostas publicas
    const pub = await http().get(`/api/public/forms/${form.slug}`).expect(200);
    assert.ok(!JSON.stringify(pub.body).includes(row.files[0].storageKey));
    assert.ok(!/fileIds|storageKey|\.webp/.test(JSON.stringify(pub.body)));
    const look = await http().post(`/api/public/forms/${form.slug}/lookup`).send({ protocol: sub.body.protocol, email: mail }).expect(200);
    assert.ok(!/fileIds|storageKey|\.webp|foto/i.test(JSON.stringify(look.body)));

    // a equipe (Mestre) ve a foto no detalhe e baixa a imagem; download auditado
    const detail = await http().get(`/api/event-forms/${form.id}/submissions/${row.id}`).set(auth(mestre)).expect(200);
    assert.equal(detail.body.files.length, 1);
    assert.equal(detail.body.files[0].mimeType, 'image/webp');
    const answer = detail.body.answers.find((a: { fieldKey: string }) => a.fieldKey === 'foto');
    assert.equal(answer.type, 'PHOTO');
    assert.equal(answer.value[0].fileId, row.files[0].id);
    const got = await http().get(`/api/event-forms/${form.id}/submissions/${row.id}/files/${row.files[0].id}`).set(auth(mestre)).buffer(true).expect(200);
    assert.equal(got.headers['content-type'], 'image/webp');
    assert.equal(got.headers['cache-control'], 'private, no-store');
    assert.equal(got.headers['x-content-type-options'], 'nosniff');
    assert.match(got.headers['content-security-policy'], /sandbox/);
    assert.equal((await sharp(got.body as Buffer).metadata()).format, 'webp');
    assert.equal(await prisma.auditLog.count({ where: { organizationId: orgA, action: 'REGISTRATION_FILE_VIEW', resourceId: String(row.id) } }), 1);
    // professor e outro grupo nao baixam (so o Mestre do mesmo grupo)
    await http().get(`/api/event-forms/${form.id}/submissions/${row.id}/files/${row.files[0].id}`).set(auth(professor)).expect(403);
    await http().get(`/api/event-forms/${form.id}/submissions/${row.id}/files/${row.files[0].id}`).set(auth(mestreB)).expect(404);
    // sem login = 401
    await http().get(`/api/event-forms/${form.id}/submissions/${row.id}/files/${row.files[0].id}`).expect(401);
  });

  it('campo PHOTO opcional pode ficar vazio; condição (showIf) no próprio PHOTO oculta o campo e descarta a resposta', async () => {
    const form = await openForm(definition([{ key: 'tem_foto', type: 'SINGLE_CHOICE', label: 'Enviar foto?', options: ['Sim', 'Não'], sectionIndex: 0 }, { ...photoField(true), showIf: { fieldKey: 'tem_foto', equals: 'Sim' } }]));
    await submit(form.slug, { nome: 'Sem Foto', email: email('opc'), tem_foto: 'Não' }).expect(201);
    const token = (await upload(form.slug, await smallJpeg()).expect(201)).body.fileToken as string;
    const hidden = await submit(form.slug, { nome: 'Foto Oculta', email: email('oculta'), tem_foto: 'Não', foto: { fileToken: token } }).expect(201);
    const row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: hidden.body.protocol }, include: { files: true } });
    assert.equal(row.files.length, 0, 'campo oculto: a foto nao e ligada');
    assert.equal((row.answers as Record<string, unknown>).foto, undefined);
  });

  it('provedor do chaveamento: lê foto + nascimento da inscrição CONFIRMADA; isola organização, evento, pendente e anonimizada (Mestre)', async () => {
    const source = app.get(RegistrationPhotoSource, { strict: false });
    assert.ok(app.get(TOURNAMENT_PHOTO_SOURCE, { strict: false }) instanceof RegistrationPhotoSource, 'token TOURNAMENT_PHOTO_SOURCE exportado');

    const eventA = await prisma.event.create({ data: { organizationId: orgA, title: 'Campeonato A', date: new Date(Date.now() + 10 * 86_400_000) } });
    const eventA2 = await prisma.event.create({ data: { organizationId: orgA, title: 'Outro evento A', date: new Date(Date.now() + 12 * 86_400_000) } });
    const eventB = await prisma.event.create({ data: { organizationId: orgB, title: 'Campeonato B', date: new Date(Date.now() + 10 * 86_400_000) } });
    const form = await openForm(definition(), { eventId: eventA.id });

    const photo = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#e90' } }).png().toBuffer();
    const token = (await upload(form.slug, photo, 'foto', 'a.png', 'image/png').expect(201)).body.fileToken as string;
    const sub = await submit(form.slug, { nome: 'Atleta Confirmado', email: email('atleta'), nascimento: '2012-03-04', foto: { fileToken: token } }).expect(201);
    assert.equal(sub.body.status, 'CONFIRMED');
    const row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: sub.body.protocol }, include: { files: true } });
    assert.ok(row.eventParticipantId, 'a confirmacao criou o participante do evento');
    const pid = row.eventParticipantId as number;

    const got = await source.readForParticipant({ organizationId: orgA, eventId: eventA.id, eventParticipantId: pid });
    assert.ok(got?.photo);
    const meta = await sharp(got.photo).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, 80);
    assert.deepEqual(await fs.readFile(path.join(privateDir, ...row.files[0].storageKey.split('/'))), got.photo, 'e o arquivo privado sanitizado');
    assert.equal(got.birthDate?.toISOString(), '2012-03-04T00:00:00.000Z');

    // ISOLAMENTO: outra organizacao, outro evento (do mesmo grupo e de outro), ids invalidos
    assert.equal(await source.readForParticipant({ organizationId: orgB, eventId: eventA.id, eventParticipantId: pid }), null, 'outra organizacao');
    assert.equal(await source.readForParticipant({ organizationId: orgB, eventId: eventB.id, eventParticipantId: pid }), null, 'org + evento de outro grupo');
    assert.equal(await source.readForParticipant({ organizationId: orgA, eventId: eventA2.id, eventParticipantId: pid }), null, 'outro evento do mesmo grupo');
    assert.equal(await source.readForParticipant({ organizationId: orgA, eventId: eventB.id, eventParticipantId: pid }), null, 'evento de outro grupo');
    assert.equal(await source.readForParticipant({ organizationId: orgA, eventId: eventA.id, eventParticipantId: pid + 9_999_999 }), null);
    assert.equal(await source.readForParticipant({ organizationId: orgA, eventId: eventA.id, eventParticipantId: Number.NaN }), null);

    // inscricao PENDENTE (exige aprovacao) nao serve (so CONFIRMADA)
    const approvalForm = await openForm(definition(), { eventId: eventA.id });
    await http().put(`/api/event-forms/${approvalForm.id}`).set(auth(mestre)).send({ requireApproval: true }).expect(200);
    const t2 = (await upload(approvalForm.slug, photo, 'foto', 'a.png', 'image/png').expect(201)).body.fileToken as string;
    const pendingSub = await submit(approvalForm.slug, { nome: 'Atleta Pendente', email: email('pend'), foto: { fileToken: t2 } }).expect(201);
    assert.equal(pendingSub.body.status, 'PENDING');
    const pendingRow = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: pendingSub.body.protocol } });
    // forca o vinculo (a pendente nao cria participante): mesmo ligada, nao e CONFIRMADA
    await prisma.registrationSubmission.update({ where: { id: pendingRow.id }, data: { eventParticipantId: pid } });
    // outra inscricao ligada ao mesmo participante, mais NOVA, mas pendente: o provedor continua usando a CONFIRMADA
    const stillConfirmed = await source.readForParticipant({ organizationId: orgA, eventId: eventA.id, eventParticipantId: pid });
    assert.ok(stillConfirmed?.photo, 'a confirmada continua valendo');
    await prisma.registrationSubmission.update({ where: { id: pendingRow.id }, data: { eventParticipantId: null } });

    // sem foto mas com nascimento: devolve so o nascimento (desvio documentado); sem foto e sem nascimento: null
    const noPhotoForm = await openForm(definition(), { eventId: eventA.id });
    const noPhoto = await submit(noPhotoForm.slug, { nome: 'Sem Foto', email: email('sf'), nascimento: '1990-12-31' }).expect(201);
    const noPhotoPid = (await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: noPhoto.body.protocol } })).eventParticipantId as number;
    const onlyBirth = await source.readForParticipant({ organizationId: orgA, eventId: eventA.id, eventParticipantId: noPhotoPid });
    assert.equal(onlyBirth?.photo, null);
    assert.equal(onlyBirth?.birthDate?.toISOString(), '1990-12-31T00:00:00.000Z');
    const nothing = await submit(noPhotoForm.slug, { nome: 'Nada', email: email('nada') }).expect(201);
    const nothingPid = (await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: nothing.body.protocol } })).eventParticipantId as number;
    assert.equal(await source.readForParticipant({ organizationId: orgA, eventId: eventA.id, eventParticipantId: nothingPid }), null);

    // data de nascimento corrompida no banco: parse seguro (null, sem lancar)
    await prisma.registrationSubmission.update({ where: { id: row.id }, data: { answers: { ...(row.answers as object), nascimento: '31/02/2012' } } });
    const badBirth = await source.readForParticipant({ organizationId: orgA, eventId: eventA.id, eventParticipantId: pid });
    assert.ok(badBirth?.photo);
    assert.equal(badBirth?.birthDate, null);

    // arquivo sumiu do disco: sem excecao
    await prisma.registrationSubmission.update({ where: { id: row.id }, data: { answers: row.answers as object } });
    const full = path.join(privateDir, ...row.files[0].storageKey.split('/'));
    const bytes = await fs.readFile(full);
    await fs.rm(full);
    const gone = await source.readForParticipant({ organizationId: orgA, eventId: eventA.id, eventParticipantId: pid });
    assert.equal(gone?.photo, null);
    assert.equal(gone?.birthDate?.toISOString(), '2012-03-04T00:00:00.000Z');
    await fs.writeFile(full, bytes);

    // anonimizacao pelo Mestre: o provedor passa a devolver null e os atletas do chaveamento sao anonimizados (ponte LGPD)
    const calls: Array<{ studentIds: number[]; eventParticipantIds: number[] }> = [];
    const tournaments = app.get(TournamentsService, { strict: false }) as unknown as { anonymizeCompetitors?: (i: { studentIds: number[]; eventParticipantIds: number[] }) => Promise<void> };
    const original = Object.getOwnPropertyDescriptor(tournaments, 'anonymizeCompetitors');
    tournaments.anonymizeCompetitors = async (input) => {
      calls.push(input);
    };
    try {
      // outro grupo nao anonimiza a inscricao
      await http().post(`/api/event-forms/${form.id}/submissions/${row.id}/anonymize`).set(auth(mestreB)).expect(404);
      assert.equal(calls.length, 0);
      await http().post(`/api/event-forms/${form.id}/submissions/${row.id}/anonymize`).set(auth(mestre)).expect(200);
    } finally {
      if (original) Object.defineProperty(tournaments, 'anonymizeCompetitors', original);
      else delete tournaments.anonymizeCompetitors;
    }
    assert.deepEqual(calls, [{ studentIds: [], eventParticipantIds: [pid] }], 'so o participante convidado da inscricao anonimizada');
    assert.equal(await source.readForParticipant({ organizationId: orgA, eventId: eventA.id, eventParticipantId: pid }), null, 'anonimizada = null');
    await assert.rejects(fs.access(full), 'a foto privada saiu do disco');
    // anonimizar de novo (idempotente) nao chama o chaveamento outra vez
    const again: unknown[] = [];
    tournaments.anonymizeCompetitors = async (input) => {
      again.push(input);
    };
    try {
      await http().post(`/api/event-forms/${form.id}/submissions/${row.id}/anonymize`).set(auth(mestre)).expect(200);
    } finally {
      delete tournaments.anonymizeCompetitors;
    }
    assert.equal(again.length, 0);
  });

  it('falha no chaveamento não derruba a anonimização do Mestre (a inscrição fica anonimizada)', async () => {
    const eventA = await prisma.event.create({ data: { organizationId: orgA, title: 'Campeonato falha', date: new Date(Date.now() + 10 * 86_400_000) } });
    const form = await openForm(definition(), { eventId: eventA.id });
    const sub = await submit(form.slug, { nome: 'Falha Chave', email: email('falha') }).expect(201);
    const row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: sub.body.protocol } });
    const tournaments = app.get(TournamentsService, { strict: false }) as unknown as { anonymizeCompetitors?: () => Promise<void> };
    tournaments.anonymizeCompetitors = async () => {
      throw new Error('falha simulada do chaveamento');
    };
    try {
      await http().post(`/api/event-forms/${form.id}/submissions/${row.id}/anonymize`).set(auth(mestre)).expect(200);
    } finally {
      delete tournaments.anonymizeCompetitors;
    }
    assert.ok((await prisma.registrationSubmission.findUniqueOrThrow({ where: { id: row.id } })).anonymizedAt);
  });

  it('teto de pendentes é atômico: envios SIMULTÂNEOS não passam do teto por IP (e não sobra arquivo órfão)', async () => {
    const form = await openForm(definition());
    const old = process.env.FORMS_PENDING_FILES_PER_IP;
    process.env.FORMS_PENDING_FILES_PER_IP = '3';
    try {
      const img = await smallJpeg();
      const files = (await privateFiles()).length;
      const results = await Promise.all(Array.from({ length: 10 }, () => upload(form.slug, img)));
      const ok = results.filter((r) => r.status === 201).length;
      const refused = results.filter((r) => r.status === 429).length;
      assert.equal(ok, 3, results.map((r) => r.status).join(','));
      assert.equal(refused, 7);
      assert.equal(await prisma.registrationSubmissionFile.count({ where: { formId: form.id } }), 3);
      assert.equal((await privateFiles()).length - files, 3, 'os recusados na conferencia sob trava apagaram o arquivo gravado');
    } finally {
      if (old === undefined) delete process.env.FORMS_PENDING_FILES_PER_IP;
      else process.env.FORMS_PENDING_FILES_PER_IP = old;
    }
  });

  it('retenção (FORMS_RETENTION_PURGE): dry-run não mexe; true anonimiza a inscrição E o atleta importado (nome, foto apagada); participante ligado a aluno fica', async () => {
    const photosDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-regphoto-tourn-'));
    const oldDir = process.env.TOURNAMENT_PHOTOS_DIR;
    process.env.TOURNAMENT_PHOTOS_DIR = photosDir;
    const oldMode = process.env.FORMS_RETENTION_PURGE;
    let studentId = 0;
    try {
      const event = await prisma.event.create({ data: { organizationId: orgA, title: 'Campeonato antigo', date: new Date(Date.now() - 500 * 86_400_000) } });
      const form = await openForm(definition(), { eventId: event.id });
      const token = (await upload(form.slug, await smallJpeg()).expect(201)).body.fileToken as string;
      const sub = await submit(form.slug, { nome: 'Atleta Retencao', email: email('ret1'), foto: { fileToken: token } }).expect(201);
      const row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: sub.body.protocol } });
      const guestParticipantId = row.eventParticipantId as number;
      assert.ok(guestParticipantId);
      // 2a inscricao ligada (pelo Mestre) a um participante que e ALUNO: o atleta dele nao deve ser anonimizado
      const sub2 = await submit(form.slug, { nome: 'Outro Atleta', email: email('ret2') }).expect(201);
      const student = await prisma.student.create({ data: { organizationId: orgA, name: '[e2e-regphoto] Aluno atleta' } });
      studentId = student.id;
      const studentParticipant = await prisma.eventParticipant.create({ data: { organizationId: orgA, eventId: event.id, studentId: student.id, status: 'CONFIRMED' } });
      await prisma.registrationSubmission.update({ where: { protocol: sub2.body.protocol }, data: { eventParticipantId: studentParticipant.id } });

      const tournament = await prisma.tournament.create({ data: { organizationId: orgA, eventId: event.id, publicToken: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '') } });
      const category = await prisma.tournamentCategory.create({ data: { organizationId: orgA, tournamentId: tournament.id, name: 'Adulto', format: 'SINGLE_ELIMINATION' } });
      const photoFile = `${randomUUID()}.webp`;
      const photoPath = path.join(photosDir, photoFile);
      await fs.writeFile(photoPath, await sharp({ create: { width: 20, height: 20, channels: 3, background: '#111' } }).webp().toBuffer());
      const guest = await prisma.tournamentCompetitor.create({
        data: { organizationId: orgA, categoryId: category.id, displayName: 'Atleta Retencao', groupName: 'Grupo X', eventParticipantId: guestParticipantId, photoFile, photoBytes: 10, photoUpdatedAt: new Date(), photoAuthorized: true },
      });
      const linked = await prisma.tournamentCompetitor.create({
        data: { organizationId: orgA, categoryId: category.id, displayName: 'Aluno Atleta', studentId: student.id, eventParticipantId: studentParticipant.id },
      });
      const revision = (await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } })).revision;
      await prisma.registrationForm.update({ where: { id: form.id }, data: { status: 'CLOSED', closedAt: new Date(Date.now() - 400 * 86_400_000) } });

      const cron = new FormsRetentionCronService(app.get(PrismaService), app.get(AuditService), app.get(CompetitorAnonymizer, { strict: false }));
      // dry-run: nada muda
      process.env.FORMS_RETENTION_PURGE = 'dry-run';
      const dry = await cron.run({ organizationId: orgA });
      assert.equal(dry?.dryRun, true);
      assert.equal((await prisma.registrationSubmission.findUniqueOrThrow({ where: { id: row.id } })).anonymizedAt, null);
      const untouched = await prisma.tournamentCompetitor.findUniqueOrThrow({ where: { id: guest.id } });
      assert.equal(untouched.displayName, 'Atleta Retencao');
      assert.equal(untouched.photoFile, photoFile);
      await fs.access(photoPath);

      // true: inscricao + atleta
      process.env.FORMS_RETENTION_PURGE = 'true';
      const result = await cron.run({ organizationId: orgA });
      assert.ok((result?.submissionsAnonymized ?? 0) >= 2);
      assert.ok((await prisma.registrationSubmission.findUniqueOrThrow({ where: { id: row.id } })).anonymizedAt);
      const after = await prisma.tournamentCompetitor.findUniqueOrThrow({ where: { id: guest.id } });
      assert.equal(after.displayName, 'Atleta removido');
      assert.equal(after.groupName, null);
      assert.equal(after.photoFile, null);
      assert.equal(after.photoAuthorized, false);
      await assert.rejects(fs.access(photoPath), 'a foto propria do atleta saiu do disco');
      assert.ok((await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } })).revision > revision, 'revision sobe');
      // atleta ligado a aluno (participante com studentId) nao e anonimizado pela inscricao
      assert.equal((await prisma.tournamentCompetitor.findUniqueOrThrow({ where: { id: linked.id } })).displayName, 'Aluno Atleta');
      // sem o anonimizador injetado (specs antigos): a retencao segue sem erro
      await new FormsRetentionCronService(app.get(PrismaService), app.get(AuditService)).run({ organizationId: orgA });
    } finally {
      if (oldMode === undefined) delete process.env.FORMS_RETENTION_PURGE;
      else process.env.FORMS_RETENTION_PURGE = oldMode;
      if (oldDir === undefined) delete process.env.TOURNAMENT_PHOTOS_DIR;
      else process.env.TOURNAMENT_PHOTOS_DIR = oldDir;
      await fs.rm(photosDir, { recursive: true, force: true });
      if (studentId) {
        await prisma.eventParticipant.deleteMany({ where: { studentId } });
        await prisma.student.deleteMany({ where: { id: studentId } });
      }
    }
  });
});
