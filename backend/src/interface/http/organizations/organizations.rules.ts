/** Regras puras da criação de grupo (sem Prisma/Nest), testáveis em isolamento. */

const MAX_SLUG_LENGTH = 60;
const FALLBACK_SLUG = 'grupo';

/** "Grupo Ginga Brasil Ç" -> "grupo-ginga-brasil-c": minúsculo, sem acento, só [a-z0-9-], sem hífen nas pontas. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH - 6) // reserva espaço para o sufixo "-NNNN"
    .replace(/-+$/g, '');
  return slug || FALLBACK_SLUG;
}

/** n = 1 -> a própria base; n >= 2 -> "base-n". */
export function buildSlugCandidate(base: string, n: number): string {
  return n <= 1 ? base : `${base}-${n}`;
}

/** Política de senha: SSOT em shared/security/password-policy.ts (re-exportada para quem já importa daqui). */
export { isForbiddenPassword } from '../../../shared/security/password-policy';
