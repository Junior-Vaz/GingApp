import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { resolveJwtSecret } from '../config/runtime-config';

/**
 * Criptografia do 2FA. Chave-mestra = TWO_FACTOR_KEY (opcional; qualquer texto) ou, na falta, o JWT_SECRET. Cada uso
 * deriva a PROPRIA subchave (HKDF-SHA256 com `info` distinto): o segredo TOTP (AES-256-GCM), o HMAC dos codigos de
 * recuperacao e o segredo do JWT do desafio de login. Girar o JWT_SECRET sem TWO_FACTOR_KEY invalida os segredos ja
 * cifrados - por isso em producao convem fixar TWO_FACTOR_KEY (ver .env.example).
 */
const HKDF_SALT = Buffer.from('gingapp-two-factor-v1');

function masterKey(): string {
  const dedicated = process.env.TWO_FACTOR_KEY?.trim();
  return dedicated || resolveJwtSecret(process.env.JWT_SECRET);
}

function deriveKey(info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey(), HKDF_SALT, info, 32));
}

/** Segredo do JWT do desafio ('2fa'): distinto do JWT_SECRET, entao um desafio nunca vale como token de acesso. */
export function challengeJwtSecret(): string {
  return deriveKey('challenge-jwt').toString('hex');
}

const ENCRYPTED_PREFIX = 'v1';

/** AES-256-GCM: `v1:<iv>:<tag>:<texto cifrado>` (base64). IV novo (12 bytes) a cada cifragem. */
export function encryptTwoFactorSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey('secret-encryption'), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [ENCRYPTED_PREFIX, iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

/** Lanca se o valor estiver adulterado ou a chave tiver mudado (a tag GCM nao confere). */
export function decryptTwoFactorSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== ENCRYPTED_PREFIX || !iv || !tag || !data) throw new Error('Formato do segredo 2FA invalido.');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey('secret-encryption'), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

// Sem caracteres ambiguos (0/o, 1/l/i): o usuario transcreve o codigo a mao.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const RECOVERY_CODE_COUNT = 8;

/** `xxxxx-xxxxx` (10 caracteres de um alfabeto de 31 = ~49 bits cada). */
export function generateRecoveryCode(): string {
  let code = '';
  for (let i = 0; i < 10; i += 1) code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => generateRecoveryCode());
}

/** Minusculas, sem espacos/hifens: "ABCDE-FGHJK" e "abcde fghjk" valem como o mesmo codigo. */
export function normalizeRecoveryCode(input: string): string {
  return input.toLowerCase().replace(/[\s-]/g, '');
}

/** HMAC-SHA256 do codigo normalizado (so o hash vai para o banco). */
export function hashRecoveryCode(input: string): string {
  return createHmac('sha256', deriveKey('recovery-code-hmac')).update(normalizeRecoveryCode(input)).digest('hex');
}

/** Posicao do codigo na lista de hashes (comparacao em tempo constante em todos os itens) ou -1. */
export function findRecoveryHash(hashes: readonly string[], input: string): number {
  const candidate = Buffer.from(hashRecoveryCode(input), 'hex');
  let found = -1;
  hashes.forEach((stored, index) => {
    const bytes = Buffer.from(stored, 'hex');
    if (bytes.length === candidate.length && timingSafeEqual(bytes, candidate) && found < 0) found = index;
  });
  return found;
}
