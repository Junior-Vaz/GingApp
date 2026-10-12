import { createHash, randomBytes } from 'node:crypto';

/**
 * Token de uso único para redefinir/definir a senha por e-mail (E05) — regras puras (sem Prisma/Nest).
 * O token em claro (43 caracteres base64url = 256 bits) só existe no link do e-mail; no banco fica apenas o
 * SHA-256 em hexadecimal. Como o token já é aleatório de alta entropia, SHA-256 (sem sal/custo) basta e permite
 * achar o registro por igualdade.
 */

export type PasswordTokenPurpose = 'RESET' | 'INVITE';

/** "Esqueci a senha": 1 hora. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
/** Convite de aluno/responsável: 72 horas (a pessoa pode demorar a abrir o e-mail). */
export const INVITE_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

export function tokenTtlMs(purpose: PasswordTokenPurpose): number {
  return purpose === 'INVITE' ? INVITE_TOKEN_TTL_MS : RESET_TOKEN_TTL_MS;
}

export function hashPasswordToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generatePasswordToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashPasswordToken(token) };
}
