import { OrgRole, UserType } from '@prisma/client';
import { TermsStatus } from '../../../shared/legal/legal-types';

/**
 * Usuário devolvido por login/platform-login/GET /auth/me. `TermsStatus` (E10) informa se há aceite pendente
 * dos Termos/Política: o frontend mostra a tela de aceite quando `termsAcceptanceRequired` é true (o servidor
 * só barra o uso se TERMS_ENFORCEMENT=true).
 */
export interface AuthResponse {
  accessToken: string;
  user: {
    id: number;
    name: string;
    email: string;
    userType: UserType;
    isSuperAdmin: boolean;
    organizationId?: number;
    organizationSlug?: string;
    role?: OrgRole;
    /** Senha definida por outra pessoa (conta criada/redefinida pelo Mestre): o frontend deve exigir a troca. */
    mustChangePassword?: boolean;
    /** 2FA TOTP ativo para este usuario (o segredo nunca e' devolvido). */
    twoFactorEnabled?: boolean;
  } & TermsStatus;
}

/**
 * Resposta de login/platform-login quando o usuario ATIVOU o 2FA: senha correta, mas ainda sem sessao. O frontend pede o
 * codigo e chama POST /auth/2fa/verify com o `challengeToken` (JWT de 5 min, proposito '2fa', que nao vale como accessToken).
 */
export interface TwoFactorChallengeResponse {
  twoFactorRequired: true;
  challengeToken: string;
}

export type LoginResponse = AuthResponse | TwoFactorChallengeResponse;
