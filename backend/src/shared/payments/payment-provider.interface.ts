/**
 * Provedor de pagamento das MENSALIDADES dos alunos (PLANO_PROJETO.md 10.52). Cada GRUPO conecta a PROPRIA conta do
 * provedor (OAuth do vendedor - modelo marketplace): o dinheiro cai na conta do grupo e o GingApp nunca toca nele.
 *
 * NAO confundir com shared/billing (BillingGatewayService): aquele e a assinatura dos GRUPOS ao GingApp (SaaS).
 *
 * Implementacoes: MercadoPagoProvider (fetch nativo contra a API do Mercado Pago) e StubPaymentProvider (deterministico,
 * sem rede: dev e testes). Escolha por env PAYMENTS_PROVIDER (payments.config.ts). Consumidores dependem SO do token
 * PAYMENT_PROVIDER, nunca da classe concreta. Cartao recorrente / checkout pro / boleto entram como novos metodos aqui.
 *
 * Valores SEMPRE em centavos inteiros na interface (a conversao para o formato do provedor fica no mapeamento dele).
 */

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

/** Tokens do vendedor devolvidos pelo OAuth (em claro SO em memoria: cifrar antes de gravar - payment-crypto.ts). */
export interface ProviderTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Validade do access token (null = o provedor nao informou). */
  expiresAt: Date | null;
  /** Id do vendedor no provedor (MP: user_id = collector_id dos pagamentos). */
  providerUserId: string;
  publicKey: string | null;
  liveMode: boolean;
}

/** Status normalizado do pagamento (o cru do provedor vai em `rawStatus`). */
export type ProviderPaymentStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'CHARGED_BACK'
  | 'UNKNOWN';

export interface ProviderPayment {
  /** Id do pagamento no provedor (texto, mesmo que o provedor use numero). */
  id: string;
  status: ProviderPaymentStatus;
  rawStatus: string;
  statusDetail: string | null;
  /** Valor cobrado, em centavos. */
  amountCents: number;
  externalReference: string | null;
  /** Vendedor dono do pagamento (MP: collector_id), quando informado. */
  collectorId: string | null;
  /** Quando foi aprovado (pago), se aprovado. */
  approvedAt: Date | null;
  expiresAt: Date | null;
  liveMode: boolean | null;
  /** Dados do Pix (so na criacao/pendente). */
  pix: { qrCode: string | null; qrCodeBase64: string | null; ticketUrl: string | null } | null;
}

export interface CreatePixPaymentInput {
  accessToken: string;
  amountCents: number;
  description: string;
  externalReference: string;
  payerEmail: string;
  payerName?: string | null;
  expiresAt: Date;
  /** URL publica do webhook (null = sem notification_url; o webhook do painel do provedor/reconciliacao cobrem). */
  notificationUrl: string | null;
  /** Taxa da plataforma (marketplace), em centavos; 0/undefined = sem taxa. */
  applicationFeeCents?: number;
  /** Chave de idempotencia (mesma chave = mesmo pagamento no provedor). */
  idempotencyKey: string;
}

/**
 * Erro do provedor SEM segredo na mensagem (nunca token/client_secret). `transient` = vale tentar de novo (rede,
 * timeout, 5xx, 429); `status` = HTTP do provedor quando houver; `kind` classifica para o chamador decidir.
 */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'NOT_FOUND' | 'UNAUTHORIZED' | 'INVALID_GRANT' | 'BAD_REQUEST' | 'TRANSIENT' | 'NOT_CONFIGURED' | 'UNKNOWN',
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }

  get transient(): boolean {
    return this.kind === 'TRANSIENT';
  }
}

export interface PaymentProvider {
  /** Identificador gravado em PaymentProviderAccount.provider / FinancialRecord.gatewayProvider. */
  readonly id: string;

  /** O servidor tem as credenciais da aplicacao (client id/secret/redirect)? Sem isso o grupo nao conecta. */
  isConfigured(): boolean;

  /** URL de autorizacao (OAuth) para o Mestre conectar a conta do grupo. `state` ja assinado pelo chamador. */
  buildAuthorizeUrl(state: string): string;

  exchangeCode(code: string): Promise<ProviderTokens>;

  refreshToken(refreshToken: string): Promise<ProviderTokens>;

  createPixPayment(input: CreatePixPaymentInput): Promise<ProviderPayment>;

  getPayment(input: { accessToken: string; paymentId: string }): Promise<ProviderPayment>;

  /** Cancela um pagamento AINDA pendente (Pix nao pago). Lanca se o provedor recusar (ex.: ja aprovado). */
  cancelPayment(input: { accessToken: string; paymentId: string }): Promise<ProviderPayment>;
}
