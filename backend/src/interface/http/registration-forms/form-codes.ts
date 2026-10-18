import { BadRequestException, ConflictException, GoneException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import { resolveJwtSecret } from '../../../shared/config/runtime-config';
import { deriveSubkey } from '../../../shared/security/aes-gcm';

/** Codigos estaveis de erro (campo `code` do corpo) que o painel/app usam. */
export const FormErrorCode = {
  VALIDATION: 'VALIDATION',
  ALREADY_REGISTERED: 'ALREADY_REGISTERED',
  FORM_CLOSED: 'FORM_CLOSED',
  FORM_FULL: 'FORM_FULL',
  FORM_HAS_SUBMISSIONS: 'FORM_HAS_SUBMISSIONS',
  PAYMENT_MODE_NOT_AVAILABLE: 'PAYMENT_MODE_NOT_AVAILABLE',
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  NOT_FOUND: 'NOT_FOUND',
  /** O texto de consentimento mudou depois que a pagina foi aberta: o cliente recarrega e mostra o texto novo. */
  CONSENT_OUTDATED: 'CONSENT_OUTDATED',
  /** Trocar o evento de um formulario que ja tem inscricoes CONFIRMADAS (participantes no evento antigo). */
  FORM_HAS_CONFIRMED: 'FORM_HAS_CONFIRMED',
} as const;

export type ClosedReason = 'NOT_OPEN_YET' | 'CLOSED' | 'FULL' | 'DEADLINE';

export function validationError(fields: Record<string, string>, message = 'Confira os campos destacados.'): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', code: FormErrorCode.VALIDATION, message, fields });
}

export function formClosedError(closedReason: ClosedReason): GoneException {
  const messages: Record<ClosedReason, string> = {
    NOT_OPEN_YET: 'As inscrições ainda não começaram.',
    CLOSED: 'As inscrições estão encerradas.',
    FULL: 'As vagas estão esgotadas.',
    DEADLINE: 'O prazo de inscrição terminou.',
  };
  return new GoneException({ statusCode: 410, error: 'Gone', code: FormErrorCode.FORM_CLOSED, closedReason, message: messages[closedReason] });
}

export function formFullError(): ConflictException {
  return new ConflictException({ statusCode: 409, error: 'Conflict', code: FormErrorCode.FORM_FULL, message: 'As vagas estão esgotadas.' });
}

export function invalidTransition(message: string): ConflictException {
  return new ConflictException({ statusCode: 409, error: 'Conflict', code: FormErrorCode.INVALID_TRANSITION, message });
}

export function paymentModeNotAvailable(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: FormErrorCode.PAYMENT_MODE_NOT_AVAILABLE,
    message: 'O Pix automático ainda não está disponível para inscrições. Use o Pix manual (chave + comprovante).',
  });
}

/** 404 PUBLICO identico para slug inexistente, rascunho e arquivado (nao enumeravel). */
export function publicFormNotFound(): NotFoundException {
  return new NotFoundException({ statusCode: 404, error: 'Not Found', code: FormErrorCode.NOT_FOUND, message: 'Formulário não encontrado.' });
}

export function tooManyRequests(message = 'Muitas tentativas. Aguarde um minuto e tente de novo.'): HttpException {
  return new HttpException(
    { statusCode: 429, error: 'Too Many Requests', code: FormErrorCode.TOO_MANY_REQUESTS, message },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Protocolo e slug
// ---------------------------------------------------------------------------------------------------------------

/** Alfabeto sem caracteres ambiguos (sem 0/O, 1/I/L). */
export const PROTOCOL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PROTOCOL_REGEX = /^INS-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

export function generateProtocol(): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += PROTOCOL_ALPHABET[randomInt(PROTOCOL_ALPHABET.length)];
  return `INS-${out}`;
}

/** Protocolo digitado pela pessoa: maiusculas, sem espacos; null se fora do formato. */
export function normalizeProtocol(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const p = value.trim().toUpperCase();
  return PROTOCOL_REGEX.test(p) ? p : null;
}

const SLUG_SUFFIX_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** Slug publico: so [a-z0-9-] (o nginx do app so encaminha /i/<[A-Za-z0-9-]+>). */
export const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/** "1º Campeonato do Varjão!" -> "1-campeonato-do-varjao-k3q9x" (base ate 40 chars + sufixo aleatorio de 5). */
export function generateSlug(title: string): string {
  const base =
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'inscricao';
  let suffix = '';
  for (let i = 0; i < 5; i++) suffix += SLUG_SUFFIX_ALPHABET[randomInt(SLUG_SUFFIX_ALPHABET.length)];
  return `${base}-${suffix}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Segredos derivados (IP e token de arquivo pendente)
// ---------------------------------------------------------------------------------------------------------------

function ipKey(): Buffer {
  return deriveSubkey(resolveJwtSecret(process.env.JWT_SECRET), 'gingapp-forms-v1', 'ip-hash');
}

/**
 * Chave de LIMITE de um IP: IPv4 como veio (IPv4 mapeado em IPv6 "::ffff:a.b.c.d" vira o IPv4); IPv6 agrupado no /64
 * (um provedor entrega um /64 inteiro a cada cliente: sem isso, trocar o sufixo burlaria qualquer limite por IP).
 */
export function clientIpKey(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const raw = ip.trim().replace(/%.*$/, '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw);
  if (mapped) return mapped[1];
  if (isIPv4(raw)) return raw;
  if (!isIPv6(raw)) return raw.slice(0, 64);
  const [head, tail = ''] = raw.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = raw.includes('::') && tail ? tail.split(':') : [];
  const groups = raw.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':')}::/64`;
}

/** HMAC da chave de limite do IP (IPv6 por /64) com segredo do servidor (nunca o IP cru no banco). */
export function hashIp(ip: string | null | undefined): string | null {
  const key = clientIpKey(ip);
  if (!key) return null;
  return createHmac('sha256', ipKey()).update(key).digest('hex');
}

/** `getTracker` do @nestjs/throttler das rotas publicas dos formularios: IPv6 agrupado por /64 (ver clientIpKey). */
export function formsIpTracker(req: Record<string, any>): string {
  return `forms-ip:${clientIpKey(typeof req.ip === 'string' ? req.ip : null) ?? 'unknown'}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Token de inicio do preenchimento (anti-robo pelo relogio do SERVIDOR)
// ---------------------------------------------------------------------------------------------------------------

function startedKey(): Buffer {
  return deriveSubkey(resolveJwtSecret(process.env.JWT_SECRET), 'gingapp-forms-v1', 'started-token');
}

function startedSignature(slug: string, issuedAt: number): string {
  return createHmac('sha256', startedKey()).update(`${slug}|${issuedAt}`).digest('base64url');
}

/** `<epoch ms>.<HMAC(slug|epoch)>` devolvido por GET /public/forms/:slug (o navegador so devolve no envio). */
export function issueStartedToken(slug: string, now: number = Date.now()): string {
  return `${now}.${startedSignature(slug, now)}`;
}

/** Instante (relogio do servidor) em que o token foi emitido para ESTE slug, ou null se o token nao confere. */
export function verifyStartedToken(slug: string, token: unknown): number | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const m = /^(\d{10,16})\.([A-Za-z0-9_-]{20,100})$/.exec(token);
  if (!m) return null;
  const issuedAt = Number(m[1]);
  const expected = Buffer.from(startedSignature(slug, issuedAt));
  const given = Buffer.from(m[2]);
  return expected.length === given.length && timingSafeEqual(expected, given) ? issuedAt : null;
}

/** Token do anexo pendente (vai ao navegador) e o SHA-256 dele (vai ao banco). */
export function newFileToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashFileToken(token) };
}

export function hashFileToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
