import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Cifra simetrica SSOT do backend (AES-256-GCM): usada pelo segredo do 2FA (two-factor-crypto.ts) e pelo documento
 * da ficha unica (person-document.ts). Cada uso deriva a PROPRIA subchave da sua chave-mestra (HKDF-SHA256 com
 * `salt`/`info` distintos), entao uma chave vazada de um uso nao abre o outro.
 */
export function deriveSubkey(masterKey: string, salt: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.from(salt), info, 32));
}

const ENCRYPTED_PREFIX = 'v1';

/** `v1:<iv>:<tag>:<texto cifrado>` (base64). IV novo (12 bytes) a cada cifragem. */
export function aesGcmEncrypt(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [ENCRYPTED_PREFIX, iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

/** Lanca se o valor estiver adulterado, em formato invalido ou se a chave tiver mudado (a tag GCM nao confere). */
export function aesGcmDecrypt(key: Buffer, stored: string, label = 'valor cifrado'): string {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== ENCRYPTED_PREFIX || !iv || !tag || !data) throw new Error(`Formato do ${label} invalido.`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
