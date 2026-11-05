import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SponsorCampaignStatus } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { Page, pageArgs, PageQueryDto } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  CreateSponsorCampaignDto,
  CreateSponsorDto,
  PlatformListSponsorCampaignsQueryDto,
  PlatformListSponsorsQueryDto,
  SponsorReasonDto,
  SponsorReportQueryDto,
  UpdateSponsorCampaignDto,
  UpdateSponsorDto,
} from './dto/sponsor.dto';
import {
  OwnerWhere,
  PLATFORM_OWNER,
  SponsorCampaignView,
  SponsorCatalogService,
  sponsorConflict,
  SponsorErrorCode,
  SponsorReport,
  sponsorValidation,
  SponsorView,
} from './sponsor-catalog.service';
import { normalizeReason, statusAfterSuspend, termsAccepted } from './sponsor-rules';
import { SPONSOR_TERMS_VERSION } from './sponsor-terms';

// Compatibilidade: estes simbolos moravam aqui na Fase 1 (o SSOT agora e sponsor-catalog.service.ts).
export { CONTENT_FIELDS, SponsorErrorCode, sponsorValidation } from './sponsor-catalog.service';
export type { SponsorCampaignView, SponsorReport, SponsorView } from './sponsor-catalog.service';

/** Linha de GET /platform-sponsor-groups (contrato do grupo secao 4). */
export interface SponsorGroupSummary {
  organizationId: number;
  name: string;
  sponsors: number;
  campaigns: number;
  /** Campanhas ACTIVE na janela e sem suspensao (iriam ao ar se o grupo nao estiver bloqueado). */
  activeNow: number;
  blocked: boolean;
  blockedAt: Date | null;
  blockedReason: string | null;
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
  /** O aceite gravado e da versao VIGENTE do termo? */
  termsCurrent: boolean;
}

/**
 * Patrocinadores e campanhas pela EQUIPE DA PLATAFORMA (docs/CONTRATO_PATROCINADORES.md 4.3/4.4) + supervisao do
 * patrocinio LOCAL dos grupos (docs/CONTRATO_PATROCINADORES_GRUPO.md secao 4). O CRUD/validacao/relatorio e o do nucleo
 * (SponsorCatalogService) com dono = PLATAFORMA; por padrao tudo continua so com organizationId nulo. Campanhas de grupo
 * sao SOMENTE LEITURA aqui (listar com ?scope=GROUP, ler, relatorio) + suspender/levantar; escrever nelas = 404.
 */
@Injectable()
export class PlatformSponsorsService {
  constructor(
    private readonly catalog: SponsorCatalogService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Filtro das listagens: padrao = so plataforma; ?scope=GROUP = grupos (todos ou o ?organizationId=). */
  private listWhere(query: { scope?: string; organizationId?: number }): OwnerWhere {
    if (query.scope === 'GROUP') return { organizationId: query.organizationId ?? { not: null } };
    if (query.organizationId !== undefined) {
      throw sponsorValidation('organizationId', 'organizationId: use junto com scope=GROUP.');
    }
    return { organizationId: null };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Patrocinadores
  // -------------------------------------------------------------------------------------------------------------

  listSponsors(query: PlatformListSponsorsQueryDto): Promise<Page<SponsorView>> {
    return this.catalog.listSponsors(this.listWhere(query), query);
  }

  /** Leitura de qualquer patrocinador (inclusive de grupo, para supervisao). */
  getSponsor(id: number): Promise<SponsorView> {
    return this.catalog.getSponsor(id, {});
  }

  createSponsor(dto: CreateSponsorDto): Promise<SponsorView> {
    return this.catalog.createSponsor(PLATFORM_OWNER, dto);
  }

  updateSponsor(id: number, dto: UpdateSponsorDto): Promise<SponsorView> {
    return this.catalog.updateSponsor(PLATFORM_OWNER, id, dto);
  }

  deleteSponsor(id: number): Promise<void> {
    return this.catalog.deleteSponsor(PLATFORM_OWNER, id);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Campanhas
  // -------------------------------------------------------------------------------------------------------------

  listCampaigns(query: PlatformListSponsorCampaignsQueryDto): Promise<Page<SponsorCampaignView>> {
    return this.catalog.listCampaigns(this.listWhere(query), query, 'PLATFORM');
  }

  /** Leitura de qualquer campanha (inclusive de grupo). */
  getCampaign(id: number): Promise<SponsorCampaignView> {
    return this.catalog.getCampaign(id, {}, 'PLATFORM');
  }

  createCampaign(dto: CreateSponsorCampaignDto): Promise<SponsorCampaignView> {
    return this.catalog.createCampaign(PLATFORM_OWNER, dto, 'PLATFORM');
  }

  updateCampaign(id: number, dto: UpdateSponsorCampaignDto): Promise<SponsorCampaignView> {
    return this.catalog.updateCampaign(PLATFORM_OWNER, id, dto, 'PLATFORM');
  }

  deleteCampaign(id: number): Promise<void> {
    return this.catalog.deleteCampaign(PLATFORM_OWNER, id);
  }

  /** SO super admin (SuperAdminGuard da rota). */
  activate(id: number, approverUserId: number): Promise<SponsorCampaignView> {
    return this.catalog.activate(PLATFORM_OWNER, id, approverUserId, 'PLATFORM');
  }

  pause(id: number): Promise<SponsorCampaignView> {
    return this.catalog.pause(PLATFORM_OWNER, id, 'PLATFORM');
  }

  resume(id: number): Promise<SponsorCampaignView> {
    return this.catalog.resume(PLATFORM_OWNER, id, 'PLATFORM');
  }

  /** Relatorio de QUALQUER campanha (plataforma ou grupo, contrato do grupo secao 4). */
  report(id: number, query: SponsorReportQueryDto): Promise<SponsorReport> {
    return this.catalog.report(id, {}, query);
  }

  reportCsv(id: number, query: SponsorReportQueryDto): Promise<{ filename: string; csv: string }> {
    return this.catalog.reportCsv(id, {}, query);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Supervisao do patrocinio LOCAL (contrato do grupo secao 4)
  // -------------------------------------------------------------------------------------------------------------

  private reason(dto: SponsorReasonDto | undefined, required: boolean): string | null {
    if (!required && (dto?.reason === undefined || dto.reason === null)) return null;
    const checked = normalizeReason(dto?.reason);
    if (!checked.ok) throw sponsorValidation('reason', checked.message);
    return checked.reason;
  }

  /**
   * Suspende uma campanha de GRUPO (qualquer PLATFORM): para de ser servida na hora (filtro platformSuspendedAt no
   * servir/impressao/clique); ACTIVE vira PAUSED para que levantar a suspensao nao a ponha no ar sozinha; o Mestre nao retoma.
   */
  async suspend(id: number, userId: number, dto: SponsorReasonDto): Promise<SponsorCampaignView> {
    const reason = this.reason(dto, true) as string;
    const current = await this.catalog.requireCampaign(id, {});
    if (current.organizationId === null) {
      throw sponsorConflict(SponsorErrorCode.NOT_GROUP_CAMPAIGN, 'Suspensão é só para campanha de grupo; campanha da plataforma usa pausar.');
    }
    if (current.platformSuspendedAt !== null) throw sponsorConflict(SponsorErrorCode.INVALID_TRANSITION, 'A campanha já está suspensa.');
    const status = statusAfterSuspend(current.status);
    await this.prisma.sponsorCampaign.update({
      where: { id },
      data: { platformSuspendedAt: new Date(), platformSuspendedByUserId: userId, platformSuspendReason: reason, status },
    });
    await this.audit.record({
      organizationId: current.organizationId,
      action: AuditAction.SPONSOR_CAMPAIGN_SUSPEND,
      entity: AuditEntity.SPONSOR_CAMPAIGN,
      entityId: id,
      meta: { previousStatus: current.status, status, reasonLength: reason.length },
    });
    return this.getCampaign(id);
  }

  /** Levanta a suspensao (SO super admin): a campanha fica no status em que esta (PAUSED/DRAFT) para o Mestre decidir. */
  async unsuspend(id: number, dto: SponsorReasonDto | undefined): Promise<SponsorCampaignView> {
    const reason = this.reason(dto, false);
    const current = await this.catalog.requireCampaign(id, {});
    if (current.organizationId === null || current.platformSuspendedAt === null) {
      throw sponsorConflict(SponsorErrorCode.INVALID_TRANSITION, 'A campanha não está suspensa.');
    }
    await this.prisma.sponsorCampaign.update({
      where: { id },
      data: { platformSuspendedAt: null, platformSuspendedByUserId: null, platformSuspendReason: null },
    });
    await this.audit.record({
      organizationId: current.organizationId,
      action: AuditAction.SPONSOR_CAMPAIGN_UNSUSPEND,
      entity: AuditEntity.SPONSOR_CAMPAIGN,
      entityId: id,
      meta: { status: current.status, ...(reason ? { reasonLength: reason.length } : {}) },
    });
    return this.getCampaign(id);
  }

  private async requireOrganization(organizationId: number) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, sponsorsBlockedAt: true },
    });
    if (!org) throw new NotFoundException('Grupo não encontrado.');
    return org;
  }

  /** Bloqueia o patrocinio local do grupo todo (SO super admin): as campanhas param de ser servidas; o Mestre nao ativa/retoma. */
  async blockGroup(organizationId: number, dto: SponsorReasonDto): Promise<SponsorGroupSummary> {
    const reason = this.reason(dto, true) as string;
    const org = await this.requireOrganization(organizationId);
    if (org.sponsorsBlockedAt !== null) throw sponsorConflict(SponsorErrorCode.INVALID_TRANSITION, 'O patrocínio deste grupo já está bloqueado.');
    await this.prisma.organization.update({ where: { id: organizationId }, data: { sponsorsBlockedAt: new Date(), sponsorsBlockedReason: reason } });
    await this.audit.record({
      organizationId,
      action: AuditAction.SPONSOR_GROUP_BLOCK,
      entity: AuditEntity.ORGANIZATION,
      entityId: organizationId,
      meta: { reasonLength: reason.length },
    });
    return this.groupSummary(organizationId);
  }

  async unblockGroup(organizationId: number, dto: SponsorReasonDto | undefined): Promise<SponsorGroupSummary> {
    const reason = this.reason(dto, false);
    const org = await this.requireOrganization(organizationId);
    if (org.sponsorsBlockedAt === null) throw sponsorConflict(SponsorErrorCode.INVALID_TRANSITION, 'O patrocínio deste grupo não está bloqueado.');
    await this.prisma.organization.update({ where: { id: organizationId }, data: { sponsorsBlockedAt: null, sponsorsBlockedReason: null } });
    await this.audit.record({
      organizationId,
      action: AuditAction.SPONSOR_GROUP_UNBLOCK,
      entity: AuditEntity.ORGANIZATION,
      entityId: organizationId,
      meta: reason ? { reasonLength: reason.length } : undefined,
    });
    return this.groupSummary(organizationId);
  }

  /** GET /platform-sponsor-groups: grupos com patrocinadores/campanhas (ou bloqueados), ?q= pelo nome; X-Total-Count. */
  async listGroups(query: PageQueryDto): Promise<Page<SponsorGroupSummary>> {
    const q = query.q?.trim();
    const where: Prisma.OrganizationWhereInput = {
      OR: [{ sponsors: { some: {} } }, { sponsorCampaigns: { some: {} } }, { sponsorsBlockedAt: { not: null } }],
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.organization.findMany({ where, select: { id: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageArgs(query) }),
      this.prisma.organization.count({ where }),
    ]);
    return { items: await this.groupSummaries(rows.map((r) => r.id)), total };
  }

  private async groupSummary(organizationId: number): Promise<SponsorGroupSummary> {
    const [one] = await this.groupSummaries([organizationId]);
    return one;
  }

  private async groupSummaries(ids: number[]): Promise<SponsorGroupSummary[]> {
    if (ids.length === 0) return [];
    const now = new Date();
    const [orgs, active] = await Promise.all([
      this.prisma.organization.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          sponsorsBlockedAt: true,
          sponsorsBlockedReason: true,
          sponsorTermsVersion: true,
          sponsorTermsAcceptedAt: true,
          _count: { select: { sponsors: true, sponsorCampaigns: true } },
        },
      }),
      this.prisma.sponsorCampaign.groupBy({
        by: ['organizationId'],
        where: {
          organizationId: { in: ids },
          status: SponsorCampaignStatus.ACTIVE,
          startsAt: { lte: now },
          endsAt: { gt: now },
          platformSuspendedAt: null,
        },
        _count: { _all: true },
      }),
    ]);
    const activeBy = new Map(active.map((a) => [a.organizationId, a._count._all]));
    const byId = new Map(orgs.map((o) => [o.id, o]));
    return ids
      .map((id) => byId.get(id))
      .filter((o): o is NonNullable<typeof o> => o !== undefined)
      .map((o) => ({
        organizationId: o.id,
        name: o.name,
        sponsors: o._count.sponsors,
        campaigns: o._count.sponsorCampaigns,
        activeNow: activeBy.get(o.id) ?? 0,
        blocked: o.sponsorsBlockedAt !== null,
        blockedAt: o.sponsorsBlockedAt,
        blockedReason: o.sponsorsBlockedReason,
        termsAcceptedAt: o.sponsorTermsAcceptedAt,
        termsVersion: o.sponsorTermsVersion,
        termsCurrent: termsAccepted(o.sponsorTermsVersion, SPONSOR_TERMS_VERSION),
      }));
  }
}
