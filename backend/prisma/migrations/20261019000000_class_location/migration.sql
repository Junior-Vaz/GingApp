-- Local do treino proprio da turma (opcional). Tudo NULL = a turma herda endereco/coordenadas da unidade
-- (turmas existentes nao mudam). Mesmo desenho da Unit: address/city/state + latitude/longitude.
ALTER TABLE "Class" ADD COLUMN "locationLabel" TEXT,
ADD COLUMN "address" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "state" TEXT,
ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;

-- Pre-filtro do mapa (GET /map/places) por caixa de coordenadas.
CREATE INDEX "Class_latitude_longitude_idx" ON "Class"("latitude", "longitude");
