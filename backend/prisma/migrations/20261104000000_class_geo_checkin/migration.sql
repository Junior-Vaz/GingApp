-- Check-in por geolocalizacao (docs/CONTRATO_CHECKIN_GEOLOCALIZACAO.md secao 2): opcao por turma (padrao desligada, raio
-- padrao 150 m) e a ORIGEM da presenca registrada pelo proprio aluno (QR/GEO; nulo = chamada manual do professor).
-- So ADICIONA: turmas existentes ficam desligadas e presencas antigas ficam com origem nula. Nenhuma coordenada do aluno
-- e guardada em lugar nenhum.

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('QR', 'GEO');

-- AlterTable
ALTER TABLE "Class" ADD COLUMN     "geoCheckinEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "geoCheckinRadiusMeters" INTEGER NOT NULL DEFAULT 150;

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "checkinSource" "AttendanceSource";
