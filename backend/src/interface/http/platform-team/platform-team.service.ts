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
import { CreatePlatformUserDto } from './dto/create-platform-user.dto';
import { ListPlatformTeamQueryDto } from './dto/list-platform-team-query.dto';
import { ResetPlatformUserPasswordDto } from './dto/reset-platform-user-password.dto';
import { UpdatePlatformUserDto } from './dto/update-platform-user.dto';
import { changesOwnPrivileges, leavesNoActiveSuperAdmin } from './platform-team.rules';

/** Mesmo custo usado no seed (prisma/seed.ts). */
const BCRYPT_ROUNDS = 10;

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
 * FORA DE ESCOPO (lacuna conhecida): 2FA (User.twoFactorSecret existe no schema, mas não há
 * fluxo de ativação/verificação) e trilha de auditoria (AuditLog) destas operações.
 */
@Injectable()
export class PlatformTeamService {
  constructor(private readonly prisma: PrismaService) {}

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

  /** E-mail é gravado em minúsculas (login compara o e-mail exatamente como digitado). */
  async create(actor: AuthenticatedUser, dto: CreatePlatformUserDto): Promise<PlatformTeamMember> {
    this.assertSuperAdmin(actor);
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Já existe um usuário com este e-mail.');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    try {
      return await this.prisma.user.create({
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
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Já existe um usuário com este e-mail.');
      }
      throw error;
    }
  }

  async update(actor: AuthenticatedUser, id: number, dto: UpdatePlatformUserDto): Promise<PlatformTeamMember> {
    this.assertSuperAdmin(actor);

    return this.prisma.$transaction(async (tx) => {
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
          ...(deactivating ? { tokenValidAfter: new Date() } : {}),
        },
        select: PUBLIC_SELECT,
      });
    });
  }

  /** tokenValidAfter = agora: o JwtStrategy recusa todo token emitido antes disso. Permitido no
   * próprio usuário (encerra a própria sessão). */
  async revokeSessions(actor: AuthenticatedUser, id: number): Promise<PlatformTeamMember> {
    this.assertSuperAdmin(actor);
    await this.findTargetOrFail(id);
    return this.prisma.user.update({
      where: { id },
      data: { tokenValidAfter: new Date() },
      select: PUBLIC_SELECT,
    });
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
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash, tokenValidAfter: new Date() },
      select: PUBLIC_SELECT,
    });
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
