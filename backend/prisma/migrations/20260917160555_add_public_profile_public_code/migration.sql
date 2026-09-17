-- AlterTable
ALTER TABLE "PublicProfile" ADD COLUMN     "publicCode" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PublicProfile_publicCode_key" ON "PublicProfile"("publicCode");
