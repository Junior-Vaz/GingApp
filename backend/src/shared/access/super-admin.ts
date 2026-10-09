import { UserType } from '@prisma/client';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

/**
 * SSOT da regra "super admin ATIVO da plataforma" — usada pela gestão da equipe
 * (PlatformTeamService) e pelas escritas das configurações globais (SuperAdminGuard).
 *
 * Exige userType = PLATFORM E isSuperAdmin. Um MEMBER com isSuperAdmin = true NÃO conta (o
 * PlatformOnlyGuard o deixaria passar por herança do GestorPrint; aqui não). "Ativo" vem da
 * JwtStrategy: a cada requisição ela relê o usuário no banco e rejeita (401) quem não está
 * status = ACTIVE ou teve o token revogado (tokenValidAfter), e preenche isSuperAdmin com o
 * valor ATUAL do banco — então um super admin rebaixado/desativado perde o acesso na hora, sem
 * esperar o JWT expirar.
 */
export function isActiveSuperAdmin(user: Pick<AuthenticatedUser, 'userType' | 'isSuperAdmin'> | undefined): boolean {
  return !!user && user.userType === UserType.PLATFORM && user.isSuperAdmin === true;
}
