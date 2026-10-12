-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "mapVisible" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Roda" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "Event_latitude_longitude_idx" ON "Event"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "Roda_latitude_longitude_idx" ON "Roda"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "Unit_latitude_longitude_idx" ON "Unit"("latitude", "longitude");
