import { OrgRole, Prisma, PrismaClient, StaffRole, StudentStatus } from '@prisma/client';
import { linkStudentToPerson, STUDENT_IDENTITY_SELECT } from '../people/person-linker';

/**
 * Regras PURAS + nucleo sem Nest dos CARGOS acumulaveis (ficha unica, Fase 3 - docs/FICHA_UNICA.md secao 5).
 * Todo mundo e aluno; o cargo e um acrescimo por pessoa e grupo. O MAIOR cargo ativo e o OrganizationUser.role
 * (a permissao da matriz RolePermission e o papel do token, relido do banco a cada requisicao pela JwtStrategy).
 */
export const STAFF_ROLE_RANK: Record<StaffRole, number> = { MESTRE: 4, PROFESSOR: 3, INSTRUTOR: 2, MONITOR: 1 };
export const STAFF_ROLES: StaffRole[] = [StaffRole.MESTRE, StaffRole.PROFESSOR, StaffRole.INSTRUTOR, StaffRole.MONITOR];
export const STAFF_ORG_ROLES: OrgRole[] = [OrgRole.MESTRE, OrgRole.PROFESSOR, OrgRole.INSTRUTOR, OrgRole.MONITOR];

export const ROLE_LABEL_BR: Record<StaffRole, string> = { MESTRE: 'Mestre', PROFESSOR: 'Professor', INSTRUTOR: 'Instrutor', MONITOR: 'Monitor' };

export function isStaffOrgRole(role: OrgRole | null | undefined): role is OrgRole & StaffRole {
  return !!role && (STAFF_ORG_ROLES as string[]).includes(role);
}

/** Cargos ordenados do MAIOR para o menor (sem repetir). */
export function sortRoles(roles: Iterable<StaffRole>): StaffRole[] {
  return [...new Set(roles)].sort((a, b) => STAFF_ROLE_RANK[b] - STAFF_ROLE_RANK[a]);
}

/**
 * Papel de acesso (OrganizationUser.role) a partir dos cargos ativos: o MAIOR cargo; sem cargo, ALUNO se a pessoa tem
 * matricula no grupo, senao RESPONSAVEL se acompanha dependente, senao ALUNO.
 */
export function principalRole(roles: StaffRole[], fallback: { hasStudent: boolean; isGuardian: boolean }): OrgRole {
  const [top] = sortRoles(roles);
  if (top) return top as OrgRole;
  if (!fallback.hasStudent && fallback.isGuardian) return OrgRole.RESPONSAVEL;
  return OrgRole.ALUNO;
}

/**
 * Cargos sugeridos para uma corda: os cargos cuja regra ja foi atingida (order >= minLevelOrder), EXCETO quando a pessoa
 * ja tem esse cargo ou um MAIOR (nao sugere Monitor a quem ja e Professor).
 */
export function suggestedRoles(levelOrder: number, rules: { role: StaffRole; minLevelOrder: number }[], active: StaffRole[]): StaffRole[] {
  const top = Math.max(0, ...active.map((r) => STAFF_ROLE_RANK[r]));
  return sortRoles(rules.filter((r) => levelOrder >= r.minLevelOrder && STAFF_ROLE_RANK[r.role] > top).map((r) => r.role));
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Garante o cargo equivalente ao papel de equipe da membership (papel MESTRE/PROFESSOR/INSTRUTOR/MONITOR criado fora do
 * fluxo de cargos: criacao do grupo, tela Equipe, dados antigos). Idempotente.
 */
export async function ensureMembershipRole(db: Db, organizationId: number, userId: number, source = 'MIGRATION'): Promise<boolean> {
  const membership = await db.organizationUser.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
  if (!membership || membership.status !== 'ACTIVE' || !isStaffOrgRole(membership.role)) return false;
  const role = membership.role as StaffRole;
  const exists = await db.personRole.findFirst({ where: { organizationId, userId, role, revokedAt: null }, select: { id: true } });
  if (exists) return false;
  const person = await db.person.findUnique({ where: { userId }, select: { id: true } });
  await db.personRole.create({ data: { organizationId, userId, personId: person?.id ?? null, role, source } });
  return true;
}

export interface RolesBackfillReport {
  staffMemberships: number;
  rolesCreated: number;
  enrollmentsCreated: number;
  enrollmentsReused: number;
  personsLinked: number;
  failed: number;
}

/**
 * Backfill idempotente (npm run roles:backfill / boot com ROLES_BACKFILL): para cada membership ATIVA de equipe,
 * (1) o cargo equivalente; (2) STAFF TAMBEM E ALUNO: a matricula (Student) no grupo, criando uma marcada isStaff (fora do
 * limite do plano e sem mensalidade) quando o login ainda nao tem matricula ali; (3) a ficha (Person) ligada a matricula
 * e o personId nos cargos. Nunca altera papel/acesso.
 */
export async function backfillStaffRoles(
  prisma: PrismaClient,
  options: { organizationIds?: number[] } = {},
  log: (msg: string) => void = () => undefined,
): Promise<RolesBackfillReport> {
  const report: RolesBackfillReport = { staffMemberships: 0, rolesCreated: 0, enrollmentsCreated: 0, enrollmentsReused: 0, personsLinked: 0, failed: 0 };
  const memberships = await prisma.organizationUser.findMany({
    where: {
      status: 'ACTIVE',
      role: { in: STAFF_ORG_ROLES },
      organization: { type: 'GROUP' },
      ...(options.organizationIds ? { organizationId: { in: options.organizationIds } } : {}),
    },
    select: { organizationId: true, userId: true, user: { select: { name: true, email: true, phone: true, photo: true } } },
    orderBy: { id: 'asc' },
  });
  for (const m of memberships) {
    report.staffMemberships++;
    try {
      if (await ensureMembershipRole(prisma, m.organizationId, m.userId)) report.rolesCreated++;
      let student = await prisma.student.findFirst({ where: { organizationId: m.organizationId, userId: m.userId }, select: STUDENT_IDENTITY_SELECT });
      if (student) report.enrollmentsReused++;
      else {
        const created = await prisma.student.create({
          data: {
            organizationId: m.organizationId,
            userId: m.userId,
            name: m.user.name,
            email: m.user.email,
            phone: m.user.phone,
            photo: m.user.photo,
            status: StudentStatus.ACTIVE,
            isStaff: true,
          },
          select: { id: true },
        });
        student = await prisma.student.findUniqueOrThrow({ where: { id: created.id }, select: STUDENT_IDENTITY_SELECT });
        report.enrollmentsCreated++;
      }
      const personId = student.personId ?? (await linkStudentToPerson(prisma, student)).personId;
      const linked = await prisma.personRole.updateMany({
        where: { organizationId: m.organizationId, userId: m.userId, personId: null },
        data: { personId },
      });
      report.personsLinked += linked.count;
    } catch (error) {
      report.failed++;
      log(`membership org ${m.organizationId} user ${m.userId}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
  }
  return report;
}
