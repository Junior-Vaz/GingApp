import { api, ApiError } from "@/lib/api";
import { validateResetPassword } from "@/lib/password-reset";
import type { TransferShared } from "@/lib/queries";

/** GET /public/transfer-approval/:token (público, sem login). */
export interface TransferApprovalSummary {
  groupName: string;
  groupLogoUrl: string | null;
  sharedOnApproval: TransferShared[];
  isMinor: boolean;
  canApproveByLink: boolean;
  emailRequired: boolean;
  expiresAt: string;
}

export interface TransferApprovalResult {
  status: "APPROVED" | "DECLINED";
  groupName: string;
}

export const SHARED_ITEM_LABEL: Record<TransferShared, string> = {
  ATTENDANCE: "Frequência por turma",
  GRADUATIONS: "Graduações",
  CERTIFICATES: "Certificados",
};

export const TRANSFER_APPROVAL_NO_TOKEN =
  "Este link de aprovação está incompleto. Peça ao mestre do grupo para enviar o link novamente.";
export const TRANSFER_APPROVAL_INVALID =
  "Este link não é mais válido: ele pode ter expirado, já ter sido usado ou o pedido já foi decidido. Peça ao mestre do grupo para enviar um novo link.";
export const MINOR_BY_LINK_MESSAGE =
  "Menores de idade não aprovam por link. O responsável deve entrar no app com o login dele e aprovar em Transferências.";

const enc = encodeURIComponent;
const base = (token: string) => `/public/transfer-approval/${enc(token)}`;

// Endpoints públicos: sem sessão; um 401 aqui nunca é "sessão expirada". O token nunca é logado.
export const fetchTransferApproval = (token: string) =>
  api.get<TransferApprovalSummary>(base(token), { skipAuthRedirect: true });

export const approveTransfer = (token: string, newPassword: string, email?: string) =>
  api.post<TransferApprovalResult>(
    `${base(token)}/approve`,
    { newPassword, ...(email ? { email } : {}) },
    { skipAuthRedirect: true },
  );

export const declineTransfer = (token: string) =>
  api.post<TransferApprovalResult>(`${base(token)}/decline`, undefined, { skipAuthRedirect: true });

export const isInvalidTokenError = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 404 || error.code === "TRANSFER_APPROVAL_INVALID");

/** Mapeia todos os códigos do contrato para mensagens pt-BR (o código tem prioridade sobre o texto do servidor). */
export function transferApprovalErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (isInvalidTokenError(error)) return TRANSFER_APPROVAL_INVALID;
    switch (error.code) {
      case "EMAIL_REQUIRED":
        return "Informe um e-mail para criar o seu acesso.";
      case "EMAIL_IN_USE":
        return "Este e-mail já tem uma conta no GingApp. Entre no app com esse login e aprove o pedido em Transferências.";
      case "MINOR_REQUIRES_GUARDIAN":
        return MINOR_BY_LINK_MESSAGE;
      case "TRANSFER_EXPIRED":
        return "Este pedido de transferência expirou. Peça ao mestre do grupo para fazer um novo pedido.";
      case "PERSON_ALREADY_IN_GROUP":
        return "Você já faz parte deste grupo. Não é preciso aprovar a transferência.";
      default:
    }
    if (error.status === 429) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
    if (error.status === 400 && error.message) return error.message;
    if (error.status >= 500) return "Não foi possível concluir agora. Tente novamente em instantes.";
    return error.message || "Não foi possível concluir. Tente novamente.";
  }
  return "Não foi possível conectar. Verifique sua conexão e tente novamente.";
}

export interface ApproveFormValues {
  newPassword: string;
  confirmPassword: string;
  email: string;
  emailRequired: boolean;
}
export type ApproveFormErrors = Partial<Record<"newPassword" | "confirmPassword" | "email", string>>;

/** Mesma política da redefinição de senha (SSOT em lib/password-reset + lib/password) + e-mail quando exigido. */
export function validateApproveForm(values: ApproveFormValues): ApproveFormErrors {
  const errors: ApproveFormErrors = validateResetPassword(values);
  if (values.emailRequired) {
    const email = values.email.trim();
    if (!email) errors.email = "Informe o seu e-mail.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Informe um e-mail válido.";
  }
  return errors;
}
