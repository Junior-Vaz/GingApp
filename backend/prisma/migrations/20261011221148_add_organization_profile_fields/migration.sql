-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "city" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "foundedYear" INTEGER,
ADD COLUMN     "history" TEXT,
ADD COLUMN     "socialLinks" JSONB,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "website" TEXT;
