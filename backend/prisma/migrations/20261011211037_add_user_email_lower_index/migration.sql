-- Indice funcional para as buscas de login/cadastro por e-mail case-insensitive
-- (src/shared/security/email-lookup.ts: WHERE lower("email") = $1). O @unique de User.email so cobre
-- a comparacao exata (com caixa) e nao serve a lower(email). NAO e UNIQUE de proposito: contas antigas
-- podem ter e-mails que so diferem na caixa (o codigo trata o caso e ordena por id).
-- IF NOT EXISTS: idempotente. Expressao nao representavel no schema.prisma (o Prisma nao a trata como drift).
CREATE INDEX IF NOT EXISTS "User_email_lower_idx" ON "User" (lower("email"));