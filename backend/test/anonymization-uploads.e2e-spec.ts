import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import request from 'supertest';
import { AnonymizationService } from '../src/interface/http/data-deletion-requests/anonymization.service';
import { TournamentsService } from '../src/interface/http/tournaments/tournaments.service';
import { UploadsGcCronService } from '../src/jobs/uploads-gc-cron.service';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { UploadReaper } from '../src/shared/uploads/upload-reaper.service';
import { UploadReferenceScanner } from '../src/shared/uploads/upload-reference-scanner';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * LGPD - anonimizacao apaga o ARQUIVO da foto do disco (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md secao 3): so o que nenhuma outra
 * coluna (inclusive Json) referencia mais, depois do commit, sem falhar por arquivo ausente/disco e sem path traversal.
 * Grupo e UPLOADS_DIR PROPRIOS; nao toca o seed.
 */
describe('LGPD - anonimização apaga as fotos do disco (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let org: ReportOrg;
  let uploadsDir = '';
  const stamp = Date.now();
  const trackedUserIds: number[] = [];
  const http = () => request(app.getHttpServer());
  let seq = 0;

  const webp = () => sharp({ create: { width: 32, height: 32, channels: 3, background: '#4a8' } }).webp().toBuffer();
  /** Arquivo + linha Upload (como o POST /uploads deixa). */
  const newUpload = async (): Promise<{ filename: string; url: string; full: string }> => {
    const filename = `${randomUUID()}.webp`;
    const full = path.join(uploadsDir, filename);
    const data = await webp();
    await fs.writeFile(full, data);
    await prisma.upload.create({ data: { organizationId: org.organizationId, userId: org.mestre.userId, filename, mimeType: 'image/webp', sizeBytes: data.length } });
    return { filename, url: `/api/uploads/${filename}`, full };
  };
  const exists = (full: string) => fs.access(full).then(() => true, () => false);
  const uploadRow = (filename: string) => prisma.upload.findUnique({ where: { filename } });

  /** Titular: usuario + matricula (+ perfil publico) com a(s) foto(s) dadas e um pedido de exclusao aberto. */
  const subject = async (tag: string, photos: { user?: string; student?: string; cover?: string; profile?: string; socialLinks?: object }) => {
    const user = await prisma.user.create({
      data: { email: `${tag}-${stamp}-${++seq}@e2e-anonup.local`, passwordHash: 'x', name: `[e2e-anonup] ${tag}`, userType: 'MEMBER', photo: photos.user ?? null },
    });
    trackedUserIds.push(user.id);
    await prisma.organizationUser.create({ data: { organizationId: org.organizationId, userId: user.id, role: 'ALUNO', status: 'ACTIVE' } });
    const student = await prisma.student.create({
      data: {
        organizationId: org.organizationId,
        userId: user.id,
        name: `[e2e-anonup] ${tag}`,
        photo: photos.student ?? null,
        coverPhoto: photos.cover ?? null,
        ...(photos.socialLinks ? { socialLinks: photos.socialLinks } : {}),
      },
    });
    if (photos.profile) {
      await prisma.publicProfile.create({ data: { organizationId: org.organizationId, studentId: student.id, displayName: `Perfil ${tag}`, photo: photos.profile } });
    }
    const req = await prisma.dataDeletionRequest.create({ data: { userId: user.id, organizationId: org.organizationId } });
    return { user, student, req };
  };
  /** Roda o GC semanal (UPLOADS_GC liga so durante a chamada; o env-setup o desliga) "daqui a 3 dias" no grupo do teste. */
  const runGc = async () => {
    const old = process.env.UPLOADS_GC;
    process.env.UPLOADS_GC = 'true';
    try {
      return await new UploadsGcCronService(app.get(PrismaService)).run({ dir: uploadsDir, now: new Date(Date.now() + 3 * 86_400_000), organizationId: org.organizationId });
    } finally {
      process.env.UPLOADS_GC = old ?? 'false';
    }
  };
  const anonymize = (requestId: number) => app.get(AnonymizationService, { strict: false }).anonymizeRequest(requestId, org.mestre.userId);

  before(async () => {
    uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-anonup-'));
    process.env.UPLOADS_DIR = uploadsDir;
    app = await createTestApp({ disableThrottle: true });
    org = await createReportOrg(app, prisma, 'anonup');
    trackedUserIds.push(org.mestre.userId, org.professor.userId, org.aluno.userId);
  });

  after(async () => {
    await prisma.dataDeletionRequest.deleteMany({ where: { userId: { in: trackedUserIds } } });
    await prisma.publicProfile.deleteMany({ where: { organizationId: org.organizationId } });
    await prisma.upload.deleteMany({ where: { organizationId: org.organizationId } });
    await org.cleanup();
    await prisma.person.deleteMany({ where: { name: 'Pessoa removida', students: { none: {} } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: trackedUserIds } } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: trackedUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: trackedUserIds } } });
    await fs.rm(uploadsDir, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
    await prisma.$disconnect();
    await app.close();
  });

  it('anonimizar: o arquivo da foto some do disco, a linha Upload some e GET /api/uploads/<arquivo> = 404 (era 200)', async () => {
    const photo = await newUpload();
    const cover = await newUpload();
    const profile = await newUpload();
    const userPhoto = await newUpload();
    const { student, user, req } = await subject('feliz', { user: userPhoto.url, student: photo.url, cover: cover.url, profile: profile.url });
    for (const f of [photo, cover, profile, userPhoto]) await http().get(f.url).expect(200);

    await anonymize(req.id);

    // as colunas foram zeradas (comportamento antigo) ...
    const row = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    assert.equal(row.photo, null);
    assert.equal(row.coverPhoto, null);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).photo, null);
    // ... e agora o ARQUIVO tambem sai
    for (const f of [photo, cover, profile, userPhoto]) {
      assert.equal(await exists(f.full), false, `${f.filename} saiu do disco`);
      assert.equal(await uploadRow(f.filename), null, `${f.filename}: linha Upload removida`);
      await http().get(f.url).expect(404);
    }
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'PERSON_ANONYMIZE', userId: org.mestre.userId }, orderBy: { id: 'desc' } });
    assert.equal((audit.metadata as { uploadsDeleted?: number }).uploadsDeleted, 4);
  });

  it('foto compartilhada: só some quando a ÚLTIMA referência cai (outra coluna String, campo Json e a 2ª anonimização)', async () => {
    const shared = await newUpload(); // A e B
    const viaJson = await newUpload(); // A + Json de C (nao anonimizado)
    const viaString = await newUpload(); // A + Student.photo de C
    const a = await subject('comp-a', { student: shared.url, cover: viaJson.url, profile: viaString.url, user: shared.url });
    const b = await subject('comp-b', { student: shared.url });
    // C: aluno que NAO e anonimizado e guarda referencias em colunas de outras tabelas/tipos
    const c = await subject('comp-c', { student: viaString.url, socialLinks: { foto: viaJson.url, instagram: 'x' } });

    await anonymize(a.req.id);
    assert.equal(await exists(shared.full), true, 'B ainda usa a mesma foto');
    assert.equal(await exists(viaJson.full), true, 'referenciada num campo Json de outro aluno');
    assert.equal(await exists(viaString.full), true, 'referenciada por outra coluna String');
    assert.ok(await uploadRow(shared.filename));
    await http().get(shared.url).expect(200);
    await http().get(viaJson.url).expect(200);

    await anonymize(b.req.id); // ultima referencia de `shared` cai
    assert.equal(await exists(shared.full), false);
    assert.equal(await uploadRow(shared.filename), null);
    await http().get(shared.url).expect(404);
    assert.equal(await exists(viaJson.full), true, 'C continua com ela');
    assert.equal(await exists(viaString.full), true);

    // C e anonimizado: a foto dele (Student.photo) sai; o Json (socialLinks) de C tambem e limpo, mas `viaJson` nao e foto
    // de C (so o texto do Json a citava): fica orfa e e o GC semanal que a recolhe (nao ha varredura geral na anonimizacao).
    await anonymize(c.req.id);
    assert.equal(await exists(viaString.full), false, 'ultima referencia (Student.photo de C) caiu');
    await http().get(viaString.url).expect(404);
    assert.equal(await exists(viaJson.full), true, 'orfa, mas nao era foto de C: fica para o GC');
    assert.equal((await new UploadReferenceScanner(app.get(PrismaService)).referencedAmong([viaJson.filename])).size, 0, 'ninguem mais a referencia');
    await runGc();
    assert.equal(await exists(viaJson.full), false, 'o GC semanal recolheu');
  });

  it('ordem: transação que FALHA não apaga arquivo nem chama o chaveamento (apagar só DEPOIS do commit)', async () => {
    const photo = await newUpload();
    const { student, req } = await subject('rollback', { student: photo.url });
    const prismaService = app.get(PrismaService) as unknown as { $transaction: (...args: unknown[]) => Promise<unknown> };
    const tournaments = app.get(TournamentsService, { strict: false }) as unknown as { anonymizeCompetitors?: (i: unknown) => Promise<void> };
    const calls: unknown[] = [];
    tournaments.anonymizeCompetitors = async (i) => {
      calls.push(i);
    };
    const original = prismaService.$transaction;
    prismaService.$transaction = async () => {
      throw new Error('commit falhou (simulado)');
    };
    try {
      await assert.rejects(anonymize(req.id), /commit falhou/);
    } finally {
      prismaService.$transaction = original;
      delete tournaments.anonymizeCompetitors;
    }
    assert.equal(await exists(photo.full), true, 'arquivo intacto: a anonimizacao nao foi confirmada');
    assert.ok(await uploadRow(photo.filename));
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).photo, photo.url);
    assert.equal(calls.length, 0);
    await http().get(photo.url).expect(200);
    await anonymize(req.id); // e a repeticao funciona normalmente
    assert.equal(await exists(photo.full), false);
  });

  it('referência em URL absoluta (…/api/uploads/<arquivo>) também é reconhecida e apagada', async () => {
    const abs = await newUpload();
    const { req } = await subject('abs', { student: `https://api.gingapp.example/api/uploads/${abs.filename}` });
    await anonymize(req.id);
    assert.equal(await exists(abs.full), false);
    assert.equal(await uploadRow(abs.filename), null);
  });

  it('falha de disco (e arquivo ausente) NÃO derruba a anonimização; o que sobra fica para o GC semanal', async () => {
    const stuck = await newUpload();
    const missing = await newUpload();
    const { student, req } = await subject('disco', { student: stuck.url, cover: missing.url });
    // `unlink` falha com erro diferente de ENOENT: o nome vira um DIRETORIO
    await fs.rm(stuck.full);
    await fs.mkdir(stuck.full);
    await fs.rm(missing.full); // ausente (ENOENT) nao e erro

    const result = await anonymize(req.id);
    assert.equal(result.studentsAnonymized, 1);
    const row = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    assert.ok(row.anonymizedAt, 'anonimizacao concluida');
    assert.equal(row.photo, null);
    assert.equal((await prisma.dataDeletionRequest.findUniqueOrThrow({ where: { id: req.id } })).status, 'DONE');
    assert.equal(await uploadRow(missing.filename), null, 'ausente: so a linha Upload sai');
    assert.ok(await uploadRow(stuck.filename), 'falhou: a linha Upload fica para o GC');

    // o GC semanal recolhe o que sobrou (sem referencia + antigo)
    await fs.rm(stuck.full, { recursive: true, force: true });
    await fs.writeFile(stuck.full, await webp());
    const result2 = await runGc();
    assert.ok((result2?.filesRemoved ?? 0) >= 1, JSON.stringify(result2));
    assert.equal(await exists(stuck.full), false);
  });

  it('ponte com o chaveamento: anonymizeCompetitors({studentIds, eventParticipantIds}) é chamado DEPOIS do commit; falha dele não derruba a anonimização', async () => {
    const tournaments = app.get(TournamentsService, { strict: false }) as unknown as {
      anonymizeCompetitors?: (i: { studentIds: number[]; eventParticipantIds: number[] }) => Promise<void>;
    };
    const calls: Array<{ studentIds: number[]; eventParticipantIds: number[]; studentAnonymizedAtCall: boolean }> = [];
    const a = await subject('ponte', {});
    tournaments.anonymizeCompetitors = async (input) => {
      const s = await prisma.student.findUniqueOrThrow({ where: { id: a.student.id } });
      calls.push({ ...input, studentAnonymizedAtCall: s.anonymizedAt !== null });
    };
    try {
      await anonymize(a.req.id);
    } finally {
      delete tournaments.anonymizeCompetitors;
    }
    assert.deepEqual(calls, [{ studentIds: [a.student.id], eventParticipantIds: [], studentAnonymizedAtCall: true }]);

    const b = await subject('ponte-falha', {});
    tournaments.anonymizeCompetitors = async () => {
      throw new Error('falha simulada do chaveamento');
    };
    try {
      const result = await anonymize(b.req.id);
      assert.equal(result.studentsAnonymized, 1);
    } finally {
      delete tournaments.anonymizeCompetitors;
    }
    assert.ok((await prisma.student.findUniqueOrThrow({ where: { id: b.student.id } })).anonymizedAt);
    // sem o metodo (servico sem anonymizeCompetitors): segue sem erro
    const c = await subject('ponte-ausente', {});
    const proto = Object.getPrototypeOf(tournaments) as { anonymizeCompetitors?: unknown };
    const saved = Object.getOwnPropertyDescriptor(proto, 'anonymizeCompetitors');
    if (saved) delete proto.anonymizeCompetitors;
    try {
      await anonymize(c.req.id);
    } finally {
      if (saved) Object.defineProperty(proto, 'anonymizeCompetitors', saved);
    }
    assert.ok((await prisma.student.findUniqueOrThrow({ where: { id: c.student.id } })).anonymizedAt);
  });

  it('UploadReaper: nome fora do formato/path traversal nunca apaga nada; referenciado fica; falha de consulta não apaga', async () => {
    const reaper = app.get(UploadReaper, { strict: false });
    const outside = path.join(path.dirname(uploadsDir), `${path.basename(uploadsDir)}-fora.webp`);
    await fs.writeFile(outside, 'nao-apague');
    const inside = await newUpload();
    const bad = [
      `/api/uploads/../${path.basename(outside)}`,
      `/api/uploads/..%2F${path.basename(outside)}`,
      '/api/uploads/not-a-uuid.webp',
      `/api/uploads/${randomUUID()}.exe`,
      `/api/uploads/${inside.filename}/../${inside.filename}`,
      'https://evil.example/uploads/x.webp',
      null,
      undefined,
      42,
      { toString: () => inside.url },
    ];
    const result = await reaper.deleteUnreferenced(bad);
    assert.equal(result.considered, 0);
    assert.equal(await exists(outside), true);
    assert.equal(await exists(inside.full), true);

    // referenciado por outra coluna: mantido
    const { student } = await subject('reaper', { student: inside.url });
    const kept = await reaper.deleteUnreferenced([inside.url]);
    assert.deepEqual(kept, { considered: 1, kept: 1, deleted: 0, failed: 0 });
    assert.equal(await exists(inside.full), true);
    // solta a referencia: apaga (e e idempotente)
    await prisma.student.update({ where: { id: student.id }, data: { photo: null } });
    const first = await reaper.deleteUnreferenced([inside.url, inside.url, `https://x.example${inside.url}`]);
    assert.deepEqual(first, { considered: 1, kept: 0, deleted: 1, failed: 0 });
    assert.equal(await exists(inside.full), false);
    const second = await reaper.deleteUnreferenced([inside.url]);
    assert.equal(second.failed, 0, 'ja nao existe: nao e erro');
    await fs.rm(outside, { force: true });

    // falha ao consultar as referencias: NAO apaga nada e nao lanca
    const live = await newUpload();
    const broken = new UploadReaper(app.get(PrismaService), { referencedAmong: async () => { throw new Error('banco fora'); } } as unknown as UploadReferenceScanner);
    const failed = await broken.deleteUnreferenced([live.url]);
    assert.deepEqual(failed, { considered: 1, kept: 0, deleted: 0, failed: 1 });
    assert.equal(await exists(live.full), true);
  });

  it('UploadReferenceScanner: acha referências em colunas String e Json de qualquer tabela; GC usa o mesmo detector', async () => {
    const scanner = app.get(UploadReferenceScanner, { strict: false });
    const inString = await newUpload();
    const inJson = await newUpload();
    const unused = await newUpload();
    await subject('scan', { student: inString.url, socialLinks: { foto: inJson.url } });
    const found = await scanner.referencedAmong([inString.filename, inJson.filename, unused.filename, 'lixo.webp']);
    assert.deepEqual([...found].sort(), [inString.filename, inJson.filename].sort());
    assert.equal((await scanner.referencedAmong([])).size, 0);
    const all = await scanner.referencedFilenames();
    assert.ok(all.has(inString.filename) && all.has(inJson.filename) && !all.has(unused.filename));
    // mesmo conjunto que o GC enxerga (comportamento do GC inalterado)
    const viaGc = await new UploadsGcCronService(app.get(PrismaService)).referencedFilenames();
    assert.ok(viaGc.has(inString.filename) && viaGc.has(inJson.filename) && !viaGc.has(unused.filename));
  });
});
