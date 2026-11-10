-- Campeonatos ao vivo / chaveamento (docs/CONTRATO_CHAVEAMENTO.md secao 2, fase 1): torneio por evento, categorias,
-- atletas e lutas. So ADICIONA tabelas e enums: nenhuma tabela existente muda (as FKs ficam do lado do torneio).
-- Escrita a mao (sem BOM). Itens que o Prisma NAO modela e que existem so aqui:
--  * indice UNICO (tournamentId, lower(name)) em TournamentCategory (nome sem diferenciar maiusculas);
--  * indices UNICOS PARCIAIS (categoryId, studentId) e (categoryId, eventParticipantId) em TournamentCompetitor;
--  * CHECKs de defesa em profundidade (o DTO ja valida tudo isto).
-- Enum TournamentFormat: a fase 2 (dupla eliminacao etc.) faz ALTER TYPE ... ADD VALUE em migration SEPARADA.

-- CreateEnum
CREATE TYPE "TournamentFormat" AS ENUM ('SINGLE_ELIMINATION', 'ROUND_ROBIN', 'GROUPS_KNOCKOUT');

-- CreateEnum
CREATE TYPE "TournamentCategoryStatus" AS ENUM ('SETUP', 'RUNNING', 'FINISHED');

-- CreateEnum
CREATE TYPE "TournamentMatchStage" AS ENUM ('GROUP', 'MAIN', 'THIRD_PLACE');

-- CreateEnum
CREATE TYPE "TournamentMatchStatus" AS ENUM ('PENDING', 'READY', 'LIVE', 'FINISHED');

-- CreateEnum
CREATE TYPE "TournamentResultType" AS ENUM ('NORMAL', 'WALKOVER', 'DISQUALIFICATION', 'DRAW');

-- CreateEnum
CREATE TYPE "TournamentAgeGroup" AS ENUM ('ADULT', 'MINOR', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Tournament" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "eventId" INTEGER NOT NULL,
    "publicToken" TEXT NOT NULL,
    "publicEnabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Tournament_revision_check" CHECK ("revision" >= 0),
    CONSTRAINT "Tournament_publicToken_check" CHECK (char_length("publicToken") >= 24)
);

-- CreateTable
CREATE TABLE "TournamentCategory" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "tournamentId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "format" "TournamentFormat" NOT NULL,
    "status" "TournamentCategoryStatus" NOT NULL DEFAULT 'SETUP',
    "thirdPlace" BOOLEAN NOT NULL DEFAULT false,
    "groupCount" INTEGER,
    "advancePerGroup" INTEGER,
    "drawSeed" INTEGER,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentCategory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TournamentCategory_name_check" CHECK (char_length("name") BETWEEN 1 AND 80),
    CONSTRAINT "TournamentCategory_groupCount_check" CHECK ("groupCount" IS NULL OR "groupCount" BETWEEN 2 AND 16),
    CONSTRAINT "TournamentCategory_advancePerGroup_check" CHECK ("advancePerGroup" IS NULL OR "advancePerGroup" BETWEEN 1 AND 4)
);

-- CreateTable
CREATE TABLE "TournamentCompetitor" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "displayName" TEXT NOT NULL,
    "groupName" TEXT,
    "graduationLabel" TEXT,
    "seed" INTEGER,
    "poolIndex" INTEGER,
    "studentId" INTEGER,
    "eventParticipantId" INTEGER,
    "photoUrl" TEXT,
    "ageGroup" "TournamentAgeGroup" NOT NULL DEFAULT 'UNKNOWN',
    "photoAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "photoAuthorizedById" INTEGER,
    "photoAuthorizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentCompetitor_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TournamentCompetitor_displayName_check" CHECK (char_length("displayName") BETWEEN 2 AND 80),
    CONSTRAINT "TournamentCompetitor_seed_check" CHECK ("seed" IS NULL OR "seed" BETWEEN 1 AND 128),
    -- A foto gravada (convidado) so pode ser caminho de upload do proprio backend ou https (nunca javascript:/data:/http).
    CONSTRAINT "TournamentCompetitor_photoUrl_check" CHECK ("photoUrl" IS NULL OR "photoUrl" ~ '^(/api/uploads/|https://)')
);

-- CreateTable
CREATE TABLE "TournamentMatch" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "stage" "TournamentMatchStage" NOT NULL,
    "round" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "groupIndex" INTEGER,
    "slotAId" INTEGER,
    "slotBId" INTEGER,
    "nextMatchId" INTEGER,
    "nextSlot" TEXT,
    "loserNextMatchId" INTEGER,
    "loserNextSlot" TEXT,
    "isBye" BOOLEAN NOT NULL DEFAULT false,
    "status" "TournamentMatchStatus" NOT NULL DEFAULT 'PENDING',
    "winnerId" INTEGER,
    "scoreA" INTEGER,
    "scoreB" INTEGER,
    "resultType" "TournamentResultType",
    "note" TEXT,
    "mat" INTEGER,
    "queueOrder" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentMatch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TournamentMatch_round_check" CHECK ("round" >= 1 AND "position" >= 0),
    CONSTRAINT "TournamentMatch_nextSlot_check" CHECK ("nextSlot" IS NULL OR "nextSlot" IN ('A', 'B')),
    CONSTRAINT "TournamentMatch_loserNextSlot_check" CHECK ("loserNextSlot" IS NULL OR "loserNextSlot" IN ('A', 'B')),
    CONSTRAINT "TournamentMatch_score_check" CHECK (("scoreA" IS NULL OR "scoreA" BETWEEN 0 AND 999) AND ("scoreB" IS NULL OR "scoreB" BETWEEN 0 AND 999)),
    CONSTRAINT "TournamentMatch_mat_check" CHECK ("mat" IS NULL OR "mat" BETWEEN 0 AND 40),
    CONSTRAINT "TournamentMatch_note_check" CHECK ("note" IS NULL OR char_length("note") <= 200),
    -- Um atleta nunca enfrenta a si mesmo.
    CONSTRAINT "TournamentMatch_distinct_slots_check" CHECK ("slotAId" IS NULL OR "slotBId" IS NULL OR "slotAId" <> "slotBId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_eventId_key" ON "Tournament"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_publicToken_key" ON "Tournament"("publicToken");

-- CreateIndex
CREATE INDEX "Tournament_organizationId_idx" ON "Tournament"("organizationId");

-- CreateIndex
CREATE INDEX "TournamentCategory_organizationId_idx" ON "TournamentCategory"("organizationId");

-- CreateIndex
CREATE INDEX "TournamentCategory_tournamentId_position_idx" ON "TournamentCategory"("tournamentId", "position");

-- CreateIndex (manual): nome de categoria unico por torneio, sem diferenciar maiusculas/minusculas.
CREATE UNIQUE INDEX "TournamentCategory_tournamentId_lowername_key" ON "TournamentCategory"("tournamentId", lower("name"));

-- CreateIndex
CREATE INDEX "TournamentCompetitor_organizationId_idx" ON "TournamentCompetitor"("organizationId");

-- CreateIndex
CREATE INDEX "TournamentCompetitor_categoryId_idx" ON "TournamentCompetitor"("categoryId");

-- CreateIndex
CREATE INDEX "TournamentCompetitor_studentId_idx" ON "TournamentCompetitor"("studentId");

-- CreateIndex
CREATE INDEX "TournamentCompetitor_eventParticipantId_idx" ON "TournamentCompetitor"("eventParticipantId");

-- CreateIndex (manual, parcial): o mesmo aluno / a mesma inscricao no evento so entra uma vez por categoria.
CREATE UNIQUE INDEX "TournamentCompetitor_category_student_key" ON "TournamentCompetitor"("categoryId", "studentId") WHERE "studentId" IS NOT NULL;

-- CreateIndex (manual, parcial)
CREATE UNIQUE INDEX "TournamentCompetitor_category_participant_key" ON "TournamentCompetitor"("categoryId", "eventParticipantId") WHERE "eventParticipantId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "TournamentMatch_organizationId_idx" ON "TournamentMatch"("organizationId");

-- CreateIndex
CREATE INDEX "TournamentMatch_categoryId_stage_round_position_idx" ON "TournamentMatch"("categoryId", "stage", "round", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentMatch_categoryId_key_key" ON "TournamentMatch"("categoryId", "key");

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentCategory" ADD CONSTRAINT "TournamentCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentCategory" ADD CONSTRAINT "TournamentCategory_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentCompetitor" ADD CONSTRAINT "TournamentCompetitor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentCompetitor" ADD CONSTRAINT "TournamentCompetitor_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TournamentCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentCompetitor" ADD CONSTRAINT "TournamentCompetitor_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentCompetitor" ADD CONSTRAINT "TournamentCompetitor_eventParticipantId_fkey" FOREIGN KEY ("eventParticipantId") REFERENCES "EventParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TournamentCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_slotAId_fkey" FOREIGN KEY ("slotAId") REFERENCES "TournamentCompetitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_slotBId_fkey" FOREIGN KEY ("slotBId") REFERENCES "TournamentCompetitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "TournamentCompetitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_nextMatchId_fkey" FOREIGN KEY ("nextMatchId") REFERENCES "TournamentMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_loserNextMatchId_fkey" FOREIGN KEY ("loserNextMatchId") REFERENCES "TournamentMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
