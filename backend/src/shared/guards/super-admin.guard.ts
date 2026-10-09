import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { isActiveSuperAdmin } from '../access/super-admin';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/**
 * Exige super admin ATIVO da plataforma (regra única em shared/access/super-admin.ts, a mesma
 * da gestão da equipe). Usar por rota, DEPOIS do PlatformOnlyGuard do controller, nas operações
 * que só o super admin pode fazer (ex.: escrever configurações globais). Roda como guard — não
 * dentro do handler — para o 403 vir antes de qualquer validação de corpo/parâmetro.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!isActiveSuperAdmin(user)) {
      throw new ForbiddenException(
        'Apenas super admins ativos da plataforma podem executar esta operação. Seu usuário só tem acesso de leitura.',
      );
    }
    return true;
  }
}
