-- Patrocinadores no banner da Home (piloto, docs/CONTRATO_PATROCINADORES.md secao 3): patrocinadores, campanhas e
-- contadores AGREGADOS por (campanha, dia de Sao Paulo, UF) - nenhuma coluna de usuario, grupo, aparelho, IP ou User-Agent.
-- Upload.organizationId passa a aceitar NULO = imagem enviada pela equipe da plataforma (POST /platform-uploads); a FK
-- continua RESTRICT (igual a antes). So ADICIONA/afrouxa: nenhuma linha existente muda.

-- CreateEnum
CREATE TYPE "SponsorCategory" AS ENUM ('INSTRUMENTOS', 'VESTUARIO', 'SAUDE', 'EDUCACAO', 'EVENTOS_TURISMO', 'ALIMENTACAO', 'ESPORTES');

-- CreateEnum
CREATE TYPE "SponsorCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');

-- AlterTable
ALTER TABLE "Upload" ALTER COLUMN "organizationId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Sponsor" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "logo" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "document" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sponsor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorCampaign" (
    "id" SERIAL NOT NULL,
    "sponsorId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "imageRef" TEXT,
    "ctaLabel" TEXT NOT NULL DEFAULT 'Conhecer',
    "destinationUrl" TEXT NOT NULL,
    "destinationHost" TEXT NOT NULL,
    "category" "SponsorCategory" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "SponsorCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "states" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priceCents" INTEGER,
    "billingNote" TEXT,
    "approvedByUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SponsorCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorStatDay" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "day" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT '',
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SponsorStatDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SponsorCampaign_status_startsAt_endsAt_idx" ON "SponsorCampaign"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "SponsorCampaign_sponsorId_idx" ON "SponsorCampaign"("sponsorId");

-- CreateIndex (alvo do INSERT ... ON CONFLICT DO UPDATE dos contadores)
CREATE UNIQUE INDEX "SponsorStatDay_campaignId_day_state_key" ON "SponsorStatDay"("campaignId", "day", "state");

-- AddForeignKey
ALTER TABLE "SponsorCampaign" ADD CONSTRAINT "SponsorCampaign_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "Sponsor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsorStatDay" ADD CONSTRAINT "SponsorStatDay_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SponsorCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
