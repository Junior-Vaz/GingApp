import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * Chave de armazenamento do token no localStorage.
 * Cada SPA do GingApp usa uma chave própria para não colidir sessões
 * quando os apps são abertos no mesmo navegador (ver PLANO_PROJETO.md §3.1).
 */
export const AUTH_TOKEN_KEY = 'mb_token'
export const AUTH_USER_KEY = 'mb_user'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api'

export interface AuthUser {
  id: number
  name: string
  email: string
  userType: 'MEMBER' | 'PLATFORM'
  isSuperAdmin: boolean
  organizationId: number
  organizationSlug: string
  role: 'MESTRE' | 'PROFESSOR' | 'ALUNO' | 'RESPONSAVEL'
}

interface LoginResponse {
  accessToken: string
  user: AuthUser
}

function readStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(AUTH_USER_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem(AUTH_TOKEN_KEY))
  const user = ref<AuthUser | null>(readStoredUser())

  const isAuthenticated = computed(() => Boolean(token.value))

  /**
   * Login real contra POST /api/auth/login (userType MEMBER — mestre/professor/aluno/
   * responsável, ver PLANO_PROJETO.md §3.1/§4). `organizationSlug` só é necessário quando o
   * e-mail pertence a mais de um grupo (backend responde 400 pedindo o slug — ainda não há
   * seletor de organização na UI, fica como pendência para quando isso for um caso real).
   */
  async function login(email: string, password: string, organizationSlug?: string): Promise<void> {
    if (!email || !password) {
      throw new Error('Informe e-mail e senha.')
    }

    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, organizationSlug }),
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const message = (data as { message?: string } | null)?.message ?? 'Não foi possível entrar.'
      throw new Error(message)
    }

    const { accessToken, user: loggedUser } = data as LoginResponse

    token.value = accessToken
    user.value = loggedUser
    localStorage.setItem(AUTH_TOKEN_KEY, accessToken)
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(loggedUser))
  }

  function logout(): void {
    token.value = null
    user.value = null
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_USER_KEY)
  }

  return { token, user, isAuthenticated, login, logout }
})
