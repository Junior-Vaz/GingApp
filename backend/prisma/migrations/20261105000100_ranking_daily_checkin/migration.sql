-- Ginga Rank (lado do aluno, docs/CONTRATO_RANK_ALUNO.md secao 6): check-in diario do app (1 por aluno por dia civil de
-- America/Sao_Paulo, data calculada no servidor) e os dois tipos de ponto derivados dele. So ADICIONA.
-- Os valores novos do enum NAO sao usados nesta migration (nenhum INSERT/DEFAULT com eles): ALTER TYPE ... ADD VALUE
-- dentro de transacao e permitido no PostgreSQL >= 12 desde que o valor nao seja usado antes do commit.

-- AlterEnum
ALTER TYPE "PointEventType" ADD VALUE 'DAILY_CHECKIN';
ALTER TYPE "PointEventType" ADD VALUE 'DAILY_WEEK_BONUS';

-- CreateTable
CREATE TABLE "DailyCheckin" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "day" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyCheckin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyCheckin_organizationId_day_idx" ON "DailyCheckin"("organizationId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCheckin_studentId_day_key" ON "DailyCheckin"("studentId", "day");

-- AddForeignKey
ALTER TABLE "DailyCheckin" ADD CONSTRAINT "DailyCheckin_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCheckin" ADD CONSTRAINT "DailyCheckin_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
