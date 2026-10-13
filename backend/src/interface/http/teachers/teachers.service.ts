import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrgRole, Prisma, StaffRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { pageArgs } from '../../../shared/pagination/pagination';
import { ListTeachersQueryDto } from './dto/list-teachers-query.dto';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { findUserIdsByEmail } from '../../../shared/security/email-lookup';
import { BCRYPT_ROUNDS, normalizeEmail } from '../../../shared/security/password-policy';
import { resetMemberPassword } from '../../../shared/security/reset-member-password';
import { ResetMemberPasswordDto } from '../../../shared/security/reset-member-password.dto';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { SetTeacherUnitsDto } from './dto/set-teacher-units.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';
import { LEVEL_SELECT, levelView } from '../graduations/rope';
import { RolesService } from '../roles/roles.service';
import { sortRoles, STAFF_ORG_ROLES } from '../roles/staff-roles';

// Fase 3: a equipe inclui INSTRUTOR e MONITOR (cargos acumulaveis; o papel da membership e o MAIOR cargo).
const TEACHER_ROLES = STAFF_ORG_ROLES;
const TEACHER_SELECT = {
  id: true,
  role: true,
  status: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true, phone: true, photo: true, twoFactorEnabled: true } },
} as const;

/** Contrato de leitura: `photo` (de User.photo) no topo do item, além de `user.photo` (mantido). */
function withPhoto<T extends { user: { photo: string | null } }>(membership: T): T & { photo: string | null } {
  return { ...membership, photo: membership.user.photo };
}

/**
 * Não existe model Teacher próprio (PLANO_PROJETO.md §2.2): "professor" é o papel MESTRE
 * ou PROFESSOR de um OrganizationUser dentro do grupo. `id` nas rotas deste controller é o
 * id do OrganizationUser (a membership), não do User.
 */
@Injectable()
export class TeachersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly roles: RolesService,
  ) {}

  async findAll(organizationId: number, query: ListTeachersQueryDto = {}) {
    // organizationId e o filtro de papel (MESTRE/PROFESSOR) sempre no where, em findMany e count.
    const where: Prisma.OrganizationUserWhereInput = {
      organizationId,
      role: query.role ? query.role : { in: TEACHER_ROLES },
    };
    if (query.status) where.status = query.status;
    const q = query.q?.trim();
    if (q) {
      where.user = {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.organizationUser.findMany({
        where,
        select: TEACHER_SELECT,
        orderBy: { id: 'desc' },
        ...pageArgs(query),
      }),
      this.prisma.organizationUser.count({ where }),
    ]);
    // unitIds (E08): unidades de atuação de cada professor da página, numa única consulta (vazio = sem restrição).
    const unitsByUser = await this.unitIdsByUser(organizationId, rows.map((r) => r.user.id));
    const extras = await this.staffExtras(organizationId, rows.map((r) => r.user.id));
    return {
      items: rows.map((r) => ({ ...withPhoto(r), unitIds: unitsByUser.get(r.user.id) ?? [], ...extras.get(r.user.id)! })),
      total,
    };
  }

  async findOne(organizationId: number, id: number) {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { id, organizationId, role: { in: TEACHER_ROLES } },
      select: TEACHER_SELECT,
    });
    if (!membership) {
      throw new NotFoundException('Professor não encontrado.');
    }
    const unitsByUser = await this.unitIdsByUser(organizationId, [membership.user.id]);
    const extras = await this.staffExtras(organizationId, [membership.user.id]);
    return { ...withPhoto(membership), unitIds: unitsByUser.get(membership.user.id) ?? [], ...extras.get(membership.user.id)! };
  }

  /**
   * Fase 3: cargos ATIVOS (`roles`, maior primeiro; o papel legado conta enquanto o backfill nao materializa) e a
   * matricula de ALUNO da pessoa no grupo (`student: {id, status, level}` = graduacao mais recente) - staff tambem e aluno.
   */
  private async staffExtras(organizationId: number, userIds: number[]) {
    const [roles, memberships, students] = await Promise.all([
      this.roles.rolesByUser(organizationId, userIds),
      this.prisma.organizationUser.findMany({ where: { organizationId, userId: { in: userIds } }, select: { userId: true, role: true } }),
      this.prisma.student.findMany({
        where: { organizationId, userId: { in: userIds } },
        select: {
          id: true,
          userId: true,
          status: true,
          graduations: { select: { graduationLevel: { select: LEVEL_SELECT } }, orderBy: [{ graduatedAt: 'desc' }, { id: 'desc' }], take: 1 },
        },
      }),
    ]);
    const roleOf = new Map(memberships.map((m) => [m.userId, m.role]));
    const studentOf = new Map(students.map((s) => [s.userId!, s]));
    return new Map(
      userIds.map((userId) => {
        const list: StaffRole[] = [...(roles.get(userId) ?? [])];
        const legacy = roleOf.get(userId);
        if (legacy && (STAFF_ORG_ROLES as string[]).includes(legacy) && !list.includes(legacy as StaffRole)) list.unshift(legacy as StaffRole);
        const s = studentOf.get(userId);
        const level = s?.graduations[0]?.graduationLevel;
        return [userId, { roles: sortRoles(list), student: s ? { id: s.id, status: s.status, level: level ? levelView(level) : null } : null }];
      }),
    );
  }

  /** Unidades de atuação (UserUnitAccess) dos usuários, ordenadas por id, na organização informada. */
  private async unitIdsByUser(organizationId: number, userIds: number[]): Promise<Map<number, number[]>> {
    const map = new Map<number, number[]>();
    if (userIds.length === 0) return map;
    const rows = await this.prisma.userUnitAccess.findMany({
      where: { organizationId, userId: { in: userIds } },
      select: { userId: true, unitId: true },
      orderBy: { unitId: 'asc' },
    });
    for (const row of rows) map.set(row.userId, [...(map.get(row.userId) ?? []), row.unitId]);
    return map;
  }

  /** Unidades de atuação do professor (`id` = membership). Lista vazia = sem restrição (vê todas as unidades). */
  async getUnits(organizationId: number, id: number): Promise<{ unitIds: number[] }> {
    const membership = await this.findOne(organizationId, id); // 404 se não existir ou for de outro grupo
    return { unitIds: membership.unitIds };
  }

  /**
   * Substitui o conjunto de unidades de atuação do PROFESSOR (E08, só o Mestre — ver controller). Todas as unidades
   * têm de ser do mesmo grupo (400 caso contrário, o mesmo erro de unidade inexistente). Lista vazia remove a
   * restrição. O Mestre não tem escopo por unidade (vê o grupo todo), então definir unidades para ele é 400.
   * Serializado por trava da linha da membership (duas trocas concorrentes não colidem no unique userId+unitId).
   */
  async setUnits(organizationId: number, id: number, dto: SetTeacherUnitsDto): Promise<{ unitIds: number[] }> {
    const membership = await this.findOne(organizationId, id); // 404 se não existir ou for de outro grupo
    if (membership.role === OrgRole.MESTRE) {
      throw new BadRequestException('O Mestre enxerga todas as unidades do grupo; defina unidades só para professores.');
    }
    const unitIds = [...new Set(dto.unitIds)].sort((a, b) => a - b);
    if (unitIds.length > 0) {
      const found = await this.prisma.unit.count({ where: { organizationId, id: { in: unitIds } } });
      if (found !== unitIds.length) {
        throw new BadRequestException('Unidade inválida para esta organização.');
      }
    }

    const userId = membership.user.id;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "OrganizationUser" WHERE id = ${id} FOR UPDATE`;
      await tx.userUnitAccess.deleteMany({ where: { organizationId, userId } });
      if (unitIds.length > 0) {
        await tx.userUnitAccess.createMany({ data: unitIds.map((unitId) => ({ organizationId, userId, unitId })) });
      }
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.TEACHER_UNITS_UPDATE,
      entity: AuditEntity.TEACHER,
      entityId: id,
      meta: { userId, unitIds },
    });
    return { unitIds };
  }

  /** Cria o User (userType MEMBER) e a membership (OrganizationUser) juntos. */
  async create(organizationId: number, dto: CreateTeacherDto) {
    // E-mail gravado em minúsculas (como em platform-team/organizations/bootstrap): o login normaliza o que
    // é digitado, e a unicidade não pode depender da caixa.
    const email = normalizeEmail(dto.email);
    const [existing] = await findUserIdsByEmail(this.prisma, email, 1);
    if (existing !== undefined) {
      throw new BadRequestException('E-mail já cadastrado.');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const membership = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash, name: dto.name, phone: dto.phone, photo: dto.photo, status: 'ACTIVE' },
      });
      return tx.organizationUser.create({
        data: { organizationId, userId: user.id, role: dto.role, status: 'ACTIVE' },
        select: TEACHER_SELECT,
      });
    });

    await this.roles.syncFromTeacherScreen(organizationId, membership.user.id, null);
    await this.audit.record({
      organizationId,
      action: AuditAction.TEACHER_CREATE,
      entity: AuditEntity.TEACHER,
      entityId: membership.id,
      meta: { role: membership.role, userId: membership.user.id },
    });
    return withPhoto(membership);
  }

  async update(organizationId: number, id: number, dto: UpdateTeacherDto) {
    const membership = await this.findOne(organizationId, id);

    if (dto.name !== undefined || dto.phone !== undefined || dto.photo !== undefined) {
      await this.prisma.user.update({
        where: { id: membership.user.id },
        data: { name: dto.name, phone: dto.phone, photo: dto.photo },
      });
    }

    if (dto.role !== undefined || dto.status !== undefined) {
      await this.prisma.organizationUser.update({
        where: { id },
        data: { role: dto.role, status: dto.status },
      });
      if (dto.role !== undefined) await this.roles.syncFromTeacherScreen(organizationId, membership.user.id, null);
    }

    await this.audit.record({
      organizationId,
      action: dto.status === 'INACTIVE' ? AuditAction.TEACHER_INACTIVATE : AuditAction.TEACHER_UPDATE,
      entity: AuditEntity.TEACHER,
      entityId: id,
      meta: {
        fields: Object.entries(dto)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => key),
      },
    });
    return this.findOne(organizationId, id);
  }

  /**
   * O MESTRE redefine a senha de um PROFESSOR do próprio grupo (E05 mínimo): senha provisória pela mesma
   * política da senha do MESTRE, sessões do professor revogadas (tokenValidAfter) e troca obrigatória no
   * próximo login (mustChangePassword). `id` é o da membership. Recusa: MESTRE como alvo (403 — a senha de um
   * Mestre é do super admin) e conta que também pertence a outro grupo (409, ver resetMemberPassword).
   */
  async resetPassword(organizationId: number, id: number, dto: ResetMemberPasswordDto): Promise<void> {
    const membership = await this.findOne(organizationId, id); // 404 se não existir ou for de outro grupo
    await resetMemberPassword(this.prisma, {
      organizationId,
      userId: membership.user.id,
      newPassword: dto.newPassword,
      roles: [OrgRole.PROFESSOR, OrgRole.INSTRUTOR, OrgRole.MONITOR],
      notFoundMessage: 'Professor não encontrado.',
      wrongRoleMessage: 'A senha de um Mestre só pode ser redefinida pela equipe GingApp.',
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.MEMBER_PASSWORD_RESET,
      entity: AuditEntity.TEACHER,
      entityId: id,
      meta: { userId: membership.user.id, kind: 'PROFESSOR' },
    });
  }

  /** Nunca apaga o User (identidade compartilhada) nem a membership — marca status =
   * INACTIVE, mesmo padrão de "remoção" usado em Students (preserva histórico/auditoria). */
  async remove(organizationId: number, id: number) {
    await this.findOne(organizationId, id);
    const updated = await this.prisma.organizationUser.update({
      where: { id },
      data: { status: 'INACTIVE' },
      select: TEACHER_SELECT,
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.TEACHER_INACTIVATE,
      entity: AuditEntity.TEACHER,
      entityId: id,
    });
    return withPhoto(updated);
  }
}
