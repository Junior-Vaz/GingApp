-- Modo MANUAL da conta Mercado Pago do grupo (PLANO_PROJETO.md 10.54): o Mestre cola as credenciais da PROPRIA conta na
-- tela de configuracao do painel; o OAuth vira opcional. Linhas existentes ficam OAUTH (default). Segredo do webhook por
-- grupo cifrado; tokenHint = so os ultimos 4 caracteres do token. signatureVerified marca o webhook processado so como
-- gatilho (sem segredo).

-- CreateEnum
CREATE TYPE "PaymentAccountMode" AS ENUM ('MANUAL', 'OAUTH');

-- AlterTable
ALTER TABLE "PaymentProviderAccount" ADD COLUMN     "mode" "PaymentAccountMode" NOT NULL DEFAULT 'OAUTH',
ADD COLUMN     "tokenHint" TEXT,
ADD COLUMN     "webhookSecretEnc" TEXT;

-- AlterTable
ALTER TABLE "PaymentWebhookEvent" ADD COLUMN     "signatureVerified" BOOLEAN;
