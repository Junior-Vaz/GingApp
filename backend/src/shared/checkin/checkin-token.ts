import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolveJwtSecret } from '../config/runtime-config';

/**
 * Token de check-in por QR (aluno confirma a PROPRIA presenca em um evento ou aula). Sem tabela: o token e
 * autenticado por HMAC-SHA256 com uma subchave derivada do JWT_SECRET, entao so o servidor consegue emiti-lo e nada
 * precisa ser guardado. Formato curto o bastante para digitar quando a camera nao le o QR:
 *
 *     E12-K7QXM3PA2B     (E = evento, L = aula; 12 = id; resto = 10 caracteres do HMAC, alfabeto sem 0/O/1/I)
 *
 * "Expiracao": o token e deterministico por (tipo, id, grupo) e SO vale dentro da janela do proprio evento/aula
 * (ver checkin-window.ts) — fora dela o servidor recusa mesmo com o token correto. O grupo entra no HMAC: um token
 * emitido para um grupo nunca valida em outro.
 */
export type CheckinKind = 'E' | 'L';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 simbolos = 5 bits por caractere
const CODE_LENGTH = 10; // 50 bits de entropia
const TOKEN_PATTERN = /^([EL])(\d{1,9})-?([A-HJ-NP-Z2-9]{10})$/;

function subKey(): Buffer {
  return createHmac('sha256', resolveJwtSecret(process.env.JWT_SECRET)).update('gingapp-checkin-v1').digest();
}

function codeFor(kind: CheckinKind, id: number, organizationId: number): string {
  const digest = createHmac('sha256', subKey()).update(`${kind}:${id}:${organizationId}`).digest();
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[digest[i] & 31];
  return out;
}

export function buildCheckinToken(kind: CheckinKind, id: number, organizationId: number): string {
  return `${kind}${id}-${codeFor(kind, id, organizationId)}`;
}

/** Normaliza o que o aluno digitou/escaneou: maiusculas, sem espacos; aceita o token dentro de uma URL (?token=). */
export function normalizeCheckinToken(raw: string): string {
  let value = raw.trim();
  try {
    const url = new URL(value);
    value = url.searchParams.get('token') ?? value;
  } catch {
    // nao e URL: segue como texto
  }
  return value.replace(/\s+/g, '').toUpperCase();
}

/** Le tipo e id do token SEM validar a assinatura (so para localizar o registro no grupo antes de verificar); null se mal formado. */
export function peekCheckinToken(raw: string): { kind: CheckinKind; id: number } | null {
  const match = TOKEN_PATTERN.exec(normalizeCheckinToken(raw));
  if (!match) return null;
  const id = Number(match[2]);
  return Number.isSafeInteger(id) && id > 0 ? { kind: match[1] as CheckinKind, id } : null;
}

/**
 * Valida o token para o grupo informado e devolve o tipo e o id embutidos, ou null se for invalido
 * (formato errado, adulterado ou de outro grupo). Comparacao em tempo constante.
 */
export function verifyCheckinToken(raw: string, organizationId: number): { kind: CheckinKind; id: number } | null {
  const match = TOKEN_PATTERN.exec(normalizeCheckinToken(raw));
  if (!match) return null;
  const kind = match[1] as CheckinKind;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const expected = Buffer.from(codeFor(kind, id, organizationId));
  const given = Buffer.from(match[3]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { kind, id };
}
