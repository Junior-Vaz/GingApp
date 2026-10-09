/** Regras puras da criação de grupo (sem Prisma/Nest), testáveis em isolamento. */

const MAX_SLUG_LENGTH = 60;
const FALLBACK_SLUG = 'grupo';
/** Senhas conhecidas de desenvolvimento/seed que nunca podem proteger um MESTRE real. */
const FORBIDDEN_PASSWORD_FRAGMENTS = ['dev@12345'];

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

/** Recusa a senha padrão de dev (Dev@12345) também quando ela só aparece embutida na senha. */
export function isForbiddenPassword(password: string): boolean {
  const lowered = password.toLowerCase();
  return FORBIDDEN_PASSWORD_FRAGMENTS.some((fragment) => lowered.includes(fragment));
}
