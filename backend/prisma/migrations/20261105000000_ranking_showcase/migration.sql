-- Ginga Rank (lado do aluno, docs/CONTRATO_RANK_ALUNO.md secao 3): vitrine de ate 3 conquistas ja ganhas no perfil.
-- So ADICIONA: perfis existentes ficam com a vitrine vazia.

-- AlterTable
ALTER TABLE "RankingProfile" ADD COLUMN     "showcase" TEXT[] DEFAULT ARRAY[]::TEXT[];
