import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RegistrationFormStatus } from '@prisma/client';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AuditAction, AuditEntity } from '../shared/audit/audit-actions';
import { AuditService } from '../shared/audit/audit.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { deletePrivateFile, resolvePrivateUploadsDir, STORAGE_KEY_REGEX } from '../interface/http/registration-forms/private-storage';
import {
  addMonths,
  anonymizeSubmissions,
  formsRetentionMode,
  retentionCutoffForUndated,
  retentionReference,
} from '../interface/http/registration-forms/submission-purge';

/** Modo do job (SSOT em submission-purge.ts; reexportado para o AppModule e os specs). */
export { formsRetentionMode };

/** Todo dia as 04:45, fuso de Sao Paulo. */
export const FORMS_RETENTION_CRON_EXPRESSION = '45 4 * * *';
export const FORMS_RETENTION_CRON_TIMEZONE = 'America/Sao_Paulo';
export const FORMS_RETENTION_CRON_NAME = 'forms-retention-daily';
/** Anexos PENDENTES expirados (upload anonimo que nunca virou inscricao): a cada 15 minutos. */
export const FORMS_PENDING_CLEANUP_CRON_EXPRESSION = '*/15 * * * *';
export const FORMS_PENDING_CLEANUP_CRON_NAME = 'forms-pending-files-15min';
/** Varredura disco x banco dos anexos privados: domingo 05:15. */
export const FORMS_FILES_SWEEP_CRON_EXPRESSION = '15 5 * * 0';
export const FORMS_FILES_SWEEP_CRON_NAME = 'forms-files-sweep-weekly';
/** Anexo sem inscricao e sem prazo (caso raro) so e lixo depois deste tempo. */
const ORPHAN_FILE_AGE_MS = 24 * 60 * 60 * 1000;
/** Arquivo privado SEM linha no banco so e apagado pela varredura depois deste tempo (upload em andamento fica). */
export const SWEEP_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Lote da limpeza de pendentes (varias rodadas por execucao, ate PENDING_MAX_BATCHES). */
const PENDING_BATCH = 1000;
const PENDING_MAX_BATCHES = 20;

export interface FormsRetentionResult {
  dryRun: boolean;
  formsEligible: number;
  submissionsAnonymized: number;
  filesDeleted: number;
  pendingFilesDeleted: number;
}

export interface FormsFilesSweepResult {
  dryRun: boolean;
  /** Arquivos no disco sem linha no banco e com mais de 7 dias (apagados so com FORMS_RETENTION_PURGE=true). */
  orphanFiles: number;
  orphanFilesDeleted: number;
  /** Linhas de anexo cujo arquivo nao existe mais no disco (so log: a linha prova que houve anexo). */
  rowsWithoutFile: number;
}

/**
 * Retencao LGPD dos formularios de inscricao (docs/PLANO_FORMULARIOS_INSCRICAO.md secao 6):
 *  - diario 04:45: passados `retentionMonths` do encerramento (closesAt/closedAt/archivedAt/data do evento, o mais
 *    tardio) ANONIMIZA as inscricoes (mantem protocolo, situacao e contadores) e apaga os anexos do disco; formulario
 *    SEM data de encerramento conta por inscricao (createdAt + retentionMonths). Uma linha REGISTRATION_FORM_PURGE por
 *    formulario (so contagens). Rascunhos nunca tem inscricoes;
 *  - a cada 15 min: anexos PENDENTES expirados (nunca viraram inscricao) saem do disco e do banco - em `true` E em
 *    `dry-run` (nao sao dado de ninguem inscrito; segura-los so ajuda abuso de disco); so `false` desliga;
 *  - semanal: varredura disco x banco (arquivo sem linha > 7 dias: apagado em `true`, so log em `dry-run`; linha sem
 *    arquivo: so log).
 */
@Injectable()
export class FormsRetentionCronService {
  private readonly logger = new Logger(FormsRetentionCronService.name);
  private running = false;
  private cleaning = false;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Cron(FORMS_RETENTION_CRON_EXPRESSION, { name: FORMS_RETENTION_CRON_NAME, timeZone: FORMS_RETENTION_CRON_TIMEZONE })
  async handleCron(): Promise<void> {
    await this.run();
  }

  @Cron(FORMS_PENDING_CLEANUP_CRON_EXPRESSION, { name: FORMS_PENDING_CLEANUP_CRON_NAME, timeZone: FORMS_RETENTION_CRON_TIMEZONE })
  async handlePendingCron(): Promise<void> {
    await this.cleanPending();
  }

  @Cron(FORMS_FILES_SWEEP_CRON_EXPRESSION, { name: FORMS_FILES_SWEEP_CRON_NAME, timeZone: FORMS_RETENTION_CRON_TIMEZONE })
  async handleSweepCron(): Promise<void> {
    await this.sweepFiles();
  }

  /** Corpo do job diario (chamavel direto). `organizationId` limita a varredura (so para os testes). */
  async run(options: { now?: Date; organizationId?: number } = {}): Promise<FormsRetentionResult | null> {
    const mode = formsRetentionMode();
    if (mode === 'off' || this.running) return null;
    this.running = true;
    try {
      return await this.collect(options.now ?? new Date(), mode === 'dry-run', options.organizationId);
    } catch (error) {
      this.logger.error('Falha na retenção dos formulários de inscrição.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.running = false;
    }
  }

  /** Limpeza dos anexos PENDENTES expirados (chamavel direto). Devolve quantos saiu, ou null se desligado/ocupado. */
  async cleanPending(options: { now?: Date; organizationId?: number } = {}): Promise<number | null> {
    if (formsRetentionMode() === 'off' || this.cleaning) return null;
    this.cleaning = true;
    try {
      const deleted = await this.deletePending(options.now ?? new Date(), options.organizationId);
      if (deleted > 0) this.logger.log(`Anexos pendentes expirados apagados: ${deleted}.`);
      return deleted;
    } catch (error) {
      this.logger.error('Falha na limpeza dos anexos pendentes.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.cleaning = false;
    }
  }

  private async deletePending(now: Date, organizationId?: number): Promise<number> {
    const orgFilter = organizationId !== undefined ? { organizationId } : {};
    let deleted = 0;
    for (let round = 0; round < PENDING_MAX_BATCHES; round++) {
      const stale = await this.prisma.registrationSubmissionFile.findMany({
        where: {
          ...orgFilter,
          submissionId: null,
          OR: [{ expiresAt: { lt: now } }, { expiresAt: null, createdAt: { lt: new Date(now.getTime() - ORPHAN_FILE_AGE_MS) } }],
        },
        select: { id: true, storageKey: true },
        orderBy: { id: 'asc' },
        take: PENDING_BATCH,
      });
      for (const f of stale) {
        // Linha primeiro (condicional: um envio simultaneo que acabou de ligar o arquivo vence), arquivo depois.
        const removed = await this.prisma.registrationSubmissionFile.deleteMany({ where: { id: f.id, submissionId: null } });
        if (removed.count === 0) continue;
        await deletePrivateFile(f.storageKey).catch(() => undefined);
        deleted += 1;
      }
      if (stale.length < PENDING_BATCH) break;
    }
    return deleted;
  }

  private async collect(now: Date, dryRun: boolean, organizationId?: number): Promise<FormsRetentionResult> {
    const result: FormsRetentionResult = { dryRun, formsEligible: 0, submissionsAnonymized: 0, filesDeleted: 0, pendingFilesDeleted: 0 };
    const orgFilter = organizationId !== undefined ? { organizationId } : {};

    // 1) Anexos pendentes expirados (tambem roda a cada 15 min; aqui e a rede de seguranca diaria).
    result.pendingFilesDeleted = await this.deletePending(now, organizationId);

    // 2) Retencao das inscricoes.
    const forms = await this.prisma.registrationForm.findMany({
      where: { ...orgFilter, status: { not: RegistrationFormStatus.DRAFT } },
      select: {
        id: true,
        organizationId: true,
        retentionMonths: true,
        closesAt: true,
        closedAt: true,
        archivedAt: true,
        event: { select: { date: true } },
      },
    });
    for (const form of forms) {
      const reference = retentionReference(form);
      // Com data de encerramento: o formulario inteiro, depois de N meses dela. Sem data (aberto sem prazo/evento): cada
      // inscricao depois de N meses do proprio envio.
      if (reference && addMonths(reference, form.retentionMonths).getTime() > now.getTime()) continue;
      const where = reference ? { formId: form.id } : { formId: form.id, createdAt: { lte: retentionCutoffForUndated(now, form.retentionMonths) } };
      const pending = await this.prisma.registrationSubmission.count({ where: { ...where, anonymizedAt: null } });
      if (pending === 0) continue;
      result.formsEligible += 1;
      if (dryRun) {
        result.submissionsAnonymized += pending;
        continue;
      }
      const purged = await this.prisma.$transaction((tx) => anonymizeSubmissions(tx, where, now), { timeout: 60_000, maxWait: 10_000 });
      let deleted = 0;
      for (const key of purged.storageKeys) if (await deletePrivateFile(key).catch(() => false)) deleted += 1;
      if (reference) await this.prisma.registrationForm.update({ where: { id: form.id }, data: { purgedAt: now } });
      result.submissionsAnonymized += purged.count;
      result.filesDeleted += deleted;
      await this.audit.record({
        organizationId: form.organizationId,
        userId: null,
        ip: null,
        action: AuditAction.REGISTRATION_FORM_PURGE,
        entity: AuditEntity.REGISTRATION_FORM,
        entityId: form.id,
        meta: { submissions: purged.count, files: deleted, participants: purged.participants, retentionMonths: form.retentionMonths, perSubmission: !reference },
      });
    }

    this.logger.log(
      `Retenção de inscrições${dryRun ? ' (dry-run, nada anonimizado)' : ''}: ${result.formsEligible} formulário(s), ` +
        `${result.submissionsAnonymized} inscrição(ões), ${result.filesDeleted} anexo(s); ${result.pendingFilesDeleted} anexo(s) pendente(s) expirado(s) apagado(s).`,
    );
    return result;
  }

  /**
   * Varredura disco x banco do diretorio PRIVADO (chamavel direto). `baseDir`/`now` so para os testes. Arquivo com nome
   * fora do formato gerado pelo servidor nunca e tocado (pode nao ser nosso).
   */
  async sweepFiles(options: { now?: Date; baseDir?: string; organizationId?: number } = {}): Promise<FormsFilesSweepResult | null> {
    const mode = formsRetentionMode();
    if (mode === 'off' || this.sweeping) return null;
    this.sweeping = true;
    const dryRun = mode === 'dry-run';
    const result: FormsFilesSweepResult = { dryRun, orphanFiles: 0, orphanFilesDeleted: 0, rowsWithoutFile: 0 };
    try {
      const now = options.now ?? new Date();
      const base = options.baseDir ?? resolvePrivateUploadsDir();
      const orgDirs = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
      for (const dir of orgDirs) {
        if (!dir.isDirectory() || !/^org-\d{1,10}$/.test(dir.name)) continue;
        if (options.organizationId !== undefined && dir.name !== `org-${options.organizationId}`) continue;
        const names = (await fs.readdir(path.join(base, dir.name)).catch(() => [] as string[])).filter((n) => STORAGE_KEY_REGEX.test(`${dir.name}/${n}`));
        for (let i = 0; i < names.length; i += 500) {
          const keys = names.slice(i, i + 500).map((n) => `${dir.name}/${n}`);
          const known = new Set(
            (await this.prisma.registrationSubmissionFile.findMany({ where: { storageKey: { in: keys } }, select: { storageKey: true } })).map((r) => r.storageKey),
          );
          for (const key of keys) {
            if (known.has(key)) continue;
            const stat = await fs.stat(path.join(base, ...key.split('/'))).catch(() => null);
            if (!stat || now.getTime() - stat.mtimeMs < SWEEP_MIN_AGE_MS) continue;
            result.orphanFiles += 1;
            if (!dryRun) {
              await fs.unlink(path.join(base, ...key.split('/'))).then(
                () => (result.orphanFilesDeleted += 1),
                () => undefined,
              );
            }
          }
        }
      }
      // Linhas sem arquivo (so log; lotes por id).
      let cursor = 0;
      for (;;) {
        const rows = await this.prisma.registrationSubmissionFile.findMany({
          where: { id: { gt: cursor }, ...(options.organizationId !== undefined ? { organizationId: options.organizationId } : {}) },
          select: { id: true, storageKey: true },
          orderBy: { id: 'asc' },
          take: 500,
        });
        if (rows.length === 0) break;
        for (const r of rows) {
          const exists = await fs.stat(path.join(base, ...r.storageKey.split('/'))).then(
            () => true,
            () => false,
          );
          if (!exists) result.rowsWithoutFile += 1;
        }
        cursor = rows[rows.length - 1].id;
      }
      this.logger.log(
        `Varredura dos anexos privados${dryRun ? ' (dry-run, nada apagado)' : ''}: ${result.orphanFiles} arquivo(s) sem registro há mais de 7 dias` +
          `${dryRun ? '' : ` (${result.orphanFilesDeleted} apagado(s))`}; ${result.rowsWithoutFile} registro(s) sem arquivo.`,
      );
      return result;
    } catch (error) {
      this.logger.error('Falha na varredura dos anexos privados.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.sweeping = false;
    }
  }
}
