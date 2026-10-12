-- Cordas multicoloridas: estilo (SOLID/SPLIT/BRAIDED) + ate 3 cores por nivel de graduacao.
-- `color` continua existindo como cor PRIMARIA (= colors[0]) para compatibilidade com clientes antigos.

-- CreateEnum
CREATE TYPE "RopeStyle" AS ENUM ('SOLID', 'SPLIT', 'BRAIDED');

-- AlterTable
ALTER TABLE "GraduationLevel" ADD COLUMN "style" "RopeStyle" NOT NULL DEFAULT 'SOLID',
ADD COLUMN "colors" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill (niveis existentes viram SOLID com colors = [color]):
--  1) #RRGGBB valido           -> colors = [color] em maiusculas
--  2) #RGB (atalho de 3 digitos) -> expandido para #RRGGBB
--  3) null / texto livre antigo -> cinza neutro #9CA3AF (color tambem, para manter color = colors[0])
UPDATE "GraduationLevel"
SET "colors" = ARRAY[upper("color")],
    "color" = upper("color")
WHERE "color" ~ '^#[0-9A-Fa-f]{6}$';

UPDATE "GraduationLevel"
SET "color" = upper('#' || regexp_replace(substr("color", 2), '(.)', '\1\1', 'g')),
    "colors" = ARRAY[upper('#' || regexp_replace(substr("color", 2), '(.)', '\1\1', 'g'))]
WHERE "color" ~ '^#[0-9A-Fa-f]{3}$';

UPDATE "GraduationLevel"
SET "color" = '#9CA3AF',
    "colors" = ARRAY['#9CA3AF']
WHERE cardinality("colors") = 0;
