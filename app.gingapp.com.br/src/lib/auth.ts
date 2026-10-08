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

/** Login real contra POST /auth/login (userType MEMBER - aluno/responsável neste app). */
export async function login(credentials: LoginCredentials): Promise<void> {
  const body: LoginCredentials = {
    email: credentials.email.trim(),
    password: credentials.password,
  };
  const slug = credentials.organizationSlug?.trim();
  if (slug) body.organizationSlug = slug;

  try {
    const data = await api.post<LoginResponse>("/auth/login", body, {
      skipAuthRedirect: true,
    });
    saveSession(data.accessToken, data.user);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error("Não foi possível entrar. Verifique sua conexão.");
  }
}

/** Logout: limpa sessão E o cache do TanStack Query (dados de outro usuário nunca vazam). */
export function logout(queryClient: QueryClient): void {
  clearSession();
  queryClient.clear();
}
