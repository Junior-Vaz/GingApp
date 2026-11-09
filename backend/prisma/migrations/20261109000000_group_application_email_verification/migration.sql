-- Adesao de grupos: confirmacao do e-mail do solicitante + Instagram (docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md secoes 1 e 7).
-- Parte 1 de 2. Escrita a mao (sem BOM). So ADICIONA (valor de enum, enum novo, colunas, indice unico do hash).
--
-- POR QUE DUAS MIGRATIONS: o Postgres nao deixa USAR um valor de enum recem-adicionado (ALTER TYPE ... ADD VALUE) na
-- mesma transacao em que ele foi criado ("unsafe use of new value"), e o `prisma migrate deploy` executa cada arquivo
-- como um bloco unico. O indice unico parcial e o CHECK que citam 'UNVERIFIED' ficam na parte 2
-- (20261109000100_group_application_email_verification_constraints), que roda depois deste COMMIT.

-- AlterEnum: o pedido criado com o e-mail transacional ligado nasce UNVERIFIED (antes de PENDING, como no schema.prisma).
ALTER TYPE "GroupApplicationStatus" ADD VALUE IF NOT EXISTS 'UNVERIFIED' BEFORE 'PENDING';

-- CreateEnum
CREATE TYPE "EmailVerification" AS ENUM ('VERIFIED', 'PENDING', 'SKIPPED');

-- AlterTable
ALTER TABLE "GroupApplication"
    ADD COLUMN "instagram" TEXT,
    ADD COLUMN "emailVerification" "EmailVerification" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
    ADD COLUMN "verifyTokenHash" TEXT,
    ADD COLUMN "verifyExpiresAt" TIMESTAMP(3),
    ADD COLUMN "verifySentAt" TIMESTAMP(3),
    ADD COLUMN "verifySentCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill: os pedidos que JA existiam nasceram sem confirmacao de e-mail (o fluxo nao existia). Ficam SKIPPED
-- ("e-mail nao confirmado"), senao um PENDING antigo ficaria impossivel de aprovar (aprovar exige VERIFIED ou SKIPPED).
UPDATE "GroupApplication" SET "emailVerification" = 'SKIPPED';

-- CreateIndex
CREATE UNIQUE INDEX "GroupApplication_verifyTokenHash_key" ON "GroupApplication"("verifyTokenHash");

-- Defesa em profundidade (o DTO ja normaliza/valida): o Instagram gravado e so o handle puro.
ALTER TABLE "GroupApplication" ADD CONSTRAINT "GroupApplication_instagram_check"
    CHECK ("instagram" IS NULL OR ("instagram" ~ '^[a-z0-9._]{1,30}$' AND "instagram" NOT LIKE '%..%' AND "instagram" NOT LIKE '%.'));

-- Contador de envios do link nunca negativo.
ALTER TABLE "GroupApplication" ADD CONSTRAINT "GroupApplication_verify_sent_count_check" CHECK ("verifySentCount" >= 0);
