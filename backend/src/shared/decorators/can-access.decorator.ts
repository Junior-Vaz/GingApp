import { SetMetadata } from '@nestjs/common';

export const CAN_ACCESS_KEY = 'canAccess';

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete';

export interface CanAccessMetadata {
  resource: string;
  action: PermissionAction;
}

/**
 * Marca um endpoint como sujeito à matriz RolePermission (role x resource -> view/create/
 * edit/delete), PLANO_PROJETO.md §3.2 item 2 — mesmo padrão do GestorPrint (@CanAccess do
 * RBAC do GestorPrint). Lido pelo CanAccessGuard (global).
 *
 * Uso: @CanAccess('students', 'view')
 *      @Get()
 *      findAll() {}
 */
export const CanAccess = (
  resource: string,
  action: PermissionAction,
): ReturnType<typeof SetMetadata> =>
  SetMetadata(CAN_ACCESS_KEY, { resource, action } satisfies CanAccessMetadata);
