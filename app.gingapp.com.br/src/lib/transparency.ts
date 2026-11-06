import { api } from "@/lib/api";

/**
 * Transparência da plataforma (docs/CONTRATO_TRANSPARENCIA.md, seções 4 e 6): GET /transparency, público (sem login).
 * Só totais por categoria/mês; o app nunca recebe nem mostra descrição de lançamento. Sem nenhum pedido de pagamento.
 */

export interface TransparencyCategory {
  category: string;
  label: string;
  cents: number;
}

export interface TransparencyMonth {
  /** "YYYY-MM". */
  month: string;
  note: string | null;
  revenueCents: number;
  expenseCents: number;
  balanceCents: number;
  revenueBySource: TransparencyCategory[];
  expensesByCategory: TransparencyCategory[];
  activeStudents: number;
  activeGroups: number;
  /** null = mês sem alunos ativos (o servidor não divide por zero). */
  costPerActiveStudentCents: number | null;
  goalCents: number;
  /** Inteiro, PODE passar de 100. null = mês sem meta. */
  goalCoveragePct: number | null;
}

export interface TransparencyReport {
  generatedAt: string | null;
  entityName: string | null;
  introText: string | null;
  surplusText: string | null;
  monthlyGoalCents: number;
  /** Pode ser negativa. null = o servidor não informou. */
  reserveCents: number | null;
  /** Do mais recente para o mais antigo, no máximo 12. Vazio = nenhum mês publicado ainda. */
  months: TransparencyMonth[];
}

/** Quantos meses o histórico mostra (contrato, seção 4). */
export const TRANSPARENCY_MAX_MONTHS = 12;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Centavos: só inteiro seguro (nada de float, NaN, string ou Infinity). */
const asCents = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;

const asNonNegativeCents = (value: unknown): number | null => {
  const cents = asCents(value);
  return cents !== null && cents >= 0 ? cents : null;
};

/** Texto público opcional: string não vazia (após aparar) ou null. */
const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text;
};

function parseCategories(value: unknown): TransparencyCategory[] {
  if (!Array.isArray(value)) return [];
  const list: TransparencyCategory[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const category = asText(raw["category"]);
    const cents = asCents(raw["cents"]);
    if (category === null || cents === null || cents <= 0) continue;
    list.push({ category, label: asText(raw["label"]) ?? category, cents });
  }
  // O servidor já manda por valor desc; reordena por garantia (estável para empates).
  return list.sort((a, b) => b.cents - a.cents);
}

function parseMonth(raw: unknown): TransparencyMonth | null {
  if (!isRecord(raw)) return null;
  const month = typeof raw["month"] === "string" ? raw["month"] : "";
  if (!MONTH_RE.test(month)) return null;
  const revenueCents = asNonNegativeCents(raw["revenueCents"]);
  const expenseCents = asNonNegativeCents(raw["expenseCents"]);
  if (revenueCents === null || expenseCents === null) return null;
  const activeStudents = asNonNegativeCents(raw["activeStudents"]) ?? 0;
  const goalCents = asNonNegativeCents(raw["goalCents"]) ?? 0;
  const cost = asNonNegativeCents(raw["costPerActiveStudentCents"]);
  const coverage = raw["goalCoveragePct"];
  return {
    month,
    note: asText(raw["note"]),
    revenueCents,
    expenseCents,
    // O saldo é sempre receita - despesa: se o servidor mandar outro valor, vale a conta (nunca mostra número incoerente).
    balanceCents: revenueCents - expenseCents,
    revenueBySource: parseCategories(raw["revenueBySource"]),
    expensesByCategory: parseCategories(raw["expensesByCategory"]),
    activeStudents,
    activeGroups: asNonNegativeCents(raw["activeGroups"]) ?? 0,
    costPerActiveStudentCents: activeStudents > 0 ? cost : null,
    goalCents,
    goalCoveragePct:
      goalCents > 0 && typeof coverage === "number" && Number.isFinite(coverage) && coverage >= 0
        ? Math.round(coverage)
        : null,
  };
}

/**
 * Valida a resposta de GET /transparency. Aceita a resposta real sem adaptação e descarta lixo: mês com formato inválido
 * ou valores que não são centavos inteiros sai da lista, categoria sem valor > 0 sai, repetidos viram um só. Devolve
 * null só quando o corpo nem é um objeto (a tela mostra o erro com "tentar de novo").
 */
export function parseTransparency(raw: unknown): TransparencyReport | null {
  if (!isRecord(raw)) return null;
  const seen = new Set<string>();
  const months: TransparencyMonth[] = [];
  for (const item of Array.isArray(raw["months"]) ? raw["months"] : []) {
    const month = parseMonth(item);
    if (!month || seen.has(month.month)) continue;
    seen.add(month.month);
    months.push(month);
  }
  // "YYYY-MM" ordena como texto: do mais recente para o mais antigo.
  months.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
  return {
    generatedAt: asText(raw["generatedAt"]),
    entityName: asText(raw["entityName"]),
    introText: asText(raw["introText"]),
    surplusText: asText(raw["surplusText"]),
    monthlyGoalCents: asNonNegativeCents(raw["monthlyGoalCents"]) ?? 0,
    reserveCents: asCents(raw["reserveCents"]),
    months: months.slice(0, TRANSPARENCY_MAX_MONTHS),
  };
}

/** GET /transparency sem token (rota anônima). Corpo fora do contrato = erro (a tela oferece "tentar de novo"). */
export async function fetchTransparency(): Promise<TransparencyReport> {
  const raw = await api.get<unknown>("/transparency", { anonymous: true, skipAuthRedirect: true });
  const report = parseTransparency(raw);
  if (!report) throw new Error("Resposta inesperada de /transparency");
  return report;
}

/* ------------------------------------------ formatação ------------------------------------------ */

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Centavos inteiros -> "R$ 1.234,56" (negativo: "-R$ 1,00"). */
export const formatBRL = (cents: number): string => brl.format(cents / 100);

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "2026-10" -> "outubro de 2026". Cálculo puro (sem `new Date`): o fuso do aparelho não muda o mês. Fora do formato: devolve o texto como veio. */
export function monthLabel(month: string): string {
  const match = MONTH_RE.exec(month);
  if (!match) return month;
  return `${MONTH_NAMES[Number(match[2]) - 1]} de ${match[1]}`;
}

/** "2026-10" -> "out/2026" (histórico compacto). */
export function monthShortLabel(month: string): string {
  const match = MONTH_RE.exec(month);
  if (!match) return month;
  return `${MONTH_NAMES[Number(match[2]) - 1]!.slice(0, 3)}/${match[1]}`;
}

/** Inteiro com separador de milhar pt-BR ("1.200"). */
export const formatInt = (value: number): string => new Intl.NumberFormat("pt-BR").format(value);

/* ------------------------------------------ percentuais ------------------------------------------ */

/** Largura (0..100) da barra: percentual acima de 100 mostra a barra cheia; negativo/inválido = 0. O número real é mostrado à parte. */
export function barFillPct(pct: number | null): number {
  if (pct === null || !Number.isFinite(pct) || pct <= 0) return 0;
  return Math.min(100, pct);
}

/** Participação de `cents` no `total`, em inteiro (0 se o total não for positivo). Só para a leitura da lista, nunca para dinheiro. */
export function sharePct(cents: number, total: number): number {
  if (!(total > 0) || !(cents > 0)) return 0;
  return Math.round((cents * 100) / total);
}

/** Texto equivalente da barra "% da meta coberta" (leitor de tela e legenda). */
export function coverageSentence(pct: number | null, goalCents: number): string {
  if (pct === null) return "Este mês não teve meta definida.";
  const goal = formatBRL(goalCents);
  if (pct > 100) return `A receita foi de ${pct}% da meta de ${goal}: passou da meta.`;
  if (pct === 100) return `A receita cobriu 100% da meta de ${goal}.`;
  return `A receita cobriu ${pct}% da meta de ${goal}.`;
}
