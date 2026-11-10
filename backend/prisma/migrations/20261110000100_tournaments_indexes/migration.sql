-- Campeonatos ao vivo (docs/CONTRATO_CHAVEAMENTO.md): indices nas FKs de TournamentMatch que a migration anterior
-- (20261110000000_tournaments, ja aplicada) nao indexou. Todas sao ON DELETE SET NULL: sem indice, apagar uma luta ou um
-- atleta (e a exclusao em cascata de categoria/evento) varreria a tabela inteira para anular as referencias.
-- Escrita a mao (sem BOM). Tambem acrescenta um CHECK de defesa em profundidade: o vencedor de uma luta e sempre um dos dois
-- atletas dela (a folga nasce com o unico atleta presente como vencedor; empate/pendente tem vencedor nulo).
-- Os demais FKs (TournamentCompetitor.studentId/eventParticipantId/categoryId, TournamentCategory.tournamentId,
-- Tournament.organizationId/eventId) ja tem indice. A FK composta "atleta da mesma categoria" NAO foi criada (risco aceito:
-- a API valida; defesa em profundidade fica para depois).

-- CreateIndex
CREATE INDEX "TournamentMatch_nextMatchId_idx" ON "TournamentMatch"("nextMatchId");

-- CreateIndex
CREATE INDEX "TournamentMatch_loserNextMatchId_idx" ON "TournamentMatch"("loserNextMatchId");

-- CreateIndex
CREATE INDEX "TournamentMatch_slotAId_idx" ON "TournamentMatch"("slotAId");

-- CreateIndex
CREATE INDEX "TournamentMatch_slotBId_idx" ON "TournamentMatch"("slotBId");

-- CreateIndex
CREATE INDEX "TournamentMatch_winnerId_idx" ON "TournamentMatch"("winnerId");

-- AddCheck (manual): vencedor nulo ou um dos dois lados da luta.
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_winner_in_slots_check"
    CHECK ("winnerId" IS NULL OR "winnerId" = "slotAId" OR "winnerId" = "slotBId");
