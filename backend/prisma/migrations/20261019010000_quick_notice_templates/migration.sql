-- Modelos de aviso rapido (FAB do painel): texto pronto cadastrado pelo MESTRE. So ADICIONA uma tabela.
-- Os modelos padrao do sistema (builtin) nao ficam no banco.

-- CreateTable
CREATE TABLE "QuickNoticeTemplate" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "emoji" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickNoticeTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuickNoticeTemplate_organizationId_sortOrder_idx" ON "QuickNoticeTemplate"("organizationId", "sortOrder");

-- AddForeignKey
ALTER TABLE "QuickNoticeTemplate" ADD CONSTRAINT "QuickNoticeTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;