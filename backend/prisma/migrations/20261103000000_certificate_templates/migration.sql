-- Modelos de certificado (docs/CONTRATO_CERTIFICADOS_MODELOS.md): tabela CertificateTemplate (desenho em JSON por grupo)
-- e, no Certificate, o modelo usado + a COPIA do desenho no momento da emissao. So ADICIONA: certificados antigos ficam
-- com templateId/layoutSnapshot nulos e continuam saindo no desenho classico embutido.

-- CreateEnum
CREATE TYPE "CertificatePurpose" AS ENUM ('GRADUACAO', 'BATIZADO', 'EVENTO', 'PARTICIPACAO', 'OUTRO');

-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN     "layoutSnapshot" JSONB,
ADD COLUMN     "templateId" INTEGER;

-- CreateTable
CREATE TABLE "CertificateTemplate" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" "CertificatePurpose" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "layout" JSONB NOT NULL,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificateTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CertificateTemplate_organizationId_purpose_idx" ON "CertificateTemplate"("organizationId", "purpose");

-- No maximo 1 modelo PADRAO por (grupo, uso). Indice unico PARCIAL: o Prisma nao o declara no schema (fica so aqui).
CREATE UNIQUE INDEX "CertificateTemplate_organizationId_purpose_default_key" ON "CertificateTemplate"("organizationId", "purpose") WHERE "isDefault";

-- CreateIndex
CREATE INDEX "Certificate_templateId_idx" ON "Certificate"("templateId");

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CertificateTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateTemplate" ADD CONSTRAINT "CertificateTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
