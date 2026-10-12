-- Ficha unica do capoeirista - Fase 1 (docs/FICHA_UNICA.md).
-- So ADICIONA: tabela Person (identidade global, CPF cifrado + hash) e Student.personId (nullable). Nenhum dado
-- existente e alterado aqui; o vinculo das matriculas antigas e feito pelo backfill idempotente
-- (npm run person:backfill / boot do Docker com PERSON_BACKFILL). Rollback: ver docs/FICHA_UNICA.md secao 9.

-- CreateEnum
CREATE TYPE "PersonDocumentKind" AS ENUM ('CPF', 'GUARDIAN_CPF', 'PASSPORT');

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "personId" INTEGER;

-- CreateTable
CREATE TABLE "Person" (
    "id" SERIAL NOT NULL,
    "gingappCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nickname" TEXT,
    "birthDate" TIMESTAMP(3),
    "photo" TEXT,
    "gender" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "documentHash" TEXT,
    "documentEnc" TEXT,
    "documentLast4" TEXT,
    "documentKind" "PersonDocumentKind",
    "userId" INTEGER,
    "mergedIntoId" INTEGER,
    "mergedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_gingappCode_key" ON "Person"("gingappCode");

-- CreateIndex
CREATE UNIQUE INDEX "Person_documentHash_key" ON "Person"("documentHash");

-- CreateIndex
CREATE UNIQUE INDEX "Person_userId_key" ON "Person"("userId");

-- CreateIndex
CREATE INDEX "Person_birthDate_idx" ON "Person"("birthDate");

-- CreateIndex
CREATE INDEX "Person_mergedIntoId_idx" ON "Person"("mergedIntoId");

-- CreateIndex
CREATE INDEX "Student_personId_idx" ON "Student"("personId");

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
