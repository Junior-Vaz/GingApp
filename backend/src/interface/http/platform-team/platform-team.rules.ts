/**
 * Regras puras (sem banco) da gestão da equipe PLATFORM — separadas do service para serem
 * testáveis em unitário (test/platform-team.spec.ts).
 */

export interface TeamTarget {
  id: number;
  status: string;
  isSuperAdmin: boolean;
}

export interface TeamChange {
  status?: string;
  isSuperAdmin?: boolean;
}

/**
 * true se aplicar `change` em `target` deixaria a plataforma SEM nenhum super admin ATIVO.
 * `activeSuperAdminIds` = ids de TODOS os usuários PLATFORM ativos com isSuperAdmin = true,
 * lidos sob lock (SELECT ... FOR UPDATE) na mesma transação da escrita.
 */
export function leavesNoActiveSuperAdmin(
  activeSuperAdminIds: readonly number[],
  target: TeamTarget,
  change: TeamChange,
): boolean {
  const targetIsActiveSuper = target.status === 'ACTIVE' && target.isSuperAdmin;
  if (!targetIsActiveSuper) return false; // mexer em quem já não conta como super admin ativo não muda a contagem

  const nextStatus = change.status ?? target.status;
  const nextIsSuper = change.isSuperAdmin ?? target.isSuperAdmin;
  const stillCounts = nextStatus === 'ACTIVE' && nextIsSuper;
  if (stillCounts) return false;

  return !activeSuperAdminIds.some((id) => id !== target.id);
}

/** true se `change` tenta MUDAR o próprio status ou o próprio isSuperAdmin (valores iguais aos
 * atuais são no-op e não contam). */
export function changesOwnPrivileges(target: TeamTarget, change: TeamChange): boolean {
  const statusChanged = change.status !== undefined && change.status !== target.status;
  const superChanged = change.isSuperAdmin !== undefined && change.isSuperAdmin !== target.isSuperAdmin;
  return statusChanged || superChanged;
}
