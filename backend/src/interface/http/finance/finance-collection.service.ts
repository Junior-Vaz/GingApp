import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FinancialStatus, Prisma, StudentStatus } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { GenerateMonthlyDto } from './dto/generate-monthly.dto';
import { ListDelinquentsQueryDto } from './dto/list-delinquents-query.dto';
import { PayFinanceRecordDto } from './dto/pay-finance-record.dto';
import { UpsertStudentBillingDto } from './dto/student-billing.dto';
import { civilTodayStart, dayStart, effectiveOverdueClause } from './finance.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Tipo dos lançamentos gerados em lote (e que o gerador reconhece como "mensalidade" mesmo se criados à mão). */
export const MONTHLY_FEE_TYPE = 'MENSALIDADE';
/** Linhas por INSERT do gerador (limite de parâmetros do Postgres: 7 colunas x 1000 = 7000 binds). */
const GENERATE_CHUNK = 1000;
/** Teto de alunos devolvidos em `ignoredStudents` (o contador `ignored` é sempre o total real). */
const IGNORED_LIST_LIMIT = 200;

export interface StudentBillingDto {
  studentId: number;
  monthlyFeeCents: number | null;
  dueDay: number | null;
}

export interface GenerateMonthlyResult {
  month: string;
  /** Mensalidades criadas nesta chamada. */
  created: number;
  /** Alunos com valor definido que NÃO geraram lançamento (a competência já tinha o lançamento deles). */
  ignored: number;
  /** Alunos ACTIVE sem valor/dia de vencimento definidos (não entram na geração). */
  withoutFee: number;
  ignoredStudents: { studentId: number; name: string; reason: 'ALREADY_GENERATED' }[];
}

export interface DelinquentRow {
  studentId: number;
  studentName: string;
  /** Foto do aluno (avatar da lista) ou null. */
  studentPhoto: string | null;
  phone: string | null;
  email: string | null;
  unitId: number | null;
  guardians: { name: string; relationship: string | null; phone: string | null; email: string | null }[];
  /** Soma e quantidade dos lançamentos ATRASADOS (OVERDUE + PENDING vencido) sob os filtros. */
  overdueCents: number;
  overdueCount: number;
  /** Total em aberto do aluno (atrasado + a vencer), sem os filtros de data. */
  openCents: number;
  oldestDueDate: string;
  daysLate: number;
}

export interface DelinquentsSummary {
  students: number;
  overdueCents: number;
  overdueCount: number;
}

export interface ReceiptDto {
  number: string;
  organization: {
    name: string;
    document: string | null;
    email: string | null;
    phone: string | null;
    city: string | null;
    state: string | null;
    logo: string | null;
  };
  student: { id: number; name: string; document: string | null } | null;
  unit: { name: string } | null;
  description: string;
  type: string | null;
  competence: string | null;
  dueDate: Date;
  paidAt: Date;
  paymentMethod: string | null;
  amountCents: number;
  paidCents: number;
}

/**
 * Cobrança de mensalidade (E07): valor/dia de vencimento por aluno, geração mensal em lote, baixa,
 * estorno, cancelamento, inadimplentes e recibo. Tudo escopado por organizationId; valores em centavos
 * inteiros; datas civis (meia-noite UTC) com "hoje" em America/Sao_Paulo (civilTodayStart).
 */
@Injectable()
export class FinanceCollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Cobrança por aluno (StudentBilling)
  // ---------------------------------------------------------------------------------------------

  /** Cobranças dos alunos pedidos (só os que têm cobrança definida), sempre dentro da organização. */
  async listBilling(organizationId: number, studentIdsCsv: string): Promise<StudentBillingDto[]> {
    const ids = [...new Set(studentIdsCsv.split(',').map(Number))];
    if (ids.some((id) => !Number.isSafeInteger(id) || id < 1 || id > 2147483647)) {
      throw new BadRequestException('studentIds contém um id inválido.');
    }
    const rows = await this.prisma.studentBilling.findMany({
      where: { organizationId, studentId: { in: ids } },
      select: { studentId: true, monthlyFeeCents: true, dueDay: true },
      orderBy: { studentId: 'asc' },
    });
    return rows;
  }

  async getBilling(organizationId: number, studentId: number): Promise<StudentBillingDto> {
    await this.assertStudent(organizationId, studentId);
    const row = await this.prisma.studentBilling.findFirst({
      where: { organizationId, studentId },
      select: { studentId: true, monthlyFeeCents: true, dueDay: true },
    });
    return row ?? { studentId, monthlyFeeCents: null, dueDay: null };
  }

  /** Define (dois números) ou remove (dois null) a cobrança do aluno. Um número + um null => 400. */
  async setBilling(organizationId: number, studentId: number, dto: UpsertStudentBillingDto): Promise<StudentBillingDto> {
    await this.assertStudent(organizationId, studentId);
    const { monthlyFeeCents, dueDay } = dto;
    if (monthlyFeeCents === null && dueDay === null) {
      await this.prisma.studentBilling.deleteMany({ where: { organizationId, studentId } });
      return { studentId, monthlyFeeCents: null, dueDay: null };
    }
    if (monthlyFeeCents === null || dueDay === null) {
      throw new BadRequestException('Informe valor e dia de vencimento juntos (ou envie os dois como null para remover).');
    }
    await this.prisma.studentBilling.upsert({
      where: { studentId },
      create: { organizationId, studentId, monthlyFeeCents, dueDay },
      update: { monthlyFeeCents, dueDay },
    });
    return { studentId, monthlyFeeCents, dueDay };
  }

  // ---------------------------------------------------------------------------------------------
  // Geração mensal em lote
  // ---------------------------------------------------------------------------------------------

  /**
   * Gera as mensalidades da competência `dto.month` para os alunos ACTIVE com valor definido.
   * Idempotente: um aluno já tem a competência quando existe lançamento com `competence = month` (qualquer
   * status, inclusive CANCELLED — cancelado de propósito não renasce) OU um lançamento avulso do tipo
   * MENSALIDADE não cancelado com vencimento no mês. O unique (studentId, competence, type) + skipDuplicates
   * cobre chamadas concorrentes. Vencimento = dia do aluno, limitado ao último dia do mês (31 em fevereiro => 28/29).
   */
  async generateMonthly(organizationId: number, dto: GenerateMonthlyDto): Promise<GenerateMonthlyResult> {
    const [yearText, monthText] = dto.month.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    if (year < 2000 || year > 2100) {
      throw new BadRequestException('month deve estar entre 2000-01 e 2100-12.');
    }
    if (dto.unitId !== undefined) {
      const unit = await this.prisma.unit.findFirst({ where: { id: dto.unitId, organizationId } });
      if (!unit) throw new BadRequestException('Unidade inválida para esta organização.');
    }

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const nextMonthStart = new Date(Date.UTC(year, month, 1));
    const studentFilter: Prisma.StudentWhereInput = {
      status: StudentStatus.ACTIVE,
      ...(dto.unitId !== undefined ? { unitId: dto.unitId } : {}),
    };

    const [billings, withoutFee, existing] = await Promise.all([
      this.prisma.studentBilling.findMany({
        where: { organizationId, student: studentFilter },
        select: {
          studentId: true,
          monthlyFeeCents: true,
          dueDay: true,
          student: { select: { name: true, unitId: true } },
        },
        orderBy: { studentId: 'asc' },
      }),
      this.prisma.student.count({ where: { organizationId, ...studentFilter, billing: null } }),
      this.prisma.financialRecord.findMany({
        where: {
          organizationId,
          studentId: { not: null },
          OR: [
            { competence: dto.month },
            {
              type: { equals: MONTHLY_FEE_TYPE, mode: 'insensitive' },
              status: { not: FinancialStatus.CANCELLED },
              dueDate: { gte: monthStart, lt: nextMonthStart },
            },
          ],
        },
        select: { studentId: true },
      }),
    ]);

    const already = new Set(existing.map((r) => r.studentId));
    const todo = billings.filter((b) => !already.has(b.studentId));
    const ignoredStudents = billings
      .filter((b) => already.has(b.studentId))
      .slice(0, IGNORED_LIST_LIMIT)
      .map((b) => ({ studentId: b.studentId, name: b.student.name, reason: 'ALREADY_GENERATED' as const }));

    const label = `Mensalidade ${monthText}/${yearText}`;
    let created = 0;
    for (let i = 0; i < todo.length; i += GENERATE_CHUNK) {
      const chunk = todo.slice(i, i + GENERATE_CHUNK);
      const result = await this.prisma.financialRecord.createMany({
        data: chunk.map((b) => ({
          organizationId,
          studentId: b.studentId,
          unitId: b.student.unitId,
          description: label,
          amountCents: b.monthlyFeeCents,
          type: MONTHLY_FEE_TYPE,
          competence: dto.month,
          dueDate: new Date(Date.UTC(year, month - 1, Math.min(b.dueDay, daysInMonth))),
        })),
        skipDuplicates: true,
      });
      created += result.count;
    }

    await this.audit.record({
      organizationId,
      action: AuditAction.FINANCE_GENERATE_MONTHLY,
      entity: AuditEntity.FINANCE,
      entityId: dto.month,
      meta: { month: dto.month, created, ignored: billings.length - created, unitId: dto.unitId ?? null },
    });
    return {
      month: dto.month,
      created,
      ignored: billings.length - created,
      withoutFee,
      ignoredStudents,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Baixa, estorno e cancelamento
  // ---------------------------------------------------------------------------------------------

  /** Baixa: PENDING/OVERDUE -> PAID com data civil, forma de pagamento e valor pago. Já pago/cancelado => 409. */
  async pay(organizationId: number, id: number, dto: PayFinanceRecordDto, now: Date = new Date()) {
    const record = await this.findRecord(organizationId, id);
    if (record.status === FinancialStatus.PAID) throw new ConflictException('Este lançamento já está pago.');
    if (record.status === FinancialStatus.CANCELLED) throw new ConflictException('Lançamento cancelado não pode ser baixado.');

    const today = civilTodayStart(now);
    const paidAt = dto.paidAt ? dayStart(dto.paidAt) : today;
    if (Number.isNaN(paidAt.getTime())) throw new BadRequestException('paidAt inválido.');
    if (paidAt.getTime() > today.getTime()) throw new BadRequestException('A data do pagamento não pode ser futura.');

    const result = await this.prisma.financialRecord.updateMany({
      // O filtro de status no WHERE fecha a corrida (duas baixas simultâneas: só uma passa).
      where: { id, organizationId, status: { in: [FinancialStatus.PENDING, FinancialStatus.OVERDUE] } },
      data: {
        status: FinancialStatus.PAID,
        paidAt,
        paymentMethod: dto.paymentMethod,
        paidCents: dto.paidCents ?? record.amountCents,
      },
    });
    if (result.count === 0) throw new ConflictException('O lançamento mudou de situação; recarregue a lista.');
    await this.audit.record({
      organizationId,
      action: AuditAction.FINANCE_PAY,
      entity: AuditEntity.FINANCE,
      entityId: id,
      meta: {
        amountCents: record.amountCents,
        paidCents: dto.paidCents ?? record.amountCents,
        paymentMethod: dto.paymentMethod ?? null,
        studentId: record.studentId,
      },
    });
    return this.findRecord(organizationId, id);
  }

  /** Estorno: PAID -> PENDING, limpando data, forma e valor pago. Só lançamento pago pode ser estornado. */
  async refund(organizationId: number, id: number) {
    const record = await this.findRecord(organizationId, id);
    if (record.status !== FinancialStatus.PAID) throw new ConflictException('Só lançamentos pagos podem ser estornados.');
    const result = await this.prisma.financialRecord.updateMany({
      where: { id, organizationId, status: FinancialStatus.PAID },
      data: { status: FinancialStatus.PENDING, paidAt: null, paymentMethod: null, paidCents: null },
    });
    if (result.count === 0) throw new ConflictException('O lançamento mudou de situação; recarregue a lista.');
    await this.audit.record({
      organizationId,
      action: AuditAction.FINANCE_REFUND,
      entity: AuditEntity.FINANCE,
      entityId: id,
      meta: { paidCents: record.paidCents ?? record.amountCents, studentId: record.studentId },
    });
    return this.findRecord(organizationId, id);
  }

  /** Cancelamento: PENDING/OVERDUE -> CANCELLED. Pago exige estorno antes; já cancelado => 409. */
  async cancel(organizationId: number, id: number) {
    const record = await this.findRecord(organizationId, id);
    if (record.status === FinancialStatus.PAID) throw new ConflictException('Estorne o pagamento antes de cancelar o lançamento.');
    if (record.status === FinancialStatus.CANCELLED) throw new ConflictException('Este lançamento já está cancelado.');
    const result = await this.prisma.financialRecord.updateMany({
      where: { id, organizationId, status: { in: [FinancialStatus.PENDING, FinancialStatus.OVERDUE] } },
      data: { status: FinancialStatus.CANCELLED },
    });
    if (result.count === 0) throw new ConflictException('O lançamento mudou de situação; recarregue a lista.');
    await this.audit.record({
      organizationId,
      action: AuditAction.FINANCE_CANCEL,
      entity: AuditEntity.FINANCE,
      entityId: id,
      meta: { amountCents: record.amountCents, studentId: record.studentId, previousStatus: record.status },
    });
    return this.findRecord(organizationId, id);
  }

  // ---------------------------------------------------------------------------------------------
  // Inadimplentes
  // ---------------------------------------------------------------------------------------------

  private delinquentWhere(
    organizationId: number,
    query: ListDelinquentsQueryDto,
    today: Date,
  ): Prisma.FinancialRecordWhereInput {
    const student: Prisma.StudentWhereInput = {};
    if (query.unitId !== undefined) student.unitId = query.unitId;
    const q = query.q?.trim();
    if (q) student.name = { contains: q, mode: 'insensitive' };

    const and: Prisma.FinancialRecordWhereInput[] = [effectiveOverdueClause(today)];
    if (query.from) and.push({ dueDate: { gte: dayStart(query.from) } });
    if (query.to) and.push({ dueDate: { lt: new Date(dayStart(query.to).getTime() + DAY_MS) } });

    return {
      organizationId,
      studentId: query.studentId !== undefined ? query.studentId : { not: null },
      ...(Object.keys(student).length > 0 ? { student } : {}),
      AND: and,
    };
  }

  /**
   * Inadimplentes agrupados por aluno: lançamentos atrasados (OVERDUE gravado + PENDING vencido, a mesma
   * cláusula do financeiro) somados por aluno, do maior débito para o menor, com o contato do aluno e dos
   * responsáveis. Paginado (limit/offset; total de ALUNOS em X-Total-Count).
   */
  async listDelinquents(
    organizationId: number,
    query: ListDelinquentsQueryDto,
    now: Date = new Date(),
  ): Promise<Page<DelinquentRow>> {
    const today = civilTodayStart(now);
    const where = this.delinquentWhere(organizationId, query, today);

    const [allGroups, groups] = await Promise.all([
      this.prisma.financialRecord.groupBy({ by: ['studentId'], where }),
      this.prisma.financialRecord.groupBy({
        by: ['studentId'],
        where,
        _sum: { amountCents: true },
        _count: { _all: true },
        _min: { dueDate: true },
        orderBy: [{ _sum: { amountCents: 'desc' } }, { studentId: 'asc' }],
        ...pageArgs(query),
      }),
    ]);
    const total = allGroups.length;
    const ids = groups.map((g) => g.studentId).filter((id): id is number => id !== null);
    if (ids.length === 0) return { items: [], total };

    const [students, open] = await Promise.all([
      this.prisma.student.findMany({
        where: { organizationId, id: { in: ids } },
        select: {
          id: true,
          name: true,
          phone: true,
          photo: true,
          email: true,
          unitId: true,
          guardians: { select: { name: true, relationship: true, phone: true, email: true }, orderBy: { id: 'asc' } },
        },
      }),
      this.prisma.financialRecord.groupBy({
        by: ['studentId'],
        where: {
          organizationId,
          studentId: { in: ids },
          status: { in: [FinancialStatus.PENDING, FinancialStatus.OVERDUE] },
        },
        _sum: { amountCents: true },
      }),
    ]);
    const studentById = new Map(students.map((s) => [s.id, s]));
    const openById = new Map(open.map((o) => [o.studentId, o._sum.amountCents ?? 0]));

    const items: DelinquentRow[] = [];
    for (const g of groups) {
      const s = g.studentId === null ? undefined : studentById.get(g.studentId);
      const oldest = g._min.dueDate;
      if (!s || !oldest) continue;
      items.push({
        studentId: s.id,
        studentName: s.name,
        studentPhoto: s.photo,
        phone: s.phone,
        email: s.email,
        unitId: s.unitId,
        guardians: s.guardians,
        overdueCents: g._sum.amountCents ?? 0,
        overdueCount: g._count._all,
        openCents: openById.get(s.id) ?? 0,
        oldestDueDate: oldest.toISOString(),
        daysLate: Math.max(1, Math.round((today.getTime() - oldest.getTime()) / DAY_MS)),
      });
    }
    return { items, total };
  }

  async delinquentsSummary(organizationId: number, query: ListDelinquentsQueryDto, now: Date = new Date()): Promise<DelinquentsSummary> {
    const where = this.delinquentWhere(organizationId, query, civilTodayStart(now));
    const [students, totals] = await Promise.all([
      this.prisma.financialRecord.groupBy({ by: ['studentId'], where }),
      this.prisma.financialRecord.aggregate({ where, _sum: { amountCents: true }, _count: { _all: true } }),
    ]);
    return { students: students.length, overdueCents: totals._sum.amountCents ?? 0, overdueCount: totals._count._all };
  }

  // ---------------------------------------------------------------------------------------------
  // Recibo
  // ---------------------------------------------------------------------------------------------

  /** Dados do recibo de um lançamento PAGO (o painel imprime). Não pago => 409. */
  async receipt(organizationId: number, id: number): Promise<ReceiptDto> {
    const record = await this.prisma.financialRecord.findFirst({
      where: { id, organizationId },
      include: {
        student: { select: { id: true, name: true, document: true } },
        unit: { select: { name: true } },
        organization: {
          select: { name: true, document: true, email: true, phone: true, city: true, state: true, logo: true },
        },
      },
    });
    if (!record) throw new NotFoundException('Registro financeiro não encontrado.');
    if (record.status !== FinancialStatus.PAID || !record.paidAt) {
      throw new ConflictException('Só lançamentos pagos têm recibo.');
    }
    return {
      // Número estável e único (ano do pagamento + id do lançamento): não precisa de coluna nem de sequência.
      number: `${record.paidAt.getUTCFullYear()}-${String(record.id).padStart(6, '0')}`,
      organization: record.organization,
      student: record.student,
      unit: record.unit,
      description: record.description,
      type: record.type,
      competence: record.competence,
      dueDate: record.dueDate,
      paidAt: record.paidAt,
      paymentMethod: record.paymentMethod,
      amountCents: record.amountCents,
      paidCents: record.paidCents ?? record.amountCents,
    };
  }

  // ---------------------------------------------------------------------------------------------

  private async findRecord(organizationId: number, id: number) {
    const record = await this.prisma.financialRecord.findFirst({ where: { id, organizationId } });
    if (!record) throw new NotFoundException('Registro financeiro não encontrado.');
    return record;
  }

  private async assertStudent(organizationId: number, studentId: number): Promise<void> {
    const student = await this.prisma.student.findFirst({ where: { id: studentId, organizationId }, select: { id: true } });
    if (!student) throw new NotFoundException('Aluno não encontrado.');
  }
}
