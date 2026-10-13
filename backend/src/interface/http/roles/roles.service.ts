import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GroupRole, OrgRole, StaffRole, StudentStatus } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { LEVEL_SELECT, levelView } from '../graduations/rope';
import { NotificationsService } from '../notifications/notifications.service';
import { PersonIdentityService } from '../people/person-identity.service';
import { canonicalPerson } from '../people/person-linker';
import { StudentAccessService } from '../students/student-access.service';
import {
  badgeOf,
  badgesByUser,
  GROUP_ROLE_BADGE_SELECT,
  groupRoleForLegacy,
  rolesPayload,
  suggestedGroupRoles,
} from './group-roles';
import { ensureMembershipRole, principalRole, recomputeAccess, STAFF_ROLE_RANK, STAFF_ROLES, sortRoles } from './staff-roles';

export interface RoleTargetInput {
  studentId?: number;
  personId?: number;
}

/** Cargo pedido: `groupRoleId` (cargo do grupo) ou, legado, `role` (enum, mapeado pelo slug padrao). */
export interface GroupRoleRef {
  groupRoleId?: number;
  role?: StaffRole;
}

export interface GrantRoleInput extends RoleTargetInput, GroupRoleRef {
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
 * CARGOS acumulaveis (Fase 3) sobre os CARGOS DO GRUPO (secao 13): conceder/revogar (so o MESTRE do grupo; ele tambem
 * pode nomear outro cargo com acesso de Mestre), regras de corda por cargo no sistema de graduacao, sugestoes de promocao
 * e o aviso ao Mestre (1x por aluno+cargo). Revogar NUNCA apaga a matricula de aluno.
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

  /** PERFIS DE ACESSO dos cargos ATIVOS (maior primeiro) do login no grupo; materializa o cargo do papel de equipe legado. */
  async activeRoles(organizationId: number, userId: number): Promise<StaffRole[]> {
    await ensureMembershipRole(this.prisma, organizationId, userId);
    const rows = await this.prisma.personRole.findMany({ where: { organizationId, userId, revokedAt: null }, select: { role: true } });
    return sortRoles(rows.map((r) => r.role));
  }

  /** Mantem o cargo coerente com a tela Equipe (criar/editar membro da equipe com um papel). Nunca lanca. */
  async syncFromTeacherScreen(organizationId: number, userId: number, actorUserId: number | null): Promise<void> {
    try {
      const membership = await this.prisma.organizationUser.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
      if (!membership || !STAFF_ROLES.includes(membership.role as StaffRole)) return;
      const role = membership.role as StaffRole;
      await this.prisma.$transaction(async (tx) => {
        // Papel principal rebaixado na tela Equipe: os cargos com perfil MAIOR que ele deixam de valer (historico preservado).
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

  /** Cargo do grupo pedido (groupRoleId do proprio grupo; ou o enum legado pelo slug padrao). 404 se de outro grupo. */
  async resolveGroupRole(organizationId: number, ref: GroupRoleRef): Promise<GroupRole> {
    if (ref.groupRoleId) {
      const found = await this.prisma.groupRole.findFirst({ where: { id: ref.groupRoleId, organizationId } });
      if (!found) throw new NotFoundException({ statusCode: 404, error: 'Not Found', code: 'GROUP_ROLE_NOT_FOUND', message: 'Cargo não encontrado neste grupo.' });
      return found;
    }
    if (ref.role) return groupRoleForLegacy(this.prisma, organizationId, ref.role);
    throw badRequest('GROUP_ROLE_REQUIRED', 'Informe o cargo (groupRoleId).');
  }

  async grant(organizationId: number, actorUserId: number, input: GrantRoleInput) {
    const student = await this.resolveStudent(organizationId, input);
    const groupRole = await this.resolveGroupRole(organizationId, input);
    if (!groupRole.active) throw conflict('GROUP_ROLE_INACTIVE', `O cargo ${groupRole.name} está inativo: reative-o em Cargos do grupo.`);
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
    const already = await this.prisma.personRole.count({ where: { organizationId, userId, groupRoleId: groupRole.id, revokedAt: null } });
    if (already > 0) throw conflict('ROLE_ALREADY_ACTIVE', `Esta pessoa já é ${groupRole.name} neste grupo.`);

    // Acesso efetivo = o MAIOR perfil de acesso entre os cargos ativos.
    const principal = principalRole([...active, groupRole.accessRole], { hasStudent: true, isGuardian: false });
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.personRole.create({
        data: {
          organizationId,
          userId: userId!,
          personId: person.id,
          role: groupRole.accessRole,
          groupRoleId: groupRole.id,
          grantedByUserId: actorUserId,
          source: 'GRANT',
        },
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
      meta: { groupRoleId: groupRole.id, groupRoleName: groupRole.name, role: groupRole.accessRole, studentId: student.id, userId, principal },
    });
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    await this.notifications.safely('role-grant', () =>
      this.notifications.notifyUsers(organizationId, [userId!], {
        type: 'ROLE_GRANTED',
        title: `Você agora é ${groupRole.name}`,
        body: `${org?.name ?? 'Seu grupo'} confirmou você como ${groupRole.name}. Você continua aluno(a), com a sua ficha.`,
      }),
    );
    return this.view(organizationId, student.id, userId);
  }

  async revoke(organizationId: number, actorUserId: number, input: RoleTargetInput & GroupRoleRef) {
    const student = await this.resolveStudent(organizationId, input);
    const groupRole = await this.resolveGroupRole(organizationId, input);
    const userId = student.userId;
    if (!userId) throw conflict('ROLE_NOT_ACTIVE', 'Esta pessoa não tem esse cargo neste grupo.');
    await ensureMembershipRole(this.prisma, organizationId, userId);
    const activeRows = await this.prisma.personRole.findMany({
      where: { organizationId, userId, revokedAt: null },
      select: { id: true, role: true, groupRoleId: true },
    });
    let target = activeRows.filter((r) => r.groupRoleId === groupRole.id);
    // Legado (`role` enum): o cargo daquele perfil que a pessoa tiver, se nao tiver o padrao.
    if (target.length === 0 && !input.groupRoleId && input.role) target = activeRows.filter((r) => r.role === input.role).slice(0, 1);
    if (target.length === 0) throw conflict('ROLE_NOT_ACTIVE', 'Esta pessoa não tem esse cargo neste grupo.');
    const targetIds = new Set(target.map((r) => r.id));
    const remaining = activeRows.filter((r) => !targetIds.has(r.id));
    if (target.some((r) => r.role === StaffRole.MESTRE) && !remaining.some((r) => r.role === StaffRole.MESTRE)) {
      // Outro Mestre com acesso efetivo (membership; inclui papel legado sem cargo materializado) ou com cargo de perfil MESTRE.
      const mestres =
        (await this.prisma.organizationUser.count({ where: { organizationId, role: OrgRole.MESTRE, status: 'ACTIVE', userId: { not: userId } } })) +
        (await this.prisma.personRole.count({ where: { organizationId, role: StaffRole.MESTRE, revokedAt: null, userId: { not: userId } } }));
      if (mestres === 0) throw conflict('LAST_MESTRE', 'O grupo precisa de pelo menos um Mestre: nomeie outro antes de revogar este.');
    }
    const principal = await this.prisma.$transaction(async (tx) => {
      await tx.personRole.updateMany({ where: { id: { in: [...targetIds] } }, data: { revokedAt: new Date(), revokedByUserId: actorUserId } });
      return recomputeAccess(tx, organizationId, userId);
    });
    const revokedGroupRole =
      target[0]!.groupRoleId === groupRole.id ? groupRole : await this.prisma.groupRole.findUnique({ where: { id: target[0]!.groupRoleId ?? -1 } });
    const name = revokedGroupRole?.name ?? groupRole.name;
    await this.audit.record({
      organizationId,
      action: AuditAction.ROLE_REVOKE,
      entity: AuditEntity.PERSON_ROLE,
      entityId: userId,
      meta: { groupRoleId: target[0]!.groupRoleId, groupRoleName: name, role: target[0]!.role, studentId: student.id, userId, principal },
    });
    await this.notifications.safely('role-revoke', () =>
      this.notifications.notifyUsers(organizationId, [userId], {
        type: 'ROLE_REVOKED',
        title: `Cargo de ${name} encerrado`,
        body: 'Sua matrícula de aluno(a) e a sua ficha continuam valendo.',
      }),
    );
    return this.view(organizationId, student.id, userId);
  }

  private async view(organizationId: number, studentId: number, userId: number) {
    const [badges, membership] = await Promise.all([
      badgesByUser(this.prisma, organizationId, [userId]),
      this.prisma.organizationUser.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { role: true, status: true } }),
    ]);
    return { studentId, userId, ...rolesPayload(badges.get(userId) ?? []), accessRole: membership?.role ?? null };
  }

  // ------------------------------------------------------------------------------------------- regras de corda

  /** Regras sem cargo do grupo (dados antigos fora da migration): liga ao cargo padrao do mesmo perfil. */
  private async linkLegacyRules(organizationId: number, systemId: number) {
    const orphans = await this.prisma.graduationRoleRule.findMany({ where: { graduationSystemId: systemId, groupRoleId: null } });
    for (const r of orphans) {
      const gr = await groupRoleForLegacy(this.prisma, organizationId, r.role);
      await this.prisma.graduationRoleRule.update({ where: { id: r.id }, data: { groupRoleId: gr.id } }).catch(() => undefined);
    }
  }

  async getRules(organizationId: number, systemId: number) {
    const exists = await this.prisma.graduationSystem.findFirst({ where: { id: systemId, organizationId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Sistema de graduação não encontrado.');
    await this.linkLegacyRules(organizationId, systemId);
    const system = await this.prisma.graduationSystem.findUniqueOrThrow({
      where: { id: systemId },
      include: {
        levels: { select: LEVEL_SELECT, orderBy: { order: 'asc' } },
        roleRules: { where: { groupRoleId: { not: null } }, include: { groupRole: { select: { ...GROUP_ROLE_BADGE_SELECT, active: true } } } },
      },
    });
    const levelByOrder = new Map(system.levels.map((l) => [l.order, l]));
    const rules = system.roleRules
      .filter((r) => r.groupRole)
      .sort((a, b) => b.groupRole!.rank - a.groupRole!.rank || a.groupRole!.id - b.groupRole!.id)
      .map((rule) => {
        const level = levelByOrder.get(rule.minLevelOrder);
        const { active, ...badge } = rule.groupRole!;
        return {
          groupRoleId: badge.id,
          groupRole: { ...badgeOf(badge), active },
          role: badge.accessRole,
          minLevelOrder: rule.minLevelOrder,
          level: level ? levelView(level) : null,
        };
      });
    return { systemId: system.id, rules };
  }

  /** Substitui as regras do sistema (lista vazia = sem sugestoes). minLevelOrder tem de ser a `order` de um nivel do sistema. */
  async setRules(organizationId: number, systemId: number, rules: (GroupRoleRef & { minLevelOrder: number })[]) {
    const system = await this.prisma.graduationSystem.findFirst({
      where: { id: systemId, organizationId },
      include: { levels: { select: { order: true } } },
    });
    if (!system) throw new NotFoundException('Sistema de graduação não encontrado.');
    const orders = new Set(system.levels.map((l) => l.order));
    const resolved: { groupRole: GroupRole; minLevelOrder: number }[] = [];
    for (const r of rules) {
      let groupRole: GroupRole;
      try {
        groupRole = await this.resolveGroupRole(organizationId, r);
      } catch (error) {
        if (error instanceof NotFoundException) throw badRequest('GROUP_ROLE_NOT_FOUND', `Cargo ${r.groupRoleId} não existe neste grupo.`);
        throw error;
      }
      if (resolved.some((x) => x.groupRole.id === groupRole.id)) throw badRequest('DUPLICATE_ROLE_RULE', `Cargo repetido: ${groupRole.name}.`);
      if (!orders.has(r.minLevelOrder)) throw badRequest('INVALID_LEVEL_ORDER', `A corda de ordem ${r.minLevelOrder} não existe neste sistema.`);
      resolved.push({ groupRole, minLevelOrder: r.minLevelOrder });
    }
    await this.prisma.$transaction([
      this.prisma.graduationRoleRule.deleteMany({ where: { graduationSystemId: systemId } }),
      this.prisma.graduationRoleRule.createMany({
        data: resolved.map((r) => ({
          organizationId,
          graduationSystemId: systemId,
          role: r.groupRole.accessRole,
          groupRoleId: r.groupRole.id,
          minLevelOrder: r.minLevelOrder,
        })),
      }),
    ]);
    await this.audit.record({
      organizationId,
      action: AuditAction.GRADUATION_ROLE_RULES_SET,
      entity: AuditEntity.GRADUATION_SYSTEM,
      entityId: systemId,
      meta: { rules: resolved.map((r) => ({ groupRoleId: r.groupRole.id, name: r.groupRole.name, minLevelOrder: r.minLevelOrder })) },
    });
    return this.getRules(organizationId, systemId);
  }

  // ------------------------------------------------------------------------------------------- sugestoes

  /** Alunos ATIVOS que atingiram a corda minima de um cargo do grupo e ainda nao tem cargo de rank igual ou maior. */
  async suggestions(organizationId: number, onlyStudentId?: number) {
    const rules = await this.prisma.graduationRoleRule.findMany({
      where: { organizationId, groupRoleId: { not: null } },
      select: { graduationSystemId: true, minLevelOrder: true, groupRole: { select: { ...GROUP_ROLE_BADGE_SELECT, active: true } } },
    });
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
    const held = await badgesByUser(this.prisma, organizationId, graded.map((s) => s.userId).filter((v): v is number => v !== null));
    const out = [];
    for (const s of graded) {
      const level = s.graduations[0]!.graduationLevel;
      const systemRules = rules.filter((r) => r.graduationSystemId === level.graduationSystem.id && r.groupRole).map((r) => ({ minLevelOrder: r.minLevelOrder, groupRole: r.groupRole! }));
      const current = s.userId ? (held.get(s.userId) ?? []) : [];
      for (const gr of suggestedGroupRoles(level.order, systemRules, current.map((b) => b.rank))) {
        const { graduationSystem, ...lv } = level;
        const badge = badgeOf(gr);
        out.push({
          studentId: s.id,
          personId: s.personId,
          name: s.name,
          photo: s.photo,
          hasLogin: s.userId !== null,
          currentRoles: current,
          currentRoleKeys: current.map((b) => b.slug),
          role: badge,
          groupRoleId: badge.id,
          accessRole: badge.accessRole,
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
          data: [{ organizationId, studentId, role: s.role.accessRole, groupRoleId: s.role.id }],
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
            title: `Sugestão: ${s.name} pode ser ${s.role.name}`,
            body: `${s.name} atingiu a corda ${s.level.name}, mínima para ${s.role.name}. Confirme em Equipe > Sugestões.`,
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
