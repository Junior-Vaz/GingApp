import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuditAction, AuditEntity } from '../shared/audit/audit-actions';
import { AuditService } from '../shared/audit/audit.service';
import { PrismaService } from '../shared/prisma/prisma.service';

/** Todo domingo as 04:00, fuso de Sao Paulo. */
export const AUDIT_RETENTION_CRON_EXPRESSION = '0 4 * * 0';
export const AUDIT_RETENTION_CRON_TIMEZONE = 'America/Sao_Paulo';
export const AUDIT_RETENTION_CRON_NAME = 'audit-retention-weekly';
export const DEFAULT_AUDIT_RETENTION_DAYS = 365;
/** Apaga em lotes (nao trava a tabela numa unica transacao gigante) e com teto por execucao. */
export const AUDIT_PURGE_BATCH = 5000;
export const AUDIT_PURGE_MAX_BATCHES = 200;

const DAY_MS = 86_400_000;

/** AUDIT_RETENTION_CRON=false desliga o job (os testes e2e rodam assim: test/env-setup.ts). */
export function isAuditRetentionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUDIT_RETENTION_CRON !== 'false';
}

/** AUDIT_RETENTION_DAYS: padrao 365; 0 = nunca apagar; invalido/negativo = padrao. */
export function auditRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AUDIT_RETENTION_DAYS?.trim();
  if (raw === undefined || raw === '') return DEFAULT_AUDIT_RETENTION_DAYS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_AUDIT_RETENTION_DAYS;
}

/**
 * Retencao da trilha de auditoria (LGPD: nao guardar para sempre): semanalmente apaga AuditLog mais antigo que
 * AUDIT_RETENTION_DAYS. Deixa uma linha AUDIT_PURGE (quantas, ate que data) como prova da limpeza.
 */
@Injectable()
export class AuditRetentionCronService {
  private readonly logger = new Logger(AuditRetentionCronService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Cron(AUDIT_RETENTION_CRON_EXPRESSION, { name: AUDIT_RETENTION_CRON_NAME, timeZone: AUDIT_RETENTION_CRON_TIMEZONE })
  async handleCron(): Promise<void> {
    await this.run();
  }

  /** Corpo do job (chamavel direto, sem esperar o relogio). `null` = desligado/sem retencao/ja em execucao/erro. */
  async run(now: Date = new Date()): Promise<{ deleted: number; cutoff: Date } | null> {
    if (!isAuditRetentionEnabled()) return null;
    const days = auditRetentionDays();
    if (days === 0) return null;
    if (this.running) return null;
    this.running = true;
    try {
      const cutoff = new Date(now.getTime() - days * DAY_MS);
      let deleted = 0;
      for (let batch = 0; batch < AUDIT_PURGE_MAX_BATCHES; batch += 1) {
        const rows = await this.prisma.auditLog.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: AUDIT_PURGE_BATCH,
        });
        if (rows.length === 0) break;
        const { count } = await this.prisma.auditLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
        deleted += count;
        if (rows.length < AUDIT_PURGE_BATCH) break;
      }
      if (deleted > 0) {
        await this.audit.record({
          organizationId: null,
          userId: null,
          action: AuditAction.AUDIT_PURGE,
          entity: AuditEntity.AUDIT_LOG,
          meta: { deleted, retentionDays: days, olderThan: cutoff.toISOString() },
        });
      }
      this.logger.log(`Retenção da auditoria: ${deleted} registro(s) com mais de ${days} dia(s) apagado(s).`);
      return { deleted, cutoff };
    } catch (error) {
      this.logger.error('Falha na retenção da auditoria.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.running = false;
    }
  }
}
