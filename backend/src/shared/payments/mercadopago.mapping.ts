import { CreatePixPaymentInput, ProviderPayment, ProviderPaymentStatus, ProviderTokens } from './payment-provider.interface';

/**
 * UNICO lugar que conhece os nomes de campo da API do Mercado Pago (PLANO_PROJETO.md 10.52). Itens marcados com
 * "CONFERIR NO SANDBOX" sao duvidas listadas no plano para o dono validar com contas de teste.
 */
export const MP_API_BASE = 'https://api.mercadopago.com';
export const MP_AUTH_BASE = 'https://auth.mercadopago.com.br/authorization';

/** Valor minimo aceito para Pix (CONFERIR NO SANDBOX: limite real do MP; R$ 1,00 e conservador). */
export const MP_PIX_MIN_AMOUNT_CENTS = 100;

const centsToReais = (cents: number): number => Math.round(cents) / 100;
const reaisToCents = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : NaN);

/**
 * date_of_expiration: ISO 8601 com milissegundos e fuso (ex.: 2026-10-16T12:00:00.000-03:00). Enviamos em UTC
 * explicito ("+00:00"): mesmo instante. (CONFERIR NO SANDBOX: o MP aceita "Z"/"+00:00"; a doc mostra -04:00.)
 */
export function mpDate(date: Date): string {
  return date.toISOString().replace('Z', '+00:00');
}

export function mpAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    response_type: 'code',
    platform_id: 'mp',
    state: input.state,
    redirect_uri: input.redirectUri,
  });
  return `${MP_AUTH_BASE}?${params.toString()}`;
}

/** Corpo do POST /oauth/token (authorization_code ou refresh_token). */
export function mpTokenBody(
  app: { clientId: string; clientSecret: string; redirectUri: string },
  grant: { code: string } | { refreshToken: string },
): Record<string, string> {
  return 'code' in grant
    ? {
        client_id: app.clientId,
        client_secret: app.clientSecret,
        grant_type: 'authorization_code',
        code: grant.code,
        redirect_uri: app.redirectUri,
      }
    : {
        client_id: app.clientId,
        client_secret: app.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: grant.refreshToken,
      };
}

/** Resposta do /oauth/token: access_token, refresh_token, expires_in (s), user_id, public_key, live_mode. */
export function mapMpTokens(body: unknown, now: Date = new Date()): ProviderTokens {
  const data = (body ?? {}) as Record<string, unknown>;
  const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
  const userId = data.user_id;
  if (!accessToken || (typeof userId !== 'number' && typeof userId !== 'string')) {
    throw new Error('Resposta do OAuth do Mercado Pago sem access_token/user_id.');
  }
  const expiresIn = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : null;
  return {
    accessToken,
    refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : null,
    expiresAt: expiresIn ? new Date(now.getTime() + expiresIn * 1000) : null,
    providerUserId: String(userId),
    publicKey: typeof data.public_key === 'string' ? data.public_key : null,
    liveMode: data.live_mode === true,
  };
}

/** Corpo do POST /v1/payments para Pix. */
export function mpPixPaymentBody(input: CreatePixPaymentInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    transaction_amount: centsToReais(input.amountCents),
    description: input.description.slice(0, 200),
    payment_method_id: 'pix',
    external_reference: input.externalReference,
    date_of_expiration: mpDate(input.expiresAt),
    payer: {
      email: input.payerEmail,
      ...(input.payerName ? { first_name: input.payerName.slice(0, 60) } : {}),
    },
  };
  if (input.notificationUrl) body.notification_url = input.notificationUrl;
  // application_fee: comissao do marketplace sobre o pagamento do vendedor (CONFERIR NO SANDBOX: exige a aplicacao
  // configurada como marketplace e o pagamento criado com o access token do vendedor obtido por OAuth).
  if (input.applicationFeeCents && input.applicationFeeCents > 0) body.application_fee = centsToReais(input.applicationFeeCents);
  return body;
}

/**
 * Status do MP -> normalizado. pending/in_process/authorized/in_mediation = PENDING (ainda nao e dinheiro confirmado);
 * so `approved` baixa. Pix vencido vira `cancelled` (status_detail 'expired') no MP.
 */
export function mapMpStatus(raw: string): ProviderPaymentStatus {
  switch (raw) {
    case 'approved':
      return 'APPROVED';
    case 'pending':
    case 'in_process':
    case 'authorized':
    case 'in_mediation':
      return 'PENDING';
    case 'rejected':
      return 'REJECTED';
    case 'cancelled':
      return 'CANCELLED';
    case 'refunded':
      return 'REFUNDED';
    case 'charged_back':
      return 'CHARGED_BACK';
    default:
      return 'UNKNOWN';
  }
}

const dateOrNull = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const strOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : typeof value === 'number' ? String(value) : null;

/** Resposta de /v1/payments (criacao ou consulta). */
export function mapMpPayment(body: unknown): ProviderPayment {
  const data = (body ?? {}) as Record<string, unknown>;
  const id = strOrNull(data.id);
  const rawStatus = typeof data.status === 'string' ? data.status : '';
  const amountCents = reaisToCents(data.transaction_amount);
  if (!id || !rawStatus || Number.isNaN(amountCents)) {
    throw new Error('Resposta de pagamento do Mercado Pago sem id/status/valor.');
  }
  const poi = (data.point_of_interaction ?? {}) as Record<string, unknown>;
  const tx = (poi.transaction_data ?? null) as Record<string, unknown> | null;
  return {
    id,
    status: mapMpStatus(rawStatus),
    rawStatus,
    statusDetail: strOrNull(data.status_detail),
    amountCents,
    externalReference: strOrNull(data.external_reference),
    collectorId: strOrNull(data.collector_id),
    approvedAt: dateOrNull(data.date_approved),
    expiresAt: dateOrNull(data.date_of_expiration),
    liveMode: typeof data.live_mode === 'boolean' ? data.live_mode : null,
    pix: tx
      ? { qrCode: strOrNull(tx.qr_code), qrCodeBase64: strOrNull(tx.qr_code_base64), ticketUrl: strOrNull(tx.ticket_url) }
      : null,
  };
}

/** Corpo do cancelamento de um pagamento pendente: PUT /v1/payments/:id. */
export const MP_CANCEL_BODY = { status: 'cancelled' } as const;

// -------------------------------------------------------------------------------------------------
// external_reference: `gingapp:<orgId>:<financialRecordId>` (o GingApp so confia nisto DEPOIS de buscar o pagamento no
// provedor com o token da propria organizacao).
// -------------------------------------------------------------------------------------------------

export function buildExternalReference(organizationId: number, financialRecordId: number): string {
  return `gingapp:${organizationId}:${financialRecordId}`;
}

export function parseExternalReference(value: string | null | undefined): { organizationId: number; financialRecordId: number } | null {
  const match = /^gingapp:(\d{1,10}):(\d{1,10})$/.exec(value ?? '');
  if (!match) return null;
  const organizationId = Number(match[1]);
  const financialRecordId = Number(match[2]);
  if (!Number.isSafeInteger(organizationId) || !Number.isSafeInteger(financialRecordId)) return null;
  if (organizationId < 1 || financialRecordId < 1 || organizationId > 2147483647 || financialRecordId > 2147483647) return null;
  return { organizationId, financialRecordId };
}
