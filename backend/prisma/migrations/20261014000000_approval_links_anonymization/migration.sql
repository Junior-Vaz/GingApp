-- Pendencias da ficha unica (docs/FICHA_UNICA.md secao 12): convite guiado (link de aprovacao de transferencia para
-- adulto sem login) e anonimizacao LGPD. So ADICIONA; nenhum dado existente muda.

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "anonymizedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "anonymizedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TransferApprovalToken" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferApprovalToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransferApprovalToken_tokenHash_key" ON "TransferApprovalToken"("tokenHash");

-- CreateIndex
CREATE INDEX "TransferApprovalToken_requestId_usedAt_idx" ON "TransferApprovalToken"("requestId", "usedAt");

-- CreateIndex
CREATE INDEX "TransferApprovalToken_expiresAt_idx" ON "TransferApprovalToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "TransferApprovalToken" ADD CONSTRAINT "TransferApprovalToken_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TransferRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
