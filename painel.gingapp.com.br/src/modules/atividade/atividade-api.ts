import { createCrud } from "@/lib/crud";

/** Contrato de GET /audit-logs/me-group (backend: AuditQueryService; só o MESTRE, só o próprio grupo). */
export interface ActivityLog {
  id: number;
  createdAt: string;
  action: string;
  entity: string;
  entityId: string | null;
  userId: number | null;
  /** "Equipe GingApp" quando a ação foi da equipe da plataforma (a identidade dela não é exposta ao grupo). */
  userName: string | null;
  userEmail: string | null;
  ip: string | null;
  meta: Record<string, unknown> | null;
}

/** Rótulos em português dos códigos de ação (catálogo do backend: shared/audit/audit-actions.ts). */
export const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: "Login realizado",
  LOGIN_FAILURE: "Falha de login",
  PASSWORD_CHANGE: "Troca de senha",
  PASSWORD_RESET: "Redefinição de senha",
  ACCEPT_TERMS: "Aceite dos termos",
  REQUEST_DATA_DELETION: "Pedido de exclusão de dados",
  ORGANIZATION_UPDATE: "Dados do grupo editados",
  ORGANIZATION_DEACTIVATE: "Grupo desativado",
  ORGANIZATION_REACTIVATE: "Grupo reativado",
  UNIT_CREATE: "Unidade criada",
  UNIT_UPDATE: "Unidade editada",
  UNIT_INACTIVATE: "Unidade inativada",
  STUDENT_ACCOUNT_CREATE: "Acesso de aluno criado",
  GUARDIAN_CREATE: "Responsável cadastrado",
  GUARDIAN_ACCOUNT_CREATE: "Acesso de responsável criado",
  MEMBER_PASSWORD_RESET: "Senha de membro redefinida",
  TEACHER_CREATE: "Professor cadastrado",
  TEACHER_UPDATE: "Professor editado",
  TEACHER_INACTIVATE: "Professor inativado",
  TEACHER_UNITS_UPDATE: "Unidades do professor alteradas",
  SUBSCRIPTION_CREATE: "Assinatura criada",
  SUBSCRIPTION_UPDATE: "Assinatura alterada",
  SUBSCRIPTION_CANCEL: "Assinatura cancelada",
  FEATURE_OVERRIDE_SET: "Recurso do plano alterado",
  FEATURE_OVERRIDE_REMOVE: "Exceção de recurso removida",
  STUDENT_INACTIVATE: "Aluno inativado",
  STUDENT_DELETE: "Aluno excluído",
  STUDENT_IMPORT: "Alunos importados",
  STUDENT_EXPORT: "Alunos exportados",
  REPORT_EXPORT: "Relatório exportado",
  FINANCE_PAY: "Baixa financeira",
  FINANCE_REFUND: "Estorno financeiro",
  FINANCE_CANCEL: "Cancelamento financeiro",
  FINANCE_UPDATE: "Lançamento editado",
  FINANCE_DELETE: "Lançamento excluído",
  FINANCE_GENERATE_MONTHLY: "Mensalidades geradas",
  FINANCE_EXPORT: "Financeiro exportado",
};

export const actionLabel = (action: string): string => ACTION_LABELS[action] ?? action;

export const ACTION_OPTIONS = Object.entries(ACTION_LABELS)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

/** Somente leitura: só `usePage` é usado. */
export const activity = createCrud<ActivityLog>("/audit-logs/me-group");

export const metaText = (meta: ActivityLog["meta"]): string =>
  meta && Object.keys(meta).length > 0 ? JSON.stringify(meta) : "";
