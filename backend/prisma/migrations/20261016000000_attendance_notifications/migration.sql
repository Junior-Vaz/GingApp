-- Aviso de presenca ("Presenca registrada"): so ADICIONA.
--  * Organization.attendanceNotifications (padrao true): o MESTRE liga/desliga o aviso do grupo;
--  * AttendanceNotice: uma linha por (aula, aluno) ja avisado => idempotencia (re-salvar a chamada nao avisa de novo).
-- Zero regressao: grupos existentes ficam com o aviso LIGADO (padrao true) e sem nenhum aviso retroativo.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "attendanceNotifications" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AttendanceNotice" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceNotice_lessonId_studentId_key" ON "AttendanceNotice"("lessonId", "studentId");
CREATE INDEX "AttendanceNotice_organizationId_idx" ON "AttendanceNotice"("organizationId");

-- AddForeignKey
ALTER TABLE "AttendanceNotice" ADD CONSTRAINT "AttendanceNotice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceNotice" ADD CONSTRAINT "AttendanceNotice_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceNotice" ADD CONSTRAINT "AttendanceNotice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
