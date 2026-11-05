import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Organization, Prisma, Sponsor, SponsorCampaign, SponsorCampaignStatus } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { buildCsv, fileDate } from '../../../shared/csv/csv';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { isUploadPath, UPLOAD_URL_PREFIX } from '../../../shared/uploads/image-ref';
import { normalizeUserText } from '../feed/feed-text';
import { platformUploadMaxBytes } from '../uploads/uploads.service';
import {
  CreateSponsorCampaignDto,
  CreateSponsorDto,
  ListSponsorCampaignsQueryDto,
  ListSponsorsQueryDto,
  SponsorReportQueryDto,
  UpdateSponsorCampaignDto,
  UpdateSponsorDto,
} from './dto/sponsor.dto';
import {
  campaignScope,
  ctrPercent,
  DEFAULT_CTA_LABEL,
  effectiveStatus,
  EffectiveStatus,
  GROUP_SPONSOR_LIMITS,
  groupCampaignFieldError,
  isIsoDay,
  looksLikeHtml,
  normalizeStates,
  SPONSOR_LIMITS,
  SponsorScope,
  termsAccepted,
  validateDestinationUrl,
  windowError,
} from './sponsor-rules';
import { SPONSOR_TERMS_VERSION } from './sponsor-terms';

/**
 * NUCLEO compartilhado dos patrocinadores (SSOT): CRUD de patrocinador/campanha, validacao (texto puro, URL 2.6, janela,
 * UFs, imagem do MESMO dono), ativar/pausar/retomar, status efetivo, relatorio JSON/CSV e auditoria. Parametrizado pelo DONO:
 *  - PLATAFORMA (organizationId nulo): docs/CONTRATO_PATROCINADORES.md 4.3/4.4 — comportamento da Fase 1, sem mudanca.
 *  - GRUPO (organizationId do token do Mestre): docs/CONTRATO_PATROCINADORES_GRUPO.md secao 3 — mesmas regras + `states`
 *    proibido, `weight` 1, limites 10/10/3, termo aceito, grupo nao bloqueado, suspensao da plataforma, imagem do proprio
 *    grupo com no maximo 250 KB e auditoria SPONSOR_GROUP_* com o organizationId do grupo.
 * Quem chama (PlatformSponsorsService / GroupSponsorsService) decide o dono e o filtro de leitura; nada aqui le o token.
 */

/** Codigos estaveis de erro (admin/painel reagem ao `code`). */
export const SponsorErrorCode = {
  VALIDATION: 'VALIDATION',
  INVALID_DESTINATION_URL: 'INVALID_DESTINATION_URL',
  SPONSOR_HAS_CAMPAIGNS: 'SPONSOR_HAS_CAMPAIGNS',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  CAMPAIGN_ENDED: 'CAMPAIGN_ENDED',
  // Fase 2 (grupo)
  SPONSOR_LIMIT: 'SPONSOR_LIMIT',
  SPONSOR_TERMS_REQUIRED: 'SPONSOR_TERMS_REQUIRED',
  TERMS_VERSION_MISMATCH: 'TERMS_VERSION_MISMATCH',
  SPONSORS_BLOCKED: 'SPONSORS_BLOCKED',
  SUSPENDED_BY_PLATFORM: 'SUSPENDED_BY_PLATFORM',
  NOT_GROUP_CAMPAIGN: 'NOT_GROUP_CAMPAIGN',
  IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
} as const;

/** 400 em portugues com o campo (contrato 4.3). */
export function sponsorValidation(field: string, message: string, code: string = SponsorErrorCode.VALIDATION): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', code, field, message });
}

export function sponsorConflict(code: string, message: string): ConflictException {
  return new ConflictException({ statusCode: 409, error: 'Conflict', code, message });
}

export function sponsorForbidden(code: string, message: string): ForbiddenException {
  return new ForbiddenException({ statusCode: 403, error: 'Forbidden', code, message });
}

/** Campos de CONTEUDO: muda-los numa campanha ACTIVE/PAUSED a volta para DRAFT (nova aprovacao, contrato secao 3). */
export const CONTENT_FIELDS = ['sponsorId', 'title', 'text', 'imageRef', 'ctaLabel', 'destinationUrl', 'category'] as const;

/** Dono das escritas. */
export type SponsorOwner = { kind: 'PLATFORM' } | { kind: 'GROUP'; organizationId: number };
export const PLATFORM_OWNER: SponsorOwner = { kind: 'PLATFORM' };
export const groupOwner = (organizationId: number): SponsorOwner => ({ kind: 'GROUP', organizationId });
const ownerOrgId = (owner: SponsorOwner): number | null => (owner.kind === 'GROUP' ? owner.organizationId : null);

/**
 * Filtro de LEITURA por dono (vale para Sponsor e SponsorCampaign): `{ organizationId: null }` = so plataforma;
 * `{ organizationId: X }` = so o grupo X; `{ organizationId: { not: null } }` = todos os grupos; `{}` = qualquer um.
 */
export interface OwnerWhere {
  organizationId?: number | null | { not: null };
}
export const ownerWhereOf = (owner: SponsorOwner): OwnerWhere => ({ organizationId: ownerOrgId(owner) });

/** Quem le a campanha: a plataforma ve quem suspendeu; o Mestre ve so que esta suspensa e o motivo. */
export type CampaignAudience = 'PLATFORM' | 'GROUP';

export interface SponsorView {
  id: number;
  organizationId: number | null;
  organization: { id: number; name: string } | null;
  name: string;
  logo: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  document: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  campaignsCount: number;
}

export interface SponsorCampaignView {
  id: number;
  scope: SponsorScope;
  organizationId: number | null;
  organization: { id: number; name: string } | null;
  sponsorId: number;
  sponsor: { id: number; name: string; logo: string | null };
  sponsorName: string;
  title: string;
  text: string;
  imageRef: string | null;
  ctaLabel: string;
  destinationUrl: string;
  destinationHost: string;
  category: SponsorCampaign['category'];
  startsAt: Date;
  endsAt: Date;
  status: SponsorCampaignStatus;
  effectiveStatus: EffectiveStatus;
  weight: number;
  states: string[];
  priceCents: number | null;
  billingNote: string | null;
  approvedByUserId: number | null;
  approvedAt: Date | null;
  approvedBy: { id: number; name: string } | null;
  platformSuspended: boolean;
  platformSuspendedAt: Date | null;
  platformSuspendReason: string | null;
  /** So na leitura da PLATAFORMA (o Mestre nao ve quem da equipe suspendeu). */
  platformSuspendedByUserId?: number | null;
  platformSuspendedBy?: { id: number; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SponsorReport {
  campaign: { id: number; title: string; sponsorName: string; startsAt: Date; endsAt: Date; status: SponsorCampaignStatus };
  totals: { impressions: number; clicks: number; ctr: number };
  byDay: Array<{ day: string; impressions: number; clicks: number }>;
  byState: Array<{ state: string; impressions: number; clicks: number }>;
}

export type CampaignRow = SponsorCampaign & {
  sponsor: Pick<Sponsor, 'id' | 'name' | 'logo'>;
  organization: Pick<Organization, 'id' | 'name'> | null;
};
const CAMPAIGN_INCLUDE = {
  sponsor: { select: { id: true, name: true, logo: true } },
  organization: { select: { id: true, name: true } },
} as const;
const SPONSOR_INCLUDE = {
  _count: { select: { campaigns: true } },
  organization: { select: { id: true, name: true } },
} as const;
type SponsorRow = Sponsor & { _count: { campaigns: number }; organization: Pick<Organization, 'id' | 'name'> | null };

/** Codigos de auditoria por dono (contrato 4.3 e contrato do grupo secao 3). */
const AUDIT_CODES = {
  PLATFORM: {
    sponsorCreate: AuditAction.SPONSOR_CREATE,
    sponsorUpdate: AuditAction.SPONSOR_UPDATE,
    sponsorDelete: AuditAction.SPONSOR_DELETE,
    campaignCreate: AuditAction.SPONSOR_CAMPAIGN_CREATE,
    campaignUpdate: AuditAction.SPONSOR_CAMPAIGN_UPDATE,
    campaignDelete: AuditAction.SPONSOR_CAMPAIGN_DELETE,
    activate: AuditAction.SPONSOR_CAMPAIGN_ACTIVATE,
    pause: AuditAction.SPONSOR_CAMPAIGN_PAUSE,
    resume: AuditAction.SPONSOR_CAMPAIGN_RESUME,
  },
  GROUP: {
    sponsorCreate: AuditAction.SPONSOR_GROUP_SPONSOR_CREATE,
    sponsorUpdate: AuditAction.SPONSOR_GROUP_SPONSOR_UPDATE,
    sponsorDelete: AuditAction.SPONSOR_GROUP_SPONSOR_DELETE,
    campaignCreate: AuditAction.SPONSOR_GROUP_CAMPAIGN_CREATE,
    campaignUpdate: AuditAction.SPONSOR_GROUP_CAMPAIGN_UPDATE,
    campaignDelete: AuditAction.SPONSOR_GROUP_CAMPAIGN_DELETE,
    activate: AuditAction.SPONSOR_GROUP_CAMPAIGN_ACTIVATE,
    pause: AuditAction.SPONSOR_GROUP_CAMPAIGN_PAUSE,
    resume: AuditAction.SPONSOR_GROUP_CAMPAIGN_RESUME,
  },
} as const;

interface TextRule {
  min?: number;
  max: number;
  multiline?: boolean;
}

/**
 * Texto PURO normalizado (normalizeUserText do feed) e sem HTML. Vazio: `null` (o chamador decide se e obrigatorio).
 * Tamanho conferido DEPOIS de normalizar.
 */
function cleanText(field: string, value: string | null | undefined, rule: TextRule): string | null {
  const text = normalizeUserText(value ?? null, rule.multiline ?? false);
  if (text === null) return null;
  if (looksLikeHtml(text)) throw sponsorValidation(field, `${field}: use texto puro, sem HTML.`);
  if (rule.min !== undefined && text.length < rule.min) {
    throw sponsorValidation(field, `${field}: mínimo de ${rule.min} caracteres.`);
  }
  if (text.length > rule.max) throw sponsorValidation(field, `${field}: no máximo ${rule.max} caracteres.`);
  return text;
}

function requiredText(field: string, value: string | null | undefined, rule: TextRule): string {
  const text = cleanText(field, value, rule);
  if (text === null) throw sponsorValidation(field, `${field}: campo obrigatório.`);
  return text;
}

function parseInstant(field: string, value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw sponsorValidation(field, `${field}: data/hora inválida.`);
  return d;
}

function groupFields(input: { states?: unknown; weight?: unknown }): void {
  const error = groupCampaignFieldError(input);
  if (error) throw sponsorValidation(error.field, error.message);
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class SponsorCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------------------------------------------
  // Transacao por dono: no GRUPO trava a linha do grupo (limites 10/10/3 sem corrida); na plataforma, sem trava.
  // -------------------------------------------------------------------------------------------------------------

  private async inOwnerTx<T>(owner: SponsorOwner, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      if (owner.kind === 'GROUP') {
        await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${owner.organizationId} FOR UPDATE`;
      }
      return fn(tx);
    });
  }

  private async recordAudit(owner: SponsorOwner, action: string, entity: string, entityId: number, meta?: Record<string, unknown>): Promise<void> {
    await this.audit.record({ organizationId: ownerOrgId(owner), action, entity, entityId, ...(meta ? { meta } : {}) });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Imagens: so upload do MESMO dono
  // -------------------------------------------------------------------------------------------------------------

  /**
   * Plataforma: so upload de PLATAFORMA (organizationId nulo, POST /platform-uploads). Grupo: so upload do PROPRIO grupo
   * (Upload.organizationId == grupo; plataforma/outro grupo = 400) e com no maximo 250 KB (PLATFORM_UPLOAD_MAX_KB, o mesmo
   * teto do upload de plataforma): acima = 400 IMAGE_TOO_LARGE (o POST /group-sponsor-uploads ja reprocessa ate caber).
   */
  async ownerImage(owner: SponsorOwner, field: 'logo' | 'imageRef', value: string | null | undefined): Promise<string | null | undefined> {
    if (value === undefined || value === null) return value;
    if (owner.kind === 'PLATFORM') {
      if (!isUploadPath(value)) {
        throw sponsorValidation(field, `${field}: envie a imagem por POST /platform-uploads e use o caminho devolvido (/api/uploads/...).`);
      }
      const row = await this.prisma.upload.findUnique({
        where: { filename: value.slice(UPLOAD_URL_PREFIX.length) },
        select: { organizationId: true },
      });
      if (!row || row.organizationId !== null) {
        throw sponsorValidation(field, `${field}: a imagem precisa ter sido enviada pela equipe da plataforma (POST /platform-uploads).`);
      }
      return value;
    }
    if (!isUploadPath(value)) {
      throw sponsorValidation(field, `${field}: envie a imagem pelo upload do grupo (POST /group-sponsor-uploads) e use o caminho devolvido (/api/uploads/...).`);
    }
    const row = await this.prisma.upload.findUnique({
      where: { filename: value.slice(UPLOAD_URL_PREFIX.length) },
      select: { organizationId: true, sizeBytes: true },
    });
    if (!row || row.organizationId !== owner.organizationId) {
      throw sponsorValidation(field, `${field}: a imagem precisa ter sido enviada pelo próprio grupo.`);
    }
    const max = platformUploadMaxBytes();
    if (row.sizeBytes > max) {
      const kb = Math.floor(max / 1024);
      throw sponsorValidation(
        field,
        `${field}: a imagem tem mais de ${kb} KB. Envie por POST /group-sponsor-uploads (otimiza até ${kb} KB) ou use uma imagem menor.`,
        SponsorErrorCode.IMAGE_TOO_LARGE,
      );
    }
    return value;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Patrocinadores
  // -------------------------------------------------------------------------------------------------------------

  private sponsorView(row: SponsorRow): SponsorView {
    const { _count, ...rest } = row;
    return { ...rest, campaignsCount: _count.campaigns };
  }

  private async sponsorData(owner: SponsorOwner, dto: CreateSponsorDto | UpdateSponsorDto, creating: boolean): Promise<Prisma.SponsorUncheckedUpdateInput> {
    const data: Prisma.SponsorUncheckedUpdateInput = {};
    if (creating || dto.name !== undefined) {
      data.name = requiredText('name', dto.name, { min: SPONSOR_LIMITS.nameMin, max: SPONSOR_LIMITS.nameMax });
    }
    if (dto.logo !== undefined) data.logo = await this.ownerImage(owner, 'logo', dto.logo);
    if (dto.contactName !== undefined) data.contactName = cleanText('contactName', dto.contactName, { max: SPONSOR_LIMITS.contactNameMax });
    if (dto.contactEmail !== undefined) data.contactEmail = dto.contactEmail === null ? null : dto.contactEmail.trim().toLowerCase();
    if (dto.contactPhone !== undefined) data.contactPhone = cleanText('contactPhone', dto.contactPhone, { max: SPONSOR_LIMITS.contactPhoneMax });
    if (dto.document !== undefined) data.document = cleanText('document', dto.document, { max: SPONSOR_LIMITS.documentMax });
    if (dto.notes !== undefined) data.notes = cleanText('notes', dto.notes, { max: SPONSOR_LIMITS.notesMax, multiline: true });
    return data;
  }

  async listSponsors(scopeWhere: OwnerWhere, query: ListSponsorsQueryDto): Promise<Page<SponsorView>> {
    const q = query.q?.trim();
    const where: Prisma.SponsorWhereInput = { ...scopeWhere, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.sponsor.findMany({
        where,
        include: SPONSOR_INCLUDE,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.sponsor.count({ where }),
    ]);
    return { items: rows.map((r) => this.sponsorView(r)), total };
  }

  async getSponsor(id: number, scopeWhere: OwnerWhere): Promise<SponsorView> {
    const row = await this.prisma.sponsor.findFirst({ where: { id, ...scopeWhere }, include: SPONSOR_INCLUDE });
    if (!row) throw new NotFoundException('Patrocinador não encontrado.');
    return this.sponsorView(row);
  }

  async createSponsor(owner: SponsorOwner, dto: CreateSponsorDto): Promise<SponsorView> {
    const data = await this.sponsorData(owner, dto, true);
    const row = await this.inOwnerTx(owner, async (tx) => {
      if (owner.kind === 'GROUP') {
        const count = await tx.sponsor.count({ where: { organizationId: owner.organizationId } });
        if (count >= GROUP_SPONSOR_LIMITS.sponsors) {
          throw sponsorConflict(SponsorErrorCode.SPONSOR_LIMIT, `O grupo pode ter no máximo ${GROUP_SPONSOR_LIMITS.sponsors} patrocinadores.`);
        }
      }
      return tx.sponsor.create({
        data: { ...(data as Prisma.SponsorUncheckedCreateInput), organizationId: ownerOrgId(owner) },
        include: SPONSOR_INCLUDE,
      });
    });
    await this.recordAudit(owner, AUDIT_CODES[owner.kind].sponsorCreate, AuditEntity.SPONSOR, row.id, { fields: Object.keys(data).sort() });
    return this.sponsorView(row);
  }

  async updateSponsor(owner: SponsorOwner, id: number, dto: UpdateSponsorDto): Promise<SponsorView> {
    const current = await this.prisma.sponsor.findFirst({ where: { id, ...ownerWhereOf(owner) } });
    if (!current) throw new NotFoundException('Patrocinador não encontrado.');
    const data = await this.sponsorData(owner, dto, false);
    const changed = Object.keys(data).filter((k) => (current as Record<string, unknown>)[k] !== (data as Record<string, unknown>)[k]);
    const row = await this.prisma.sponsor.update({ where: { id }, data, include: SPONSOR_INCLUDE });
    if (changed.length > 0) {
      await this.recordAudit(owner, AUDIT_CODES[owner.kind].sponsorUpdate, AuditEntity.SPONSOR, id, { fields: changed.sort() });
    }
    return this.sponsorView(row);
  }

  async deleteSponsor(owner: SponsorOwner, id: number): Promise<void> {
    const row = await this.prisma.sponsor.findFirst({ where: { id, ...ownerWhereOf(owner) }, include: { _count: { select: { campaigns: true } } } });
    if (!row) throw new NotFoundException('Patrocinador não encontrado.');
    if (row._count.campaigns > 0) {
      throw sponsorConflict(
        SponsorErrorCode.SPONSOR_HAS_CAMPAIGNS,
        `Este patrocinador tem ${row._count.campaigns} campanha(s). Exclua as campanhas antes de excluir o patrocinador.`,
      );
    }
    try {
      await this.prisma.sponsor.delete({ where: { id } });
    } catch (error) {
      // Corrida: uma campanha foi criada entre a contagem e o DELETE (FK Restrict).
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2003' || error.code === 'P2014')) {
        throw sponsorConflict(SponsorErrorCode.SPONSOR_HAS_CAMPAIGNS, 'Este patrocinador tem campanhas. Exclua as campanhas antes.');
      }
      throw error;
    }
    await this.recordAudit(owner, AUDIT_CODES[owner.kind].sponsorDelete, AuditEntity.SPONSOR, id);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Campanhas: leitura
  // -------------------------------------------------------------------------------------------------------------

  private async userNames(ids: Array<number | null>): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter((v): v is number => v !== null))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private namesFor(rows: CampaignRow[], audience: CampaignAudience): Promise<Map<number, string>> {
    return this.userNames(rows.flatMap((r) => (audience === 'PLATFORM' ? [r.approvedByUserId, r.platformSuspendedByUserId] : [r.approvedByUserId])));
  }

  campaignView(row: CampaignRow, names: Map<number, string>, now: Date, audience: CampaignAudience): SponsorCampaignView {
    const { sponsor, organization, ...c } = row;
    const approverName = c.approvedByUserId !== null ? names.get(c.approvedByUserId) : undefined;
    const view: SponsorCampaignView = {
      id: c.id,
      scope: campaignScope(c.organizationId),
      organizationId: c.organizationId,
      organization: organization ? { id: organization.id, name: organization.name } : null,
      sponsorId: c.sponsorId,
      sponsor: { id: sponsor.id, name: sponsor.name, logo: sponsor.logo },
      sponsorName: sponsor.name,
      title: c.title,
      text: c.text,
      imageRef: c.imageRef,
      ctaLabel: c.ctaLabel,
      destinationUrl: c.destinationUrl,
      destinationHost: c.destinationHost,
      category: c.category,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      status: c.status,
      effectiveStatus: effectiveStatus(c, now),
      weight: c.weight,
      states: c.states ?? [],
      priceCents: c.priceCents,
      billingNote: c.billingNote,
      approvedByUserId: c.approvedByUserId,
      approvedAt: c.approvedAt,
      approvedBy: c.approvedByUserId !== null && approverName !== undefined ? { id: c.approvedByUserId, name: approverName } : null,
      platformSuspended: c.platformSuspendedAt !== null,
      platformSuspendedAt: c.platformSuspendedAt,
      platformSuspendReason: c.platformSuspendReason,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
    if (audience === 'PLATFORM') {
      const by = c.platformSuspendedByUserId;
      const byName = by !== null ? names.get(by) : undefined;
      view.platformSuspendedByUserId = by;
      view.platformSuspendedBy = by !== null && byName !== undefined ? { id: by, name: byName } : null;
    }
    return view;
  }

  async viewOne(row: CampaignRow, audience: CampaignAudience): Promise<SponsorCampaignView> {
    return this.campaignView(row, await this.namesFor([row], audience), new Date(), audience);
  }

  async requireCampaign(id: number, scopeWhere: OwnerWhere): Promise<CampaignRow> {
    const row = await this.prisma.sponsorCampaign.findFirst({ where: { id, ...scopeWhere }, include: CAMPAIGN_INCLUDE });
    if (!row) throw new NotFoundException('Campanha não encontrada.');
    return row;
  }

  /** Filtro do status EFETIVO (mesma regra de effectiveStatus) em SQL. */
  private effectiveWhere(effective: EffectiveStatus, now: Date): Prisma.SponsorCampaignWhereInput {
    switch (effective) {
      case 'ENDED':
        return { endsAt: { lte: now } };
      case 'DRAFT':
        return { status: SponsorCampaignStatus.DRAFT, endsAt: { gt: now } };
      case 'PAUSED':
        return { status: SponsorCampaignStatus.PAUSED, endsAt: { gt: now } };
      case 'SCHEDULED':
        return { status: SponsorCampaignStatus.ACTIVE, startsAt: { gt: now }, endsAt: { gt: now } };
      case 'ACTIVE_NOW':
        return { status: SponsorCampaignStatus.ACTIVE, startsAt: { lte: now }, endsAt: { gt: now } };
    }
  }

  async listCampaigns(scopeWhere: OwnerWhere, query: ListSponsorCampaignsQueryDto, audience: CampaignAudience): Promise<Page<SponsorCampaignView>> {
    const now = new Date();
    const q = query.q?.trim();
    const and: Prisma.SponsorCampaignWhereInput[] = [scopeWhere];
    if (query.status) and.push({ status: query.status });
    if (query.sponsorId) and.push({ sponsorId: query.sponsorId });
    if (query.effective) and.push(this.effectiveWhere(query.effective, now));
    if (q) {
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { sponsor: { name: { contains: q, mode: 'insensitive' } } },
          { destinationHost: { contains: q.toLowerCase() } },
        ],
      });
    }
    const where: Prisma.SponsorCampaignWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.sponsorCampaign.findMany({ where, include: CAMPAIGN_INCLUDE, orderBy: { id: 'desc' }, ...pageArgs(query) }),
      this.prisma.sponsorCampaign.count({ where }),
    ]);
    const names = await this.namesFor(rows, audience);
    return { items: rows.map((r) => this.campaignView(r, names, now, audience)), total };
  }

  async getCampaign(id: number, scopeWhere: OwnerWhere, audience: CampaignAudience): Promise<SponsorCampaignView> {
    return this.viewOne(await this.requireCampaign(id, scopeWhere), audience);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Campanhas: escrita
  // -------------------------------------------------------------------------------------------------------------

  /** Patrocinador do MESMO dono (outro dono = "nao encontrado": nao revela que existe). Garante a invariante de organizationId. */
  private async requireSponsorId(owner: SponsorOwner, sponsorId: number): Promise<void> {
    const exists = await this.prisma.sponsor.findFirst({ where: { id: sponsorId, ...ownerWhereOf(owner) }, select: { id: true } });
    if (!exists) throw sponsorValidation('sponsorId', 'sponsorId: patrocinador não encontrado.');
  }

  private destination(value: string): { destinationUrl: string; destinationHost: string } {
    const checked = validateDestinationUrl(value);
    if (!checked.ok) throw sponsorValidation('destinationUrl', checked.message, SponsorErrorCode.INVALID_DESTINATION_URL);
    return { destinationUrl: checked.url, destinationHost: checked.host };
  }

  private states(value: string[]): string[] {
    const checked = normalizeStates(value);
    if (!checked.ok) throw sponsorValidation('states', checked.message);
    return checked.states;
  }

  private assertWindow(startsAt: Date, endsAt: Date): void {
    const error = windowError(startsAt, endsAt);
    if (error) throw sponsorValidation(error.startsWith('startsAt') ? 'startsAt' : 'endsAt', error);
  }

  async createCampaign(owner: SponsorOwner, dto: CreateSponsorCampaignDto, audience: CampaignAudience): Promise<SponsorCampaignView> {
    if (owner.kind === 'GROUP') groupFields(dto);
    await this.requireSponsorId(owner, dto.sponsorId);
    const startsAt = parseInstant('startsAt', dto.startsAt);
    const endsAt = parseInstant('endsAt', dto.endsAt);
    this.assertWindow(startsAt, endsAt);
    const data: Prisma.SponsorCampaignUncheckedCreateInput = {
      organizationId: ownerOrgId(owner),
      sponsorId: dto.sponsorId,
      title: requiredText('title', dto.title, { min: SPONSOR_LIMITS.titleMin, max: SPONSOR_LIMITS.titleMax }),
      text: requiredText('text', dto.text, { min: SPONSOR_LIMITS.textMin, max: SPONSOR_LIMITS.textMax }),
      imageRef: (await this.ownerImage(owner, 'imageRef', dto.imageRef)) ?? null,
      ctaLabel: cleanText('ctaLabel', dto.ctaLabel, { min: SPONSOR_LIMITS.ctaMin, max: SPONSOR_LIMITS.ctaMax }) ?? DEFAULT_CTA_LABEL,
      ...this.destination(dto.destinationUrl),
      category: dto.category,
      startsAt,
      endsAt,
      status: SponsorCampaignStatus.DRAFT,
      weight: owner.kind === 'GROUP' ? 1 : (dto.weight ?? 1),
      states: owner.kind === 'GROUP' ? [] : this.states(dto.states ?? []),
      priceCents: dto.priceCents ?? null,
      billingNote: cleanText('billingNote', dto.billingNote, { max: SPONSOR_LIMITS.billingNoteMax, multiline: true }),
    };
    const row = await this.inOwnerTx(owner, async (tx) => {
      if (owner.kind === 'GROUP') {
        const count = await tx.sponsorCampaign.count({ where: { organizationId: owner.organizationId } });
        if (count >= GROUP_SPONSOR_LIMITS.campaigns) {
          throw sponsorConflict(SponsorErrorCode.SPONSOR_LIMIT, `O grupo pode ter no máximo ${GROUP_SPONSOR_LIMITS.campaigns} campanhas (exclua as antigas).`);
        }
      }
      return tx.sponsorCampaign.create({ data, include: CAMPAIGN_INCLUDE });
    });
    await this.recordAudit(owner, AUDIT_CODES[owner.kind].campaignCreate, AuditEntity.SPONSOR_CAMPAIGN, row.id, {
      sponsorId: row.sponsorId,
      status: row.status,
      category: row.category,
      statesCount: row.states.length,
    });
    return this.viewOne(row, audience);
  }

  async updateCampaign(owner: SponsorOwner, id: number, dto: UpdateSponsorCampaignDto, audience: CampaignAudience): Promise<SponsorCampaignView> {
    const current = await this.requireCampaign(id, ownerWhereOf(owner));
    if (owner.kind === 'GROUP') groupFields(dto);
    const data: Prisma.SponsorCampaignUncheckedUpdateInput = {};
    if (dto.sponsorId !== undefined) {
      await this.requireSponsorId(owner, dto.sponsorId);
      data.sponsorId = dto.sponsorId;
    }
    if (dto.title !== undefined) data.title = requiredText('title', dto.title, { min: SPONSOR_LIMITS.titleMin, max: SPONSOR_LIMITS.titleMax });
    if (dto.text !== undefined) data.text = requiredText('text', dto.text, { min: SPONSOR_LIMITS.textMin, max: SPONSOR_LIMITS.textMax });
    if (dto.imageRef !== undefined) data.imageRef = await this.ownerImage(owner, 'imageRef', dto.imageRef);
    if (dto.ctaLabel !== undefined) {
      data.ctaLabel = cleanText('ctaLabel', dto.ctaLabel, { min: SPONSOR_LIMITS.ctaMin, max: SPONSOR_LIMITS.ctaMax }) ?? DEFAULT_CTA_LABEL;
    }
    if (dto.destinationUrl !== undefined) Object.assign(data, this.destination(dto.destinationUrl));
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.startsAt !== undefined || dto.endsAt !== undefined) {
      const startsAt = dto.startsAt !== undefined ? parseInstant('startsAt', dto.startsAt) : current.startsAt;
      const endsAt = dto.endsAt !== undefined ? parseInstant('endsAt', dto.endsAt) : current.endsAt;
      this.assertWindow(startsAt, endsAt);
      data.startsAt = startsAt;
      data.endsAt = endsAt;
    }
    // Grupo: weight/states so podem vir como 1 / [] (groupFields acima); nada a gravar.
    if (owner.kind === 'PLATFORM') {
      if (dto.weight !== undefined) data.weight = dto.weight;
      if (dto.states !== undefined) data.states = this.states(dto.states);
    }
    if (dto.priceCents !== undefined) data.priceCents = dto.priceCents;
    if (dto.billingNote !== undefined) {
      data.billingNote = cleanText('billingNote', dto.billingNote, { max: SPONSOR_LIMITS.billingNoteMax, multiline: true });
    }

    const same = (a: unknown, b: unknown) =>
      a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : JSON.stringify(a) === JSON.stringify(b);
    const changed = Object.keys(data).filter(
      (k) => !same((current as unknown as Record<string, unknown>)[k], (data as Record<string, unknown>)[k]),
    );
    const contentChanged = changed.some((k) => (CONTENT_FIELDS as readonly string[]).includes(k));
    const backToDraft = contentChanged && current.status !== SponsorCampaignStatus.DRAFT;
    if (backToDraft) {
      data.status = SponsorCampaignStatus.DRAFT;
      data.approvedByUserId = null;
      data.approvedAt = null;
    }
    if (changed.length === 0) return this.viewOne(current, audience);

    const row = await this.prisma.sponsorCampaign.update({ where: { id }, data, include: CAMPAIGN_INCLUDE });
    await this.recordAudit(owner, AUDIT_CODES[owner.kind].campaignUpdate, AuditEntity.SPONSOR_CAMPAIGN, id, {
      fields: changed.sort(),
      previousStatus: current.status,
      status: row.status,
      backToDraft,
    });
    return this.viewOne(row, audience);
  }

  async deleteCampaign(owner: SponsorOwner, id: number): Promise<void> {
    const current = await this.requireCampaign(id, ownerWhereOf(owner));
    const statDays = await this.prisma.sponsorStatDay.count({ where: { campaignId: id } });
    // SponsorStatDay vai junto (FK onDelete Cascade).
    await this.prisma.sponsorCampaign.delete({ where: { id } });
    await this.recordAudit(owner, AUDIT_CODES[owner.kind].campaignDelete, AuditEntity.SPONSOR_CAMPAIGN, id, {
      sponsorId: current.sponsorId,
      status: current.status,
      statDays,
    });
  }

  /** Grupo: suspensa pela plataforma = 403 (o Mestre nao ativa nem retoma). */
  private assertNotSuspended(current: CampaignRow): void {
    if (current.platformSuspendedAt !== null) {
      throw sponsorForbidden(
        SponsorErrorCode.SUSPENDED_BY_PLATFORM,
        'Esta campanha foi suspensa pela equipe do GingApp e não pode ser ativada nem retomada pelo grupo.',
      );
    }
  }

  /** Grupo: bloqueio do patrocinio local = 403; `terms` = exige o termo na versao vigente (so para ATIVAR). */
  private async assertGroupMayAir(organizationId: number, terms: boolean): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { sponsorsBlockedAt: true, sponsorTermsVersion: true },
    });
    if (terms && !termsAccepted(org?.sponsorTermsVersion, SPONSOR_TERMS_VERSION)) {
      throw sponsorForbidden(
        SponsorErrorCode.SPONSOR_TERMS_REQUIRED,
        'Leia e aceite o termo de responsabilidade dos patrocinadores (versão atual) antes de ativar campanhas.',
      );
    }
    if (!org || org.sponsorsBlockedAt !== null) {
      throw sponsorForbidden(SponsorErrorCode.SPONSORS_BLOCKED, 'O patrocínio local deste grupo está bloqueado pela equipe do GingApp.');
    }
  }

  /** Grupo: no maximo 3 campanhas ACTIVE (nao encerradas) ao mesmo tempo, contando DENTRO da transacao travada. */
  private async assertActiveRoom(tx: Tx, organizationId: number, exceptId: number, now: Date): Promise<void> {
    const active = await tx.sponsorCampaign.count({
      where: { organizationId, status: SponsorCampaignStatus.ACTIVE, endsAt: { gt: now }, id: { not: exceptId } },
    });
    if (active >= GROUP_SPONSOR_LIMITS.activeCampaigns) {
      throw sponsorConflict(
        SponsorErrorCode.SPONSOR_LIMIT,
        `O grupo pode ter no máximo ${GROUP_SPONSOR_LIMITS.activeCampaigns} campanhas ativas ao mesmo tempo. Pause uma antes.`,
      );
    }
  }

  /**
   * Ativar: revalida TUDO o que esta gravado (textos, URL 2.6, categoria, janela, peso, UFs, imagem do dono), recusa campanha
   * ja encerrada e grava QUEM aprovou e QUANDO. Plataforma: so super admin (SuperAdminGuard da rota). Grupo: o Mestre, com
   * termo vigente aceito, grupo nao bloqueado, campanha nao suspensa e no maximo 3 ativas.
   */
  async activate(owner: SponsorOwner, id: number, approverUserId: number, audience: CampaignAudience): Promise<SponsorCampaignView> {
    const current = await this.requireCampaign(id, ownerWhereOf(owner));
    if (owner.kind === 'GROUP') {
      this.assertNotSuspended(current);
      await this.assertGroupMayAir(owner.organizationId, true);
    }
    if (current.status === SponsorCampaignStatus.ACTIVE) {
      throw sponsorConflict(SponsorErrorCode.INVALID_TRANSITION, 'A campanha já está ativa.');
    }
    const now = new Date();
    requiredText('title', current.title, { min: SPONSOR_LIMITS.titleMin, max: SPONSOR_LIMITS.titleMax });
    requiredText('text', current.text, { min: SPONSOR_LIMITS.textMin, max: SPONSOR_LIMITS.textMax });
    requiredText('ctaLabel', current.ctaLabel, { min: SPONSOR_LIMITS.ctaMin, max: SPONSOR_LIMITS.ctaMax });
    const destination = this.destination(current.destinationUrl);
    if (destination.destinationUrl !== current.destinationUrl) {
      throw sponsorValidation('destinationUrl', 'destinationUrl: endereço gravado fora do padrão; edite e salve de novo.', SponsorErrorCode.INVALID_DESTINATION_URL);
    }
    this.assertWindow(current.startsAt, current.endsAt);
    if (current.endsAt.getTime() <= now.getTime()) {
      throw sponsorValidation('endsAt', 'endsAt: a campanha já terminou; ajuste as datas antes de ativar.', SponsorErrorCode.CAMPAIGN_ENDED);
    }
    if (!Number.isInteger(current.weight) || current.weight < SPONSOR_LIMITS.weightMin || current.weight > SPONSOR_LIMITS.weightMax) {
      throw sponsorValidation('weight', `weight: peso inteiro de ${SPONSOR_LIMITS.weightMin} a ${SPONSOR_LIMITS.weightMax}.`);
    }
    this.states(current.states ?? []);
    if (owner.kind === 'GROUP') groupFields({ states: current.states ?? [], weight: current.weight });
    await this.ownerImage(owner, 'imageRef', current.imageRef);

    const row = await this.inOwnerTx(owner, async (tx) => {
      if (owner.kind === 'GROUP') await this.assertActiveRoom(tx, owner.organizationId, id, now);
      return tx.sponsorCampaign.update({
        where: { id },
        data: { status: SponsorCampaignStatus.ACTIVE, approvedByUserId: approverUserId, approvedAt: now },
        include: CAMPAIGN_INCLUDE,
      });
    });
    await this.recordAudit(owner, AUDIT_CODES[owner.kind].activate, AuditEntity.SPONSOR_CAMPAIGN, id, {
      previousStatus: current.status,
      status: row.status,
    });
    return this.viewOne(row, audience);
  }

  async pause(owner: SponsorOwner, id: number, audience: CampaignAudience): Promise<SponsorCampaignView> {
    const current = await this.requireCampaign(id, ownerWhereOf(owner));
    if (current.status !== SponsorCampaignStatus.ACTIVE) {
      throw sponsorConflict(SponsorErrorCode.INVALID_TRANSITION, 'Só uma campanha ativa pode ser pausada.');
    }
    const row = await this.prisma.sponsorCampaign.update({
      where: { id },
      data: { status: SponsorCampaignStatus.PAUSED },
      include: CAMPAIGN_INCLUDE,
    });
    await this.recordAudit(owner, AUDIT_CODES[owner.kind].pause, AuditEntity.SPONSOR_CAMPAIGN, id, {
      previousStatus: current.status,
      status: row.status,
    });
    return this.viewOne(row, audience);
  }

  /**
   * PAUSED -> ACTIVE mantendo a aprovacao (conteudo nao mudou: mudar conteudo leva a DRAFT, que exige nova ativacao).
   * Grupo: suspensa pela plataforma = 403 SUSPENDED_BY_PLATFORM; grupo bloqueado = 403 SPONSORS_BLOCKED; limite de 3 ativas.
   */
  async resume(owner: SponsorOwner, id: number, audience: CampaignAudience): Promise<SponsorCampaignView> {
    const current = await this.requireCampaign(id, ownerWhereOf(owner));
    if (owner.kind === 'GROUP') this.assertNotSuspended(current);
    if (current.status !== SponsorCampaignStatus.PAUSED || current.approvedAt === null) {
      throw sponsorConflict(
        SponsorErrorCode.INVALID_TRANSITION,
        current.status === SponsorCampaignStatus.DRAFT
          ? owner.kind === 'GROUP'
            ? 'Campanha em rascunho precisa ser ativada de novo (nova aprovação).'
            : 'Campanha em rascunho precisa ser ativada por um super admin (nova aprovação).'
          : 'Só uma campanha pausada pode ser retomada.',
      );
    }
    if (owner.kind === 'GROUP') await this.assertGroupMayAir(owner.organizationId, false);
    const now = new Date();
    const row = await this.inOwnerTx(owner, async (tx) => {
      if (owner.kind === 'GROUP') await this.assertActiveRoom(tx, owner.organizationId, id, now);
      return tx.sponsorCampaign.update({ where: { id }, data: { status: SponsorCampaignStatus.ACTIVE }, include: CAMPAIGN_INCLUDE });
    });
    await this.recordAudit(owner, AUDIT_CODES[owner.kind].resume, AuditEntity.SPONSOR_CAMPAIGN, id, {
      previousStatus: current.status,
      status: row.status,
    });
    return this.viewOne(row, audience);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Relatorio (mesmo formato para plataforma e grupo; so contadores agregados)
  // -------------------------------------------------------------------------------------------------------------

  async report(id: number, scopeWhere: OwnerWhere, query: SponsorReportQueryDto): Promise<SponsorReport> {
    const campaign = await this.requireCampaign(id, scopeWhere);
    if (query.from !== undefined && !isIsoDay(query.from)) throw sponsorValidation('from', 'from: data inicial no formato AAAA-MM-DD.');
    if (query.to !== undefined && !isIsoDay(query.to)) throw sponsorValidation('to', 'to: data final no formato AAAA-MM-DD.');
    if (query.from && query.to && query.from > query.to) throw sponsorValidation('to', 'to: a data final deve ser igual ou depois da inicial.');
    const day: Prisma.StringFilter = {};
    if (query.from) day.gte = query.from;
    if (query.to) day.lte = query.to;
    const rows = await this.prisma.sponsorStatDay.findMany({
      where: { campaignId: id, ...(query.from || query.to ? { day } : {}) },
      select: { day: true, state: true, impressions: true, clicks: true },
    });
    const byDay = new Map<string, { day: string; impressions: number; clicks: number }>();
    const byState = new Map<string, { state: string; impressions: number; clicks: number }>();
    let impressions = 0;
    let clicks = 0;
    for (const r of rows) {
      impressions += r.impressions;
      clicks += r.clicks;
      const d = byDay.get(r.day) ?? { day: r.day, impressions: 0, clicks: 0 };
      d.impressions += r.impressions;
      d.clicks += r.clicks;
      byDay.set(r.day, d);
      const s = byState.get(r.state) ?? { state: r.state, impressions: 0, clicks: 0 };
      s.impressions += r.impressions;
      s.clicks += r.clicks;
      byState.set(r.state, s);
    }
    return {
      campaign: {
        id: campaign.id,
        title: campaign.title,
        sponsorName: campaign.sponsor.name,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
        status: campaign.status,
      },
      totals: { impressions, clicks, ctr: ctrPercent(impressions, clicks) },
      byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      byState: [...byState.values()].sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.state.localeCompare(b.state)),
    };
  }

  /** Mesmos dados do relatorio JSON em CSV (UTF-8 com BOM, ';', protecao contra formula via shared/csv). */
  async reportCsv(id: number, scopeWhere: OwnerWhere, query: SponsorReportQueryDto): Promise<{ filename: string; csv: string }> {
    const r = await this.report(id, scopeWhere, query);
    const pct = (v: number) => v.toFixed(2).replace('.', ',');
    const period = `${query.from ?? 'início'} a ${query.to ?? 'hoje'}`;
    const rows: unknown[][] = [
      ['Campanha', `c${r.campaign.id}`, r.campaign.title, r.campaign.sponsorName, '', '', ''],
      ['Período', period, '', '', '', '', ''],
      ['Total', '', '', '', r.totals.impressions, r.totals.clicks, pct(r.totals.ctr)],
      ...r.byDay.map((d) => ['Dia', d.day, '', '', d.impressions, d.clicks, pct(ctrPercent(d.impressions, d.clicks))]),
      ...r.byState.map((s) => ['UF', s.state || 'Não identificada', '', '', s.impressions, s.clicks, pct(ctrPercent(s.impressions, s.clicks))]),
    ];
    const csv = buildCsv(['Seção', 'Chave', 'Título', 'Patrocinador', 'Impressões', 'Cliques', 'CTR (%)'], rows);
    return { filename: `patrocinio-c${r.campaign.id}-${fileDate()}.csv`, csv };
  }
}
