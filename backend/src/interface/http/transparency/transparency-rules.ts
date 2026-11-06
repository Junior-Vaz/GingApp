import { LedgerCategory, LedgerEntryType } from '@prisma/client';
import { fileDate } from '../../../shared/csv/csv';
import { isIsoDay } from '../sponsors/sponsor-rules';

/**
 * Regras PURAS da transparencia da plataforma (docs/CONTRATO_TRANSPARENCIA.md). Sem banco, sem relogio implicito (o `now`
 * e sempre parametro com padrao): testadas em test/transparency.spec.ts. Valores SEMPRE em centavos inteiros; os
 * percentuais sao calculados com inteiros.
 */

/** Limites do contrato (secoes 2 e 3). */
export const TRANSPARENCY_LIMITS = {
  amountMin: 1,
  amountMax: 1_000_000_000,
  descriptionMax: 300,
  noteMax: 500,
  entityNameMax: 120,
  introTextMax: 600,
  surplusTextMax: 600,
  settingCentsMax: 1_000_000_000,
  /** Meses publicos devolvidos em GET /transparency. */
  publicMonths: 12,
  /** Janela de GET /platform-finance/months (inclui o mes corrente). */
  adminMonthsWindow: 24,
  /** Primeiro dia aceito em occurredOn (sanidade: nada antes de 2000). */
  minDay: '2000-01-01',
} as const;

/** Codigos de erro (campo `code` do corpo). */
export const TransparencyErrorCode = {
  VALIDATION: 'VALIDATION',
  INVALID_CATEGORY: 'INVALID_CATEGORY',
  FUTURE_DATE: 'FUTURE_DATE',
  MONTH_PUBLISHED: 'MONTH_PUBLISHED',
  MONTH_NOT_CLOSED: 'MONTH_NOT_CLOSED',
  MONTH_EMPTY: 'MONTH_EMPTY',
  MONTH_NOT_PUBLISHED: 'MONTH_NOT_PUBLISHED',
  /** O lancamento mudou de mes entre a leitura e o lock (edicao concorrente). */
  CONCURRENT_UPDATE: 'CONCURRENT_UPDATE',
} as const;

/** SSOT das categorias: tipo a que pertencem e rotulo em portugues (vai na resposta: `{ category, label, cents }`). */
export const LEDGER_CATEGORIES: Readonly<Record<LedgerCategory, { type: LedgerEntryType; label: string }>> = {
  HOSPEDAGEM: { type: LedgerEntryType.DESPESA, label: 'Hospedagem e servidores' },
  MAPAS: { type: LedgerEntryType.DESPESA, label: 'Mapas' },
  ARMAZENAMENTO_BACKUP: { type: LedgerEntryType.DESPESA, label: 'Armazenamento e backup' },
  NOTIFICACOES: { type: LedgerEntryType.DESPESA, label: 'Notificações' },
  EMAIL: { type: LedgerEntryType.DESPESA, label: 'E-mail' },
  DOMINIO: { type: LedgerEntryType.DESPESA, label: 'Domínio' },
  FERRAMENTAS: { type: LedgerEntryType.DESPESA, label: 'Ferramentas' },
  PESSOAS_SUPORTE: { type: LedgerEntryType.DESPESA, label: 'Pessoas e suporte' },
  IMPOSTOS_TARIFAS: { type: LedgerEntryType.DESPESA, label: 'Impostos e tarifas' },
  OUTROS_DESPESA: { type: LedgerEntryType.DESPESA, label: 'Outras despesas' },
  APOIO: { type: LedgerEntryType.RECEITA, label: 'Apoio de usuários' },
  PATROCINIO: { type: LedgerEntryType.RECEITA, label: 'Patrocínios' },
  EDITAIS_OUTROS: { type: LedgerEntryType.RECEITA, label: 'Editais e outras receitas' },
};

export const LEDGER_TYPES: readonly LedgerEntryType[] = [LedgerEntryType.RECEITA, LedgerEntryType.DESPESA];

export function isLedgerCategory(value: unknown): value is LedgerCategory {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LEDGER_CATEGORIES, value);
}

export function isLedgerType(value: unknown): value is LedgerEntryType {
  return value === LedgerEntryType.RECEITA || value === LedgerEntryType.DESPESA;
}

/** O par tipo x categoria e valido? (DESPESA so com categorias de despesa; RECEITA so com as de receita.) */
export function isValidPair(type: unknown, category: unknown): boolean {
  return isLedgerType(type) && isLedgerCategory(category) && LEDGER_CATEGORIES[category].type === type;
}

export function categoryLabel(category: LedgerCategory): string {
  return LEDGER_CATEGORIES[category].label;
}

/** Centavos validos: inteiro (nunca float) entre 1 e 1_000_000_000. */
export function isValidAmountCents(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= TRANSPARENCY_LIMITS.amountMin &&
    value <= TRANSPARENCY_LIMITS.amountMax
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Meses (sempre 'YYYY-MM'; o "mes corrente" e o de America/Sao_Paulo)
// ---------------------------------------------------------------------------------------------------------------

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_RE.test(value);
}

/** 'YYYY-MM' de uma data civil 'YYYY-MM-DD' (o servidor deriva o mes; o cliente nunca o informa). */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** Mes corrente em America/Sao_Paulo (SSOT do dia de SP: fileDate de shared/csv). */
export function currentMonthSaoPaulo(now: Date = new Date()): string {
  return monthOf(fileDate(now));
}

/** 'YYYY-MM' deslocado de `delta` meses (aritmetica inteira, sem Date/fuso). */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  const mon = index - year * 12 + 1;
  return `${String(year).padStart(4, '0')}-${String(mon).padStart(2, '0')}`;
}

/** Mes ja encerrado = estritamente anterior ao mes corrente de Sao Paulo (comparacao lexicografica de 'YYYY-MM'). */
export function isMonthClosed(month: string, now: Date = new Date()): boolean {
  return month < currentMonthSaoPaulo(now);
}

/** Os `count` meses que terminam no mes corrente (inclusive), do mais recente para o mais antigo. */
export function monthWindow(now: Date = new Date(), count: number = TRANSPARENCY_LIMITS.adminMonthsWindow): string[] {
  const current = currentMonthSaoPaulo(now);
  return Array.from({ length: count }, (_v, i) => addMonths(current, -i));
}

/**
 * occurredOn valido: dia civil real 'YYYY-MM-DD', a partir de 2000-01-01 e nao alem do FIM do mes corrente (SP).
 * Devolve o codigo do erro ou null.
 */
export function occurredOnError(day: unknown, now: Date = new Date()): null | 'VALIDATION' | 'FUTURE_DATE' {
  if (!isIsoDay(day) || day < TRANSPARENCY_LIMITS.minDay) return 'VALIDATION';
  if (monthOf(day) > currentMonthSaoPaulo(now)) return 'FUTURE_DATE';
  return null;
}

/** Chave inteira do advisory lock por mes (namespace TRANSPARENCY_MONTH_LOCK_NS): 2026-10 => 202610. */
export function monthLockKey(month: string): number {
  return Number(month.slice(0, 4)) * 100 + Number(month.slice(5, 7));
}

// ---------------------------------------------------------------------------------------------------------------
// Numeros publicos (contrato secao 4)
// ---------------------------------------------------------------------------------------------------------------

/** Divisao inteira arredondada (meio para cima) de inteiros nao negativos. */
function roundDiv(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** round(expenseCents / activeStudents); null se nao ha alunos ativos. */
export function costPerActiveStudentCents(expenseCents: number, activeStudents: number): number | null {
  if (!Number.isFinite(activeStudents) || activeStudents <= 0) return null;
  return roundDiv(expenseCents, activeStudents);
}

/** round(revenueCents * 100 / goalCents), inteiro (pode passar de 100); null se a meta e 0. */
export function goalCoveragePct(revenueCents: number, goalCents: number): number | null {
  if (!Number.isFinite(goalCents) || goalCents <= 0) return null;
  return roundDiv(revenueCents * 100, goalCents);
}

export interface CategoryAmount {
  category: LedgerCategory;
  label: string;
  cents: number;
}

export interface MonthTotals {
  revenueCents: number;
  expenseCents: number;
  balanceCents: number;
  /** Ordenadas por valor desc (empate: ordem do catalogo), so categorias com valor > 0. */
  revenueByCategory: CategoryAmount[];
  expensesByCategory: CategoryAmount[];
}

/** Uma linha agregada (por mes/tipo/categoria) ou um lancamento: so o que a agregacao precisa. */
export interface AmountRow {
  type: LedgerEntryType;
  category: LedgerCategory;
  cents: number;
}

const CATALOG_ORDER = Object.keys(LEDGER_CATEGORIES) as LedgerCategory[];

function sortedAmounts(map: Map<LedgerCategory, number>): CategoryAmount[] {
  return [...map.entries()]
    .filter(([, cents]) => cents > 0)
    .sort((a, b) => b[1] - a[1] || CATALOG_ORDER.indexOf(a[0]) - CATALOG_ORDER.indexOf(b[0]))
    .map(([category, cents]) => ({ category, label: categoryLabel(category), cents }));
}

/** Totais de um mes a partir das linhas (lancamentos ou somas por categoria). */
export function aggregateMonth(rows: readonly AmountRow[]): MonthTotals {
  const revenue = new Map<LedgerCategory, number>();
  const expense = new Map<LedgerCategory, number>();
  let revenueCents = 0;
  let expenseCents = 0;
  for (const row of rows) {
    if (row.type === LedgerEntryType.RECEITA) {
      revenueCents += row.cents;
      revenue.set(row.category, (revenue.get(row.category) ?? 0) + row.cents);
    } else {
      expenseCents += row.cents;
      expense.set(row.category, (expense.get(row.category) ?? 0) + row.cents);
    }
  }
  return {
    revenueCents,
    expenseCents,
    balanceCents: revenueCents - expenseCents,
    revenueByCategory: sortedAmounts(revenue),
    expensesByCategory: sortedAmounts(expense),
  };
}

/** Reserva = reserva inicial + soma dos saldos de TODOS os meses publicados (pode ficar negativa). */
export function reserveCents(openingReserveCents: number, publishedBalances: readonly number[]): number {
  return publishedBalances.reduce((sum, balance) => sum + balance, openingReserveCents);
}

/** Texto opcional normalizado: trim; vazio = null. */
export function blankToNullText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
