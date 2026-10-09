import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UserType } from '@prisma/client';
import { AuthenticatedRequest } from '../../../shared/interfaces/authenticated-request.interface';

/**
 * Mais estrito que PlatformOnlyGuard: exige userType = PLATFORM. O PlatformOnlyGuard também deixa
 * passar um MEMBER com isSuperAdmin = true (bypass total herdado do GestorPrint); na gestão da
 * equipe isso não é aceitável — usuário MEMBER (qualquer papel/flag) recebe sempre 403.
 */
@Injectable()
export class PlatformUserOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user || user.userType !== UserType.PLATFORM) {
      throw new ForbiddenException('Acesso restrito à equipe da plataforma GingApp.');
    }
    return true;
  }
}
