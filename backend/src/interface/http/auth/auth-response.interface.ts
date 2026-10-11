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
  } & TermsStatus;
}
