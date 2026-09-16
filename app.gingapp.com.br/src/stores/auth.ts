import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/**
 * Chave de token no localStorage — específica deste app para evitar colisão
 * de sessão com o painel do grupo, caso os SPAs sejam abertos no mesmo
 * navegador (mesmo padrão descrito no PLANO_PROJETO.md §3.1).
 */
const TOKEN_STORAGE_KEY = 'mb_token'
const USER_STORAGE_KEY = 'mb_user'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api'

export interface AuthUser {
  id: number
  name: string
  email: string
  userType: 'MEMBER' | 'PLATFORM'
  isSuperAdmin: boolean
  organizationId: number
  organizationSlug: string
  role: 'ALUNO' | 'RESPONSAVEL' | 'MESTRE' | 'PROFESSOR'
  /** Ainda não vem pronto do backend (só organizationSlug) — usado como fallback de
   * exibição até existir uma chamada real a GET /organizations/:id. */
  organizationName?: string
}

export interface LoginCredentials {
  email: string
  password: string
  organizationSlug?: string
}

interface LoginResponse {
  accessToken: string
  user: AuthUser
}

function readStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_STORAGE_KEY))
  const user = ref<AuthUser | null>(readStoredUser())

  const isAuthenticated = computed(() => !!token.value)

  /** Login real contra POST /api/auth/login (userType MEMBER — aluno/responsável nesse app). */
  async function login(credentials: LoginCredentials): Promise<void> {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const message = (data as { message?: string } | null)?.message ?? 'Não foi possível entrar.'
      throw new Error(message)
    }

    const { accessToken, user: loggedUser } = data as LoginResponse
    loggedUser.organizationName = loggedUser.organizationSlug

    token.value = accessToken
    user.value = loggedUser
    localStorage.setItem(TOKEN_STORAGE_KEY, accessToken)
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(loggedUser))
  }

  function logout(): void {
    token.value = null
    user.value = null
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    localStorage.removeItem(USER_STORAGE_KEY)
  }

  return {
    token,
    user,
    isAuthenticated,
    login,
    logout,
  }
})
