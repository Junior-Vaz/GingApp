import { z } from "zod";
import { dayOnly, fmt, startOfToday } from "@/lib/format";

export type FinanceStatus = "PENDING" | "PAID" | "OVERDUE" | "CANCELLED";

/** Contrato real de GET /finance (FinancialRecord do Prisma). */
export interface FinanceRecord {
  id: number;
  studentId: number | null;
  unitId: number | null;
  description: string;
  amountCents: number;
  type: string | null;
  dueDate: string;
  paidAt: string | null;
  status: FinanceStatus;
}

export interface StudentRef {
  id: number;
  name: string;
}

export const STATUS_LABEL: Record<FinanceStatus, string> = {
  PENDING: "Pendente",
  PAID: "Pago",
  OVERDUE: "Atrasado",
  CANCELLED: "Cancelado",
};

export const STATUS_BADGE_CLASS: Record<FinanceStatus, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  PAID: "bg-emerald-100 text-emerald-700",
  OVERDUE: "bg-red-100 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-600",
};

/** yyyy-MM-dd local de uma Date. */
export function toInputDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * O backend nunca promove PENDING para OVERDUE sozinho; a UI trata um lancamento pendente com
 * vencimento anterior a hoje como atrasado (ver lacunas no relatorio).
 */
export function effectiveStatus(record: FinanceRecord, today: Date = startOfToday()): FinanceStatus {
  if (record.status === "PENDING" && record.dueDate.slice(0, 10) < toInputDate(today)) return "OVERDUE";
  return record.status;
}

export interface FinanceTotals {
  paid: number;
  pending: number;
  overdue: number;
}

/** Totais em centavos (cancelados ficam de fora). */
export function computeTotals(records: FinanceRecord[], today: Date = startOfToday()): FinanceTotals {
  const totals: FinanceTotals = { paid: 0, pending: 0, overdue: 0 };
  for (const record of records) {
    const status = effectiveStatus(record, today);
    if (status === "PAID") totals.paid += record.amountCents;
    else if (status === "PENDING") totals.pending += record.amountCents;
    else if (status === "OVERDUE") totals.overdue += record.amountCents;
  }
  return totals;
}

export interface FinanceFilters {
  status: FinanceStatus | "ALL";
  /** yyyy-MM-dd (vencimento), inclusivo. */
  from: string;
  to: string;
}

export function applyFilters(
  records: FinanceRecord[],
  filters: FinanceFilters,
  today: Date = startOfToday(),
): FinanceRecord[] {
  return records.filter((record) => {
    const due = record.dueDate.slice(0, 10);
    if (filters.from && due < filters.from) return false;
    if (filters.to && due > filters.to) return false;
    if (filters.status !== "ALL" && effectiveStatus(record, today) !== filters.status) return false;
    return true;
  });
}

/** "12,50" / "12.50" / "1.234,56" -> centavos; NaN se invalido. */
export function parseReaisToCents(text: string): number {
  const raw = text.trim().replace(/^R\$\s*/, "");
  if (!raw) return NaN;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return NaN;
  return Math.round(Number(normalized) * 100);
}

export const centsToReais = (cents: number): string => (cents / 100).toFixed(2);

export function formatDueDate(iso: string | null): string {
  return iso ? fmt(dayOnly(iso), "dd/MM/yyyy") : "—";
}

export const financeSchema = z
  .object({
    description: z.string().trim().min(1, "Informe a descrição do lançamento."),
    studentId: z.string(),
    type: z.string(),
    amountReais: z.string(),
    dueDate: z.string().min(1, "Informe a data de vencimento."),
    status: z.enum(["PENDING", "PAID", "OVERDUE", "CANCELLED"]),
    paidAt: z.string(),
  })
  .superRefine((value, ctx) => {
    const cents = parseReaisToCents(value.amountReais);
    if (!Number.isFinite(cents) || cents < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amountReais"],
        message: "Informe um valor válido (maior que zero).",
      });
    }
  });

export type FinanceFormValues = z.infer<typeof financeSchema>;

export const emptyFinanceForm = (): FinanceFormValues => ({
  description: "",
  studentId: "",
  type: "",
  amountReais: "",
  dueDate: "",
  status: "PENDING",
  paidAt: "",
});

export function recordToForm(record: FinanceRecord): FinanceFormValues {
  return {
    description: record.description,
    studentId: record.studentId ? String(record.studentId) : "",
    type: record.type ?? "",
    amountReais: centsToReais(record.amountCents),
    dueDate: record.dueDate.slice(0, 10),
    status: record.status,
    paidAt: record.paidAt ? record.paidAt.slice(0, 10) : "",
  };
}

/** Corpo do POST /finance (CreateFinanceRecordDto: sem status/paidAt). */
export function toCreatePayload(values: FinanceFormValues) {
  return {
    description: values.description.trim(),
    amountCents: parseReaisToCents(values.amountReais),
    dueDate: values.dueDate,
    ...(values.studentId ? { studentId: Number(values.studentId) } : {}),
    ...(values.type.trim() ? { type: values.type.trim() } : {}),
  };
}

/** Corpo do PATCH /finance/:id (UpdateFinanceRecordDto: com status e paidAt quando PAID). */
export function toUpdatePayload(values: FinanceFormValues) {
  return {
    ...toCreatePayload(values),
    status: values.status,
    ...(values.status === "PAID" && values.paidAt ? { paidAt: values.paidAt } : {}),
  };
}
