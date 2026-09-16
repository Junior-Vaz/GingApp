import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/**
 * Chave de token no localStorage — específica deste app para evitar colisão
 * de sessão com o painel do grupo, caso os SPAs sejam abertos no mesmo
 * navegador (mesmo padrão descrito no PLANO_PROJETO.md §3.1).
 */
const TOKEN_STORAGE_KEY = 'mb_token'

export interface AuthUser {
  id: number
  name: string
  email: string
  photo?: string | null
  role: 'ALUNO' | 'RESPONSAVEL' | 'MESTRE' | 'PROFESSOR'
  organizationName?: string
}

export interface LoginCredentials {
  email: string
  password: string
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_STORAGE_KEY))
  const user = ref<AuthUser | null>(null)

  const isAuthenticated = computed(() => !!token.value)

  /**
   * Mock de login — substituir por chamada real a POST /api/auth/login
   * quando o backend estiver disponível (ver src/utils/api.ts).
   */
  async function login(credentials: LoginCredentials): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 300))

    const mockToken = `mock.${btoa(credentials.email)}.token`
    const mockUser: AuthUser = {
      id: 1,
      name: 'Aluno Exemplo',
      email: credentials.email,
      photo: null,
      role: 'ALUNO',
      organizationName: 'Grupo Exemplo de Capoeira',
    }

    token.value = mockToken
    user.value = mockUser
    localStorage.setItem(TOKEN_STORAGE_KEY, mockToken)
  }

  function logout(): void {
    token.value = null
    user.value = null
    localStorage.removeItem(TOKEN_STORAGE_KEY)
  }

  return {
    token,
    user,
    isAuthenticated,
    login,
    logout,
  }
})
