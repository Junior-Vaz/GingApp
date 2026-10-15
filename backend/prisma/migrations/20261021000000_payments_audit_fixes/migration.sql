-- Correcoes da auditoria adversarial do Pix (PLANO_PROJETO.md 10.53): fila justa da reconciliacao (pixLastCheckedAt) e
-- state do OAuth de uso unico (PaymentOauthState).

-- AlterTable
ALTER TABLE "FinancialRecord" ADD COLUMN     "pixLastCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "FinancialRecord_gatewayStatus_pixLastCheckedAt_idx" ON "FinancialRecord"("gatewayStatus", "pixLastCheckedAt");

-- CreateTable
CREATE TABLE "PaymentOauthState" (
    "id" SERIAL NOT NULL,
    "nonce" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentOauthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOauthState_nonce_key" ON "PaymentOauthState"("nonce");

-- CreateIndex
CREATE INDEX "PaymentOauthState_expiresAt_idx" ON "PaymentOauthState"("expiresAt");
