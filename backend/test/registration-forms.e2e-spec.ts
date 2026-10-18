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
import { AuditService } from '../src/shared/audit/audit.service';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { hashPersonDocument } from '../src/shared/security/person-document';
import { createHash } from 'node:crypto';
import { FormsRetentionCronService } from '../src/jobs/forms-retention-cron.service';
import { AnonymizationService } from '../src/interface/http/data-deletion-requests/anonymization.service';
import { issueStartedToken } from '../src/interface/http/registration-forms/form-codes';
import { DEV_PASSWORD } from './utils/list-helpers';
import { createTestApp, MemoryMailTransport } from './utils/test-app';

/**
 * Formularios de inscricao publicos (F1, docs/PLANO_FORMULARIOS_INSCRICAO.md). Grupos, usuarios e diretorios PROPRIOS
 * (UPLOADS_DIR e PRIVATE_UPLOADS_DIR temporarios); nao toca no seed. Limpa tudo no after().
 */
const DOMAIN = '@e2e-regforms.local';

/** CPF valido (digitos verificadores) a partir de uma semente. */
function cpf(seed: number): string {
  const base = String(123456789 + seed * 7919).slice(-9).split('').map(Number);
  const dv = (a: number[]) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * (a.length + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base);
  return [...base, d1, dv([...base, d1])].join('');
}

describe('Formulários de inscrição (e2e)', () => {
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
  let aluno = '';
  let mestreB = '';
  let seq = 0;
  const mailbox = new MemoryMailTransport();
  const email = (tag: string) => `${tag}-${stamp}-${++seq}${DOMAIN}`;
  /** Token de inicio emitido pelo servidor (mesmo segredo do processo) "5 s atras". */
  const startedToken = (slug: string, agoMs = 5000) => issueStartedToken(slug, Date.now() - agoMs);
  /** Troca uma env so durante `fn` (os limites sao lidos a cada pedido). */
  const withEnv = async (vars: Record<string, string>, fn: () => Promise<void>) => {
    const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(old)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  const login = async (address: string) => (await http().post('/api/auth/login').send({ email: address, password: DEV_PASSWORD }).expect(200)).body.accessToken as string;
  const member = async (org: number, role: OrgRole, tag: string) => {
    const user = await prisma.user.create({
      data: { email: `${tag}-${stamp}${DOMAIN}`, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `[e2e-regforms] ${tag}`, userType: 'MEMBER' },
    });
    await prisma.organizationUser.create({ data: { organizationId: org, userId: user.id, role, status: 'ACTIVE' } });
    return login(user.email);
  };

  /** Formulario simples PUBLICADO (sem pagamento), com a definicao dada. */
  const openForm = async (definition: Record<string, unknown>, token = mestre) => {
    const created = await http().post('/api/event-forms').set(auth(token)).send({ title: `Form ${++seq}` }).expect(201);
    await http().put(`/api/event-forms/${created.body.id}`).set(auth(token)).send(definition).expect(200);
    const opened = await http().post(`/api/event-forms/${created.body.id}/open`).set(auth(token)).expect(200);
    return opened.body as { id: number; slug: string };
  };
  const simpleDef = (extra: Record<string, unknown> = {}) => ({
    sections: [{ title: 'Dados' }],
    fields: [
      { key: 'nome', type: 'SHORT_TEXT', label: 'Nome', required: true, mapsTo: 'name', sectionIndex: 0 },
      { key: 'email', type: 'EMAIL', label: 'E-mail', required: true, mapsTo: 'email', sectionIndex: 0 },
      { key: 'cpf', type: 'CPF', label: 'CPF', mapsTo: 'document', sectionIndex: 0 },
    ],
    ...extra,
  });
  const submit = (slug: string, answers: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    http().post(`/api/public/forms/${slug}/submissions`).send({ answers, consent: true, hp: '', startedToken: startedToken(slug), ...extra });
  const jpeg = () => sharp({ create: { width: 40, height: 40, channels: 3, background: '#3a6' } }).jpeg().toBuffer();

  before(async () => {
    uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-regforms-pub-'));
    privateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-regforms-priv-'));
    process.env.UPLOADS_DIR = uploadsDir;
    process.env.PRIVATE_UPLOADS_DIR = privateDir;
    app = await createTestApp({ mailTransport: mailbox });
    orgA = (await prisma.organization.create({ data: { name: `E2E regforms A ${stamp}`, slug: `e2e-regforms-a-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE } })).id;
    orgB = (await prisma.organization.create({ data: { name: `E2E regforms B ${stamp}`, slug: `e2e-regforms-b-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE } })).id;
    mestre = await member(orgA, OrgRole.MESTRE, 'mestre');
    professor = await member(orgA, OrgRole.PROFESSOR, 'professor');
    aluno = await member(orgA, OrgRole.ALUNO, 'aluno');
    mestreB = await member(orgB, OrgRole.MESTRE, 'mestreb');
  });

  after(async () => {
    const orgs = [orgA, orgB].filter(Boolean);
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: orgs } }, { userId: { in: users.map((u) => u.id) } }] } });
    await prisma.registrationSubmissionFile.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.registrationSubmission.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.registrationForm.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.eventParticipant.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.event.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.notification.deleteMany({ where: { organizationId: { in: orgs } } });
    const students = await prisma.student.findMany({ where: { organizationId: { in: orgs } }, select: { personId: true } });
    await prisma.student.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.person.deleteMany({ where: { id: { in: students.map((s) => s.personId).filter((id): id is number => id !== null) } } });
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

  it('modelos + criar a partir do CAMPEONATO (DRAFT com 5 secoes, responsavel do menor, aceites separados, Pix manual) e herdar do evento', async () => {
    const templates = await http().get('/api/event-forms/templates').set(auth(mestre)).expect(200);
    assert.deepEqual(templates.body.map((t: { key: string }) => t.key), ['CAMPEONATO', 'BATIZADO', 'CURSO', 'RODA', 'SIMPLES']);

    const created = await http().post('/api/event-forms').set(auth(mestre)).send({ title: 'Campeonato do Varjão', template: 'CAMPEONATO' }).expect(201);
    assert.equal(created.body.status, 'DRAFT');
    assert.equal(created.body.paymentMode, 'PIX_MANUAL');
    assert.equal(created.body.sections.length, 5);
    assert.ok(created.body.sections.some((s: { title: string }) => s.title === 'Dados do responsável'));
    const keys = created.body.fields.map((f: { key: string }) => f.key);
    for (const k of ['nome_completo', 'apelido', 'data_nascimento', 'cpf', 'telefone', 'email', 'menor_idade', 'categoria', 'termo_responsabilidade', 'termo_imagem', 'comprovante']) {
      assert.ok(keys.includes(k), k);
    }
    const byKey = (k: string) => created.body.fields.find((f: { key: string }) => f.key === k);
    for (const k of ['responsavel_nome', 'responsavel_cpf', 'responsavel_telefone', 'responsavel_parentesco', 'responsavel_autorizacao']) {
      assert.deepEqual(byKey(k).showIf, { fieldKey: 'menor_idade', equals: 'Sim' }, k);
      assert.equal(byKey(k).required, true, k);
    }
    assert.equal(byKey('responsavel_autorizacao').type, 'CONSENT');
    assert.equal(byKey('termo_responsabilidade').required, true);
    assert.equal(byKey('termo_imagem').required, false, 'uso de imagem e aceite separado e OPCIONAL');
    assert.ok(!/imagem/i.test(byKey('termo_responsabilidade').label), 'responsabilidade nao embute o uso de imagem');
    // rascunho: sem link publico ate a 1a publicacao (contrato b)
    assert.equal(created.body.publicUrl, null);
    const listed = await http().get('/api/event-forms').set(auth(mestre)).expect(200);
    assert.equal(listed.body.find((f: { id: number }) => f.id === created.body.id).publicUrl, null);
    // salvar a definicao do modelo como veio (o painel devolve o que recebeu) passa na validacao (showIf para tras)
    await http()
      .put(`/api/event-forms/${created.body.id}`)
      .set(auth(mestre))
      .send({
        sections: created.body.sections.map((s: { id: number; title: string }) => ({ id: s.id, title: s.title })),
        fields: created.body.fields.map((f: Record<string, unknown>) => ({ key: f.key, type: f.type, label: f.label, helpText: f.helpText, required: f.required, options: f.options, showIf: f.showIf, mapsTo: f.mapsTo, sectionId: f.sectionId })),
      })
      .expect(200);
    assert.equal((await prisma.auditLog.count({ where: { organizationId: orgA, action: 'REGISTRATION_FORM_CREATE', resourceId: String(created.body.id) } })), 1);

    const deadline = new Date(Date.now() + 5 * 86_400_000);
    const event = await prisma.event.create({
      data: { organizationId: orgA, title: 'Batizado 2026', date: new Date(Date.now() + 10 * 86_400_000), capacity: 30, priceCents: 2500, registrationDeadline: deadline },
    });
    const inherited = await http().post('/api/event-forms').set(auth(mestre)).send({ eventId: event.id, template: 'BATIZADO' }).expect(201);
    assert.equal(inherited.body.title, 'Batizado 2026');
    assert.equal(inherited.body.priceCents, 2500);
    assert.equal(inherited.body.maxSubmissions, 30);
    assert.equal(new Date(inherited.body.closesAt).getTime(), deadline.getTime());
    assert.equal(inherited.body.event.title, 'Batizado 2026');
    assert.equal(inherited.body.eventTitle, 'Batizado 2026');
    // corpo no formato que o painel manda (consentVersion devolvido, retentionMonths null = mantem): aceito
    const painelLike = await http()
      .put(`/api/event-forms/${inherited.body.id}`)
      .set(auth(mestre))
      .send({ title: inherited.body.title, consentVersion: inherited.body.consentVersion, retentionMonths: null, maxSubmissions: null, eventId: event.id })
      .expect(200);
    assert.equal(painelLike.body.retentionMonths, 12);
    assert.equal(painelLike.body.maxSubmissions, null);
    // evento de outro grupo nao serve
    const eventB =await prisma.event.create({ data: { organizationId: orgB, title: 'Evento B', date: new Date(Date.now() + 86_400_000) } });
    const bad = await http().post('/api/event-forms').set(auth(mestre)).send({ eventId: eventB.id }).expect(400);
    assert.equal(bad.body.code, 'VALIDATION');
  });

  it('publicar valida o Pix manual; PIX_AUTO = PAYMENT_MODE_NOT_AVAILABLE; slug definitivo na 1a publicacao', async () => {
    const created = await http().post('/api/event-forms').set(auth(mestre)).send({ title: 'Inscrição paga', template: 'SIMPLES' }).expect(201);
    const id = created.body.id;
    await http().put(`/api/event-forms/${id}`).set(auth(mestre)).send({ paymentMode: 'PIX_MANUAL' }).expect(200);
    const refused = await http().post(`/api/event-forms/${id}/open`).set(auth(mestre)).expect(400);
    assert.equal(refused.body.code, 'VALIDATION');
    for (const k of ['priceCents', 'pixKey', 'pixKeyType', 'pixBeneficiary']) assert.ok(refused.body.fields[k], k);

    const auto = await http().put(`/api/event-forms/${id}`).set(auth(mestre)).send({ paymentMode: 'PIX_AUTO' }).expect(400);
    assert.equal(auto.body.code, 'PAYMENT_MODE_NOT_AVAILABLE');

    await http()
      .put(`/api/event-forms/${id}`)
      .set(auth(mestre))
      .send({ priceCents: 2500, pixKey: 'pix@grupo.test', pixKeyType: 'EMAIL', pixBeneficiary: 'Grupo Teste' })
      .expect(200);
    const opened = await http().post(`/api/event-forms/${id}/open`).set(auth(mestre)).expect(200);
    assert.equal(opened.body.status, 'OPEN');
    assert.equal(opened.body.slugLocked, true);
    assert.equal(opened.body.publicUrl, `https://app.e2e.test/i/${opened.body.slug}`, 'link so depois de publicar');
    // publicado: nao pode voltar a ficar sem chave Pix
    const locked = await http().put(`/api/event-forms/${id}`).set(auth(mestre)).send({ pixKey: '' }).expect(400);
    assert.ok(locked.body.fields.pixKey);
    // reabrir nao troca o slug
    await http().post(`/api/event-forms/${id}/close`).set(auth(mestre)).expect(200);
    const reopened = await http().post(`/api/event-forms/${id}/open`).set(auth(mestre)).expect(200);
    assert.equal(reopened.body.slug, opened.body.slug);
  });

  it('permissoes: ALUNO 403; PROFESSOR gerencia mas nao exclui (403); outro grupo = 404 em tudo', async () => {
    const form = await openForm(simpleDef());
    await http().get('/api/event-forms').set(auth(aluno)).expect(403);
    await http().get(`/api/event-forms/${form.id}/submissions`).set(auth(aluno)).expect(403);
    await http().get('/api/event-forms').set(auth(professor)).expect(200);
    await http().delete(`/api/event-forms/${form.id}`).set(auth(professor)).expect(403);
    await http().get('/api/event-forms').expect(401);

    for (const [method, url] of [
      ['get', `/api/event-forms/${form.id}`],
      ['put', `/api/event-forms/${form.id}`],
      ['get', `/api/event-forms/${form.id}/submissions`],
      ['get', `/api/event-forms/${form.id}/summary`],
      ['get', `/api/event-forms/${form.id}/submissions/export.csv`],
      ['post', `/api/event-forms/${form.id}/close`],
      ['delete', `/api/event-forms/${form.id}`],
    ] as const) {
      await (http() as unknown as Record<string, (u: string) => request.Test>)[method](url).set(auth(mestreB)).send({}).expect(404);
    }
    const listB = await http().get('/api/event-forms').set(auth(mestreB)).expect(200);
    assert.ok(!listB.body.some((f: { id: number }) => f.id === form.id));
  });

  it('PUT valida a definicao (tipo, opcoes, chave repetida, showIf para frente, limite de arquivos)', async () => {
    const created = await http().post('/api/event-forms').set(auth(mestre)).send({ title: 'Validacao' }).expect(201);
    const put = (fields: unknown[]) => http().put(`/api/event-forms/${created.body.id}`).set(auth(mestre)).send({ sections: [], fields });
    let res = await put([{ key: 'a', type: 'NOPE', label: 'A' }]).expect(400);
    assert.ok(res.body.fields.a);
    res = await put([{ key: 'a', type: 'SELECT', label: 'A', options: ['so uma'] }]).expect(400);
    assert.ok(res.body.fields.a);
    res = await put([{ key: 'a', type: 'SHORT_TEXT', label: 'A' }, { key: 'a', type: 'SHORT_TEXT', label: 'B' }]).expect(400);
    assert.ok(res.body.fields.a);
    res = await put([{ key: 'a', type: 'SHORT_TEXT', label: 'A', showIf: { fieldKey: 'b', equals: 'x' } }, { key: 'b', type: 'SHORT_TEXT', label: 'B' }]).expect(400);
    assert.ok(res.body.fields.a);
    res = await put(Array.from({ length: 6 }, (_, i) => ({ key: `f${i}`, type: 'FILE', label: `Arquivo ${i}` }))).expect(400);
    assert.ok(res.body.fields.f5);
  });

  it('GET publico: rascunho/arquivado/inexistente = 404 identico; aberto expoe so o publico', async () => {
    const draft = await http().post('/api/event-forms').set(auth(mestre)).send({ title: 'Rascunho', template: 'SIMPLES' }).expect(201);
    const a = await http().get(`/api/public/forms/${draft.body.slug}`).expect(404);
    const b = await http().get('/api/public/forms/nao-existe-xyz12').expect(404);
    assert.deepEqual(a.body, b.body);

    const form = await openForm(simpleDef({ consentText: 'Texto LGPD do grupo.' }));
    const pub = await http().get(`/api/public/forms/${form.slug}`).expect(200);
    assert.equal(pub.headers['cache-control'], 'no-store');
    assert.equal(pub.body.isOpen, true);
    assert.equal(pub.body.closedReason, null);
    assert.equal(pub.body.pix, null);
    assert.deepEqual(pub.body.consent, { text: 'Texto LGPD do grupo.', version: 2 });
    assert.equal(pub.body.fields.length, 3);
    for (const k of ['id', 'organizationId', 'createdById', 'archived']) assert.ok(!(k in pub.body) && !(k in pub.body.fields[0]), k);

    await http().post(`/api/event-forms/${form.id}/archive`).set(auth(mestre)).expect(200);
    const c = await http().get(`/api/public/forms/${form.slug}`).expect(404);
    assert.deepEqual(c.body, b.body);
  });

  it('anexo anonimo: imagem ok; SVG/HTML/tipo falso 415; > 5 MB 413; campo que nao e FILE 400; rascunho 404', async () => {
    const form = await openForm(simpleDef({ fields: [...simpleDef().fields, { key: 'comprovante', type: 'FILE', label: 'Comprovante', sectionIndex: 0 }] }));
    const up = (buf: Buffer, name: string, mime: string, fieldKey = 'comprovante') =>
      http().post(`/api/public/forms/${form.slug}/files`).field('fieldKey', fieldKey).attach('file', buf, { filename: name, contentType: mime });

    const ok = await up(await jpeg(), '../../../etc/comprovante<script>.jpg', 'image/jpeg').expect(201);
    assert.match(ok.body.fileToken, /^[A-Za-z0-9_-]{40,}$/);
    assert.equal(ok.body.mimeType, 'image/jpeg');
    assert.ok(!ok.body.originalName.includes('/') && !ok.body.originalName.includes('<'), ok.body.originalName);
    const row = await prisma.registrationSubmissionFile.findFirstOrThrow({ where: { formId: form.id } });
    assert.match(row.storageKey, /^org-\d+\/[0-9a-f-]{36}\.jpg$/);
    assert.notEqual(row.pendingToken, ok.body.fileToken, 'so o hash do token vai ao banco');
    await fs.access(path.join(privateDir, ...row.storageKey.split('/')));
    // o arquivo NAO e servido pela rota publica de imagens
    await http().get(`/api/uploads/${row.storageKey.split('/')[1]}`).expect(404);

    const pdf = await up(Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'), 'c.pdf', 'application/pdf').expect(201);
    assert.equal(pdf.body.mimeType, 'application/pdf');

    const svg = await up(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'a.png', 'image/png').expect(415);
    assert.equal(svg.body.code, 'FILE_TYPE_NOT_ALLOWED');
    const html = await up(Buffer.from('<html><body>falso comprovante</body></html>'), 'a.jpg', 'image/jpeg').expect(415);
    assert.equal(html.body.code, 'FILE_TYPE_NOT_ALLOWED');
    const huge = await up(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5 * 1024 * 1024 + 10, 1)]), 'g.jpg', 'image/jpeg').expect(413);
    assert.equal(huge.body.code, 'FILE_TOO_LARGE');
    const notFile = await up(await jpeg(), 'a.jpg', 'image/jpeg', 'nome').expect(400);
    assert.equal(notFile.body.code, 'VALIDATION');

    const draft = await http().post('/api/event-forms').set(auth(mestre)).send({ title: 'Rascunho upload', template: 'CAMPEONATO' }).expect(201);
    await http().post(`/api/public/forms/${draft.body.slug}/files`).field('fieldKey', 'comprovante').attach('file', await jpeg(), 'a.jpg').expect(404);
  });

  it('envio feliz com comprovante: protocolo, Pix pendente, CPF protegido (hash+AES), IP so como HMAC, auditoria sem PII', async () => {
    const created = await http().post('/api/event-forms').set(auth(mestre)).send({ title: 'Campeonato feliz', template: 'CAMPEONATO' }).expect(201);
    await http()
      .put(`/api/event-forms/${created.body.id}`)
      .set(auth(mestre))
      .send({ priceCents: 2500, pixKey: '61999990000', pixKeyType: 'PHONE', pixBeneficiary: 'Grupo Teste' })
      .expect(200);
    const opened = await http().post(`/api/event-forms/${created.body.id}/open`).set(auth(mestre)).expect(200);
    const slug = opened.body.slug;
    const pub = await http().get(`/api/public/forms/${slug}`).expect(200);
    assert.deepEqual(pub.body.pix, { key: '61999990000', keyType: 'PHONE', beneficiary: 'Grupo Teste' });

    const up = await http().post(`/api/public/forms/${slug}/files`).field('fieldKey', 'comprovante').attach('file', await jpeg(), 'pix.jpg').expect(201);
    const doc = cpf(1);
    const mail = email('feliz');
    const answers = {
      nome_completo: 'Maria Feliz Sentinela',
      apelido: 'Não tenho',
      data_nascimento: '2001-05-04',
      cpf: `${doc.slice(0, 3)}.${doc.slice(3, 6)}.${doc.slice(6, 9)}-${doc.slice(9)}`,
      telefone: '(61) 99876-5432',
      email: mail.toUpperCase(),
      menor_idade: 'Não',
      categoria: 'Adulto (18 anos ou mais)',
      termo_responsabilidade: true,
      comprovante: { fileToken: up.body.fileToken },
      campo_inexistente: 'ignorado',
    };
    // menor de idade sem os dados/autorizacao do responsavel = 400 nos campos do responsavel (condicionais)
    const minor = await submit(slug, { ...answers, menor_idade: 'Sim' }).expect(400);
    for (const k of ['responsavel_nome', 'responsavel_cpf', 'responsavel_telefone', 'responsavel_parentesco', 'responsavel_autorizacao']) {
      assert.ok(minor.body.fields[k], k);
    }
    const res = await submit(slug, answers).expect(201);
    assert.match(res.body.protocol, /^INS-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    assert.equal(res.body.status, 'PENDING');
    assert.equal(res.body.paymentStatus, 'PENDING');
    assert.equal(res.body.proofRequired, false);
    assert.deepEqual(res.body.payment, { mode: 'PIX_MANUAL', amountCents: 2500, pix: { key: '61999990000', keyType: 'PHONE', beneficiary: 'Grupo Teste' } });
    // aviso ao inscrito: protocolo + titulo, saudacao fixa, NADA digitado pela pessoa (nem o nome)
    const notice = mailbox.to(mail.toLowerCase());
    assert.equal(notice.length, 1);
    assert.ok(notice[0].text.startsWith('Olá!') && notice[0].text.includes(res.body.protocol) && notice[0].text.includes('Campeonato feliz'));
    assert.ok(!notice[0].text.includes('Maria') && !notice[0].html.includes('Maria') && !notice[0].subject.includes('Maria'));

    const row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: res.body.protocol }, include: { files: true } });
    assert.equal(row.email, mail.toLowerCase());
    assert.equal(row.phone, '61998765432');
    assert.equal(row.documentLast4, doc.slice(-4));
    assert.equal(row.documentHash, hashPersonDocument(`CPF:${doc}`));
    assert.ok(row.documentEnc?.startsWith('v1:'));
    const stored = JSON.stringify(row.answers);
    assert.ok(!stored.includes(doc) && !stored.includes(mail.toLowerCase()) && !stored.includes('99876'), stored);
    assert.ok(!('campo_inexistente' in (row.answers as object)));
    assert.match(row.ipHash ?? '', /^[0-9a-f]{64}$/);
    assert.equal(row.files.length, 1);
    assert.equal(row.files[0].pendingToken, null);

    // token ja usado nao vale de novo
    const again = await submit(slug, { ...answers, email: email('outra'), cpf: cpf(2) }).expect(400);
    assert.ok(again.body.fields.comprovante);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgA, action: 'REGISTRATION_SUBMISSION_CREATE', resourceId: String(row.id) } });
    assert.equal(audit.ipAddress, null);
    assert.equal(audit.userId, null);
    const meta = JSON.stringify(audit.metadata);
    assert.ok(!meta.includes('Maria') && !meta.includes(doc) && !meta.includes(mail.toLowerCase()), meta);

    // Mestre recebeu UM aviso sem dado pessoal
    const note = await prisma.notification.findFirstOrThrow({ where: { organizationId: orgA, type: 'REGISTRATION_SUBMISSION' }, orderBy: { id: 'desc' } });
    assert.ok(!note.body.includes('Maria') && note.body.includes('Campeonato feliz'));
  });

  it('validacao por tipo no servidor e showIf reavaliado (oculto nao exige, visivel exige)', async () => {
    const form = await openForm({
      sections: [{ title: 'Dados' }],
      fields: [
        { key: 'nome', type: 'SHORT_TEXT', label: 'Nome', required: true, mapsTo: 'name', sectionIndex: 0 },
        { key: 'email', type: 'EMAIL', label: 'E-mail', required: true, sectionIndex: 0 },
        { key: 'cpf', type: 'CPF', label: 'CPF', sectionIndex: 0 },
        { key: 'cor', type: 'SELECT', label: 'Corda', options: ['Crua', 'Amarela'], sectionIndex: 0 },
        { key: 'pratica', type: 'SINGLE_CHOICE', label: 'Pratica?', options: ['Sim', 'Não'], required: true, sectionIndex: 0 },
        { key: 'grupo', type: 'SHORT_TEXT', label: 'Grupo', required: true, showIf: { fieldKey: 'pratica', equals: 'Sim' }, sectionIndex: 0 },
      ],
    });
    const bad = await submit(form.slug, { nome: 'Pessoa Validacao', email: 'nao-e-email', cpf: '111.111.111-11', cor: 'Roxa', pratica: 'Sim' }).expect(400);
    assert.equal(bad.body.code, 'VALIDATION');
    assert.deepEqual(Object.keys(bad.body.fields).sort(), ['cor', 'cpf', 'email', 'grupo']);
    assert.ok(!JSON.stringify(bad.body).includes('nao-e-email'), 'sem eco do valor');

    const hidden = await submit(form.slug, { nome: 'Oculto', email: email('oculto'), pratica: 'Não', grupo: 'ignorado' }).expect(201);
    assert.equal(hidden.body.status, 'CONFIRMED'); // sem pagamento e sem aprovacao = confirmada direto
    const row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: hidden.body.protocol } });
    assert.ok(!('grupo' in (row.answers as object)), 'resposta de campo oculto descartada');
    await submit(form.slug, { nome: 'Visivel', email: email('visivel'), pratica: 'Sim', grupo: 'Abadá' }).expect(201);
  });

  it('consentimento ausente, honeypot e startedToken (invalido/curto/expirado/de outro slug/ausente) = 400 sem gravar nada', async () => {
    const form = await openForm(simpleDef());
    const other = await openForm(simpleDef());
    const answers = { nome: 'Robo', email: email('robo') };
    const before = await prisma.registrationSubmission.count({ where: { formId: form.id } });
    const noConsent = await submit(form.slug, answers, { consent: false }).expect(400);
    assert.ok(noConsent.body.fields.consent);
    assert.equal((await submit(form.slug, answers, { hp: 'http://spam' }).expect(400)).body.code, 'VALIDATION');
    // GET devolve um token do SERVIDOR; enviado em menos de 2 s = recusado
    const pub = await http().get(`/api/public/forms/${form.slug}`).expect(200);
    assert.match(pub.body.startedToken, /^\d{13}\.[A-Za-z0-9_-]{43}$/);
    await submit(form.slug, answers, { startedToken: pub.body.startedToken }).expect(400);
    await submit(form.slug, answers, { startedToken: startedToken(form.slug, 500) }).expect(400);
    await submit(form.slug, answers, { startedToken: startedToken(form.slug, 25 * 3600_000) }).expect(400);
    await submit(form.slug, answers, { startedToken: startedToken(other.slug) }).expect(400); // assinado para outro slug
    const forged = `${Date.now() - 5000}.${'A'.repeat(43)}`;
    await submit(form.slug, answers, { startedToken: forged }).expect(400);
    // relogio do cliente nao manda quando ha token: startedAt "bom" + token curto = recusado
    await submit(form.slug, answers, { startedToken: startedToken(form.slug, 100), startedAt: Date.now() - 60_000 }).expect(400);
    await submit(form.slug, answers, { startedToken: undefined }).expect(400); // nenhum dos dois
    // sem o legado (FORMS_PUBLIC_LEGACY=false), startedAt sozinho tambem e recusado
    await withEnv({ FORMS_PUBLIC_LEGACY: 'false' }, async () => {
      await submit(form.slug, answers, { startedToken: undefined, startedAt: Date.now() - 60_000 }).expect(400);
    });
    assert.equal(await prisma.registrationSubmission.count({ where: { formId: form.id } }), before);
    // legado (app antigo em cache) ainda aceito por padrao: startedAt do navegador sem token
    await submit(form.slug, answers, { startedToken: undefined, startedAt: Date.now() - 60_000 }).expect(201);
  });

  it('answers serializado > 64 KB = 400; chave "constructor" proibida na definicao', async () => {
    const form = await openForm(simpleDef());
    const big = await submit(form.slug, { nome: 'Grande', email: email('grande'), lixo: 'x'.repeat(70 * 1024) }).expect(400);
    assert.equal(big.body.code, 'VALIDATION');
    assert.ok(big.body.fields.answers);
    const created = await http().post('/api/event-forms').set(auth(mestre)).send({ title: 'Chaves' }).expect(201);
    const bad = await http()
      .put(`/api/event-forms/${created.body.id}`)
      .set(auth(mestre))
      .send({ sections: [], fields: [{ key: 'constructor', type: 'SHORT_TEXT', label: 'C', required: true }] })
      .expect(400);
    assert.ok(bad.body.fields['fields[0]']);
  });

  it('duplicidade por CPF ou e-mail no mesmo formulario = 409 ALREADY_REGISTERED (sem revelar dados)', async () => {
    const form = await openForm(simpleDef());
    const mail = email('dup');
    await submit(form.slug, { nome: 'Dup', email: mail, cpf: cpf(10) }).expect(201);
    const sameCpf = await submit(form.slug, { nome: 'Dup 2', email: email('dup2'), cpf: cpf(10) }).expect(409);
    assert.equal(sameCpf.body.code, 'ALREADY_REGISTERED');
    assert.ok(!JSON.stringify(sameCpf.body).includes(cpf(10)));
    assert.equal((await submit(form.slug, { nome: 'Dup 3', email: mail.toUpperCase(), cpf: cpf(11) }).expect(409)).body.code, 'ALREADY_REGISTERED');
    // alias do Gmail (+tag, pontos, googlemail) = a mesma pessoa; CPF formatado = so digitos
    const g = `dup${stamp}`;
    await submit(form.slug, { nome: 'Gmail', email: `${g}+evento@gmail.com` }).expect(201);
    assert.equal((await submit(form.slug, { nome: 'Gmail 2', email: `${g.slice(0, 2)}.${g.slice(2)}@googlemail.com` }).expect(409)).body.code, 'ALREADY_REGISTERED');
    const doc = cpf(12);
    await submit(form.slug, { nome: 'Cpf', email: email('cpfa'), cpf: doc }).expect(201);
    await submit(form.slug, { nome: 'Cpf 2', email: email('cpfb'), cpf: `${doc.slice(0, 3)}.${doc.slice(3, 6)}.${doc.slice(6, 9)}-${doc.slice(9)}` }).expect(409);
  });

  it('vagas: envios concorrentes nunca estouram maxSubmissions; cheio sem fila = 410 FULL; com fila = WAITLIST', async () => {
    const form = await openForm(simpleDef({ maxSubmissions: 2 }));
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => submit(form.slug, { nome: `Corrida ${i}`, email: email(`corrida${i}`) })));
    const codes = results.map((r) => r.status).sort();
    assert.equal(codes.filter((c) => c === 201).length, 2, `status: ${codes.join(',')}`);
    for (const r of results.filter((x) => x.status !== 201)) {
      assert.ok(['FORM_FULL', 'FORM_CLOSED'].includes(r.body.code), JSON.stringify(r.body));
    }
    assert.equal(await prisma.registrationSubmission.count({ where: { formId: form.id, status: { in: ['PENDING', 'CONFIRMED'] } } }), 2);
    const pub = await http().get(`/api/public/forms/${form.slug}`).expect(200);
    assert.equal(pub.body.closedReason, 'FULL');
    assert.equal(pub.body.spotsLeft, 0);

    await http().put(`/api/event-forms/${form.id}`).set(auth(mestre)).send({ allowWaitlist: true }).expect(200);
    const wait = await submit(form.slug, { nome: 'Espera', email: email('espera') }).expect(201);
    assert.equal(wait.body.status, 'WAITLIST');
    const summary = await http().get(`/api/event-forms/${form.id}/summary`).set(auth(mestre)).expect(200);
    assert.equal(summary.body.byStatus.WAITLIST, 1);
    assert.equal(summary.body.spotsLeft, 0);
  });

  it('formulario encerrado ou com prazo vencido = 410 FORM_CLOSED com closedReason; pix some', async () => {
    const form = await openForm(simpleDef());
    await http().post(`/api/event-forms/${form.id}/close`).set(auth(mestre)).expect(200);
    const closed = await submit(form.slug, { nome: 'Tarde', email: email('tarde') }).expect(410);
    assert.equal(closed.body.code, 'FORM_CLOSED');
    assert.equal(closed.body.closedReason, 'CLOSED');
    const pub = await http().get(`/api/public/forms/${form.slug}`).expect(200);
    assert.equal(pub.body.isOpen, false);

    const late = await openForm(simpleDef());
    await prisma.registrationForm.update({ where: { id: late.id }, data: { closesAt: new Date(Date.now() - 60_000) } });
    assert.equal((await submit(late.slug, { nome: 'Prazo', email: email('prazo') }).expect(410)).body.closedReason, 'DEADLINE');
  });

  it('confirmar pagamento cria UM participante no evento (CPF de aluno = so sugestao; Mestre liga com linkStudentId); recusar remove', async () => {
    const event = await prisma.event.create({ data: { organizationId: orgA, title: 'Evento com form', date: new Date(Date.now() + 9 * 86_400_000) } });
    const created = await http().post('/api/event-forms').set(auth(mestre)).send({ eventId: event.id }).expect(201);
    await http()
      .put(`/api/event-forms/${created.body.id}`)
      .set(auth(mestre))
      .send({ ...simpleDef(), paymentMode: 'PIX_MANUAL', priceCents: 1000, pixKey: 'pix@x.test', pixKeyType: 'EMAIL', pixBeneficiary: 'Grupo' })
      .expect(200);
    const form = (await http().post(`/api/event-forms/${created.body.id}/open`).set(auth(mestre)).expect(200)).body;

    // aluno ATIVO do grupo com ficha (CPF)
    const studentCpf = cpf(20);
    const person = await prisma.person.create({ data: { gingappCode: `GING-E2E${stamp.slice(-4)}-RF`, name: 'Aluno Ficha', documentHash: hashPersonDocument(`CPF:${studentCpf}`), documentKind: 'CPF', documentLast4: studentCpf.slice(-4) } });
    const student = await prisma.student.create({ data: { organizationId: orgA, name: 'Aluno Ficha', personId: person.id, status: 'ACTIVE' } });

    const sub = await submit(form.slug, { nome: 'Aluno Ficha', email: email('ficha'), cpf: studentCpf }).expect(201);
    assert.equal(sub.body.status, 'PENDING');
    assert.equal(sub.body.proofRequired, true);
    const row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: sub.body.protocol } });
    assert.equal(row.studentId, null, 'envio anonimo nunca liga a ficha');
    assert.equal(row.suggestedStudentId, student.id);
    const base = `/api/event-forms/${form.id}/submissions/${row.id}`;
    const pending = await http().get(base).set(auth(mestre)).expect(200);
    assert.deepEqual(pending.body.suggestedStudent, { id: student.id, name: 'Aluno Ficha' });

    // confirmar pagamento: so o MESTRE
    await http().post(`${base}/confirm-payment`).set(auth(professor)).expect(403);
    // aluno de OUTRO grupo nao pode ser ligado
    const foreign = await prisma.student.create({ data: { organizationId: orgB, name: 'Aluno B', status: 'ACTIVE' } });
    await http().post(`${base}/confirm-payment`).set(auth(mestre)).send({ linkStudentId: foreign.id }).expect(400);
    const confirmed = await http().post(`${base}/confirm-payment`).set(auth(mestre)).send({ linkStudentId: student.id }).expect(200);
    assert.equal(confirmed.body.status, 'CONFIRMED');
    assert.equal(confirmed.body.paymentStatus, 'CONFIRMED');
    assert.equal(confirmed.body.studentId, student.id);
    assert.equal(confirmed.body.suggestedStudent, null, 'ja ligado: sem sugestao');
    await http().post(`${base}/confirm-payment`).set(auth(mestre)).expect(200); // idempotente
    await http().post(`${base}/approve`).set(auth(mestre)).expect(200); // ja confirmada: sem efeito
    const participants = await prisma.eventParticipant.findMany({ where: { eventId: event.id } });
    assert.equal(participants.length, 1);
    assert.equal(participants[0].studentId, student.id);
    assert.equal(participants[0].status, 'CONFIRMED');
    assert.equal((await prisma.auditLog.count({ where: { action: 'REGISTRATION_SUBMISSION_CONFIRM_PAYMENT', resourceId: String(row.id) } })), 1);

    const rejected = await http().post(`${base}/reject`).set(auth(mestre)).send({ reason: 'Comprovante ilegível' }).expect(200);
    assert.equal(rejected.body.status, 'REJECTED');
    assert.equal(rejected.body.reviewNote, 'Comprovante ilegível');
    assert.equal(rejected.body.paymentStatus, 'CONFIRMED', 'pagamento ja recebido fica registrado (estorno)');
    assert.deepEqual(rejected.body.timeline.map((t: { action: string }) => t.action), ['SUBMITTED', 'PAYMENT_CONFIRMED', 'REJECTED']);
    assert.ok(rejected.body.timeline[1].by, 'autor da acao no historico');
    assert.equal(await prisma.eventParticipant.count({ where: { eventId: event.id } }), 0);
    const invalid = await http().post(`${base}/approve`).set(auth(mestre)).expect(409);
    assert.equal(invalid.body.code, 'INVALID_TRANSITION');

    // convidado sem ficha: guestName = nome
    const guest = await submit(form.slug, { nome: 'Convidado Externo', email: email('guest') }).expect(201);
    const guestRow = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: guest.body.protocol } });
    await http().post(`/api/event-forms/${form.id}/submissions/${guestRow.id}/confirm-payment`).set(auth(mestre)).expect(200);
    const p = await prisma.eventParticipant.findFirstOrThrow({ where: { eventId: event.id } });
    assert.equal(p.guestName, 'Convidado Externo');
    assert.equal(p.studentId, null);

    // recusar com pagamento AINDA pendente: deixa de cobrar (contrato c: REJECTED/CANCELLED -> NOT_REQUIRED)
    const unpaid = await submit(form.slug, { nome: 'Nao Pagou', email: email('naopagou') }).expect(201);
    const unpaidRow = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: unpaid.body.protocol } });
    const r = await http().post(`/api/event-forms/${form.id}/submissions/${unpaidRow.id}/reject`).set(auth(mestre)).expect(200);
    assert.equal(r.body.paymentStatus, 'NOT_REQUIRED');
    const unpaid2 = await submit(form.slug, { nome: 'Desistiu', email: email('desistiu') }).expect(201);
    const unpaid2Row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: unpaid2.body.protocol } });
    assert.equal((await http().post(`/api/event-forms/${form.id}/submissions/${unpaid2Row.id}/cancel`).set(auth(mestre)).expect(200)).body.paymentStatus, 'NOT_REQUIRED');

    // trocar o evento de um formulario com inscricao CONFIRMADA = 409 FORM_HAS_CONFIRMED (M7)
    const otherEvent = await prisma.event.create({ data: { organizationId: orgA, title: 'Outro evento', date: new Date(Date.now() + 20 * 86_400_000) } });
    const moved = await http().put(`/api/event-forms/${form.id}`).set(auth(mestre)).send({ eventId: otherEvent.id }).expect(409);
    assert.equal(moved.body.code, 'FORM_HAS_CONFIRMED');
    await http().put(`/api/event-forms/${form.id}`).set(auth(mestre)).send({ eventId: event.id }).expect(200); // mesmo evento: ok
  });

  it('A4: CPF de aluno com participacao WAITLIST - o envio anonimo NAO mexe nela; Mestre liga; Event.capacity respeitada', async () => {
    const event = await prisma.event.create({ data: { organizationId: orgA, title: 'Evento lotavel', date: new Date(Date.now() + 9 * 86_400_000), capacity: 1 } });
    const studentCpf = cpf(70);
    const person = await prisma.person.create({ data: { gingappCode: `GING-E2E${stamp.slice(-4)}-A4`, name: 'Aluna Espera', documentHash: hashPersonDocument(`CPF:${studentCpf}`), documentKind: 'CPF', documentLast4: studentCpf.slice(-4) } });
    const student = await prisma.student.create({ data: { organizationId: orgA, name: 'Aluna Espera', personId: person.id, status: 'ACTIVE' } });
    const waiting = await prisma.eventParticipant.create({ data: { organizationId: orgA, eventId: event.id, studentId: student.id, status: 'WAITLIST' } });

    const created = await http().post('/api/event-forms').set(auth(mestre)).send({ eventId: event.id }).expect(201);
    await http().put(`/api/event-forms/${created.body.id}`).set(auth(mestre)).send({ ...simpleDef(), requireApproval: true, maxSubmissions: 10 }).expect(200);
    const form = (await http().post(`/api/event-forms/${created.body.id}/open`).set(auth(mestre)).expect(200)).body;

    const sub = await submit(form.slug, { nome: 'Quem Sabe O Cpf', email: email('a4'), cpf: studentCpf }).expect(201);
    assert.equal(sub.body.status, 'PENDING');
    const row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: sub.body.protocol } });
    assert.equal(row.studentId, null);
    assert.equal((await prisma.eventParticipant.findUniqueOrThrow({ where: { id: waiting.id } })).status, 'WAITLIST', 'participacao existente intacta');

    // Mestre aprova LIGANDO a aluna: a participacao que ela ja tinha continua WAITLIST (nunca promovida sozinha)
    const approved = await http().post(`/api/event-forms/${form.id}/submissions/${row.id}/approve`).set(auth(mestre)).send({ linkStudentId: student.id }).expect(200);
    assert.equal(approved.body.status, 'CONFIRMED');
    assert.equal(approved.body.studentId, student.id);
    assert.equal((await prisma.eventParticipant.findUniqueOrThrow({ where: { id: waiting.id } })).status, 'WAITLIST');
    assert.equal(await prisma.eventParticipant.count({ where: { eventId: event.id } }), 1, 'sem duplicata');
    // linkStudentId em acao que nao e approve/confirm-payment = 400
    await http().post(`/api/event-forms/${form.id}/submissions/${row.id}/waitlist`).set(auth(mestre)).send({ linkStudentId: student.id }).expect(400);

    // capacidade do EVENTO (1): o 1o convidado aprovado ocupa a vaga; o 2o = 409 FORM_FULL e continua pendente
    const g1 = await submit(form.slug, { nome: 'Convidado Um', email: email('g1') }).expect(201);
    const g2 = await submit(form.slug, { nome: 'Convidado Dois', email: email('g2') }).expect(201);
    const g1Row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: g1.body.protocol } });
    const g2Row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: g2.body.protocol } });
    await http().post(`/api/event-forms/${form.id}/submissions/${g1Row.id}/approve`).set(auth(mestre)).expect(200);
    const full = await http().post(`/api/event-forms/${form.id}/submissions/${g2Row.id}/approve`).set(auth(mestre)).expect(409);
    assert.equal(full.body.code, 'FORM_FULL');
    assert.equal((await prisma.registrationSubmission.findUniqueOrThrow({ where: { id: g2Row.id } })).status, 'PENDING');
    assert.equal(await prisma.eventParticipant.count({ where: { eventId: event.id, status: { in: ['CONFIRMED', 'ATTENDED'] } } }), 1);
  });

  it('detalhe (CPF mascarado, auditado), anexo so autenticado do mesmo grupo (nosniff, no-store), CSV mascarado e sem formula', async () => {
    const form = await openForm(simpleDef({ fields: [...simpleDef().fields, { key: 'comprovante', type: 'FILE', label: 'Comprovante', sectionIndex: 0 }] }));
    const up = await http().post(`/api/public/forms/${form.slug}/files`).field('fieldKey', 'comprovante').attach('file', await jpeg(), 'pix.jpg').expect(201);
    const doc = cpf(30);
    const sub = await submit(form.slug, { nome: '=HYPERLINK("http://mal.test","x")', email: email('csv'), cpf: doc, comprovante: { fileToken: up.body.fileToken } }).expect(201);
    const row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: sub.body.protocol }, include: { files: true } });

    const detail = await http().get(`/api/event-forms/${form.id}/submissions/${row.id}`).set(auth(mestre)).expect(200);
    assert.equal(detail.body.document, `***.***.***-${doc.slice(-2)}`);
    assert.ok(!detail.text.includes(doc));
    const cpfAnswer = detail.body.answers.find((a: { fieldKey: string }) => a.fieldKey === 'cpf');
    assert.equal(cpfAnswer.value, `***.***.***-${doc.slice(-2)}`);
    assert.equal(detail.body.files.length, 1);
    assert.equal((await prisma.auditLog.count({ where: { action: 'REGISTRATION_SUBMISSION_VIEW', resourceId: String(row.id) } })), 1);

    const fileUrl = `/api/event-forms/${form.id}/submissions/${row.id}/files/${row.files[0].id}`;
    const got = await http().get(fileUrl).set(auth(mestre)).buffer(true).expect(200);
    assert.equal(got.headers['content-type'], 'image/jpeg');
    assert.equal(got.headers['x-content-type-options'], 'nosniff');
    assert.equal(got.headers['cache-control'], 'private, no-store');
    assert.match(got.headers['content-disposition'], /^inline/);
    assert.equal(got.headers['content-security-policy'], "default-src 'none'; sandbox");
    await http().get(fileUrl).expect(401);
    await http().get(fileUrl).set(auth(mestreB)).expect(404);
    await http().get(fileUrl).set(auth(aluno)).expect(403);
    // PROFESSOR: lista e ve o detalhe, mas SEM anexos (comprovante/documento so para o Mestre) e sem CSV
    await http().get(fileUrl).set(auth(professor)).expect(403);
    await http().get(`/api/event-forms/${form.id}/submissions/export.csv`).set(auth(professor)).expect(403);
    const profDetail = await http().get(`/api/event-forms/${form.id}/submissions/${row.id}`).set(auth(professor)).expect(200);
    assert.deepEqual(profDetail.body.files, []);
    assert.equal(profDetail.body.filesRestricted, true);
    assert.deepEqual(profDetail.body.answers.find((a: { fieldKey: string }) => a.fieldKey === 'comprovante').value, []);
    assert.equal(detail.body.filesRestricted, false);
    await http().get(`/api/event-forms/${form.id}/submissions`).set(auth(professor)).expect(200);
    assert.ok((await prisma.auditLog.count({ where: { action: 'REGISTRATION_SUBMISSION_LIST', resourceId: String(form.id) } })) >= 1, 'listar e auditado');
    const other = await openForm(simpleDef());
    await http().get(`/api/event-forms/${other.id}/submissions/${row.id}/files/${row.files[0].id}`).set(auth(mestre)).expect(404);
    assert.equal((await prisma.auditLog.count({ where: { action: 'REGISTRATION_FILE_VIEW', resourceId: String(row.id) } })), 1);

    const csv = await http().get(`/api/event-forms/${form.id}/submissions/export.csv`).set(auth(mestre)).buffer(true).expect(200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.ok(csv.text.startsWith('﻿'));
    assert.ok(csv.text.includes(`'=HYPERLINK`), 'formula neutralizada');
    assert.ok(csv.text.includes(`***.***.***-${doc.slice(-2)}`));
    assert.ok(!csv.text.includes(doc), 'CPF completo nunca sai no CSV');
    assert.equal(csv.headers['x-total-count'], '1');
    assert.equal((await prisma.auditLog.count({ where: { action: 'REGISTRATION_EXPORT', resourceId: String(form.id) } })), 1);
  });

  it('CSV em stream com os filtros da lista (status, paymentStatus, q); limit/offset recusados', async () => {
    const form = await openForm(simpleDef());
    const subs = [];
    for (let i = 0; i < 3; i++) subs.push((await submit(form.slug, { nome: `Csv Filtro ${i}`, email: email(`csvf${i}`) }).expect(201)).body.protocol as string);
    const rejectedRow = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: subs[1] } });
    await http().post(`/api/event-forms/${form.id}/submissions/${rejectedRow.id}/reject`).set(auth(mestre)).expect(200);
    const get = (qs: string) => http().get(`/api/event-forms/${form.id}/submissions/export.csv${qs}`).set(auth(mestre)).buffer(true);
    const dataLines = (text: string) => text.split('\r\n').filter((l) => l.startsWith('INS-'));
    const all = await get('').expect(200);
    assert.equal(dataLines(all.text).length, 3);
    const rejected = await get('?status=REJECTED').expect(200);
    assert.deepEqual(dataLines(rejected.text).map((l) => l.split(';')[0]), [subs[1]]);
    assert.equal(rejected.headers['x-total-count'], '1');
    assert.equal(dataLines((await get(`?q=${subs[2].toLowerCase()}`).expect(200)).text).length, 1);
    assert.equal(dataLines((await get('?paymentStatus=PENDING').expect(200)).text).length, 0);
    await get('?limit=10').expect(400);
    await get('?status=NOPE').expect(400);
  });

  it('PUT atomico: campo removido de form COM inscricoes vira archived (resposta preservada); sem inscricoes e apagado', async () => {
    const form = await openForm({
      sections: [{ title: 'S' }],
      fields: [
        { key: 'nome', type: 'SHORT_TEXT', label: 'Nome', required: true, mapsTo: 'name', sectionIndex: 0 },
        { key: 'email', type: 'EMAIL', label: 'E-mail', required: true, sectionIndex: 0 },
        { key: 'apelido', type: 'SHORT_TEXT', label: 'Apelido', sectionIndex: 0 },
      ],
    });
    const sub = await submit(form.slug, { nome: 'Arq', email: email('arq'), apelido: 'Pimenta' }).expect(201);
    const current = (await http().get(`/api/event-forms/${form.id}`).set(auth(mestre)).expect(200)).body;
    const typeChange = await http()
      .put(`/api/event-forms/${form.id}`)
      .set(auth(mestre))
      .send({ sections: current.sections.map((s: { id: number; title: string }) => ({ id: s.id, title: s.title })), fields: current.fields.map((f: { key: string; type: string }) => ({ ...f, id: undefined, order: undefined, archived: undefined, sectionId: current.sections[0].id, type: f.key === 'apelido' ? 'LONG_TEXT' : f.type })) })
      .expect(400);
    assert.ok(typeChange.body.fields.apelido);

    const keep = current.fields.filter((f: { key: string }) => f.key !== 'apelido').map((f: Record<string, unknown>) => ({
      key: f.key, type: f.type, label: f.label, required: f.required, mapsTo: f.mapsTo, sectionId: current.sections[0].id,
    }));
    const saved = await http().put(`/api/event-forms/${form.id}`).set(auth(mestre)).send({ sections: current.sections.map((s: { id: number; title: string }) => ({ id: s.id, title: s.title })), fields: keep }).expect(200);
    assert.ok(!saved.body.fields.some((f: { key: string }) => f.key === 'apelido'));
    const withArchived = await http().get(`/api/event-forms/${form.id}?includeArchived=true`).set(auth(mestre)).expect(200);
    assert.equal(withArchived.body.fields.find((f: { key: string }) => f.key === 'apelido').archived, true);
    const row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: sub.body.protocol } });
    const detail = await http().get(`/api/event-forms/${form.id}/submissions/${row.id}`).set(auth(mestre)).expect(200);
    assert.equal(detail.body.answers.find((a: { fieldKey: string }) => a.fieldKey === 'apelido').value, 'Pimenta');
    const pub = await http().get(`/api/public/forms/${form.slug}`).expect(200);
    assert.ok(!pub.body.fields.some((f: { key: string }) => f.key === 'apelido'), 'arquivado fora do publico');

    // sem inscricoes: o campo e apagado de verdade
    const empty = await http().post('/api/event-forms').set(auth(mestre)).send({ title: 'Sem respostas', template: 'SIMPLES' }).expect(201);
    await http().put(`/api/event-forms/${empty.body.id}`).set(auth(mestre)).send({ sections: [], fields: [{ key: 'nome_completo', type: 'SHORT_TEXT', label: 'Nome' }] }).expect(200);
    assert.equal(await prisma.registrationFormField.count({ where: { formId: empty.body.id } }), 1);
    // excluir: vazio = 204; com inscricoes = 409 FORM_HAS_SUBMISSIONS
    await http().delete(`/api/event-forms/${empty.body.id}`).set(auth(mestre)).expect(204);
    assert.equal((await http().delete(`/api/event-forms/${form.id}`).set(auth(mestre)).expect(409)).body.code, 'FORM_HAS_SUBMISSIONS');
  });

  it('consulta por protocolo: so com e-mail/CPF que batem; qualquer falha = o MESMO 404', async () => {
    const form = await openForm(simpleDef());
    const mail = email('lookup');
    const sub = await submit(form.slug, { nome: 'Consulta', email: mail, cpf: cpf(40) }).expect(201);
    const look = (body: Record<string, unknown>, slug = form.slug) => http().post(`/api/public/forms/${slug}/lookup`).send(body);
    const ok = await look({ protocol: sub.body.protocol.toLowerCase(), email: mail.toUpperCase() }).expect(200);
    assert.deepEqual(Object.keys(ok.body).sort(), ['message', 'paymentStatus', 'protocol', 'status']);
    await look({ protocol: sub.body.protocol, document: cpf(40) }).expect(200);
    const wrong = await look({ protocol: sub.body.protocol, email: email('x') }).expect(404);
    const missing = await look({ protocol: 'INS-ZZZZZZ', email: mail }).expect(404);
    const otherForm = await openForm(simpleDef());
    const otherSlug = await look({ protocol: sub.body.protocol, email: mail }, otherForm.slug).expect(404);
    assert.deepEqual(wrong.body, missing.body);
    assert.deepEqual(wrong.body, otherSlug.body);
  });

  it('share HTML: Open Graph com titulo ESCAPADO (anti-XSS) e redirecionamento; inexistente = 404 neutro', async () => {
    const form = await openForm(simpleDef({ title: '"><script>alert(1)</script> Campeonato', intro: '<b>Venha</b> para o **campeonato**!', bannerUrl: '/api/uploads/00000000-0000-4000-8000-000000000000.webp' }));
    const res = await http().get(`/api/public/forms/${form.slug}/share`).expect(200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.ok(!res.text.includes('<script>alert(1)'), 'titulo nao injeta script');
    assert.ok(res.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(res.text.includes('<meta property="og:description" content="Venha para o campeonato!">'));
    assert.ok(res.text.includes(`<meta property="og:image" content="https://app.e2e.test/api/uploads/00000000-0000-4000-8000-000000000000.webp">`));
    assert.ok(res.text.includes(`<meta property="og:url" content="https://app.e2e.test/i/${form.slug}">`));
    assert.ok(res.text.includes(`url=https://app.e2e.test/i/${form.slug}?src=share`));
    assert.match(res.headers['content-security-policy'], /script-src 'sha256-/);
    const missing = await http().get('/api/public/forms/nao-existe-abc12/share').expect(404);
    assert.ok(missing.text.includes('og:title') && missing.text.includes('https://app.e2e.test/icone.png'));
  });

  it('nenhuma linha de auditoria do grupo carrega CPF, e-mail ou nome de inscrito', async () => {
    const subs = await prisma.registrationSubmission.findMany({ where: { organizationId: orgA, anonymizedAt: null }, select: { email: true, name: true, documentLast4: true } });
    assert.ok(subs.length > 5);
    const rows = await prisma.auditLog.findMany({ where: { organizationId: orgA, action: { startsWith: 'REGISTRATION_' } } });
    const text = JSON.stringify(rows.map((r) => r.metadata));
    for (const s of subs) {
      if (s.email) assert.ok(!text.includes(s.email), s.email);
      // nomes curtos/genericos ("Dup", "Prazo") poderiam casar por acaso com nomes de configuracao: so os distintivos
      if (s.name.length >= 8 && !s.name.startsWith('Inscrição ') && !s.name.startsWith('=')) assert.ok(!text.includes(s.name), s.name);
    }
    for (const seed of [1, 10, 20, 30, 40]) assert.ok(!text.includes(cpf(seed)));
  });

  it('retencao (FORMS_RETENTION_PURGE=true): anonimiza respostas e apaga anexos de form encerrado ha mais de N meses', async () => {
    const form = await openForm(simpleDef({ fields: [...simpleDef().fields, { key: 'comprovante', type: 'FILE', label: 'Comprovante', sectionIndex: 0 }] }));
    const up = await http().post(`/api/public/forms/${form.slug}/files`).field('fieldKey', 'comprovante').attach('file', await jpeg(), 'pix.jpg').expect(201);
    const sub = await submit(form.slug, { nome: 'Antigo Retencao', email: email('ret'), cpf: cpf(50), comprovante: { fileToken: up.body.fileToken } }).expect(201);
    const file = await prisma.registrationSubmissionFile.findFirstOrThrow({ where: { formId: form.id } });
    await prisma.registrationForm.update({ where: { id: form.id }, data: { status: 'CLOSED', closedAt: new Date(Date.now() - 400 * 86_400_000) } });

    const cron = new FormsRetentionCronService(app.get(PrismaService), app.get(AuditService));
    process.env.FORMS_RETENTION_PURGE = 'dry-run';
    const dry = await cron.run({ organizationId: orgA });
    assert.equal(dry?.dryRun, true);
    assert.equal((await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: sub.body.protocol } })).anonymizedAt, null);
    process.env.FORMS_RETENTION_PURGE = 'true';
    try {
      const result = await cron.run({ organizationId: orgA });
      assert.ok((result?.submissionsAnonymized ?? 0) >= 1);
    } finally {
      process.env.FORMS_RETENTION_PURGE = 'false';
    }
    const row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: sub.body.protocol } });
    assert.ok(row.anonymizedAt);
    assert.equal(row.email, null);
    assert.equal(row.documentHash, null);
    assert.deepEqual(row.answers, {});
    assert.equal(row.protocol, sub.body.protocol, 'protocolo e contadores ficam');
    await assert.rejects(fs.access(path.join(privateDir, ...file.storageKey.split('/'))));
    assert.equal(await prisma.registrationSubmissionFile.count({ where: { formId: form.id } }), 0);
  });

  it('pedido de exclusao LGPD (anonimizacao do titular) inclui as inscricoes com o mesmo e-mail', async () => {
    const form = await openForm(simpleDef());
    const mail = email('titular');
    const sub = await submit(form.slug, { nome: 'Titular Exclusao', email: mail, cpf: cpf(60) }).expect(201);
    const titular = await prisma.user.create({ data: { email: mail, passwordHash: 'x', name: 'Titular Exclusao', userType: 'MEMBER' } });
    const req = await prisma.dataDeletionRequest.create({ data: { userId: titular.id, organizationId: orgA } });
    await app.get(AnonymizationService, { strict: false }).anonymizeRequest(req.id, titular.id);
    const row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: sub.body.protocol } });
    assert.ok(row.anonymizedAt);
    assert.equal(row.email, null);
    assert.equal(row.name, 'Inscrição removida');
    await prisma.dataDeletionRequest.deleteMany({ where: { userId: titular.id } });
    await prisma.auditLog.deleteMany({ where: { userId: titular.id } });
    await prisma.user.delete({ where: { id: titular.id } }); // e-mail anonimizado: a limpeza por dominio nao o acharia
  });

  it('rate limit proprio da consulta (limite rebaixado): estoura com 429 TOO_MANY_REQUESTS', async () => {
    const form = await openForm(simpleDef());
    process.env.FORMS_LOOKUP_THROTTLE_LIMIT = '2';
    try {
      const statuses: number[] = [];
      let body: Record<string, unknown> = {};
      for (let i = 0; i < 4; i++) {
        const r = await http().post(`/api/public/forms/${form.slug}/lookup`).send({ protocol: 'INS-ZZZZZZ', email: 'a@b.test' });
        statuses.push(r.status);
        if (r.status === 429) body = r.body;
      }
      assert.ok(statuses.includes(429), statuses.join(','));
      assert.equal(body.code, 'TOO_MANY_REQUESTS');
    } finally {
      process.env.FORMS_LOOKUP_THROTTLE_LIMIT = '1000';
    }
  });

  // ------------------------------------------------------------------------------------------------ pos-auditoria

  it('A1: e-mail ao inscrito sem texto do atacante e no maximo 3 por destinatario (alias Gmail contam juntos) em 24 h', async () => {
    const victim = `vitima${stamp}`;
    const aliases = [`${victim}@gmail.com`, `${victim}+a@gmail.com`, `${victim.slice(0, 3)}.${victim.slice(3)}@gmail.com`, `${victim}@googlemail.com`];
    const attackerText = 'CLIQUE http://golpe.test AGORA';
    for (const address of aliases) {
      const form = await openForm(simpleDef());
      await submit(form.slug, { nome: attackerText, email: address }).expect(201);
    }
    const sent = mailbox.sent.filter((m) => aliases.includes(m.to));
    assert.equal(sent.length, 3, `enviados: ${sent.length}`);
    for (const m of sent) {
      assert.ok(!m.text.includes('golpe') && !m.html.includes('golpe') && !m.subject.includes('golpe'), 'nada digitado pelo inscrito');
      assert.ok(m.text.startsWith('Olá!'));
    }
  });

  it('A2: teto de anexos pendentes por IP (conta tambem os expirados); limpeza de pendentes expirados (15 min) libera; EXIF/GPS removido', async () => {
    const form = await openForm(simpleDef({ fields: [...simpleDef().fields, { key: 'comprovante', type: 'FILE', label: 'Comprovante', sectionIndex: 0 }] }));
    const exifJpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#a63' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'SEGREDO-GPS-E2E', Artist: 'Pessoa Real' } })
      .toBuffer();
    assert.ok((await sharp(exifJpeg).metadata()).exif, 'o JPEG de teste tem EXIF');
    const up = () => http().post(`/api/public/forms/${form.slug}/files`).field('fieldKey', 'comprovante').attach('file', exifJpeg, { filename: 'foto.jpg', contentType: 'image/jpeg' });
    await withEnv({ FORMS_PENDING_FILES_PER_IP: '2' }, async () => {
      await up().expect(201);
      await up().expect(201);
      const blocked = await up().expect(429);
      assert.equal(blocked.body.code, 'TOO_MANY_REQUESTS');
      // expirados ainda no disco continuam contando
      await prisma.registrationSubmissionFile.updateMany({ where: { formId: form.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
      await up().expect(429);
      const rows = await prisma.registrationSubmissionFile.findMany({ where: { formId: form.id } });
      assert.equal(rows.length, 2);
      assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(r.ipHash ?? '')), 'ipHash gravado no anexo pendente');
      const stored = await fs.readFile(path.join(privateDir, ...rows[0].storageKey.split('/')));
      assert.equal((await sharp(stored).metadata()).exif, undefined, 'EXIF removido no arquivo guardado');
      assert.ok(!stored.includes(Buffer.from('SEGREDO-GPS-E2E')));
      // a limpeza dos pendentes roda tambem em dry-run (nunca foram inscricao)
      const cron = new FormsRetentionCronService(app.get(PrismaService), app.get(AuditService));
      await withEnv({ FORMS_RETENTION_PURGE: 'dry-run' }, async () => {
        assert.ok(((await cron.cleanPending({ organizationId: orgA })) ?? 0) >= 2);
      });
      assert.equal(await prisma.registrationSubmissionFile.count({ where: { formId: form.id } }), 0);
      await assert.rejects(fs.access(path.join(privateDir, ...rows[0].storageKey.split('/'))));
      await up().expect(201);
    });
    // imagem que nao decodifica (assinatura JPEG + lixo) = 415
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
    const bad = await http().post(`/api/public/forms/${form.slug}/files`).field('fieldKey', 'comprovante').attach('file', broken, 'x.jpg').expect(415);
    assert.equal(bad.body.code, 'FILE_TYPE_NOT_ALLOWED');
  });

  it('A3: teto de inscricoes por IP no formulario (429) e lista de espera com teto (410 FULL)', async () => {
    const form = await openForm(simpleDef());
    await withEnv({ FORMS_SUBMISSIONS_PER_IP_HOUR: '2' }, async () => {
      await submit(form.slug, { nome: 'Ip Um', email: email('ip1') }).expect(201);
      await submit(form.slug, { nome: 'Ip Dois', email: email('ip2') }).expect(201);
      const third = await submit(form.slug, { nome: 'Ip Tres', email: email('ip3') }).expect(429);
      assert.equal(third.body.code, 'TOO_MANY_REQUESTS');
    });
    const queue = await openForm(simpleDef({ maxSubmissions: 1, allowWaitlist: true }));
    await withEnv({ FORMS_WAITLIST_MAX: '1' }, async () => {
      assert.equal((await submit(queue.slug, { nome: 'Vaga', email: email('vaga') }).expect(201)).body.status, 'CONFIRMED');
      assert.equal((await submit(queue.slug, { nome: 'Fila', email: email('fila') }).expect(201)).body.status, 'WAITLIST');
      const full = await submit(queue.slug, { nome: 'Fora', email: email('fora') }).expect(410);
      assert.equal(full.body.code, 'FORM_CLOSED');
      assert.equal(full.body.closedReason, 'FULL');
      assert.equal((await http().get(`/api/public/forms/${queue.slug}`).expect(200)).body.closedReason, 'FULL');
    });
  });

  it('A5/A6: anonimizar UMA inscricao (so MESTRE): apaga anexo, anonimiza o nome no evento, auditado, idempotente', async () => {
    const event = await prisma.event.create({ data: { organizationId: orgA, title: 'Evento anonimizar', date: new Date(Date.now() + 9 * 86_400_000) } });
    const created = await http().post('/api/event-forms').set(auth(mestre)).send({ eventId: event.id }).expect(201);
    await http()
      .put(`/api/event-forms/${created.body.id}`)
      .set(auth(mestre))
      .send(simpleDef({ fields: [...simpleDef().fields, { key: 'comprovante', type: 'FILE', label: 'Comprovante', sectionIndex: 0 }] }))
      .expect(200);
    const form = (await http().post(`/api/event-forms/${created.body.id}/open`).set(auth(mestre)).expect(200)).body;
    const up = await http().post(`/api/public/forms/${form.slug}/files`).field('fieldKey', 'comprovante').attach('file', await jpeg(), 'pix.jpg').expect(201);
    const sub = await submit(form.slug, { nome: 'Titular Sem Conta', email: email('semconta'), cpf: cpf(80), comprovante: { fileToken: up.body.fileToken } }).expect(201);
    assert.equal(sub.body.status, 'CONFIRMED');
    const row = await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: sub.body.protocol }, include: { files: true } });
    assert.equal((await prisma.eventParticipant.findUniqueOrThrow({ where: { id: row.eventParticipantId! } })).guestName, 'Titular Sem Conta');
    const url = `/api/event-forms/${form.id}/submissions/${row.id}/anonymize`;
    await http().post(url).set(auth(professor)).expect(403);
    await http().post(url).set(auth(mestreB)).expect(404);
    const done = await http().post(url).set(auth(mestre)).expect(200);
    assert.ok(done.body.anonymizedAt);
    assert.equal(done.body.name, 'Inscrição removida');
    assert.equal(done.body.email, null);
    const after = await prisma.registrationSubmission.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.documentHash, null);
    assert.equal(after.emailKey, null);
    assert.equal((await prisma.eventParticipant.findUniqueOrThrow({ where: { id: row.eventParticipantId! } })).guestName, 'Participante anonimizado');
    await assert.rejects(fs.access(path.join(privateDir, ...row.files[0].storageKey.split('/'))));
    assert.equal(await prisma.registrationSubmissionFile.count({ where: { submissionId: row.id } }), 0);
    const again = await http().post(url).set(auth(mestre)).expect(200);
    assert.equal(again.body.anonymizedAt, done.body.anonymizedAt);
    assert.equal(await prisma.auditLog.count({ where: { action: 'REGISTRATION_SUBMISSION_ANONYMIZE', resourceId: String(row.id) } }), 1);
    assert.ok(again.body.timeline.some((t: { action: string }) => t.action === 'ANONYMIZED'));
  });

  it('A5: retencao de form SEM data de encerramento conta por inscricao (createdAt + N meses); summary.retention', async () => {
    const form = await openForm(simpleDef());
    const old = await submit(form.slug, { nome: 'Velha Sem Prazo', email: email('velha') }).expect(201);
    const recent = await submit(form.slug, { nome: 'Nova Sem Prazo', email: email('nova') }).expect(201);
    await prisma.registrationSubmission.update({ where: { protocol: old.body.protocol }, data: { createdAt: new Date(Date.now() - 400 * 86_400_000) } });
    const summary = await http().get(`/api/event-forms/${form.id}/summary`).set(auth(mestre)).expect(200);
    assert.deepEqual(summary.body.retention, { mode: 'false', months: 12 });
    await withEnv({ FORMS_RETENTION_PURGE: 'dry-run' }, async () => {
      assert.equal((await http().get(`/api/event-forms/${form.id}/summary`).set(auth(mestre)).expect(200)).body.retention.mode, 'dry-run');
    });
    const cron = new FormsRetentionCronService(app.get(PrismaService), app.get(AuditService));
    await withEnv({ FORMS_RETENTION_PURGE: 'true' }, async () => {
      await cron.run({ organizationId: orgA });
    });
    assert.ok((await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: old.body.protocol } })).anonymizedAt);
    assert.equal((await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: recent.body.protocol } })).anonymizedAt, null);
    assert.equal((await prisma.registrationForm.findUniqueOrThrow({ where: { id: form.id } })).purgedAt, null, 'form continua aberto');
  });

  it('M4: varredura disco x banco - arquivo sem registro > 7 dias (dry-run so conta; true apaga) e registro sem arquivo (so log)', async () => {
    const form = await openForm(simpleDef({ fields: [...simpleDef().fields, { key: 'comprovante', type: 'FILE', label: 'Comprovante', sectionIndex: 0 }] }));
    const dir = path.join(privateDir, `org-${orgA}`);
    await fs.mkdir(dir, { recursive: true });
    const orphan = path.join(dir, '11111111-2222-4333-8444-555555555555.jpg');
    const fresh = path.join(dir, '11111111-2222-4333-8444-666666666666.jpg');
    await fs.writeFile(orphan, 'x');
    await fs.writeFile(fresh, 'y');
    const old = new Date(Date.now() - 8 * 86_400_000);
    await fs.utimes(orphan, old, old);
    await prisma.registrationSubmissionFile.create({
      data: { formId: form.id, organizationId: orgA, fieldKey: 'comprovante', storageKey: `org-${orgA}/11111111-2222-4333-8444-777777777777.pdf`, originalName: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 1, sha256: 'x' },
    });
    const cron = new FormsRetentionCronService(app.get(PrismaService), app.get(AuditService));
    await withEnv({ FORMS_RETENTION_PURGE: 'dry-run' }, async () => {
      const dry = await cron.sweepFiles({ baseDir: privateDir, organizationId: orgA });
      assert.equal(dry?.orphanFiles, 1, JSON.stringify(dry));
      assert.equal(dry?.orphanFilesDeleted, 0);
      assert.ok((dry?.rowsWithoutFile ?? 0) >= 1);
    });
    await fs.access(orphan); // dry-run nao apaga
    await withEnv({ FORMS_RETENTION_PURGE: 'true' }, async () => {
      assert.equal((await cron.sweepFiles({ baseDir: privateDir, organizationId: orgA }))?.orphanFilesDeleted, 1);
    });
    await assert.rejects(fs.access(orphan));
    await fs.access(fresh); // recente (upload em andamento) fica
    await fs.rm(fresh);
    await prisma.registrationSubmissionFile.deleteMany({ where: { formId: form.id } });
  });

  it('M1: snapshot do termo (SHA-256 + texto) por versao; versao exibida desatualizada = 409 CONSENT_OUTDATED', async () => {
    const form = await openForm(simpleDef());
    const pub = await http().get(`/api/public/forms/${form.slug}`).expect(200);
    const v1 = pub.body.consent.version as number;
    const first = await submit(form.slug, { nome: 'Termo Um', email: email('termo1') }, { consentVersion: v1 }).expect(201);
    const snaps = await prisma.registrationConsentVersion.findMany({ where: { formId: form.id }, orderBy: { version: 'asc' } });
    const snap = snaps.find((s) => s.version === v1)!;
    assert.ok(snap.text.startsWith(pub.body.consent.text));
    assert.equal(snap.textHash, createHash('sha256').update(snap.text).digest('hex'));
    assert.equal((await prisma.registrationSubmission.findUniqueOrThrow({ where: { protocol: first.body.protocol } })).consentVersion, v1);
    // mudar o prazo de retencao muda o texto PADRAO (que cita os meses) => nova versao
    await http().put(`/api/event-forms/${form.id}`).set(auth(mestre)).send({ retentionMonths: 6 }).expect(200);
    const v2 = (await http().get(`/api/public/forms/${form.slug}`).expect(200)).body.consent.version as number;
    assert.equal(v2, v1 + 1);
    // mudar o rotulo de um CONSENT tambem
    const current = (await http().get(`/api/event-forms/${form.id}`).set(auth(mestre)).expect(200)).body;
    await http()
      .put(`/api/event-forms/${form.id}`)
      .set(auth(mestre))
      .send({ sections: [{ id: current.sections[0].id, title: 'Dados' }], fields: [...simpleDef().fields.map((f) => ({ ...f, sectionIndex: 0 })), { key: 'aceite', type: 'CONSENT', label: 'Aceito as regras.', required: true, sectionIndex: 0 }] })
      .expect(200);
    const v3 = (await http().get(`/api/public/forms/${form.slug}`).expect(200)).body.consent.version as number;
    assert.equal(v3, v2 + 1);
    const outdated = await submit(form.slug, { nome: 'Termo Velho', email: email('termo2'), aceite: true }, { consentVersion: v1 }).expect(409);
    assert.equal(outdated.body.code, 'CONSENT_OUTDATED');
    await withEnv({ FORMS_PUBLIC_LEGACY: 'false' }, async () => {
      assert.equal((await submit(form.slug, { nome: 'Sem Versao', email: email('termo3'), aceite: true }).expect(409)).body.code, 'CONSENT_OUTDATED');
    });
    await submit(form.slug, { nome: 'Termo Atual', email: email('termo4'), aceite: true }, { consentVersion: v3 }).expect(201);
    assert.equal(await prisma.registrationConsentVersion.count({ where: { formId: form.id } }), 3);
    const last = await prisma.registrationConsentVersion.findFirstOrThrow({ where: { formId: form.id, version: v3 } });
    assert.ok(last.text.includes('[aceite] Aceito as regras.') && last.text.includes('6 meses'));
  });
});
