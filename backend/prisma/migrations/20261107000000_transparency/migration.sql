-- Transparencia da plataforma (docs/CONTRATO_TRANSPARENCIA.md, Frente B Fase 1): livro-caixa lancado a mao pela equipe
-- da PLATAFORMA (LedgerEntry), meses PUBLICADOS com retrato (TransparencyMonth) e configuracao singleton
-- (TransparencySetting, id = 1). Nenhuma coluna de IP/User-Agent; a description do lancamento e PRIVADA do admin.
-- So ADICIONA: nenhuma tabela existente muda.

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('RECEITA', 'DESPESA');

-- CreateEnum
CREATE TYPE "LedgerCategory" AS ENUM ('HOSPEDAGEM', 'MAPAS', 'ARMAZENAMENTO_BACKUP', 'NOTIFICACOES', 'EMAIL', 'DOMINIO', 'FERRAMENTAS', 'PESSOAS_SUPORTE', 'IMPOSTOS_TARIFAS', 'OUTROS_DESPESA', 'APOIO', 'PATROCINIO', 'EDITAIS_OUTROS');

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" SERIAL NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "category" "LedgerCategory" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "occurredOn" DATE NOT NULL,
    "month" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id"),
    -- Defesa em profundidade (o servico ja valida): centavos inteiros positivos e mes 'YYYY-MM' igual ao de occurredOn.
    CONSTRAINT "LedgerEntry_amountCents_check" CHECK ("amountCents" BETWEEN 1 AND 1000000000),
    CONSTRAINT "LedgerEntry_month_check" CHECK ("month" = to_char("occurredOn", 'YYYY-MM'))
);

-- CreateTable
CREATE TABLE "TransparencyMonth" (
    "month" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedByUserId" INTEGER NOT NULL,
    "note" TEXT,
    "activeStudents" INTEGER NOT NULL,
    "activeGroups" INTEGER NOT NULL,
    "goalCents" INTEGER NOT NULL,

    CONSTRAINT "TransparencyMonth_pkey" PRIMARY KEY ("month"),
    CONSTRAINT "TransparencyMonth_month_check" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT "TransparencyMonth_snapshot_check" CHECK ("activeStudents" >= 0 AND "activeGroups" >= 0 AND "goalCents" >= 0)
);

-- CreateTable
CREATE TABLE "TransparencySetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "monthlyGoalCents" INTEGER NOT NULL DEFAULT 0,
    "openingReserveCents" INTEGER NOT NULL DEFAULT 0,
    "entityName" TEXT,
    "introText" TEXT,
    "surplusText" TEXT,
    "updatedByUserId" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransparencySetting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TransparencySetting_singleton_check" CHECK ("id" = 1),
    CONSTRAINT "TransparencySetting_values_check" CHECK ("monthlyGoalCents" BETWEEN 0 AND 1000000000 AND "openingReserveCents" BETWEEN 0 AND 1000000000)
);

-- CreateIndex
CREATE INDEX "LedgerEntry_month_idx" ON "LedgerEntry"("month");

-- CreateIndex
CREATE INDEX "LedgerEntry_month_type_idx" ON "LedgerEntry"("month", "type");
