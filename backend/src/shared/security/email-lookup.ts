import { Prisma } from '@prisma/client';
import { normalizeEmail } from './password-policy';

/**
 * Ids dos usuários cujo e-mail é IGUAL ao informado sem diferenciar maiúsculas (e sem espaços nas pontas).
 *
 * NÃO usar `where: { email: { equals, mode: 'insensitive' } }` do Prisma para isto: no PostgreSQL ele vira
 * `ILIKE`, em que "_" e "%" do e-mail digitado são CURINGAS ("a_b@x.com" casaria "axb@x.com"; "%@x.com"
 * casaria todo o domínio) — no login isso deixaria um atacante testar a mesma senha contra várias contas por
 * requisição, e no cadastro geraria 409 falsos. Aqui a comparação é por igualdade exata de `lower(email)`.
 * (Sem índice funcional: a tabela User é pequena e login/cadastro são raros e limitados por rate limit.)
 *
 * `db` aceita o PrismaClient/PrismaService ou o cliente de uma transação.
 */
export async function findUserIdsByEmail(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  email: string,
  limit = 5,
): Promise<number[]> {
  const rows = await db.$queryRaw<Array<{ id: number }>>(
    Prisma.sql`SELECT "id" FROM "User" WHERE lower("email") = ${normalizeEmail(email)} ORDER BY "id" ASC LIMIT ${limit}`,
  );
  return rows.map((row) => row.id);
}
