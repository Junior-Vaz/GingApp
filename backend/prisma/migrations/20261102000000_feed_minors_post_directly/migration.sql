-- Opcao do MESTRE no feed: menor de 18 anos publica direto, sem a aprovacao obrigatoria de menor. Padrao false (regra atual).
ALTER TABLE "Organization" ADD COLUMN "feedMinorsPostDirectly" BOOLEAN NOT NULL DEFAULT false;
