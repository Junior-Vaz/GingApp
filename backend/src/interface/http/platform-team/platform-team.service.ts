import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { isActiveSuperAdmin } from '../../../shared/access/super-admin';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { BCRYPT_ROUNDS, normalizeEmail } from '../../../shared/security/password-policy';
import { findUserIdsByEmail } from '../../../shared/security/email-lookup';
import { revocationCutoff } from '../../../shared/security/token-revocation';
import { CreatePlatformUserDto } from './dto/create-platform-user.dto';
import { ListPlatformTeamQueryDto } from './dto/list-platform-team-query.dto';
import { ResetPlatformUserPasswordDto } from './dto/reset-platform-user-password.dto';
import { UpdatePlatformUserDto } from './dto/update-platform-user.dto';
import { changesOwnPrivileges, leavesNoActiveSuperAdmin } from './platform-team.rules';

/** Único formato em que um usuário da equipe sai da API: NUNCA passwordHash nem twoFactorSecret. */
const PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  isSuperAdmin: true,
  createdAt: true,
  tokenValidAfter: true,
  /** Flag do 2FA (nunca o segredo): a tela decide se oferece "Redefinir 2FA". */
  twoFactorEnabled: true,
} satisfies Prisma.UserSelect;

export type PlatformTeamMember = Prisma.UserGetPayload<{ select: typeof PUBLIC_SELECT }>;

/**
 * Gestão da equipe interna GingApp (User.userType = PLATFORM) — nunca toca nem expõe usuários
 * MEMBER (todas as queries filtram userType = PLATFORM; um :id de MEMBER dá 404).
 *
 * Regras de segurança:
 *  1. Qualquer PLATFORM pode listar; só isSuperAdmin ativo cria/altera/desativa/revoga/reseta.
 *  2. Ninguém muda o PRÓPRIO status nem o próprio isSuperAdmin (403).
 *  3. A plataforma nunca fica sem super admin ATIVO (409). Como o ator precisa ser um super admin
 *     ativo diferente do alvo, em fluxo sequencial isto só dispararia por corrida (dois super
 *     admins se rebaixando ao mesmo tempo): por isso a checagem roda numa transação que trava
 *     (SELECT ... FOR UPDATE) todos os super admins ativos antes de contar e escrever.
 *  4. Desativar um usuário também revoga as sessões dele (tokenValidAfter = agora), para que
 *     reativá-lo depois não ressuscite tokens antigos.
 *  5. A senha só existe em memória para gerar o hash bcrypt; nunca é logada nem devolvida.
 *
 * Toda escrita (criar/alterar/desativar/reativar/revogar sessões/reset de senha) grava o AuditLog (AuditService).
 * FORA DE ESCOPO (lacuna conhecida): 2FA (User.twoFactorSecret existe no schema, mas não há
 * fluxo de ativação/verificação).
 */
@Injectable()
export class PlatformTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: ListPlatformTeamQueryDto = {}): Promise<Page<PlatformTeamMember>> {
    const where: Prisma.UserWhereInput = { userType: UserType.PLATFORM };
    if (query.status) where.status = query.status;
    const q = query.q?.trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, select: PUBLIC_SELECT, orderBy: { id: 'asc' }, ...pageArgs(query) }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total };
  }

  /** E-mail é gravado em minúsculas (o login normaliza o digitado e busca sem diferenciar a caixa). */
  async create(actor: AuthenticatedUser, dto: CreatePlatformUserDto): Promise<PlatformTeamMember> {
    this.assertSuperAdmin(actor);
    const email = normalizeEmail(dto.email);

    const [existing] = await findUserIdsByEmail(this.prisma, email, 1);
    if (existing !== undefined) throw new ConflictException('Já existe um usuário com este e-mail.');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    try {
      const created = await this.prisma.user.create({
        data: {
          name: dto.name.trim(),
          email,
          phone: dto.phone?.trim() || undefined,
          passwordHash,
          userType: UserType.PLATFORM,
          isSuperAdmin: dto.isSuperAdmin ?? false,
          status: 'ACTIVE',
        },
        select: PUBLIC_SELECT,
      });
      await this.audit.record({
        organizationId: null,
        action: AuditAction.PLATFORM_USER_CREATE,
        entity: AuditEntity.PLATFORM_USER,
        entityId: created.id,
        meta: { isSuperAdmin: created.isSuperAdmin },
      });
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Já existe um usuário com este e-mail.');
      }
      throw error;
    }
  }

  async update(actor: AuthenticatedUser, id: number, dto: UpdatePlatformUserDto): Promise<PlatformTeamMember> {
    this.assertSuperAdmin(actor);

    const result = await this.prisma.$transaction(async (tx) => {
      // Trava todos os super admins ativos (ordem fixa por id => sem deadlock entre transações).
      const locked = await tx.$queryRaw<Array<{ id: number }>>(
        Prisma.sql`SELECT "id" FROM "User"
                   WHERE "userType" = 'PLATFORM' AND "isSuperAdmin" = true AND "status" = 'ACTIVE'
                   ORDER BY "id" FOR UPDATE`,
      );
      const activeSuperAdminIds = locked.map((row) => row.id);

      // O ator pode ter sido rebaixado/desativado entre o JWT e esta transação (corrida).
      if (!activeSuperAdminIds.includes(actor.id)) {
        throw new ForbiddenException('Apenas super admins ativos da plataforma podem gerir a equipe.');
      }

      const target = await tx.user.findFirst({
        where: { id, userType: UserType.PLATFORM },
        select: { id: true, status: true, isSuperAdmin: true },
      });
      if (!target) throw new NotFoundException('Usuário da equipe não encontrado.');

      const change = { status: dto.status, isSuperAdmin: dto.isSuperAdmin };
      if (target.id === actor.id && changesOwnPrivileges(target, change)) {
        throw new ForbiddenException('Você não pode alterar o seu próprio status nem o seu próprio perfil de super admin.');
      }
      if (leavesNoActiveSuperAdmin(activeSuperAdminIds, target, change)) {
        throw new ConflictException('A plataforma precisa manter ao menos um super admin ativo.');
      }

      const deactivating = dto.status === 'INACTIVE' && target.status !== 'INACTIVE';
      return tx.user.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          phone: dto.phone === undefined ? undefined : dto.phone?.trim() || null,
          status: dto.status,
          isSuperAdmin: dto.isSuperAdmin,
          ...(deactivating ? { tokenValidAfter: revocationCutoff() } : {}),
        },
        select: PUBLIC_SELECT,
      });
    });
    await this.audit.record({
      organizationId: null,
      action:
        dto.status === 'INACTIVE'
          ? AuditAction.PLATFORM_USER_DEACTIVATE
          : dto.status === 'ACTIVE'
            ? AuditAction.PLATFORM_USER_REACTIVATE
            : AuditAction.PLATFORM_USER_UPDATE,
      entity: AuditEntity.PLATFORM_USER,
      entityId: id,
      meta: {
        fields: Object.entries(dto)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => key),
        isSuperAdmin: result.isSuperAdmin,
        status: result.status,
      },
    });
    return result;
  }

  /** tokenValidAfter = agora: o JwtStrategy recusa todo token emitido antes disso. Permitido no
   * próprio usuário (encerra a própria sessão). */
  async revokeSessions(actor: AuthenticatedUser, id: number): Promise<PlatformTeamMember> {
    this.assertSuperAdmin(actor);
    await this.findTargetOrFail(id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { tokenValidAfter: revocationCutoff() },
      select: PUBLIC_SELECT,
    });
    await this.audit.record({
      organizationId: null,
      action: AuditAction.PLATFORM_USER_SESSIONS_REVOKE,
      entity: AuditEntity.PLATFORM_USER,
      entityId: id,
    });
    return updated;
  }

  /** Novo hash + revogação de sessões. Permitido no próprio usuário (um super admin pode
   * trocar a própria senha por aqui; não há outro fluxo de troca de senha no sistema). */
  async resetPassword(
    actor: AuthenticatedUser,
    id: number,
    dto: ResetPlatformUserPasswordDto,
  ): Promise<PlatformTeamMember> {
    this.assertSuperAdmin(actor);
    await this.findTargetOrFail(id);
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { passwordHash, tokenValidAfter: revocationCutoff() },
      select: PUBLIC_SELECT,
    });
    await this.audit.record({
      organizationId: null,
      action: AuditAction.PASSWORD_RESET,
      entity: AuditEntity.PLATFORM_USER,
      entityId: id,
      meta: { role: 'PLATFORM' },
    });
    return updated;
  }

  private assertSuperAdmin(actor: AuthenticatedUser): void {
    if (!isActiveSuperAdmin(actor)) {
      throw new ForbiddenException('Apenas super admins da plataforma podem gerir a equipe.');
    }
  }

  private async findTargetOrFail(id: number): Promise<void> {
    const target = await this.prisma.user.findFirst({
      where: { id, userType: UserType.PLATFORM },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Usuário da equipe não encontrado.');
  }
}
