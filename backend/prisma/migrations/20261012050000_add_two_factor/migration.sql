-- AlterTable: 2FA TOTP opt-in (segredo cifrado em repouso; codigos de recuperacao so como hash)
ALTER TABLE "User" ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoFactorRecoveryHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "twoFactorLastStep" INTEGER;
