import { plural } from "@/lib/plural";
import { z } from "zod";
import {
  centsToReais,
  parseReaisToCents,
  toInputDate,
  type FinanceRecord,
  type PaymentMethod,
} from "./finance-utils";

/**
 * Cobrança de mensalidade (E07): tipos do contrato e regras de formulário. Todo valor trafega em
 * CENTAVOS inteiros; datas são dias civis (yyyy-MM-dd). O servidor continua sendo a validação de verdade.
 */

/** GET/PUT /finance/billing/:studentId. `null` nos dois = aluno sem cobrança mensal. */
export interface StudentBilling {
  studentId: number;
  monthlyFeeCents: number | null;
  dueDay: number | null;
}

/** Resposta de POST /finance/generate-monthly. */
export interface GenerateMonthlyResult {
  month: string;
  created: number;
  ignored: number;
  withoutFee: number;
  ignoredStudents: { studentId: number; name: string; reason: string }[];
}

/** Item de GET /finance/delinquents (um por aluno). */
export interface DelinquentRow {
  studentId: number;
  studentName: string;
  /** Foto do aluno (ainda não enviada pelo backend; aceita `studentPhoto` ou `photo`): cai nas iniciais. */
  studentPhoto?: string | null | undefined;
  photo?: string | null | undefined;
  phone: string | null;
  email: string | null;
  unitId: number | null;
  guardians: { name: string; relationship: string | null; phone: string | null; email: string | null }[];
  overdueCents: number;
  overdueCount: number;
  openCents: number;
  oldestDueDate: string;
  daysLate: number;
}

/** GET /finance/delinquents/summary. */
export interface DelinquentsSummary {
  students: number;
  overdueCents: number;
  overdueCount: number;
}

/** GET /finance/:id/receipt (só lançamento pago). */
export interface Receipt {
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
  dueDate: string;
  paidAt: string;
  paymentMethod: PaymentMethod | null;
  amountCents: number;
  paidCents: number;
}

/** Mês corrente em yyyy-MM (valor do <input type="month">). */
export function currentMonth(today: Date = new Date()): string {
  return toInputDate(today).slice(0, 7);
}

/** "2026-11" -> "11/2026". */
export function formatMonth(month: string): string {
  const [year, mm] = month.split("-");
  return `${mm}/${year}`;
}

/** Texto do toast após gerar o mês (criados / já existiam / alunos sem valor). */
export function generateSummaryText(result: GenerateMonthlyResult): string {
  const parts = [`${plural(result.created, "mensalidade criada", "mensalidades criadas")} para ${formatMonth(result.month)}`];
  if (result.ignored > 0) parts.push(`${result.ignored} ${result.ignored === 1 ? "já existia" : "já existiam"}`);
  if (result.withoutFee > 0) parts.push(`${plural(result.withoutFee, "aluno ativo", "alunos ativos")} sem valor definido`);
  return `${parts.join(" · ")}.`;
}

// ---------------------------------------------------------------------------------------------
// Baixa (dar baixa / marcar como pago)
// ---------------------------------------------------------------------------------------------

export const payFormSchema = z
  .object({
    paidAt: z.string().min(1, "Informe a data do pagamento."),
    paymentMethod: z.enum(["CASH", "PIX", "CARD", "TRANSFER", "OTHER"]),
    amountReais: z.string(),
  })
  .superRefine((value, ctx) => {
    const cents = parseReaisToCents(value.amountReais);
    if (!Number.isFinite(cents) || cents < 1 || cents > 2147483647) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amountReais"], message: "Informe um valor válido (maior que zero)." });
    }
    if (value.paidAt && value.paidAt > toInputDate(new Date())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["paidAt"], message: "A data do pagamento não pode ser futura." });
    }
  });
export type PayFormValues = z.infer<typeof payFormSchema>;

/** Padrões da baixa rápida: hoje, PIX e o valor do lançamento (o usuário só confirma). */
export function payDefaults(record: FinanceRecord, today: Date = new Date()): PayFormValues {
  return { paidAt: toInputDate(today), paymentMethod: "PIX", amountReais: centsToReais(record.amountCents) };
}

/** Corpo de POST /finance/:id/pay (PayFinanceRecordDto). */
export function toPayPayload(values: PayFormValues) {
  return {
    paymentMethod: values.paymentMethod,
    paidAt: values.paidAt,
    paidCents: parseReaisToCents(values.amountReais),
  };
}

// ---------------------------------------------------------------------------------------------
// Cobrança no cadastro do aluno (valor + dia de vencimento)
// ---------------------------------------------------------------------------------------------

/** Campos de cobrança do formulário do aluno ("" = sem cobrança). */
export interface BillingFields {
  monthlyFee: string;
  dueDay: string;
}

export const emptyBillingFields: BillingFields = { monthlyFee: "", dueDay: "" };

export function billingToFields(billing: StudentBilling | undefined | null): BillingFields {
  if (!billing || billing.monthlyFeeCents === null || billing.dueDay === null) return emptyBillingFields;
  return { monthlyFee: centsToReais(billing.monthlyFeeCents), dueDay: String(billing.dueDay) };
}

/** Mensagem de erro dos dois campos juntos (valor e dia andam juntos), ou null se válido. */
export function billingFieldsError(fields: BillingFields): { field: "monthlyFee" | "dueDay"; message: string } | null {
  const fee = fields.monthlyFee.trim();
  const day = fields.dueDay.trim();
  if (!fee && !day) return null;
  const cents = parseReaisToCents(fee);
  if (!fee || !Number.isFinite(cents) || cents < 1 || cents > 2147483647) {
    return { field: "monthlyFee", message: "Informe um valor válido (maior que zero) ou deixe os dois campos em branco." };
  }
  if (!/^\d{1,2}$/.test(day) || Number(day) < 1 || Number(day) > 31) {
    return { field: "dueDay", message: "Dia de vencimento entre 1 e 31." };
  }
  return null;
}

/** Corpo de PUT /finance/billing/:studentId: os dois números ou os dois null (remove). */
export function billingPayload(fields: BillingFields): { monthlyFeeCents: number | null; dueDay: number | null } {
  const fee = fields.monthlyFee.trim();
  const day = fields.dueDay.trim();
  if (!fee && !day) return { monthlyFeeCents: null, dueDay: null };
  return { monthlyFeeCents: parseReaisToCents(fee), dueDay: Number(day) };
}

/** Os campos mudaram em relação ao que está salvo? (evita um PUT desnecessário — e nunca apaga por engano.) */
export function billingChanged(fields: BillingFields, saved: StudentBilling | undefined | null): boolean {
  const next = billingPayload(fields);
  return next.monthlyFeeCents !== (saved?.monthlyFeeCents ?? null) || next.dueDay !== (saved?.dueDay ?? null);
}

/** "R$ 150,00 · dia 10" para a coluna de alunos. */
export function billingSummary(billing: StudentBilling | undefined, format: (cents: number) => string): string {
  if (!billing || billing.monthlyFeeCents === null || billing.dueDay === null) return "—";
  return `${format(billing.monthlyFeeCents)} · dia ${billing.dueDay}`;
}
