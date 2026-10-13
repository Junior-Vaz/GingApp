import { OrgRole, Prisma, PrismaClient, StaffRole } from '@prisma/client';

/**
 * CARGOS DO GRUPO (docs/FICHA_UNICA.md secao 13) - regras PURAS + nucleo sem Nest (SSOT usado por RolesService,
 * GroupRolesService, listas, ficha, /auth/me, hierarquia, createGroup, demo e backfill).
 *
 * Cada grupo cria/edita os seus cargos (Contramestre, Formado...). O cargo tem um PERFIL DE ACESSO (`accessRole`, um dos
 * papeis da matriz RolePermission: MESTRE|PROFESSOR|INSTRUTOR|MONITOR) e um `rank` (hierarquia visual; maior = mais
 * senior). O ACESSO efetivo (OrganizationUser.role) = o MAIOR accessRole entre os cargos ativos (staff-roles.ts
 * principalRole); o SELO principal = o cargo de maior rank.
 */

export interface DefaultGroupRole {
  slug: string;
  name: string;
  accessRole: StaffRole;
  rank: number;
  color: string;
  icon: string;
}

/** Os 4 cargos padrao (mesmos valores da migration 20261015000000_group_roles). */
export const DEFAULT_GROUP_ROLES: readonly DefaultGroupRole[] = [
  { slug: 'mestre', name: 'Mestre', accessRole: StaffRole.MESTRE, rank: 40, color: '#B45309', icon: 'crown' },
  { slug: 'professor', name: 'Professor', accessRole: StaffRole.PROFESSOR, rank: 30, color: '#1D4ED8', icon: 'graduation-cap' },
  { slug: 'instrutor', name: 'Instrutor', accessRole: StaffRole.INSTRUTOR, rank: 20, color: '#047857', icon: 'award' },
  { slug: 'monitor', name: 'Monitor', accessRole: StaffRole.MONITOR, rank: 10, color: '#7C3AED', icon: 'clipboard-check' },
];

/** Icones lucide permitidos (nome kebab do lucide; o painel/app mapeiam para o componente). */
export const GROUP_ROLE_ICONS = [
  'crown',
  'graduation-cap',
  'award',
  'clipboard-check',
  'medal',
  'trophy',
  'star',
  'shield',
  'shield-check',
  'gem',
  'flame',
  'sparkles',
  'music',
  'drum',
  'hand',
  'heart',
  'zap',
  'target',
  'book-open',
  'user-check',
  'users',
] as const;

export const MAX_GROUP_ROLES = 20;
export const GROUP_ROLE_NAME_MIN = 2;
export const GROUP_ROLE_NAME_MAX = 30;
export const GROUP_ROLE_RANK_MAX = 1000;
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Rank base de cada perfil de acesso (cargo novo sem rank informado fica logo acima do maior cargo do mesmo perfil). */
export const ACCESS_ROLE_BASE_RANK: Record<StaffRole, number> = { MESTRE: 40, PROFESSOR: 30, INSTRUTOR: 20, MONITOR: 10 };

/** Selo do cargo do grupo nas respostas (listas, ficha, /auth/me, hierarquia). */
export interface GroupRoleBadge {
  id: number;
  name: string;
  slug: string;
  color: string | null;
  icon: string | null;
  accessRole: StaffRole;
  rank: number;
}

export const GROUP_ROLE_BADGE_SELECT = {
  id: true,
  name: true,
  slug: true,
  color: true,
  icon: true,
  accessRole: true,
  rank: true,
} as const satisfies Prisma.GroupRoleSelect;

export function badgeOf(row: GroupRoleBadge): GroupRoleBadge {
  return { id: row.id, name: row.name, slug: row.slug, color: row.color, icon: row.icon, accessRole: row.accessRole, rank: row.rank };
}

/** Maior rank primeiro; empate pelo id (o mais antigo primeiro). Sem repetir o mesmo cargo. */
export function sortBadges<T extends { id: number; rank: number }>(badges: Iterable<T>): T[] {
  const byId = new Map<number, T>();
  for (const b of badges) byId.set(b.id, b);
  return [...byId.values()].sort((a, b) => b.rank - a.rank || a.id - b.id);
}

/** Slug kebab sem acento (identificador estavel do cargo no grupo). */
export function slugifyRoleName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'cargo';
}

/** Nome normalizado (espacos colapsados) e validado: 2-30 caracteres. null = invalido. */
export function normalizeRoleName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const clean = name.replace(/\s+/g, ' ').trim();
  return clean.length >= GROUP_ROLE_NAME_MIN && clean.length <= GROUP_ROLE_NAME_MAX ? clean : null;
}

/** Rank padrao de um cargo novo: logo acima do maior cargo do mesmo perfil, ou a base do perfil. */
export function defaultRankFor(accessRole: StaffRole, existing: { accessRole: StaffRole; rank: number }[]): number {
  const same = existing.filter((r) => r.accessRole === accessRole).map((r) => r.rank);
  return same.length ? Math.min(GROUP_ROLE_RANK_MAX, Math.max(...same) + 1) : ACCESS_ROLE_BASE_RANK[accessRole];
}

/** Ranks do reorder: o primeiro da lista e o mais senior (n*10, (n-1)*10, ..., 10). */
export function ranksForOrder(order: number[]): Map<number, number> {
  return new Map(order.map((id, i) => [id, (order.length - i) * 10]));
}

/**
 * Cargos do grupo sugeridos para uma corda: regras atingidas (order >= minLevelOrder) de cargos ATIVOS cujo rank e MAIOR
 * que o maior cargo que a pessoa ja tem (nao sugere Monitor a quem ja e Professor). Maior rank primeiro.
 */
export function suggestedGroupRoles<T extends { id: number; rank: number; active: boolean }>(
  levelOrder: number,
  rules: { minLevelOrder: number; groupRole: T }[],
  heldRanks: number[],
): T[] {
  const top = Math.max(0, ...heldRanks);
  return sortBadges(rules.filter((r) => r.groupRole.active && levelOrder >= r.minLevelOrder && r.groupRole.rank > top).map((r) => r.groupRole));
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Garante os 4 cargos padrao do grupo (idempotente: cria so o perfil que ainda nao tem cargo padrao; slug ocupado por um
 * cargo do proprio grupo ganha sufixo). Devolve quantos criou. Chamado por createGroup, demo, backfill e, de forma
 * preguicosa, pelas rotas de cargos (grupos criados por fora do createGroup).
 */
export async function ensureDefaultGroupRoles(db: Db, organizationId: number): Promise<number> {
  const existing = await db.groupRole.findMany({ where: { organizationId }, select: { slug: true, accessRole: true, isDefault: true } });
  const haveDefault = new Set(existing.filter((r) => r.isDefault).map((r) => r.accessRole));
  if (haveDefault.size === DEFAULT_GROUP_ROLES.length) return 0;
  const slugs = new Set(existing.map((r) => r.slug));
  let created = 0;
  for (const d of DEFAULT_GROUP_ROLES) {
    if (haveDefault.has(d.accessRole)) continue;
    let slug = d.slug;
    for (let i = 2; slugs.has(slug); i++) slug = `${d.slug}-${i}`;
    slugs.add(slug);
    const res = await db.groupRole.createMany({
      data: [{ organizationId, name: d.name, slug, accessRole: d.accessRole, rank: d.rank, color: d.color, icon: d.icon, isDefault: true }],
      skipDuplicates: true,
    });
    created += res.count;
  }
  return created;
}

/** Cargo padrao do grupo para um perfil de acesso (cria os padrao se faltarem). */
export async function defaultGroupRoleFor(db: Db, organizationId: number, accessRole: StaffRole) {
  const find = () => db.groupRole.findFirst({ where: { organizationId, isDefault: true, accessRole }, orderBy: { id: 'asc' } });
  const found = await find();
  if (found) return found;
  await ensureDefaultGroupRoles(db, organizationId);
  return (await find())!;
}

/**
 * Pedido LEGADO por enum (`role: 'PROFESSOR'`): o cargo de slug padrao (`professor`) do grupo; se renomearam o slug... o
 * slug nunca muda, entao cai no cargo padrao do mesmo perfil.
 */
export async function groupRoleForLegacy(db: Db, organizationId: number, role: StaffRole) {
  await ensureDefaultGroupRoles(db, organizationId);
  const bySlug = await db.groupRole.findUnique({ where: { organizationId_slug: { organizationId, slug: role.toLowerCase() } } });
  if (bySlug && bySlug.accessRole === role) return bySlug;
  return defaultGroupRoleFor(db, organizationId, role);
}

const isStaffAccess = (role: OrgRole | string | null | undefined): role is StaffRole =>
  !!role && (Object.values(StaffRole) as string[]).includes(role);

/**
 * Selos (cargos do grupo ATIVOS, maior rank primeiro) por login no grupo. `legacy` = papel da membership: quem tem papel
 * de equipe sem cargo materializado (antes do backfill) recebe o cargo padrao daquele perfil.
 */
export async function badgesByUser(
  db: Db,
  organizationId: number,
  userIds: number[],
  legacy?: Map<number, OrgRole | string>,
): Promise<Map<number, GroupRoleBadge[]>> {
  const map = new Map<number, GroupRoleBadge[]>();
  if (userIds.length === 0) return map;
  const rows = await db.personRole.findMany({
    where: { organizationId, userId: { in: userIds }, revokedAt: null },
    select: { userId: true, role: true, groupRole: { select: GROUP_ROLE_BADGE_SELECT } },
  });
  let defaults: Map<StaffRole, GroupRoleBadge> | null = null;
  const defaultBadge = async (role: StaffRole) => {
    if (!defaults) {
      await ensureDefaultGroupRoles(db, organizationId);
      const list = await db.groupRole.findMany({ where: { organizationId, isDefault: true }, select: GROUP_ROLE_BADGE_SELECT, orderBy: { id: 'asc' } });
      defaults = new Map();
      for (const g of list) if (!defaults.has(g.accessRole)) defaults.set(g.accessRole, badgeOf(g));
    }
    return defaults.get(role)!;
  };
  for (const r of rows) {
    const badge = r.groupRole ? badgeOf(r.groupRole) : await defaultBadge(r.role);
    map.set(r.userId, [...(map.get(r.userId) ?? []), badge]);
  }
  if (legacy) {
    for (const [userId, role] of legacy) {
      if (!isStaffAccess(role)) continue;
      const held = map.get(userId) ?? [];
      if (held.some((b) => b.accessRole === role)) continue;
      map.set(userId, [...held, await defaultBadge(role)]);
    }
  }
  for (const [userId, list] of map) map.set(userId, sortBadges(list));
  return map;
}

/** Campos de cargo nas respostas: `roles` (selos) + `roleKeys` (slugs, compatibilidade). */
export function rolesPayload(badges: GroupRoleBadge[]): { roles: GroupRoleBadge[]; roleKeys: string[] } {
  const sorted = sortBadges(badges);
  return { roles: sorted, roleKeys: sorted.map((b) => b.slug) };
}

export interface GroupRolesBackfillReport {
  organizations: number;
  defaultsCreated: number;
  personRolesLinked: number;
  rulesLinked: number;
  noticesLinked: number;
}

/**
 * Backfill idempotente (npm run group-roles:backfill / boot GROUP_ROLES_BACKFILL): os 4 cargos padrao de cada GRUPO e o
 * groupRoleId (cargo padrao do mesmo perfil) em cargos/regras/avisos que ainda nao tem. Nunca altera acesso.
 */
export async function backfillGroupRoles(prisma: PrismaClient, options: { organizationIds?: number[] } = {}): Promise<GroupRolesBackfillReport> {
  const report: GroupRolesBackfillReport = { organizations: 0, defaultsCreated: 0, personRolesLinked: 0, rulesLinked: 0, noticesLinked: 0 };
  const orgs = await prisma.organization.findMany({
    where: { type: 'GROUP', ...(options.organizationIds ? { id: { in: options.organizationIds } } : {}) },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  for (const org of orgs) {
    report.organizations++;
    report.defaultsCreated += await ensureDefaultGroupRoles(prisma, org.id);
    for (const d of DEFAULT_GROUP_ROLES) {
      const target = await defaultGroupRoleFor(prisma, org.id, d.accessRole);
      const where = { organizationId: org.id, role: d.accessRole, groupRoleId: null };
      report.personRolesLinked += (await prisma.personRole.updateMany({ where: { ...where, revokedAt: null }, data: { groupRoleId: target.id } })).count;
      report.rulesLinked += (await prisma.graduationRoleRule.updateMany({ where, data: { groupRoleId: target.id } })).count;
      report.noticesLinked += (await prisma.roleSuggestionNotice.updateMany({ where, data: { groupRoleId: target.id } })).count;
    }
  }
  return report;
}

/** Grupos sem os 4 cargos padrao ou com cargo ativo sem groupRoleId (gatilho do boot --auto). */
export async function countGroupRolesPending(prisma: PrismaClient): Promise<number> {
  const [groups, defaults, unlinked] = await Promise.all([
    prisma.organization.count({ where: { type: 'GROUP' } }),
    prisma.groupRole.groupBy({ by: ['organizationId'], where: { isDefault: true, organization: { type: 'GROUP' } }, _count: { _all: true } }),
    prisma.personRole.count({ where: { revokedAt: null, groupRoleId: null } }),
  ]);
  const complete = defaults.filter((d) => d._count._all >= DEFAULT_GROUP_ROLES.length).length;
  return groups - complete + unlinked;
}
