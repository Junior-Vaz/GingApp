/**
 * Revogação de sessões por User.tokenValidAfter — regras puras (sem Prisma/Nest).
 *
 * O claim `iat` do JWT tem resolução de SEGUNDOS; tokenValidAfter é um timestamp em milissegundos.
 * Comparar os dois cruamente deixa duas brechas no mesmo segundo da revogação:
 *   (a) um token ANTIGO emitido nesse segundo (iat*1000 <= tokenValidAfter) sobrevive se for igual;
 *   (b) um token NOVO emitido logo depois (iat truncado para o início do segundo) nasce inválido.
 * Por isso: o corte é gravado 1 ms à frente (revokes TODO token emitido até agora) e quem emite um
 * token depois de uma revogação usa um `iat` >= corte (no máximo ~1 s no futuro; o jsonwebtoken não
 * valida iat no futuro) para que a sessão recém-criada nunca seja considerada revogada.
 */

/** Valor a gravar em User.tokenValidAfter para revogar todo token emitido até `nowMs` (inclusive). */
export function revocationCutoff(nowMs: number = Date.now()): Date {
  return new Date(nowMs + 1);
}

/** true se um token com este `iat` (segundos) foi emitido antes do corte (ms) — mesma regra do JwtStrategy. */
export function isRevokedByCutoff(iatSeconds: number, tokenValidAfter: Date | null | undefined): boolean {
  return !!tokenValidAfter && iatSeconds * 1000 < tokenValidAfter.getTime();
}

/** `iat` (segundos) para um token emitido agora: o relógio atual, nunca antes do corte de revogação. */
export function issuedAtFor(tokenValidAfter: Date | null | undefined, nowMs: number = Date.now()): number {
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!tokenValidAfter) return nowSeconds;
  return Math.max(nowSeconds, Math.ceil(tokenValidAfter.getTime() / 1000));
}
