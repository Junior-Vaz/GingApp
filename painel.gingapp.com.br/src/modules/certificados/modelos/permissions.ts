import { useSessionUser, type OrgRole } from "@/lib/session";

/**
 * Criar, editar, duplicar, definir padrão e excluir MODELOS de certificado: MESTRE e PROFESSOR (contrato §7).
 * É só a barreira de UX; o backend decide (403). Ver/listar modelos segue `certificates:view`.
 */
export const canManageTemplatesRole = (role: OrgRole | undefined): boolean => role === "MESTRE" || role === "PROFESSOR";

export function useCanManageTemplates(): boolean {
  return canManageTemplatesRole(useSessionUser()?.role);
}
