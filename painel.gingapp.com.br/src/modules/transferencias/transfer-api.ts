import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, buildQuery } from "@/lib/api";

/** Estado do pedido de transferência (backend: TransferView.status). */
export type TransferStatus = "PENDING_PERSON" | "APPROVED" | "DECLINED" | "CANCELLED" | "EXPIRED" | "COMPLETED";
export type TransferDirection = "SENT" | "RECEIVED";
export type ContestReason = "PENDING_PAYMENT" | "EQUIPMENT" | "OTHER";

export interface TransferGroup {
  id: number;
  name: string;
  logoUrl: string | null;
}

/**
 * Link de aprovação para ADULTO sem login (POST /transfers e POST /transfers/:id/approval-link). O token só existe
 * nesta resposta (o servidor não o guarda em claro): o painel mostra/copia agora; depois só dá para gerar outro.
 */
export interface ApprovalLink {
  url: string;
  expiresAt: string;
  /** true = o servidor também enviou o link por e-mail. */
  emailed: boolean;
}

/** Contrato de GET /transfers e GET /transfers/:id (só MESTRE). */
export interface TransferView {
  id: number;
  status: TransferStatus;
  direction: TransferDirection;
  person: { id: number; name: string; nickname: string | null; photo: string | null; gingappCode: string };
  fromOrganization: TransferGroup;
  toOrganization: TransferGroup;
  toUnit: { id: number; name: string } | null;
  requestedAt: string;
  expiresAt: string;
  contestUntil: string;
  decidedAt: string | null;
  note: string | null;
  toStudentId: number | null;
  canContest: boolean;
  canCancel: boolean;
  /** Pedido PENDING_PERSON de adulto sem login: precisa de um link de aprovação (POST /transfers/:id/approval-link). */
  needsApprovalLink?: boolean | undefined;
  /** Só na resposta de criação/regeneração (POST); nunca vem em GET. */
  approvalLink?: ApprovalLink | null | undefined;
  contests: {
    id: number;
    reason: ContestReason;
    note: string | null;
    createdAt: string;
    organization: { id: number; name: string };
  }[];
}

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  PENDING_PERSON: "Aguardando a pessoa",
  APPROVED: "Aprovada",
  DECLINED: "Recusada",
  CANCELLED: "Cancelada",
  EXPIRED: "Expirada",
  COMPLETED: "Concluída",
};

export const CONTEST_REASON_LABEL: Record<ContestReason, string> = {
  PENDING_PAYMENT: "Pendência financeira",
  EQUIPMENT: "Material/equipamento",
  OTHER: "Outro",
};

export const TRANSFER_NOTE_MAX = 280;
export const CONTEST_NOTE_MAX = 200;

export const TRANSFERS_KEY = ["transfers"] as const;

/** GET /transfers?direction=sent|received. */
export function useTransfers(direction: "sent" | "received") {
  return useQuery({
    queryKey: [...TRANSFERS_KEY, direction],
    queryFn: () => api.get<TransferView[]>(`/transfers${buildQuery({ direction })}`),
  });
}

/** POST /transfers/:id/cancel (só o grupo que pediu, só PENDING_PERSON). */
export function useCancelTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<TransferView>(`/transfers/${id}/cancel`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: TRANSFERS_KEY }),
  });
}

/** POST /transfers/:id/approval-link (MESTRE do destino, sem corpo): gera link novo e invalida o anterior. */
export function useGenerateApprovalLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<ApprovalLink>(`/transfers/${id}/approval-link`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: TRANSFERS_KEY }),
  });
}

export interface ContestInput {
  reason: ContestReason;
  note?: string | undefined;
}

/** POST /transfers/:id/contest (grupo antigo, informativo: não bloqueia a transferência). */
export function useContestTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: ContestInput }) => api.post<unknown>(`/transfers/${id}/contest`, data),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: TRANSFERS_KEY }),
  });
}

export interface TransferRequestInput {
  personId: number;
  unitId?: number | undefined;
  note?: string | undefined;
  fromOrganizationId?: number | undefined;
}

/** POST /transfers. 201 = pedido novo; 200 = já havia um pedido pendente (idempotente): em ambos o painel trata como sucesso. */
export const requestTransfer = (input: TransferRequestInput) => api.post<TransferView>("/transfers", input);

/** Mensagens amigáveis por `code` dos erros de POST /transfers, /cancel e /contest. */
const TRANSFER_ERROR_MESSAGE: Record<string, string> = {
  TRANSFER_TARGET_REQUIRED: "Não foi possível identificar a pessoa para a transferência.",
  INVALID_CPF: "CPF inválido. Confira os números e tente de novo.",
  GINGAPP_CODE_NOT_FOUND: "Código GingApp não encontrado.",
  PERSON_NOT_FOUND: "Pessoa não encontrada.",
  PERSON_ALREADY_IN_GROUP: "Esta pessoa já está matriculada no seu grupo. Use o cadastro existente.",
  PERSON_NOT_ENROLLED_ELSEWHERE: "Esta pessoa não tem matrícula ativa em outro grupo, então não há o que transferir.",
  TRANSFER_NOT_PENDING: "Este pedido já não está aguardando a pessoa; atualize a lista.",
  APPROVAL_LINK_NOT_NEEDED:
    "Não é preciso link: esta pessoa já tem login ou é menor de idade (o responsável aprova pelo app).",
  TRANSFER_CONTEST_CLOSED: "O prazo para contestar esta transferência já terminou.",
};

export function transferErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return (error.code && TRANSFER_ERROR_MESSAGE[error.code]) || error.message || fallback;
  return fallback;
}

/** Grupos de origem listados por um 400 FROM_ORGANIZATION_REQUIRED (a pessoa está em mais de um grupo). */
export function originOrganizations(error: unknown): { id: number; name: string }[] | null {
  if (!(error instanceof ApiError) || error.status !== 400 || error.code !== "FROM_ORGANIZATION_REQUIRED") return null;
  const raw = error.body?.["organizations"];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === "object" && typeof (o as { id?: unknown }).id === "number")
    .map((o) => ({ id: o["id"] as number, name: String(o["name"] ?? `Grupo #${String(o["id"])}`) }));
}
