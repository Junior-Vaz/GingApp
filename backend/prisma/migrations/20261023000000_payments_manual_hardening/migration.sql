-- Endurecimento do modo MANUAL do Mercado Pago (PLANO_PROJETO.md 10.56).
-- gatewayAccountId: conta do provedor em que o Pix atual foi criado (troca de conta => 'account_changed', nao 404 eterno).
-- signatureAlertAt: ultimo aviso "assinatura do webhook nao confere" (1 por 24 h por grupo).
-- signatureProblem: motivo do webhook processado so como gatilho (MISSING | MISMATCH | UNREADABLE).

-- AlterTable
ALTER TABLE "FinancialRecord" ADD COLUMN     "gatewayAccountId" TEXT;

-- AlterTable
ALTER TABLE "PaymentProviderAccount" ADD COLUMN     "signatureAlertAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PaymentWebhookEvent" ADD COLUMN     "signatureProblem" TEXT;

-- Backfill (melhor esforco): Pix ja gerados ficam com a conta ATUAL do grupo (a troca de conta era bloqueada com Pix pagavel).
UPDATE "FinancialRecord" AS fr
SET "gatewayAccountId" = a."providerUserId"
FROM "PaymentProviderAccount" AS a
WHERE a."organizationId" = fr."organizationId"
  AND a."provider" = fr."gatewayProvider"
  AND a."providerUserId" IS NOT NULL
  AND fr."gatewayPaymentId" IS NOT NULL
  AND fr."gatewayAccountId" IS NULL;
