import { clearSession, getToken } from "@/lib/session";

/** URL base da API (NestJS). Embutida no bundle em tempo de build. */
export const API_URL: string =
  (import.meta.env["VITE_API_URL"] as string | undefined) ?? "http://localhost:3000/api";

export class ApiError extends Error {
  status: number;
  /** Codigo de negocio opcional do corpo do erro (ex.: 'EVENT_FULL' no 409 de evento lotado). */
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    if (code !== undefined) this.code = code;
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

/** Erro de resposta nao-ok: trata o 401 (sessao expirada) e devolve o ApiError com a mensagem do servidor. */
async function failure(
  response: Response,
  path: string,
  tokenUsed: string | null,
  options: RequestOptions,
): Promise<ApiError> {
  const body = await response.json().catch(() => null);
  // 401 de uma chamada feita com um token que JÁ FOI TROCADO (troca de senha enquanto ela estava em
  // voo) é obsoleto: a sessão atual é outra e válida - não pode ser derrubada por ele.
  if (response.status === 401 && !options.skipAuthRedirect && getToken() === tokenUsed) {
    clearSession();
    unauthorizedHandler?.();
  }
  const code = (body as { code?: unknown } | null)?.code;
  return new ApiError(
    extractMessage(body) ?? `Erro ${response.status} ao chamar ${path}`,
    response.status,
    typeof code === "string" ? code : undefined,
  );
}

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

  if (!response.ok) throw await failure(response, path, token, options);

  // Corpo vazio pode vir com 204 OU 200/201 - .text() primeiro é seguro para os dois casos.
  const text = await response.text();
  const header = response.headers.get(TOTAL_COUNT_HEADER);
  const total = header !== null && header.trim() !== "" && Number.isFinite(Number(header)) ? Number(header) : null;
  return { data: (text ? JSON.parse(text) : undefined) as T, total };
}

/** GET autenticado de um arquivo (ex.: PDF): devolve o corpo como Blob; erros seguem o mesmo contrato do JSON. */
async function requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw await failure(response, path, token, options);
  return response.blob();
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
  /** GET autenticado de um arquivo binário (PDF etc.) como Blob. */
  getBlob: (path: string, options?: RequestOptions) => requestBlob(path, options),
  /** POST multipart (upload de arquivo): sem Content-Type manual - o navegador define o boundary. */
  postForm: async <T>(path: string, form: FormData, options: RequestOptions = {}): Promise<T> => {
    const token = getToken();
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      body: form,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw await failure(response, path, token, options);
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
  /** DELETE com corpo JSON (ex.: DELETE /push/subscribe {endpoint}). */
  deleteWithBody: <T>(path: string, body: unknown, options?: RequestOptions) =>
    request<T>(path, { method: "DELETE", ...jsonBody(body) }, options),
};

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
