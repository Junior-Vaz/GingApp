import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { CreateFeatureOverrideDto } from './dto/create-feature-override.dto';
import { UpdateFeatureOverrideDto } from './dto/update-feature-override.dto';

/**
 * Overrides de feature por organização (Fase 2 — "SaaS Admin completo", projeto.txt §5).
 * Existe para casos pontuais fora da régua normal de planos: liberar uma feature premium sem
 * mudar de plano (ex.: cortesia, piloto) ou desativar algo para um grupo específico (ex.:
 * suporte). O gate é aplicado pelo FeatureGuard (@RequireFeature, ver shared/features/feature-access.service.ts):
 * o override do grupo vence Plan.features; hoje condicionam "certificates" e "finance".
 *
 * Sempre PLATFORM-only (equipe GingApp decide os overrides, nunca o próprio grupo).
 */
@Injectable()
export class FeatureOverridesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll(organizationId: number) {
    return this.prisma.organizationFeatureOverride.findMany({
      where: { organizationId },
      orderBy: { featureKey: 'asc' },
    });
  }

  /** Upsert pela chave (organizationId, featureKey) — reenviar a mesma featureKey atualiza o
   * override existente em vez de gerar um erro de unicidade. */
  async create(organizationId: number, dto: CreateFeatureOverrideDto) {
    const saved = await this.prisma.organizationFeatureOverride.upsert({
      where: { organizationId_featureKey: { organizationId, featureKey: dto.featureKey } },
      update: { enabled: dto.enabled ?? true, note: dto.note },
      create: {
        organizationId,
        featureKey: dto.featureKey,
        enabled: dto.enabled ?? true,
        note: dto.note,
      },
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.FEATURE_OVERRIDE_SET,
      entity: AuditEntity.FEATURE_OVERRIDE,
      entityId: saved.id,
      meta: { featureKey: saved.featureKey, enabled: saved.enabled },
    });
    return saved;
  }

  async update(organizationId: number, id: number, dto: UpdateFeatureOverrideDto) {
    await this.findOneOrThrow(organizationId, id);
    const saved = await this.prisma.organizationFeatureOverride.update({
      where: { id },
      data: { enabled: dto.enabled, note: dto.note },
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.FEATURE_OVERRIDE_SET,
      entity: AuditEntity.FEATURE_OVERRIDE,
      entityId: id,
      meta: { featureKey: saved.featureKey, enabled: saved.enabled },
    });
    return saved;
  }

  /** Hard delete de verdade (exceção deliberada ao padrão de soft-delete, mesmo espírito de
   * FinancialRecord/Event): um override é só um flag pontual, sem valor de histórico —
   * removê-lo simplesmente volta ao comportamento padrão do plano. */
  async remove(organizationId: number, id: number): Promise<void> {
    const existing = await this.findOneOrThrow(organizationId, id);
    await this.prisma.organizationFeatureOverride.delete({ where: { id } });
    await this.audit.record({
      organizationId,
      action: AuditAction.FEATURE_OVERRIDE_REMOVE,
      entity: AuditEntity.FEATURE_OVERRIDE,
      entityId: id,
      meta: { featureKey: existing.featureKey },
    });
  }

  private async findOneOrThrow(organizationId: number, id: number) {
    const override = await this.prisma.organizationFeatureOverride.findFirst({
      where: { id, organizationId },
    });
    if (!override) {
      throw new NotFoundException('Override de feature não encontrado.');
    }
    return override;
  }
}
