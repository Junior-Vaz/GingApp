/**
 * Cargos da equipe. Cada GRUPO cria os seus cargos ("Cargos do grupo": Contramestre, Formado, Monitor...); cada cargo
 * tem um PERFIL DE ACESSO (`accessRole`, o enum abaixo - define as permissões do painel) e um `rank` (maior = mais
 * sênior). Todo mundo é aluno; os cargos se somam por pessoa e grupo e o de MAIOR rank é o selo principal.
 */
export type StaffRole = "MESTRE" | "PROFESSOR" | "INSTRUTOR" | "MONITOR";

/** Perfil de acesso de um cargo (mesmo conjunto do papel da sessão). */
export type AccessRole = StaffRole;

/** Do maior para o menor perfil de acesso. */
export const STAFF_ROLES: readonly StaffRole[] = ["MESTRE", "PROFESSOR", "INSTRUTOR", "MONITOR"];

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  MESTRE: "Mestre",
  PROFESSOR: "Professor",
  INSTRUTOR: "Instrutor",
  MONITOR: "Monitor",
};

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

/** Selo de um cargo como a API o descreve (`roles`/`staffRoles`/`role` das listas, ficha, sugestões e /auth/me). */
export interface RoleBadgeData {
  id: number;
  name: string;
  slug: string;
  /** Cor do selo (#RRGGBB) ou `null` (selo neutro). */
  color: string | null;
  /** Nome do ícone lucide em kebab-case (ver `ROLE_ICONS`) ou `null` (sem ícone). */
  icon: string | null;
  accessRole: AccessRole;
  /** Maior = mais sênior; ordena as listas e o maior é o selo principal. */
  rank: number;
}

/** Selos do maior para o menor rank (cópia; não altera a lista recebida). */
export function sortBadges(badges: readonly RoleBadgeData[] | null | undefined): RoleBadgeData[] {
  return [...(badges ?? [])].sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name, "pt-BR"));
}

/** Selo principal (o de maior rank) ou `null` sem cargos. */
export function topBadge(badges: readonly RoleBadgeData[] | null | undefined): RoleBadgeData | null {
  return sortBadges(badges)[0] ?? null;
}

/** Maior rank da lista (`-1` sem cargos): valor para ordenar colunas. */
export function topRank(badges: readonly RoleBadgeData[] | null | undefined): number {
  return topBadge(badges)?.rank ?? -1;
}

/**
 * Cargos oferecidos em "Promover a…": os ATIVOS do grupo que a pessoa ainda não tem e de rank MAIOR que o maior
 * cargo dela (sem cargo = todos os ativos), do menor para o maior rank. `groupRoles` ausente = lista ainda não carregada.
 */
export function promotableGroupRoles<T extends { id: number; rank: number; active: boolean }>(
  groupRoles: readonly T[] | null | undefined,
  current: readonly RoleBadgeData[] | null | undefined,
): T[] {
  const held = new Set((current ?? []).map((badge) => badge.id));
  const top = topRank(current);
  return (groupRoles ?? [])
    .filter((role) => role.active && !held.has(role.id) && role.rank > top)
    .sort((a, b) => a.rank - b.rank);
}

/** Há algum cargo MAIOR que os atuais a oferecer em "Promover a…"? (Lista não carregada = não.) */
export const canPromote = (
  groupRoles: readonly { id: number; rank: number; active: boolean }[] | null | undefined,
  current: readonly RoleBadgeData[] | null | undefined,
): boolean => promotableGroupRoles(groupRoles, current).length > 0;

/** Explicação de cada perfil de acesso (cartões do editor de cargos); espelha a matriz de permissões do backend. */
export const ACCESS_ROLE_SUMMARY: Record<AccessRole, string> = {
  MESTRE: "Tudo, inclusive financeiro, cargos e ocorrências.",
  PROFESSOR: "Gestão pedagógica: alunos, turmas, aulas, chamada, graduações e eventos. Sem financeiro.",
  INSTRUTOR: "Como o professor, mas nunca exclui; graduações, certificados, unidades e equipe só para leitura.",
  MONITOR: "Só leitura de alunos, turmas e aulas, mais a chamada das próprias turmas.",
};

/** Máximo de cargos por grupo (o servidor responde 409 GROUP_ROLE_LIMIT acima disso). */
export const GROUP_ROLE_LIMIT = 20;
