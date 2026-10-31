import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import request from 'supertest';
import { UploadsGcCronService } from '../src/jobs/uploads-gc-cron.service';
import { CERTIFICATE_PRESETS, CLASSIC_LAYOUT } from '../src/interface/http/certificates/certificate-presets';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { DEV_PASSWORD, SecondOrg, createSecondOrg, loginAs } from './utils/list-helpers';
import { pdfMediaBox, pdfText } from './utils/pdf-text';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Modelos de certificado (docs/CONTRATO_CERTIFICADOS_MODELOS.md): CRUD + presets + padrão por uso + limite de 30 +
 * pré-visualização (PDF, throttle) + permissões pela matriz `certificates` + isolamento entre grupos + emissão com
 * snapshot (editar/excluir o modelo NÃO muda o certificado emitido) + certificado antigo sem snapshot + imagens referenciadas
 * pelo desenho/snapshot não são coletadas pelo UPLOADS_GC. Grupo PRÓPRIO (createReportOrg) + segundo grupo; diretório de
 * uploads temporário; fixtures "@e2e-certtpl.local"; tudo limpo no after().
 */
const DOMAIN = '@e2e-certtpl.local';
const DAY = 86_400_000;

function binary(res: unknown, cb: (err: Error | null, body: unknown) => void): void {
  const stream = res as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (c: Buffer) => chunks.push(c));
  stream.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('Modelos de certificado (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let dir = '';
  let org: ReportOrg;
  let orgB: SecondOrg;
  type U = { userId: number; token: string };
  let mestre: U;
  let professor: U;
  let aluno: U;
  let instrutor: U;
  let monitor: U;
  let responsavel: U;
  let studentId: number;
  let graduationId: number;
  const envBackup = { UPLOADS_DIR: process.env.UPLOADS_DIR, UPLOADS_GC: process.env.UPLOADS_GC };

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, p: string) => http().get(`/api${p}`).set(auth(t));
  const post = (t: string, p: string, body: object = {}) => http().post(`/api${p}`).set(auth(t)).send(body);
  const patch = (t: string, p: string, body: object) => http().patch(`/api${p}`).set(auth(t)).send(body);
  const del = (t: string, p: string) => http().delete(`/api${p}`).set(auth(t));
  const pdf = (t: string | null, p: string, body?: object) => {
    const req = body ? http().post(`/api${p}`).send(body) : http().get(`/api${p}`);
    if (t) req.set(auth(t));
    return req.buffer(true).parse(binary);
  };

  /** Texto (com {codigo}) + QR; `extra` no fim. Helvetica para o texto do PDF ser legível no teste. */
  const design = (mark: string, extra: object[] = [], bgRef: string | null = null) => ({
    version: 1,
    page: { orientation: 'landscape', background: { color: '#fafafa', imageRef: bgRef, imageFit: 'cover' } },
    elements: [
      { id: 'marca', type: 'text', x: 5, y: 5, w: 90, h: 20, text: `${mark} {aluno} {titulo} {codigo}`, fontKey: 'helvetica', size: 14, color: '#111111', align: 'left', vAlign: 'top', bold: false, italic: false, uppercase: false, letterSpacing: 0, lineHeight: 1.2 },
      { id: 'qr', type: 'qr', x: 80, y: 70, size: 90, fg: '#000000' },
      ...extra,
    ],
  });
  const logoEl = { id: 'logo', type: 'image', x: 5, y: 40, w: 15, h: 20, ref: null, useGroupLogo: true, fit: 'contain', opacity: 1 };

  async function makeUser(kind: string, role: OrgRole): Promise<U> {
    const email = `${kind}-${stamp}${DOMAIN}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `[e2e-certtpl] ${kind}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    await prisma.organizationUser.create({ data: { organizationId: org.organizationId, userId: user.id, role, status: 'ACTIVE' } });
    return { userId: user.id, token: (await loginAs(app, email)).token };
  }

  /** Imagem de upload REAL (WebP) no diretório temporário + linha Upload do grupo, "antiga" (candidata ao GC). */
  async function upload(organizationId: number, userId: number, ageDays = 5): Promise<string> {
    const filename = `${randomUUID()}.webp`;
    const full = path.join(dir, filename);
    const data = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#336699' } }).webp().toBuffer();
    await fs.writeFile(full, data);
    const t = new Date(Date.now() - ageDays * DAY);
    await fs.utimes(full, t, t);
    await prisma.upload.create({ data: { organizationId, userId, filename, mimeType: 'image/webp', sizeBytes: data.length, createdAt: t } });
    return filename;
  }

  async function createTemplate(t: string, body: object): Promise<{ id: number; [k: string]: unknown }> {
    const res = await post(t, '/certificate-templates', body).expect(201);
    return res.body;
  }

  const snapshotOf = async (id: number) => (await prisma.certificate.findUniqueOrThrow({ where: { id } })).layoutSnapshot;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-certtpl-'));
    process.env.UPLOADS_DIR = dir;
    app = await createTestApp();
    org = await createReportOrg(app, prisma, 'certtpl');
    orgB = await createSecondOrg(app, prisma, 'certtpl');
    mestre = org.mestre;
    professor = org.professor;
    aluno = org.aluno;
    instrutor = await makeUser('instrutor', OrgRole.INSTRUTOR);
    monitor = await makeUser('monitor', OrgRole.MONITOR);
    responsavel = await makeUser('responsavel', OrgRole.RESPONSAVEL);
    studentId = (await prisma.student.create({ data: { organizationId: org.organizationId, name: '[e2e-certtpl] Aluna Teste' } })).id;
    const system = await prisma.graduationSystem.create({ data: { organizationId: org.organizationId, name: 'Sistema e2e' } });
    const level = await prisma.graduationLevel.create({ data: { organizationId: org.organizationId, graduationSystemId: system.id, name: 'Corda e2e', order: 1 } });
    graduationId = (
      await prisma.studentGraduation.create({ data: { organizationId: org.organizationId, studentId, graduationLevelId: level.id, graduatedAt: new Date() } })
    ).id;
  });

  after(async () => {
    await app.close(); // espera o ranking fire-and-forget antes de apagar os alunos
    await prisma.certificate.deleteMany({ where: { organizationId: { in: [org.organizationId, orgB.organizationId] } } });
    await prisma.certificateTemplate.deleteMany({ where: { organizationId: { in: [org.organizationId, orgB.organizationId] } } });
    await prisma.upload.deleteMany({ where: { organizationId: { in: [org.organizationId, orgB.organizationId] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: orgB.organizationId }, { userId: orgB.userId }] } });
    await orgB.cleanup();
    await org.cleanup();
    const ids = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await fs.rm(dir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete process.env.CERT_PREVIEW_THROTTLE_LIMIT;
    await prisma.$disconnect();
  });

  it('presets: 5 modelos prontos com chave, nome, uso e layout; INSTRUTOR lê; MONITOR/ALUNO/RESPONSAVEL 403; sem token 401', async () => {
    const res = await get(mestre.token, '/certificate-templates/presets').expect(200);
    assert.deepEqual(res.body.map((p: { key: string }) => p.key), ['classico', 'moderno', 'batizado', 'evento', 'minimalista']);
    assert.deepEqual(Object.keys(res.body[0]).sort(), ['key', 'layout', 'name', 'purpose']);
    assert.deepEqual(res.body[0].layout, JSON.parse(JSON.stringify(CLASSIC_LAYOUT)));
    await get(instrutor.token, '/certificate-templates/presets').expect(200);
    for (const u of [monitor, aluno, responsavel]) await get(u.token, '/certificate-templates/presets').expect(403);
    await http().get('/api/certificate-templates/presets').expect(401);
  });

  it('CRUD do MESTRE: criar de preset (201), listar (resumo sem layout), ler, editar, duplicar (" (cópia)"), excluir (204) — 2ª via: Prisma', async () => {
    const created = await createTemplate(mestre.token, { name: '  Meu moderno  ', presetKey: 'moderno' });
    assert.deepEqual(Object.keys(created).sort(), ['createdAt', 'id', 'isDefault', 'layout', 'name', 'purpose', 'updatedAt']);
    assert.equal(created.name, 'Meu moderno');
    assert.equal(created.purpose, 'PARTICIPACAO', 'uso sugerido do preset');
    assert.equal(created.isDefault, false);
    assert.deepEqual(created.layout, JSON.parse(JSON.stringify(CERTIFICATE_PRESETS[1].layout)));
    const row = await prisma.certificateTemplate.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(row.organizationId, org.organizationId);
    assert.equal(row.createdByUserId, mestre.userId);

    const list = await get(mestre.token, '/certificate-templates').expect(200);
    const item = list.body.find((t: { id: number }) => t.id === created.id);
    assert.deepEqual(Object.keys(item).sort(), ['id', 'isDefault', 'name', 'orientation', 'purpose', 'updatedAt']);
    assert.equal(item.orientation, 'landscape');

    assert.deepEqual((await get(mestre.token, `/certificate-templates/${created.id}`).expect(200)).body, created);

    const edited = await patch(mestre.token, `/certificate-templates/${created.id}`, { name: 'Renomeado', layout: design('EDITADO') }).expect(200);
    assert.equal(edited.body.name, 'Renomeado');
    assert.equal(edited.body.layout.page.background.color, '#FAFAFA', 'cor normalizada');
    const dbEdited = await prisma.certificateTemplate.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(dbEdited.name, 'Renomeado');
    assert.ok(JSON.stringify(dbEdited.layout).includes('EDITADO'));

    const copy = await post(mestre.token, `/certificate-templates/${created.id}/duplicate`).expect(201);
    assert.equal(copy.body.name, 'Renomeado (cópia)');
    assert.equal(copy.body.isDefault, false);
    assert.deepEqual(copy.body.layout, edited.body.layout);

    const long = await createTemplate(mestre.token, { name: 'x'.repeat(60), presetKey: 'classico', purpose: 'OUTRO' });
    const longCopy = await post(mestre.token, `/certificate-templates/${long.id}/duplicate`).expect(201);
    assert.equal(longCopy.body.name.length, 60, 'nome da cópia respeita 60');
    assert.ok(longCopy.body.name.endsWith(' (cópia)'));

    for (const id of [created.id, copy.body.id, long.id, longCopy.body.id]) {
      const res = await del(mestre.token, `/certificate-templates/${id}`).expect(204);
      assert.equal(res.text, '');
    }
    assert.equal(await prisma.certificateTemplate.count({ where: { id: { in: [created.id, copy.body.id] } } }), 0);
    await get(mestre.token, `/certificate-templates/${created.id}`).expect(404);

    const audit = await prisma.auditLog.findMany({ where: { organizationId: org.organizationId, resource: 'certificate_template', resourceId: String(created.id) } });
    assert.deepEqual([...new Set(audit.map((a) => a.action))].sort(), ['CERTIFICATE_TEMPLATE_CREATE', 'CERTIFICATE_TEMPLATE_DELETE', 'CERTIFICATE_TEMPLATE_UPDATE']);
    assert.ok(audit.every((a) => !JSON.stringify(a.metadata).includes('EDITADO')), 'auditoria sem o conteúdo dos textos');
  });

  it('validação (400): desenho inválido indica o elemento; layout+presetKey, nenhum dos dois, layout sem purpose, campo extra, nome longo, null no PATCH', async () => {
    const bad = design('X');
    (bad.elements[0] as Record<string, unknown>).text = 'sem codigo {nome}';
    const res = await post(mestre.token, '/certificate-templates', { name: 'Ruim', purpose: 'OUTRO', layout: bad }).expect(400);
    assert.equal(res.body.code, 'LAYOUT_INVALID');
    assert.match(res.body.message, /Elemento "marca" \(texto\): variável desconhecida \{nome\}/);

    const extra = design('X');
    (extra.elements[1] as Record<string, unknown>).onclick = 'x';
    assert.match((await post(mestre.token, '/certificate-templates', { name: 'Ruim', purpose: 'OUTRO', layout: extra }).expect(400)).body.message, /campo desconhecido "onclick"/);

    await post(mestre.token, '/certificate-templates', { name: 'Ambos', purpose: 'OUTRO', layout: design('X'), presetKey: 'classico' }).expect(400);
    await post(mestre.token, '/certificate-templates', { name: 'Nenhum', purpose: 'OUTRO' }).expect(400);
    await post(mestre.token, '/certificate-templates', { name: 'Sem uso', layout: design('X') }).expect(400);
    await post(mestre.token, '/certificate-templates', { name: 'Preset?', presetKey: 'nao-existe' }).expect(400);
    await post(mestre.token, '/certificate-templates', { name: 'Uso?', purpose: 'FESTA', presetKey: 'classico' }).expect(400);
    await post(mestre.token, '/certificate-templates', { name: 'Extra', presetKey: 'classico', isDefault: true }).expect(400);
    await post(mestre.token, '/certificate-templates', { name: 'y'.repeat(61), presetKey: 'classico' }).expect(400);
    await post(mestre.token, '/certificate-templates', { name: '   ', presetKey: 'classico' }).expect(400);
    await post(mestre.token, '/certificate-templates', { name: 'Lista', purpose: 'OUTRO', layout: [] }).expect(400);

    const t = await createTemplate(mestre.token, { name: 'Para PATCH', presetKey: 'classico' });
    for (const body of [{ name: null }, { purpose: null }, { layout: null }, { name: '' }, { foo: 1 }]) {
      await patch(mestre.token, `/certificate-templates/${t.id}`, body).expect(400);
    }
    assert.equal((await prisma.certificateTemplate.findUniqueOrThrow({ where: { id: t.id } })).name, 'Para PATCH');
    await del(mestre.token, `/certificate-templates/${t.id}`).expect(204);
    assert.equal(await prisma.certificateTemplate.count({ where: { organizationId: org.organizationId, name: { in: ['Ruim', 'Ambos', 'Nenhum', 'Extra'] } } }), 0);
  });

  it('imagens: só upload do PRÓPRIO grupo (de outro grupo, inexistente ou URL externa = 400)', async () => {
    const mine = await upload(org.organizationId, mestre.userId);
    const theirs = await upload(orgB.organizationId, orgB.userId);
    const img = (ref: string) => ({ id: 'img', type: 'image', x: 30, y: 30, w: 20, h: 20, ref, useGroupLogo: false, fit: 'cover', opacity: 0.8 });
    const ok = await createTemplate(mestre.token, { name: 'Com imagem', purpose: 'EVENTO', layout: design('IMG', [img(`/api/uploads/${mine}`)], `/api/uploads/${mine}`) });
    for (const ref of [`/api/uploads/${theirs}`, `/api/uploads/${randomUUID()}.webp`]) {
      const res = await post(mestre.token, '/certificate-templates', { name: 'Imagem alheia', purpose: 'EVENTO', layout: design('IMG', [img(ref)]) }).expect(400);
      assert.match(res.body.message, /não foi enviada por este grupo/);
    }
    await post(mestre.token, '/certificate-templates', { name: 'URL', purpose: 'EVENTO', layout: design('IMG', [img('https://exemplo.com/a.webp')]) }).expect(400);
    // a pré-visualização aplica a mesma regra
    await pdf(orgB.token, '/certificate-templates/preview', { layout: design('IMG', [img(`/api/uploads/${mine}`)]) }).expect(400);
    await del(mestre.token, `/certificate-templates/${ok.id}`).expect(204);
  });

  it('permissões (matriz certificates): PROFESSOR cria/edita/duplica/define padrão/exclui; INSTRUTOR só lê/pré-visualiza; MONITOR/ALUNO/RESPONSAVEL 403 em tudo', async () => {
    const t = await createTemplate(professor.token, { name: 'Do professor', presetKey: 'evento' });
    await patch(professor.token, `/certificate-templates/${t.id}`, { name: 'Do professor 2' }).expect(200);
    const copy = await post(professor.token, `/certificate-templates/${t.id}/duplicate`).expect(201);
    await post(professor.token, `/certificate-templates/${t.id}/default`).expect(200);
    await del(professor.token, `/certificate-templates/${copy.body.id}`).expect(204);

    await get(instrutor.token, '/certificate-templates').expect(200);
    await get(instrutor.token, `/certificate-templates/${t.id}`).expect(200);
    const preview = await pdf(instrutor.token, '/certificate-templates/preview', { layout: design('INSTR') }).expect(200);
    assert.equal((preview.body as Buffer).subarray(0, 5).toString('latin1'), '%PDF-');
    await post(instrutor.token, '/certificate-templates', { name: 'Não pode', presetKey: 'classico' }).expect(403);
    await patch(instrutor.token, `/certificate-templates/${t.id}`, { name: 'Não pode' }).expect(403);
    await post(instrutor.token, `/certificate-templates/${t.id}/duplicate`).expect(403);
    await post(instrutor.token, `/certificate-templates/${t.id}/default`).expect(403);
    await del(instrutor.token, `/certificate-templates/${t.id}`).expect(403);

    for (const u of [monitor, aluno, responsavel]) {
      await get(u.token, '/certificate-templates').expect(403);
      await get(u.token, `/certificate-templates/${t.id}`).expect(403);
      await pdf(u.token, '/certificate-templates/preview', { layout: design('X') }).expect(403);
      await post(u.token, '/certificate-templates', { name: 'Não pode', presetKey: 'classico' }).expect(403);
      await patch(u.token, `/certificate-templates/${t.id}`, { name: 'Não pode' }).expect(403);
      await del(u.token, `/certificate-templates/${t.id}`).expect(403);
    }
    assert.equal((await prisma.certificateTemplate.findUniqueOrThrow({ where: { id: t.id } })).name, 'Do professor 2');
    await del(professor.token, `/certificate-templates/${t.id}`).expect(204);
  });

  it('isolamento: modelo de outro grupo = 404 em ler/editar/duplicar/padrão/excluir e não aparece na lista', async () => {
    const t = await createTemplate(mestre.token, { name: 'Só do grupo A', presetKey: 'minimalista' });
    await get(orgB.token, `/certificate-templates/${t.id}`).expect(404);
    await patch(orgB.token, `/certificate-templates/${t.id}`, { name: 'invadido' }).expect(404);
    await post(orgB.token, `/certificate-templates/${t.id}/duplicate`).expect(404);
    await post(orgB.token, `/certificate-templates/${t.id}/default`).expect(404);
    await del(orgB.token, `/certificate-templates/${t.id}`).expect(404);
    await get(mestre.token, '/certificate-templates/999999999').expect(404);
    const listB = await get(orgB.token, '/certificate-templates').expect(200);
    assert.equal(listB.body.some((x: { id: number }) => x.id === t.id), false);
    const row = await prisma.certificateTemplate.findUniqueOrThrow({ where: { id: t.id } });
    assert.equal(row.name, 'Só do grupo A');
    assert.equal(row.isDefault, false);
    await del(mestre.token, `/certificate-templates/${t.id}`).expect(204);
  });

  it('padrão por uso: definir troca o anterior numa transação (1 padrão por grupo+uso); trocar o uso tira o padrão', async () => {
    const a = await createTemplate(mestre.token, { name: 'Grad A', presetKey: 'classico', purpose: 'GRADUACAO' });
    const b = await createTemplate(mestre.token, { name: 'Grad B', presetKey: 'moderno', purpose: 'GRADUACAO' });
    const c = await createTemplate(mestre.token, { name: 'Batizado C', presetKey: 'batizado' });
    assert.equal((await post(mestre.token, `/certificate-templates/${a.id}/default`).expect(200)).body.isDefault, true);
    await post(mestre.token, `/certificate-templates/${c.id}/default`).expect(200);
    await post(mestre.token, `/certificate-templates/${b.id}/default`).expect(200);
    const defaults = await prisma.certificateTemplate.findMany({ where: { organizationId: org.organizationId, isDefault: true }, orderBy: { id: 'asc' } });
    assert.deepEqual(defaults.map((t) => t.id), [b.id, c.id], 'B substituiu A; o padrão de BATIZADO segue');
    await post(mestre.token, `/certificate-templates/${b.id}/default`).expect(200); // idempotente

    // o índice único parcial barra 2 padrões do mesmo uso mesmo por fora da API
    await assert.rejects(prisma.certificateTemplate.update({ where: { id: a.id }, data: { isDefault: true } }));

    const moved = await patch(mestre.token, `/certificate-templates/${b.id}`, { purpose: 'EVENTO' }).expect(200);
    assert.equal(moved.body.purpose, 'EVENTO');
    assert.equal(moved.body.isDefault, false);
    for (const id of [a.id, b.id, c.id]) await del(mestre.token, `/certificate-templates/${id}`).expect(204);
  });

  it('limite de 30 modelos por grupo: 409 TEMPLATE_LIMIT ao criar e ao duplicar; excluir um libera', async () => {
    const existing = await prisma.certificateTemplate.count({ where: { organizationId: org.organizationId } });
    await prisma.certificateTemplate.createMany({
      data: Array.from({ length: 30 - existing }, (_, i) => ({
        organizationId: org.organizationId,
        name: `[lote] ${i}`,
        purpose: 'OUTRO' as const,
        layout: JSON.parse(JSON.stringify(CLASSIC_LAYOUT)),
      })),
    });
    const res = await post(mestre.token, '/certificate-templates', { name: 'O 31º', presetKey: 'classico' }).expect(409);
    assert.equal(res.body.code, 'TEMPLATE_LIMIT');
    const one = await prisma.certificateTemplate.findFirstOrThrow({ where: { organizationId: org.organizationId, name: { startsWith: '[lote]' } } });
    assert.equal((await post(mestre.token, `/certificate-templates/${one.id}/duplicate`).expect(409)).body.code, 'TEMPLATE_LIMIT');
    assert.equal(await prisma.certificateTemplate.count({ where: { organizationId: org.organizationId } }), 30);
    await del(mestre.token, `/certificate-templates/${one.id}`).expect(204);
    const last = await createTemplate(mestre.token, { name: 'Cabe de novo', presetKey: 'classico' });
    await prisma.certificateTemplate.deleteMany({ where: { organizationId: org.organizationId, OR: [{ name: { startsWith: '[lote]' } }, { id: last.id }] } });
  });

  it('pré-visualização: PDF com dados de EXEMPLO (aluno, código EXEMPLO-0000) e o nome real do grupo; retrato pelo MediaBox; desenho inválido 400', async () => {
    const res = await pdf(mestre.token, '/certificate-templates/preview', { layout: design('PREVIA {grupo}') }).expect(200);
    assert.match(res.headers['content-type'], /application\/pdf/);
    const body = res.body as Buffer;
    assert.equal(body.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(body.subarray(-16).toString('latin1').includes('%%EOF'));
    const text = pdfText(body);
    assert.ok(text.includes('PREVIA'), text.slice(0, 200));
    assert.ok(text.includes('Maria da Silva Santos'));
    assert.ok(text.includes('EXEMPLO-0000'));
    const orgName = (await prisma.organization.findUniqueOrThrow({ where: { id: org.organizationId } })).name;
    assert.ok(text.includes(orgName), 'nome real do grupo');

    const portrait = await pdf(mestre.token, '/certificate-templates/preview', { layout: CERTIFICATE_PRESETS[4].layout }).expect(200);
    const [w, h] = pdfMediaBox(portrait.body as Buffer)!;
    assert.ok(h > w, 'minimalista é retrato');

    const bad = design('X');
    bad.elements.splice(1, 1); // sem QR
    const err = await post(mestre.token, '/certificate-templates/preview', { layout: bad }).expect(400);
    assert.match(err.body.message, /exatamente 1 QR Code/);
    await post(mestre.token, '/certificate-templates/preview', { layout: design('X'), extra: 1 }).expect(400);
  });

  it('pré-visualização tem limite POR USUÁRIO (429 acima do teto; outro usuário segue)', async () => {
    process.env.CERT_PREVIEW_THROTTLE_LIMIT = '2';
    try {
      const fresh = await makeUser('throttle', OrgRole.PROFESSOR);
      await pdf(fresh.token, '/certificate-templates/preview', { layout: design('T1') }).expect(200);
      await pdf(fresh.token, '/certificate-templates/preview', { layout: design('T2') }).expect(200);
      await pdf(fresh.token, '/certificate-templates/preview', { layout: design('T3') }).expect(429);
      const other = await makeUser('throttle2', OrgRole.PROFESSOR);
      await pdf(other.token, '/certificate-templates/preview', { layout: design('T4') }).expect(200);
    } finally {
      delete process.env.CERT_PREVIEW_THROTTLE_LIMIT;
    }
  });

  describe('emissão com snapshot', () => {
    let tpl: { id: number };
    let logoFile: string;
    let bgFile: string;
    let certId: number;
    let certCode: string;
    let snapshotBefore: unknown;

    it('sem padrão do uso: emite no CLÁSSICO (templateId null, snapshot = clássico); resposta traz templateId e nunca o snapshot', async () => {
      const res = await post(mestre.token, '/certificates', { studentId, title: '[e2e-certtpl] Sem modelo' }).expect(201);
      assert.equal(res.body.templateId, null);
      assert.equal('layoutSnapshot' in res.body, false);
      assert.deepEqual(await snapshotOf(res.body.id), JSON.parse(JSON.stringify(CLASSIC_LAYOUT)));
      const one = await get(mestre.token, `/certificates/${res.body.id}`).expect(200);
      assert.equal(one.body.templateId, null);
      assert.equal('layoutSnapshot' in one.body, false);
      const list = await get(mestre.token, `/certificates?studentId=${studentId}`).expect(200);
      assert.ok(list.body.every((c: Record<string, unknown>) => 'templateId' in c && !('layoutSnapshot' in c)));
    });

    it('templateId informado: grava templateId + snapshot com o LOGO resolvido; o PDF usa o snapshot', async () => {
      logoFile = await upload(org.organizationId, mestre.userId);
      bgFile = await upload(org.organizationId, mestre.userId);
      await prisma.organization.update({ where: { id: org.organizationId }, data: { logo: `https://api.e2e.test/api/uploads/${logoFile}` } });
      tpl = await createTemplate(mestre.token, { name: 'Emissão', purpose: 'OUTRO', layout: design('MARCA-ORIGINAL', [logoEl], `/api/uploads/${bgFile}`) });

      const res = await post(mestre.token, '/certificates', { studentId, title: '[e2e-certtpl] Com modelo', templateId: tpl.id }).expect(201);
      certId = res.body.id;
      certCode = res.body.verificationCode;
      assert.equal(res.body.templateId, tpl.id);
      const row = await prisma.certificate.findUniqueOrThrow({ where: { id: certId } });
      assert.equal(row.templateId, tpl.id);
      snapshotBefore = row.layoutSnapshot;
      const snap = row.layoutSnapshot as { elements: Array<Record<string, unknown>>; page: { background: { imageRef: string } } };
      const logo = snap.elements.find((e) => e.id === 'logo')!;
      assert.equal(logo.useGroupLogo, false);
      assert.equal(logo.ref, `/api/uploads/${logoFile}`, 'logo trocado pela referência concreta');
      assert.equal(snap.page.background.imageRef, `/api/uploads/${bgFile}`);

      const file = await pdf(mestre.token, `/certificates/${certId}/pdf`).expect(200);
      const body = file.body as Buffer;
      assert.ok(pdfText(body).includes('MARCA-ORIGINAL'));
      assert.ok((body.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length >= 2, 'fundo + logo embutidos');
    });

    it('editar o modelo depois NÃO muda o snapshot nem o PDF do certificado emitido; PATCH do certificado também não', async () => {
      await patch(mestre.token, `/certificate-templates/${tpl.id}`, { layout: design('MARCA-NOVA') }).expect(200);
      await patch(mestre.token, `/certificates/${certId}`, { title: '[e2e-certtpl] Com modelo (editado)' }).expect(200);
      assert.deepEqual(await snapshotOf(certId), snapshotBefore);
      const text = pdfText((await pdf(mestre.token, `/certificates/${certId}/pdf`).expect(200)).body as Buffer);
      assert.ok(text.includes('MARCA-ORIGINAL'));
      assert.ok(!text.includes('MARCA-NOVA'));
      assert.ok(text.includes('(editado)'), 'o título (variável) acompanha o certificado');
      // o PDF público (QR) também sai do snapshot
      const pub = pdfText((await pdf(null, `/public/certificates/${certCode}/pdf`).expect(200)).body as Buffer);
      assert.ok(pub.includes('MARCA-ORIGINAL') && !pub.includes('MARCA-NOVA'));
      // emissão nova pega o desenho NOVO
      const fresh = await post(mestre.token, '/certificates', { studentId, title: '[e2e-certtpl] Depois da edição', templateId: tpl.id }).expect(201);
      assert.ok(JSON.stringify(await snapshotOf(fresh.body.id)).includes('MARCA-NOVA'));
    });

    it('padrão do uso: sem templateId usa o padrão de OUTRO (sem graduação) ou de GRADUACAO (com graduação); sem logo o elemento sai', async () => {
      await post(mestre.token, `/certificate-templates/${tpl.id}/default`).expect(200);
      await patch(mestre.token, `/certificate-templates/${tpl.id}`, { layout: design('MARCA-NOVA', [logoEl]) }).expect(200);
      await prisma.organization.update({ where: { id: org.organizationId }, data: { logo: null } });

      const outro = await post(mestre.token, '/certificates', { studentId, title: '[e2e-certtpl] Padrão OUTRO' }).expect(201);
      assert.equal(outro.body.templateId, tpl.id);
      const snap = (await snapshotOf(outro.body.id)) as { elements: Array<{ id: string }> };
      assert.equal(snap.elements.some((e) => e.id === 'logo'), false, 'grupo sem logo: o elemento sai do snapshot');

      const grad = await post(mestre.token, '/certificates', { studentId, title: '[e2e-certtpl] Graduação', studentGraduationId: graduationId }).expect(201);
      assert.equal(grad.body.templateId, null, 'sem padrão de GRADUACAO = clássico');
      const gradTpl = await createTemplate(mestre.token, { name: 'Grad padrão', purpose: 'GRADUACAO', layout: design('MARCA-GRAD') });
      await post(mestre.token, `/certificate-templates/${gradTpl.id}/default`).expect(200);
      const grad2 = await post(mestre.token, '/certificates', { studentId, title: '[e2e-certtpl] Graduação 2', studentGraduationId: graduationId }).expect(201);
      assert.equal(grad2.body.templateId, gradTpl.id);
      await del(mestre.token, `/certificate-templates/${gradTpl.id}`).expect(204);
    });

    it('templateId de outro grupo ou inexistente = 400 e nada é emitido', async () => {
      const foreign = await createTemplate(orgB.token, { name: 'Do grupo B', presetKey: 'classico' });
      const before = await prisma.certificate.count({ where: { organizationId: org.organizationId } });
      await post(mestre.token, '/certificates', { studentId, title: '[e2e-certtpl] x', templateId: foreign.id }).expect(400);
      await post(mestre.token, '/certificates', { studentId, title: '[e2e-certtpl] x', templateId: 999999999 }).expect(400);
      await post(mestre.token, '/certificates', { studentId, title: '[e2e-certtpl] x', templateId: 'abc' }).expect(400);
      assert.equal(await prisma.certificate.count({ where: { organizationId: org.organizationId } }), before);
    });

    it('excluir o modelo: certificado fica com templateId null e segue pelo snapshot', async () => {
      await del(mestre.token, `/certificate-templates/${tpl.id}`).expect(204);
      const row = await prisma.certificate.findUniqueOrThrow({ where: { id: certId } });
      assert.equal(row.templateId, null);
      assert.deepEqual(row.layoutSnapshot, snapshotBefore);
      assert.ok(pdfText((await pdf(mestre.token, `/certificates/${certId}/pdf`).expect(200)).body as Buffer).includes('MARCA-ORIGINAL'));
    });

    it('certificado ANTIGO (sem snapshot) gera PDF no clássico', async () => {
      const old = await prisma.certificate.create({
        data: { organizationId: org.organizationId, studentId, title: '[e2e-certtpl] Antigo', issuedAt: new Date('2025-01-02T00:00:00Z') },
      });
      assert.equal(old.layoutSnapshot, null);
      const res = await pdf(mestre.token, `/certificates/${old.id}/pdf`).expect(200);
      const text = pdfText(res.body as Buffer);
      assert.ok(text.includes('CERTIFICADO') && text.includes('Emitido em 02/01/2025') && text.includes('[e2e-certtpl] Antigo'));
      assert.deepEqual(pdfMediaBox(res.body as Buffer), [841.89, 595.28]);
    });

    it('UPLOADS_GC: imagens citadas SÓ no desenho de um modelo ou SÓ no snapshot de um certificado NÃO são coletadas; órfã é', async () => {
      const onlyTemplate = await upload(org.organizationId, mestre.userId);
      const keeper = await createTemplate(mestre.token, { name: 'Guarda o fundo', purpose: 'EVENTO', layout: design('GC', [], `/api/uploads/${onlyTemplate}`) });
      const orphan = await upload(org.organizationId, mestre.userId);
      // logoFile agora só aparece no snapshot do certificado (logo do grupo limpo e modelo excluído); bgFile idem.
      assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: org.organizationId } })).logo, null);

      process.env.UPLOADS_GC = 'true';
      const service = new UploadsGcCronService(app.get(PrismaService));
      const result = await service.run({ dir, organizationId: org.organizationId });
      process.env.UPLOADS_GC = envBackup.UPLOADS_GC ?? 'false';
      assert.ok(result, 'o GC rodou');
      const exists = (f: string) => fs.stat(path.join(dir, f)).then(() => true, () => false);
      for (const kept of [onlyTemplate, logoFile, bgFile]) {
        assert.ok(await exists(kept), `${kept} referenciada deve ficar`);
        assert.equal(await prisma.upload.count({ where: { filename: kept } }), 1);
      }
      assert.equal(await exists(orphan), false, 'a órfã é coletada (o GC estava ativo)');
      assert.equal(await prisma.upload.count({ where: { filename: orphan } }), 0);
      await del(mestre.token, `/certificate-templates/${keeper.id}`).expect(204);
    });
  });
});
