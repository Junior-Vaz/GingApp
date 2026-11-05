import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Sponsor, SponsorCampaign, SponsorCampaignStatus } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { buildCsv, fileDate } from '../../../shared/csv/csv';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { isUploadPath, UPLOAD_URL_PREFIX } from '../../../shared/uploads/image-ref';
import { normalizeUserText } from '../feed/feed-text';
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
  ctrPercent,
  DEFAULT_CTA_LABEL,
  effectiveStatus,
  EffectiveStatus,
  isIsoDay,
  looksLikeHtml,
  normalizeStates,
  SPONSOR_LIMITS,
  validateDestinationUrl,
  windowError,
} from './sponsor-rules';

/** Codigos estaveis de erro (o admin pode reagir ao `code`). */
export const SponsorErrorCode = {
  VALIDATION: 'VALIDATION',
  INVALID_DESTINATION_URL: 'INVALID_DESTINATION_URL',
  SPONSOR_HAS_CAMPAIGNS: 'SPONSOR_HAS_CAMPAIGNS',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  CAMPAIGN_ENDED: 'CAMPAIGN_ENDED',
} as const;

/** 400 em portugues com o campo (contrato 4.3). */
export function sponsorValidation(field: string, message: string, code: string = SponsorErrorCode.VALIDATION): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', code, field, message });
}

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ statusCode: 409, error: 'Conflict', code, message });
}

/** Campos de CONTEUDO: muda-los numa campanha ACTIVE/PAUSED a volta para DRAFT (nova aprovacao, contrato secao 3). */
export const CONTENT_FIELDS = ['sponsorId', 'title', 'text', 'imageRef', 'ctaLabel', 'destinationUrl', 'category'] as const;

export interface SponsorView {
  id: number;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface SponsorReport {
  campaign: { id: number; title: string; sponsorName: string; startsAt: Date; endsAt: Date; status: SponsorCampaignStatus };
  totals: { impressions: number; clicks: number; ctr: number };
  byDay: Array<{ day: string; impressions: number; clicks: number }>;
  byState: Array<{ state: string; impressions: number; clicks: number }>;
}

type CampaignRow = SponsorCampaign & { sponsor: Pick<Sponsor, 'id' | 'name' | 'logo'> };
const CAMPAIGN_INCLUDE = { sponsor: { select: { id: true, name: true, logo: true } } } as const;

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

/**
 * Gestao de patrocinadores e campanhas pela EQUIPE DA PLATAFORMA (docs/CONTRATO_PATROCINADORES.md 4.3). Toda escrita
 * audita (SPONSOR_* / SPONSOR_CAMPAIGN_*) com organizationId nulo e meta SEM dado pessoal (so ids, status e NOMES de campos).
 */
@Injectable()
export class PlatformSponsorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------------------------------------------
  // Imagens: so upload de PLATAFORMA (reprocessado e com peso limitado)
  // -------------------------------------------------------------------------------------------------------------

  private async platformImage(field: 'logo' | 'imageRef', value: string | null | undefined): Promise<string | null | undefined> {
    if (value === undefined || value === null) return value;
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

  // -------------------------------------------------------------------------------------------------------------
  // Patrocinadores
  // -------------------------------------------------------------------------------------------------------------

  private sponsorView(row: Sponsor & { _count: { campaigns: number } }): SponsorView {
    const { _count, ...rest } = row;
    return { ...rest, campaignsCount: _count.campaigns };
  }

  private async sponsorData(dto: CreateSponsorDto | UpdateSponsorDto, creating: boolean): Promise<Prisma.SponsorUncheckedUpdateInput> {
    const data: Prisma.SponsorUncheckedUpdateInput = {};
    if (creating || dto.name !== undefined) {
      data.name = requiredText('name', dto.name, { min: SPONSOR_LIMITS.nameMin, max: SPONSOR_LIMITS.nameMax });
    }
    if (dto.logo !== undefined) data.logo = await this.platformImage('logo', dto.logo);
    if (dto.contactName !== undefined) data.contactName = cleanText('contactName', dto.contactName, { max: SPONSOR_LIMITS.contactNameMax });
    if (dto.contactEmail !== undefined) data.contactEmail = dto.contactEmail === null ? null : dto.contactEmail.trim().toLowerCase();
    if (dto.contactPhone !== undefined) data.contactPhone = cleanText('contactPhone', dto.contactPhone, { max: SPONSOR_LIMITS.contactPhoneMax });
    if (dto.document !== undefined) data.document = cleanText('document', dto.document, { max: SPONSOR_LIMITS.documentMax });
    if (dto.notes !== undefined) data.notes = cleanText('notes', dto.notes, { max: SPONSOR_LIMITS.notesMax, multiline: true });
    return data;
  }

  async listSponsors(query: ListSponsorsQueryDto): Promise<Page<SponsorView>> {
    const q = query.q?.trim();
    const where: Prisma.SponsorWhereInput = q ? { name: { contains: q, mode: 'insensitive' } } : {};
    const [rows, total] = await Promise.all([
      this.prisma.sponsor.findMany({
        where,
        include: { _count: { select: { campaigns: true } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.sponsor.count({ where }),
    ]);
    return { items: rows.map((r) => this.sponsorView(r)), total };
  }

  async getSponsor(id: number): Promise<SponsorView> {
    const row = await this.prisma.sponsor.findUnique({ where: { id }, include: { _count: { select: { campaigns: true } } } });
    if (!row) throw new NotFoundException('Patrocinador não encontrado.');
    return this.sponsorView(row);
  }

  async createSponsor(dto: CreateSponsorDto): Promise<SponsorView> {
    const data = await this.sponsorData(dto, true);
    const row = await this.prisma.sponsor.create({
      data: data as Prisma.SponsorUncheckedCreateInput,
      include: { _count: { select: { campaigns: true } } },
    });
    await this.audit.record({
      organizationId: null,
      action: AuditAction.SPONSOR_CREATE,
      entity: AuditEntity.SPONSOR,
      entityId: row.id,
      meta: { fields: Object.keys(data).sort() },
    });
    return this.sponsorView(row);
  }

  async updateSponsor(id: number, dto: UpdateSponsorDto): Promise<SponsorView> {
    const current = await this.prisma.sponsor.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Patrocinador não encontrado.');
    const data = await this.sponsorData(dto, false);
    const changed = Object.keys(data).filter((k) => (current as Record<string, unknown>)[k] !== (data as Record<string, unknown>)[k]);
    const row = await this.prisma.sponsor.update({ where: { id }, data, include: { _count: { select: { campaigns: true } } } });
    if (changed.length > 0) {
      await this.audit.record({
        organizationId: null,
        action: AuditAction.SPONSOR_UPDATE,
        entity: AuditEntity.SPONSOR,
        entityId: id,
        meta: { fields: changed.sort() },
      });
    }
    return this.sponsorView(row);
  }

  async deleteSponsor(id: number): Promise<void> {
    const row = await this.prisma.sponsor.findUnique({ where: { id }, include: { _count: { select: { campaigns: true } } } });
    if (!row) throw new NotFoundException('Patrocinador não encontrado.');
    if (row._count.campaigns > 0) {
      throw conflict(
        SponsorErrorCode.SPONSOR_HAS_CAMPAIGNS,
        `Este patrocinador tem ${row._count.campaigns} campanha(s). Exclua as campanhas antes de excluir o patrocinador.`,
      );
    }
    try {
      await this.prisma.sponsor.delete({ where: { id } });
    } catch (error) {
      // Corrida: uma campanha foi criada entre a contagem e o DELETE (FK Restrict).
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2003' || error.code === 'P2014')) {
        throw conflict(SponsorErrorCode.SPONSOR_HAS_CAMPAIGNS, 'Este patrocinador tem campanhas. Exclua as campanhas antes.');
      }
      throw error;
    }
    await this.audit.record({ organizationId: null, action: AuditAction.SPONSOR_DELETE, entity: AuditEntity.SPONSOR, entityId: id });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Campanhas
  // -------------------------------------------------------------------------------------------------------------

  private async approverNames(rows: Array<{ approvedByUserId: number | null }>): Promise<Map<number, string>> {
    const ids = [...new Set(rows.map((r) => r.approvedByUserId).filter((v): v is number => v !== null))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private campaignView(row: CampaignRow, names: Map<number, string>, now: Date): SponsorCampaignView {
    const { sponsor, ...c } = row;
    const approverName = c.approvedByUserId !== null ? names.get(c.approvedByUserId) : undefined;
    return {
      id: c.id,
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
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  private async viewOne(row: CampaignRow): Promise<SponsorCampaignView> {
    return this.campaignView(row, await this.approverNames([row]), new Date());
  }

  private async requireCampaign(id: number): Promise<CampaignRow> {
    const row = await this.prisma.sponsorCampaign.findUnique({ where: { id }, include: CAMPAIGN_INCLUDE });
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

  async listCampaigns(query: ListSponsorCampaignsQueryDto): Promise<Page<SponsorCampaignView>> {
    const now = new Date();
    const q = query.q?.trim();
    const and: Prisma.SponsorCampaignWhereInput[] = [];
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
    const where: Prisma.SponsorCampaignWhereInput = and.length > 0 ? { AND: and } : {};
    const [rows, total] = await Promise.all([
      this.prisma.sponsorCampaign.findMany({ where, include: CAMPAIGN_INCLUDE, orderBy: { id: 'desc' }, ...pageArgs(query) }),
      this.prisma.sponsorCampaign.count({ where }),
    ]);
    const names = await this.approverNames(rows);
    return { items: rows.map((r) => this.campaignView(r, names, now)), total };
  }

  async getCampaign(id: number): Promise<SponsorCampaignView> {
    return this.viewOne(await this.requireCampaign(id));
  }

  private async requireSponsorId(sponsorId: number): Promise<void> {
    const exists = await this.prisma.sponsor.findUnique({ where: { id: sponsorId }, select: { id: true } });
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

  async createCampaign(dto: CreateSponsorCampaignDto): Promise<SponsorCampaignView> {
    await this.requireSponsorId(dto.sponsorId);
    const startsAt = parseInstant('startsAt', dto.startsAt);
    const endsAt = parseInstant('endsAt', dto.endsAt);
    this.assertWindow(startsAt, endsAt);
    const data: Prisma.SponsorCampaignUncheckedCreateInput = {
      sponsorId: dto.sponsorId,
      title: requiredText('title', dto.title, { min: SPONSOR_LIMITS.titleMin, max: SPONSOR_LIMITS.titleMax }),
      text: requiredText('text', dto.text, { min: SPONSOR_LIMITS.textMin, max: SPONSOR_LIMITS.textMax }),
      imageRef: (await this.platformImage('imageRef', dto.imageRef)) ?? null,
      ctaLabel: cleanText('ctaLabel', dto.ctaLabel, { min: SPONSOR_LIMITS.ctaMin, max: SPONSOR_LIMITS.ctaMax }) ?? DEFAULT_CTA_LABEL,
      ...this.destination(dto.destinationUrl),
      category: dto.category,
      startsAt,
      endsAt,
      status: SponsorCampaignStatus.DRAFT,
      weight: dto.weight ?? 1,
      states: this.states(dto.states ?? []),
      priceCents: dto.priceCents ?? null,
      billingNote: cleanText('billingNote', dto.billingNote, { max: SPONSOR_LIMITS.billingNoteMax, multiline: true }),
    };
    const row = await this.prisma.sponsorCampaign.create({ data, include: CAMPAIGN_INCLUDE });
    await this.audit.record({
      organizationId: null,
      action: AuditAction.SPONSOR_CAMPAIGN_CREATE,
      entity: AuditEntity.SPONSOR_CAMPAIGN,
      entityId: row.id,
      meta: { sponsorId: row.sponsorId, status: row.status, category: row.category, statesCount: row.states.length },
    });
    return this.viewOne(row);
  }

  async updateCampaign(id: number, dto: UpdateSponsorCampaignDto): Promise<SponsorCampaignView> {
    const current = await this.requireCampaign(id);
    const data: Prisma.SponsorCampaignUncheckedUpdateInput = {};
    if (dto.sponsorId !== undefined) {
      await this.requireSponsorId(dto.sponsorId);
      data.sponsorId = dto.sponsorId;
    }
    if (dto.title !== undefined) data.title = requiredText('title', dto.title, { min: SPONSOR_LIMITS.titleMin, max: SPONSOR_LIMITS.titleMax });
    if (dto.text !== undefined) data.text = requiredText('text', dto.text, { min: SPONSOR_LIMITS.textMin, max: SPONSOR_LIMITS.textMax });
    if (dto.imageRef !== undefined) data.imageRef = await this.platformImage('imageRef', dto.imageRef);
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
    if (dto.weight !== undefined) data.weight = dto.weight;
    if (dto.states !== undefined) data.states = this.states(dto.states);
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
    if (changed.length === 0) return this.viewOne(current);

    const row = await this.prisma.sponsorCampaign.update({ where: { id }, data, include: CAMPAIGN_INCLUDE });
    await this.audit.record({
      organizationId: null,
      action: AuditAction.SPONSOR_CAMPAIGN_UPDATE,
      entity: AuditEntity.SPONSOR_CAMPAIGN,
      entityId: id,
      meta: { fields: changed.sort(), previousStatus: current.status, status: row.status, backToDraft },
    });
    return this.viewOne(row);
  }

  async deleteCampaign(id: number): Promise<void> {
    const current = await this.requireCampaign(id);
    const statDays = await this.prisma.sponsorStatDay.count({ where: { campaignId: id } });
    // SponsorStatDay vai junto (FK onDelete Cascade).
    await this.prisma.sponsorCampaign.delete({ where: { id } });
    await this.audit.record({
      organizationId: null,
      action: AuditAction.SPONSOR_CAMPAIGN_DELETE,
      entity: AuditEntity.SPONSOR_CAMPAIGN,
      entityId: id,
      meta: { sponsorId: current.sponsorId, status: current.status, statDays },
    });
  }

  /**
   * Ativar (SO super admin, garantido pelo SuperAdminGuard da rota): revalida TUDO o que esta gravado (textos, URL 2.6,
   * categoria, janela, peso, UFs), recusa campanha ja encerrada e grava QUEM aprovou e QUANDO.
   */
  async activate(id: number, approverUserId: number): Promise<SponsorCampaignView> {
    const current = await this.requireCampaign(id);
    if (current.status === SponsorCampaignStatus.ACTIVE) {
      throw conflict(SponsorErrorCode.INVALID_TRANSITION, 'A campanha já está ativa.');
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
    await this.platformImage('imageRef', current.imageRef);

    const row = await this.prisma.sponsorCampaign.update({
      where: { id },
      data: { status: SponsorCampaignStatus.ACTIVE, approvedByUserId: approverUserId, approvedAt: now },
      include: CAMPAIGN_INCLUDE,
    });
    await this.audit.record({
      organizationId: null,
      action: AuditAction.SPONSOR_CAMPAIGN_ACTIVATE,
      entity: AuditEntity.SPONSOR_CAMPAIGN,
      entityId: id,
      meta: { previousStatus: current.status, status: row.status },
    });
    return this.viewOne(row);
  }

  async pause(id: number): Promise<SponsorCampaignView> {
    const current = await this.requireCampaign(id);
    if (current.status !== SponsorCampaignStatus.ACTIVE) {
      throw conflict(SponsorErrorCode.INVALID_TRANSITION, 'Só uma campanha ativa pode ser pausada.');
    }
    const row = await this.prisma.sponsorCampaign.update({
      where: { id },
      data: { status: SponsorCampaignStatus.PAUSED },
      include: CAMPAIGN_INCLUDE,
    });
    await this.audit.record({
      organizationId: null,
      action: AuditAction.SPONSOR_CAMPAIGN_PAUSE,
      entity: AuditEntity.SPONSOR_CAMPAIGN,
      entityId: id,
      meta: { previousStatus: current.status, status: row.status },
    });
    return this.viewOne(row);
  }

  /** PAUSED -> ACTIVE mantendo a aprovacao (conteudo nao mudou: mudar conteudo leva a DRAFT, que exige nova ativacao). */
  async resume(id: number): Promise<SponsorCampaignView> {
    const current = await this.requireCampaign(id);
    if (current.status !== SponsorCampaignStatus.PAUSED || current.approvedAt === null) {
      throw conflict(
        SponsorErrorCode.INVALID_TRANSITION,
        current.status === SponsorCampaignStatus.DRAFT
          ? 'Campanha em rascunho precisa ser ativada por um super admin (nova aprovação).'
          : 'Só uma campanha pausada pode ser retomada.',
      );
    }
    const row = await this.prisma.sponsorCampaign.update({
      where: { id },
      data: { status: SponsorCampaignStatus.ACTIVE },
      include: CAMPAIGN_INCLUDE,
    });
    await this.audit.record({
      organizationId: null,
      action: AuditAction.SPONSOR_CAMPAIGN_RESUME,
      entity: AuditEntity.SPONSOR_CAMPAIGN,
      entityId: id,
      meta: { previousStatus: current.status, status: row.status },
    });
    return this.viewOne(row);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Relatorio
  // -------------------------------------------------------------------------------------------------------------

  async report(id: number, query: SponsorReportQueryDto): Promise<SponsorReport> {
    const campaign = await this.requireCampaign(id);
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
  async reportCsv(id: number, query: SponsorReportQueryDto): Promise<{ filename: string; csv: string }> {
    const r = await this.report(id, query);
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
