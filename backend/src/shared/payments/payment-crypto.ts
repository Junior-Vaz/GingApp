import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolveJwtSecret } from '../config/runtime-config';
import { aesGcmDecrypt, aesGcmEncrypt, deriveSubkey } from '../security/aes-gcm';
import { OAUTH_STATE_TTL_MS, WEBHOOK_MAX_AGE_MS } from './payments.config';

/**
 * Criptografia do modulo de pagamentos (PLANO_PROJETO.md 10.52), sobre o SSOT shared/security/aes-gcm.ts:
 *  - tokens OAuth do vendedor: AES-256-GCM com subchave propria (HKDF info 'provider-token');
 *  - `state` do OAuth: HMAC-SHA256 com outra subchave (info 'oauth-state');
 *  - assinatura do webhook do Mercado Pago (x-signature): HMAC-SHA256 com MERCADOPAGO_WEBHOOK_SECRET.
 * Chave-mestra PRIMARIA (cifra) = PAYMENTS_TOKEN_KEY (OPCIONAL, recomendada) ou, na falta, o JWT_SECRET (10.55: o boot
 * nao exige a chave). Decifrar tenta uma LISTA (PLANO_PROJETO.md 10.56, M2): [PAYMENTS_TOKEN_KEY, PAYMENTS_TOKEN_KEY_PREVIOUS,
 * derivada do JWT_SECRET] - definir a PAYMENTS_TOKEN_KEY DEPOIS (ou rotaciona-la guardando a antiga em _PREVIOUS) nao
 * quebra as contas ja gravadas; quem decifra com chave nao-primaria re-cifra com a primaria (rotacao preguicosa, no
 * PaymentAccountService). Trocar o JWT_SECRET SEM PAYMENTS_TOKEN_KEY (e sem o antigo em _PREVIOUS) torna os tokens
 * ilegiveis: no primeiro uso a conta vira ERROR com aviso ao Mestre para colar as credenciais de novo (nunca crash).
 * Comparacoes de assinatura SEMPRE em tempo constante.
 */
const HKDF_SALT = 'gingapp-payments-v1';

function masterKey(): string {
  return process.env.PAYMENTS_TOKEN_KEY?.trim() || resolveJwtSecret(process.env.JWT_SECRET);
}

/** Chaves-mestras aceitas para DECIFRAR, a primaria primeiro (sem repeticao). */
function decryptMasterKeys(): string[] {
  let jwtDerived = '';
  try {
    jwtDerived = resolveJwtSecret(process.env.JWT_SECRET);
  } catch {
    jwtDerived = ''; // JWT_SECRET invalido para o ambiente: so as chaves explicitas valem
  }
  const keys = [masterKey(), process.env.PAYMENTS_TOKEN_KEY_PREVIOUS?.trim() || '', jwtDerived].filter((k) => k.length > 0);
  return [...new Set(keys)];
}

const tokenKey = (): Buffer => deriveSubkey(masterKey(), HKDF_SALT, 'provider-token');
const stateKey = (): Buffer => deriveSubkey(masterKey(), HKDF_SALT, 'oauth-state');

/**
 * Contexto do token: entra como AAD (`<grupo>:<provedor>`) - um token copiado para a linha de OUTRO grupo nao decifra.
 * `purpose` separa segredos diferentes da MESMA linha (ex.: 'webhook-secret' => AAD `<grupo>:<provedor>:webhook-secret`):
 * o segredo do webhook copiado para a coluna do access token (ou vice-versa) nao decifra.
 */
export interface ProviderTokenContext {
  organizationId: number;
  provider: string;
  purpose?: 'webhook-secret';
}

const tokenAad = (ctx: ProviderTokenContext): string =>
  ctx.purpose ? `${ctx.organizationId}:${ctx.provider}:${ctx.purpose}` : `${ctx.organizationId}:${ctx.provider}`;

/** Cifra no formato `v2:` (com AAD do grupo+provedor). */
export function encryptProviderToken(plain: string, ctx: ProviderTokenContext): string {
  return aesGcmEncrypt(tokenKey(), plain, tokenAad(ctx));
}

/**
 * Lanca se o valor estiver adulterado, a chave tiver mudado ou (v2) o contexto for outro. Tokens `v1:` gravados antes
 * do AAD continuam legiveis (sao regravados em v2 na proxima renovacao/reconexao).
 */
export function decryptProviderToken(stored: string, ctx: ProviderTokenContext): string {
  return decryptProviderTokenWithRotation(stored, ctx).plain;
}

/**
 * Decifra tentando a lista de chaves (primaria primeiro). `rotated` = decifrou com chave NAO-primaria (ou formato v1
 * legado): o chamador deve re-cifrar com encryptProviderToken. Nenhuma chave serve => lanca (como antes).
 */
export function decryptProviderTokenWithRotation(stored: string, ctx: ProviderTokenContext): { plain: string; rotated: boolean } {
  const keys = decryptMasterKeys();
  let lastError: unknown = null;
  for (let i = 0; i < keys.length; i += 1) {
    try {
      const plain = aesGcmDecrypt(deriveSubkey(keys[i], HKDF_SALT, 'provider-token'), stored, 'token do provedor de pagamento', tokenAad(ctx));
      return { plain, rotated: i > 0 || !stored.startsWith('v2:') };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('token do provedor de pagamento ilegivel');
}

/** Igualdade de textos em tempo constante (tamanhos diferentes = false, sem vazar onde difere). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // Compara mesmo assim (tempo independente do conteudo) e devolve false.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

// -------------------------------------------------------------------------------------------------
// state do OAuth: <payload base64url>.<hmac base64url>; payload = { o: orgId, u: userId, p: provider, n: nonce, e: exp ms }
// -------------------------------------------------------------------------------------------------

export interface OAuthStatePayload {
  organizationId: number;
  userId: number;
  provider: string;
  /** Nonce aleatorio: gravado em PaymentOauthState e CONSUMIDO no callback (state de uso unico). */
  nonce: string;
}

export const newOAuthNonce = (): string => randomBytes(16).toString('base64url');

export function signOAuthState(
  input: Omit<OAuthStatePayload, 'nonce'> & { nonce?: string },
  now: Date = new Date(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      o: input.organizationId,
      u: input.userId,
      p: input.provider,
      n: input.nonce ?? newOAuthNonce(),
      e: now.getTime() + OAUTH_STATE_TTL_MS,
    }),
  ).toString('base64url');
  const mac = createHmac('sha256', stateKey()).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

/** Valida assinatura e validade. Qualquer problema = null (o chamador responde o mesmo erro, sem detalhar). */
export function verifyOAuthState(state: unknown, now: Date = new Date()): OAuthStatePayload | null {
  if (typeof state !== 'string' || state.length > 1024) return null;
  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = createHmac('sha256', stateKey()).update(parts[0]).digest('base64url');
  if (!safeEqual(parts[1], expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Record<string, unknown>;
    const { o, u, p, n, e } = data;
    if (!Number.isSafeInteger(o) || !Number.isSafeInteger(u) || typeof p !== 'string' || typeof e !== 'number') return null;
    if (typeof n !== 'string' || n.length < 8 || n.length > 64) return null;
    if (e < now.getTime()) return null;
    return { organizationId: o as number, userId: u as number, provider: p, nonce: n };
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------------------------------------
// Webhook do Mercado Pago: x-signature "ts=<ts>,v1=<hmac hex>"; manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
// (partes ausentes sao omitidas, como manda a documentacao do MP; data.id alfanumerico vai em minusculas).
// -------------------------------------------------------------------------------------------------

export function parseSignatureHeader(header: unknown): { ts: string; v1: string } | null {
  if (typeof header !== 'string' || header.length > 512) return null;
  let ts = '';
  let v1 = '';
  for (const part of header.split(',')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === 'ts') ts = value;
    else if (key === 'v1') v1 = value;
  }
  if (!/^\d{1,16}$/.test(ts) || !/^[0-9a-f]{64}$/i.test(v1)) return null;
  return { ts, v1: v1.toLowerCase() };
}

export function webhookManifest(dataId: string | null, requestId: string | null, ts: string): string {
  let manifest = '';
  if (dataId) manifest += `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  return manifest;
}

export function signWebhookManifest(secret: string, manifest: string): string {
  return createHmac('sha256', secret).update(manifest).digest('hex');
}

export type WebhookSignatureCheck = 'OK' | 'MISSING' | 'MALFORMED' | 'MISMATCH' | 'EXPIRED';

/**
 * Confere a assinatura do webhook. `ts` aceito em segundos ou milissegundos (a documentacao do MP mostra os dois
 * formatos); fora de WEBHOOK_MAX_AGE_MS (para tras ou para frente) = EXPIRED (anti-replay).
 */
export function verifyWebhookSignature(input: {
  secret: string;
  signatureHeader: unknown;
  requestId: string | null;
  dataId: string | null;
  now?: Date;
}): WebhookSignatureCheck {
  if (input.signatureHeader === undefined || input.signatureHeader === null || input.signatureHeader === '') return 'MISSING';
  const parsed = parseSignatureHeader(input.signatureHeader);
  if (!parsed) return 'MALFORMED';
  const expected = signWebhookManifest(input.secret, webhookManifest(input.dataId, input.requestId, parsed.ts));
  if (!safeEqual(parsed.v1, expected)) return 'MISMATCH';
  const raw = Number(parsed.ts);
  const tsMs = raw >= 1e12 ? raw : raw * 1000;
  const now = (input.now ?? new Date()).getTime();
  if (Math.abs(now - tsMs) > WEBHOOK_MAX_AGE_MS) return 'EXPIRED';
  return 'OK';
}
