/**
 * SSOT da política de senha e do hash (sem Prisma/Nest, testável em isolamento).
 *
 * Usada por: criação do MESTRE (POST /organizations), reset de MESTRE pelo admin, troca da própria
 * senha (POST /auth/change-password), gestão da equipe PLATFORM (custo bcrypt e limite de bytes) e
 * pelo bootstrap de produção (custo, limites e termos proibidos). Nunca duplicar estas constantes.
 */

/** Custo bcrypt de TODAS as senhas gravadas pela aplicação (SSOT). */
export const BCRYPT_ROUNDS = 10;

/** Política da senha NOVA de um membro/MESTRE/super admin: 12..72 (72 = limite do bcrypt). */
export const NEW_PASSWORD_MIN_LENGTH = 12;
/** O bcrypt só considera os primeiros 72 BYTES (UTF-8) e ignora o resto em silêncio. */
export const PASSWORD_MAX_BYTES = 72;

/** Senhas conhecidas de desenvolvimento/seed que nunca podem proteger uma conta real. */
export const FORBIDDEN_PASSWORD_FRAGMENTS: readonly string[] = ['dev@12345'];

/** Recusa a senha padrão de dev (Dev@12345) em qualquer caixa e também embutida na senha. */
export function isForbiddenPassword(password: string): boolean {
  const lowered = password.toLowerCase();
  return FORBIDDEN_PASSWORD_FRAGMENTS.some((fragment) => lowered.includes(fragment));
}

/** Tamanho da senha em bytes UTF-8 (o que o bcrypt de fato enxerga). */
export function passwordByteLength(password: string): number {
  return Buffer.byteLength(password, 'utf8');
}

/** Forma canônica do e-mail de login: sem espaços nas pontas e em minúsculas (como é gravado). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
