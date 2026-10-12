import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) com HMAC-SHA1, passo de 30 s e 6 digitos - o perfil que Google Authenticator, Authy, 1Password etc.
 * suportam. Implementado com `node:crypto` (sem dependencia nova). Funcoes puras: o relogio entra por parametro.
 */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Tolerancia de relogio: aceita o passo atual e 1 anterior/seguinte (+-30 s). */
export const TOTP_WINDOW = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 (sem padding), o formato do segredo nos apps autenticadores. */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx < 0) throw new Error('Segredo base32 invalido.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Segredo novo: 20 bytes aleatorios (160 bits, o tamanho recomendado pela RFC 4226) em base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Passo (contador) de 30 s correspondente ao instante. */
export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/** HOTP (RFC 4226) do contador informado, com zeros a esquerda. */
export function hotp(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** Codigo TOTP vigente no instante `nowMs` (usado pelos testes e pelo `verifyTotp`). */
export function totpCode(secretBase32: string, nowMs: number = Date.now()): string {
  return hotp(secretBase32, totpStep(nowMs));
}

/**
 * Confere o codigo digitado dentro da janela de +-1 passo. Devolve o PASSO que casou (para o anti-replay: o chamador
 * grava o passo e recusa passos <= ao ultimo aceito) ou null. Comparacao em tempo constante.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs: number = Date.now(),
  window: number = TOTP_WINDOW,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const given = Buffer.from(code);
  const current = totpStep(nowMs);
  let matched: number | null = null;
  for (let delta = -window; delta <= window; delta += 1) {
    const expected = Buffer.from(hotp(secretBase32, current + delta));
    // Sem "return" antecipado: o tempo nao revela qual passo (ou se algum) casou.
    if (timingSafeEqual(given, expected) && matched === null) matched = current + delta;
  }
  return matched;
}

/** URI `otpauth://` que o QR Code carrega (Key URI Format do Google Authenticator). */
export function buildOtpAuthUri(secretBase32: string, accountName: string, issuer = 'GingApp'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
