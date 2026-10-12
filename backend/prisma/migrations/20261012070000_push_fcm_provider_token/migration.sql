-- Firebase Cloud Messaging (FCM) como transporte principal do push; Web Push (VAPID) segue como fallback.
-- Linhas provider='fcm' guardam so' o registration token; endpoint/p256dh/auth passam a aceitar NULL (os
-- indices unicos do Postgres admitem varios NULLs, entao a unicidade do endpoint webpush continua valendo).

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'webpush',
ADD COLUMN "token" TEXT,
ALTER COLUMN "endpoint" DROP NOT NULL,
ALTER COLUMN "p256dh" DROP NOT NULL,
ALTER COLUMN "auth" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_token_key" ON "PushSubscription"("token");