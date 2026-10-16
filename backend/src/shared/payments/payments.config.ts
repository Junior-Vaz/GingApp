import { isProduction } from '../config/runtime-config';
import { frontendBaseUrl } from '../mail/mail.config';

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
 * Validacao de BOOT (chamada na fabrica do PAYMENT_PROVIDER, shared.module.ts). Desde o modo MANUAL (PLANO_PROJETO.md
 * 10.55) NAO exige mais nada do Mercado Pago no ambiente: so valida PAYMENTS_PROVIDER (stub em producao continua
 * derrubando o boot - configuracao insegura). PAYMENTS_TOKEN_KEY passou a OPCIONAL (recomendada): sem ela a chave dos
 * tokens deriva do JWT_SECRET. Trocar a chave (ou o JWT_SECRET sem PAYMENTS_TOKEN_KEY) torna os tokens gravados
 * ilegiveis: a conta vira ERROR com mensagem clara ("cole as credenciais novamente") no primeiro uso - nunca crash.
 */
export function assertPaymentsBootConfig(env: Env = process.env): void {
  paymentsProviderKind(env);
}

/** PAYMENTS_TOKEN_KEY fixada? (status/diagnostico; sem ela a chave deriva do JWT_SECRET.) */
export function hasDedicatedTokenKey(env: Env = process.env): boolean {
  return clean(env.PAYMENTS_TOKEN_KEY).length > 0;
}

/**
 * Pagamentos online disponiveis no servidor: PAYMENTS_PROVIDER efetivo valido (mercadopago, padrao em producao; ou stub
 * fora de producao). NAO depende de credencial nenhuma no ambiente: cada grupo cola as da PROPRIA conta no painel.
 */
export function paymentsAvailable(env: Env = process.env): boolean {
  try {
    paymentsProviderKind(env);
    return true;
  } catch {
    return false;
  }
}

/** OAuth do vendedor (OPCIONAL/avancado): so com MERCADOPAGO_CLIENT_ID/SECRET/REDIRECT_URI validos no ambiente. */
export function oauthAvailable(env: Env = process.env): boolean {
  return mercadoPagoAppConfig(env) !== null;
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

/**
 * Segredo GLOBAL (do servidor) da assinatura dos webhooks (x-signature). Vazio = nao configurado. Desde o modo MANUAL
 * (10.55) e so COMPATIBILIDADE e SO para contas OAUTH (10.56, A1): o webhook de um grupo MANUAL nunca e conferido com
 * ele (a aplicacao do Mercado Pago do grupo tem outro segredo).
 */
export function webhookSecret(env: Env = process.env): string | null {
  return clean(env.MERCADOPAGO_WEBHOOK_SECRET) || null;
}

/** `?org=<id>` do webhook: inteiro positivo (int4). Qualquer outra coisa = null (tratado como ausente). */
export function parseWebhookOrg(value: unknown): number | null {
  const raw = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  if (!/^\d{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id >= 1 && id <= 2147483647 ? id : null;
}

/**
 * Base PUBLICA do endpoint do webhook (sem query): `${PAINEL_URL}/api/webhooks/mercadopago` (o nginx do painel repassa
 * `/api` ao backend - docs/EASYPANEL.md). Compatibilidade: sem PAINEL_URL, deriva de MERCADOPAGO_REDIRECT_URI trocando
 * `/payments/mercadopago/callback` por `/webhooks/mercadopago`. Nada disso = null.
 */
function webhookBaseUrl(env: Env): URL | null {
  const painel = frontendBaseUrl('PAINEL', env);
  if (painel) {
    try {
      const url = new URL(`${painel}/api/webhooks/mercadopago`);
      url.search = '';
      url.hash = '';
      return url;
    } catch {
      return null;
    }
  }
  const redirect = clean(env.MERCADOPAGO_REDIRECT_URI);
  if (!redirect) return null;
  try {
    const url = new URL(redirect);
    if (!/\/payments\/mercadopago\/callback\/?$/.test(url.pathname)) return null;
    url.pathname = url.pathname.replace(/\/payments\/mercadopago\/callback\/?$/, '/webhooks/mercadopago');
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

/**
 * URL do webhook DO GRUPO para mostrar no painel (o Mestre pode cadastra-la no painel do Mercado Pago, opcional):
 * `${PAINEL_URL}/api/webhooks/mercadopago?org=<id>`. null sem PAINEL_URL (nem MERCADOPAGO_REDIRECT_URI) e tambem quando
 * a base NAO e https (10.56, B9): o provedor nao entrega em http, entao a URL nao e mostrada como utilizavel.
 */
export function groupWebhookUrl(organizationId: number, env: Env = process.env): string | null {
  const url = webhookBaseUrl(env);
  if (!url || url.protocol !== 'https:') return null;
  url.search = `org=${organizationId}`;
  return url.toString();
}

/**
 * notification_url enviada em CADA Pix: a URL do webhook do grupo + `source_news=webhooks` (so webhooks, sem IPN). Assim
 * o grupo NAO precisa cadastrar webhook no painel do Mercado Pago. So https (o provedor recusa/ignora http); sem isso
 * (dev) = null: a consulta do GET /pix e a reconciliacao cobrem.
 */
export function webhookNotificationUrl(organizationId: number, env: Env = process.env): string | null {
  const url = webhookBaseUrl(env);
  if (!url || url.protocol !== 'https:') return null;
  url.search = `org=${organizationId}&source_news=webhooks`;
  return url.toString();
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
/**
 * Janela em que um Pix vencido SEM confirmacao do provedor ainda conta como "nao resolvido" (pagamento no ultimo minuto
 * + webhook atrasado): o GET /pix ainda confere no provedor e a TROCA de conta do grupo fica bloqueada (10.56, M3).
 */
export const PIX_UNRESOLVED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Avisos "assinatura do webhook nao confere": no maximo 1 por grupo nesta janela (10.56, A2). */
export const WEBHOOK_SIGNATURE_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;

const positiveInt = (raw: string | undefined, fallback: number): number => {
  const n = Number(clean(raw));
  return clean(raw) !== '' && Number.isInteger(n) && n >= 0 ? n : fallback;
};

/**
 * Limites dos webhooks SEM assinatura valida (so gatilho), POR PROCESSO (cada replica tem os seus - 10.56, M5):
 *  - `known`: o `data.id` ja e o gatewayPaymentId de um lancamento DO grupo (barato e legitimo): generoso;
 *  - `unknown`: id desconhecido do grupo (pode ser lixo/ataque): apertado;
 *  - `cooldownMs`: mesmo pagamento + mesmo grupo no maximo 1 consulta ao provedor nesse intervalo.
 */
export function webhookUnsignedLimits(env: Env = process.env): { known: number; unknown: number; cooldownMs: number } {
  return {
    known: positiveInt(env.WEBHOOK_UNSIGNED_KNOWN_ORG_LIMIT, 120),
    unknown: positiveInt(env.WEBHOOK_UNSIGNED_ORG_LIMIT, 10),
    cooldownMs: positiveInt(env.WEBHOOK_UNSIGNED_COOLDOWN_MS, 5_000),
  };
}
