-- Ficha unica - Fase 2: transferencia entre grupos (docs/FICHA_UNICA.md secao 4). So ADICIONA tabelas/colunas.
-- Rollback: DROP das 3 tabelas e 2 enums novos + DROP COLUMN Student.leftAt/leftReason.

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING_PERSON', 'APPROVED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TransferContestReason" AS ENUM ('PENDING_PAYMENT', 'EQUIPMENT', 'OTHER');

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "leftAt" TIMESTAMP(3),
ADD COLUMN     "leftReason" TEXT;

-- CreateTable
CREATE TABLE "TransferRequest" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "fromOrganizationId" INTEGER NOT NULL,
    "fromStudentId" INTEGER,
    "toOrganizationId" INTEGER NOT NULL,
    "toUnitId" INTEGER,
    "toStudentId" INTEGER,
    "requestedByUserId" INTEGER NOT NULL,
    "decidedByUserId" INTEGER,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING_PERSON',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "contestUntil" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferContest" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "byUserId" INTEGER NOT NULL,
    "reason" "TransferContestReason" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferContest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentShare" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "fromStudentId" INTEGER NOT NULL,
    "fromOrganizationId" INTEGER NOT NULL,
    "toOrganizationId" INTEGER NOT NULL,
    "requestId" INTEGER NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "EnrollmentShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransferRequest_personId_status_idx" ON "TransferRequest"("personId", "status");

-- CreateIndex
CREATE INDEX "TransferRequest_toOrganizationId_status_idx" ON "TransferRequest"("toOrganizationId", "status");

-- CreateIndex
CREATE INDEX "TransferRequest_fromOrganizationId_status_idx" ON "TransferRequest"("fromOrganizationId", "status");

-- CreateIndex
CREATE INDEX "TransferRequest_status_expiresAt_idx" ON "TransferRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "TransferContest_requestId_idx" ON "TransferContest"("requestId");

-- CreateIndex
CREATE INDEX "EnrollmentShare_personId_toOrganizationId_idx" ON "EnrollmentShare"("personId", "toOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EnrollmentShare_fromStudentId_toOrganizationId_key" ON "EnrollmentShare"("fromStudentId", "toOrganizationId");

-- AddForeignKey
ALTER TABLE "TransferRequest" ADD CONSTRAINT "TransferRequest_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferRequest" ADD CONSTRAINT "TransferRequest_fromOrganizationId_fkey" FOREIGN KEY ("fromOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferRequest" ADD CONSTRAINT "TransferRequest_toOrganizationId_fkey" FOREIGN KEY ("toOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferRequest" ADD CONSTRAINT "TransferRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferContest" ADD CONSTRAINT "TransferContest_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TransferRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentShare" ADD CONSTRAINT "EnrollmentShare_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TransferRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

