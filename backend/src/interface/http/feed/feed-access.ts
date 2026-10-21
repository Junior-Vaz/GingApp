import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { FeedVisibility, OrgRole, Prisma, StudentStatus, UserType } from '@prisma/client';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { isRestricted, UnitScope, UnitScopeService, unitScopeFilter } from '../../../shared/access/unit-scope';

/**
 * Quem ve / posta / modera o que no feed (contrato secoes 1 e 4). SSOT do modulo: a listagem, a criacao (IDOR da
 * visibilidade), as acoes por id e a moderacao usam SO as funcoes daqui.
 *
 * Pertencer (ver e postar com essa visibilidade):
 *  - GROUP: todo membro ativo do grupo;
 *  - UNIT u: MESTRE; aluno ATIVO da unidade; responsavel de aluno ATIVO da unidade; equipe (PROFESSOR/INSTRUTOR/MONITOR)
 *    com acesso a unidade pelo escopo de unidade (shared/access/unit-scope.ts: sem nenhum UserUnitAccess = todas);
 *  - CLASS t: MESTRE; aluno com matricula ATIVA na turma (e aluno ATIVO); responsavel desse aluno; o professor
 *    responsavel da turma (Class.teacherUserId); PROFESSOR/INSTRUTOR cujo escopo de unidade alcanca a unidade da turma.
 *    MONITOR so as turmas em que e o responsavel (mesma regra de "as aulas dele", ownLessonFilter).
 *  - o autor sempre ve o proprio post.
 * Moderar: MESTRE tudo; PROFESSOR/INSTRUTOR so posts UNIT/CLASS dentro do escopo acima (GROUP: so ver/denunciar);
 * MONITOR/ALUNO/RESPONSAVEL nunca.
 */

/** Equipe = publica direto no modo MODERATED e pode postar no STAFF_ONLY (MONITOR conta como membro). */
export const FEED_STAFF_ROLES: OrgRole[] = [OrgRole.MESTRE, OrgRole.PROFESSOR, OrgRole.INSTRUTOR];
/** Papeis com escopo de unidade que veem posts UNIT pelo escopo (o MONITOR ve UNIT pelo escopo, mas nao CLASS). */
const UNIT_SCOPED_ROLES: OrgRole[] = [OrgRole.PROFESSOR, OrgRole.INSTRUTOR, OrgRole.MONITOR];
/** Moderadores (alem do MESTRE). */
const SCOPED_MODERATOR_ROLES: OrgRole[] = [OrgRole.PROFESSOR, OrgRole.INSTRUTOR];

export interface FeedViewer {
  userId: number;
  organizationId: number;
  role: OrgRole;
  isMestre: boolean;
  isStaff: boolean;
  /** MESTRE ou PROFESSOR/INSTRUTOR (moderam algo). */
  isModerator: boolean;
  scope: UnitScope;
  /** Unidades a que pertence como aluno ATIVO ou responsavel de aluno ATIVO. */
  memberUnitIds: number[];
  /** Turmas: matricula ATIVA propria/de dependente + turmas em que e o professor responsavel. */
  memberClassIds: number[];
}

/** O que a regra precisa saber de um post (ou de um ALVO de post: visibilidade + unidade + turma). */
export interface FeedTarget {
  visibility: FeedVisibility;
  unitId: number | null;
  classId: number | null;
  authorUserId?: number | null;
  /** Turma do post (unidade ATUAL da turma e professor responsavel). */
  class?: { unitId: number | null; teacherUserId: number | null } | null;
}

export function forbidden(code: string, message: string): ForbiddenException {
  return new ForbiddenException({ statusCode: 403, error: 'Forbidden', code, message });
}

@Injectable()
export class FeedAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unitScope: UnitScopeService,
  ) {}

  /** Contexto do usuario do token (calculado a cada requisicao). PLATFORM/sem grupo = 401. */
  async viewer(user: AuthenticatedUser | undefined): Promise<FeedViewer> {
    if (!user || user.userType !== UserType.MEMBER || user.organizationId == null || !user.role) {
      throw new UnauthorizedException('Token sem contexto de organização.');
    }
    const organizationId = user.organizationId;
    const role = user.role;
    const [scope, ownStudents, guarded, taught] = await Promise.all([
      this.unitScope.resolve(user, organizationId),
      this.prisma.student.findMany({
        where: { organizationId, userId: user.id, status: StudentStatus.ACTIVE },
        select: { id: true, unitId: true },
      }),
      this.prisma.studentGuardian.findMany({
        where: { organizationId, userId: user.id, student: { status: StudentStatus.ACTIVE } },
        select: { student: { select: { id: true, unitId: true } } },
      }),
      this.prisma.class.findMany({ where: { organizationId, teacherUserId: user.id }, select: { id: true } }),
    ]);
    const students = [...ownStudents, ...guarded.map((g) => g.student)];
    const enrollments = students.length
      ? await this.prisma.classStudent.findMany({
          where: { organizationId, studentId: { in: students.map((s) => s.id) }, status: 'ACTIVE' },
          select: { classId: true },
        })
      : [];
    const isMestre = role === OrgRole.MESTRE;
    return {
      userId: user.id,
      organizationId,
      role,
      isMestre,
      isStaff: FEED_STAFF_ROLES.includes(role),
      isModerator: isMestre || SCOPED_MODERATOR_ROLES.includes(role),
      scope,
      memberUnitIds: [...new Set(students.map((s) => s.unitId).filter((id): id is number => id !== null))],
      memberClassIds: [...new Set([...enrollments.map((e) => e.classId), ...taught.map((t) => t.id)])],
    };
  }

  /** `where` dos posts que o usuario PODE VER pela visibilidade (sem filtro de status). */
  visibleWhere(v: FeedViewer): Prisma.FeedPostWhereInput {
    if (v.isMestre) return {};
    const or: Prisma.FeedPostWhereInput[] = [{ visibility: FeedVisibility.GROUP }, { authorUserId: v.userId }];
    // UNIT
    if (UNIT_SCOPED_ROLES.includes(v.role) && !isRestricted(v.scope)) {
      or.push({ visibility: FeedVisibility.UNIT });
    } else {
      const units = [...new Set([...v.memberUnitIds, ...(isRestricted(v.scope) ? v.scope : [])])];
      if (units.length) or.push({ visibility: FeedVisibility.UNIT, unitId: { in: units } });
    }
    // CLASS
    if (v.memberClassIds.length) or.push({ visibility: FeedVisibility.CLASS, classId: { in: v.memberClassIds } });
    if (SCOPED_MODERATOR_ROLES.includes(v.role)) {
      or.push(isRestricted(v.scope) ? { visibility: FeedVisibility.CLASS, class: unitScopeFilter(v.scope) } : { visibility: FeedVisibility.CLASS });
    }
    return { OR: or };
  }

  /** Mesma regra de `visibleWhere`, em memoria, para um post/alvo ja carregado (inclui `class`). */
  canSee(v: FeedViewer, t: FeedTarget): boolean {
    if (v.isMestre) return true;
    if (t.authorUserId != null && t.authorUserId === v.userId) return true;
    return this.belongsTo(v, t);
  }

  /** O usuario PERTENCE ao alvo (sem a regra "autor ve o proprio"): base de ver e de escolher a visibilidade ao postar. */
  belongsTo(v: FeedViewer, t: FeedTarget): boolean {
    if (v.isMestre) return true;
    if (t.visibility === FeedVisibility.GROUP) return true;
    if (t.visibility === FeedVisibility.UNIT) {
      if (t.unitId === null) return false;
      if (UNIT_SCOPED_ROLES.includes(v.role) && (!isRestricted(v.scope) || v.scope.includes(t.unitId))) return true;
      return v.memberUnitIds.includes(t.unitId);
    }
    if (t.classId === null) return false;
    if (v.memberClassIds.includes(t.classId)) return true;
    if (SCOPED_MODERATOR_ROLES.includes(v.role)) {
      if (!isRestricted(v.scope)) return true;
      const unitId = t.class?.unitId ?? null;
      return unitId === null || v.scope.includes(unitId);
    }
    return false;
  }

  /** `where` dos posts que o usuario MODERA (MESTRE: tudo; PROFESSOR/INSTRUTOR: UNIT/CLASS no escopo). */
  moderatableWhere(v: FeedViewer): Prisma.FeedPostWhereInput | null {
    if (v.isMestre) return {};
    if (!SCOPED_MODERATOR_ROLES.includes(v.role)) return null;
    if (!isRestricted(v.scope)) return { visibility: { in: [FeedVisibility.UNIT, FeedVisibility.CLASS] } };
    return {
      OR: [
        { visibility: FeedVisibility.UNIT, unitId: { in: v.scope } },
        { visibility: FeedVisibility.CLASS, class: { OR: [unitScopeFilter(v.scope), { teacherUserId: v.userId }] } },
      ],
    };
  }

  canModerate(v: FeedViewer, t: FeedTarget): boolean {
    if (v.isMestre) return true;
    if (!SCOPED_MODERATOR_ROLES.includes(v.role)) return false;
    if (t.visibility === FeedVisibility.GROUP) return false;
    if (t.visibility === FeedVisibility.UNIT) return t.unitId !== null && (!isRestricted(v.scope) || v.scope.includes(t.unitId));
    if (!isRestricted(v.scope)) return true;
    if (t.class?.teacherUserId === v.userId) return true;
    const unitId = t.class?.unitId ?? null;
    return unitId === null || v.scope.includes(unitId);
  }

  /** Rotas de moderacao: MESTRE/PROFESSOR/INSTRUTOR; demais 403. */
  assertModerator(v: FeedViewer): void {
    if (!v.isModerator) throw forbidden('MODERATION_NOT_ALLOWED', 'Você não tem permissão para moderar o feed.');
  }
}
