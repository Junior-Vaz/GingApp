-- Ficha unica - Fases 4 e 5 (docs/FICHA_UNICA.md secoes 6 e 7): ocorrencias (Occurrence) e equivalencia de cordas
-- (LevelEquivalence + StudentGraduation.recognizedFromLevelId). So ADICIONA; nenhum dado existente muda.

-- CreateEnum
CREATE TYPE "OccurrenceKind" AS ENUM ('ADVERTENCIA', 'SUSPENSAO', 'EXPULSAO', 'OUTRA');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('ACTIVE', 'CONTESTED', 'RETRACTED');

-- AlterTable
ALTER TABLE "StudentGraduation" ADD COLUMN     "recognizedFromLevelId" INTEGER;

-- CreateTable
CREATE TABLE "Occurrence" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "personId" INTEGER,
    "kind" "OccurrenceKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "expelledEnrollment" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" INTEGER,
    "contestedAt" TIMESTAMP(3),
    "contestNote" TEXT,
    "contestedByUserId" INTEGER,
    "retractedAt" TIMESTAMP(3),
    "retractNote" TEXT,
    "retractedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Occurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelEquivalence" (
    "id" SERIAL NOT NULL,
    "toOrganizationId" INTEGER NOT NULL,
    "fromLevelId" INTEGER NOT NULL,
    "toLevelId" INTEGER NOT NULL,
    "declaredByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LevelEquivalence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Occurrence_organizationId_studentId_idx" ON "Occurrence"("organizationId", "studentId");

-- CreateIndex
CREATE INDEX "Occurrence_personId_idx" ON "Occurrence"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "LevelEquivalence_toOrganizationId_fromLevelId_key" ON "LevelEquivalence"("toOrganizationId", "fromLevelId");

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelEquivalence" ADD CONSTRAINT "LevelEquivalence_fromLevelId_fkey" FOREIGN KEY ("fromLevelId") REFERENCES "GraduationLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelEquivalence" ADD CONSTRAINT "LevelEquivalence_toLevelId_fkey" FOREIGN KEY ("toLevelId") REFERENCES "GraduationLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

