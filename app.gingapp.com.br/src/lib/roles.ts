import type { StaffRole } from "@/lib/session";

/**
 * Cargos acumuláveis por grupo (Ficha única, Fase 3). Todo mundo é aluno; o cargo é um papel a mais.
 * Ordem de precedência (maior primeiro): MESTRE > PROFESSOR > INSTRUTOR > MONITOR.
 */
export const STAFF_ROLE_ORDER: StaffRole[] = ["MESTRE", "PROFESSOR", "INSTRUTOR", "MONITOR"];

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  MESTRE: "Mestre",
  PROFESSOR: "Professor",
  INSTRUTOR: "Instrutor",
  MONITOR: "Monitor",
};

export const isStaffRole = (value: unknown): value is StaffRole =>
  typeof value === "string" && (STAFF_ROLE_ORDER as string[]).includes(value);

/** Filtra valores desconhecidos e ordena do maior para o menor cargo, sem repetir. */
export function normalizeRoles(value: unknown): StaffRole[] {
  const list = Array.isArray(value) ? value : [];
  return STAFF_ROLE_ORDER.filter((role) => list.includes(role));
}

/** Papel de acesso é o maior cargo. Quem não tem cargo é só aluno (ou responsável). */
export const highestRole = (roles: StaffRole[]): StaffRole | null => roles[0] ?? null;

/**
 * URL do painel do grupo (onde mestres/professores/instrutores/monitores gerenciam).
 * Embutida no build via VITE_PAINEL_URL; sem ela, usa o painel de produção.
 */
export const PAINEL_URL: string =
  (import.meta.env["VITE_PAINEL_URL"] as string | undefined)?.trim() || "https://painel.gingapp.com.br";
