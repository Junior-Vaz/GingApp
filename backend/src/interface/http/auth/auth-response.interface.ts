import { OrgRole, UserType } from '@prisma/client';

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
  };
}
