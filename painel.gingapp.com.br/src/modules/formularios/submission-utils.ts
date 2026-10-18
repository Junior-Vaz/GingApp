import { fmt, toDate } from "@/lib/format";
import type {
  SubmissionAction,
  SubmissionAnswer,
  SubmissionDetail,
  SubmissionListItem,
} from "./types";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** O servidor guarda o telefone só com dígitos ("62999991001"); na tela vira "(62) 99999-1001". Outro formato passa direto. */
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return value;
}

/** Valor de uma resposta como texto legível ("—" quando vazio). Arquivos são tratados à parte pela tela. */
export function formatAnswer(answer: Pick<SubmissionAnswer, "type" | "value">): string {
  const { type, value } = answer;
  if (value === null || value === undefined || value === "") return "—";
  if (type === "PHONE" && typeof value === "string") return formatPhone(value);
  if (type === "CONSENT") return value === true || value === "true" ? "Aceito" : "Não aceito";
  if (Array.isArray(value)) {
    // FILE: o servidor manda `[{ fileId, originalName, mimeType }]`; MULTI_CHOICE: `["Angola", …]`.
    const texts = value.map((entry) =>
      entry !== null && typeof entry === "object"
        ? String((entry as { originalName?: unknown }).originalName ?? "Arquivo")
        : String(entry),
    );
    return texts.length > 0 ? texts.join(", ") : "—";
  }
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (type === "DATE" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [year, month, day] = value.slice(0, 10).split("-");
    return `${day ?? ""}/${month ?? ""}/${year ?? ""}`;
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export const formatDateTime = (iso: string): string => fmt(toDate(iso), "dd/MM/yyyy HH:mm");

export interface ActionSpec {
  action: SubmissionAction;
  label: string;
  /** Pede confirmação (destrói ou é difícil de desfazer). */
  confirm?: "reject" | "cancel";
  variant?: "default" | "outline" | "destructive";
}

/** Ações que fazem sentido para o estado atual da inscrição (a ordem é a do botão principal para o secundário). */
export function availableActions(
  s: Pick<SubmissionDetail | SubmissionListItem, "status" | "paymentStatus">,
): ActionSpec[] {
  const out: ActionSpec[] = [];
  if (
    s.paymentStatus === "PENDING" &&
    (s.status === "PENDING" || s.status === "WAITLIST" || s.status === "CONFIRMED")
  ) {
    out.push({ action: "confirm-payment", label: "Confirmar pagamento" });
  }
  if (s.status === "PENDING") {
    out.push(
      { action: "approve", label: "Aprovar", variant: out.length ? "outline" : "default" },
      { action: "waitlist", label: "Lista de espera", variant: "outline" },
      { action: "reject", label: "Recusar", confirm: "reject", variant: "outline" },
    );
  }
  if (s.status === "WAITLIST") {
    out.push(
      { action: "promote", label: "Promover", variant: out.length ? "outline" : "default" },
      { action: "reject", label: "Recusar", confirm: "reject", variant: "outline" },
    );
  }
  if (s.status === "PENDING" || s.status === "CONFIRMED" || s.status === "WAITLIST") {
    out.push({
      action: "cancel",
      label: "Cancelar inscrição",
      confirm: "cancel",
      variant: "destructive",
    });
  }
  return out;
}
