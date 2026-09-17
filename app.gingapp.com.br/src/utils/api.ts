/**
 * Cliente HTTP mínimo para a API compartilhada do GingApp (NestJS).
 * A URL base vem de VITE_API_URL (ver .env.example). Injeta o token do
 * usuário autenticado (chave mb_token, ver src/stores/auth.ts) em toda
 * requisição, quando presente.
 */
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api'
const TOKEN_STORAGE_KEY = 'mb_token'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })

  if (!response.ok) {
    // Lê a mensagem do NestJS (`{ message, error, statusCode }`) quando existe — sem isso,
    // erros de validação/regra de negócio (ex.: "Aluno menor de idade: ...") nunca chegavam
    // na tela, só um genérico "Erro 403 ao chamar /passport/publish" (achado ao validar a
    // Fase 2, Jornada do Capoeirista — PLANO_PROJETO.md §10.16).
    const body = await response.json().catch(() => null)
    const rawMessage = (body as { message?: string | string[] } | null)?.message
    const message = Array.isArray(rawMessage) ? rawMessage.join(' ') : rawMessage
    throw new ApiError(message ?? `Erro ${response.status} ao chamar ${path}`, response.status)
  }

  // Corpo vazio pode vir com 204 OU com 200/201 (ex.: um endpoint que não devolve nada) —
  // `.json()` incondicional quebra com SyntaxError nesse segundo caso (achado real ao validar
  // PATCH /passport/guardian-consent, PLANO_PROJETO.md §10.16). `.text()` primeiro é seguro
  // pros dois casos.
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
