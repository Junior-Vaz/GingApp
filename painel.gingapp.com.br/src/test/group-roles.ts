import type { GroupRole } from "@/modules/professores/roles-api";
import type { RoleBadgeData } from "@/lib/staff-roles";

/** Selos dos 4 cargos padrão de um grupo (contrato da API: rank 40/30/20/10, cor e ícone de cada um). */
export const MESTRE_BADGE: RoleBadgeData = { id: 1, name: "Mestre", slug: "mestre", color: "#B45309", icon: "crown", accessRole: "MESTRE", rank: 40 };
export const PROFESSOR_BADGE: RoleBadgeData = { id: 2, name: "Professor", slug: "professor", color: "#1D4ED8", icon: "graduation-cap", accessRole: "PROFESSOR", rank: 30 };
export const INSTRUTOR_BADGE: RoleBadgeData = { id: 3, name: "Instrutor", slug: "instrutor", color: "#047857", icon: "award", accessRole: "INSTRUTOR", rank: 20 };
export const MONITOR_BADGE: RoleBadgeData = { id: 4, name: "Monitor", slug: "monitor", color: "#7C3AED", icon: "clipboard-check", accessRole: "MONITOR", rank: 10 };

/** Cargo do grupo (item de GET /group-roles) a partir de um selo. */
export const groupRole = (badge: RoleBadgeData, extra: Partial<GroupRole> = {}): GroupRole => ({
  ...badge,
  isDefault: true,
  active: true,
  peopleCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

/** GET /group-roles de um grupo recém-criado (os 4 padrão, do mais sênior ao menos). */
export const defaultGroupRoles = (): GroupRole[] => [
  groupRole(MESTRE_BADGE, { peopleCount: 1 }),
  groupRole(PROFESSOR_BADGE, { peopleCount: 1 }),
  groupRole(INSTRUTOR_BADGE),
  groupRole(MONITOR_BADGE, { peopleCount: 2 }),
];
