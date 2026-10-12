import { useQuery } from "@tanstack/react-query";
import { api, ApiError, errorMessage } from "@/lib/api";

/**
 * 2FA TOTP opt-in (aluno/responsável). Contrato com o backend:
 *   GET  /auth/me            -> inclui twoFactorEnabled e recoveryCodesRemaining
 *   POST /auth/2fa/setup     -> { secret, otpauthUrl, qrCodeDataUrl }
 *   POST /auth/2fa/enable    { code } -> { recoveryCodes: string[] }
 *   POST /auth/2fa/disable   { password, code | recoveryCode } -> { twoFactorEnabled: false }
 * Erros de código/senha voltam como 400/403/429 com `message` (nunca 401).
 */
export const TOTP_CODE_LENGTH = 6;

/** Só dígitos, no máximo 6 (cola "123 456" e digitação com espaços funcionam). */
export const cleanTotpCode = (value: string): string => value.replace(/\D/g, "").slice(0, TOTP_CODE_LENGTH);

export interface TwoFactorStatus {
  twoFactorEnabled?: boolean;
  recoveryCodesRemaining?: number;
}

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  /** data:image/png;base64,... pronto para <img src>. */
  qrCodeDataUrl: string;
}

export type DisableProof = { code: string } | { recoveryCode: string };

/** Mesma chave do "Meus dados" (GET /auth/me): as duas seções compartilham o cache. */
export const ME_QUERY_KEY = ["auth-me"] as const;

export function useTwoFactorStatus() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => api.get<TwoFactorStatus>("/auth/me"),
  });
}

export const setupTwoFactor = () => api.post<TwoFactorSetup>("/auth/2fa/setup");

export const enableTwoFactor = (code: string) =>
  api.post<{ recoveryCodes: string[] }>("/auth/2fa/enable", { code }).then((data) => data.recoveryCodes);

export const disableTwoFactor = (password: string, proof: DisableProof) =>
  api.post<{ twoFactorEnabled: boolean }>("/auth/2fa/disable", { password, ...proof });

/** Só renderiza o QR se for mesmo uma imagem PNG em data URL (nunca uma URL externa). */
export const isQrDataUrl = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("data:image/png;base64,");

export function twoFactorErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 429) {
    return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  }
  return errorMessage(error, fallback);
}
