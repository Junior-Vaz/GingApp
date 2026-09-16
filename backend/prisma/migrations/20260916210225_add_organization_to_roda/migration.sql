-- AlterTable
ALTER TABLE "Roda" ADD COLUMN     "organizationId" INTEGER;

-- CreateIndex
CREATE INDEX "Roda_organizationId_idx" ON "Roda"("organizationId");

-- AddForeignKey
ALTER TABLE "Roda" ADD CONSTRAINT "Roda_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
