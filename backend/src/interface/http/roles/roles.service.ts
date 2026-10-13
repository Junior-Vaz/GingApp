import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrgRole, StaffRole, StudentStatus } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { LEVEL_SELECT, levelView } from '../graduations/rope';
import { NotificationsService } from '../notifications/notifications.service';
import { PersonIdentityService } from '../people/person-identity.service';
import { canonicalPerson } from '../people/person-linker';
import { StudentAccessService } from '../students/student-access.service';
import {
  ensureMembershipRole,
  principalRole,
  ROLE_LABEL_BR,
  sortRoles,
  STAFF_ROLE_RANK,
  STAFF_ROLES,
  suggestedRoles,
} from './staff-roles';

export interface RoleTargetInput {
  studentId?: number;
  personId?: number;
}

export interface GrantRoleInput extends RoleTargetInput {
  role: StaffRole;
  /** Login para quem ainda nao tem acesso (mesmo fluxo do acesso do aluno: senha provisoria OU convite por e-mail). */
  email?: string;
  password?: string;
  sendInvite?: boolean;
}

const conflict = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  new ConflictException({ statusCode: 409, error: 'Conflict', code, message, ...extra });
const badRequest = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  new BadRequestException({ statusCode: 400, error: 'Bad Request', code, message, ...extra });

/**
 * CARGOS acumulaveis (Fase 3): conceder/revogar (so o MESTRE do grupo; ele tambem pode nomear outro MESTRE - decisao
 * documentada), regras de corda por cargo no sistema de graduacao, sugestoes de promocao e o aviso ao Mestre (1x por
 * aluno+cargo). Revogar NUNCA apaga a matricula de aluno.
 */
@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly people: PersonIdentityService,
    private readonly access: StudentAccessService,
  ) {}

  /** Cargos ATIVOS (maior primeiro) do login no grupo; materializa o cargo do papel de equipe legado. */
  async activeRoles(organizationId: number, userId: number): Promise<StaffRole[]> {
    await ensureMembershipRole(this.prisma, organizationId, userId);
    const rows = await this.prisma.personRole.findMany({ where: { organizationId, userId, revokedAt: null }, select: { role: true } });
    return sortRoles(rows.map((r) => r.role));
  }

  /** Cargos ativos por login (sem materializar; para listas). */
  async rolesByUser(organizationId: number, userIds: number[]): Promise<Map<number, StaffRole[]>> {
    const map = new Map<number, StaffRole[]>();
    if (userIds.length === 0) return map;
    const rows = await this.prisma.personRole.findMany({
      where: { organizationId, userId: { in: userIds }, revokedAt: null },
      select: { userId: true, role: true },
    });
    for (const r of rows) map.set(r.userId, sortRoles([...(map.get(r.userId) ?? []), r.role]));
    return map;
  }

  /** Mantem o cargo coerente com a tela Equipe (criar/editar membro da equipe com um papel). Nunca lanca. */
  async syncFromTeacherScreen(organizationId: number, userId: number, actorUserId: number | null): Promise<void> {
    try {
      const membership = await this.prisma.organizationUser.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
      if (!membership || !STAFF_ROLES.includes(membership.role as StaffRole)) return;
      const role = membership.role as StaffRole;
      await this.prisma.$transaction(async (tx) => {
        // Papel principal rebaixado na tela Equipe: os cargos MAIORES que ele deixam de valer (historico preservado).
        await tx.personRole.updateMany({
          where: { organizationId, userId, revokedAt: null, role: { in: STAFF_ROLES.filter((r) => STAFF_ROLE_RANK[r] > STAFF_ROLE_RANK[role]) } },
          data: { revokedAt: new Date(), revokedByUserId: actorUserId },
        });
        await ensureMembershipRole(tx, organizationId, userId, 'TEACHER');
      });
    } catch (error) {
      this.logger.error(`Falha ao sincronizar o cargo (org ${organizationId}, user ${userId}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async resolveStudent(organizationId: number, input: RoleTargetInput) {
    let student = null;
    if (input.studentId) {
      student = await this.prisma.student.findFirst({ where: { id: input.studentId, organizationId } });
    } else if (input.personId) {
      const person = await canonicalPerson(this.prisma, await this.prisma.person.findUnique({ where: { id: input.personId } }));
      if (person) student = await this.prisma.student.findFirst({ where: { personId: person.id, organizationId } });
    } else {
      throw badRequest('ROLE_TARGET_REQUIRED', 'Informe o aluno (studentId ou personId).');
    }
    // Todo mundo e aluno: cargo so para quem tem matricula NESTE grupo (de outro grupo = transferencia antes).
    if (!student) throw new NotFoundException('Aluno não encontrado.');
    return student;
  }

  async grant(organizationId: number, actorUserId: number, input: GrantRoleInput) {
    const student = await this.resolveStudent(organizationId, input);
    if (student.status !== StudentStatus.ACTIVE) throw conflict('STUDENT_NOT_ACTIVE', 'Só um aluno ativo pode receber um cargo.');
    const personId = await this.people.ensurePersonForStudent(student.id);
    const person = await this.prisma.person.findUniqueOrThrow({ where: { id: personId } });

    let userId = student.userId ?? null;
    if (!userId) {
      if (!input.email) {
        throw badRequest('LOGIN_REQUIRED', 'Para exercer um cargo a pessoa precisa de acesso: informe o e-mail (com senha provisória ou convite).');
      }
      // Mesmo fluxo do acesso do aluno (cria ou vincula o User; nunca duplica): valida senha/convite e e-mail.
      const account = await this.access.createAccount(organizationId, student.id, {
        email: input.email,
        password: input.password,
        sendInvite: input.sendInvite,
      });
      userId = account.account.userId;
    }

    const active = await this.activeRoles(organizationId, userId);
    if (active.includes(input.role)) throw conflict('ROLE_ALREADY_ACTIVE', `Esta pessoa já é ${ROLE_LABEL_BR[input.role]} neste grupo.`);

    const roles = sortRoles([...active, input.role]);
    const principal = principalRole(roles, { hasStudent: true, isGuardian: false });
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.personRole.create({
        data: { organizationId, userId: userId!, personId: person.id, role: input.role, grantedByUserId: actorUserId, source: 'GRANT' },
      });
      await tx.organizationUser.upsert({
        where: { organizationId_userId: { organizationId, userId: userId! } },
        create: { organizationId, userId: userId!, role: principal, status: 'ACTIVE' },
        update: { role: principal, status: 'ACTIVE' },
      });
      return row;
    });

    await this.audit.record({
      organizationId,
      action: AuditAction.ROLE_GRANT,
      entity: AuditEntity.PERSON_ROLE,
      entityId: created.id,
      meta: { role: input.role, studentId: student.id, userId, principal },
    });
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    await this.notifications.safely('role-grant', () =>
      this.notifications.notifyUsers(organizationId, [userId!], {
        type: 'ROLE_GRANTED',
        title: `Você agora é ${ROLE_LABEL_BR[input.role]}`,
        body: `${org?.name ?? 'Seu grupo'} confirmou você como ${ROLE_LABEL_BR[input.role]}. Você continua aluno(a), com a sua ficha.`,
      }),
    );
    return this.view(organizationId, student.id, userId);
  }

  async revoke(organizationId: number, actorUserId: number, input: RoleTargetInput & { role: StaffRole }) {
    const student = await this.resolveStudent(organizationId, input);
    const userId = student.userId;
    if (!userId) throw conflict('ROLE_NOT_ACTIVE', 'Esta pessoa não tem esse cargo neste grupo.');
    const active = await this.activeRoles(organizationId, userId);
    if (!active.includes(input.role)) throw conflict('ROLE_NOT_ACTIVE', 'Esta pessoa não tem esse cargo neste grupo.');
    if (input.role === StaffRole.MESTRE) {
      const mestres = await this.prisma.personRole.count({ where: { organizationId, role: StaffRole.MESTRE, revokedAt: null, userId: { not: userId } } });
      if (mestres === 0) throw conflict('LAST_MESTRE', 'O grupo precisa de pelo menos um Mestre: nomeie outro antes de revogar este.');
    }
    const remaining = active.filter((r) => r !== input.role);
    const isGuardian = (await this.prisma.studentGuardian.count({ where: { organizationId, userId } })) > 0;
    const principal = principalRole(remaining, { hasStudent: true, isGuardian });
    await this.prisma.$transaction(async (tx) => {
      await tx.personRole.updateMany({
        where: { organizationId, userId, role: input.role, revokedAt: null },
        data: { revokedAt: new Date(), revokedByUserId: actorUserId },
      });
      await tx.organizationUser.updateMany({ where: { organizationId, userId }, data: { role: principal } });
      // Sem cargo de equipe: deixa de ter escopo de unidade de professor.
      if (!remaining.length) await tx.userUnitAccess.deleteMany({ where: { organizationId, userId } });
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.ROLE_REVOKE,
      entity: AuditEntity.PERSON_ROLE,
      entityId: userId,
      meta: { role: input.role, studentId: student.id, userId, principal },
    });
    await this.notifications.safely('role-revoke', () =>
      this.notifications.notifyUsers(organizationId, [userId], {
        type: 'ROLE_REVOKED',
        title: `Cargo de ${ROLE_LABEL_BR[input.role]} encerrado`,
        body: 'Sua matrícula de aluno(a) e a sua ficha continuam valendo.',
      }),
    );
    return this.view(organizationId, student.id, userId);
  }

  private async view(organizationId: number, studentId: number, userId: number) {
    const [roles, membership] = await Promise.all([
      this.activeRoles(organizationId, userId),
      this.prisma.organizationUser.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { role: true, status: true } }),
    ]);
    return { studentId, userId, roles, accessRole: membership?.role ?? null };
  }

  // ------------------------------------------------------------------------------------------- regras de corda

  async getRules(organizationId: number, systemId: number) {
    const system = await this.prisma.graduationSystem.findFirst({
      where: { id: systemId, organizationId },
      include: { levels: { select: LEVEL_SELECT, orderBy: { order: 'asc' } }, roleRules: true },
    });
    if (!system) throw new NotFoundException('Sistema de graduação não encontrado.');
    const levelByOrder = new Map(system.levels.map((l) => [l.order, l]));
    return {
      systemId: system.id,
      rules: sortRoles(system.roleRules.map((r) => r.role)).map((role) => {
        const rule = system.roleRules.find((r) => r.role === role)!;
        const level = levelByOrder.get(rule.minLevelOrder);
        return { role, minLevelOrder: rule.minLevelOrder, level: level ? levelView(level) : null };
      }),
    };
  }

  /** Substitui as regras do sistema (lista vazia = sem sugestoes). minLevelOrder tem de ser a `order` de um nivel do sistema. */
  async setRules(organizationId: number, systemId: number, rules: { role: StaffRole; minLevelOrder: number }[]) {
    const system = await this.prisma.graduationSystem.findFirst({
      where: { id: systemId, organizationId },
      include: { levels: { select: { order: true } } },
    });
    if (!system) throw new NotFoundException('Sistema de graduação não encontrado.');
    const orders = new Set(system.levels.map((l) => l.order));
    const seen = new Set<StaffRole>();
    for (const r of rules) {
      if (seen.has(r.role)) throw badRequest('DUPLICATE_ROLE_RULE', `Cargo repetido: ${r.role}.`);
      seen.add(r.role);
      if (!orders.has(r.minLevelOrder)) throw badRequest('INVALID_LEVEL_ORDER', `A corda de ordem ${r.minLevelOrder} não existe neste sistema.`);
    }
    await this.prisma.$transaction([
      this.prisma.graduationRoleRule.deleteMany({ where: { graduationSystemId: systemId } }),
      this.prisma.graduationRoleRule.createMany({
        data: rules.map((r) => ({ organizationId, graduationSystemId: systemId, role: r.role, minLevelOrder: r.minLevelOrder })),
      }),
    ]);
    await this.audit.record({
      organizationId,
      action: AuditAction.GRADUATION_ROLE_RULES_SET,
      entity: AuditEntity.GRADUATION_SYSTEM,
      entityId: systemId,
      meta: { rules },
    });
    return this.getRules(organizationId, systemId);
  }

  // ------------------------------------------------------------------------------------------- sugestoes

  /** Alunos ATIVOS que atingiram a corda minima de um cargo e ainda nao o tem (nem um maior). */
  async suggestions(organizationId: number, onlyStudentId?: number) {
    const rules = await this.prisma.graduationRoleRule.findMany({ where: { organizationId }, select: { graduationSystemId: true, role: true, minLevelOrder: true } });
    if (rules.length === 0) return [];
    const students = await this.prisma.student.findMany({
      where: { organizationId, status: StudentStatus.ACTIVE, ...(onlyStudentId ? { id: onlyStudentId } : {}) },
      select: {
        id: true,
        personId: true,
        userId: true,
        name: true,
        photo: true,
        graduations: {
          select: { graduatedAt: true, id: true, graduationLevel: { select: { ...LEVEL_SELECT, graduationSystem: { select: { id: true, name: true } } } } },
          orderBy: [{ graduatedAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });
    const graded = students.filter((s) => s.graduations.length > 0);
    const roles = await this.rolesByUser(organizationId, graded.map((s) => s.userId).filter((v): v is number => v !== null));
    const out = [];
    for (const s of graded) {
      const level = s.graduations[0]!.graduationLevel;
      const systemRules = rules.filter((r) => r.graduationSystemId === level.graduationSystem.id);
      const active = s.userId ? (roles.get(s.userId) ?? []) : [];
      for (const role of suggestedRoles(level.order, systemRules, active)) {
        const { graduationSystem, ...lv } = level;
        out.push({
          studentId: s.id,
          personId: s.personId,
          name: s.name,
          photo: s.photo,
          hasLogin: s.userId !== null,
          currentRoles: active,
          role,
          level: levelView(lv),
          system: graduationSystem,
          graduatedAt: s.graduations[0]!.graduatedAt,
        });
      }
    }
    return out;
  }

  /** Depois de uma graduacao: avisa os MESTRES (1x por aluno+cargo, nunca repete) dos cargos que a corda liberou. Nunca lanca. */
  async notifyNewSuggestions(organizationId: number, studentId: number): Promise<number> {
    try {
      const found = await this.suggestions(organizationId, studentId);
      let sent = 0;
      for (const s of found) {
        const created = await this.prisma.roleSuggestionNotice.createMany({
          data: [{ organizationId, studentId, role: s.role }],
          skipDuplicates: true,
        });
        if (created.count === 0) continue;
        const mestres = await this.prisma.organizationUser.findMany({
          where: { organizationId, role: OrgRole.MESTRE, status: 'ACTIVE' },
          select: { userId: true },
        });
        await this.notifications.safely('role-suggestion', () =>
          this.notifications.notifyUsers(organizationId, mestres.map((m) => m.userId), {
            type: 'ROLE_SUGGESTION',
            title: `Sugestão: ${s.name} pode ser ${ROLE_LABEL_BR[s.role]}`,
            body: `${s.name} atingiu a corda ${s.level.name}, mínima para ${ROLE_LABEL_BR[s.role]}. Confirme em Equipe > Sugestões.`,
          }),
        );
        sent++;
      }
      return sent;
    } catch (error) {
      this.logger.error(`Falha ao avisar sugestao de cargo (aluno ${studentId}): ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }
}
