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
 * Status EFETIVO por linha. Mesma regra do servidor (FinanceService.buildWhere/summary): o backend
 * nao promove PENDING para OVERDUE no banco, mas filtros e totais tratam PENDING com vencimento em
 * dia civil ANTERIOR a hoje como OVERDUE (vence hoje = ainda PENDING); PAID/CANCELLED nao mudam.
 * Unica diferenca: o servidor define "hoje" em America/Sao_Paulo; aqui e o dia local do navegador
 * (iguais para usuarios no fuso do produto; so divergem por horas perto da meia-noite em outro fuso).
 */
export function effectiveStatus(record: FinanceRecord, today: Date = startOfToday()): FinanceStatus {
  if (record.status === "PENDING" && record.dueDate.slice(0, 10) < toInputDate(today)) return "OVERDUE";
  return record.status;
}

/**
 * Resposta de GET /finance/summary (backend FinanceService.summary): totais em CENTAVOS agregados
 * no banco sob os mesmos filtros da lista (status/studentId/from/to/q; limit/offset ignorados).
 * CANCELLED fica fora de todos os totais e de `count`.
 */
export interface FinanceSummary {
  paid: number;
  pending: number;
  overdue: number;
  count: number;
  paidCount: number;
  pendingCount: number;
  overdueCount: number;
}

/** Filtros da lista (e do summary). Valor vazio = sem filtro (nao vai para a query string). */
export type FinanceFilters = {
  status: FinanceStatus | "";
  /** id do aluno ("" = todos). */
  studentId: string;
  /** yyyy-MM-dd (vencimento), inclusivo. */
  from: string;
  to: string;
};

export const emptyFinanceFilters = (): FinanceFilters => ({ status: "", studentId: "", from: "", to: "" });
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

/**
 * Corpo do PATCH /finance/:id (UpdateFinanceRecordDto). Campos LIMPAVEIS esvaziados vao como `null`
 * (backend grava NULL): type e studentId. `unitId` nao tem campo no formulario e nunca e enviado
 * (ausente = nao mexe). NAO limpaveis (nunca null): description, amountCents, dueDate, status.
 *
 * paidAt: so vai quando status = PAID e a data foi informada. Em branco com PAID o backend usa
 * agora; ao SAIR de PAID para PENDING/OVERDUE o backend LIMPA paidAt sozinho - por isso paidAt
 * NAO e enviado nesse caso (nem null). Para CANCELLED o backend nao mexe em paidAt.
 */
export function toUpdatePayload(values: FinanceFormValues) {
  return {
    description: values.description.trim(),
    amountCents: parseReaisToCents(values.amountReais),
    dueDate: values.dueDate,
    studentId: values.studentId ? Number(values.studentId) : null,
    type: values.type.trim() || null,
    status: values.status,
    ...(values.status === "PAID" && values.paidAt ? { paidAt: values.paidAt } : {}),
  };
}