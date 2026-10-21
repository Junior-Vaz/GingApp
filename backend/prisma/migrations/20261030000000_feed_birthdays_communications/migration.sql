-- CreateEnum
CREATE TYPE "CommunicationStatus" AS ENUM ('SENT', 'SCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommunicationScope" AS ENUM ('GROUP', 'UNIT', 'CLASS', 'ROLE', 'BIRTHDAY_MONTH');

-- CreateEnum
CREATE TYPE "AckRequirement" AS ENUM ('NONE', 'READ', 'GOING');

-- CreateEnum
CREATE TYPE "AckResponse" AS ENUM ('READ', 'GOING', 'NOT_GOING');

-- CreateEnum
CREATE TYPE "BirthdayGreetingSource" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "FeedPostingMode" AS ENUM ('ALL', 'STAFF_ONLY', 'MODERATED');

-- CreateEnum
CREATE TYPE "FeedVisibility" AS ENUM ('GROUP', 'UNIT', 'CLASS');

-- CreateEnum
CREATE TYPE "FeedPostStatus" AS ENUM ('PUBLISHED', 'PENDING_APPROVAL', 'HIDDEN', 'REMOVED');

-- CreateEnum
CREATE TYPE "FeedCommentStatus" AS ENUM ('PUBLISHED', 'HIDDEN', 'REMOVED');

-- CreateEnum
CREATE TYPE "FeedReactionType" AS ENUM ('AXE', 'SALVE', 'GINGA', 'PARABENS', 'CORACAO');

-- CreateEnum
CREATE TYPE "FeedReportReason" AS ENUM ('OFENSIVO', 'IMPROPRIO', 'SPAM', 'MENOR', 'OUTRO');

-- CreateEnum
CREATE TYPE "FeedReportStatus" AS ENUM ('OPEN', 'DISMISSED', 'ACTIONED');

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "lastResendAt" TIMESTAMP(3),
ADD COLUMN     "pinToFeed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinnedUntil" TIMESTAMP(3),
ADD COLUMN     "recipientsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "requiresAck" "AckRequirement" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "scopeRole" TEXT,
ADD COLUMN     "scopeType" "CommunicationScope",
ADD COLUMN     "status" "CommunicationStatus" NOT NULL DEFAULT 'SENT';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "announcementId" INTEGER,
ADD COLUMN     "data" JSONB;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "birthdayAutoGreeting" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "birthdayDailyDigest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "birthdayGreetingHour" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "birthdayGreetingMessage" TEXT,
ADD COLUMN     "feedAllowComments" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "feedBlockedWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "feedEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "feedPostingMode" "FeedPostingMode" NOT NULL DEFAULT 'MODERATED';

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "birthdayVisible" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AnnouncementAck" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "announcementId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "response" "AckResponse" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnouncementAck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BirthdayGreeting" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "source" "BirthdayGreetingSource" NOT NULL,
    "greeterUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BirthdayGreeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BirthdayCongrats" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "giverUserId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BirthdayCongrats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedPost" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "authorUserId" INTEGER,
    "authorPersonId" INTEGER,
    "body" TEXT,
    "visibility" "FeedVisibility" NOT NULL DEFAULT 'GROUP',
    "unitId" INTEGER,
    "classId" INTEGER,
    "status" "FeedPostStatus" NOT NULL DEFAULT 'PUBLISHED',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "hiddenReason" TEXT,
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FeedPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedPostMedia" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "postId" INTEGER,
    "uploaderUserId" INTEGER,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "pendingExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedPostMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedReaction" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "FeedReactionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedComment" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "postId" INTEGER NOT NULL,
    "parentId" INTEGER,
    "authorUserId" INTEGER,
    "body" TEXT,
    "status" "FeedCommentStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FeedComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedReport" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "postId" INTEGER,
    "commentId" INTEGER,
    "reporterUserId" INTEGER,
    "reason" "FeedReportReason" NOT NULL,
    "note" TEXT,
    "status" "FeedReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedActivityNotice" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "authorUserId" INTEGER NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "lastActorUserId" INTEGER,
    "notificationId" INTEGER,

    CONSTRAINT "FeedActivityNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnnouncementAck_organizationId_userId_idx" ON "AnnouncementAck"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementAck_announcementId_userId_key" ON "AnnouncementAck"("announcementId", "userId");

-- CreateIndex
CREATE INDEX "BirthdayGreeting_organizationId_year_idx" ON "BirthdayGreeting"("organizationId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayGreeting_organizationId_personId_year_source_key" ON "BirthdayGreeting"("organizationId", "personId", "year", "source");

-- CreateIndex
CREATE INDEX "BirthdayCongrats_organizationId_giverUserId_year_idx" ON "BirthdayCongrats"("organizationId", "giverUserId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayCongrats_organizationId_personId_giverUserId_year_key" ON "BirthdayCongrats"("organizationId", "personId", "giverUserId", "year");

-- CreateIndex
CREATE INDEX "FeedPost_organizationId_status_pinned_createdAt_idx" ON "FeedPost"("organizationId", "status", "pinned", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "FeedPost_organizationId_unitId_idx" ON "FeedPost"("organizationId", "unitId");

-- CreateIndex
CREATE INDEX "FeedPost_organizationId_classId_idx" ON "FeedPost"("organizationId", "classId");

-- CreateIndex
CREATE INDEX "FeedPost_authorUserId_idx" ON "FeedPost"("authorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedPostMedia_storageKey_key" ON "FeedPostMedia"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "FeedPostMedia_thumbKey_key" ON "FeedPostMedia"("thumbKey");

-- CreateIndex
CREATE INDEX "FeedPostMedia_postId_order_idx" ON "FeedPostMedia"("postId", "order");

-- CreateIndex
CREATE INDEX "FeedPostMedia_pendingExpiresAt_idx" ON "FeedPostMedia"("pendingExpiresAt");

-- CreateIndex
CREATE INDEX "FeedPostMedia_organizationId_uploaderUserId_idx" ON "FeedPostMedia"("organizationId", "uploaderUserId");

-- CreateIndex
CREATE INDEX "FeedReaction_userId_idx" ON "FeedReaction"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedReaction_postId_userId_key" ON "FeedReaction"("postId", "userId");

-- CreateIndex
CREATE INDEX "FeedComment_postId_createdAt_idx" ON "FeedComment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "FeedComment_authorUserId_idx" ON "FeedComment"("authorUserId");

-- CreateIndex
CREATE INDEX "FeedReport_organizationId_status_createdAt_idx" ON "FeedReport"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FeedReport_postId_idx" ON "FeedReport"("postId");

-- CreateIndex
CREATE INDEX "FeedReport_commentId_idx" ON "FeedReport"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedReport_reporterUserId_postId_key" ON "FeedReport"("reporterUserId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedReport_reporterUserId_commentId_key" ON "FeedReport"("reporterUserId", "commentId");

-- CreateIndex
CREATE INDEX "FeedActivityNotice_windowStartedAt_idx" ON "FeedActivityNotice"("windowStartedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeedActivityNotice_postId_authorUserId_key" ON "FeedActivityNotice"("postId", "authorUserId");

-- CreateIndex
CREATE INDEX "Announcement_status_scheduledAt_idx" ON "Announcement"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Announcement_organizationId_status_createdAt_idx" ON "Announcement"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Announcement_organizationId_pinToFeed_status_idx" ON "Announcement"("organizationId", "pinToFeed", "status");

-- CreateIndex
CREATE INDEX "Notification_announcementId_readAt_idx" ON "Notification"("announcementId", "readAt");

-- AddForeignKey
ALTER TABLE "AnnouncementAck" ADD CONSTRAINT "AnnouncementAck_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementAck" ADD CONSTRAINT "AnnouncementAck_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementAck" ADD CONSTRAINT "AnnouncementAck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayGreeting" ADD CONSTRAINT "BirthdayGreeting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayGreeting" ADD CONSTRAINT "BirthdayGreeting_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayGreeting" ADD CONSTRAINT "BirthdayGreeting_greeterUserId_fkey" FOREIGN KEY ("greeterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayCongrats" ADD CONSTRAINT "BirthdayCongrats_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayCongrats" ADD CONSTRAINT "BirthdayCongrats_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayCongrats" ADD CONSTRAINT "BirthdayCongrats_giverUserId_fkey" FOREIGN KEY ("giverUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_authorPersonId_fkey" FOREIGN KEY ("authorPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPostMedia" ADD CONSTRAINT "FeedPostMedia_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPostMedia" ADD CONSTRAINT "FeedPostMedia_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPostMedia" ADD CONSTRAINT "FeedPostMedia_uploaderUserId_fkey" FOREIGN KEY ("uploaderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedReaction" ADD CONSTRAINT "FeedReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedReaction" ADD CONSTRAINT "FeedReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedComment" ADD CONSTRAINT "FeedComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedComment" ADD CONSTRAINT "FeedComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedComment" ADD CONSTRAINT "FeedComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FeedComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedComment" ADD CONSTRAINT "FeedComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedReport" ADD CONSTRAINT "FeedReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedReport" ADD CONSTRAINT "FeedReport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedReport" ADD CONSTRAINT "FeedReport_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "FeedComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedReport" ADD CONSTRAINT "FeedReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedReport" ADD CONSTRAINT "FeedReport_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedActivityNotice" ADD CONSTRAINT "FeedActivityNotice_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedActivityNotice" ADD CONSTRAINT "FeedActivityNotice_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Aniversariantes: consulta por mes/dia de nascimento (indice funcional; o Prisma nao o modela, por isso so aqui).
-- EXTRACT sobre timestamp sem fuso e IMMUTABLE. Consultas devem usar exatamente EXTRACT(MONTH/DAY FROM "birthDate").
CREATE INDEX "Person_birthDate_month_day_idx" ON "Person" ((EXTRACT(MONTH FROM "birthDate")), (EXTRACT(DAY FROM "birthDate"))) WHERE "birthDate" IS NOT NULL;

-- Denuncia mira exatamente UM alvo (post OU comentario).
ALTER TABLE "FeedReport" ADD CONSTRAINT "FeedReport_one_target_chk" CHECK (("postId" IS NULL) <> ("commentId" IS NULL));

-- Hora dos parabens automaticos: 0..23.
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_birthdayGreetingHour_chk" CHECK ("birthdayGreetingHour" BETWEEN 0 AND 23);
