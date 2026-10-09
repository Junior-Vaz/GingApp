import { z } from "zod";
import { api, ApiError, errorMessage } from "@/lib/api";
import { clearSession, replaceToken } from "@/lib/session";

/**
 * Troca da PRÓPRIA senha (POST /auth/change-password). Espelha a política do backend
 * (backend/src/shared/security/password-policy.ts): 12+ caracteres, no máximo 72 bytes UTF-8,
 * diferente da atual e sem a senha padrão de desenvolvimento. O backend decide de fato (400).
 * Senhas NUNCA são aparadas: espaços podem fazer parte delas.
 */
export const NEW_PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;
const FORBIDDEN_FRAGMENTS = ["dev@12345"];

export const passwordByteLength = (password: string): number => new TextEncoder().encode(password).length;

export const isForbiddenPassword = (password: string): boolean => {
  const lowered = password.toLowerCase();
  return FORBIDDEN_FRAGMENTS.some((fragment) => lowered.includes(fragment));
};

export interface PasswordRule {
  id: "length" | "bytes" | "different" | "forbidden";
  /** Texto do requisito (lista de requisitos da tela). */
  label: string;
  /** Mensagem de erro quando o requisito falha. */
  error: string;
  ok: boolean;
}

/** SSOT das regras da senha NOVA: alimenta a lista de requisitos da tela E a validação do formulário. */
export function newPasswordRules(newPassword: string, currentPassword: string): PasswordRule[] {
  return [
    {
      id: "length",
      label: `No mínimo ${NEW_PASSWORD_MIN_LENGTH} caracteres`,
      error: `A nova senha deve ter no mínimo ${NEW_PASSWORD_MIN_LENGTH} caracteres.`,
      ok: newPassword.length >= NEW_PASSWORD_MIN_LENGTH,
    },
    {
      id: "bytes",
      label: `No máximo ${PASSWORD_MAX_BYTES} bytes (UTF-8)`,
      error: `A nova senha deve ter no máximo ${PASSWORD_MAX_BYTES} bytes (UTF-8).`,
      ok: passwordByteLength(newPassword) <= PASSWORD_MAX_BYTES,
    },
    {
      id: "different",
      label: "Diferente da senha atual",
      error: "A nova senha deve ser diferente da atual.",
      ok: newPassword !== "" && newPassword !== currentPassword,
    },
    {
      id: "forbidden",
      label: "Não pode ser a senha padrão de desenvolvimento",
      error: "A nova senha não pode ser a senha padrão de desenvolvimento.",
      ok: !isForbiddenPassword(newPassword),
    },
  ];
}

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Informe a senha atual."),
    newPassword: z.string().min(1, "Informe a nova senha."),
    confirmPassword: z.string().min(1, "Confirme a nova senha."),
  })
  .superRefine((values, ctx) => {
    if (values.newPassword !== "") {
      const failed = newPasswordRules(values.newPassword, values.currentPassword).find((rule) => !rule.ok);
      if (failed) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["newPassword"], message: failed.error });
    }
    if (values.confirmPassword !== "" && values.confirmPassword !== values.newPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "A confirmação não é igual à nova senha.",
      });
    }
  });

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export const emptyChangePasswordForm: ChangePasswordValues = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

/** A senha mudou, mas a resposta não trouxe o novo token: a sessão foi encerrada (entrar de novo). */
export class SessionRenewError extends Error {
  constructor() {
    super("A senha foi alterada, mas a sessão não pôde ser renovada. Entre novamente.");
    this.name = "SessionRenewError";
  }
}

export const CHANGE_PASSWORD_SUCCESS = "Senha alterada. Você continua conectado.";

/**
 * Troca a senha e guarda o NOVO token: o backend revoga todos os tokens do usuário, inclusive o usado
 * nesta chamada. Um 400 de "senha atual incorreta" NÃO é sessão expirada (o backend nunca usa 401 aqui);
 * só o 401 de verdade limpa a sessão (api.ts).
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const data = await api.post<{ accessToken?: string } | undefined>("/auth/change-password", {
    currentPassword,
    newPassword,
  });
  if (!data || typeof data.accessToken !== "string" || data.accessToken === "") {
    // O token antigo já foi revogado e não veio o novo: manter a sessão seria um falso-OK.
    clearSession();
    throw new SessionRenewError();
  }
  replaceToken(data.accessToken);
}

/** Mensagem para o usuário: 429 vira texto amigável; demais erros mostram a mensagem do backend. */
export function changePasswordErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    return "Muitas tentativas de troca de senha. Aguarde um minuto e tente novamente.";
  }
  if (error instanceof SessionRenewError) return error.message;
  return errorMessage(error, "Não foi possível alterar a senha. Verifique sua conexão.");
}
