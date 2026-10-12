import { OrgRole } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Alcance de um comunicado alem da unidade (todos opcionais; se combinam por E — nunca ampliam o alcance da unidade):
 *  - classId: so alunos matriculados (ClassStudent ACTIVE) na turma, seus responsaveis e o professor da turma;
 *  - stateUf: so quem pertence a unidades da UF (aluno da unidade, responsavel dele, professor com acesso a unidade);
 *  - audienceRole: so membros ativos com esse papel no grupo (ex.: RESPONSAVEL => "recado aos pais").
 */
export interface AnnouncementReach {
  unitId: number | null;
  classId: number | null;
  stateUf: string | null;
  audienceRole: OrgRole | null;
}

function intersect(a: Set<number>, b: Set<number>): Set<number> {
  return new Set([...a].filter((id) => b.has(id)));
}

/** Usuarios que recebem a notificacao do comunicado. Base = publico da unidade (NotificationsService.audienceUserIds, SSOT). */
export async function announcementAudienceUserIds(
  prisma: PrismaService,
  notifications: NotificationsService,
  organizationId: number,
  reach: AnnouncementReach,
): Promise<Set<number>> {
  let users = await notifications.audienceUserIds(organizationId, reach.unitId);

  if (reach.classId !== null) {
    const [klass, enrollments] = await Promise.all([
      prisma.class.findFirst({ where: { id: reach.classId, organizationId }, select: { teacherUserId: true } }),
      prisma.classStudent.findMany({
        where: { organizationId, classId: reach.classId, status: 'ACTIVE', student: { status: 'ACTIVE' } },
        select: { studentId: true },
      }),
    ]);
    const byStudent = await notifications.userIdsByStudent(
      organizationId,
      enrollments.map((e) => e.studentId),
    );
    const classUsers = new Set<number>([...byStudent.values()].flat());
    if (klass?.teacherUserId) classUsers.add(klass.teacherUserId);
    users = intersect(users, classUsers);
  }

  if (reach.stateUf !== null) {
    const units = await prisma.unit.findMany({
      where: { organizationId, state: reach.stateUf },
      select: { id: true },
    });
    const unitIds = units.map((u) => u.id);
    const [students, guardians, access] = await Promise.all([
      prisma.student.findMany({ where: { organizationId, unitId: { in: unitIds }, userId: { not: null } }, select: { userId: true } }),
      prisma.studentGuardian.findMany({
        where: { organizationId, userId: { not: null }, student: { unitId: { in: unitIds } } },
        select: { userId: true },
      }),
      prisma.userUnitAccess.findMany({ where: { organizationId, unitId: { in: unitIds } }, select: { userId: true } }),
    ]);
    const stateUsers = new Set<number>();
    students.forEach((s) => s.userId && stateUsers.add(s.userId));
    guardians.forEach((g) => g.userId && stateUsers.add(g.userId));
    access.forEach((a) => stateUsers.add(a.userId));
    users = intersect(users, stateUsers);
  }

  if (reach.audienceRole !== null) {
    const members = await prisma.organizationUser.findMany({
      where: { organizationId, status: 'ACTIVE', role: reach.audienceRole },
      select: { userId: true },
    });
    users = intersect(users, new Set(members.map((m) => m.userId)));
  }

  return users;
}
