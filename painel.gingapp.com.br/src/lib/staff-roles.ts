/**
 * Cargos acumuláveis da equipe (Ficha única - Fase 3). Todo mundo é aluno; os cargos se somam por pessoa e grupo e o
 * MAIOR vira o papel de acesso (`role` do token). Ordem de poder: MESTRE > PROFESSOR > INSTRUTOR > MONITOR.
 */
export type StaffRole = "MESTRE" | "PROFESSOR" | "INSTRUTOR" | "MONITOR";

/** Do maior para o menor cargo. */
export const STAFF_ROLES: readonly StaffRole[] = ["MESTRE", "PROFESSOR", "INSTRUTOR", "MONITOR"];

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  MESTRE: "Mestre",
  PROFESSOR: "Professor",
  INSTRUTOR: "Instrutor",
  MONITOR: "Monitor",
};

/** Posição na hierarquia (0 = MESTRE, o maior). */
const rank = (role: StaffRole): number => STAFF_ROLES.indexOf(role);

/** Cargos conhecidos, sem repetição, do maior para o menor (ignora valores desconhecidos). */
export function sortRoles(roles: readonly string[] | null | undefined): StaffRole[] {
  const known = new Set(roles ?? []);
  return STAFF_ROLES.filter((role) => known.has(role));
}

/** Maior cargo da lista (ou `null` sem cargos). */
export function highestRole(roles: readonly string[] | null | undefined): StaffRole | null {
  return sortRoles(roles)[0] ?? null;
}

/**
 * Cargos a que a pessoa pode ser promovida: os MAIORES que o maior cargo que ela já tem (sem cargo = os quatro),
 * do menor para o maior ("Monitor, Instrutor, Professor, Mestre").
 */
export function promotableRoles(current: readonly string[] | null | undefined): StaffRole[] {
  const top = highestRole(current);
  const above = top === null ? STAFF_ROLES : STAFF_ROLES.filter((role) => rank(role) < rank(top));
  return [...above].reverse();
}

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

/** Há algum cargo MAIOR que os atuais a oferecer em "Promover a…"? */
export const canPromote = (current: readonly string[] | null | undefined): boolean => promotableRoles(current).length > 0;
