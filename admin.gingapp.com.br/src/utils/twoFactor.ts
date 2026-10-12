import { api } from '@/utils/api'

/**
 * Verificação em duas etapas (TOTP, opt-in). Contrato do backend:
 *  - GET  /auth/me              -> { ..., twoFactorEnabled, recoveryCodesRemaining }
 *  - POST /auth/2fa/setup       -> { secret, otpauthUrl, qrCodeDataUrl }
 *  - POST /auth/2fa/enable      { code } -> { recoveryCodes: string[] } (exibidos UMA vez)
 *  - POST /auth/2fa/disable     { password, code | recoveryCode } -> { twoFactorEnabled: false }
 * Erros de código/senha vêm como 400/403/429 com `message` (nunca 401).
 */
export interface TwoFactorStatus {
  twoFactorEnabled: boolean
  recoveryCodesRemaining: number
}

export interface TwoFactorSetup {
  secret: string
  otpauthUrl: string
  /** data:image/png;base64 pronto para <img>. */
  qrCodeDataUrl: string
}

export const TWO_FACTOR_CODE_LENGTH = 6
export const RECOVERY_CODE_PATTERN = /^[a-z0-9]{5}-[a-z0-9]{5}$/i

/** Remove espaços do código digitado (autenticadores mostram "123 456"). */
export function cleanCode(value: string): string {
  return value.replace(/\s+/g, '')
}

export function isAuthenticatorCode(value: string): boolean {
  return /^\d{6}$/.test(cleanCode(value))
}

export function isRecoveryCode(value: string): boolean {
  return RECOVERY_CODE_PATTERN.test(cleanCode(value))
}

/** Problema do código digitado (null = formato válido); o servidor decide se está correto. */
export function codeProblem(value: string, useRecovery: boolean): string | null {
  if (useRecovery) return isRecoveryCode(value) ? null : 'Informe o código de recuperação no formato xxxxx-xxxxx.'
  return isAuthenticatorCode(value) ? null : 'Informe os 6 dígitos do código do autenticador.'
}

/** Prova do segundo fator para o corpo da requisição: { code } ou { recoveryCode }. */
export function proofBody(value: string, useRecovery: boolean): { code: string } | { recoveryCode: string } {
  const clean = cleanCode(value)
  return useRecovery ? { recoveryCode: clean } : { code: clean }
}

/** Desafio expirado (o usuário precisa refazer o 1º passo). O backend só diferencia pela mensagem. */
export function isChallengeExpired(message: string): boolean {
  return /expir/i.test(message)
}

export async function fetchTwoFactorStatus(): Promise<TwoFactorStatus> {
  const me = await api.get<Partial<TwoFactorStatus> | undefined>('/auth/me')
  return {
    twoFactorEnabled: me?.twoFactorEnabled === true,
    recoveryCodesRemaining: typeof me?.recoveryCodesRemaining === 'number' ? me.recoveryCodesRemaining : 0,
  }
}

export function startTwoFactorSetup(): Promise<TwoFactorSetup> {
  return api.post<TwoFactorSetup>('/auth/2fa/setup')
}

export async function enableTwoFactor(code: string): Promise<string[]> {
  const data = await api.post<{ recoveryCodes?: string[] } | undefined>('/auth/2fa/enable', { code: cleanCode(code) })
  return Array.isArray(data?.recoveryCodes) ? data.recoveryCodes : []
}

/**
 * Redefine o 2FA de OUTRO usuário (POST /auth/2fa/reset/:userId; super admin ativo: qualquer um). Zera o 2FA e
 * encerra as sessões dele; nunca no próprio usuário (400, este usa "desativar").
 */
export async function resetUserTwoFactor(userId: number): Promise<void> {
  await api.post(`/auth/2fa/reset/${userId}`)
}

export async function disableTwoFactor(password: string, value: string, useRecovery: boolean): Promise<void> {
  await api.post('/auth/2fa/disable', { password, ...proofBody(value, useRecovery) })
}
