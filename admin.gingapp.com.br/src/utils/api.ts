import { AUTH_TOKEN_KEY, AUTH_USER_KEY } from '@/stores/auth'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  skipAuth?: boolean
}

/**
 * Wrapper central de fetch: injeta `Authorization: Bearer <token>` em toda
 * chamada autenticada e trata 401 com logout automático (limpa o token e
 * redireciona para /login), replicando o padrão descrito no
 * PLANO_PROJETO.md §3.1/§3.2. Plugar aqui as chamadas reais quando o
 * backend NestJS estiver disponível.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { skipAuth, body, headers, ...rest } = options
  const token = localStorage.getItem(AUTH_TOKEN_KEY)

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token && !skipAuth ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (response.status === 401) {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_USER_KEY)
    if (window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
    throw new ApiError('Sessão expirada. Faça login novamente.', 401)
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    const message = (errorBody as { message?: string } | null)?.message ?? `Erro na requisição (${response.status}).`
    throw new ApiError(message, response.status)
  }

  // Corpo vazio pode vir com 204 OU com 200/201 (endpoint que não devolve nada) — `.json()`
  // incondicional quebra com SyntaxError nesse segundo caso (achado real em
  // app.gingapp.com.br, PLANO_PROJETO.md §10.16, mesmo cliente HTTP replicado nos 3 apps).
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'DELETE' }),
}
