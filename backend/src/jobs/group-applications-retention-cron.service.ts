import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GroupApplicationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { groupApplicationsPurgeMode, retentionCutoffs } from '../interface/http/group-applications/group-application-rules';

/** Modo do job (SSOT em group-application-rules.ts; reexportado para o AppModule e os specs). */
export { groupApplicationsPurgeMode };

/** Todo dia as 05:30, fuso de Sao Paulo (fora das janelas dos demais jobs diarios). */
export const GROUP_APPLICATIONS_RETENTION_CRON_EXPRESSION = '30 5 * * *';
export const GROUP_APPLICATIONS_RETENTION_CRON_TIMEZONE = 'America/Sao_Paulo';
export const GROUP_APPLICATIONS_RETENTION_CRON_NAME = 'group-applications-retention-daily';

export interface GroupApplicationsRetentionResult {
  dryRun: boolean;
  /** PENDING com mais de 60 dias (viram EXPIRED, senha apagada). */
  expired: number;
  /** REJECTED/EXPIRED com mais de 90 dias + APPROVED com mais de 180 dias (apagados). */
  deleted: number;
  /** Rede de seguranca: pedidos ja decididos que ainda tinham hash de senha (apagado). Esperado: 0. */
  hashesCleared: number;
}

/**
 * Retencao dos pedidos de adesao (docs/CONTRATO_ADESAO_GRUPOS.md secao 2), diaria. GROUP_APPLICATIONS_PURGE = `true`
 * executa; `dry-run` (PADRAO) so conta e registra no log; `false` desliga. Idade de referencia: PENDING = createdAt;
 * decididos/expirados = decidedAt (expirar grava decidedAt = agora), com createdAt na falta. Apagar o pedido APROVADO nao
 * toca no grupo nem na conta criados (a FK fica do lado do pedido). So contagens no log (nunca e-mail/nome).
 */
@Injectable()
export class GroupApplicationsRetentionCronService {
  private readonly logger = new Logger(GroupApplicationsRetentionCronService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(GROUP_APPLICATIONS_RETENTION_CRON_EXPRESSION, {
    name: GROUP_APPLICATIONS_RETENTION_CRON_NAME,
    timeZone: GROUP_APPLICATIONS_RETENTION_CRON_TIMEZONE,
  })
  async handleCron(): Promise<void> {
    await this.run();
  }

  /** Corpo do job (chamavel direto). `onlyIds` limita a varredura (so para os testes, que dividem o banco de dev). */
  async run(options: { now?: Date; onlyIds?: number[] } = {}): Promise<GroupApplicationsRetentionResult | null> {
    const mode = groupApplicationsPurgeMode();
    if (mode === 'off' || this.running) return null;
    this.running = true;
    try {
      return await this.collect(options.now ?? new Date(), mode === 'dry-run', options.onlyIds);
    } catch (error) {
      this.logger.error('Falha na retenção dos pedidos de adesão.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.running = false;
    }
  }

  private async collect(now: Date, dryRun: boolean, onlyIds?: number[]): Promise<GroupApplicationsRetentionResult> {
    const c = retentionCutoffs(now);
    const scope: Prisma.GroupApplicationWhereInput = onlyIds ? { id: { in: onlyIds } } : {};
    const expireWhere: Prisma.GroupApplicationWhereInput = {
      ...scope,
      status: GroupApplicationStatus.PENDING,
      createdAt: { lt: c.expirePendingBefore },
    };
    const olderThan = (statuses: GroupApplicationStatus[], cutoff: Date): Prisma.GroupApplicationWhereInput[] => [
      { status: { in: statuses }, decidedAt: { lt: cutoff } },
      { status: { in: statuses }, decidedAt: null, createdAt: { lt: cutoff } },
    ];
    const deleteWhere: Prisma.GroupApplicationWhereInput = {
      ...scope,
      OR: [
        ...olderThan([GroupApplicationStatus.REJECTED, GroupApplicationStatus.EXPIRED], c.deleteClosedBefore),
        ...olderThan([GroupApplicationStatus.APPROVED], c.deleteApprovedBefore),
      ],
    };
    const leftoverHashWhere: Prisma.GroupApplicationWhereInput = {
      ...scope,
      status: { not: GroupApplicationStatus.PENDING },
      passwordHash: { not: null },
    };

    let result: GroupApplicationsRetentionResult;
    if (dryRun) {
      const [expired, deleted, hashesCleared] = await Promise.all([
        this.prisma.groupApplication.count({ where: expireWhere }),
        this.prisma.groupApplication.count({ where: deleteWhere }),
        this.prisma.groupApplication.count({ where: leftoverHashWhere }),
      ]);
      result = { dryRun, expired, deleted, hashesCleared };
    } else {
      // Apaga ANTES de expirar: o que expira agora ganha decidedAt = now e so sai daqui a 90 dias.
      const deleted = (await this.prisma.groupApplication.deleteMany({ where: deleteWhere })).count;
      const expired = (
        await this.prisma.groupApplication.updateMany({
          where: expireWhere,
          data: { status: GroupApplicationStatus.EXPIRED, passwordHash: null, decidedAt: now },
        })
      ).count;
      const hashesCleared = (await this.prisma.groupApplication.updateMany({ where: leftoverHashWhere, data: { passwordHash: null } })).count;
      result = { dryRun, expired, deleted, hashesCleared };
    }
    this.logger.log(
      `Retenção dos pedidos de adesão${dryRun ? ' (dry-run, nada alterado)' : ''}: ${result.expired} pendente(s) expirado(s), ` +
        `${result.deleted} pedido(s) apagado(s), ${result.hashesCleared} hash(es) de senha remanescente(s) apagado(s).`,
    );
    return result;
  }
}
