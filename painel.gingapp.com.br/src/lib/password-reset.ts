import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { api, ApiError, errorMessage } from "@/lib/api";
import { newPasswordRules } from "@/lib/password";

/** GET /auth/capabilities (público): o que o servidor oferece. Consulta falha = tudo desligado. */
export interface AuthCapabilities {
  passwordResetByEmail: boolean;
}

export async function fetchAuthCapabilities(): Promise<AuthCapabilities> {
  const data = await api.get<Partial<AuthCapabilities> | undefined>("/auth/capabilities", { skipAuthRedirect: true });
  return { passwordResetByEmail: data?.passwordResetByEmail === true };
}

/**
 * Capacidades do servidor. Erro/carregando = `passwordResetByEmail: false` (o recurso fica oculto e o
 * login/diálogos funcionam normalmente). `enabled=false` evita a consulta até ela ser necessária.
 */
export function useAuthCapabilities(enabled = true): AuthCapabilities {
  const query = useQuery({
    queryKey: ["auth-capabilities"],
    queryFn: fetchAuthCapabilities,
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
  return { passwordResetByEmail: query.data?.passwordResetByEmail === true };
}

/** Mensagem SEMPRE igual após pedir o link (não revela se o e-mail existe). */
export const FORGOT_PASSWORD_NEUTRAL_MESSAGE =
  "Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.";

export const forgotPasswordSchema = z.object({
  email: z.string().trim().min(1, "Informe o e-mail.").email("E-mail inválido."),
  organizationSlug: z.string(),
});
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

/** POST /auth/forgot-password -> 202 (sempre igual). */
export async function requestPasswordReset(values: ForgotPasswordValues): Promise<void> {
  const slug = values.organizationSlug.trim();
  await api.post<unknown>(
    "/auth/forgot-password",
    slug ? { email: values.email.trim(), organizationSlug: slug } : { email: values.email.trim() },
    { skipAuthRedirect: true },
  );
}

export function forgotPasswordErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 503) {
      return "A recuperação de senha por e-mail não está disponível no momento. Procure o administrador do grupo.";
    }
    if (error.status === 429) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  }
  return errorMessage(error, "Não foi possível enviar o pedido. Verifique sua conexão.");
}

/** Nova senha pelo link do e-mail: mesma política da troca de senha (SSOT em lib/password.ts), sem "senha atual". */
export const resetByTokenSchema = z
  .object({
    newPassword: z.string().min(1, "Informe a nova senha."),
    confirmPassword: z.string().min(1, "Confirme a nova senha."),
  })
  .superRefine((values, ctx) => {
    if (values.newPassword !== "") {
      const failed = newPasswordRules(values.newPassword, "").find((rule) => !rule.ok);
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
export type ResetByTokenValues = z.infer<typeof resetByTokenSchema>;

export const RESET_PASSWORD_SUCCESS = "Senha redefinida com sucesso. Agora você já pode entrar com a nova senha.";
export const RESET_LINK_MISSING_MESSAGE = "Link de redefinição inválido ou incompleto. Solicite um novo link.";

/** POST /auth/reset-password (400 = link inválido/expirado ou senha fora da política). */
export async function resetPasswordWithToken(token: string, newPassword: string): Promise<void> {
  await api.post<unknown>("/auth/reset-password", { token, newPassword }, { skipAuthRedirect: true });
}

export function resetPasswordErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  }
  return errorMessage(error, "Não foi possível redefinir a senha. Verifique sua conexão.");
}
