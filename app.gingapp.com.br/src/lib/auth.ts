import type { QueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { clearSession, saveSession, type AuthUser } from "@/lib/session";

export interface LoginCredentials {
  email: string;
  password: string;
  organizationSlug?: string;
}

interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

/** Login com 2FA ativo: o servidor devolve 200 com um desafio no lugar da sessão (só em memória, nunca persistido). */
interface TwoFactorChallengeResponse {
  twoFactorRequired: true;
  challengeToken: string;
}

export type LoginResult = { status: "authenticated" } | { status: "twoFactor"; challengeToken: string };

/** Segundo passo: o código do app autenticador OU um código de recuperação (xxxxx-xxxxx), nunca os dois. */
export type TwoFactorProof = { code: string } | { recoveryCode: string };

/** Mensagens 400 de desafio vencido/inválido: a tela volta ao passo da senha. */
export const isChallengeExpired = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 400 && /expir|desafio/i.test(error.message);

/**
 * Login real contra POST /auth/login (userType MEMBER - aluno/responsável neste app).
 * Com 2FA ativo NÃO grava sessão: devolve o desafio para o segundo passo (`verifyTwoFactor`).
 */
export async function login(credentials: LoginCredentials): Promise<LoginResult> {
  const body: LoginCredentials = {
    email: credentials.email.trim(),
    password: credentials.password,
  };
  const slug = credentials.organizationSlug?.trim();
  if (slug) body.organizationSlug = slug;

  try {
    const data = await api.post<LoginResponse | TwoFactorChallengeResponse>("/auth/login", body, {
      skipAuthRedirect: true,
    });
    if ("twoFactorRequired" in data && data.twoFactorRequired === true) {
      return { status: "twoFactor", challengeToken: data.challengeToken };
    }
    const session = data as LoginResponse;
    saveSession(session.accessToken, session.user);
    return { status: "authenticated" };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error("Não foi possível entrar. Verifique sua conexão.");
  }
}

/**
 * POST /auth/2fa/verify: troca desafio + código pela mesma resposta do login e grava a sessão igual a ele.
 * Código errado/desafio vencido voltam como 400 (não 401), então `skipAuthRedirect` só reforça o contrato.
 */
export async function verifyTwoFactor(challengeToken: string, proof: TwoFactorProof): Promise<void> {
  try {
    const data = await api.post<LoginResponse>("/auth/2fa/verify", { challengeToken, ...proof }, { skipAuthRedirect: true });
    saveSession(data.accessToken, data.user);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error("Não foi possível verificar o código. Verifique sua conexão.");
  }
}

/** Logout: limpa sessão E o cache do TanStack Query (dados de outro usuário nunca vazam). */
export function logout(queryClient: QueryClient): void {
  clearSession();
  queryClient.clear();
}
