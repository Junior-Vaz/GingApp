import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FinancialRecord, FinancialStatus, PaidVia, Prisma } from '@prisma/client';
import { LimitOffsetQueryDto, Page, pageArgs } from '../../../shared/pagination/pagination';
import { PixLifecycleHooks } from '../../../shared/payments/pix-lifecycle.hooks';
import { PaymentErrorCode, paymentError } from '../payments/payment-errors';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { requireLinkedStudent } from '../../../shared/access/linked-student';
import { StudentsService } from '../students/students.service';
import { CreateFinanceRecordDto } from './dto/create-finance-record.dto';
import { UpdateFinanceRecordDto } from './dto/update-finance-record.dto';
import { ListFinanceQueryDto } from './dto/list-finance-query.dto';
import { FinanceRecordView, PIX_OPEN_GATEWAY_STATUSES, toFinanceRecordView } from './finance-record.view';

const DAY_MS = 24 * 60 * 60 * 1000;

const recordChanged = () =>
  paymentError(409, PaymentErrorCode.RECORD_CHANGED, 'O lançamento foi alterado (talvez pago por Pix). Recarregue.');

/** Resumo financeiro em centavos (ver FinanceService.summary). */
export interface FinanceSummary {
  paid: number;
  pending: number;
  overdue: number;
  count: number;
  paidCount: number;
  pendingCount: number;
  overdueCount: number;
}

/** Resumo do "meu financeiro" (GET /finance/me/summary), em centavos. `oldestOpenDueDate`: menor
 * vencimento entre os lançamentos em aberto (ISO, meia-noite UTC do dia civil) ou null. */
export interface MyFinanceSummary {
  openCents: number;
  openCount: number;
  overdueCents: number;
  overdueCount: number;
  paidCents: number;
  paidCount: number;
  oldestOpenDueDate: string | null;
}

/**
 * `dueDate` é uma DATA CIVIL (gravada como meia-noite UTC do dia, ex.: '2026-10-09' ->
 * 2026-10-09T00:00:00Z). "Hoje" para a regra de atraso é o dia atual em America/Sao_Paulo (fuso
 * do produto), convertido para a mesma representação (meia-noite UTC desse dia). Assim
 * `dueDate < hoje` é exatamente "vencimento em dia civil anterior a hoje": vence hoje NÃO é
 * atrasado; ontem é. `now` é injetável para testes.
 */
export function civilTodayStart(now: Date = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${ymd}T00:00:00.000Z`);
}

/**
 * Cláusula ÚNICA de "atrasado" (SSOT): status OVERDUE gravado OU PENDING com vencimento anterior a `today`
 * (data civil de São Paulo, ver civilTodayStart). Usada pela lista/resumo do financeiro e pela lista de
 * inadimplentes (FinanceCollectionService) — assim as duas nunca divergem.
 */
export function effectiveOverdueClause(today: Date): Prisma.FinancialRecordWhereInput {
  return {
    OR: [{ status: FinancialStatus.OVERDUE }, { status: FinancialStatus.PENDING, dueDate: { lt: today } }],
  };
}

/** Início (UTC) do dia civil de um ISO/yyyy-MM-dd. */
export function dayStart(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

/**
 * Registros financeiros (mensalidades, cobrancas) — CRUD completo, sempre isolado por
 * organizationId (PLANO_PROJETO.md §7 / §10.5-10.6).
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentsService: StudentsService,
    private readonly audit: AuditService,
    private readonly pixHooks: PixLifecycleHooks,
  ) {}

  /**
   * Where único de lista e resumo (total e totais sempre sob o mesmo filtro e sempre dentro da
   * organização). O filtro `status` é o EFETIVO: PENDING só com vencimento >= hoje; OVERDUE =
   * status OVERDUE gravado OU PENDING vencido (mesma regra do painel).
   */
  buildWhere(
    organizationId: number,
    query: ListFinanceQueryDto,
    today: Date,
  ): Prisma.FinancialRecordWhereInput {
    // Público: a exportação CSV (finance-export.service.ts) usa este MESMO where (filtros iguais aos da tela).
    const and: Prisma.FinancialRecordWhereInput[] = [];

    if (query.status === FinancialStatus.PENDING) {
      and.push({ status: FinancialStatus.PENDING, dueDate: { gte: today } });
    } else if (query.status === FinancialStatus.OVERDUE) {
      and.push(effectiveOverdueClause(today));
    } else if (query.status) {
      and.push({ status: query.status });
    }

    // from/to: vencimento, datas civis inclusivas (to = até o fim desse dia).
    if (query.from) and.push({ dueDate: { gte: dayStart(query.from) } });
    if (query.to) and.push({ dueDate: { lt: new Date(dayStart(query.to).getTime() + DAY_MS) } });

    const q = query.q?.trim();
    if (q) {
      and.push({
        OR: [
          { description: { contains: q, mode: 'insensitive' } },
          { type: { contains: q, mode: 'insensitive' } },
        ],
      });
    }

    return { organizationId, ...(query.studentId !== undefined ? { studentId: query.studentId } : {}), AND: and };
  }

  async findAll(organizationId: number, query: ListFinanceQueryDto = {}): Promise<Page<unknown>> {
    const where = this.buildWhere(organizationId, query, civilTodayStart());
    const [items, total] = await Promise.all([
      // `student: { id, name } | null` vem no mesmo SELECT (join do Prisma, sem N+1) — mesmo
      // formato de GET /certificates; os campos existentes (incl. studentId) seguem iguais.
      this.prisma.financialRecord.findMany({
        where,
        include: { student: { select: { id: true, name: true, photo: true } } },
        orderBy: { id: 'desc' },
        ...pageArgs(query),
      }),
      this.prisma.financialRecord.count({ where }),
    ]);
    const now = new Date();
    return { items: items.map((r) => toFinanceRecordView(r, now)), total };
  }

  /**
   * Totais por AGREGAÇÃO no banco (nunca soma uma lista truncada), em centavos, sob os mesmos
   * filtros da lista. paid = PAID; overdue = OVERDUE gravado + PENDING com vencimento < hoje;
   * pending = PENDING com vencimento >= hoje; CANCELLED fica fora de todos os totais e de
   * `count` (count = paidCount + pendingCount + overdueCount).
   */
  async summary(organizationId: number, query: ListFinanceQueryDto, now: Date = new Date()): Promise<FinanceSummary> {
    const today = civilTodayStart(now);
    return this.aggregate(this.buildWhere(organizationId, query, today), today);
  }

  /** Agregação única (gestão e "meu financeiro") sobre um `where` já escopado. */
  private async aggregate(where: Prisma.FinancialRecordWhereInput, today: Date): Promise<FinanceSummary> {
    const [byStatus, pendingLate, paidReceived, paidLegacy] = await Promise.all([
      this.prisma.financialRecord.groupBy({
        by: ['status'],
        where,
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      this.prisma.financialRecord.aggregate({
        where: { AND: [where, { status: FinancialStatus.PENDING, dueDate: { lt: today } }] },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      // "Recebido" = valor EFETIVAMENTE pago (paidCents da baixa); lancamentos pagos sem paidCents (anteriores a baixa
      // rapida, ou marcados PAID pelo PATCH) caem no valor do lancamento (amountCents).
      this.prisma.financialRecord.aggregate({
        where: { AND: [where, { status: FinancialStatus.PAID, paidCents: { not: null } }] },
        _sum: { paidCents: true },
      }),
      this.prisma.financialRecord.aggregate({
        where: { AND: [where, { status: FinancialStatus.PAID, paidCents: null }] },
        _sum: { amountCents: true },
      }),
    ]);

    const pick = (s: FinancialStatus) => {
      const row = byStatus.find((r) => r.status === s);
      return { cents: row?._sum.amountCents ?? 0, n: row?._count._all ?? 0 };
    };
    const paid = pick(FinancialStatus.PAID);
    const pending = pick(FinancialStatus.PENDING);
    const overdue = pick(FinancialStatus.OVERDUE);
    const lateCents = pendingLate._sum.amountCents ?? 0;
    const lateN = pendingLate._count._all;

    const out: FinanceSummary = {
      paid: (paidReceived._sum.paidCents ?? 0) + (paidLegacy._sum.amountCents ?? 0),
      pending: pending.cents - lateCents,
      overdue: overdue.cents + lateCents,
      count: 0,
      paidCount: paid.n,
      pendingCount: pending.n - lateN,
      overdueCount: overdue.n + lateN,
    };
    out.count = out.paidCount + out.pendingCount + out.overdueCount;
    return out;
  }

  /**
   * "Meu financeiro" — escopado aos alunos ligados ao usuário autenticado (ele mesmo ou seus
   * dependentes via StudentGuardian), NUNCA à organização inteira. Resolve a pendência
   * registrada em §10.7: GET /finance é restrito ao MESTRE porque não é filtrado;
   * esta rota é o jeito seguro de um ALUNO/RESPONSAVEL ver os próprios lançamentos.
   */
  async findMine(
    organizationId: number,
    userId: number,
    query: LimitOffsetQueryDto & { studentId?: number } = {},
  ): Promise<Page<FinanceRecordView<FinancialRecord>>> {
    const where = await this.mineWhere(organizationId, userId, query.studentId);
    if (!where) return { items: [], total: 0 };

    const [items, total] = await Promise.all([
      this.prisma.financialRecord.findMany({
        where,
        // Vencimento mais recente primeiro (histórico); `id` desempata => paginação determinística.
        orderBy: [{ dueDate: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.financialRecord.count({ where }),
    ]);
    const now = new Date();
    return { items: items.map((r) => toFinanceRecordView(r, now)), total };
  }

  /**
   * Totais do "meu financeiro" por AGREGAÇÃO no banco (nunca soma a lista paginada de /me), no
   * mesmo escopo de `findMine` e com a MESMA regra de atraso do resumo da gestão (`aggregate`):
   * dia civil de São Paulo, vence hoje NÃO é atrasado, PENDING vencido conta como atrasado,
   * CANCELLED fora. "Em aberto" = a receber + atrasado.
   */
  async summaryMine(
    organizationId: number,
    userId: number,
    now: Date = new Date(),
    studentId?: number,
  ): Promise<MyFinanceSummary> {
    const empty: MyFinanceSummary = {
      openCents: 0,
      openCount: 0,
      overdueCents: 0,
      overdueCount: 0,
      paidCents: 0,
      paidCount: 0,
      oldestOpenDueDate: null,
    };
    const scope = await this.mineWhere(organizationId, userId, studentId);
    if (!scope) return empty;

    const today = civilTodayStart(now);
    const [s, oldest] = await Promise.all([
      this.aggregate(scope, today),
      this.prisma.financialRecord.aggregate({
        where: { ...scope, status: { in: [FinancialStatus.PENDING, FinancialStatus.OVERDUE] } },
        _min: { dueDate: true },
      }),
    ]);
    return {
      openCents: s.pending + s.overdue,
      openCount: s.pendingCount + s.overdueCount,
      overdueCents: s.overdue,
      overdueCount: s.overdueCount,
      paidCents: s.paid,
      paidCount: s.paidCount,
      oldestOpenDueDate: oldest._min.dueDate?.toISOString() ?? null,
    };
  }

  /**
   * Escopo ÚNICO de "meu financeiro" (lista E resumo): organização + alunos do usuário (ele e
   * dependentes); `null` = sem vínculo. Com `studentId` (seletor de dependente do app) restringe a
   * UM aluno, conferido por resolveLink — sem vínculo/inexistente/outra organização => 404 igual.
   */
  private async mineWhere(
    organizationId: number,
    userId: number,
    studentId?: number,
  ): Promise<Prisma.FinancialRecordWhereInput | null> {
    if (studentId !== undefined) {
      await requireLinkedStudent(this.studentsService, organizationId, userId, studentId);
      return { organizationId, studentId };
    }
    const students = await this.studentsService.findMine(organizationId, userId);
    if (students.length === 0) return null;
    return { organizationId, studentId: { in: students.map((s) => s.id) } };
  }

  async findOne(organizationId: number, id: number) {
    return toFinanceRecordView(await this.findRaw(organizationId, id));
  }

  /** Linha crua (uso interno): 404 se não existir ou não for desta organização. */
  private async findRaw(organizationId: number, id: number) {
    const record = await this.prisma.financialRecord.findFirst({ where: { id, organizationId } });
    if (!record) {
      throw new NotFoundException('Registro financeiro não encontrado.');
    }
    return record;
  }

  async create(organizationId: number, dto: CreateFinanceRecordDto) {
    if (dto.studentId) {
      await this.assertStudentBelongsToOrganization(organizationId, dto.studentId);
    }
    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }

    const created = await this.prisma.financialRecord.create({
      data: {
        organizationId,
        studentId: dto.studentId,
        unitId: dto.unitId,
        description: dto.description,
        amountCents: dto.amountCents,
        type: dto.type,
        dueDate: new Date(dto.dueDate),
      },
    });
    return toFinanceRecordView(created);
  }

  async update(organizationId: number, id: number, dto: UpdateFinanceRecordDto) {
    const before = await this.findRaw(organizationId, id); // 404 se não existir ou não for desta organização
    const { expectedUpdatedAt, ...changes } = dto;

    // Formulário desatualizado (ex.: o lançamento foi pago por Pix depois de aberto): nada é gravado (achado A2).
    if (expectedUpdatedAt !== undefined && new Date(expectedUpdatedAt).getTime() !== before.updatedAt.getTime()) {
      throw recordChanged();
    }
    // Baixa do Pix automático só se desfaz pelo estorno (POST /finance/:id/refund): o PATCH não tira de PAID nem muda o
    // valor - senão o pagamento já aplicado (PaymentWebhookEvent PAID) nunca mais baixaria e o aluno pagaria duas vezes.
    if (
      before.status === FinancialStatus.PAID &&
      before.paidVia === PaidVia.PIX_AUTO &&
      ((changes.status !== undefined && changes.status !== FinancialStatus.PAID) ||
        (changes.amountCents !== undefined && changes.amountCents !== before.amountCents))
    ) {
      throw paymentError(
        409,
        PaymentErrorCode.RECORD_PAID_VIA_PIX,
        'Este lançamento foi pago por Pix. Para desfazer a baixa, use Estornar.',
      );
    }

    if (dto.studentId) {
      await this.assertStudentBelongsToOrganization(organizationId, dto.studentId);
    }
    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }

    // paidAt: string = data informada (pagamento retroativo); null = limpar. Sem paidAt no corpo:
    // status PAID usa o momento atual (conveniência); status PENDING/OVERDUE LIMPA paidAt (sair de
    // PAID não pode deixar uma data de pagamento órfã); sem status, não mexe.
    let paidAt: Date | null | undefined;
    if (dto.paidAt !== undefined) {
      paidAt = dto.paidAt === null ? null : new Date(dto.paidAt);
    } else if (dto.status === 'PAID' && before.status !== 'PAID') {
      // Só ao ENTRAR em PAID (reenviar status PAID de um lançamento já pago não troca a data da baixa).
      paidAt = new Date();
    } else if (dto.status === 'PENDING' || dto.status === 'OVERDUE') {
      paidAt = null;
    }

    // Sair de PAID (PENDING/OVERDUE) também limpa a forma de pagamento e o valor pago da baixa (E07), como o paidAt.
    const leavingPaid = dto.status === 'PENDING' || dto.status === 'OVERDUE';

    // Gravação CONDICIONADA ao que foi lido (updatedAt): uma baixa por Pix/estorno/edição concorrente entre a leitura e
    // a escrita => 409 RECORD_CHANGED em vez de sobrescrever.
    const result = await this.prisma.financialRecord.updateMany({
      where: { id, organizationId, updatedAt: before.updatedAt },
      data: {
        studentId: dto.studentId,
        unitId: dto.unitId,
        description: dto.description,
        amountCents: dto.amountCents,
        type: dto.type,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        status: dto.status,
        paidAt,
        ...(leavingPaid ? { paymentMethod: null, paidCents: null, paidVia: null } : {}),
        ...(dto.status === 'PAID' && before.status !== 'PAID' ? { paidVia: 'MANUAL' as const } : {}),
      },
    });
    if (result.count === 0) throw recordChanged();
    const updated = await this.findRaw(organizationId, id);
    await this.audit.record({
      organizationId,
      action: AuditAction.FINANCE_UPDATE,
      entity: AuditEntity.FINANCE,
      entityId: id,
      meta: {
        fields: Object.entries(changes)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => key),
        statusBefore: before.status,
        statusAfter: updated.status,
        amountBefore: before.amountCents,
        amountAfter: updated.amountCents,
      },
    });
    // O Pix aberto deixou de valer (saiu de aberto ou mudou o valor): cancela no provedor (best-effort - achado M3).
    const open = (s: FinancialStatus) => s === FinancialStatus.PENDING || s === FinancialStatus.OVERDUE;
    if (open(before.status) && (!open(updated.status) || updated.amountCents !== before.amountCents)) {
      await this.pixHooks.cancelOpenPix(before, updated.amountCents !== before.amountCents ? 'AMOUNT_CHANGED' : 'CANCEL');
    }
    return toFinanceRecordView(updated);
  }

  /**
   * Remoção de verdade (hard delete) — diferente do padrão soft-delete dos demais módulos
   * (aluno/turma/aula inativam para preservar histórico). Um lançamento financeiro incorreto
   * (ex.: valor digitado errado) deve poder ser apagado de verdade: não existe um conceito de
   * "registro financeiro inativo" com sentido de negócio aqui.
   */
  async remove(organizationId: number, id: number) {
    const record = await this.findRaw(organizationId, id);
    // Pix ainda pagável ou baixa por Pix: apagar deixaria um pagamento sem lançamento (achado M3). Cancele (o Pix aberto
    // é cancelado no provedor) ou estorne antes. Pix já vencido não bloqueia (não pode mais ser pago).
    const pixStillPayable =
      !!record.gatewayPaymentId &&
      PIX_OPEN_GATEWAY_STATUSES.includes(record.gatewayStatus ?? '') &&
      !!record.pixExpiresAt &&
      record.pixExpiresAt.getTime() > Date.now();
    if (pixStillPayable || (record.status === FinancialStatus.PAID && record.paidVia === PaidVia.PIX_AUTO)) {
      throw paymentError(
        409,
        PaymentErrorCode.RECORD_HAS_PIX,
        'Este lançamento tem um Pix em aberto ou foi pago por Pix. Cancele o lançamento (o Pix aberto é cancelado no Mercado Pago) ou estorne antes de excluir.',
      );
    }
    const deleted = await this.prisma.financialRecord.delete({ where: { id } });
    await this.audit.record({
      organizationId,
      action: AuditAction.FINANCE_DELETE,
      entity: AuditEntity.FINANCE,
      entityId: id,
      meta: { amountCents: record.amountCents, status: record.status, studentId: record.studentId },
    });
    return toFinanceRecordView(deleted);
  }

  /** Nunca confiar em studentId vindo do corpo da requisição sem confirmar que pertence à
   * organização do usuário autenticado (PLANO_PROJETO.md §3.2 item 4). */
  private async assertStudentBelongsToOrganization(organizationId: number, studentId: number): Promise<void> {
    const student = await this.prisma.student.findFirst({ where: { id: studentId, organizationId } });
    if (!student) {
      throw new BadRequestException('Aluno inválido para esta organização.');
    }
  }

  /** Idem para unitId. */
  private async assertUnitBelongsToOrganization(organizationId: number, unitId: number): Promise<void> {
    const unit = await this.prisma.unit.findFirst({ where: { id: unitId, organizationId } });
    if (!unit) {
      throw new BadRequestException('Unidade inválida para esta organização.');
    }
  }
}
