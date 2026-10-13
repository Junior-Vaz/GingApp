-- Corda COM PONTAS: so ADICIONA duas colunas opcionais em GraduationLevel.
--  * tipStart: cor (#RRGGBB) da ponta de CIMA/primeira; null = sem ponta;
--  * tipEnd:   cor (#RRGGBB) da ponta de BAIXO/ultima; null = sem ponta.
-- Zero regressao: niveis existentes ficam com NULL nas duas (corda sem pontas, exatamente como hoje).

-- AlterTable
ALTER TABLE "GraduationLevel" ADD COLUMN "tipStart" TEXT,
ADD COLUMN "tipEnd" TEXT;
