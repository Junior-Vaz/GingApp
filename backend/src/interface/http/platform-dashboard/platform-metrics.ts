import { OrganizationType, Prisma, RecordStatus, StudentStatus } from '@prisma/client';

/**
 * SSOT dos contadores da plataforma usados em MAIS de um lugar: a tela inicial do admin (PlatformDashboardService) e o
 * retrato gravado ao publicar um mes da transparencia (docs/CONTRATO_TRANSPARENCIA.md 3: "o MESMO criterio de
 * PlatformDashboardService"). "Grupo" = tenant real (OrganizationType.GROUP); a organizacao SYSTEM fica fora.
 * Aceita o PrismaService ou o cliente de uma transacao (o retrato e lido DENTRO da transacao da publicacao).
 */
type MetricsDb = Pick<Prisma.TransactionClient, 'student' | 'organization'>;

/** Filtro "so grupos (tenants)" das contagens da plataforma. */
export const GROUP_ONLY = { type: OrganizationType.GROUP } as const;

/** Alunos ativos = Student.status ACTIVE em organizacoes GROUP. */
export function countActiveStudents(db: MetricsDb): Promise<number> {
  return db.student.count({ where: { status: StudentStatus.ACTIVE, organization: GROUP_ONLY } });
}

/** Grupos ativos = organizacoes GROUP com status ACTIVE. */
export function countActiveGroups(db: MetricsDb): Promise<number> {
  return db.organization.count({ where: { ...GROUP_ONLY, status: RecordStatus.ACTIVE } });
}
