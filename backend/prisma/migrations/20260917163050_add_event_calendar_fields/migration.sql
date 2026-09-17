-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "cityId" INTEGER,
ADD COLUMN     "stateId" INTEGER,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'OUTRO';

-- CreateIndex
CREATE INDEX "Event_stateId_date_idx" ON "Event"("stateId", "date");

-- CreateIndex
CREATE INDEX "Event_cityId_date_idx" ON "Event"("cityId", "date");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;
