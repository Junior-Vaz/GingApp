import { useAuthStore } from '@/stores/auth'
import { api, ApiError, errorMessage } from '@/utils/api'

/**
 * Política da senha NOVA (espelha backend/src/shared/security/password-policy.ts): 12+ caracteres,
 * no máximo 72 bytes UTF-8, sem a senha padrão de desenvolvimento. O backend decide de fato (400).
 * Senhas NUNCA são aparadas: espaços podem fazer parte delas.
 */
export const NEW_PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_BYTES = 72
const FORBIDDEN_FRAGMENTS = ['dev@12345']

export function passwordByteLength(password: string): number {
  return new TextEncoder().encode(password).length
}

export function isForbiddenPassword(password: string): boolean {
  const lowered = password.toLowerCase()
  return FORBIDDEN_FRAGMENTS.some((fragment) => lowered.includes(fragment))
}

/** Problema da senha nova em si (tamanho, bytes, senha padrão); null = atende à política. */
export function newPasswordProblem(password: string): string | null {
  if (password.length < NEW_PASSWORD_MIN_LENGTH) {
    return `A senha precisa ter no mínimo ${NEW_PASSWORD_MIN_LENGTH} caracteres.`
  }
  if (passwordByteLength(password) > PASSWORD_MAX_BYTES) {
    return `A senha pode ter no máximo ${PASSWORD_MAX_BYTES} caracteres.`
  }
  if (isForbiddenPassword(password)) return 'A senha não pode ser a senha padrão de desenvolvimento.'
  return null
}

const CONFIRMATION_MISMATCH = 'A confirmação da senha não confere.'

/** Senha nova + confirmação (null = válida). Usado no reset do MESTRE e na criação do grupo. */
export function passwordProblem(password: string, confirmation: string): string | null {
  return newPasswordProblem(password) ?? (password !== confirmation ? CONFIRMATION_MISMATCH : null)
}

/** Troca da própria senha: além da política e da confirmação, a nova precisa diferir da atual. */
export function changePasswordProblem(current: string, next: string, confirmation: string): string | null {
  if (current === '') return 'Informe a senha atual.'
  const problem = newPasswordProblem(next)
  if (problem) return problem
  if (next === current) return 'A nova senha deve ser diferente da atual.'
  return next !== confirmation ? CONFIRMATION_MISMATCH : null
}
export const CHANGE_PASSWORD_SUCCESS = 'Senha alterada. Você continua conectado.'
export const RESET_MESTRE_SUCCESS =
  'Senha redefinida — informe ao MESTRE por canal seguro; as sessões dele foram encerradas.'

/** A senha mudou, mas a resposta não trouxe o novo token: a sessão foi encerrada (entrar de novo). */
export class SessionRenewError extends Error {
  constructor() {
    super('A senha foi alterada, mas a sessão não pôde ser renovada. Entre novamente.')
    this.name = 'SessionRenewError'
  }
}

/**
 * Troca da PRÓPRIA senha (POST /auth/change-password, PLATFORM). O backend revoga todos os tokens do
 * usuário, inclusive o desta chamada, e devolve um novo: guarda-o sem deslogar. Um 400 ("Senha atual
 * incorreta.") NÃO é sessão expirada (o backend nunca usa 401 aqui); só o 401 de verdade desloga (api.ts).
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const data = await api.post<{ accessToken?: string } | undefined>('/auth/change-password', {
    currentPassword,
    newPassword,
  })
  const store = useAuthStore()
  if (!data || typeof data.accessToken !== 'string' || data.accessToken === '') {
    // O token antigo já foi revogado e não veio o novo: manter a sessão seria um falso-OK.
    store.logout()
    throw new SessionRenewError()
  }
  store.replaceToken(data.accessToken)
}

/** Redefine a senha de um MESTRE (super admin PLATFORM ativo). 204; revoga as sessões dele. */
export async function resetMestrePassword(orgId: number, userId: number, newPassword: string): Promise<void> {
  await api.post(`/organizations/${orgId}/members/${userId}/reset-password`, { newPassword })
}

const TOO_MANY = 'Muitas tentativas. Aguarde um minuto e tente novamente.'

/** Mensagem para o usuário: 429 vira texto amigável; demais erros mostram a mensagem do backend. */
export function passwordErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 429) return TOO_MANY
  if (error instanceof SessionRenewError) return error.message
  return errorMessage(error, fallback)
}

/** Resposta neutra: igual exista ou não o e-mail (o backend responde 202 sempre igual - sem enumeração de contas). */
export const FORGOT_PASSWORD_NEUTRAL_MESSAGE =
  'Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.'
export const RESET_PASSWORD_SUCCESS = 'Senha redefinida com sucesso. Entre com a nova senha.'
export const RESET_LINK_MISSING = 'Link inválido ou incompleto. Solicite um novo link de redefinição.'
const FORGOT_UNAVAILABLE = 'A recuperação de senha por e-mail não está disponível no momento.'

/** GET /auth/capabilities (público): a recuperação por e-mail só aparece quando o backend a habilita. Erro = desligada. */
export async function fetchPasswordResetByEmail(): Promise<boolean> {
  try {
    const data = await api.get<{ passwordResetByEmail?: unknown } | undefined>('/auth/capabilities', { skipAuth: true })
    return data?.passwordResetByEmail === true
  } catch {
    return false
  }
}

/** POST /auth/forgot-password (público). O resultado não revela se o e-mail existe. */
export async function requestPasswordReset(email: string): Promise<void> {
  await api.post('/auth/forgot-password', { email }, { skipAuth: true })
}

/** POST /auth/reset-password (público). 400 = link inválido/expirado ou senha fora da política. */
export async function resetPasswordWithToken(token: string, newPassword: string): Promise<void> {
  await api.post('/auth/reset-password', { token, newPassword }, { skipAuth: true })
}

/** Mensagem do pedido de link: 503 (e-mail desligado) e 429 viram textos amigáveis. */
export function forgotPasswordErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) return FORGOT_UNAVAILABLE
  return passwordErrorMessage(error, 'Não foi possível enviar o pedido. Tente novamente.')
}
