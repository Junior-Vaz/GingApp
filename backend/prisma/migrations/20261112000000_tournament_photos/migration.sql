-- Foto PROPRIA do atleta de fora do chaveamento (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md secao 1): arquivo WebP em armazenamento
-- privado (TOURNAMENT_PHOTOS_DIR), nome `<uuid>.webp`, servido so enquanto a regra de privacidade do telao permitir.
-- So ADICIONA colunas anulaveis a TournamentCompetitor (nenhuma linha existente muda). A coluna `photoUrl` continua existindo
-- (LEGADO: so leitura; o envio de photoUrl foi extinto na API). Escrita a mao, sem BOM.

-- AlterTable
ALTER TABLE "TournamentCompetitor" ADD COLUMN     "photoBytes" INTEGER,
ADD COLUMN     "photoFile" TEXT,
ADD COLUMN     "photoUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "TournamentCompetitor_photoFile_key" ON "TournamentCompetitor"("photoFile");
