import { Injectable } from '@nestjs/common';
import { FinancialStatus, Prisma } from '@prisma/client';
import { formatCivilDateBR } from '../../../shared/dates/format-br';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { civilTodayStart } from './finance.service';

/** Máximo de lançamentos processados por chamada (hasMore indica que sobrou; basta chamar de novo). */
export const OVERDUE_BATCH_SIZE = 1000;

export interface MarkOverdueResult {
  /** Lançamentos que passaram de PENDING para OVERDUE nesta chamada. */
  marked: number;
  /** Notificações gravadas (uma por lançamento x usuário que enxerga o aluno: o próprio e os responsáveis com login). */
  notified: number;
  /** true quando havia mais de OVERDUE_BATCH_SIZE pendentes vencidos — chame de novo para o restante. */
  hasMore: boolean;
}

const brl = (cents: number): string => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

/**
 * Transição PENDING -> OVERDUE gravada + notificação (E09). Até aqui o atraso era só CALCULADO na
 * consulta (FinanceService.buildWhere: PENDING com vencimento anterior a hoje conta como atrasado);
 * este serviço o torna persistido e avisa o aluno/responsável.
 *
 * Idempotente: só toca lançamentos PENDING; os já OVERDUE não são notificados de novo. A
 * mudança de status e as notificações vão numa única transação (ou tudo, ou nada).
 *
 * Uso sob demanda: POST /finance/mark-overdue (escopado à organização do usuário). Para rodar
 * periodicamente, chame `markOverdueAndNotify()` (sem organizationId = todas as organizações) de um
 * agendador — o projeto ainda NÃO depende de @nestjs/schedule; ao adicioná-lo basta um @Cron diário
 * que invoque este método. Lançamentos avulsos (sem aluno) são marcados mas não geram notificação.
 */
@Injectable()
export class FinanceOverdueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async markOverdueAndNotify(organizationId?: number, now: Date = new Date()): Promise<MarkOverdueResult> {
    const today = civilTodayStart(now);
    const where: Prisma.FinancialRecordWhereInput = {
      ...(organizationId !== undefined ? { organizationId } : {}),
      status: FinancialStatus.PENDING,
      dueDate: { lt: today },
    };

    const found = await this.prisma.financialRecord.findMany({
      where,
      orderBy: { id: 'asc' },
      take: OVERDUE_BATCH_SIZE + 1,
      select: { id: true, organizationId: true, studentId: true },
    });
    const hasMore = found.length > OVERDUE_BATCH_SIZE;
    const batch = found.slice(0, OVERDUE_BATCH_SIZE);
    if (batch.length === 0) return { marked: 0, notified: 0, hasMore: false };

    // Destinatários por organização (nunca cruza tenants): studentId -> userIds.
    const studentsByOrg = new Map<number, number[]>();
    for (const r of batch) {
      if (r.studentId === null) continue;
      studentsByOrg.set(r.organizationId, [...(studentsByOrg.get(r.organizationId) ?? []), r.studentId]);
    }
    const recipients = new Map<number, Map<number, number[]>>();
    for (const [orgId, studentIds] of studentsByOrg) {
      recipients.set(orgId, await this.notifications.userIdsByStudent(orgId, studentIds));
    }

    const ids = batch.map((r) => r.id);
    return this.prisma.$transaction(async (tx) => {
      await tx.financialRecord.updateMany({
        where: { id: { in: ids }, status: FinancialStatus.PENDING },
        data: { status: FinancialStatus.OVERDUE },
      });
      // Relê o que de fato ficou OVERDUE (um lançamento pago no meio do caminho continua PAID e não é avisado).
      const marked = await tx.financialRecord.findMany({
        where: { id: { in: ids }, status: FinancialStatus.OVERDUE },
        select: { id: true, organizationId: true, studentId: true, description: true, amountCents: true, dueDate: true },
      });

      const items: Prisma.NotificationCreateManyInput[] = [];
      for (const r of marked) {
        if (r.studentId === null) continue;
        const userIds = recipients.get(r.organizationId)?.get(r.studentId) ?? [];
        for (const userId of userIds) {
          items.push({
            organizationId: r.organizationId,
            userId,
            title: 'Mensalidade vencida',
            body: `${r.description} (${brl(r.amountCents)}) venceu em ${formatCivilDateBR(r.dueDate)}.`,
            type: 'FINANCE_OVERDUE',
          });
        }
      }
      const notified = await this.notifications.createMany(items, tx);
      return { marked: marked.length, notified, hasMore };
    });
  }
}
