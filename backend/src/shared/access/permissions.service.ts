import { Injectable } from '@nestjs/common';
import { UserType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { PermissionAction } from '../decorators/can-access.decorator';

const ACTION_TO_COLUMN = {
  view: 'canView',
  create: 'canCreate',
  edit: 'canEdit',
  delete: 'canDelete',
} as const;

/**
 * SSOT da consulta à matriz RolePermission (role × resource → view/create/edit/delete).
 * Usado pelo CanAccessGuard (rotas com @CanAccess) e pelos services que precisam decidir em
 * runtime entre "visão de staff" (tem a permissão na matriz) e "visão do próprio aluno /
 * responsável" (checagem de vínculo) numa MESMA rota — ex.: GET /graduations/students/:id.
 *
 * PLATFORM/isSuperAdmin têm bypass total (mesmo padrão do PlatformOnlyGuard); MEMBER sem papel
 * nunca tem permissão.
 */
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  isPlatform(user: Pick<AuthenticatedUser, 'userType' | 'isSuperAdmin'>): boolean {
    return user.userType === UserType.PLATFORM || user.isSuperAdmin;
  }

  async can(
    user: Pick<AuthenticatedUser, 'userType' | 'isSuperAdmin' | 'role'>,
    resource: string,
    action: PermissionAction,
  ): Promise<boolean> {
    if (this.isPlatform(user)) return true;
    if (!user.role) return false;

    const permission = await this.prisma.rolePermission.findUnique({
      where: { role_resource: { role: user.role, resource } },
    });
    return permission?.[ACTION_TO_COLUMN[action]] ?? false;
  }
}
