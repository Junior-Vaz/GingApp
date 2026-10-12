import { Injectable } from '@nestjs/common';
import { FinancialStatus, PaymentMethod, Prisma } from '@prisma/client';
import { buildCsv, centsToReais, EXPORT_MAX_ROWS } from '../../../shared/csv/csv';
import { formatCivilDateBR } from '../../../shared/dates/format-br';
import { UnitScopeService, unitScopeFilter } from '../../../shared/access/unit-scope';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ListDelinquentsQueryDto } from './dto/list-delinquents-query.dto';
import { ListFinanceQueryDto } from './dto/list-finance-query.dto';
import { FinanceCollectionService } from './finance-collection.service';
import { civilTodayStart, FinanceService } from './finance.service';

const STATUS_LABEL: Record<FinancialStatus, string> = {
  PENDING: 'Pendente',
  PAID: 'Pago',
  OVERDUE: 'Atrasado',
  CANCELLED: 'Cancelado',
};
const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Dinheiro',
  PIX: 'Pix',
  CARD: 'Cartão',
  TRANSFER: 'Transferência',
  OTHER: 'Outro',
};

/**
 * Exportação CSV do financeiro: lançamentos (mesmo `where` de GET /finance, incl. a regra de status EFETIVO) e
 * inadimplentes (mesma consulta de GET /finance/delinquents). Só o MESTRE chega aqui (recurso `finance` da matriz);
 * o escopo de unidade ainda é aplicado nos lançamentos (defesa em profundidade se a matriz mudar).
 */
@Injectable()
export class FinanceExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
    private readonly collection: FinanceCollectionService,
    private readonly unitScope: UnitScopeService,
  ) {}

  async exportRecords(
    organizationId: number,
    query: ListFinanceQueryDto,
    user: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<{ csv: string; total: number }> {
    const today = civilTodayStart(now);
    const scope = unitScopeFilter(await this.unitScope.resolve(user, organizationId));
    const where: Prisma.FinancialRecordWhereInput = { AND: [this.finance.buildWhere(organizationId, query, today), scope] };
    const [rows, total] = await Promise.all([
      this.prisma.financialRecord.findMany({
        where,
        include: { student: { select: { name: true } }, unit: { select: { name: true } } },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: EXPORT_MAX_ROWS,
      }),
      this.prisma.financialRecord.count({ where }),
    ]);
    const csv = buildCsv(
      [
        'ID',
        'Aluno',
        'Descrição',
        'Tipo',
        'Competência',
        'Vencimento',
        'Situação',
        'Valor (R$)',
        'Valor pago (R$)',
        'Pago em',
        'Forma de pagamento',
        'Unidade',
      ],
      rows.map((r) => {
        // Status EFETIVO (igual ao da tela): PENDING vencido conta como Atrasado.
        const status = r.status === FinancialStatus.PENDING && r.dueDate < today ? FinancialStatus.OVERDUE : r.status;
        return [
          r.id,
          r.student?.name ?? '',
          r.description,
          r.type ?? '',
          r.competence ?? '',
          formatCivilDateBR(r.dueDate),
          STATUS_LABEL[status],
          centsToReais(r.amountCents),
          r.status === FinancialStatus.PAID ? centsToReais(r.paidCents ?? r.amountCents) : '',
          r.paidAt ? formatCivilDateBR(r.paidAt) : '',
          r.paymentMethod ? METHOD_LABEL[r.paymentMethod] : '',
          r.unit?.name ?? '',
        ];
      }),
    );
    return { csv, total };
  }

  async exportDelinquents(
    organizationId: number,
    query: ListDelinquentsQueryDto,
    now: Date = new Date(),
  ): Promise<{ csv: string; total: number }> {
    const page = await this.collection.listDelinquents(organizationId, { ...query, limit: EXPORT_MAX_ROWS, offset: 0 }, now);
    const unitIds = [...new Set(page.items.map((r) => r.unitId).filter((id): id is number => id !== null))];
    const units = unitIds.length
      ? await this.prisma.unit.findMany({ where: { organizationId, id: { in: unitIds } }, select: { id: true, name: true } })
      : [];
    const unitName = new Map(units.map((u) => [u.id, u.name]));
    const csv = buildCsv(
      [
        'Aluno',
        'Unidade',
        'Telefone',
        'E-mail',
        'Responsáveis',
        'Lançamentos em atraso',
        'Valor em atraso (R$)',
        'Total em aberto (R$)',
        'Vencimento mais antigo',
        'Dias de atraso',
      ],
      page.items.map((r) => [
        r.studentName,
        r.unitId !== null ? (unitName.get(r.unitId) ?? '') : '',
        r.phone ?? '',
        r.email ?? '',
        r.guardians
          .map((g) => {
            const contact = [g.phone, g.email].filter(Boolean).join(' / ');
            return `${g.name}${g.relationship ? ` (${g.relationship})` : ''}${contact ? `: ${contact}` : ''}`;
          })
          .join(' | '),
        r.overdueCount,
        centsToReais(r.overdueCents),
        centsToReais(r.openCents),
        formatCivilDateBR(new Date(r.oldestDueDate)),
        r.daysLate,
      ]),
    );
    return { csv, total: page.total };
  }
}
