import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { apiErrorText } from '@/utils/errors'

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
  /** Senha definida por outra pessoa (ex.: redefinida por um super admin): o admin exige a troca antes de tudo. */
  mustChangePassword?: boolean
  /** Termos de Uso/Política de Privacidade (E10): true = há aceite pendente; o admin mostra a tela bloqueante. */
  termsAcceptanceRequired?: boolean
  currentTermsVersion?: string
  acceptedTermsVersion?: string | null
  /** Verificação em duas etapas (TOTP, opt-in): vem de GET /auth/me; undefined = ainda não consultado. */
  twoFactorEnabled?: boolean
  recoveryCodesRemaining?: number
}

interface LoginResponse {
  accessToken: string
  user: AuthUser
}

/** Resposta do login quando a conta tem 2FA: sessão ainda NÃO existe; o desafio vale só para a verificação. */
interface TwoFactorChallenge {
  twoFactorRequired: true
  challengeToken: string
}

/** Resultado do 1º passo do login: sessão iniciada, ou desafio de 2FA (o token fica só na memória de quem chama). */
export type LoginResult = { status: 'authenticated' } | { status: 'two-factor'; challengeToken: string }

/** Código do autenticador (6 dígitos) OU código de recuperação (xxxxx-xxxxx). */
export type TwoFactorProof = { code: string } | { recoveryCode: string }

function isTwoFactorChallenge(data: unknown): data is TwoFactorChallenge {
  const candidate = data as Partial<TwoFactorChallenge> | null
  return (
    candidate?.twoFactorRequired === true &&
    typeof candidate.challengeToken === 'string' &&
    candidate.challengeToken !== ''
  )
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
  async function login(email: string, password: string): Promise<LoginResult> {
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
      // 400 = corpo fora do formato (validação em inglês do class-validator): texto fixo em português.
      const message =
        response.status === 400
          ? 'Informe um e-mail válido e a senha.'
          : apiErrorText(response.status, data, 'Não foi possível entrar.')
      throw new Error(message)
    }

    // Conta com 2FA: HTTP 200 SEM sessão. Nada é guardado - o desafio só existe na memória do componente.
    if (isTwoFactorChallenge(data)) {
      return { status: 'two-factor', challengeToken: data.challengeToken }
    }

    startSession(data as LoginResponse)
    return { status: 'authenticated' }
  }

  function startSession({ accessToken, user: loggedUser }: LoginResponse): void {
    token.value = accessToken
    user.value = loggedUser
    localStorage.setItem(AUTH_TOKEN_KEY, accessToken)
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(loggedUser))
  }

  /**
   * 2º passo do login: POST /api/auth/2fa/verify com o desafio + código do autenticador ou de recuperação.
   * Devolve o mesmo AuthResponse do login e guarda a sessão igual. Erros (400 código incorreto/desafio
   * expirado, 429) chegam com a mensagem do servidor.
   */
  async function verifyTwoFactor(challengeToken: string, proof: TwoFactorProof): Promise<void> {
    const response = await fetch(`${API_URL}/auth/2fa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken, ...proof }),
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      throw new Error(apiErrorText(response.status, data, 'Não foi possível verificar o código.'))
    }

    const session = data as Partial<LoginResponse> | null
    if (!session || typeof session.accessToken !== 'string' || !session.user) {
      throw new Error('Não foi possível verificar o código.')
    }
    startSession(session as LoginResponse)
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
    // Só é chamada depois de a PRÓPRIA senha ser trocada: a troca obrigatória (mustChangePassword) está cumprida.
    if (user.value.mustChangePassword) updateUser({ mustChangePassword: false })
  }

  /** Mescla campos no usuário da sessão (ex.: depois do aceite dos termos). Sem sessão não faz nada. */
  function updateUser(patch: Partial<AuthUser>): void {
    if (!user.value) return
    user.value = { ...user.value, ...patch }
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user.value))
  }

  function logout(): void {
    token.value = null
    user.value = null
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_USER_KEY)
  }

  return { token, user, isAuthenticated, login, verifyTwoFactor, logout, replaceToken, updateUser }
})
