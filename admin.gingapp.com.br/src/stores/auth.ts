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

export interface AuthUser {
  id: number
  name: string
  email: string
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
   * TODO: substituir pelo POST /api/auth/platform-login real quando o
   * backend estiver disponível (ver PLANO_PROJETO.md §3.1 e §4). Por
   * enquanto, simula a chamada para permitir desenvolver o frontend
   * isoladamente.
   */
  async function login(email: string, password: string): Promise<void> {
    if (!email || !password) {
      throw new Error('Informe e-mail e senha.')
    }

    await new Promise((resolve) => setTimeout(resolve, 300))

    const mockUser: AuthUser = {
      id: 1,
      name: 'Equipe GingApp',
      email,
    }
    const mockToken = `mock-${Date.now()}`

    token.value = mockToken
    user.value = mockUser
    localStorage.setItem(AUTH_TOKEN_KEY, mockToken)
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(mockUser))
  }

  function logout(): void {
    token.value = null
    user.value = null
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_USER_KEY)
  }

  return { token, user, isAuthenticated, login, logout }
})
