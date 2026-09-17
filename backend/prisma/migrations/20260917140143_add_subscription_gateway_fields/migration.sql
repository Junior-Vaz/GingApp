-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "gatewayCustomerId" TEXT,
ADD COLUMN     "gatewayProvider" TEXT NOT NULL DEFAULT 'stub',
ADD COLUMN     "gatewaySubscriptionId" TEXT;
