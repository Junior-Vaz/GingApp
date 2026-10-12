import { api, ApiError, errorMessage } from "@/lib/api";
import type { AuthUser } from "@/lib/session";

/** GET /auth/me: o usuário da sessão + o estado da verificação em duas etapas (2FA TOTP, opt-in). */
export type AuthMe = AuthUser & { twoFactorEnabled: boolean; recoveryCodesRemaining: number };

/** POST /auth/2fa/setup (sem corpo): segredo ainda NÃO ativo; `qrCodeDataUrl` é um data:image/png;base64. */
export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

export const ME_QUERY_KEY = ["auth", "me"] as const;

export const fetchMe = () => api.get<AuthMe>("/auth/me");

export const setupTwoFactor = () => api.post<TwoFactorSetup>("/auth/2fa/setup");

/** Confirma o primeiro código do app: liga o 2FA e devolve os 8 códigos de recuperação (mostrados UMA vez). */
export const enableTwoFactor = (code: string) =>
  api.post<{ recoveryCodes: string[] }>("/auth/2fa/enable", { code });

export type DisableProof = { code: string } | { recoveryCode: string };

/** Desativa exigindo a senha E um código (do app ou de recuperação). */
export const disableTwoFactor = (password: string, proof: DisableProof) =>
  api.post<{ twoFactorEnabled: boolean }>("/auth/2fa/disable", { password, ...proof });

/** Redefine o 2FA de OUTRO usuário do grupo (só Mestre): POST /auth/2fa/reset/:userId; encerra as sessões dele. */
export const resetUserTwoFactor = (userId: number) =>
  api.post<{ twoFactorEnabled: boolean }>(`/auth/2fa/reset/${String(userId)}`);

export const TWO_FACTOR_CODE_PATTERN = /^\d{6}$/;
/** Código de recuperação: dois grupos de 5 caracteres separados por hífen (xxxxx-xxxxx). */
export const RECOVERY_CODE_PATTERN = /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/;

/** Erros 400/403/429 trazem `message`; 429 (limite de tentativas) ganha um texto amigável. */
export function twoFactorErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 429) {
    return "Muitas tentativas. Aguarde um minuto e tente novamente.";
  }
  return errorMessage(error, fallback);
}
