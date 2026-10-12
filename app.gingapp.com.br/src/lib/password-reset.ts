import { useQuery } from "@tanstack/react-query";
import { api, ApiError, errorMessage } from "@/lib/api";
import { newPasswordRules } from "@/lib/password";

/** Mensagem NEUTRA exibida após pedir o link: igual exista ou não o e-mail (não revela cadastro). */
export const FORGOT_PASSWORD_NEUTRAL_MESSAGE = "Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.";
export const RESET_PASSWORD_SUCCESS = "Senha redefinida com sucesso. Entre com a nova senha.";
export const RESET_PASSWORD_NO_TOKEN =
  "Este link de redefinição está incompleto. Peça um novo link para redefinir sua senha.";

interface Capabilities {
  passwordResetByEmail: boolean;
}

/** GET /auth/capabilities (público). Qualquer falha vira "recurso desligado": o login segue funcionando. */
export async function fetchPasswordResetEnabled(): Promise<boolean> {
  try {
    const data = await api.get<Partial<Capabilities> | undefined>("/auth/capabilities", { skipAuthRedirect: true });
    return data?.passwordResetByEmail === true;
  } catch {
    return false;
  }
}

/** O link "Esqueci minha senha" só aparece quando o servidor informa que o e-mail de recuperação está ligado. */
export function usePasswordResetEnabled(): boolean {
  const query = useQuery({
    queryKey: ["auth-capabilities"],
    queryFn: fetchPasswordResetEnabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  return query.data === true;
}

/** POST /auth/forgot-password: 202 sempre igual; 503 (e-mail desligado) e 429 viram erro tratado pela tela. */
export async function requestPasswordReset(email: string, organizationSlug: string): Promise<void> {
  const slug = organizationSlug.trim();
  await api.post(
    "/auth/forgot-password",
    { email: email.trim(), ...(slug ? { organizationSlug: slug } : {}) },
    { skipAuthRedirect: true },
  );
}

export function forgotPasswordErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 503) {
      return "A recuperação de senha por e-mail não está disponível. Peça ao mestre ou à coordenação do seu grupo para redefinir.";
    }
    if (error.status === 429) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  }
  return errorMessage(error, "Não foi possível enviar o pedido. Verifique sua conexão.");
}

/** POST /auth/reset-password: 200 = senha trocada; 400 traz a mensagem do backend (link inválido/política). */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await api.post("/auth/reset-password", { token, newPassword }, { skipAuthRedirect: true });
}

export function resetPasswordErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  }
  return errorMessage(error, "Não foi possível redefinir a senha. Verifique sua conexão.");
}

export interface ResetPasswordValues {
  newPassword: string;
  confirmPassword: string;
}

export type ResetPasswordErrors = Partial<Record<keyof ResetPasswordValues, string>>;

/** Mesma política da troca de senha (12+ caracteres, máx. 72 bytes), sem a regra "diferente da atual". */
export function validateResetPassword(values: ResetPasswordValues): ResetPasswordErrors {
  const errors: ResetPasswordErrors = {};
  if (values.newPassword === "") {
    errors.newPassword = "Informe a nova senha.";
  } else {
    const failed = newPasswordRules(values.newPassword, "").find((rule) => !rule.ok);
    if (failed) errors.newPassword = failed.error;
  }
  if (values.confirmPassword === "") errors.confirmPassword = "Confirme a nova senha.";
  else if (values.confirmPassword !== values.newPassword) {
    errors.confirmPassword = "A confirmação não é igual à nova senha.";
  }
  return errors;
}
