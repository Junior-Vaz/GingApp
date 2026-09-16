import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UserType } from '@prisma/client';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/**
 * Restringe o acesso a usuários userType = 'PLATFORM' (equipe interna GingApp) — usado em
 * todos os módulos exclusivos do admin.gingapp.com.br (plans, subscriptions, platform-users,
 * platform-settings, platform-announcements, audit/platform). Roda depois do JwtAuthGuard
 * global, então sempre há um request.user já validado.
 *
 * isSuperAdmin também passa (bypass total, igual ao padrão GestorPrint), pois na prática
 * todo super admin é um usuário PLATFORM.
 */
@Injectable()
export class PlatformOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user || (user.userType !== UserType.PLATFORM && !user.isSuperAdmin)) {
      throw new ForbiddenException('Acesso restrito à equipe da plataforma GingApp.');
    }

    return true;
  }
}
