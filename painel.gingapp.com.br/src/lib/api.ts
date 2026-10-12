import { clearSession, getToken } from "@/lib/session";

/** URL base da API (NestJS). Embutida no bundle em tempo de build. */
export const API_URL: string =
  (import.meta.env["VITE_API_URL"] as string | undefined) ?? "http://localhost:3000/api";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Registrado no bootstrap: limpa o cache do Query e redireciona para /login. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

function extractMessage(body: unknown): string | undefined {
  const raw = (body as { message?: string | string[] } | null)?.message;
  return Array.isArray(raw) ? raw.join(" ") : raw;
}

interface RequestOptions {
  /** Endpoints públicos/login: um 401 aqui não é "sessão expirada". */
  skipAuthRedirect?: boolean;
}

async function throwApiError(
  response: Response,
  path: string,
  token: string | null,
  options: RequestOptions,
): Promise<never> {
  const body = await response.json().catch(() => null);
  // 401 de uma chamada feita com um token que JÁ FOI TROCADO (troca de senha enquanto ela estava em
  // voo) é obsoleto: a sessão atual é outra e válida - não pode ser derrubada por ele.
  if (response.status === 401 && !options.skipAuthRedirect && getToken() === token) {
    clearSession();
    unauthorizedHandler?.();
  }
  throw new ApiError(extractMessage(body) ?? `Erro ${response.status} ao chamar ${path}`, response.status);
}

async function requestRaw<T>(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<{ data: T; headers: Headers }> {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) await throwApiError(response, path, token, options);

  // Corpo vazio pode vir com 204 OU 200/201 - .text() primeiro é seguro para os dois casos.
  const text = await response.text();
  return { data: (text ? JSON.parse(text) : undefined) as T, headers: response.headers };
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  return (await requestRaw<T>(path, init, options)).data;
}

/** Valor aceito em query string; `undefined`, `null` e `""` são ignorados por `buildQuery`. */
export type QueryParam = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryParam>;

/** Monta `?a=1&b=x` (ou `""`) ignorando `undefined`/`null`/`""`. */
export function buildQuery(params?: QueryParams): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** Resultado de uma listagem paginada no servidor: itens da página + total que casa com o filtro. */
export interface Page<T> {
  items: T[];
  total: number;
}

const jsonBody = (body: unknown): { body?: string } =>
  body === undefined ? {} : { body: JSON.stringify(body) };

export const api = {
  /**
   * Listagem paginada: o corpo é um array e o total vem no header `X-Total-Count`.
   * Sem o header (ou inválido) o total é `items.length`.
   */
  getPage: async <T>(path: string, params?: QueryParams, options?: RequestOptions): Promise<Page<T>> => {
    const { data, headers } = await requestRaw<T[]>(`${path}${buildQuery(params)}`, { method: "GET" }, options);
    const items = Array.isArray(data) ? data : [];
    const raw = headers.get("X-Total-Count");
    const total = raw !== null && raw.trim() !== "" ? Number(raw) : NaN;
    return { items, total: Number.isFinite(total) && total >= 0 ? total : items.length };
  },
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { method: "GET" }, options),
  /** GET autenticado de um arquivo binário (ex.: PDF). Erros seguem o mesmo contrato de `ApiError`. */
  getBlob: async (path: string, options: RequestOptions = {}): Promise<Blob> => {
    const token = getToken();
    const response = await fetch(`${API_URL}${path}`, {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) await throwApiError(response, path, token, options);
    return response.blob();
  },
  /** POST multipart (upload de arquivo): sem Content-Type manual - o navegador define o boundary. */
  postForm: async <T>(path: string, form: FormData, options: RequestOptions = {}): Promise<T> => {
    const token = getToken();
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      body: form,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) await throwApiError(response, path, token, options);
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  },
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { method: "POST", ...jsonBody(body) }, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { method: "PATCH", ...jsonBody(body) }, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { method: "PUT", ...jsonBody(body) }, options),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { method: "DELETE" }, options),
};

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

