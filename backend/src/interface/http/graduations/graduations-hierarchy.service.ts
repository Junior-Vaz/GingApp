import { Injectable, UnauthorizedException } from '@nestjs/common';
import { OrgRole, RecordStatus, StudentStatus } from '@prisma/client';
import { requireLinkedStudent } from '../../../shared/access/linked-student';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { displayNameOf } from '../ranking/ranking-rules';
import { LEVEL_SELECT, LevelView, levelView } from './rope';

/** Máximo de alunos listados por nível (o `count` traz o total real). */
export const HIERARCHY_STUDENTS_PER_LEVEL = 12;

export interface HierarchyPerson {
  id: number;
  displayName: string;
  photo: string | null;
  level: LevelView | null;
}

/**
 * Hierarquia do grupo para o app (Jornada): mestres, professores e a "escada" de cordas do sistema de graduação com
 * os alunos ATIVOS de cada nível. Mesma privacidade do ranking de grupo: só alunos ACTIVE do MESMO grupo, nome curto
 * ("Nome S.") ou apelido do RankingProfile, foto = Student.photo; nada de e-mail/telefone/nascimento/documento.
 * Mestres e professores têm nome e foto públicos no grupo (User.name / User.photo). Sem escopo de unidade.
 */
@Injectable()
export class GraduationsHierarchyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentsService: StudentsService,
  ) {}

  /**
   * `studentId` (opcional) = dependente escolhido no app; o vínculo é conferido por resolveLink (mesmo 404 para
   * inexistente/outro grupo/sem vínculo). Sem ele: o primeiro aluno ativo ligado ao usuário; staff sem aluno ligado
   * recebe a visão do grupo com `me: null`.
   */
  async get(user: AuthenticatedUser, studentId?: number) {
    const organizationId = user.organizationId;
    if (organizationId === undefined || organizationId === null) {
      throw new UnauthorizedException('Token sem contexto de organização.');
    }

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { id: true, name: true, logo: true },
    });

    const viewer =
      studentId !== undefined
        ? await requireLinkedStudent(this.studentsService, organizationId, user.id, studentId)
        : await this.firstLinkedStudent(organizationId, user.id);

    // Graduação ATUAL de cada aluno ativo = a mais recente (data, depois id).
    const [latest, totalStudents, activeSystems, staff, viewerLatest] = await Promise.all([
      this.prisma.studentGraduation.findMany({
        where: { organizationId, student: { status: StudentStatus.ACTIVE } },
        orderBy: [{ graduatedAt: 'desc' }, { id: 'desc' }],
        distinct: ['studentId'],
        select: { studentId: true, graduatedAt: true, graduationLevelId: true },
      }),
      this.prisma.student.count({ where: { organizationId, status: StudentStatus.ACTIVE } }),
      this.prisma.graduationSystem.findMany({
        where: { organizationId, isActive: true },
        orderBy: { id: 'asc' },
        select: { id: true, name: true, levels: { orderBy: { order: 'asc' }, select: LEVEL_SELECT } },
      }),
      this.prisma.organizationUser.findMany({
        where: {
          organizationId,
          status: 'ACTIVE',
          role: { in: [OrgRole.MESTRE, OrgRole.PROFESSOR] },
          user: { status: 'ACTIVE' },
        },
        orderBy: { id: 'asc' },
        select: { role: true, user: { select: { id: true, name: true, photo: true } } },
      }),
      viewer
        ? this.prisma.studentGraduation.findFirst({
            where: { organizationId, studentId: viewer.id },
            orderBy: [{ graduatedAt: 'desc' }, { id: 'desc' }],
            select: { graduationLevelId: true },
          })
        : Promise.resolve(null),
    ]);

    const staffUserIds = staff.map((s) => s.user.id);
    const staffStudents = staffUserIds.length
      ? await this.prisma.student.findMany({
          where: { organizationId, userId: { in: staffUserIds }, status: StudentStatus.ACTIVE },
          select: { id: true, userId: true, photo: true },
        })
      : [];

    // Detalhe de TODOS os níveis citados (inclusive de sistemas inativos: mestre/aluno mostram a corda que têm).
    const levelIds = new Set<number>(latest.map((g) => g.graduationLevelId));
    if (viewerLatest) levelIds.add(viewerLatest.graduationLevelId);
    const levelRows = levelIds.size
      ? await this.prisma.graduationLevel.findMany({
          where: { organizationId, id: { in: [...levelIds] } },
          select: { ...LEVEL_SELECT, graduationSystemId: true, graduationSystem: { select: { isActive: true } } },
        })
      : [];
    const levelById = new Map(levelRows.map((l) => [l.id, l]));
    const viewLevel = (id: number | undefined): LevelView | null => {
      const row = id === undefined ? undefined : levelById.get(id);
      return row ? levelView(row) : null;
    };

    // Sistema exibido: o do nível atual do aluno (se ativo); senão o primeiro sistema ativo com níveis.
    const viewerRow = viewerLatest ? levelById.get(viewerLatest.graduationLevelId) : undefined;
    const viewerSystem = viewerRow?.graduationSystem.isActive
      ? activeSystems.find((s) => s.id === viewerRow.graduationSystemId)
      : undefined;
    const system = viewerSystem ?? activeSystems.find((s) => s.levels.length > 0) ?? null;

    // Alunos ativos por nível do sistema exibido.
    const byLevel = new Map<number, Array<{ studentId: number; graduatedAt: Date }>>();
    for (const level of system?.levels ?? []) byLevel.set(level.id, []);
    for (const g of latest) byLevel.get(g.graduationLevelId)?.push({ studentId: g.studentId, graduatedAt: g.graduatedAt });

    // Seleção: o próprio aluno sempre entra; os demais, os mais recentemente graduados, até o limite.
    const selectedByLevel = new Map<number, number[]>();
    for (const [levelId, entries] of byLevel) {
      const mine = viewer ? entries.filter((e) => e.studentId === viewer.id) : [];
      const others = entries
        .filter((e) => e.studentId !== viewer?.id)
        .sort((a, b) => b.graduatedAt.getTime() - a.graduatedAt.getTime() || a.studentId - b.studentId);
      selectedByLevel.set(
        levelId,
        [...mine, ...others].slice(0, HIERARCHY_STUDENTS_PER_LEVEL).map((e) => e.studentId),
      );
    }

    const wantedStudentIds = new Set<number>();
    for (const ids of selectedByLevel.values()) ids.forEach((id) => wantedStudentIds.add(id));
    if (viewer) wantedStudentIds.add(viewer.id);
    const people = wantedStudentIds.size
      ? await this.prisma.student.findMany({
          where: { organizationId, id: { in: [...wantedStudentIds] } },
          select: { id: true, name: true, photo: true, rankingProfile: { select: { nickname: true } } },
        })
      : [];
    const personById = new Map(people.map((p) => [p.id, p]));
    const nameOf = (id: number): string => {
      const p = personById.get(id);
      return p ? displayNameOf(p.name, p.rankingProfile?.nickname) : 'Capoeirista';
    };

    const myLevel = viewLevel(viewerLatest?.graduationLevelId);
    const myOrder = myLevel?.order ?? null;
    const myLevelInSystem = !!system && !!viewerRow && viewerRow.graduationSystemId === system.id;
    let higherCount = 0;
    if (myLevelInSystem && myOrder !== null) {
      for (const level of system?.levels ?? []) {
        if (level.order > myOrder) higherCount += byLevel.get(level.id)?.length ?? 0;
      }
    }

    const levels = [...(system?.levels ?? [])]
      .sort((a, b) => b.order - a.order)
      .map((level) => {
        const entries = byLevel.get(level.id) ?? [];
        const ids = selectedByLevel.get(level.id) ?? [];
        const students = ids
          .map((id) => ({
            studentId: id,
            displayName: nameOf(id),
            photo: personById.get(id)?.photo ?? null,
            isMe: id === viewer?.id,
          }))
          .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.displayName.localeCompare(b.displayName, 'pt-BR'));
        return {
          ...levelView(level),
          count: entries.length,
          isMine: myLevelInSystem && level.id === viewerLatest?.graduationLevelId,
          students,
        };
      });

    // Mestres e professores: nome/foto públicos; level = corda do Student ativo ligado ao mesmo userId (se houver).
    const studentOfUser = new Map(staffStudents.map((s) => [s.userId as number, s]));
    const levelByStudent = new Map(latest.map((g) => [g.studentId, g.graduationLevelId]));
    const personOf = (u: { id: number; name: string; photo: string | null }): HierarchyPerson => {
      const linked = studentOfUser.get(u.id);
      return {
        id: u.id,
        displayName: u.name,
        photo: u.photo ?? linked?.photo ?? null,
        level: linked ? viewLevel(levelByStudent.get(linked.id)) : null,
      };
    };
    const byName = (a: HierarchyPerson, b: HierarchyPerson) => a.displayName.localeCompare(b.displayName, 'pt-BR');
    const masters = staff
      .filter((s) => s.role === OrgRole.MESTRE)
      .map((s) => personOf(s.user))
      .sort(byName);
    const teacherUsers = staff.filter((s) => s.role === OrgRole.PROFESSOR).map((s) => s.user);

    const myTeacherIds = new Set<number>();
    if (viewer && teacherUsers.length > 0) {
      const classes = await this.prisma.class.findMany({
        where: {
          organizationId,
          status: RecordStatus.ACTIVE,
          teacherUserId: { in: teacherUsers.map((t) => t.id) },
          classStudents: { some: { studentId: viewer.id, status: RecordStatus.ACTIVE } },
        },
        select: { teacherUserId: true },
      });
      for (const c of classes) if (c.teacherUserId !== null) myTeacherIds.add(c.teacherUserId);
    }
    const teachers = teacherUsers
      .map((u) => ({ ...personOf(u), isMyTeacher: myTeacherIds.has(u.id) }))
      .sort(byName);

    return {
      group: { id: organization.id, name: organization.name, logoUrl: organization.logo ?? null },
      system: system ? { id: system.id, name: system.name } : null,
      masters,
      teachers,
      levels,
      me: viewer
        ? {
            studentId: viewer.id,
            displayName: nameOf(viewer.id),
            photo: personById.get(viewer.id)?.photo ?? null,
            level: myLevel,
            order: myOrder,
          }
        : null,
      higherCount,
      totalStudents,
    };
  }

  /** Primeiro aluno ATIVO ligado ao usuário (próprio ou dependente), como nas rotas /me do app; ou null. */
  private async firstLinkedStudent(organizationId: number, userId: number) {
    const mine = await this.studentsService.findMine(organizationId, userId);
    return mine.find((s) => s.status === StudentStatus.ACTIVE) ?? mine[0] ?? null;
  }
}
