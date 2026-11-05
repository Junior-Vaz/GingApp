/**
 * Patrocinadores do GRUPO (Frente A / Fase 2): tipos, listas fixas, formatação e VALIDAÇÕES do contrato
 * (docs/CONTRATO_PATROCINADORES_GRUPO.md e docs/CONTRATO_PATROCINADORES.md). O servidor continua sendo a validação de
 * verdade; aqui só se evita ir à rede à toa e se dá a mensagem em português ao vivo.
 *
 * Lógica pura portada do admin Vue (src/utils/sponsors.ts), SEM UF e SEM peso (campanha de grupo não tem nenhum dos dois)
 * e com a validação de URL do §4.4 (porta, domínio com acento/`xn--`, caracteres invisíveis, barra invertida, sufixos).
 */
import { ApiError } from "@/lib/api";

// ---------------------------------------------------------------- limites do contrato

export const SPONSOR_LIMITS = {
  nameMin: 2,
  nameMax: 80,
  notesMax: 1000,
  titleMin: 2,
  titleMax: 60,
  textMin: 2,
  textMax: 90,
  ctaMin: 2,
  ctaMax: 24,
  urlMax: 500,
  windowMaxDays: 366,
  /** Observação de cobrança (privada do Mestre): limite informativo, o contrato não fixa. */
  billingNoteMax: 1000,
  /** Por grupo (409 SPONSOR_LIMIT). */
  maxSponsors: 10,
  maxCampaigns: 10,
  maxActiveCampaigns: 3,
} as const;

export const DEFAULT_CTA_LABEL = "Conhecer";

/** Peso final máximo da imagem/logo de patrocinador (contrato do grupo §3: 250 KB). */
export const SPONSOR_IMAGE_MAX_BYTES = 250 * 1024;
export const SPONSOR_IMAGE_RECOMMENDED = { width: 1200, height: 630 } as const;
export const SPONSOR_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

// ---------------------------------------------------------------- avisos fixos (texto exato exigido pelo contrato)

export const SPONSOR_NOTICES = {
  minors: "Menores de 18 anos não veem patrocinadores.",
  badge: "O anúncio sempre mostra o selo Patrocinado.",
  activeLimit: "No máximo 3 campanhas ativas ao mesmo tempo.",
  prohibited:
    "Categorias proibidas: bebidas alcoólicas, apostas, tabaco, conteúdo adulto, crédito predatório, política partidária.",
} as const;

// ---------------------------------------------------------------- categorias (lista branca)

export type SponsorCategory =
  | "INSTRUMENTOS"
  | "VESTUARIO"
  | "SAUDE"
  | "EDUCACAO"
  | "EVENTOS_TURISMO"
  | "ALIMENTACAO"
  | "ESPORTES";

export const SPONSOR_CATEGORIES: ReadonlyArray<{ value: SponsorCategory; label: string }> = [
  { value: "INSTRUMENTOS", label: "Instrumentos" },
  { value: "VESTUARIO", label: "Vestuário" },
  { value: "SAUDE", label: "Saúde" },
  { value: "EDUCACAO", label: "Educação" },
  { value: "EVENTOS_TURISMO", label: "Eventos e turismo" },
  { value: "ALIMENTACAO", label: "Alimentação" },
  { value: "ESPORTES", label: "Esportes" },
];

export function categoryLabel(value: string): string {
  return SPONSOR_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

// ---------------------------------------------------------------- status

export type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED";
export type EffectiveStatus = "DRAFT" | "PAUSED" | "SCHEDULED" | "ACTIVE_NOW" | "ENDED";

/** Rótulo escrito + cores (o texto sempre aparece: a cor nunca é a única informação). */
export const EFFECTIVE_STATUS_META: Record<EffectiveStatus, { label: string; classes: string; hint: string }> = {
  DRAFT: { label: "Rascunho", classes: "bg-slate-100 text-slate-800 ring-slate-300", hint: "Ainda não foi ativada: não aparece no app." },
  PAUSED: { label: "Pausada", classes: "bg-amber-100 text-amber-900 ring-amber-300", hint: "Pausada: não aparece no app." },
  SCHEDULED: { label: "Agendada", classes: "bg-sky-100 text-sky-900 ring-sky-300", hint: "Ativada, mas ainda não chegou a data de início." },
  ACTIVE_NOW: { label: "No ar agora", classes: "bg-emerald-100 text-emerald-900 ring-emerald-300", hint: "Aparecendo no app neste momento." },
  ENDED: { label: "Encerrada", classes: "bg-zinc-200 text-zinc-800 ring-zinc-400", hint: "A data de fim já passou." },
};

/** Ordem dos chips de filtro. */
export const EFFECTIVE_STATUS_ORDER: readonly EffectiveStatus[] = ["ACTIVE_NOW", "SCHEDULED", "DRAFT", "PAUSED", "ENDED"];

export function effectiveStatusLabel(status: string): string {
  return EFFECTIVE_STATUS_META[status as EffectiveStatus]?.label ?? status;
}

// ---------------------------------------------------------------- modelos de resposta (formatos do contrato)

export interface GroupSponsor {
  id: number;
  name: string;
  logo: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  document: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** Opcional: o contrato não promete este contador; usado só se vier. */
  campaignsCount?: number;
}

export interface GroupCampaign {
  id: number;
  sponsorId: number;
  /** O contrato da Fase 1 traz `sponsor:{id,name,logo}` e `sponsorName`; aceitamos os dois. */
  sponsor?: { id: number; name: string; logo?: string | null } | null;
  sponsorName?: string;
  title: string;
  text: string;
  imageRef: string | null;
  ctaLabel: string;
  destinationUrl: string;
  destinationHost?: string;
  category: SponsorCategory;
  startsAt: string;
  endsAt: string;
  status: CampaignStatus;
  effectiveStatus: EffectiveStatus;
  priceCents: number | null;
  billingNote: string | null;
  approvedByUserId: number | null;
  approvedAt: string | null;
  approvedBy?: { id: number; name: string } | null;
  /** Suspensa PELA PLATAFORMA: o Mestre não retoma (sem botão). */
  platformSuspended: boolean;
  platformSuspendReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SponsorTerms {
  version: string;
  text: string;
  accepted: boolean;
  acceptedAt: string | null;
  /** Plataforma bloqueou o patrocínio local do grupo. */
  blocked: boolean;
  blockedReason: string | null;
}

export interface CampaignReport {
  campaign: { id: number; title: string; sponsorName: string; startsAt: string; endsAt: string; status: string };
  totals: { impressions: number; clicks: number; ctr: number };
  byDay: Array<{ day: string; impressions: number; clicks: number }>;
  byState: Array<{ state: string; impressions: number; clicks: number }>;
}

/** Por que o botão "Ativar" está desabilitado (null = pode ativar). */
export function activateBlockReason(terms: SponsorTerms | undefined): string | null {
  if (!terms) return "Não foi possível verificar o termo de responsabilidade. Recarregue a página para ativar campanhas.";
  if (!terms.accepted) return "Aceite o termo de responsabilidade (aba Termo) para ativar campanhas.";
  if (terms.blocked) return "O patrocínio do seu grupo está bloqueado pela plataforma: não é possível ativar campanhas.";
  return null;
}

export function campaignSponsorName(campaign: GroupCampaign, fallback?: readonly GroupSponsor[]): string {
  return (
    campaign.sponsor?.name ??
    campaign.sponsorName ??
    fallback?.find((s) => s.id === campaign.sponsorId)?.name ??
    `Patrocinador #${String(campaign.sponsorId)}`
  );
}

// ---------------------------------------------------------------- URL de destino — validação ao vivo

export interface UrlCheck {
  /** Impede salvar. */
  error: string | null;
  /** Aviso mostrado junto do erro quando o endereço não é https. */
  warning: string | null;
}

const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".home.arpa"];
/** Sufixos que o servidor também recusa (contrato §4.4). */
const BLOCKED_SUFFIXES = [".test", ".onion", ".arpa"];
/** Faixas de code points de controle/invisiveis (C0, DEL/C1, hifen suave, espacos de largura zero, separadores, BOM). */
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x200b, 0x200f],
  [0x2028, 0x202f],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
];
const hasInvisible = (value: string): boolean =>
  Array.from(value).some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return INVISIBLE_RANGES.some(([from, to]) => code >= from && code <= to);
  });

function isIpHost(hostname: string): boolean {
  if (hostname.startsWith("[") || hostname.includes(":")) return true; // IPv6
  if (/^\d+(\.\d+){0,3}$/.test(hostname)) return true; // IPv4 (o parser já normaliza formas como 2130706433)
  return /^0x[0-9a-f]+(\.|$)/i.test(hostname);
}

/** Parte "host[:porta]" do texto digitado (entre `//` e o primeiro `/ ? #`), sem usuário/senha. */
function rawAuthority(value: string): string {
  const afterScheme = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const authority = afterScheme.split(/[/?#]/, 1)[0] ?? "";
  return authority.slice(authority.lastIndexOf("@") + 1);
}

/**
 * Analisa o endereço digitado. Regras: só https, sem usuário/senha, host por NOME (nada de IP/localhost/rede privada),
 * sem porta, sem acento/`xn--` no domínio, sem barra invertida nem caracteres invisíveis, até 500 caracteres.
 */
export function checkDestinationUrl(raw: string): UrlCheck {
  const value = raw.trim();
  if (!value) return { error: "Informe o endereço de destino (link do patrocinador).", warning: null };
  if (value.length > SPONSOR_LIMITS.urlMax) {
    return {
      error: `O endereço pode ter no máximo ${String(SPONSOR_LIMITS.urlMax)} caracteres (tem ${String(value.length)}).`,
      warning: null,
    };
  }
  if (/\s/.test(value)) return { error: "O endereço não pode ter espaços.", warning: null };
  if (hasInvisible(value)) return { error: "O endereço tem caracteres invisíveis ou de controle. Digite-o de novo.", warning: null };
  if (value.includes("\\")) return { error: "O endereço não pode ter barra invertida (\\). Use a barra normal (/).", warning: null };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {
      error: /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
        ? "Endereço inválido. Confira se está completo (ex.: https://www.loja.com.br/pagina)."
        : "Comece o endereço com https:// (ex.: https://www.loja.com.br/pagina).",
      warning: null,
    };
  }

  if (url.protocol === "http:") {
    return {
      error: "Só aceitamos links seguros (https://). Peça ao patrocinador o endereço com https.",
      warning: 'Este link não é seguro (http): o navegador do aluno avisaria "não seguro". Use a versão https.',
    };
  }
  if (url.protocol !== "https:") {
    return { error: "Só aceitamos links que começam com https://.", warning: "Este link não usa https." };
  }
  if (url.username || url.password) {
    return { error: "O endereço não pode conter usuário ou senha (ex.: https://usuario:senha@site.com).", warning: null };
  }

  const authority = rawAuthority(value);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isIpHost(host)) {
    return { error: "Use o endereço pelo nome do site (ex.: www.loja.com.br). Endereços numéricos (IP) não são aceitos.", warning: null };
  }
  if (host === "localhost" || !host.includes(".") || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) {
    return {
      error: "Use um site público na internet: endereços locais ou de rede interna (localhost, .local, .internal…) não são aceitos.",
      warning: null,
    };
  }
  if (Array.from(authority).some((ch) => (ch.codePointAt(0) ?? 0) > 0x7f) || host.split(".").some((label) => label.startsWith("xn--"))) {
    return {
      error: "O nome do site não pode ter acentos nem outros caracteres especiais. Use o endereço em letras sem acento.",
      warning: null,
    };
  }
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { error: "Esse final de endereço (.test, .onion, .arpa) não é aceito. Use um site público.", warning: null };
  }
  // O parser do navegador descarta a porta padrão (:443); o texto digitado ainda a mostra. Qualquer porta é recusada.
  if (/:\d*$/.test(authority) && !authority.startsWith("[")) {
    return { error: "O endereço não pode ter porta (ex.: :8080). Remova o trecho depois do nome do site.", warning: null };
  }
  return { error: null, warning: null };
}

export function validateDestinationUrl(raw: string): string | null {
  return checkDestinationUrl(raw).error;
}

// ---------------------------------------------------------------- datas (fuso de São Paulo, UTC-3 fixo)

const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-11-10T08:00" (campo datetime-local, hora de Brasília) -> ISO UTC. null se inválido. */
export function localToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const date = new Date(`${local}:00-03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ISO UTC -> "YYYY-MM-DDTHH:mm" em hora de Brasília (valor de campo datetime-local). */
export function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  return new Date(ms - SP_OFFSET_MS).toISOString().slice(0, 16);
}

/** Dia civil (YYYY-MM-DD) em São Paulo de um instante. */
export function spDay(value: Date | string): string {
  const ms = (value instanceof Date ? value : new Date(value)).getTime();
  return new Date(ms - SP_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS);
}

/** "2026-11-04" -> "04/11". */
export function shortDay(day: string): string {
  const [, month, date] = day.split("-");
  return `${date ?? ""}/${month ?? ""}`;
}

/** "2026-11-04" -> "04/11/2026". */
export function longDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date ?? ""}/${month ?? ""}/${year ?? ""}`;
}

/** Instante -> "04/11/2026 08:00" em hora de Brasília (independe do fuso do navegador). */
export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return "";
  const local = isoToLocal(iso);
  return local ? `${longDay(local.slice(0, 10))} ${local.slice(11)}` : "";
}

// ---------------------------------------------------------------- dinheiro

/** "1.234,56" | "1234.56" | "R$ 10" -> centavos. '' -> null (sem preço). Inválido -> 'invalid'. */
export function reaisToCents(text: string): number | null | "invalid" {
  const clean = text.replace(/R\$/gi, "").replace(/\s/g, "");
  if (clean === "") return null;
  let normalized: string;
  if (clean.includes(",")) {
    if (!/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(clean)) return "invalid";
    normalized = clean.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+\.\d{1,2}$/.test(clean)) {
    normalized = clean;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(clean)) {
    normalized = clean.replace(/\./g, "");
  } else if (/^\d+$/.test(clean)) {
    normalized = clean;
  } else {
    return "invalid";
  }
  const [whole = "0", decimals = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : "invalid";
}

export function centsToReaisText(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

const INT_MAX = 2_147_483_647;

// ---------------------------------------------------------------- formulário de campanha (SEM UF e SEM peso)

export interface CampaignFormState {
  sponsorId: string;
  title: string;
  text: string;
  imageRef: string;
  ctaLabel: string;
  destinationUrl: string;
  category: string;
  startsAt: string;
  endsAt: string;
  price: string;
  billingNote: string;
}

export function emptyCampaignForm(): CampaignFormState {
  return {
    sponsorId: "",
    title: "",
    text: "",
    imageRef: "",
    ctaLabel: DEFAULT_CTA_LABEL,
    destinationUrl: "",
    category: "",
    startsAt: "",
    endsAt: "",
    price: "",
    billingNote: "",
  };
}

export function campaignToForm(c: GroupCampaign): CampaignFormState {
  return {
    sponsorId: String(c.sponsorId),
    title: c.title,
    text: c.text,
    imageRef: c.imageRef ?? "",
    ctaLabel: c.ctaLabel,
    destinationUrl: c.destinationUrl,
    category: c.category,
    startsAt: isoToLocal(c.startsAt),
    endsAt: isoToLocal(c.endsAt),
    price: centsToReaisText(c.priceCents),
    billingNote: c.billingNote ?? "",
  };
}

export type CampaignFieldErrors = Partial<Record<keyof CampaignFormState, string>>;

/** Valida o formulário inteiro (mesmas regras do contrato). Objeto vazio = válido. */
export function validateCampaignForm(form: CampaignFormState): CampaignFieldErrors {
  const errors: CampaignFieldErrors = {};
  const L = SPONSOR_LIMITS;

  if (!form.sponsorId) errors.sponsorId = "Escolha o patrocinador.";

  const title = form.title.trim();
  if (title.length < L.titleMin || title.length > L.titleMax) {
    errors.title = `O título deve ter de ${String(L.titleMin)} a ${String(L.titleMax)} caracteres.`;
  }
  const text = form.text.trim();
  if (text.length < L.textMin || text.length > L.textMax) {
    errors.text = `O texto deve ter de ${String(L.textMin)} a ${String(L.textMax)} caracteres.`;
  }
  const cta = form.ctaLabel.trim();
  if (cta.length < L.ctaMin || cta.length > L.ctaMax) {
    errors.ctaLabel = `O texto do botão deve ter de ${String(L.ctaMin)} a ${String(L.ctaMax)} caracteres.`;
  }

  const urlError = validateDestinationUrl(form.destinationUrl);
  if (urlError) errors.destinationUrl = urlError;

  if (!SPONSOR_CATEGORIES.some((c) => c.value === form.category)) errors.category = "Escolha uma categoria da lista.";

  const start = localToIso(form.startsAt);
  const end = localToIso(form.endsAt);
  if (!start) errors.startsAt = "Informe a data e hora de início.";
  if (!end) errors.endsAt = "Informe a data e hora de fim.";
  if (start && end) {
    const span = Date.parse(end) - Date.parse(start);
    if (span <= 0) errors.endsAt = "O fim deve ser depois do início.";
    else if (span > L.windowMaxDays * DAY_MS) {
      errors.endsAt = `A campanha pode durar no máximo ${String(L.windowMaxDays)} dias.`;
    }
  }

  const cents = reaisToCents(form.price);
  if (cents === "invalid") errors.price = "Valor inválido. Use o formato 1.500,00.";
  else if (cents !== null && cents > INT_MAX) errors.price = "Valor alto demais.";

  if (form.billingNote.length > L.billingNoteMax) {
    errors.billingNote = `A observação pode ter no máximo ${String(L.billingNoteMax)} caracteres.`;
  }
  return errors;
}

/**
 * Corpo do POST/PATCH da campanha DE GRUPO (contrato §1/§3): nunca leva `states` nem `weight` (o servidor devolve 400 se vierem).
 * Chamar só com o formulário válido.
 */
export function campaignPayload(form: CampaignFormState) {
  const cents = reaisToCents(form.price);
  return {
    sponsorId: Number(form.sponsorId),
    title: form.title.trim(),
    text: form.text.trim(),
    imageRef: form.imageRef.trim() || null,
    ctaLabel: form.ctaLabel.trim(),
    destinationUrl: form.destinationUrl.trim(),
    category: form.category,
    startsAt: localToIso(form.startsAt),
    endsAt: localToIso(form.endsAt),
    priceCents: cents === "invalid" ? null : cents,
    billingNote: form.billingNote.trim() || null,
  };
}

/** Campos de CONTEÚDO: mudar qualquer um numa campanha ATIVA ou PAUSADA a devolve a rascunho. */
export const CONTENT_FIELDS = ["sponsorId", "title", "text", "imageRef", "ctaLabel", "destinationUrl", "category"] as const;

export function contentChanged(original: CampaignFormState, current: CampaignFormState): boolean {
  return CONTENT_FIELDS.some((field) => original[field].trim() !== current[field].trim());
}

// ---------------------------------------------------------------- formulário de patrocinador

export interface SponsorFormState {
  name: string;
  logo: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  document: string;
  notes: string;
}

export function emptySponsorForm(): SponsorFormState {
  return { name: "", logo: "", contactName: "", contactEmail: "", contactPhone: "", document: "", notes: "" };
}

export function sponsorToForm(s: GroupSponsor): SponsorFormState {
  return {
    name: s.name,
    logo: s.logo ?? "",
    contactName: s.contactName ?? "",
    contactEmail: s.contactEmail ?? "",
    contactPhone: s.contactPhone ?? "",
    document: s.document ?? "",
    notes: s.notes ?? "",
  };
}

export type SponsorFieldErrors = Partial<Record<keyof SponsorFormState, string>>;

export function validateSponsorForm(form: SponsorFormState): SponsorFieldErrors {
  const errors: SponsorFieldErrors = {};
  const name = form.name.trim();
  if (name.length < SPONSOR_LIMITS.nameMin || name.length > SPONSOR_LIMITS.nameMax) {
    errors.name = `O nome deve ter de ${String(SPONSOR_LIMITS.nameMin)} a ${String(SPONSOR_LIMITS.nameMax)} caracteres.`;
  }
  const email = form.contactEmail.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.contactEmail = "Informe um e-mail válido.";
  if (form.notes.length > SPONSOR_LIMITS.notesMax) {
    errors.notes = `As observações podem ter no máximo ${String(SPONSOR_LIMITS.notesMax)} caracteres.`;
  }
  return errors;
}

/** Corpo do POST/PATCH do patrocinador: campos vazios viram null (limpam o valor no PATCH). */
export function sponsorPayload(form: SponsorFormState) {
  const orNull = (v: string) => v.trim() || null;
  return {
    name: form.name.trim(),
    logo: orNull(form.logo),
    contactName: orNull(form.contactName),
    contactEmail: orNull(form.contactEmail),
    contactPhone: orNull(form.contactPhone),
    document: orNull(form.document),
    notes: orNull(form.notes),
  };
}

// ---------------------------------------------------------------- erros 400 do servidor por campo

export interface ServerErrors {
  /** campo -> mensagem (o servidor começa a frase com o nome do campo, ex.: "title deve ter…"). */
  fields: Record<string, string>;
  /** mensagens que não citam um campo conhecido: mostradas em bloco. */
  general: string[];
}

/**
 * Separa as mensagens de um 400 (class-validator: `message` é uma lista; cada frase começa com o nome do campo, às vezes
 * com índice). Aceita também `{ field, message }` (ex.: INVALID_DESTINATION_URL). O que não casa com um campo conhecido
 * vai para `general`.
 */
export function serverFieldErrors(error: unknown, knownFields: readonly string[]): ServerErrors {
  const result: ServerErrors = { fields: {}, general: [] };
  if (!(error instanceof ApiError)) return result;
  const body = (error.body ?? {}) as { message?: unknown; field?: unknown };
  const messages: string[] = Array.isArray(body.message)
    ? body.message.filter((m): m is string => typeof m === "string")
    : typeof body.message === "string"
      ? [body.message]
      : [];
  if (messages.length === 0) {
    if (error.message) result.general.push(error.message);
    return result;
  }
  for (const message of messages) {
    const explicit =
      typeof body.field === "string" && knownFields.includes(body.field) && messages.length === 1 ? body.field : null;
    const lead = /^([A-Za-z_]\w*)(?:[.[]\S*?)?:?\s/.exec(message)?.[1];
    const field = explicit ?? (lead && knownFields.includes(lead) ? lead : null);
    if (field) result.fields[field] = result.fields[field] ? `${result.fields[field]} ${message}` : message;
    else result.general.push(message);
  }
  return result;
}

// ---------------------------------------------------------------- imagens

/** Erro (pt-BR) de um arquivo de imagem antes de enviar; null = ok. Peso máximo = 250 KB; só JPEG/PNG/WebP. */
export function validateSponsorImageFile(file: { type: string; size: number }): string | null {
  if (!(SPONSOR_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return "Formato não aceito: envie uma imagem JPEG, PNG ou WebP.";
  }
  if (file.size === 0) return "O arquivo está vazio.";
  if (file.size > SPONSOR_IMAGE_MAX_BYTES) {
    return `A imagem tem ${String(Math.ceil(file.size / 1024))} KB e o limite é ${String(SPONSOR_IMAGE_MAX_BYTES / 1024)} KB. Reduza o tamanho ou a qualidade (recomendado ${String(SPONSOR_IMAGE_RECOMMENDED.width)}×${String(SPONSOR_IMAGE_RECOMMENDED.height)} px, WebP ou JPEG).`;
  }
  return null;
}

// ---------------------------------------------------------------- relatório

export function formatPercent(value: number): string {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function formatInt(value: number): string {
  return value.toLocaleString("pt-BR");
}

/** Nome da UF para a tabela do relatório; '' = a região não pôde ser identificada. */
export function stateReportLabel(state: string): string {
  return state ? state : "Não identificada";
}

/** Completa com zeros os dias sem dado entre `from` e `to` (inclusive) para o gráfico ficar contínuo. Máx. 400 dias. */
export function fillDays(
  rows: ReadonlyArray<{ day: string; impressions: number; clicks: number }>,
  from: string,
  to: string,
): Array<{ day: string; impressions: number; clicks: number }> {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const total = daysBetween(from, to);
  if (!Number.isFinite(total) || total < 0 || total > 400) return [...rows].sort((a, b) => a.day.localeCompare(b.day));
  const out: Array<{ day: string; impressions: number; clicks: number }> = [];
  for (let i = 0; i <= total; i++) {
    const day = addDays(from, i);
    out.push(byDay.get(day) ?? { day, impressions: 0, clicks: 0 });
  }
  return out;
}

/** Período padrão do relatório: últimos 30 dias, limitados à vigência (nunca antes do início nem depois do fim/hoje). */
export function defaultReportRange(startsAt: string, endsAt: string, now: Date = new Date()): { from: string; to: string } {
  const today = spDay(now);
  const startDay = spDay(startsAt);
  const lastDay = spDay(new Date(Date.parse(endsAt) - 1)); // endsAt é exclusivo
  let to = today < lastDay ? today : lastDay;
  if (to < startDay) to = startDay;
  let from = addDays(to, -29);
  if (from < startDay) from = startDay;
  return { from, to };
}

/** Nome do arquivo do CSV do relatório: `campanha-<id>-<from>_a_<to>.csv`. */
export function reportCsvFilename(campaignId: number, range: { from: string; to: string }): string {
  return `campanha-${String(campaignId)}-${range.from}_a_${range.to}.csv`;
}
