import { OrgRole, UserType } from '@prisma/client';

/**
 * Payload assinado dentro do JWT.
 *
 * Para userType = 'MEMBER', organizationId e role identificam em qual organização (grupo)
 * e com qual papel (MESTRE/PROFESSOR/ALUNO/RESPONSAVEL) o token foi emitido — um usuário
 * pode ter memberships em mais de uma organização, mas cada token vale para uma só
 * (decisão de modelagem: ver relatório final).
 *
 * Para userType = 'PLATFORM', organizationId/role não se aplicam.
 */
export interface JwtPayload {
  sub: number;
  email: string;
  userType: UserType;
  isSuperAdmin: boolean;
  organizationId?: number;
  role?: OrgRole;
}

/** Formato de req.user após passar pela JwtStrategy. */
export interface AuthenticatedUser {
  id: number;
  email: string;
  userType: UserType;
  isSuperAdmin: boolean;
  organizationId?: number;
  role?: OrgRole;
  /** Lido do banco a cada requisição (nunca do token): senha provisória pendente de troca (ver access-gate.ts). */
  mustChangePassword?: boolean;
  /** Lido do banco a cada requisição: última versão dos Termos/Política aceita (null = nunca). */
  acceptedTermsVersion?: string | null;
}
