-- Fotos de turma e unidade (User.photo ja existia) + aulas continuas (geracao rolante por turma).
-- AlterTable
ALTER TABLE "Unit" ADD COLUMN "photo" TEXT;

-- AlterTable
-- autoGenerateLessons DEFAULT true: turmas ja existentes (com weekday) passam a ter aulas geradas automaticamente
-- pelo job diario / ensureHorizon (LESSONS_HORIZON_DAYS a frente). Quem nao quiser desliga por turma (PATCH /classes/:id).
ALTER TABLE "Class" ADD COLUMN "photo" TEXT,
ADD COLUMN "autoGenerateLessons" BOOLEAN NOT NULL DEFAULT true;
