import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';
import { CAN_ACCESS_KEY, CanAccessMetadata } from '../decorators/can-access.decorator';

const ACTION_TO_COLUMN = {
  view: 'canView',
  create: 'canCreate',
  edit: 'canEdit',
  delete: 'canDelete',
} as const;

/**
 * Autorização por recurso (matriz RolePermission: role × resource → view/create/edit/delete),
 * PLANO_PROJETO.md §3.2 item 2 — replica o padrão RBAC do GestorPrint.
 *
 * Registrado como APP_GUARD (global), rodando depois do JwtAuthGuard: rotas sem @CanAccess()
 * passam direto (nem toda rota precisa de RBAC granular — ex.: /health, /auth/*, rotas
 * @Public como /rodas). Usuários PLATFORM/isSuperAdmin têm bypass total (mesmo padrão do
 * PlatformOnlyGuard). Para MEMBER, consulta a matriz pelo papel (role) gravado no token.
 */
@Injectable()
export class CanAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.getAllAndOverride<CanAccessMetadata | undefined>(
      CAN_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!metadata) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Não autenticado.');
    }

    if (user.userType === UserType.PLATFORM || user.isSuperAdmin) {
      return true;
    }

    if (!user.role) {
      throw new ForbiddenException('Usuário sem papel definido na organização.');
    }

    const permission = await this.prisma.rolePermission.findUnique({
      where: { role_resource: { role: user.role, resource: metadata.resource } },
    });

    const allowed = permission?.[ACTION_TO_COLUMN[metadata.action]] ?? false;
    if (!allowed) {
      throw new ForbiddenException(
        `Papel ${user.role} não tem permissão de "${metadata.action}" em "${metadata.resource}".`,
      );
    }

    return true;
  }
}
