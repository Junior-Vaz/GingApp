import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * Chave de armazenamento do token no localStorage.
 * Cada SPA do GingApp usa uma chave própria para não colidir sessões
 * quando os apps são abertos no mesmo navegador (ver PLANO_PROJETO.md §3.1).
 * O SaaS Admin usa `sa_token`, distinto do `mb_token` do painel do grupo.
 */
export const AUTH_TOKEN_KEY = 'sa_token'
export const AUTH_USER_KEY = 'sa_user'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api'

export interface AuthUser {
  id: number
  name: string
  email: string
  userType: 'MEMBER' | 'PLATFORM'
  isSuperAdmin: boolean
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

  /** Login real contra POST /api/auth/platform-login (exclusivo de userType PLATFORM). */
  async function login(email: string, password: string): Promise<void> {
    if (!email || !password) {
      throw new Error('Informe e-mail e senha.')
    }

    const response = await fetch(`${API_URL}/auth/platform-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
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

  /**
   * Troca SÓ o token, mantendo o usuário. Usado após a troca de senha: o backend revoga todos os tokens
   * antigos (inclusive o desta chamada) e devolve um novo - a sessão segue sem deslogar. Sem sessão
   * guardada não há o que trocar (não cria sessão "pela metade").
   */
  function replaceToken(newToken: string): void {
    if (!user.value) return
    token.value = newToken
    localStorage.setItem(AUTH_TOKEN_KEY, newToken)
  }

  function logout(): void {
    token.value = null
    user.value = null
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_USER_KEY)
  }

  return { token, user, isAuthenticated, login, logout, replaceToken }
})
