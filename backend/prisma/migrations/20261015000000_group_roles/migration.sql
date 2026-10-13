-- Cargos DO GRUPO (docs/FICHA_UNICA.md secao 13): cada grupo cria/edita os seus cargos (Contramestre, Formado...).
-- So ADICIONA: tabela GroupRole + colunas groupRoleId (PersonRole, GraduationRoleRule, RoleSuggestionNotice).
-- Dados (zero regressao): cada grupo (Organization.type GROUP) ganha os 4 cargos padrao (Mestre 40, Professor 30,
-- Instrutor 20, Monitor 10; accessRole = o papel de mesmo nome) e cada cargo/regra/aviso existente aponta para o cargo
-- padrao do MESMO accessRole. PersonRole.role (o acesso) e OrganizationUser.role NAO mudam: ninguem ganha nem perde acesso.
-- O backfill idempotente (npm run group-roles:backfill / boot GROUP_ROLES_BACKFILL) cobre grupos criados depois.

-- CreateTable
CREATE TABLE "GroupRole" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "accessRole" "StaffRole" NOT NULL,
    "rank" INTEGER NOT NULL,
    "color" TEXT,
    "icon" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupRole_organizationId_slug_key" ON "GroupRole"("organizationId", "slug");
CREATE INDEX "GroupRole_organizationId_rank_idx" ON "GroupRole"("organizationId", "rank");

-- AddForeignKey
ALTER TABLE "GroupRole" ADD CONSTRAINT "GroupRole_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "PersonRole" ADD COLUMN "groupRoleId" INTEGER;
ALTER TABLE "GraduationRoleRule" ADD COLUMN "groupRoleId" INTEGER;
ALTER TABLE "RoleSuggestionNotice" ADD COLUMN "groupRoleId" INTEGER;

-- Unicos antigos (por enum) dao lugar aos unicos por cargo do grupo (dois cargos podem ter o mesmo accessRole).
DROP INDEX "GraduationRoleRule_graduationSystemId_role_key";
DROP INDEX "RoleSuggestionNotice_studentId_role_key";

-- Dados: os 4 cargos padrao de cada grupo (idempotente pelo unico organizationId+slug).
INSERT INTO "GroupRole" ("organizationId", "name", "slug", "accessRole", "rank", "color", "icon", "isDefault", "active", "updatedAt")
SELECT o."id", d."name", d."slug", d."accessRole"::"StaffRole", d."rank", d."color", d."icon", true, true, CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (VALUES
  ('Mestre', 'mestre', 'MESTRE', 40, '#B45309', 'crown'),
  ('Professor', 'professor', 'PROFESSOR', 30, '#1D4ED8', 'graduation-cap'),
  ('Instrutor', 'instrutor', 'INSTRUTOR', 20, '#047857', 'award'),
  ('Monitor', 'monitor', 'MONITOR', 10, '#7C3AED', 'clipboard-check')
) AS d("name", "slug", "accessRole", "rank", "color", "icon")
WHERE o."type" = 'GROUP'
ON CONFLICT ("organizationId", "slug") DO NOTHING;

-- Cada cargo/regra/aviso existente -> o cargo padrao do mesmo accessRole no mesmo grupo.
UPDATE "PersonRole" pr SET "groupRoleId" = gr."id"
FROM "GroupRole" gr
WHERE pr."groupRoleId" IS NULL AND gr."organizationId" = pr."organizationId" AND gr."isDefault" = true AND gr."accessRole" = pr."role";

UPDATE "GraduationRoleRule" r SET "groupRoleId" = gr."id"
FROM "GroupRole" gr
WHERE r."groupRoleId" IS NULL AND gr."organizationId" = r."organizationId" AND gr."isDefault" = true AND gr."accessRole" = r."role";

UPDATE "RoleSuggestionNotice" n SET "groupRoleId" = gr."id"
FROM "GroupRole" gr
WHERE n."groupRoleId" IS NULL AND gr."organizationId" = n."organizationId" AND gr."isDefault" = true AND gr."accessRole" = n."role";

-- CreateIndex
CREATE INDEX "PersonRole_groupRoleId_revokedAt_idx" ON "PersonRole"("groupRoleId", "revokedAt");
CREATE UNIQUE INDEX "GraduationRoleRule_graduationSystemId_groupRoleId_key" ON "GraduationRoleRule"("graduationSystemId", "groupRoleId");
CREATE UNIQUE INDEX "RoleSuggestionNotice_studentId_groupRoleId_key" ON "RoleSuggestionNotice"("studentId", "groupRoleId");

-- AddForeignKey
ALTER TABLE "PersonRole" ADD CONSTRAINT "PersonRole_groupRoleId_fkey" FOREIGN KEY ("groupRoleId") REFERENCES "GroupRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GraduationRoleRule" ADD CONSTRAINT "GraduationRoleRule_groupRoleId_fkey" FOREIGN KEY ("groupRoleId") REFERENCES "GroupRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleSuggestionNotice" ADD CONSTRAINT "RoleSuggestionNotice_groupRoleId_fkey" FOREIGN KEY ("groupRoleId") REFERENCES "GroupRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
