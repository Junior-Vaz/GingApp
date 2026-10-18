import { api, ApiError } from "@/lib/api";
import { formatCpf, formatPhone, isValidCpf, onlyDigits } from "@/lib/cpf";
import { dayOnly, fmt, toDate } from "@/lib/format";

/* ---------- Contrato da API pública de inscrição (GET/POST /public/forms/:slug/...) ---------- */

export type FormFieldType =
  | "SHORT_TEXT"
  | "LONG_TEXT"
  | "NUMBER"
  | "EMAIL"
  | "PHONE"
  | "CPF"
  | "DATE"
  | "SINGLE_CHOICE"
  | "MULTI_CHOICE"
  | "SELECT"
  | "CONSENT"
  | "FILE"
  | "INFO";

export type ClosedReason = "NOT_OPEN_YET" | "CLOSED" | "FULL" | "DEADLINE";
export type PaymentMode = "NONE" | "PIX_MANUAL" | "PIX_AUTO";
/** Chave Pix do formulário (backend real: `keyType`/`beneficiary` podem vir `null` se o Mestre não os preencheu). */
export type PixInfo = { key: string; keyType: string | null; beneficiary: string | null };

/** Ids de seção são NÚMEROS no backend real (`sections[].id` e `fields[].sectionId`). */
export type SectionId = number | string;

export interface FormFieldDef {
  key: string;
  type: FormFieldType;
  label: string;
  helpText: string | null;
  required: boolean;
  options: string[] | null;
  validation: Record<string, unknown> | null;
  showIf: { fieldKey: string; equals: string | number | boolean } | null;
  sectionId: SectionId | null;
  order: number;
  mapsTo: string | null;
}

/** GET /api/public/forms/:slug (conferido contra o backend real). `priceCents` é `null` quando gratuito. */
export interface PublicForm {
  slug: string;
  title: string;
  intro: string | null;
  bannerUrl: string | null;
  status: string;
  isOpen: boolean;
  closedReason: ClosedReason | null;
  event: { title: string; date: string | null; location: string | null } | null;
  paymentMode: PaymentMode;
  priceCents: number | null;
  pix: PixInfo | null;
  sections: { id: SectionId; order?: number; title: string; description: string | null }[];
  fields: FormFieldDef[];
  /** `version` é um número inteiro (sobe quando o organizador muda o texto). */
  consent: { text: string; version: number | string };
  spotsLeft: number | null;
  /** Assinado pelo servidor no GET: volta no POST no lugar do antigo `startedAt` (prova o tempo de preenchimento). */
  startedToken: string;
}

export interface FileAnswer {
  fileToken: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export type AnswerValue = string | string[] | boolean | FileAnswer;
export type Answers = Record<string, AnswerValue | undefined>;

export type SubmissionStatus = "PENDING" | "CONFIRMED" | "WAITLIST" | "REJECTED" | "CANCELLED";

/** 201 de POST /public/forms/:slug/submissions. `paymentStatus`: NOT_REQUIRED | PENDING | CONFIRMED. */
export interface SubmissionResult {
  protocol: string;
  status: SubmissionStatus;
  paymentStatus: string | null;
  message: string | null;
  payment: { mode: PaymentMode; amountCents: number | null; pix: PixInfo | null } | null;
  proofRequired: boolean;
}

export interface LookupResult {
  protocol: string;
  status: SubmissionStatus;
  paymentStatus: string | null;
  message: string | null;
}

export interface UploadedFile {
  fileToken: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

/* ---------- Chamadas (sempre anônimas: sem token, 401 nunca derruba a sessão) ---------- */

const ANON = { anonymous: true } as const;
const base = (slug: string) => `/public/forms/${encodeURIComponent(slug)}`;

export const fetchPublicForm = (slug: string) => api.get<PublicForm>(base(slug), ANON);

export function uploadFormFile(slug: string, fieldKey: string, file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);
  form.append("fieldKey", fieldKey);
  return api.postForm<UploadedFile>(`${base(slug)}/files`, form, ANON);
}

export interface SubmissionPayload {
  answers: Record<string, unknown>;
  consent: true;
  /** `consent.version` do formulário que a pessoa LEU (o servidor recusa com 409 CONSENT_OUTDATED se mudou). */
  consentVersion: number;
  hp: string;
  /** `startedToken` devolvido pelo GET (o servidor ainda aceita `startedAt` legado, mas o app não o envia mais). */
  startedToken: string;
}

export const submitRegistration = (slug: string, payload: SubmissionPayload) =>
  api.post<SubmissionResult>(`${base(slug)}/submissions`, payload, ANON);

export const lookupRegistration = (slug: string, body: { protocol: string; email?: string; document?: string }) =>
  api.post<LookupResult>(`${base(slug)}/lookup`, body, ANON);

/* ---------- Regras do formulário (cliente; o servidor revalida tudo) ---------- */

/** Ordem de exibição: `order` crescente (estável: empate mantém a ordem recebida). */
export function sortedFields(form: Pick<PublicForm, "fields">): FormFieldDef[] {
  return form.fields
    .map((field, index) => ({ field, index }))
    .sort((a, b) => a.field.order - b.field.order || a.index - b.index)
    .map((item) => item.field);
}

function matchesEquals(answer: AnswerValue | undefined, equals: string | number | boolean): boolean {
  if (answer === undefined) return false;
  if (Array.isArray(answer)) return answer.includes(String(equals));
  if (typeof answer === "object") return false;
  return String(answer) === String(equals);
}

/**
 * Campos visíveis dado o que já foi respondido. `showIf {fieldKey, equals}`: aparece só quando a resposta do campo
 * `fieldKey` for igual a `equals` (MULTI_CHOICE: contém). Um campo cujo "controlador" está oculto também fica oculto
 * (e as respostas de campos ocultos nunca contam, nem são enviadas).
 */
export function visibleFields(form: Pick<PublicForm, "fields">, answers: Answers): FormFieldDef[] {
  const byKey = new Map(form.fields.map((field) => [field.key, field]));
  const memo = new Map<string, boolean>();
  const isVisible = (field: FormFieldDef, trail: Set<string>): boolean => {
    const cached = memo.get(field.key);
    if (cached !== undefined) return cached;
    let visible = true;
    if (field.showIf) {
      const controller = byKey.get(field.showIf.fieldKey);
      if (!controller || trail.has(field.key)) {
        visible = false; // referência quebrada ou ciclo: nunca mostra (o servidor também não exigiria)
      } else {
        trail.add(field.key);
        visible = isVisible(controller, trail) && matchesEquals(answers[controller.key], field.showIf.equals);
        trail.delete(field.key);
      }
    }
    memo.set(field.key, visible);
    return visible;
  };
  return sortedFields(form).filter((field) => isVisible(field, new Set()));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isValidEmail = (value: string): boolean => EMAIL_RE.test(value.trim());

/** Data civil yyyy-MM-dd válida, de 1900 a 2100 (a mesma janela do servidor). */
const isValidIsoDate = (value: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  if (year < 1900 || year > 2100) return false;
  const date = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3])));
  return date.getUTCFullYear() === year && date.getUTCMonth() === Number(m[2]) - 1 && date.getUTCDate() === Number(m[3]);
};

/**
 * Telefone BR como o SERVIDOR confere: 10 ou 11 dígitos com DDD (aceita o prefixo 55); o DDD não começa nem termina em 0;
 * celular (11 dígitos) tem o 9 depois do DDD. Sem isto o app aceitava "(62) 12345-6789" e o servidor devolvia 400.
 */
export function isRegistrationPhone(value: string): boolean {
  let d = onlyDigits(value);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return false;
  if (d[0] === "0" || d[1] === "0") return false;
  return d.length === 10 || d[2] === "9";
}

/** Limites padrão do texto no servidor quando o formulário não define `maxLength`. */
const TEXT_DEFAULT_MAX = { SHORT_TEXT: 300, LONG_TEXT: 5000 } as const;

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Número digitado (aceita vírgula decimal). `null` = não é um número. */
export function parseNumber(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Resposta vazia (para obrigatoriedade e para não enviar campos opcionais em branco). */
export function isEmptyAnswer(value: AnswerValue | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "boolean") return !value;
  return !value.fileToken;
}

/** Mensagem de erro (pt-BR) de UM campo visível; `null` = ok. */
export function validateField(field: FormFieldDef, value: AnswerValue | undefined): string | null {
  if (field.type === "INFO") return null;
  if (isEmptyAnswer(value)) {
    if (!field.required) return null;
    if (field.type === "CONSENT") return "É preciso aceitar para continuar.";
    if (field.type === "FILE") return "Anexe o arquivo para continuar.";
    if (field.type === "MULTI_CHOICE") return "Selecione ao menos uma opção.";
    if (field.type === "SINGLE_CHOICE" || field.type === "SELECT") return "Escolha uma opção.";
    return "Campo obrigatório.";
  }
  const text = typeof value === "string" ? value.trim() : "";
  const rules = field.validation ?? {};
  switch (field.type) {
    case "EMAIL":
      return isValidEmail(text) ? null : "Informe um e-mail válido.";
    case "CPF":
      return isValidCpf(text) ? null : "CPF inválido. Confira os números.";
    case "PHONE":
      return isRegistrationPhone(text) ? null : "Informe um telefone válido com DDD.";
    case "DATE":
      return isValidIsoDate(text) ? null : "Informe uma data válida.";
    case "NUMBER": {
      const n = parseNumber(text);
      if (n === null) return "Informe um número válido.";
      const min = num(rules["min"]);
      const max = num(rules["max"]);
      if (min !== null && n < min) return `O valor mínimo é ${min}.`;
      if (max !== null && n > max) return `O valor máximo é ${max}.`;
      return null;
    }
    case "SHORT_TEXT":
    case "LONG_TEXT": {
      const minLength = num(rules["minLength"]);
      const maxLength = Math.min(num(rules["maxLength"]) ?? Infinity, TEXT_DEFAULT_MAX[field.type]);
      if (minLength !== null && text.length < minLength) return `Escreva pelo menos ${minLength} caracteres.`;
      if (text.length > maxLength) return `Use no máximo ${maxLength} caracteres.`;
      return null;
    }
    case "SINGLE_CHOICE":
    case "SELECT":
      return field.options && !field.options.includes(text) ? "Escolha uma das opções." : null;
    case "MULTI_CHOICE":
      return field.options && Array.isArray(value) && value.some((v) => !field.options!.includes(v))
        ? "Escolha apenas as opções da lista."
        : null;
    default:
      return null;
  }
}

/** Erros por chave dos campos VISÍVEIS (campos ocultos por `showIf` não são validados). */
export function validateAnswers(form: Pick<PublicForm, "fields">, answers: Answers): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of visibleFields(form, answers)) {
    const message = validateField(field, answers[field.key]);
    if (message) errors[field.key] = message;
  }
  return errors;
}

/** Monta `answers` do POST: só campos visíveis e preenchidos; texto aparado; número vira number; arquivo vira {fileToken}. */
export function buildAnswers(form: Pick<PublicForm, "fields">, answers: Answers): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of visibleFields(form, answers)) {
    if (field.type === "INFO") continue;
    const value = answers[field.key];
    // CONSENT sempre vai como booleano explícito: o aceite opcional desmarcado é `false` (não pode ser omitido).
    if (field.type === "CONSENT") {
      out[field.key] = value === true;
      continue;
    }
    if (isEmptyAnswer(value)) continue;
    if (field.type === "FILE") out[field.key] = { fileToken: (value as FileAnswer).fileToken };
    else if (field.type === "MULTI_CHOICE") out[field.key] = value as string[];
    else if (field.type === "NUMBER") out[field.key] = parseNumber(value as string) ?? (value as string).trim();
    else out[field.key] = typeof value === "string" ? value.trim() : value;
  }
  return out;
}

/** Aplica a máscara de digitação do tipo (CPF/telefone); os demais tipos passam direto. */
export function maskInput(type: FormFieldType, value: string): string {
  if (type === "CPF") return formatCpf(value);
  if (type === "PHONE") return formatPhone(value);
  return value;
}

/* ---------- Arquivo (comprovante/documento) ---------- */

export const FILE_MAX_BYTES = 5 * 1024 * 1024;
export const FILE_ACCEPT = "image/*,application/pdf";
const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/** Erro amigável antes de gastar rede; `null` = ok. O servidor confere o tipo real de novo. */
export function validateProofFile(file: { type: string; size: number }): string | null {
  if (!FILE_TYPES.includes(file.type)) return "Formato não aceito. Envie uma foto (JPG, PNG ou WEBP) ou um PDF.";
  if (file.size === 0) return "O arquivo está vazio. Escolha outro.";
  if (file.size > FILE_MAX_BYTES) return "O arquivo é maior que 5 MB. Escolha um arquivo menor.";
  return null;
}

/** Botão do upload: "comprovante" quando o campo é de pagamento, senão "arquivo". */
export const fileButtonLabel = (field: Pick<FormFieldDef, "label">): string =>
  /comprovante|pix|pagamento/i.test(field.label) ? "Anexar comprovante" : "Anexar arquivo";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/* ---------- Mensagens ---------- */

export const NOT_FOUND_MESSAGE = "Formulário não encontrado ou indisponível.";

const CLOSED_MESSAGES: Record<ClosedReason, string> = {
  NOT_OPEN_YET: "As inscrições ainda não abriram. Volte em breve.",
  CLOSED: "As inscrições estão encerradas.",
  FULL: "As vagas estão esgotadas.",
  DEADLINE: "O prazo de inscrição terminou.",
};

export const closedMessage = (reason: ClosedReason | null | undefined): string =>
  (reason && CLOSED_MESSAGES[reason]) || "As inscrições não estão disponíveis no momento.";

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  PENDING: "Recebida, aguardando análise",
  CONFIRMED: "Confirmada",
  WAITLIST: "Em lista de espera",
  REJECTED: "Não aprovada",
  CANCELLED: "Cancelada",
};

export const statusLabel = (status: string): string => STATUS_LABEL[status as SubmissionStatus] ?? status;

const PAYMENT_LABEL: Record<string, string> = {
  PENDING: "Pagamento pendente",
  AWAITING_PAYMENT: "Aguardando pagamento",
  AWAITING_PROOF: "Aguardando comprovante",
  IN_REVIEW: "Comprovante em análise",
  PAID: "Pagamento confirmado",
  CONFIRMED: "Pagamento confirmado",
  REFUNDED: "Pagamento devolvido",
  NOT_REQUIRED: "Sem pagamento",
  NONE: "Sem pagamento",
};

/** Sem cobrança (gratuito ou inscrição recusada/cancelada): não há linha de pagamento a mostrar. */
const NO_PAYMENT_LINE = new Set(["NOT_REQUIRED", "NONE"]);

export const paymentStatusLabel = (status: string | null | undefined): string | null =>
  status && !NO_PAYMENT_LINE.has(status) ? (PAYMENT_LABEL[status] ?? null) : null;

export type SubmitFailure =
  | { kind: "validation"; fields: Record<string, string>; message: string }
  | { kind: "consent-outdated"; message: string }
  | { kind: "closed"; reason: ClosedReason | null; message: string }
  | { kind: "full"; message: string }
  | { kind: "duplicate"; message: string }
  | { kind: "rate"; message: string }
  | { kind: "network"; message: string }
  | { kind: "other"; message: string };

export const RATE_LIMIT_MESSAGE = "Muitas tentativas. Aguarde um minuto.";
export const NETWORK_MESSAGE = "Sem conexão com o servidor. Verifique sua internet e tente de novo.";
export const DUPLICATE_MESSAGE = "Já existe uma inscrição com estes dados. Consulte pelo protocolo.";
export const CONSENT_OUTDATED_MESSAGE = "O termo foi atualizado. Leia e aceite novamente.";

const CLOSED_REASONS: ClosedReason[] = ["NOT_OPEN_YET", "CLOSED", "FULL", "DEADLINE"];

/** Traduz a falha de um POST (submissions) para o que a tela precisa mostrar. */
export function classifySubmitError(error: unknown): SubmitFailure {
  if (!(error instanceof ApiError)) return { kind: "network", message: NETWORK_MESSAGE };
  const body = (error.body ?? {}) as { fields?: unknown; closedReason?: unknown };
  if (error.status === 429) return { kind: "rate", message: RATE_LIMIT_MESSAGE };
  if (error.status === 400 && error.code === "VALIDATION") {
    const fields: Record<string, string> = {};
    if (body.fields && typeof body.fields === "object") {
      for (const [key, value] of Object.entries(body.fields as Record<string, unknown>)) {
        if (typeof value === "string" && value) fields[key] = value;
      }
    }
    // 400 VALIDATION SEM campos (`fields: {}`): são as recusas gerais do servidor (honeypot, tempo de preenchimento,
    // envio grande demais). Mostra a mensagem DELE ("Recarregue a página…"), não "confira os campos destacados".
    const message = Object.keys(fields).length === 0 && error.message ? error.message : "Confira os campos destacados.";
    return { kind: "validation", fields, message };
  }
  if (error.status === 409 && error.code === "ALREADY_REGISTERED") return { kind: "duplicate", message: DUPLICATE_MESSAGE };
  if (error.status === 409 && error.code === "CONSENT_OUTDATED") return { kind: "consent-outdated", message: CONSENT_OUTDATED_MESSAGE };
  if (error.status === 409 && error.code === "FORM_FULL") {
    return { kind: "full", message: closedMessage("FULL") };
  }
  if (error.status === 410) {
    const reason = CLOSED_REASONS.find((r) => r === body.closedReason) ?? null;
    return { kind: "closed", reason, message: closedMessage(reason ?? "CLOSED") };
  }
  return { kind: "other", message: "Não foi possível enviar sua inscrição agora. Tente novamente em instantes." };
}

/** Mensagem de falha do upload do comprovante. */
export function uploadErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Falha de conexão ao enviar o arquivo. Toque em tentar de novo.";
  if (error.status === 429) return RATE_LIMIT_MESSAGE;
  // 410 FORM_CLOSED (encerrou/lotou enquanto a pessoa preenchia): o corpo traz `closedReason`.
  if (error.status === 410) {
    const reason = CLOSED_REASONS.find((r) => r === (error.body as { closedReason?: unknown } | undefined)?.closedReason) ?? null;
    return closedMessage(reason ?? "CLOSED");
  }
  if (error.code === "FILE_TYPE_NOT_ALLOWED") return "Formato não aceito. Envie uma foto (JPG, PNG ou WEBP) ou um PDF.";
  if (error.code === "FILE_TOO_LARGE" || error.status === 413) return "O arquivo é maior que 5 MB. Escolha um arquivo menor.";
  return "Não foi possível enviar o arquivo. Toque em tentar de novo.";
}

/** Copia para a área de transferência (API moderna; fallback para execCommand em navegadores/WebViews antigos). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = typeof document.execCommand === "function" && document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

const PIX_KEY_TYPES: Record<string, string> = {
  CPF: "CPF",
  CNPJ: "CNPJ",
  EMAIL: "E-mail",
  PHONE: "Telefone",
  RANDOM: "Chave aleatória",
  EVP: "Chave aleatória",
};

export const pixKeyTypeLabel = (type: string | null | undefined): string => (type ? (PIX_KEY_TYPES[type.toUpperCase()] ?? type) : "Chave Pix");

/* ---------- Formatação ---------- */

/** Data do evento: "só dia" (meia-noite UTC) mostra o dia; com horário mostra dia e hora locais. */
export function formatEventDate(iso: string): string {
  if (/T00:00:00(\.000)?Z$/.test(iso) || /^\d{4}-\d{2}-\d{2}$/.test(iso)) return fmt(dayOnly(iso), "dd/MM/yyyy");
  return fmt(toDate(iso), "dd/MM/yyyy 'às' HH:mm");
}

/** Documento (CPF) ou e-mail digitado na consulta: devolve o campo certo do corpo do POST. */
export function lookupIdentity(value: string): { email?: string; document?: string } {
  const text = value.trim();
  if (text.includes("@")) return { email: text };
  return { document: onlyDigits(text) };
}

/* ---------- Texto simples seguro (introdução, ajuda, termo): quebras de linha + links, NUNCA HTML ---------- */

export type TextPart = { type: "text"; text: string } | { type: "link"; href: string; text: string };

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const TRAILING = /[.,;:!?)\]}]+$/;

/** Quebra o texto em pedaços de texto e links http(s). Nada é interpretado como HTML. */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const url = raw.replace(TRAILING, "");
    let valid = false;
    try {
      const parsed = new URL(url);
      valid = parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      valid = false;
    }
    if (!valid) continue;
    if (start > last) parts.push({ type: "text", text: text.slice(last, start) });
    parts.push({ type: "link", href: url, text: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}
