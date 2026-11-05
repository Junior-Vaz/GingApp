import { Injectable } from '@nestjs/common';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { Page } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  AcceptSponsorTermsDto,
  CreateSponsorCampaignDto,
  CreateSponsorDto,
  ListSponsorCampaignsQueryDto,
  ListSponsorsQueryDto,
  SponsorReportQueryDto,
  UpdateSponsorCampaignDto,
  UpdateSponsorDto,
} from './dto/sponsor.dto';
import {
  groupOwner,
  ownerWhereOf,
  SponsorCampaignView,
  SponsorCatalogService,
  sponsorConflict,
  SponsorErrorCode,
  SponsorReport,
  SponsorView,
} from './sponsor-catalog.service';
import { termsAccepted } from './sponsor-rules';
import { SPONSOR_TERMS_TEXT, SPONSOR_TERMS_VERSION } from './sponsor-terms';

export interface SponsorTermsView {
  version: string;
  text: string;
  accepted: boolean;
  /** Instante do aceite da versao VIGENTE (null se nao aceitou a vigente). */
  acceptedAt: string | null;
  /** Ultima versao aceita pelo grupo (pode ser antiga). */
  acceptedVersion: string | null;
  blocked: boolean;
  blockedReason: string | null;
}

/**
 * Patrocinio LOCAL pelo MESTRE do grupo (docs/CONTRATO_PATROCINADORES_GRUPO.md secao 3). TUDO filtrado pelo organizationId
 * do token (id de outro grupo = 404 igual ao inexistente). As regras/validacoes/relatorio sao as do nucleo
 * (SponsorCatalogService) com dono = GRUPO; aqui so o termo de responsabilidade.
 */
@Injectable()
export class GroupSponsorsService {
  constructor(
    private readonly catalog: SponsorCatalogService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------------------------------------------
  // Termo
  // -------------------------------------------------------------------------------------------------------------

  async terms(organizationId: number): Promise<SponsorTermsView> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { sponsorTermsVersion: true, sponsorTermsAcceptedAt: true, sponsorsBlockedAt: true, sponsorsBlockedReason: true },
    });
    const accepted = termsAccepted(org.sponsorTermsVersion, SPONSOR_TERMS_VERSION);
    return {
      version: SPONSOR_TERMS_VERSION,
      text: SPONSOR_TERMS_TEXT,
      accepted,
      acceptedAt: accepted && org.sponsorTermsAcceptedAt ? org.sponsorTermsAcceptedAt.toISOString() : null,
      acceptedVersion: org.sponsorTermsVersion,
      blocked: org.sponsorsBlockedAt !== null,
      blockedReason: org.sponsorsBlockedReason,
    };
  }

  /**
   * Aceite do termo na versao VIGENTE (outra versao = 409 TERMS_VERSION_MISMATCH): grava versao, instante e o Mestre.
   * Aceitar de novo a mesma versao nao muda nada (fica o primeiro aceite; nao audita de novo).
   */
  async acceptTerms(organizationId: number, userId: number, dto: AcceptSponsorTermsDto): Promise<SponsorTermsView> {
    if (dto.version.trim() !== SPONSOR_TERMS_VERSION) {
      throw sponsorConflict(
        SponsorErrorCode.TERMS_VERSION_MISMATCH,
        `A versão do termo mudou (vigente: ${SPONSOR_TERMS_VERSION}). Leia o texto atual e aceite de novo.`,
      );
    }
    const current = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { sponsorTermsVersion: true } });
    if (!termsAccepted(current.sponsorTermsVersion, SPONSOR_TERMS_VERSION)) {
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { sponsorTermsVersion: SPONSOR_TERMS_VERSION, sponsorTermsAcceptedAt: new Date(), sponsorTermsAcceptedByUserId: userId },
      });
      await this.audit.record({
        organizationId,
        action: AuditAction.SPONSOR_GROUP_TERMS_ACCEPT,
        entity: AuditEntity.ORGANIZATION,
        entityId: organizationId,
        meta: { version: SPONSOR_TERMS_VERSION, previousVersion: current.sponsorTermsVersion },
      });
    }
    return this.terms(organizationId);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Patrocinadores do grupo
  // -------------------------------------------------------------------------------------------------------------

  listSponsors(organizationId: number, query: ListSponsorsQueryDto): Promise<Page<SponsorView>> {
    return this.catalog.listSponsors(ownerWhereOf(groupOwner(organizationId)), query);
  }

  getSponsor(organizationId: number, id: number): Promise<SponsorView> {
    return this.catalog.getSponsor(id, ownerWhereOf(groupOwner(organizationId)));
  }

  createSponsor(organizationId: number, dto: CreateSponsorDto): Promise<SponsorView> {
    return this.catalog.createSponsor(groupOwner(organizationId), dto);
  }

  updateSponsor(organizationId: number, id: number, dto: UpdateSponsorDto): Promise<SponsorView> {
    return this.catalog.updateSponsor(groupOwner(organizationId), id, dto);
  }

  deleteSponsor(organizationId: number, id: number): Promise<void> {
    return this.catalog.deleteSponsor(groupOwner(organizationId), id);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Campanhas do grupo
  // -------------------------------------------------------------------------------------------------------------

  listCampaigns(organizationId: number, query: ListSponsorCampaignsQueryDto): Promise<Page<SponsorCampaignView>> {
    return this.catalog.listCampaigns(ownerWhereOf(groupOwner(organizationId)), query, 'GROUP');
  }

  getCampaign(organizationId: number, id: number): Promise<SponsorCampaignView> {
    return this.catalog.getCampaign(id, ownerWhereOf(groupOwner(organizationId)), 'GROUP');
  }

  createCampaign(organizationId: number, dto: CreateSponsorCampaignDto): Promise<SponsorCampaignView> {
    return this.catalog.createCampaign(groupOwner(organizationId), dto, 'GROUP');
  }

  updateCampaign(organizationId: number, id: number, dto: UpdateSponsorCampaignDto): Promise<SponsorCampaignView> {
    return this.catalog.updateCampaign(groupOwner(organizationId), id, dto, 'GROUP');
  }

  deleteCampaign(organizationId: number, id: number): Promise<void> {
    return this.catalog.deleteCampaign(groupOwner(organizationId), id);
  }

  activate(organizationId: number, id: number, userId: number): Promise<SponsorCampaignView> {
    return this.catalog.activate(groupOwner(organizationId), id, userId, 'GROUP');
  }

  pause(organizationId: number, id: number): Promise<SponsorCampaignView> {
    return this.catalog.pause(groupOwner(organizationId), id, 'GROUP');
  }

  resume(organizationId: number, id: number): Promise<SponsorCampaignView> {
    return this.catalog.resume(groupOwner(organizationId), id, 'GROUP');
  }

  report(organizationId: number, id: number, query: SponsorReportQueryDto): Promise<SponsorReport> {
    return this.catalog.report(id, ownerWhereOf(groupOwner(organizationId)), query);
  }

  reportCsv(organizationId: number, id: number, query: SponsorReportQueryDto): Promise<{ filename: string; csv: string }> {
    return this.catalog.reportCsv(id, ownerWhereOf(groupOwner(organizationId)), query);
  }
}
