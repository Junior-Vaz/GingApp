import { Injectable, NotFoundException } from '@nestjs/common';
import { LedgerCategory, LedgerEntry, LedgerEntryType, Prisma, TransparencyMonth } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { buildCsv, centsToReais, EXPORT_MAX_ROWS, fileDate } from '../../../shared/csv/csv';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { countActiveGroups, countActiveStudents } from '../platform-dashboard/platform-metrics';
// Mesmo formato de erro com `code` dos patrocinadores (SSOT do corpo { statusCode, error, code, field?, message }).
import { sponsorConflict as conflict, sponsorValidation as validation } from '../sponsors/sponsor-catalog.service';
import {
  CreateLedgerEntryDto,
  LedgerCsvQueryDto,
  ListLedgerEntriesQueryDto,
  PublishMonthDto,
  UpdateLedgerEntryDto,
  UpdateTransparencySettingsDto,
} from './dto/transparency.dto';
import {
  aggregateMonth,
  AmountRow,
  blankToNullText,
  CategoryAmount,
  categoryLabel,
  costPerActiveStudentCents,
  currentMonthSaoPaulo,
  goalCoveragePct,
  isMonthClosed,
  isMonthKey,
  isValidPair,
  monthLockKey,
  monthOf,
  monthWindow,
  occurredOnError,
  reserveCents,
  TRANSPARENCY_LIMITS,
  TransparencyErrorCode,
} from './transparency-rules';

/** Namespace do advisory lock por MES (par com monthLockKey): serializa publicar/despublicar x lancar/editar/excluir. */
export const TRANSPARENCY_MONTH_LOCK_NS = 7320;

/** Item de GET /platform-finance/entries (contrato 3). */
export interface LedgerEntryView {
  id: number;
  type: LedgerEntryType;
  category: LedgerCategory;
  categoryLabel: string;
  amountCents: number;
  occurredOn: string;
  month: string;
  description: string;
  /** Mes publicado (travado para editar/excluir). */
  locked: boolean;
  createdAt: Date;
}

/** Item de GET /platform-finance/months (contrato 3). */
export interface FinanceMonthView {
  month: string;
  published: boolean;
  publishedAt: Date | null;
  note: string | null;
  revenueCents: number;
  expenseCents: number;
  balanceCents: number;
  entries: number;
  expensesByCategory: CategoryAmount[];
  revenueByCategory: CategoryAmount[];
  /** So mes NAO publicado (ao vivo); publicado = null. */
  liveActiveStudents: number | null;
  liveActiveGroups: number | null;
  /** So mes publicado (retrato gravado na publicacao). */
  snapshot: { activeStudents: number; activeGroups: number; goalCents: number } | null;
}

export interface TransparencySettingsView {
  monthlyGoalCents: number;
  openingReserveCents: number;
  entityName: string | null;
  introText: string | null;
  surplusText: string | null;
  updatedAt: Date | null;
  updatedByUserId: number | null;
}

/** Mes do corpo PUBLICO (contrato 4). NUNCA description, ids de lancamento, autor, data do lancamento nem contagem. */
export interface PublicTransparencyMonth {
  month: string;
  publishedAt: string;
  note: string | null;
  revenueCents: number;
  expenseCents: number;
  balanceCents: number;
  revenueBySource: CategoryAmount[];
  expensesByCategory: CategoryAmount[];
  activeStudents: number;
  activeGroups: number;
  costPerActiveStudentCents: number | null;
  goalCents: number;
  goalCoveragePct: number | null;
}

export interface PublicTransparency {
  generatedAt: string;
  entityName: string | null;
  introText: string | null;
  surplusText: string | null;
  monthlyGoalCents: number;
  reserveCents: number;
  months: PublicTransparencyMonth[];
}

type Tx = Prisma.TransactionClient;

const DEFAULT_SETTINGS: TransparencySettingsView = {
  monthlyGoalCents: 0,
  openingReserveCents: 0,
  entityName: null,
  introText: null,
  surplusText: null,
  updatedAt: null,
  updatedByUserId: null,
};

const dayOf = (date: Date): string => date.toISOString().slice(0, 10);
const dayToDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/**
 * Transparencia da plataforma (docs/CONTRATO_TRANSPARENCIA.md): livro-caixa (super admin escreve; qualquer PLATFORM le),
 * publicacao mensal com RETRATO e congelamento, configuracao singleton e o corpo PUBLICO de GET /transparency.
 * Congelamento: toda escrita que toca um mes (lancar, editar, mover, excluir, publicar, despublicar) roda numa transacao sob
 * advisory lock do(s) mes(es) envolvido(s); a checagem "mes publicado?" e a escrita ficam atomicas (2 publicacoes
 * simultaneas = 1 vence, a outra recebe 409; um lancamento concorrente a publicacao entra antes dela ou recebe 409).
 */
@Injectable()
export class TransparencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------------------------------------------
  // Infra: lock por mes
  // -------------------------------------------------------------------------------------------------------------

  /** Transacao com advisory lock (exclusivo) dos meses informados, em ordem crescente (sem deadlock entre 2 meses). */
  private withMonthLocks<T>(months: string[], fn: (tx: Tx) => Promise<T>): Promise<T> {
    const keys = [...new Set(months)].sort().map(monthLockKey);
    return this.prisma.$transaction(async (tx) => {
      for (const key of keys) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TRANSPARENCY_MONTH_LOCK_NS}::int, ${key}::int)`;
      }
      return fn(tx);
    });
  }

  private async assertMonthOpen(tx: Tx, month: string): Promise<void> {
    const published = await tx.transparencyMonth.findUnique({ where: { month }, select: { month: true } });
    if (published) {
      throw conflict(
        TransparencyErrorCode.MONTH_PUBLISHED,
        `O mês ${month} já foi publicado e está travado. Despublique o mês para lançar, editar ou excluir.`,
      );
    }
  }

  private checkDay(day: string): void {
    const error = occurredOnError(day);
    if (error === 'VALIDATION') {
      throw validation('occurredOn', `occurredOn: data inválida (use AAAA-MM-DD, a partir de ${TRANSPARENCY_LIMITS.minDay}).`);
    }
    if (error === 'FUTURE_DATE') {
      throw validation('occurredOn', 'occurredOn: a data não pode passar do fim do mês corrente.', TransparencyErrorCode.FUTURE_DATE);
    }
  }

  private checkPair(type: LedgerEntryType, category: LedgerCategory): void {
    if (!isValidPair(type, category)) {
      throw validation(
        'category',
        `category: ${category} não é uma categoria de ${type === LedgerEntryType.RECEITA ? 'receita' : 'despesa'}.`,
        TransparencyErrorCode.INVALID_CATEGORY,
      );
    }
  }

  private normalizeDescription(raw: string): string {
    const text = raw.trim();
    if (text.length < 1 || text.length > TRANSPARENCY_LIMITS.descriptionMax) {
      throw validation('description', `description: informe de 1 a ${TRANSPARENCY_LIMITS.descriptionMax} caracteres.`);
    }
    return text;
  }

  private checkMonthParam(month: string): void {
    if (!isMonthKey(month)) throw validation('month', 'month: use AAAA-MM.');
  }

  private view(row: LedgerEntry, locked: boolean): LedgerEntryView {
    return {
      id: row.id,
      type: row.type,
      category: row.category,
      categoryLabel: categoryLabel(row.category),
      amountCents: row.amountCents,
      occurredOn: dayOf(row.occurredOn),
      month: row.month,
      description: row.description,
      locked,
      createdAt: row.createdAt,
    };
  }

  private async publishedSet(months: string[], db: Tx | PrismaService = this.prisma): Promise<Set<string>> {
    if (months.length === 0) return new Set();
    const rows = await db.transparencyMonth.findMany({ where: { month: { in: [...new Set(months)] } }, select: { month: true } });
    return new Set(rows.map((r) => r.month));
  }

  // -------------------------------------------------------------------------------------------------------------
  // Lancamentos
  // -------------------------------------------------------------------------------------------------------------

  private entriesWhere(query: { month?: string; type?: LedgerEntryType; category?: LedgerCategory; q?: string }): Prisma.LedgerEntryWhereInput {
    const q = query.q?.trim();
    return {
      ...(query.month ? { month: query.month } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(q ? { description: { contains: q, mode: 'insensitive' } } : {}),
    };
  }

  async listEntries(query: ListLedgerEntriesQueryDto): Promise<Page<LedgerEntryView>> {
    const where = this.entriesWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({ where, orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }], ...pageArgs(query) }),
      this.prisma.ledgerEntry.count({ where }),
    ]);
    const published = await this.publishedSet(rows.map((r) => r.month));
    return { items: rows.map((r) => this.view(r, published.has(r.month))), total };
  }

  async createEntry(dto: CreateLedgerEntryDto, userId: number): Promise<LedgerEntryView> {
    this.checkPair(dto.type, dto.category);
    this.checkDay(dto.occurredOn);
    const description = this.normalizeDescription(dto.description);
    const month = monthOf(dto.occurredOn);
    const row = await this.withMonthLocks([month], async (tx) => {
      await this.assertMonthOpen(tx, month);
      return tx.ledgerEntry.create({
        data: {
          type: dto.type,
          category: dto.category,
          amountCents: dto.amountCents,
          occurredOn: dayToDate(dto.occurredOn),
          month,
          description,
          createdByUserId: userId,
        },
      });
    });
    await this.audit.record({
      organizationId: null,
      action: AuditAction.PLATFORM_FINANCE_ENTRY_CREATE,
      entity: AuditEntity.LEDGER_ENTRY,
      entityId: row.id,
      meta: { month, type: row.type, category: row.category, amountCents: row.amountCents },
    });
    return this.view(row, false);
  }

  private async requireEntry(id: number, db: Tx | PrismaService = this.prisma): Promise<LedgerEntry> {
    const row = await db.ledgerEntry.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Lançamento não encontrado.');
    return row;
  }

  async updateEntry(id: number, dto: UpdateLedgerEntryDto): Promise<LedgerEntryView> {
    const before = await this.requireEntry(id);
    const type = dto.type ?? before.type;
    const category = dto.category ?? before.category;
    this.checkPair(type, category);
    if (dto.occurredOn !== undefined) this.checkDay(dto.occurredOn);
    const description = dto.description !== undefined ? this.normalizeDescription(dto.description) : undefined;
    const targetMonth = dto.occurredOn !== undefined ? monthOf(dto.occurredOn) : before.month;

    const { row, previous } = await this.withMonthLocks([before.month, targetMonth], async (tx) => {
      // Relido sob o lock: o mes de origem pode ter mudado (outra edicao) entre a leitura acima e o lock.
      const current = await this.requireEntry(id, tx);
      if (current.month !== before.month && current.month !== targetMonth) {
        throw conflict(TransparencyErrorCode.CONCURRENT_UPDATE,'O lançamento foi alterado por outra pessoa. Recarregue e tente de novo.');
      }
      await this.assertMonthOpen(tx, current.month);
      if (targetMonth !== current.month) await this.assertMonthOpen(tx, targetMonth);
      const updated = await tx.ledgerEntry.update({
        where: { id },
        data: {
          type,
          category,
          ...(dto.amountCents !== undefined ? { amountCents: dto.amountCents } : {}),
          ...(dto.occurredOn !== undefined ? { occurredOn: dayToDate(dto.occurredOn), month: targetMonth } : {}),
          ...(description !== undefined ? { description } : {}),
        },
      });
      return { row: updated, previous: current };
    });

    const fields = (['type', 'category', 'amountCents', 'occurredOn', 'description'] as const).filter((f) => {
      if (f === 'occurredOn') return dayOf(previous.occurredOn) !== dayOf(row.occurredOn);
      return previous[f] !== row[f];
    });
    await this.audit.record({
      organizationId: null,
      action: AuditAction.PLATFORM_FINANCE_ENTRY_UPDATE,
      entity: AuditEntity.LEDGER_ENTRY,
      entityId: id,
      meta: {
        month: row.month,
        ...(previous.month !== row.month ? { previousMonth: previous.month } : {}),
        type: row.type,
        category: row.category,
        amountCents: row.amountCents,
        ...(previous.amountCents !== row.amountCents ? { previousAmountCents: previous.amountCents } : {}),
        fields,
      },
    });
    return this.view(row, false);
  }

  async deleteEntry(id: number): Promise<void> {
    const before = await this.requireEntry(id);
    const removed = await this.withMonthLocks([before.month], async (tx) => {
      const current = await this.requireEntry(id, tx);
      if (current.month !== before.month) {
        throw conflict(TransparencyErrorCode.CONCURRENT_UPDATE,'O lançamento foi alterado por outra pessoa. Recarregue e tente de novo.');
      }
      await this.assertMonthOpen(tx, current.month);
      await tx.ledgerEntry.delete({ where: { id } });
      return current;
    });
    await this.audit.record({
      organizationId: null,
      action: AuditAction.PLATFORM_FINANCE_ENTRY_DELETE,
      entity: AuditEntity.LEDGER_ENTRY,
      entityId: id,
      meta: { month: removed.month, type: removed.type, category: removed.category, amountCents: removed.amountCents },
    });
  }

  /** CSV (UTF-8 com BOM, ';', anti formula-injection pelo csvCell do SSOT shared/csv). Ate EXPORT_MAX_ROWS linhas. */
  async entriesCsv(query: LedgerCsvQueryDto): Promise<{ filename: string; csv: string; total: number }> {
    const where = this.entriesWhere({ month: query.month });
    const [rows, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({ where, orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }], take: EXPORT_MAX_ROWS }),
      this.prisma.ledgerEntry.count({ where }),
    ]);
    const published = await this.publishedSet(rows.map((r) => r.month));
    const csv = buildCsv(
      ['Id', 'Data', 'Mês', 'Tipo', 'Categoria', 'Valor (R$)', 'Descrição', 'Mês publicado'],
      rows.map((r) => [
        r.id,
        dayOf(r.occurredOn),
        r.month,
        r.type === LedgerEntryType.RECEITA ? 'Receita' : 'Despesa',
        categoryLabel(r.category),
        centsToReais(r.amountCents),
        r.description,
        published.has(r.month),
      ]),
    );
    await this.audit.record({
      organizationId: null,
      action: AuditAction.PLATFORM_FINANCE_EXPORT,
      entity: AuditEntity.LEDGER_ENTRY,
      meta: { month: query.month ?? null, rows: rows.length, total },
    });
    return { filename: `financeiro-plataforma-${query.month ?? 'todos'}-${fileDate()}.csv`, csv, total };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Meses
  // -------------------------------------------------------------------------------------------------------------

  /** Somas por (mes, tipo, categoria) e contagem por mes, feitas NO BANCO. */
  private async monthAmounts(months: string[], db: Tx | PrismaService = this.prisma) {
    const amounts = new Map<string, AmountRow[]>();
    const counts = new Map<string, number>();
    if (months.length === 0) return { amounts, counts };
    const groups = await db.ledgerEntry.groupBy({
      by: ['month', 'type', 'category'],
      where: { month: { in: months } },
      _sum: { amountCents: true },
      _count: { _all: true },
    });
    for (const g of groups) {
      const list = amounts.get(g.month) ?? [];
      list.push({ type: g.type, category: g.category, cents: g._sum.amountCents ?? 0 });
      amounts.set(g.month, list);
      counts.set(g.month, (counts.get(g.month) ?? 0) + g._count._all);
    }
    return { amounts, counts };
  }

  private monthView(
    month: string,
    rows: AmountRow[],
    entries: number,
    published: TransparencyMonth | undefined,
    live: { students: number; groups: number } | null,
  ): FinanceMonthView {
    const totals = aggregateMonth(rows);
    return {
      month,
      published: published !== undefined,
      publishedAt: published?.publishedAt ?? null,
      note: published?.note ?? null,
      revenueCents: totals.revenueCents,
      expenseCents: totals.expenseCents,
      balanceCents: totals.balanceCents,
      entries,
      expensesByCategory: totals.expensesByCategory,
      revenueByCategory: totals.revenueByCategory,
      liveActiveStudents: published ? null : (live?.students ?? null),
      liveActiveGroups: published ? null : (live?.groups ?? null),
      snapshot: published
        ? { activeStudents: published.activeStudents, activeGroups: published.activeGroups, goalCents: published.goalCents }
        : null,
    };
  }

  /** Ultimos 24 meses (inclui o corrente) com lancamento OU publicados, mais o mes corrente, do mais recente ao mais antigo. */
  async listMonths(now: Date = new Date()): Promise<{ items: FinanceMonthView[] }> {
    const window = monthWindow(now);
    const current = window[0];
    const [{ amounts, counts }, published, students, groups] = await Promise.all([
      this.monthAmounts(window),
      this.prisma.transparencyMonth.findMany({ where: { month: { in: window } } }),
      countActiveStudents(this.prisma),
      countActiveGroups(this.prisma),
    ]);
    const publishedBy = new Map(published.map((p) => [p.month, p]));
    const months = window.filter((m) => m === current || counts.has(m) || publishedBy.has(m));
    const live = { students, groups };
    return {
      items: months.map((m) => this.monthView(m, amounts.get(m) ?? [], counts.get(m) ?? 0, publishedBy.get(m), live)),
    };
  }

  /**
   * Publica um mes ENCERRADO (anterior ao corrente em Sao Paulo) com pelo menos 1 lancamento: grava o retrato (alunos
   * ativos, grupos ativos, meta vigente) e congela o mes, tudo numa transacao sob o lock do mes.
   */
  async publish(month: string, dto: PublishMonthDto, userId: number, now: Date = new Date()): Promise<FinanceMonthView> {
    this.checkMonthParam(month);
    if (!isMonthClosed(month, now)) {
      throw validation(
        'month',
        `Só dá para publicar mês já encerrado (o mês corrente é ${currentMonthSaoPaulo(now)}).`,
        TransparencyErrorCode.MONTH_NOT_CLOSED,
      );
    }
    const note = blankToNullText(dto.note);
    if (note !== null && note.length > TRANSPARENCY_LIMITS.noteMax) {
      throw validation('note', `note: no máximo ${TRANSPARENCY_LIMITS.noteMax} caracteres.`);
    }
    let created: TransparencyMonth;
    let entries: number;
    try {
      ({ created, entries } = await this.withMonthLocks([month], async (tx) => {
        await this.assertMonthOpen(tx, month);
        const count = await tx.ledgerEntry.count({ where: { month } });
        if (count === 0) {
          throw validation('month', `O mês ${month} não tem nenhum lançamento.`, TransparencyErrorCode.MONTH_EMPTY);
        }
        const [activeStudents, activeGroups, setting] = await Promise.all([
          countActiveStudents(tx),
          countActiveGroups(tx),
          tx.transparencySetting.findUnique({ where: { id: 1 }, select: { monthlyGoalCents: true } }),
        ]);
        const row = await tx.transparencyMonth.create({
          data: {
            month,
            publishedByUserId: userId,
            note,
            activeStudents,
            activeGroups,
            goalCents: setting?.monthlyGoalCents ?? 0,
          },
        });
        return { created: row, entries: count };
      }));
    } catch (error) {
      // Defesa em profundidade (o lock ja serializa): a PK do mes barra a segunda publicacao.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict(TransparencyErrorCode.MONTH_PUBLISHED, `O mês ${month} já foi publicado.`);
      }
      throw error;
    }
    const { amounts } = await this.monthAmounts([month]);
    const view = this.monthView(month, amounts.get(month) ?? [], entries, created, null);
    await this.audit.record({
      organizationId: null,
      action: AuditAction.PLATFORM_FINANCE_MONTH_PUBLISH,
      entity: AuditEntity.TRANSPARENCY_MONTH,
      entityId: month,
      meta: {
        month,
        entries,
        revenueCents: view.revenueCents,
        expenseCents: view.expenseCents,
        activeStudents: created.activeStudents,
        activeGroups: created.activeGroups,
        goalCents: created.goalCents,
        hasNote: note !== null,
      },
    });
    return view;
  }

  /** Despublica (volta a editar). Mes nao publicado = 409 MONTH_NOT_PUBLISHED. */
  async unpublish(month: string): Promise<void> {
    this.checkMonthParam(month);
    const removed = await this.withMonthLocks([month], async (tx) => {
      const row = await tx.transparencyMonth.findUnique({ where: { month } });
      if (!row) throw conflict(TransparencyErrorCode.MONTH_NOT_PUBLISHED, `O mês ${month} não está publicado.`);
      await tx.transparencyMonth.delete({ where: { month } });
      return row;
    });
    await this.audit.record({
      organizationId: null,
      action: AuditAction.PLATFORM_FINANCE_MONTH_UNPUBLISH,
      entity: AuditEntity.TRANSPARENCY_MONTH,
      entityId: month,
      meta: { month, publishedAt: removed.publishedAt },
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Configuracoes
  // -------------------------------------------------------------------------------------------------------------

  async getSettings(): Promise<TransparencySettingsView> {
    const row = await this.prisma.transparencySetting.findUnique({ where: { id: 1 } });
    if (!row) return { ...DEFAULT_SETTINGS };
    return {
      monthlyGoalCents: row.monthlyGoalCents,
      openingReserveCents: row.openingReserveCents,
      entityName: row.entityName,
      introText: row.introText,
      surplusText: row.surplusText,
      updatedAt: row.updatedAt,
      updatedByUserId: row.updatedByUserId,
    };
  }

  /** Campo ausente = mantem; texto vazio = null. Mudar a meta NAO mexe nos meses publicados (retrato). */
  async updateSettings(dto: UpdateTransparencySettingsDto, userId: number): Promise<TransparencySettingsView> {
    const before = await this.getSettings();
    const texts = {
      entityName: dto.entityName === undefined ? before.entityName : blankToNullText(dto.entityName),
      introText: dto.introText === undefined ? before.introText : blankToNullText(dto.introText),
      surplusText: dto.surplusText === undefined ? before.surplusText : blankToNullText(dto.surplusText),
    };
    const next = {
      monthlyGoalCents: dto.monthlyGoalCents ?? before.monthlyGoalCents,
      openingReserveCents: dto.openingReserveCents ?? before.openingReserveCents,
      ...texts,
      updatedByUserId: userId,
    };
    await this.prisma.transparencySetting.upsert({ where: { id: 1 }, create: { id: 1, ...next }, update: next });
    const fields = (['monthlyGoalCents', 'openingReserveCents', 'entityName', 'introText', 'surplusText'] as const).filter(
      (f) => before[f] !== next[f],
    );
    await this.audit.record({
      organizationId: null,
      action: AuditAction.PLATFORM_FINANCE_SETTINGS_UPDATE,
      entity: AuditEntity.TRANSPARENCY_SETTING,
      entityId: 1,
      // So nomes de campos e os VALORES numericos; os textos ficam fora do log.
      meta: { fields, monthlyGoalCents: next.monthlyGoalCents, openingReserveCents: next.openingReserveCents },
    });
    return this.getSettings();
  }

  // -------------------------------------------------------------------------------------------------------------
  // Corpo publico (GET /transparency e GET /platform-finance/preview)
  // -------------------------------------------------------------------------------------------------------------

  /**
   * Ate 12 meses PUBLICADOS (mais recente primeiro) com os numeros do RETRATO; reserva = reserva inicial + saldo de TODOS
   * os meses publicados. Nada de lancamento individual: so somas por categoria feitas no banco.
   */
  async publicReport(now: Date = new Date()): Promise<PublicTransparency> {
    const [settings, published] = await Promise.all([
      this.getSettings(),
      this.prisma.transparencyMonth.findMany({ orderBy: { month: 'desc' } }),
    ]);
    const { amounts } = await this.monthAmounts(published.map((p) => p.month));
    const totalsBy = new Map(published.map((p) => [p.month, aggregateMonth(amounts.get(p.month) ?? [])]));
    const months = published.slice(0, TRANSPARENCY_LIMITS.publicMonths).map((p): PublicTransparencyMonth => {
      const t = totalsBy.get(p.month)!;
      return {
        month: p.month,
        publishedAt: p.publishedAt.toISOString(),
        note: p.note,
        revenueCents: t.revenueCents,
        expenseCents: t.expenseCents,
        balanceCents: t.balanceCents,
        revenueBySource: t.revenueByCategory,
        expensesByCategory: t.expensesByCategory,
        activeStudents: p.activeStudents,
        activeGroups: p.activeGroups,
        costPerActiveStudentCents: costPerActiveStudentCents(t.expenseCents, p.activeStudents),
        goalCents: p.goalCents,
        goalCoveragePct: goalCoveragePct(t.revenueCents, p.goalCents),
      };
    });
    return {
      generatedAt: now.toISOString(),
      entityName: settings.entityName,
      introText: settings.introText,
      surplusText: settings.surplusText,
      monthlyGoalCents: settings.monthlyGoalCents,
      reserveCents: reserveCents(
        settings.openingReserveCents,
        published.map((p) => totalsBy.get(p.month)!.balanceCents),
      ),
      months,
    };
  }
}
