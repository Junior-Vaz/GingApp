import { ConflictException, Injectable } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { sortRoles } from '../roles/staff-roles';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { buildTermsStatus, LEGAL_VERSION } from '../../../shared/legal/legal-documents';
import { TermsStatus } from '../../../shared/legal/legal-types';
import { AuthResponse } from './auth-response.interface';
import { TwoFactorService } from './two-factor.service';
import { UpdateAccountProfileDto } from './dto/update-account-profile.dto';

export const TERMS_VERSION_MISMATCH_CODE = 'TERMS_VERSION_MISMATCH';
export const TERMS_VERSION_MISMATCH_MESSAGE =
  'Os Termos de Uso e a Política de Privacidade foram atualizados. Recarregue a página e leia a versão vigente.';

export const DELETION_STATUS_PENDING = 'PENDING';
/** Pedido sem decisao (a equipe pode ja ter comecado a tratar): conta como pendente para o usuario. */
const OPEN_STATUSES = ['PENDING', 'IN_PROGRESS'];

export interface DeletionRequestView {
  id: number;
  status: string;
  requestedAt: Date;
  /** true = já existia um pedido pendente (nada novo foi registrado). */
  alreadyRequested: boolean;
}

/** Perfil da própria conta (GET /auth/me): o mesmo `user` do login, mais contato e o pedido de exclusão pendente. */
export type MeResponse = AuthResponse['user'] & {
  phone: string | null;
  photo: string | null;
  /** Pedido de exclusão/anonimização pendente (LGPD), se houver. */
  pendingDeletionRequest: { id: number; requestedAt: Date } | null;
  /** 2FA TOTP ativo + quantos codigos de recuperacao ainda restam (nunca o segredo nem os hashes). */
  twoFactorEnabled: boolean;
  recoveryCodesRemaining: number;
  /** Fase 3: cargos ATIVOS (MESTRE/PROFESSOR/INSTRUTOR/MONITOR) no grupo do token, maior primeiro. */
  roles: StaffRole[];
};

/**
 * Conta do próprio usuário (E10 - LGPD): perfil/estado de aceite, aceite dos Termos + Política, pedido de
 * exclusão/anonimização. A exportação dos dados fica em AccountExportService. Qualquer usuário autenticado
 * (MEMBER ou PLATFORM) usa estas operações sobre si mesmo - nenhuma recebe id de terceiros.
 */
@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  private async activeRoles(organizationId: number, userId: number): Promise<StaffRole[]> {
    const rows = await this.prisma.personRole.findMany({ where: { organizationId, userId, revokedAt: null }, select: { role: true } });
    const roles = new Set(rows.map((r) => r.role));
    // Papel de equipe legado ainda sem cargo materializado (o backfill cria): conta como cargo.
    const membership = await this.prisma.organizationUser.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { role: true } });
    if (membership && (Object.values(StaffRole) as string[]).includes(membership.role)) roles.add(membership.role as StaffRole);
    return sortRoles(roles);
  }

  async me(actor: AuthenticatedUser): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      include: {
        dataDeletionRequests: {
          where: { status: { in: OPEN_STATUSES } },
          orderBy: { requestedAt: 'desc' },
          take: 1,
        },
      },
    });
    const organization =
      actor.organizationId != null
        ? await this.prisma.organization.findUnique({ where: { id: actor.organizationId }, select: { slug: true } })
        : null;
    const pending = user.dataDeletionRequests[0];
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      photo: user.photo,
      userType: user.userType,
      isSuperAdmin: user.isSuperAdmin,
      ...(actor.organizationId != null ? { organizationId: actor.organizationId } : {}),
      ...(organization ? { organizationSlug: organization.slug } : {}),
      ...(actor.role ? { role: actor.role } : {}),
      // Fase 3: cargos ATIVOS no grupo do token (maior primeiro); o role acima e o papel de acesso (= o maior cargo).
      roles: actor.organizationId != null ? await this.activeRoles(actor.organizationId, user.id) : [],
      mustChangePassword: user.mustChangePassword,
      ...buildTermsStatus(user),
      pendingDeletionRequest: pending ? { id: pending.id, requestedAt: pending.requestedAt } : null,
      ...TwoFactorService.status(user),
    };
  }

  /** Atualiza o perfil da PRÓPRIA conta (hoje só a foto). `photo` omitida = não mexe; null = limpa. Devolve o mesmo corpo de GET /auth/me. */
  async updateProfile(actor: AuthenticatedUser, dto: UpdateAccountProfileDto): Promise<MeResponse> {
    if (dto.photo !== undefined) {
      await this.prisma.user.update({ where: { id: actor.id }, data: { photo: dto.photo } });
    }
    return this.me(actor);
  }

  /**
   * Registra o aceite da versão VIGENTE dos textos. Versão diferente da vigente => 409 (o texto mudou
   * enquanto o usuário lia: ele precisa ler de novo). Idempotente: aceitar de novo a mesma versão não
   * regrava nada. O aceite fica no User (última versão) e numa linha de AuditLog (evidência do consentimento:
   * versão, data/hora, IP, grupo).
   */
  async acceptTerms(actor: AuthenticatedUser, version: string, ipAddress: string | undefined): Promise<TermsStatus> {
    if (version !== LEGAL_VERSION) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: TERMS_VERSION_MISMATCH_MESSAGE,
        code: TERMS_VERSION_MISMATCH_CODE,
        currentTermsVersion: LEGAL_VERSION,
      });
    }

    const current = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (current.acceptedTermsVersion === LEGAL_VERSION) return buildTermsStatus(current);

    const acceptedTermsAt = new Date();
    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: actor.id },
        data: { acceptedTermsVersion: LEGAL_VERSION, acceptedTermsAt },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: actor.organizationId ?? null,
          userId: actor.id,
          action: 'ACCEPT_TERMS',
          resource: 'legal',
          resourceId: LEGAL_VERSION,
          metadata: { version: LEGAL_VERSION, previousVersion: current.acceptedTermsVersion },
          ipAddress: ipAddress ?? null,
        },
      }),
    ]);
    return buildTermsStatus(updated);
  }

  /**
   * Pedido de exclusão/anonimização dos próprios dados (LGPD art. 18). Só REGISTRA o pedido (PENDING): nada
   * é apagado automaticamente - há histórico do grupo (frequência, financeiro) a preservar e a decisão é da
   * equipe, tomada fora da API (ver docs/EASYPANEL.md, "Pedidos de exclusão"). Idempotente: se já existe um
   * pedido pendente, devolve-o (`alreadyRequested: true`) sem duplicar.
   */
  async requestDeletion(
    actor: AuthenticatedUser,
    reason: string | undefined,
    ipAddress: string | undefined,
  ): Promise<DeletionRequestView> {
    const existing = await this.prisma.dataDeletionRequest.findFirst({
      where: { userId: actor.id, status: { in: OPEN_STATUSES } },
      orderBy: { requestedAt: 'desc' },
    });
    if (existing) {
      return { id: existing.id, status: existing.status, requestedAt: existing.requestedAt, alreadyRequested: true };
    }

    const [request] = await this.prisma.$transaction([
      this.prisma.dataDeletionRequest.create({
        data: { userId: actor.id, organizationId: actor.organizationId ?? null, reason: reason?.trim() || null },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: actor.organizationId ?? null,
          userId: actor.id,
          action: 'REQUEST_DATA_DELETION',
          resource: 'user',
          resourceId: String(actor.id),
          ipAddress: ipAddress ?? null,
        },
      }),
    ]);
    return { id: request.id, status: request.status, requestedAt: request.requestedAt, alreadyRequested: false };
  }
}
