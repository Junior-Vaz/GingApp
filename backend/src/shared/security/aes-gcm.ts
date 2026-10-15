import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Cifra simetrica SSOT do backend (AES-256-GCM): usada pelo segredo do 2FA (two-factor-crypto.ts), pelo documento
 * da ficha unica (person-document.ts) e pelos tokens dos provedores de pagamento (payment-crypto.ts). Cada uso deriva a
 * PROPRIA subchave da sua chave-mestra (HKDF-SHA256 com `salt`/`info` distintos), entao uma chave vazada de um uso nao
 * abre o outro.
 */
export function deriveSubkey(masterKey: string, salt: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.from(salt), info, 32));
}

const ENCRYPTED_PREFIX = 'v1';
/** Mesmo formato do v1, com AAD (dados associados) autenticados: o valor so decifra no MESMO contexto (ex.: grupo). */
const ENCRYPTED_PREFIX_AAD = 'v2';
/** Tag GCM sempre de 16 bytes (o decifrador recusa tag truncada). */
const AUTH_TAG_LENGTH = 16;

/**
 * `v1:<iv>:<tag>:<texto cifrado>` (base64). IV novo (12 bytes) a cada cifragem. Com `aad` o prefixo vira `v2` e o
 * contexto entra na autenticacao (decifrar com outro `aad` falha).
 */
export function aesGcmEncrypt(key: Buffer, plain: string, aad?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_LENGTH });
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    aad !== undefined ? ENCRYPTED_PREFIX_AAD : ENCRYPTED_PREFIX,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Lanca se o valor estiver adulterado, em formato invalido ou se a chave tiver mudado (a tag GCM nao confere). `v1` (sem
 * AAD) continua legivel; `v2` exige o MESMO `aad` da cifragem.
 */
export function aesGcmDecrypt(key: Buffer, stored: string, label = 'valor cifrado', aad?: string): string {
  const [version, iv, tag, data] = stored.split(':');
  if ((version !== ENCRYPTED_PREFIX && version !== ENCRYPTED_PREFIX_AAD) || !iv || !tag || !data) {
    throw new Error(`Formato do ${label} invalido.`);
  }
  if (version === ENCRYPTED_PREFIX_AAD && aad === undefined) throw new Error(`Contexto do ${label} ausente.`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'), { authTagLength: AUTH_TAG_LENGTH });
  if (version === ENCRYPTED_PREFIX_AAD) decipher.setAAD(Buffer.from(aad!, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
