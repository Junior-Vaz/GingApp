-- AlterTable
ALTER TABLE "Class" ADD COLUMN     "teacherUserId" INTEGER;

-- CreateIndex
CREATE INDEX "Class_teacherUserId_idx" ON "Class"("teacherUserId");

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_teacherUserId_fkey" FOREIGN KEY ("teacherUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
