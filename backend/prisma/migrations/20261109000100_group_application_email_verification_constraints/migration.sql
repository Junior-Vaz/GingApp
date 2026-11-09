-- Adesao de grupos: confirmacao do e-mail (docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md secao 1). Parte 2 de 2, escrita a mao
-- (sem BOM). Separada da parte 1 (20261109000000_group_application_email_verification) porque usa o valor de enum
-- 'UNVERIFIED', que so pode ser usado DEPOIS do COMMIT da transacao que o adicionou.

-- 1 pedido ABERTO (UNVERIFIED ou PENDING) por e-mail, sem diferenciar maiusculas. Dois POSTs simultaneos com o mesmo
-- e-mail = um grava, o outro recebe P2002 e responde o mesmo 201 sem gravar (sem enumeracao de contas).
DROP INDEX IF EXISTS "GroupApplication_email_pending_key";
CREATE UNIQUE INDEX "GroupApplication_email_open_key" ON "GroupApplication"(lower("email")) WHERE "status" IN ('UNVERIFIED', 'PENDING');

-- Pedido em aberto (UNVERIFIED ou PENDING) sempre tem a senha (em hash) para criar a conta na aprovacao; decidido ou
-- expirado pode (e deve) ter null.
ALTER TABLE "GroupApplication" DROP CONSTRAINT IF EXISTS "GroupApplication_pending_password_check";
ALTER TABLE "GroupApplication" ADD CONSTRAINT "GroupApplication_pending_password_check"
    CHECK ("status" NOT IN ('UNVERIFIED', 'PENDING') OR "passwordHash" IS NOT NULL);

-- Defesa em profundidade: um pedido aguardando confirmacao tem a verificacao PENDING (nunca VERIFIED/SKIPPED).
ALTER TABLE "GroupApplication" ADD CONSTRAINT "GroupApplication_unverified_check"
    CHECK ("status" <> 'UNVERIFIED' OR "emailVerification" = 'PENDING');
