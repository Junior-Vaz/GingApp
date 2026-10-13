-- Ficha unica - Fase 3: cargos acumulaveis (docs/FICHA_UNICA.md secao 5). Adiciona INSTRUTOR/MONITOR ao OrgRole, StaffRole,
-- PersonRole, GraduationRoleRule, RoleSuggestionNotice e Student.isStaff. Requer PostgreSQL >= 12 (ADD VALUE em transacao).
-- Dados: cada OrganizationUser ATIVO MESTRE/PROFESSOR vira um cargo ativo equivalente (source MIGRATION). O acesso NAO muda:
-- OrganizationUser.role continua igual. A matricula de aluno da equipe e criada pelo backfill (npm run roles:backfill / boot).

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('MESTRE', 'PROFESSOR', 'INSTRUTOR', 'MONITOR');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrgRole" ADD VALUE 'INSTRUTOR';
ALTER TYPE "OrgRole" ADD VALUE 'MONITOR';

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "isStaff" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PersonRole" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "personId" INTEGER,
    "role" "StaffRole" NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'GRANT',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedByUserId" INTEGER,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" INTEGER,

    CONSTRAINT "PersonRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraduationRoleRule" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "graduationSystemId" INTEGER NOT NULL,
    "role" "StaffRole" NOT NULL,
    "minLevelOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GraduationRoleRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleSuggestionNotice" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "role" "StaffRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleSuggestionNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonRole_organizationId_userId_revokedAt_idx" ON "PersonRole"("organizationId", "userId", "revokedAt");

-- CreateIndex
CREATE INDEX "PersonRole_personId_idx" ON "PersonRole"("personId");

-- CreateIndex
CREATE INDEX "GraduationRoleRule_organizationId_idx" ON "GraduationRoleRule"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GraduationRoleRule_graduationSystemId_role_key" ON "GraduationRoleRule"("graduationSystemId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "RoleSuggestionNotice_studentId_role_key" ON "RoleSuggestionNotice"("studentId", "role");

-- AddForeignKey
ALTER TABLE "PersonRole" ADD CONSTRAINT "PersonRole_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonRole" ADD CONSTRAINT "PersonRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonRole" ADD CONSTRAINT "PersonRole_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraduationRoleRule" ADD CONSTRAINT "GraduationRoleRule_graduationSystemId_fkey" FOREIGN KEY ("graduationSystemId") REFERENCES "GraduationSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleSuggestionNotice" ADD CONSTRAINT "RoleSuggestionNotice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Dados: cargos ativos equivalentes aos papeis de equipe ja existentes (idempotente).
INSERT INTO "PersonRole" ("organizationId", "userId", "personId", "role", "source", "grantedAt")
SELECT ou."organizationId", ou."userId", p."id", (ou."role"::text)::"StaffRole", 'MIGRATION', ou."createdAt"
FROM "OrganizationUser" ou
LEFT JOIN "Person" p ON p."userId" = ou."userId"
WHERE ou."status" = 'ACTIVE' AND ou."role"::text IN ('MESTRE', 'PROFESSOR')
  AND NOT EXISTS (SELECT 1 FROM "PersonRole" pr WHERE pr."organizationId" = ou."organizationId" AND pr."userId" = ou."userId" AND pr."role"::text = ou."role"::text AND pr."revokedAt" IS NULL);
