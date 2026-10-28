-- Stories do feed: FeedPost.kind (POST|STORY) + expiresAt, e FeedStoryView (quem viu cada story).
-- Posts existentes viram kind POST (DEFAULT) e nada muda para eles.

-- CreateEnum
CREATE TYPE "FeedPostKind" AS ENUM ('POST', 'STORY');

-- AlterTable
ALTER TABLE "FeedPost" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "kind" "FeedPostKind" NOT NULL DEFAULT 'POST';

-- CreateTable
CREATE TABLE "FeedStoryView" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedStoryView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedStoryView_userId_idx" ON "FeedStoryView"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedStoryView_postId_userId_key" ON "FeedStoryView"("postId", "userId");

-- CreateIndex
CREATE INDEX "FeedPost_organizationId_kind_status_expiresAt_idx" ON "FeedPost"("organizationId", "kind", "status", "expiresAt");

-- AddForeignKey
ALTER TABLE "FeedStoryView" ADD CONSTRAINT "FeedStoryView_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedStoryView" ADD CONSTRAINT "FeedStoryView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
