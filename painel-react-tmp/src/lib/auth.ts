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

export const PANEL_FORBIDDEN_MESSAGE =
  "Este painel é exclusivo da gestão (mestre e professor). Alunos e responsáveis acessam pelo app do aluno.";

/** Login real contra POST /auth/login. Só persiste a sessão se o papel puder usar o painel. */
export async function login(credentials: LoginCredentials): Promise<AuthUser> {
  const body: LoginCredentials = {
    email: credentials.email.trim(),
    password: credentials.password,
  };
  const slug = credentials.organizationSlug?.trim();
  if (slug) body.organizationSlug = slug;

  let data: LoginResponse;
  try {
    data = await api.post<LoginResponse>("/auth/login", body, { skipAuthRedirect: true });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error("Não foi possível entrar. Verifique sua conexão.");
  }

  if (!canAccessPanel(data.user)) {
    // Token válido, mas papel sem acesso ao painel: nada é gravado.
    clearSession();
    throw new Error(PANEL_FORBIDDEN_MESSAGE);
  }
  saveSession(data.accessToken, data.user);
  return data.user;
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
