import { INestApplication } from '@nestjs/common';
import { OrganizationType, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { AuditRetentionCronService } from '../src/jobs/audit-retention-cron.service';
import { UploadsGcCronService } from '../src/jobs/uploads-gc-cron.service';
import { AuditService } from '../src/shared/audit/audit.service';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { createTestApp } from './utils/test-app';

/**
 * Jobs semanais de manutencao (retencao da auditoria e limpeza de imagens orfas). Os servicos sao chamados direto
 * (o agendador nao roda nos testes). Tudo e PROPRIO da suite: linhas de auditoria marcadas, grupo/usuario/aluno
 * proprios e um diretorio temporario - o seed ginga-brasil e o demo nao sao tocados. Limpa tudo no after().
 */
const DAY = 86_400_000;
const MARK = 'E2E_RETENTION_MARK';

describe('Jobs de manutencao (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}`;
  let dir = '';
  let orgId: number;
  let userId: number;
  const env = { ...process.env };

  function setEnv(values: Record<string, string | undefined>): void {
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  before(async () => {
    app = await createTestApp();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-gc-e2e-'));
    orgId = (
      await prisma.organization.create({
        data: { name: `E2E jobs ${stamp}`, slug: `e2e-jobs-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
      })
    ).id;
    userId = (
      await prisma.user.create({
        data: { email: `jobs-${stamp}@e2e-jobs.local`, passwordHash: await bcrypt.hash('x', 4), name: '[e2e-jobs]', userType: 'MEMBER' },
      })
    ).id;
  });

  after(async () => {
    setEnv({
      AUDIT_RETENTION_CRON: env.AUDIT_RETENTION_CRON,
      AUDIT_RETENTION_DAYS: env.AUDIT_RETENTION_DAYS,
      UPLOADS_GC: env.UPLOADS_GC,
    });
    await prisma.auditLog.deleteMany({ where: { resource: MARK } });
    await prisma.student.deleteMany({ where: { organizationId: orgId } });
    await prisma.upload.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await fs.rm(dir, { recursive: true, force: true });
    await prisma.$disconnect();
    await app.close();
  });

  it('retencao da auditoria: apaga so o que passou do prazo, grava AUDIT_PURGE; 0 dias, flag desligado ou nada vencido = nao apaga', async () => {
    const service = new AuditRetentionCronService(app.get(PrismaService), new AuditService(app.get(PrismaService)));
    const real = Date.now();
    const old = await prisma.auditLog.create({ data: { action: 'X', resource: MARK, createdAt: new Date(real - 700 * DAY) } });
    const recent = await prisma.auditLog.create({ data: { action: 'X', resource: MARK, createdAt: new Date(real - 400 * DAY) } });
    // `now` recuado em 300 dias: o corte (365 d) cai em real-665d, entao so as linhas DESTA suite (700 d) sao elegiveis e
    // o historico real do banco de desenvolvimento nunca e apagado pelo teste.
    const fakeNow = new Date(real - 300 * DAY);

    setEnv({ AUDIT_RETENTION_CRON: 'false', AUDIT_RETENTION_DAYS: '365' });
    assert.equal(await service.run(fakeNow), null, 'AUDIT_RETENTION_CRON=false desliga');
    setEnv({ AUDIT_RETENTION_CRON: 'true', AUDIT_RETENTION_DAYS: '0' });
    assert.equal(await service.run(fakeNow), null, '0 = nunca apagar');
    assert.ok(await prisma.auditLog.findUnique({ where: { id: old.id } }));

    setEnv({ AUDIT_RETENTION_CRON: 'true', AUDIT_RETENTION_DAYS: '365' });
    const result = await service.run(fakeNow);
    assert.ok(result && result.deleted >= 1);
    assert.equal(await prisma.auditLog.findUnique({ where: { id: old.id } }), null, 'vencida apagada');
    assert.ok(await prisma.auditLog.findUnique({ where: { id: recent.id } }), 'dentro do prazo permanece');
    const purge = await prisma.auditLog.findFirstOrThrow({ where: { action: 'AUDIT_PURGE' }, orderBy: { id: 'desc' } });
    assert.equal((purge.metadata as { retentionDays: number }).retentionDays, 365);
    await prisma.auditLog.delete({ where: { id: purge.id } }); // a linha de prova desta execucao nao deve ficar no banco de dev
  });

  it('imagens orfas: apaga so as nao referenciadas com mais de 24h (arquivo + linha); referenciadas, recentes e nomes estranhos ficam; dry-run e UPLOADS_GC=false nao apagam', async () => {
    const service = new UploadsGcCronService(app.get(PrismaService));
    const name = () => `${randomUUID()}.webp`;
    const file = async (filename: string, ageDays: number) => {
      const full = path.join(dir, filename);
      await fs.writeFile(full, Buffer.from('img'));
      const t = new Date(Date.now() - ageDays * DAY);
      await fs.utimes(full, t, t);
    };
    const row = (filename: string, ageDays: number) =>
      prisma.upload.create({
        data: { organizationId: orgId, userId, filename, mimeType: 'image/webp', sizeBytes: 3, createdAt: new Date(Date.now() - ageDays * DAY) },
      });

    const orphanOld = name();
    const orphanYoung = name();
    const usedStudent = name();
    const usedLogo = name();
    const looseOld = name();
    const looseYoung = name();
    for (const [f, age] of [[orphanOld, 3], [orphanYoung, 0], [usedStudent, 5], [usedLogo, 5]] as const) {
      await file(f, age);
      await row(f, age);
    }
    await file(looseOld, 3); // sem linha Upload
    await file(looseYoung, 0);
    await fs.writeFile(path.join(dir, 'leia-me.txt'), 'nao e upload');
    await prisma.student.create({ data: { organizationId: orgId, name: 'Aluno GC', photo: `/api/uploads/${usedStudent}` } });
    await prisma.organization.update({ where: { id: orgId }, data: { logo: `https://api.exemplo.com/api/uploads/${usedLogo}` } });
    const exists = (f: string) => fs.stat(path.join(dir, f)).then(() => true, () => false);

    // desligado e dry-run: nada e apagado
    setEnv({ UPLOADS_GC: 'false' });
    assert.equal(await service.run({ dir, organizationId: orgId }), null);
    setEnv({ UPLOADS_GC: 'dry-run' });
    const dry = await service.run({ dir, organizationId: orgId });
    assert.equal(dry?.dryRun, true);
    assert.deepEqual([dry?.rowsRemoved, dry?.filesRemoved], [1, 2]);
    assert.ok(await exists(orphanOld) && await exists(looseOld));

    // execucao real
    setEnv({ UPLOADS_GC: 'true' });
    const result = await service.run({ dir, organizationId: orgId });
    assert.deepEqual([result?.rowsRemoved, result?.filesRemoved, result?.bytesFreed], [1, 2, 6]);
    assert.equal(await exists(orphanOld), false);
    assert.equal(await prisma.upload.count({ where: { filename: orphanOld } }), 0);
    assert.equal(await exists(looseOld), false);
    for (const keep of [orphanYoung, usedStudent, usedLogo, looseYoung, 'leia-me.txt']) {
      assert.ok(await exists(keep), `${keep} deve permanecer`);
    }
    assert.equal(await prisma.upload.count({ where: { organizationId: orgId } }), 3);

    // quando a foto e trocada, a antiga vira orfa e e coletada na proxima rodada
    await prisma.student.updateMany({ where: { organizationId: orgId }, data: { photo: null } });
    const next = await service.run({ dir, organizationId: orgId, now: new Date(Date.now() + 2 * DAY) });
    assert.ok(next && next.rowsRemoved >= 2);
    assert.equal(await exists(usedStudent), false);
    assert.ok(await exists(usedLogo), 'o logo continua em uso');
  });
});
