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

/** Nome do header com o total de registros que casam com o filtro (listagens paginadas). */
const TOTAL_COUNT_HEADER = "X-Total-Count";

async function requestRaw<T>(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<{ data: T; total: number | null }> {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (response.status === 401 && !options.skipAuthRedirect) {
      clearSession();
      unauthorizedHandler?.();
    }
    throw new ApiError(
      extractMessage(body) ?? `Erro ${response.status} ao chamar ${path}`,
      response.status,
    );
  }

  // Corpo vazio pode vir com 204 OU 200/201 - .text() primeiro é seguro para os dois casos.
  const text = await response.text();
  const header = response.headers.get(TOTAL_COUNT_HEADER);
  const total = header !== null && header.trim() !== "" && Number.isFinite(Number(header)) ? Number(header) : null;
  return { data: (text ? JSON.parse(text) : undefined) as T, total };
}

async function request<T>(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T> {
  return (await requestRaw<T>(path, init, options)).data;
}

/** Uma página de uma listagem: `total` = registros que casam com o filtro (null se o servidor não informou). */
export interface Page<T> {
  items: T[];
  total: number | null;
}

const jsonBody = (body: unknown): { body?: string } =>
  body === undefined ? {} : { body: JSON.stringify(body) };

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { method: "GET" }, options),
  /** GET de uma listagem paginada (corpo = array) lendo o total do header X-Total-Count. */
  getPage: async <T>(path: string, options?: RequestOptions): Promise<Page<T>> => {
    const { data, total } = await requestRaw<T[]>(path, { method: "GET" }, options);
    return { items: data ?? [], total };
  },
  /** GET de um corpo (objeto) que também traz o total no header X-Total-Count (ex.: /attendance/me). */
  getWithTotal: <T>(path: string, options?: RequestOptions) =>
    requestRaw<T>(path, { method: "GET" }, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { method: "POST", ...jsonBody(body) }, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { method: "PATCH", ...jsonBody(body) }, options),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { method: "DELETE" }, options),
};

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
