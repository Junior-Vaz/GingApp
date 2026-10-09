import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FinancialStatus, Prisma } from '@prisma/client';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { CreateFinanceRecordDto } from './dto/create-finance-record.dto';
import { UpdateFinanceRecordDto } from './dto/update-finance-record.dto';
import { ListFinanceQueryDto } from './dto/list-finance-query.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** Início (UTC) do dia civil de um ISO/yyyy-MM-dd. */
function dayStart(iso: string): Date {
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
  ) {}

  /**
   * Where único de lista e resumo (total e totais sempre sob o mesmo filtro e sempre dentro da
   * organização). O filtro `status` é o EFETIVO: PENDING só com vencimento >= hoje; OVERDUE =
   * status OVERDUE gravado OU PENDING vencido (mesma regra do painel).
   */
  private buildWhere(
    organizationId: number,
    query: ListFinanceQueryDto,
    today: Date,
  ): Prisma.FinancialRecordWhereInput {
    const and: Prisma.FinancialRecordWhereInput[] = [];

    if (query.status === FinancialStatus.PENDING) {
      and.push({ status: FinancialStatus.PENDING, dueDate: { gte: today } });
    } else if (query.status === FinancialStatus.OVERDUE) {
      and.push({
        OR: [{ status: FinancialStatus.OVERDUE }, { status: FinancialStatus.PENDING, dueDate: { lt: today } }],
      });
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
      this.prisma.financialRecord.findMany({ where, orderBy: { id: 'desc' }, ...pageArgs(query) }),
      this.prisma.financialRecord.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Totais por AGREGAÇÃO no banco (nunca soma uma lista truncada), em centavos, sob os mesmos
   * filtros da lista. paid = PAID; overdue = OVERDUE gravado + PENDING com vencimento < hoje;
   * pending = PENDING com vencimento >= hoje; CANCELLED fica fora de todos os totais e de
   * `count` (count = paidCount + pendingCount + overdueCount).
   */
  async summary(organizationId: number, query: ListFinanceQueryDto, now: Date = new Date()): Promise<FinanceSummary> {
    const today = civilTodayStart(now);
    const where = this.buildWhere(organizationId, query, today);

    const [byStatus, pendingLate] = await Promise.all([
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
      paid: paid.cents,
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
   * registrada em §10.7: GET /finance é restrito a MESTRE/PROFESSOR porque não é filtrado;
   * esta rota é o jeito seguro de um ALUNO/RESPONSAVEL ver os próprios lançamentos.
   */
  async findMine(organizationId: number, userId: number) {
    const students = await this.studentsService.findMine(organizationId, userId);
    if (students.length === 0) return [];

    return this.prisma.financialRecord.findMany({
      where: { organizationId, studentId: { in: students.map((s) => s.id) } },
      orderBy: { dueDate: 'desc' },
      take: 50,
    });
  }

  async findOne(organizationId: number, id: number) {
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

    return this.prisma.financialRecord.create({
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
  }

  async update(organizationId: number, id: number, dto: UpdateFinanceRecordDto) {
    await this.findOne(organizationId, id); // 404 se não existir ou não for desta organização

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
    } else if (dto.status === 'PAID') {
      paidAt = new Date();
    } else if (dto.status === 'PENDING' || dto.status === 'OVERDUE') {
      paidAt = null;
    }

    return this.prisma.financialRecord.update({
      where: { id },
      data: {
        studentId: dto.studentId,
        unitId: dto.unitId,
        description: dto.description,
        amountCents: dto.amountCents,
        type: dto.type,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        status: dto.status,
        paidAt,
      },
    });
  }

  /**
   * Remoção de verdade (hard delete) — diferente do padrão soft-delete dos demais módulos
   * (aluno/turma/aula inativam para preservar histórico). Um lançamento financeiro incorreto
   * (ex.: valor digitado errado) deve poder ser apagado de verdade: não existe um conceito de
   * "registro financeiro inativo" com sentido de negócio aqui.
   */
  async remove(organizationId: number, id: number) {
    await this.findOne(organizationId, id);
    return this.prisma.financialRecord.delete({ where: { id } });
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
