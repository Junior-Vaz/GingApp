import { ApiError, errorMessage } from "@/lib/api";
import { formatCurrency, fmt, toDate } from "@/lib/format";
import type { FinanceRecord } from "./finance-utils";

/**
 * Cobrança de mensalidade por Pix via Mercado Pago (cada grupo conecta a PRÓPRIA conta e recebe direto;
 * o webhook do backend dá a baixa). Tipos do contrato + regras puras de apresentação.
 */

export type PixStatus = "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";
export type PaidVia = "MANUAL" | "PIX_AUTO" | null;

/** Resumo do Pix mais recente do lançamento, em GET /finance (null = nunca gerou Pix). */
export interface PixSummary {
  status: PixStatus;
  expiresAt: string;
  generatedAt: string;
}

/** POST/GET /finance/:id/pix. */
export interface PixCharge {
  financeRecordId: number;
  amountCents: number;
  status: PixStatus;
  /** Pix "copia e cola". */
  qrCode: string;
  /** PNG em base64 (sem prefixo `data:`), quando o Mercado Pago envia. */
  qrCodeBase64?: string | null | undefined;
  ticketUrl?: string | null | undefined;
  expiresAt: string;
  generatedAt: string;
}

/** GET /payments/mercadopago/status (só o MESTRE). */
export interface MercadoPagoStatus {
  /** 'mercadopago' (real) ou 'stub' (ambiente sem pagamentos reais). */
  provider: string;
  /** O servidor aceita cobranças por Pix (false = "Pix automático indisponível neste ambiente"). */
  available: boolean;
  /** O servidor também oferece a conexão por autorização (OAuth); opcional, o caminho principal é colar o token. */
  oauthAvailable: boolean;
  /** Como a conta foi conectada: token colado (MANUAL) ou autorização (OAUTH). */
  mode: "MANUAL" | "OAUTH" | null;
  connected: boolean;
  liveMode: boolean;
  providerUserId: string | null;
  connectedAt: string | null;
  status: "CONNECTED" | "REVOKED" | "ERROR" | "NOT_CONNECTED";
  /** Últimos 4 caracteres do Access Token (o token inteiro nunca volta do servidor; não identifica o token). */
  tokenHint: string | null;
  publicKey: string | null;
  hasWebhookSecret: boolean;
  /** false = há segredo do webhook salvo, mas ele não pode mais ser lido (o Mestre cola de novo). */
  webhookSecretReadable?: boolean | undefined;
  /** URL do webhook do GingApp (já enviada em cada Pix; só para conferência/cópia). null = sem https no servidor. */
  webhookUrl: string | null;
  /** Motivo curto (texto do servidor, sem segredo) quando status = ERROR. */
  lastError?: string | null | undefined;
}

/**
 * PUT /payments/mercadopago/credentials: campo ausente = não muda; string vazia em publicKey/webhookSecret = limpa;
 * accessToken é obrigatório na primeira conexão e exige a senha atual (currentPassword) e, com 2FA ativo, o código.
 */
export interface MercadoPagoCredentialsInput {
  accessToken?: string | undefined;
  publicKey?: string | undefined;
  webhookSecret?: string | undefined;
  currentPassword?: string | undefined;
  twoFactorCode?: string | undefined;
}

export const MP_TOKEN_MIN_LENGTH = 20;

/** Problema do Access Token digitado/colado (null = ok ou ainda vazio). Nunca ecoa o valor. */
export function accessTokenProblem(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/\s/.test(value)) return "O token não pode ter espaços nem quebras de linha. Copie de novo, só o código.";
  if (value.length < MP_TOKEN_MIN_LENGTH) return "O token parece curto demais. Confira se copiou o código completo.";
  return null;
}

/**
 * Só os campos preenchidos (trim) vão no PUT; vazio = não muda. Exceção: com `initialPublicKey` (atualização), esvaziar
 * a chave pública envia "" (limpa) e mantê-la igual não envia nada. A senha (sem trim) e o código 2FA só vão junto do
 * Access Token (reautenticação exigida pelo servidor).
 */
export function buildCredentialsPayload(
  fields: { accessToken?: string; publicKey?: string; webhookSecret?: string; currentPassword?: string; twoFactorCode?: string },
  options: { initialPublicKey?: string | null } = {},
): MercadoPagoCredentialsInput {
  const out: MercadoPagoCredentialsInput = {};
  const accessToken = fields.accessToken?.trim();
  const publicKey = fields.publicKey?.trim();
  const webhookSecret = fields.webhookSecret?.trim();
  const initialPublicKey = options.initialPublicKey?.trim() || "";
  if (accessToken) {
    out.accessToken = accessToken;
    if (fields.currentPassword) out.currentPassword = fields.currentPassword;
    const code = fields.twoFactorCode?.trim();
    if (code) out.twoFactorCode = code;
  }
  if (publicKey && publicKey !== initialPublicKey) out.publicKey = publicKey;
  else if (!publicKey && initialPublicKey) out.publicKey = "";
  if (webhookSecret) out.webhookSecret = webhookSecret;
  return out;
}

export const MP_PIX_OPEN_MESSAGE = "Há Pix em aberto. Aguarde pagarem/expirarem ou cancele-os antes de trocar a conta.";

/** Bloqueio de troca de conta com Pix em aberto (o backend pode nomear o código de formas diferentes). */
export function isPixOpenBlockCode(code: string | undefined): boolean {
  if (!code) return false;
  const upper = code.toUpperCase();
  return upper.includes("PIX") && (upper.includes("OPEN") || upper.includes("ACCOUNT"));
}

const MP_CREDENTIAL_ERRORS: Record<string, string> = {
  INVALID_CREDENTIALS: "O Mercado Pago recusou o token. Confira se copiou o Access Token de produção, completo, da conta que vai receber.",
  ACCESS_TOKEN_REQUIRED: "Informe o Access Token do Mercado Pago.",
  MP_ACCOUNT_ERROR: "Não foi possível usar a conta do Mercado Pago. Confira o token e tente de novo.",
  PAYMENTS_UNAVAILABLE: "Pagamentos online não estão disponíveis no momento.",
  PROVIDER_UNAVAILABLE: "O Mercado Pago não respondeu. Tente de novo em instantes.",
  REAUTH_REQUIRED: "Digite a sua senha para confirmar.",
  INVALID_PASSWORD: "Senha incorreta. Digite a senha que você usa para entrar no painel.",
  TWO_FACTOR_REQUIRED: "Digite o código do seu aplicativo autenticador (verificação em duas etapas).",
  INVALID_TWO_FACTOR_CODE: "Código de verificação incorreto. Confira o código no aplicativo autenticador.",
  WEBHOOK_SECRET_NOT_SUPPORTED: "Na conexão por autorização o segredo do webhook não é usado.",
};

/** Códigos em que o formulário passa a pedir o código do aplicativo autenticador (2FA). */
export const MP_TWO_FACTOR_CODES: readonly string[] = ["TWO_FACTOR_REQUIRED", "INVALID_TWO_FACTOR_CODE"];

/**
 * Mensagem amigável para erros de salvar/desconectar as credenciais. Nunca usa o texto do servidor (por segurança,
 * para jamais ecoar o token); sem código conhecido cai no `fallback`.
 */
export function mpCredentialsErrorMessage(
  error: unknown,
  fallback = "Não foi possível salvar as credenciais do Mercado Pago. Tente novamente.",
): string {
  const code = pixErrorCode(error);
  if (isPixOpenBlockCode(code)) return MP_PIX_OPEN_MESSAGE;
  if (code && MP_CREDENTIAL_ERRORS[code]) return MP_CREDENTIAL_ERRORS[code];
  return fallback;
}

/** Lançamento mudou (talvez pago por Pix) desde que o formulário o leu: PATCH 409 RECORD_CHANGED. */
export const RECORD_CHANGED_MESSAGE = "O lançamento foi alterado (talvez pago por Pix). Recarregue.";

/** Lançamento pago via Pix automático: PATCH não pode mudar status/valor (409 RECORD_PAID_VIA_PIX). */
export const RECORD_PAID_VIA_PIX_MESSAGE = "Este lançamento foi pago por Pix. Para desfazer, use Estornar.";

/** Códigos de erro do PATCH/DELETE de /finance/:id relacionados ao Pix -> mensagem amigável. */
export const FINANCE_PIX_CONFLICT_ERRORS: Record<string, string> = {
  RECORD_CHANGED: RECORD_CHANGED_MESSAGE,
  RECORD_PAID_VIA_PIX: RECORD_PAID_VIA_PIX_MESSAGE,
  RECORD_HAS_PIX:
    "Este lançamento tem um Pix em aberto ou foi pago por Pix. Cancele o lançamento (o Pix aberto é cancelado no Mercado Pago) ou estorne antes de excluir.",
};

/** Códigos estáveis de erro do Pix (corpo padrão do projeto) -> mensagem amigável para a gestão. */
const PIX_ERRORS: Record<string, string> = {
  MP_NOT_CONNECTED: "O grupo ainda não conectou o Mercado Pago. Conecte na aba “Receber por Pix”.",
  MP_ACCOUNT_ERROR: "A conta do Mercado Pago do grupo precisa ser reconectada pelo Mestre.",
  RECORD_NOT_PAYABLE: "Este lançamento não pode ser cobrado por Pix (está cancelado ou não tem valor a receber).",
  ALREADY_PAID: "Este lançamento já está pago.",
  PAYER_EMAIL_REQUIRED: "Cadastre um e-mail do aluno ou responsável para gerar o Pix.",
  AMOUNT_TOO_LOW: "O valor é baixo demais para ser cobrado por Pix pelo Mercado Pago.",
  PIX_PENDING_AMOUNT_CHANGED: "Há um Pix pendente com o valor anterior; tente de novo em alguns minutos.",
  PROVIDER_UNAVAILABLE: "O Mercado Pago não respondeu. Tente de novo em instantes.",
  PROVIDER_ERROR: "O Mercado Pago recusou a operação. Confira a conta conectada do grupo.",
  PAYMENTS_UNAVAILABLE: "Pagamentos online não estão disponíveis no momento.",
  PIX_NOT_FOUND: "Nenhum Pix foi gerado para este lançamento.",
  ACCOUNT_CHANGED: "A conta do Mercado Pago do grupo mudou enquanto o Pix era gerado. Tente de novo.",
  RECORD_CHANGED: RECORD_CHANGED_MESSAGE,
  RECORD_PAID_VIA_PIX: RECORD_PAID_VIA_PIX_MESSAGE,
};

/** Códigos em que o Mestre resolve reconectando o Mercado Pago (o diálogo oferece o atalho). */
export const PIX_RECONNECT_CODES: readonly string[] = ["MP_NOT_CONNECTED", "MP_ACCOUNT_ERROR"];

export const pixErrorCode = (error: unknown): string | undefined => (error instanceof ApiError ? error.code : undefined);

export function pixErrorMessage(error: unknown): string {
  const code = pixErrorCode(error);
  if (code && PIX_ERRORS[code]) return PIX_ERRORS[code];
  return errorMessage(error, "Não foi possível gerar o Pix. Tente novamente.");
}

/** Mensagem amigável para um erro de PATCH/DELETE de lançamento ligado ao Pix; undefined = usar a mensagem do servidor. */
export function financePixConflictMessage(error: unknown): string | undefined {
  const code = pixErrorCode(error);
  return code ? FINANCE_PIX_CONFLICT_ERRORS[code] : undefined;
}

/** Retorno do OAuth do Mercado Pago em `?mp=pix-aberto`: troca de conta recusada por haver Pix em aberto da conta anterior. */
export const MP_SWITCH_BLOCKED_MESSAGE =
  "Não foi possível trocar a conta do Mercado Pago: há Pix em aberto da conta atual. Aguarde o pagamento ou o vencimento (até 24 h) ou cancele esses lançamentos e tente de novo.";

/** Imagem do QR: o PNG do Mercado Pago (aceita com ou sem o prefixo `data:`); null = gerar a partir do copia e cola. */
export function qrImageSrc(charge: Pick<PixCharge, "qrCodeBase64">): string | null {
  const raw = charge.qrCodeBase64?.trim();
  if (!raw) return null;
  return raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
}

export const formatPixExpiry = (iso: string): string => fmt(toDate(iso), "dd/MM/yyyy 'às' HH:mm");

/** Texto pronto para enviar ao aluno/responsável (só o necessário: descrição, valor, validade e o copia e cola). */
export function pixShareText(description: string, charge: PixCharge): string {
  return `Olá! Segue o Pix da cobrança "${description}" (${formatCurrency(charge.amountCents)}), válido até ${formatPixExpiry(charge.expiresAt)}. Pix copia e cola:\n${charge.qrCode}`;
}

export const pixWhatsAppUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export type PixBadgeKind = "waiting" | "paid-auto" | "expired";

export const PIX_BADGE_LABEL: Record<PixBadgeKind, string> = {
  waiting: "Pix aguardando",
  "paid-auto": "Pago via Pix (automático)",
  expired: "Pix expirado",
};

export const PIX_BADGE_CLASS: Record<PixBadgeKind, string> = {
  waiting: "bg-sky-100 text-sky-700",
  "paid-auto": "bg-emerald-100 text-emerald-700",
  expired: "bg-slate-100 text-slate-600",
};

/**
 * Selo do Pix de um lançamento. Pago -> só "Pago via Pix (automático)" quando a baixa veio do webhook;
 * em aberto -> "Pix aguardando" (PENDING ainda dentro da validade) ou "Pix expirado" (EXPIRED, ou PENDING
 * já vencido no relógio). Cancelado/sem Pix -> nenhum selo.
 */
export function pixBadgeKind(
  record: Pick<FinanceRecord, "status" | "paidVia" | "pix">,
  now: number = Date.now(),
): PixBadgeKind | null {
  if (record.status === "PAID") return record.paidVia === "PIX_AUTO" ? "paid-auto" : null;
  if (record.status === "CANCELLED" || !record.pix) return null;
  if (record.pix.status === "EXPIRED") return "expired";
  if (record.pix.status === "PENDING") return toDate(record.pix.expiresAt).getTime() < now ? "expired" : "waiting";
  return null;
}

/** Só quem está em aberto (PENDING/OVERDUE) pode gerar Pix. */
export const canGeneratePix = (record: Pick<FinanceRecord, "status">): boolean =>
  record.status === "PENDING" || record.status === "OVERDUE";
