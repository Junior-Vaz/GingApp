-- AlterEnum
ALTER TYPE "ParticipantStatus" ADD VALUE 'WAITLIST';

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RodaRecurrence" AS ENUM ('NONE', 'WEEKLY', 'MONTHLY_WEEKDAY', 'MONTHLY_DAY');

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "audienceRole" "OrgRole",
ADD COLUMN     "classId" INTEGER,
ADD COLUMN     "stateUf" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "capacity" INTEGER,
ADD COLUMN     "priceCents" INTEGER,
ADD COLUMN     "registrationDeadline" TIMESTAMP(3),
ADD COLUMN     "status" "EventStatus" NOT NULL DEFAULT 'PUBLISHED';

-- AlterTable
ALTER TABLE "Roda" ADD COLUMN     "parentRodaId" INTEGER,
ADD COLUMN     "recurrence" "RodaRecurrence" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "recurrenceUntil" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Roda_parentRodaId_date_key" ON "Roda"("parentRodaId", "date");

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Roda" ADD CONSTRAINT "Roda_parentRodaId_fkey" FOREIGN KEY ("parentRodaId") REFERENCES "Roda"("id") ON DELETE SET NULL ON UPDATE CASCADE;
