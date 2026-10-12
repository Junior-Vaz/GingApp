/** Rótulos em português dos códigos de ação da trilha de auditoria (catálogo do backend: shared/audit/audit-actions.ts). */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'Login realizado',
  LOGIN_FAILURE: 'Falha de login',
  PASSWORD_CHANGE: 'Troca de senha',
  PASSWORD_RESET: 'Redefinição de senha',
  ACCEPT_TERMS: 'Aceite dos termos',
  REQUEST_DATA_DELETION: 'Pedido de exclusão de dados',
  ORGANIZATION_CREATE: 'Grupo criado',
  ORGANIZATION_UPDATE: 'Grupo editado',
  ORGANIZATION_DEACTIVATE: 'Grupo desativado',
  ORGANIZATION_REACTIVATE: 'Grupo reativado',
  UNIT_CREATE: 'Unidade criada',
  UNIT_UPDATE: 'Unidade editada',
  UNIT_INACTIVATE: 'Unidade inativada',
  STUDENT_ACCOUNT_CREATE: 'Acesso de aluno criado',
  GUARDIAN_CREATE: 'Responsável cadastrado',
  GUARDIAN_ACCOUNT_CREATE: 'Acesso de responsável criado',
  MEMBER_PASSWORD_RESET: 'Senha de membro redefinida',
  TEACHER_CREATE: 'Professor cadastrado',
  TEACHER_UPDATE: 'Professor editado',
  TEACHER_INACTIVATE: 'Professor inativado',
  TEACHER_UNITS_UPDATE: 'Unidades do professor alteradas',
  PLATFORM_USER_CREATE: 'Usuário da equipe criado',
  PLATFORM_USER_UPDATE: 'Usuário da equipe alterado',
  PLATFORM_USER_DEACTIVATE: 'Usuário da equipe desativado',
  PLATFORM_USER_REACTIVATE: 'Usuário da equipe reativado',
  PLATFORM_USER_SESSIONS_REVOKE: 'Sessões da equipe revogadas',
  PLAN_CREATE: 'Plano criado',
  PLAN_UPDATE: 'Plano editado',
  PLAN_DELETE: 'Plano desativado',
  SUBSCRIPTION_CREATE: 'Assinatura criada',
  SUBSCRIPTION_UPDATE: 'Assinatura alterada',
  SUBSCRIPTION_CANCEL: 'Assinatura cancelada',
  FEATURE_OVERRIDE_SET: 'Exceção de recurso definida',
  FEATURE_OVERRIDE_REMOVE: 'Exceção de recurso removida',
  PLATFORM_SETTING_SET: 'Configuração da plataforma alterada',
  PLATFORM_SETTING_DELETE: 'Configuração da plataforma removida',
  STUDENT_INACTIVATE: 'Aluno inativado',
  STUDENT_DELETE: 'Aluno excluído',
  STUDENT_IMPORT: 'Alunos importados',
  STUDENT_EXPORT: 'Alunos exportados',
  REPORT_EXPORT: 'Relatório exportado',
  FINANCE_PAY: 'Baixa financeira',
  FINANCE_REFUND: 'Estorno financeiro',
  FINANCE_CANCEL: 'Cancelamento financeiro',
  FINANCE_UPDATE: 'Lançamento editado',
  FINANCE_DELETE: 'Lançamento excluído',
  FINANCE_GENERATE_MONTHLY: 'Mensalidades geradas',
  FINANCE_EXPORT: 'Financeiro exportado',
}

/** Rótulo da ação; códigos novos ainda sem tradução aparecem como vieram. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action
}

/** Opções do filtro de ação, em ordem alfabética do rótulo. */
export function auditActionOptions(): Array<{ value: string; label: string }> {
  return Object.entries(AUDIT_ACTION_LABELS)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}
