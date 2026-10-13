import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { GroupRole, StaffRole } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  defaultRankFor,
  ensureDefaultGroupRoles,
  GROUP_ROLE_NAME_MAX,
  GROUP_ROLE_NAME_MIN,
  MAX_GROUP_ROLES,
  normalizeRoleName,
  ranksForOrder,
  slugifyRoleName,
} from './group-roles';
import { recomputeAccess } from './staff-roles';

export interface GroupRoleInput {
  name?: string;
  accessRole?: StaffRole;
  rank?: number;
  color?: string | null;
  icon?: string | null;
  active?: boolean;
}

const conflict = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  new ConflictException({ statusCode: 409, error: 'Conflict', code, message, ...extra });
const badRequest = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  new BadRequestException({ statusCode: 400, error: 'Bad Request', code, message, ...extra });

/**
 * CRUD dos CARGOS DO GRUPO (docs/FICHA_UNICA.md secao 13). Leitura: equipe do grupo; escrita: so o MESTRE (guard no
 * controller). Regras: nome 2-30 sem duplicata (sem diferenciar maiusculas) no grupo; ate 20 cargos; sempre um cargo ATIVO
 * com perfil MESTRE; cargo em uso (alguem o exerce) nao e excluido nem inativado nem muda de perfil (409 -> migrar antes);
 * os 4 padrao nunca sao excluidos (so renomeados/recoloridos/reordenados/inativados se sem uso).
 */
@Injectable()
export class GroupRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Pessoas (logins distintos) que exercem cada cargo hoje. */
  private async peopleCount(organizationId: number): Promise<Map<number, number>> {
    const rows = await this.prisma.personRole.findMany({
      where: { organizationId, revokedAt: null, groupRoleId: { not: null } },
      select: { groupRoleId: true, userId: true },
      distinct: ['groupRoleId', 'userId'],
    });
    const map = new Map<number, number>();
    for (const r of rows) map.set(r.groupRoleId!, (map.get(r.groupRoleId!) ?? 0) + 1);
    return map;
  }

  private view(r: GroupRole, count: number) {
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      accessRole: r.accessRole,
      rank: r.rank,
      color: r.color,
      icon: r.icon,
      isDefault: r.isDefault,
      active: r.active,
      peopleCount: count,
      createdAt: r.createdAt,
    };
  }

  async list(organizationId: number) {
    await ensureDefaultGroupRoles(this.prisma, organizationId);
    const [rows, counts] = await Promise.all([
      this.prisma.groupRole.findMany({ where: { organizationId }, orderBy: [{ rank: 'desc' }, { id: 'asc' }] }),
      this.peopleCount(organizationId),
    ]);
    return rows.map((r) => this.view(r, counts.get(r.id) ?? 0));
  }

  private async findOwn(organizationId: number, id: number): Promise<GroupRole> {
    const row = await this.prisma.groupRole.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException({ statusCode: 404, error: 'Not Found', code: 'GROUP_ROLE_NOT_FOUND', message: 'Cargo não encontrado neste grupo.' });
    return row;
  }

  private async assertNameFree(organizationId: number, name: string, exceptId?: number) {
    const dup = await this.prisma.groupRole.findFirst({
      where: { organizationId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (dup) throw conflict('GROUP_ROLE_NAME_TAKEN', `Já existe um cargo "${name}" neste grupo.`);
  }

  private validName(raw: unknown): string {
    const name = normalizeRoleName(raw);
    if (!name) throw badRequest('INVALID_GROUP_ROLE_NAME', `O nome do cargo deve ter de ${GROUP_ROLE_NAME_MIN} a ${GROUP_ROLE_NAME_MAX} caracteres.`);
    return name;
  }

  /** Pelo menos um cargo ATIVO com perfil MESTRE deve restar (sem contar `exceptId`). */
  private async assertOtherActiveMestreRole(organizationId: number, exceptId: number) {
    const others = await this.prisma.groupRole.count({ where: { organizationId, accessRole: StaffRole.MESTRE, active: true, id: { not: exceptId } } });
    if (others === 0) throw conflict('LAST_MESTRE_ROLE', 'O grupo precisa de pelo menos um cargo ativo com perfil de acesso Mestre.');
  }

  async create(organizationId: number, input: GroupRoleInput & { name: string; accessRole: StaffRole }) {
    await ensureDefaultGroupRoles(this.prisma, organizationId);
    const name = this.validName(input.name);
    const existing = await this.prisma.groupRole.findMany({ where: { organizationId }, select: { slug: true, accessRole: true, rank: true } });
    if (existing.length >= MAX_GROUP_ROLES) throw conflict('GROUP_ROLE_LIMIT', `Um grupo pode ter até ${MAX_GROUP_ROLES} cargos.`);
    await this.assertNameFree(organizationId, name);
    const slugs = new Set(existing.map((r) => r.slug));
    const base = slugifyRoleName(name);
    let slug = base;
    for (let i = 2; slugs.has(slug); i++) slug = `${base}-${i}`;
    const row = await this.prisma.groupRole.create({
      data: {
        organizationId,
        name,
        slug,
        accessRole: input.accessRole,
        rank: input.rank ?? defaultRankFor(input.accessRole, existing),
        color: input.color ?? null,
        icon: input.icon ?? null,
        isDefault: false,
        active: input.active ?? true,
      },
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.GROUP_ROLE_CREATE,
      entity: AuditEntity.GROUP_ROLE,
      entityId: row.id,
      meta: { name: row.name, accessRole: row.accessRole, rank: row.rank },
    });
    return this.view(row, 0);
  }

  async update(organizationId: number, id: number, input: GroupRoleInput) {
    const current = await this.findOwn(organizationId, id);
    const inUse = (await this.peopleCount(organizationId)).get(id) ?? 0;
    const data: Partial<GroupRole> = {};
    if (input.name !== undefined) {
      data.name = this.validName(input.name);
      await this.assertNameFree(organizationId, data.name, id);
    }
    if (input.accessRole !== undefined && input.accessRole !== current.accessRole) {
      // Mudar o perfil mudaria o acesso de quem exerce o cargo: so sem uso (migre as pessoas antes).
      if (inUse > 0) throw conflict('GROUP_ROLE_IN_USE', `${inUse} pessoa(s) exercem este cargo: migre-as para outro cargo antes de mudar o perfil de acesso.`, { peopleCount: inUse });
      if (current.accessRole === StaffRole.MESTRE && current.active) await this.assertOtherActiveMestreRole(organizationId, id);
      data.accessRole = input.accessRole;
    }
    if (input.rank !== undefined) data.rank = input.rank;
    if (input.color !== undefined) data.color = input.color;
    if (input.icon !== undefined) data.icon = input.icon;
    if (input.active !== undefined && input.active !== current.active) {
      if (!input.active) {
        if (inUse > 0) throw conflict('GROUP_ROLE_IN_USE', `${inUse} pessoa(s) exercem este cargo: migre-as antes de inativar.`, { peopleCount: inUse });
        if ((data.accessRole ?? current.accessRole) === StaffRole.MESTRE) await this.assertOtherActiveMestreRole(organizationId, id);
      }
      data.active = input.active;
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.groupRole.update({ where: { id }, data });
      // Regras de corda guardam a copia do perfil.
      if (data.accessRole) await tx.graduationRoleRule.updateMany({ where: { groupRoleId: id }, data: { role: data.accessRole } });
      return updated;
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.GROUP_ROLE_UPDATE,
      entity: AuditEntity.GROUP_ROLE,
      entityId: id,
      meta: { name: row.name, changed: Object.keys(data) },
    });
    return this.view(row, inUse);
  }

  async remove(organizationId: number, id: number) {
    const current = await this.findOwn(organizationId, id);
    if (current.isDefault) throw conflict('DEFAULT_GROUP_ROLE', 'Os cargos padrão não podem ser excluídos: renomeie ou inative.');
    const inUse = (await this.peopleCount(organizationId)).get(id) ?? 0;
    if (inUse > 0) {
      throw conflict('GROUP_ROLE_IN_USE', `${inUse} pessoa(s) exercem este cargo: inative-o ou migre as pessoas para outro cargo antes de excluir.`, { peopleCount: inUse });
    }
    if (current.accessRole === StaffRole.MESTRE && current.active) await this.assertOtherActiveMestreRole(organizationId, id);
    // Historico (cargos revogados) fica com groupRoleId nulo e o perfil (`role`) preservado; regras/avisos saem em cascata.
    await this.prisma.groupRole.delete({ where: { id } });
    await this.audit.record({
      organizationId,
      action: AuditAction.GROUP_ROLE_DELETE,
      entity: AuditEntity.GROUP_ROLE,
      entityId: id,
      meta: { name: current.name, accessRole: current.accessRole },
    });
  }

  /** Nova ordem (o primeiro e o mais senior): `order` = TODOS os ids de cargos do grupo, sem repetir. */
  async reorder(organizationId: number, order: number[]) {
    const ids = (await this.prisma.groupRole.findMany({ where: { organizationId }, select: { id: true } })).map((r) => r.id);
    const unique = new Set(order);
    if (unique.size !== order.length || unique.size !== ids.length || ids.some((id) => !unique.has(id))) {
      throw badRequest('INVALID_ROLE_ORDER', 'Envie todos os cargos do grupo, cada um uma vez, do mais sênior para o menos sênior.');
    }
    const ranks = ranksForOrder(order);
    await this.prisma.$transaction(order.map((id) => this.prisma.groupRole.update({ where: { id }, data: { rank: ranks.get(id)! } })));
    await this.audit.record({
      organizationId,
      action: AuditAction.GROUP_ROLE_REORDER,
      entity: AuditEntity.GROUP_ROLE,
      entityId: null,
      meta: { order },
    });
    return this.list(organizationId);
  }

  /**
   * Migra quem exerce o cargo `id` para o cargo `targetId` (do mesmo grupo, ativo): o cargo antigo e revogado (historico) e
   * o novo concedido; o ACESSO de cada pessoa e recalculado (maior perfil). Nao deixa o grupo sem nenhum Mestre.
   */
  async migrate(organizationId: number, actorUserId: number, id: number, targetId: number) {
    const from = await this.findOwn(organizationId, id);
    const to = await this.findOwn(organizationId, targetId);
    if (from.id === to.id) throw badRequest('SAME_GROUP_ROLE', 'Escolha um cargo diferente.');
    if (!to.active) throw conflict('GROUP_ROLE_INACTIVE', `O cargo ${to.name} está inativo.`);
    const holders = await this.prisma.personRole.findMany({ where: { organizationId, groupRoleId: id, revokedAt: null } });
    const moved = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const users = new Set<number>();
      for (const h of holders) {
        await tx.personRole.update({ where: { id: h.id }, data: { revokedAt: now, revokedByUserId: actorUserId } });
        const has = await tx.personRole.count({ where: { organizationId, userId: h.userId, groupRoleId: to.id, revokedAt: null } });
        if (!has) {
          await tx.personRole.create({
            data: { organizationId, userId: h.userId, personId: h.personId, role: to.accessRole, groupRoleId: to.id, grantedByUserId: actorUserId, source: 'MIGRATE' },
          });
        }
        users.add(h.userId);
      }
      for (const userId of users) await recomputeAccess(tx, organizationId, userId);
      // Acesso efetivo (membership) - inclui Mestre de papel legado ainda sem cargo materializado.
      const mestres = await tx.organizationUser.count({ where: { organizationId, role: 'MESTRE', status: 'ACTIVE' } });
      if (mestres === 0) throw conflict('LAST_MESTRE', 'A migração deixaria o grupo sem nenhum Mestre.');
      return users.size;
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.GROUP_ROLE_MIGRATE,
      entity: AuditEntity.GROUP_ROLE,
      entityId: id,
      meta: { from: from.name, to: to.name, toId: to.id, people: moved },
    });
    return { moved, from: { id: from.id, name: from.name }, to: { id: to.id, name: to.name } };
  }
}
