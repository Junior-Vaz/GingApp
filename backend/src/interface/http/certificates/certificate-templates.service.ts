import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CertificatePurpose, CertificateTemplate, Prisma } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { frontendBaseUrl } from '../../../shared/mail/mail.config';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { UPLOAD_URL_PREFIX } from '../../../shared/uploads/image-ref';
import { normalizeUserText } from '../feed/feed-text';
import {
  CertificateLayout,
  CertificateLayoutError,
  layoutUploadRefs,
  logoRefOf,
  resolveGroupLogo,
  validateCertificateLayout,
} from './certificate-layout';
import { renderCertificatePdf } from './certificate-pdf';
import { CERTIFICATE_PRESETS, CLASSIC_LAYOUT, findPreset } from './certificate-presets';
import { CreateCertificateTemplateDto, UpdateCertificateTemplateDto } from './dto/certificate-template.dto';

/** Máximo de modelos por grupo (contrato secao 5). */
export const CERTIFICATE_TEMPLATE_LIMIT = 30;

export const CertificateTemplateErrorCode = {
  TEMPLATE_LIMIT: 'TEMPLATE_LIMIT',
  LAYOUT_INVALID: 'LAYOUT_INVALID',
} as const;

const TEMPLATE_NOT_FOUND = 'Modelo de certificado não encontrado.';
const COPY_SUFFIX = ' (cópia)';

/** Dados de exemplo da pré-visualização (contrato secao 3): nunca um certificado real. */
const PREVIEW_SAMPLE = {
  studentName: 'Maria da Silva Santos',
  title: 'Batizado e troca de corda',
  graduationName: 'Corda Verde',
  verificationCode: 'EXEMPLO-0000',
};

/** Resposta de leitura (contrato secao 5). */
export interface CertificateTemplateView {
  id: number;
  name: string;
  purpose: CertificatePurpose;
  isDefault: boolean;
  layout: CertificateLayout;
  createdAt: Date;
  updatedAt: Date;
}

export interface CertificateTemplateSummaryView {
  id: number;
  name: string;
  purpose: CertificatePurpose;
  isDefault: boolean;
  orientation: 'landscape' | 'portrait';
  updatedAt: Date;
}

function toView(row: CertificateTemplate): CertificateTemplateView {
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    isDefault: row.isDefault,
    layout: row.layout as unknown as CertificateLayout,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Data civil de hoje em America/Sao_Paulo, como meia-noite UTC (a convenção de formatCivilDateBR). */
function todayCivil(now: Date = new Date()): Date {
  const ymd = now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  return new Date(`${ymd}T00:00:00.000Z`);
}

/**
 * Modelos de certificado do GRUPO (docs/CONTRATO_CERTIFICADOS_MODELOS.md). Tudo filtrado pelo organizationId do token;
 * id de outro grupo = 404 igual ao inexistente. O escopo de unidade NÃO se aplica (modelo é do grupo inteiro).
 */
@Injectable()
export class CertificateTemplatesService {
  private readonly logger = new Logger(CertificateTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------------------------------------------------
  // Leitura
  // ------------------------------------------------------------------------------------------------------------

  async list(organizationId: number): Promise<CertificateTemplateSummaryView[]> {
    const rows = await this.prisma.certificateTemplate.findMany({
      where: { organizationId },
      orderBy: [{ purpose: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      purpose: row.purpose,
      isDefault: row.isDefault,
      orientation: (row.layout as unknown as CertificateLayout)?.page?.orientation === 'portrait' ? 'portrait' : 'landscape',
      updatedAt: row.updatedAt,
    }));
  }

  presets() {
    return CERTIFICATE_PRESETS.map(({ key, name, purpose, layout }) => ({ key, name, purpose, layout }));
  }

  async findOne(organizationId: number, id: number): Promise<CertificateTemplateView> {
    return toView(await this.getRow(organizationId, id));
  }

  // ------------------------------------------------------------------------------------------------------------
  // Escrita
  // ------------------------------------------------------------------------------------------------------------

  async create(organizationId: number, user: AuthenticatedUser, dto: CreateCertificateTemplateDto): Promise<CertificateTemplateView> {
    if ((dto.layout === undefined) === (dto.presetKey === undefined)) {
      throw new BadRequestException('Informe o desenho (layout) OU um modelo pronto (presetKey), nunca os dois.');
    }
    let layout: CertificateLayout;
    let purpose: CertificatePurpose;
    if (dto.presetKey !== undefined) {
      const preset = findPreset(dto.presetKey);
      if (!preset) throw new BadRequestException('presetKey inválido.');
      layout = validateCertificateLayout(preset.layout);
      purpose = dto.purpose ?? (preset.purpose as CertificatePurpose);
    } else {
      if (!dto.purpose) throw new BadRequestException('purpose é obrigatório ao enviar o desenho (layout).');
      layout = await this.validateForOrganization(organizationId, dto.layout);
      purpose = dto.purpose;
    }
    const name = this.cleanName(dto.name);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      await this.assertBelowLimit(tx, organizationId);
      return tx.certificateTemplate.create({
        data: { organizationId, name, purpose, layout: layout as unknown as Prisma.InputJsonValue, createdByUserId: user.id },
      });
    });
    await this.auditWrite(AuditAction.CERTIFICATE_TEMPLATE_CREATE, organizationId, created, {
      presetKey: dto.presetKey ?? null,
    });
    return toView(created);
  }

  async update(organizationId: number, id: number, dto: UpdateCertificateTemplateDto): Promise<CertificateTemplateView> {
    const current = await this.getRow(organizationId, id);
    const data: Prisma.CertificateTemplateUpdateInput = {};
    if (dto.name !== undefined) data.name = this.cleanName(dto.name);
    if (dto.layout !== undefined) {
      data.layout = (await this.validateForOrganization(organizationId, dto.layout)) as unknown as Prisma.InputJsonValue;
    }
    if (dto.purpose !== undefined && dto.purpose !== current.purpose) {
      data.purpose = dto.purpose;
      // Trocar o uso tira o "padrão" (o padrão é por uso; o do uso novo continua o que já era).
      data.isDefault = false;
    }
    const updated = await this.prisma.certificateTemplate.update({ where: { id: current.id }, data });
    await this.auditWrite(AuditAction.CERTIFICATE_TEMPLATE_UPDATE, organizationId, updated, {
      fields: Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined),
      ...(data.isDefault === false && current.isDefault ? { defaultCleared: true } : {}),
    });
    return toView(updated);
  }

  async duplicate(organizationId: number, user: AuthenticatedUser, id: number): Promise<CertificateTemplateView> {
    const source = await this.getRow(organizationId, id);
    const base = source.name.slice(0, 60 - COPY_SUFFIX.length).trimEnd();
    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      await this.assertBelowLimit(tx, organizationId);
      return tx.certificateTemplate.create({
        data: {
          organizationId,
          name: `${base}${COPY_SUFFIX}`,
          purpose: source.purpose,
          isDefault: false,
          layout: source.layout as Prisma.InputJsonValue,
          createdByUserId: user.id,
        },
      });
    });
    await this.auditWrite(AuditAction.CERTIFICATE_TEMPLATE_CREATE, organizationId, created, { duplicatedFrom: source.id });
    return toView(created);
  }

  /** Marca como padrão do SEU uso, desmarcando o anterior na mesma transação (índice único parcial garante 1 por uso). */
  async setDefault(organizationId: number, id: number): Promise<CertificateTemplateView> {
    const current = await this.getRow(organizationId, id);
    const { updated, previousId } = await this.prisma.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      const previous = await tx.certificateTemplate.findFirst({
        where: { organizationId, purpose: current.purpose, isDefault: true, id: { not: current.id } },
        select: { id: true },
      });
      if (previous) await tx.certificateTemplate.update({ where: { id: previous.id }, data: { isDefault: false } });
      const row = await tx.certificateTemplate.update({ where: { id: current.id }, data: { isDefault: true } });
      return { updated: row, previousId: previous?.id ?? null };
    });
    await this.auditWrite(AuditAction.CERTIFICATE_TEMPLATE_DEFAULT, organizationId, updated, { previousDefaultId: previousId });
    return toView(updated);
  }

  /** Exclusão REAL. Certificados emitidos com ele ficam com templateId = null e seguem pelo layoutSnapshot. */
  async remove(organizationId: number, id: number): Promise<void> {
    const current = await this.getRow(organizationId, id);
    const issued = await this.prisma.certificate.count({ where: { organizationId, templateId: current.id } });
    await this.prisma.certificateTemplate.delete({ where: { id: current.id } });
    await this.auditWrite(AuditAction.CERTIFICATE_TEMPLATE_DELETE, organizationId, current, { issuedCertificates: issued });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Pré-visualização e emissão
  // ------------------------------------------------------------------------------------------------------------

  /** PDF de exemplo (contrato secao 3): dados fictícios + nome real do grupo; QR de exemplo, nunca um código real. */
  async preview(organizationId: number, rawLayout: unknown): Promise<Buffer> {
    const layout = await this.validateForOrganization(organizationId, rawLayout);
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, logo: true },
    });
    const appUrl = frontendBaseUrl('APP');
    return renderCertificatePdf(
      {
        organizationName: organization.name,
        studentName: PREVIEW_SAMPLE.studentName,
        title: PREVIEW_SAMPLE.title,
        graduationName: PREVIEW_SAMPLE.graduationName,
        issuedAt: todayCivil(),
        verificationCode: PREVIEW_SAMPLE.verificationCode,
        verificationUrl: appUrl ? `${appUrl}/verificar/${PREVIEW_SAMPLE.verificationCode}` : null,
      },
      resolveGroupLogo(layout, logoRefOf(organization.logo)),
    );
  }

  /**
   * Desenho a gravar no certificado na emissão (contrato secao 7): `templateId` informado (precisa ser do grupo, senão
   * 400) -> padrão do uso -> clássico embutido. O logo do grupo já sai resolvido (sem logo = elemento removido).
   */
  async resolveForIssue(
    organizationId: number,
    templateId: number | undefined,
    purpose: CertificatePurpose,
  ): Promise<{ templateId: number | null; layoutSnapshot: CertificateLayout }> {
    let template: CertificateTemplate | null;
    if (templateId !== undefined) {
      template = await this.prisma.certificateTemplate.findFirst({ where: { id: templateId, organizationId } });
      if (!template) throw new BadRequestException('Modelo de certificado inválido para esta organização.');
    } else {
      template = await this.prisma.certificateTemplate.findFirst({ where: { organizationId, purpose, isDefault: true } });
    }
    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { logo: true } });
    let layout: CertificateLayout = CLASSIC_LAYOUT;
    if (template) {
      try {
        layout = validateCertificateLayout(template.layout);
      } catch (error) {
        // Não deveria ocorrer (o modelo foi validado ao salvar); emite no clássico em vez de falhar.
        this.logger.warn(`Modelo ${template.id} com desenho inválido (${(error as Error).message}); usando o clássico.`);
      }
    }
    return { templateId: template?.id ?? null, layoutSnapshot: resolveGroupLogo(layout, logoRefOf(organization.logo)) };
  }

  // ------------------------------------------------------------------------------------------------------------
  // Apoio
  // ------------------------------------------------------------------------------------------------------------

  private async getRow(organizationId: number, id: number): Promise<CertificateTemplate> {
    const row = await this.prisma.certificateTemplate.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException(TEMPLATE_NOT_FOUND);
    return row;
  }

  private cleanName(raw: string): string {
    const name = normalizeUserText(raw, false);
    if (!name) throw new BadRequestException('name não pode ficar vazio.');
    if (name.length > 60) throw new BadRequestException('name deve ter no máximo 60 caracteres.');
    return name;
  }

  /** Regras do contrato secao 2 + propriedade das imagens (upload do PRÓPRIO grupo, contrato secao 6). */
  private async validateForOrganization(organizationId: number, raw: unknown): Promise<CertificateLayout> {
    let layout: CertificateLayout;
    try {
      layout = validateCertificateLayout(raw);
    } catch (error) {
      if (error instanceof CertificateLayoutError) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: CertificateTemplateErrorCode.LAYOUT_INVALID,
          message: error.message,
        });
      }
      throw error;
    }
    const filenames = layoutUploadRefs(layout).map((ref) => ref.slice(UPLOAD_URL_PREFIX.length));
    if (filenames.length > 0) {
      const owned = await this.prisma.upload.findMany({
        where: { organizationId, filename: { in: filenames } },
        select: { filename: true },
      });
      const ownedSet = new Set(owned.map((u) => u.filename));
      const foreign = filenames.find((f) => !ownedSet.has(f));
      if (foreign) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: CertificateTemplateErrorCode.LAYOUT_INVALID,
          message: `A imagem ${UPLOAD_URL_PREFIX}${foreign} não foi enviada por este grupo (use POST /uploads).`,
        });
      }
    }
    return layout;
  }

  /** Serializa as escritas do grupo (limite de 30 e troca de padrão) travando a linha do grupo na transação. */
  private async lockOrganization(tx: Prisma.TransactionClient, organizationId: number): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
  }

  private async assertBelowLimit(tx: Prisma.TransactionClient, organizationId: number): Promise<void> {
    const count = await tx.certificateTemplate.count({ where: { organizationId } });
    if (count >= CERTIFICATE_TEMPLATE_LIMIT) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: CertificateTemplateErrorCode.TEMPLATE_LIMIT,
        message: `O grupo já tem ${CERTIFICATE_TEMPLATE_LIMIT} modelos de certificado (o máximo). Exclua um para criar outro.`,
      });
    }
  }

  /** Auditoria SEM o conteúdo dos textos (contrato secao 8): só id, nome, uso, padrão, orientação e contagens. */
  private async auditWrite(action: string, organizationId: number, row: CertificateTemplate, extra: Record<string, unknown>): Promise<void> {
    const layout = row.layout as unknown as CertificateLayout;
    await this.audit.record({
      organizationId,
      action,
      entity: AuditEntity.CERTIFICATE_TEMPLATE,
      entityId: row.id,
      meta: {
        name: row.name,
        purpose: row.purpose,
        isDefault: row.isDefault,
        orientation: layout?.page?.orientation ?? null,
        elements: Array.isArray(layout?.elements) ? layout.elements.length : null,
        ...extra,
      },
    });
  }
}
