-- Auditoria independente (A1): o feed nasce DESLIGADO em todos os grupos; o MESTRE liga em Configuracoes do feed
-- depois de conferir o modo de postagem e avisar os responsaveis sobre fotos de menores.
ALTER TABLE "Organization" ALTER COLUMN "feedEnabled" SET DEFAULT false;
UPDATE "Organization" SET "feedEnabled" = false;

-- Auditoria independente (M4): quem ocultou/recusou (nulo = ocultacao automatica por denuncias). Sem FK de proposito:
-- e so referencia para a hierarquia da moderacao (so o MESTRE desfaz o que o MESTRE ocultou).
ALTER TABLE "FeedPost" ADD COLUMN "hiddenById" INTEGER;
ALTER TABLE "FeedComment" ADD COLUMN "hiddenById" INTEGER;
