import type { QueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { canAccessPanel, clearSession, saveSession, type AuthUser } from "@/lib/session";

export interface LoginCredentials {
  email: string;
  password: string;
  organizationSlug?: string;
}

interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

/**
 * Verificação em duas etapas (2FA TOTP, opt-in): quando a conta tem 2FA ligado, POST /auth/login responde
 * 200 com este desafio NO LUGAR da sessão. O `challengeToken` é de uso único e curto; guarde-o só em memória.
 */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challengeToken: string;
}

export const isTwoFactorChallenge = (value: unknown): value is TwoFactorChallenge =>
  typeof value === "object" &&
  value !== null &&
  (value as { twoFactorRequired?: unknown }).twoFactorRequired === true &&
  typeof (value as { challengeToken?: unknown }).challengeToken === "string";

/** Segundo passo: código de 6 dígitos do app autenticador OU código de recuperação (xxxxx-xxxxx). */
export type TwoFactorProof = { code: string } | { recoveryCode: string };

/** O desafio expirou/é inválido (HTTP 400): o usuário precisa refazer o primeiro passo. */
export const isChallengeExpired = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 400 && /expir|desafio/i.test(error.message);

export const PANEL_FORBIDDEN_MESSAGE =
  "Este painel é exclusivo da gestão (mestre e professor). Alunos e responsáveis acessam pelo app do aluno.";

/** Persiste a sessão se o papel puder usar o painel; senão nada é gravado e o erro explica. */
function startSession(data: LoginResponse): AuthUser {
  if (!canAccessPanel(data.user)) {
    // Token válido, mas papel sem acesso ao painel: nada é gravado.
    clearSession();
    throw new Error(PANEL_FORBIDDEN_MESSAGE);
  }
  saveSession(data.accessToken, data.user);
  return data.user;
}

/**
 * Login real contra POST /auth/login. Só persiste a sessão se o papel puder usar o painel.
 * Com 2FA ligado na conta devolve o `TwoFactorChallenge` (nada é gravado): conclua com `verifyTwoFactor`.
 */
export async function login(credentials: LoginCredentials): Promise<AuthUser | TwoFactorChallenge> {
  const body: LoginCredentials = {
    email: credentials.email.trim(),
    password: credentials.password,
  };
  const slug = credentials.organizationSlug?.trim();
  if (slug) body.organizationSlug = slug;

  let data: LoginResponse | TwoFactorChallenge;
  try {
    data = await api.post<LoginResponse | TwoFactorChallenge>("/auth/login", body, { skipAuthRedirect: true });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error("Não foi possível entrar. Verifique sua conexão.");
  }
  return isTwoFactorChallenge(data) ? data : startSession(data);
}

/**
 * Segundo passo do login com 2FA (POST /auth/2fa/verify): devolve o mesmo AuthResponse do login e guarda a
 * sessão igual a ele. Código errado/desafio expirado voltam como 400 (nunca 401), e `skipAuthRedirect`
 * garante que nenhum erro daqui seja tratado como sessão expirada.
 */
export async function verifyTwoFactor(challengeToken: string, proof: TwoFactorProof): Promise<AuthUser> {
  let data: LoginResponse;
  try {
    data = await api.post<LoginResponse>("/auth/2fa/verify", { challengeToken, ...proof }, { skipAuthRedirect: true });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error("Não foi possível verificar o código. Verifique sua conexão.");
  }
  return startSession(data);
}

/** Logout: limpa sessão E o cache do TanStack Query (dados de outro usuário nunca vazam). */
export function logout(queryClient: QueryClient): void {
  clearSession();
  queryClient.clear();
}

/** `redirect` só aceita caminhos internos (evita open redirect). */
export function safeRedirect(target: string | undefined): string {
  return target && target.startsWith("/") && !target.startsWith("//") ? target : "/dashboard";
}
