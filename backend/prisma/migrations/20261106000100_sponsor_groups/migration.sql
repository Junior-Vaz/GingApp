-- Patrocinadores do GRUPO (docs/CONTRATO_PATROCINADORES_GRUPO.md secao 1): patrocinador/campanha passam a ter dono opcional
-- (organizationId NULO = da PLATAFORMA, como hoje; preenchido = patrocinio LOCAL do grupo, gerido pelo Mestre), suspensao de
-- campanha de grupo pela PLATAFORMA, bloqueio do patrocinio local do grupo e aceite do termo do Mestre na Organization.
-- So ADICIONA colunas/indices/FKs (todas anulaveis): nenhuma linha existente muda (tudo o que existe continua da plataforma).
-- Apagar o grupo apaga os patrocinadores e as campanhas dele (FK CASCADE; as estatisticas vao junto pela FK da campanha).

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "sponsorTermsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "sponsorTermsAcceptedByUserId" INTEGER,
ADD COLUMN     "sponsorTermsVersion" TEXT,
ADD COLUMN     "sponsorsBlockedAt" TIMESTAMP(3),
ADD COLUMN     "sponsorsBlockedReason" TEXT;

-- AlterTable
ALTER TABLE "Sponsor" ADD COLUMN     "organizationId" INTEGER;

-- AlterTable
ALTER TABLE "SponsorCampaign" ADD COLUMN     "organizationId" INTEGER,
ADD COLUMN     "platformSuspendReason" TEXT,
ADD COLUMN     "platformSuspendedAt" TIMESTAMP(3),
ADD COLUMN     "platformSuspendedByUserId" INTEGER;

-- CreateIndex
CREATE INDEX "Sponsor_organizationId_idx" ON "Sponsor"("organizationId");

-- CreateIndex
CREATE INDEX "SponsorCampaign_organizationId_status_idx" ON "SponsorCampaign"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "Sponsor" ADD CONSTRAINT "Sponsor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsorCampaign" ADD CONSTRAINT "SponsorCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariante (contrato secao 1): a campanha tem o MESMO organizationId do patrocinador dela (ambos nulos = plataforma).
-- O servico ja garante; o trigger e a defesa no banco contra escrita fora da API. Patrocinador inexistente nao e tratado
-- aqui (a FK sponsorId continua dando o erro dela). O Prisma nao modela triggers: `migrate diff` banco x schema segue vazio.
CREATE OR REPLACE FUNCTION "sponsor_campaign_same_organization"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Sponsor" s
    WHERE s."id" = NEW."sponsorId" AND s."organizationId" IS DISTINCT FROM NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'SponsorCampaign.organizationId (%) difere do organizationId do patrocinador %', NEW."organizationId", NEW."sponsorId"
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SponsorCampaign_same_organization"
BEFORE INSERT OR UPDATE OF "sponsorId", "organizationId" ON "SponsorCampaign"
FOR EACH ROW EXECUTE FUNCTION "sponsor_campaign_same_organization"();

-- Lado do patrocinador: mudar o dono de um patrocinador que tem campanhas de outro dono tambem e recusado.
CREATE OR REPLACE FUNCTION "sponsor_same_organization_as_campaigns"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "SponsorCampaign" c
    WHERE c."sponsorId" = NEW."id" AND c."organizationId" IS DISTINCT FROM NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Sponsor % tem campanhas de outro organizationId', NEW."id" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Sponsor_same_organization_as_campaigns"
BEFORE UPDATE OF "organizationId" ON "Sponsor"
FOR EACH ROW EXECUTE FUNCTION "sponsor_same_organization_as_campaigns"();
