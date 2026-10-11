export const RATE_LIMIT_MESSAGE = 'Muitas tentativas. Aguarde um minuto e tente de novo.'

/** Mensagem do Nest: string, ou array de strings (class-validator) unido por espaço. */
export function extractMessage(body: unknown): string | null {
  const message = (body as { message?: unknown } | null)?.message
  if (typeof message === 'string' && message.trim()) return message
  if (Array.isArray(message)) {
    const joined = message.filter((m): m is string => typeof m === 'string').join(' ')
    return joined || null
  }
  return null
}

/** Texto legível em português para uma resposta de erro da API (429 vira aviso amigável). */
export function apiErrorText(status: number, body: unknown, fallback?: string): string {
  if (status === 429) return RATE_LIMIT_MESSAGE
  return extractMessage(body) ?? fallback ?? `Erro na requisição (${status}).`
}
