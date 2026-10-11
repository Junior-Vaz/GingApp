import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { OrgRole, UserType } from '@prisma/client';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/**
 * Exige o MESTRE de uma organização: token de um MEMBER com `role = MESTRE` e `organizationId`
 * (o grupo do token). Para operações sobre "o próprio grupo" que nem o PROFESSOR nem a equipe da plataforma
 * fazem por esta rota (a equipe usa as rotas /organizations/:id, protegidas por SuperAdminGuard).
 * Roda como guard, para o 403 vir antes de qualquer validação de corpo.
 */
@Injectable()
export class MestreOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user || user.userType !== UserType.MEMBER || user.role !== OrgRole.MESTRE || user.organizationId == null) {
      throw new ForbiddenException('Apenas o Mestre do grupo pode executar esta operação.');
    }
    return true;
  }
}
