import { isProduction } from '../config/runtime-config';

/**
 * Configuracao do provedor de pagamento das mensalidades (PLANO_PROJETO.md 10.52), lida do ambiente A CADA chamada
 * (os testes ajustam process.env sem reiniciar o app). Nenhum valor real fica em arquivo: ver backend/.env.example e
 * docs/EASYPANEL.md.
 */
type Env = Record<string, string | undefined>;

const clean = (value: string | undefined): string => (value ?? '').trim();

export type PaymentsProviderKind = 'mercadopago' | 'stub';

/**
 * PAYMENTS_PROVIDER=mercadopago|stub. Padrao: `mercadopago` em producao e `stub` fora dela. O stub (sem rede, aceita
 * qualquer `code`) e PROIBIDO em producao: o boot falha (configuracao insegura, mesmo padrao de runtime-config.ts).
 */
export function paymentsProviderKind(env: Env = process.env): PaymentsProviderKind {
  const raw = clean(env.PAYMENTS_PROVIDER).toLowerCase();
  if (raw && raw !== 'mercadopago' && raw !== 'stub') {
    throw new Error('PAYMENTS_PROVIDER deve ser "mercadopago" ou "stub".');
  }
  const kind: PaymentsProviderKind = (raw as PaymentsProviderKind) || (isProduction(env) ? 'mercadopago' : 'stub');
  if (kind === 'stub' && isProduction(env)) {
    throw new Error('PAYMENTS_PROVIDER=stub nao e permitido em producao (use mercadopago).');
  }
  return kind;
}

/**
 * Validacao de BOOT (chamada na fabrica do PAYMENT_PROVIDER, shared.module.ts): em producao com o Mercado Pago
 * CONFIGURADO (MERCADOPAGO_CLIENT_ID/SECRET/REDIRECT_URI) exige PAYMENTS_TOKEN_KEY - sem ela a chave dos tokens seria o
 * JWT_SECRET (girar o JWT_SECRET derrubaria todas as contas conectadas). Sem o provedor configurado nada e exigido.
 */
export function assertPaymentsBootConfig(env: Env = process.env): void {
  if (!isProduction(env) || paymentsProviderKind(env) !== 'mercadopago' || mercadoPagoAppConfig(env) === null) return;
  if (!clean(env.PAYMENTS_TOKEN_KEY)) {
    throw new Error('PAYMENTS_TOKEN_KEY e obrigatoria em producao com o Mercado Pago configurado (chave longa e aleatoria; nao troque depois).');
  }
}

/**
 * Conta/pagamento de TESTE do provedor (live_mode=false): aceito fora de producao; em producao so com
 * PAYMENTS_ALLOW_TEST_ACCOUNTS=true (homologacao com contas de teste). Sem isso, callback de conta de teste => erro e
 * pagamento de teste nunca da baixa.
 */
export function testModeAllowed(env: Env = process.env): boolean {
  return !isProduction(env) || clean(env.PAYMENTS_ALLOW_TEST_ACCOUNTS).toLowerCase() === 'true';
}

export interface MercadoPagoAppConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Credenciais da APLICACAO do GingApp no Mercado Pago (painel de desenvolvedores). null = nao configurado. */
export function mercadoPagoAppConfig(env: Env = process.env): MercadoPagoAppConfig | null {
  const clientId = clean(env.MERCADOPAGO_CLIENT_ID);
  const clientSecret = clean(env.MERCADOPAGO_CLIENT_SECRET);
  const redirectUri = clean(env.MERCADOPAGO_REDIRECT_URI);
  if (!clientId || !clientSecret || !redirectUri) return null;
  try {
    const url = new URL(redirectUri);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !isProduction(env))) return null;
  } catch {
    return null;
  }
  return { clientId, clientSecret, redirectUri };
}

/** Segredo da assinatura dos webhooks (x-signature). Vazio = nao configurado. */
export function webhookSecret(env: Env = process.env): string | null {
  return clean(env.MERCADOPAGO_WEBHOOK_SECRET) || null;
}

/**
 * URL publica do webhook enviada como notification_url em cada Pix: derivada de MERCADOPAGO_REDIRECT_URI trocando
 * `/payments/mercadopago/callback` por `/webhooks/mercadopago` (mesma API, mesmo prefixo /api) e com
 * `source_news=webhooks` (so webhooks, sem IPN). Fora desse formato (ou sem https) = null: o webhook cadastrado no
 * painel do Mercado Pago + a reconciliacao cobrem.
 */
export function webhookNotificationUrl(env: Env = process.env): string | null {
  const redirect = clean(env.MERCADOPAGO_REDIRECT_URI);
  if (!redirect) return null;
  try {
    const url = new URL(redirect);
    if (url.protocol !== 'https:') return null;
    if (!/\/payments\/mercadopago\/callback\/?$/.test(url.pathname)) return null;
    url.pathname = url.pathname.replace(/\/payments\/mercadopago\/callback\/?$/, '/webhooks/mercadopago');
    url.search = 'source_news=webhooks';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** PAYMENTS_APPLICATION_FEE_PERCENT (0..50, padrao 0): taxa da plataforma sobre cada Pix (application_fee). */
export function applicationFeePercent(env: Env = process.env): number {
  const raw = clean(env.PAYMENTS_APPLICATION_FEE_PERCENT);
  if (!raw) return 0;
  const value = Number(raw.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0 || value > 50) {
    throw new Error('PAYMENTS_APPLICATION_FEE_PERCENT deve ser um numero entre 0 e 50.');
  }
  return value;
}

/** Taxa em centavos (arredondada para baixo: nunca cobra a mais do grupo). */
export function applicationFeeCents(amountCents: number, env: Env = process.env): number {
  return Math.floor((amountCents * applicationFeePercent(env)) / 100);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** PAYMENTS_FALLBACK_PAYER_EMAIL: e-mail tecnico usado como payer.email quando aluno/responsavel nao tem e-mail. */
export function fallbackPayerEmail(env: Env = process.env): string | null {
  const value = clean(env.PAYMENTS_FALLBACK_PAYER_EMAIL);
  return value && EMAIL_RE.test(value) ? value : null;
}

export function isValidEmail(value: string | null | undefined): value is string {
  return !!value && EMAIL_RE.test(value.trim());
}

/** PAYMENTS_RECONCILE_CRON=false desliga a reconciliacao periodica dos Pix pendentes (padrao: ligada). */
export function isPaymentsReconcileCronEnabled(env: Env = process.env): boolean {
  return env.PAYMENTS_RECONCILE_CRON !== 'false';
}

/** Validade de cada Pix gerado (24 h): mensalidade, sem pressa; o pendente valido e reaproveitado. */
export const PIX_EXPIRATION_MINUTES = 24 * 60;
/** Um Pix que vence em menos que isto nao e reaproveitado (o pagador precisa de tempo para pagar). */
export const PIX_REUSE_MIN_REMAINING_MS = 10 * 60 * 1000;
/** Renova o access token quando faltar menos que isto para vencer (MP: tokens de ~180 dias). */
export const TOKEN_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Validade do `state` do OAuth. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
/** Tolerancia do `ts` da assinatura do webhook (rejeita notificacao velha/replay). */
export const WEBHOOK_MAX_AGE_MS = 10 * 60 * 1000;
