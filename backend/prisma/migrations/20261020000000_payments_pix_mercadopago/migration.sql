-- Cobranca Pix de mensalidades pelo provedor de pagamento DO GRUPO (Mercado Pago via OAuth) - PLANO_PROJETO.md 10.52.
-- Conta conectada por grupo (tokens cifrados), campos Pix/gateway no lancamento e eventos de webhook (idempotencia).

-- CreateEnum
CREATE TYPE "PaidVia" AS ENUM ('MANUAL', 'PIX_AUTO');

-- CreateEnum
CREATE TYPE "PaymentAccountStatus" AS ENUM ('CONNECTED', 'REVOKED', 'ERROR');

-- AlterTable
ALTER TABLE "FinancialRecord" ADD COLUMN     "gatewayPaymentId" TEXT,
ADD COLUMN     "gatewayProvider" TEXT,
ADD COLUMN     "gatewayStatus" TEXT,
ADD COLUMN     "paidVia" "PaidVia",
ADD COLUMN     "pixAmountCents" INTEGER,
ADD COLUMN     "pixExpiresAt" TIMESTAMP(3),
ADD COLUMN     "pixGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "pixQrCode" TEXT,
ADD COLUMN     "pixQrCodeBase64" TEXT,
ADD COLUMN     "pixSeq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pixTicketUrl" TEXT;

-- CreateTable
CREATE TABLE "PaymentProviderAccount" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "publicKey" TEXT,
    "liveMode" BOOLEAN NOT NULL DEFAULT false,
    "status" "PaymentAccountStatus" NOT NULL DEFAULT 'CONNECTED',
    "connectedAt" TIMESTAMP(3),
    "connectedById" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProviderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "paymentId" TEXT,
    "organizationId" INTEGER,
    "financialRecordId" INTEGER,
    "source" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "rawSafe" JSONB,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentProviderAccount_provider_providerUserId_idx" ON "PaymentProviderAccount"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderAccount_organizationId_provider_key" ON "PaymentProviderAccount"("organizationId", "provider");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_provider_paymentId_idx" ON "PaymentWebhookEvent"("provider", "paymentId");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_organizationId_receivedAt_idx" ON "PaymentWebhookEvent"("organizationId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_eventId_key" ON "PaymentWebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "FinancialRecord_gatewayStatus_pixGeneratedAt_idx" ON "FinancialRecord"("gatewayStatus", "pixGeneratedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialRecord_gatewayProvider_gatewayPaymentId_key" ON "FinancialRecord"("gatewayProvider", "gatewayPaymentId");

-- AddForeignKey
ALTER TABLE "PaymentProviderAccount" ADD CONSTRAINT "PaymentProviderAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

