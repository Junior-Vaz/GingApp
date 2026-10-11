import { AUTH_TOKEN_KEY, AUTH_USER_KEY } from '@/stores/auth'
import { apiErrorText } from '@/utils/errors'

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
async function requestRaw<T>(path: string, options: RequestOptions = {}): Promise<{ data: T; headers: Headers }> {
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

  if (response.status === 401 && token && !skipAuth && localStorage.getItem(AUTH_TOKEN_KEY) !== token) {
    // 401 de uma chamada feita com um token que JÁ FOI TROCADO (troca de senha enquanto ela estava em
    // voo) é obsoleto: a sessão atual é outra e válida - não pode ser derrubada por ele.
    throw new ApiError('A sessão foi renovada. Tente novamente.', 401)
  }

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
    throw new ApiError(apiErrorText(response.status, errorBody), response.status)
  }

  // Corpo vazio pode vir com 204 OU com 200/201 (endpoint que não devolve nada) — `.json()`
  // incondicional quebra com SyntaxError nesse segundo caso (achado real em
  // app.gingapp.com.br, PLANO_PROJETO.md §10.16, mesmo cliente HTTP replicado nos 3 apps).
  const text = await response.text()
  return { data: (text ? JSON.parse(text) : undefined) as T, headers: response.headers }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return (await requestRaw<T>(path, options)).data
}

/** Valor aceito em query string; undefined, null e '' são ignorados. */
export type QueryParams = Record<string, string | number | boolean | null | undefined>

export function buildQuery(params?: QueryParams): string {
  if (!params) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    const text = typeof value === 'string' ? value.trim() : value
    if (text !== undefined && text !== null && text !== '') search.set(key, String(text))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

/** Resultado de uma listagem paginada no servidor: itens da página + total que casa com o filtro. */
export interface Page<T> {
  items: T[]
  total: number
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

export const api = {
  /** Listagem paginada: corpo é um array e o total vem em X-Total-Count (sem o header, total = items.length). */
  getPage: async <T>(path: string, params?: QueryParams, options?: RequestOptions): Promise<Page<T>> => {
    const { data, headers } = await requestRaw<T[]>(`${path}${buildQuery(params)}`, { ...options, method: 'GET' })
    const items = Array.isArray(data) ? data : []
    const raw = headers.get('X-Total-Count')
    const total = raw !== null && raw.trim() !== '' ? Number(raw) : Number.NaN
    return { items, total: Number.isFinite(total) && total >= 0 ? total : items.length }
  },
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'DELETE' }),
}
