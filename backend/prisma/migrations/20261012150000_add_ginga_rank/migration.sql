-- CreateEnum
CREATE TYPE "PointEventType" AS ENUM ('CLASS_ATTENDANCE', 'STREAK_BONUS', 'EVENT_ATTENDANCE', 'RODA_PARTICIPATION', 'MONTHLY_CONSISTENCY', 'GRADUATION', 'CERTIFICATE');

-- CreateTable
CREATE TABLE "PointEvent" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "type" "PointEventType" NOT NULL,
    "points" INTEGER NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "season" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingProfile" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "optInPublic" BOOLEAN NOT NULL DEFAULT false,
    "nickname" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonResult" (
    "id" SERIAL NOT NULL,
    "season" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "studentId" INTEGER,
    "organizationId" INTEGER,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeasonResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PointEvent_season_organizationId_idx" ON "PointEvent"("season", "organizationId");

-- CreateIndex
CREATE INDEX "PointEvent_studentId_season_idx" ON "PointEvent"("studentId", "season");

-- CreateIndex
CREATE UNIQUE INDEX "PointEvent_studentId_type_refType_refId_key" ON "PointEvent"("studentId", "type", "refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "RankingProfile_studentId_key" ON "RankingProfile"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_studentId_code_key" ON "Achievement"("studentId", "code");

-- CreateIndex
CREATE INDEX "SeasonResult_season_idx" ON "SeasonResult"("season");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonResult_season_scope_scopeKey_rank_key" ON "SeasonResult"("season", "scope", "scopeKey", "rank");

-- AddForeignKey
ALTER TABLE "PointEvent" ADD CONSTRAINT "PointEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointEvent" ADD CONSTRAINT "PointEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingProfile" ADD CONSTRAINT "RankingProfile_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

