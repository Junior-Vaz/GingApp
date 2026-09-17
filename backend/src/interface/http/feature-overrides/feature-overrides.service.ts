import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { CreateFeatureOverrideDto } from './dto/create-feature-override.dto';
import { UpdateFeatureOverrideDto } from './dto/update-feature-override.dto';

/**
 * Overrides de feature por organização (Fase 2 — "SaaS Admin completo", projeto.txt §5).
 * Existe para casos pontuais fora da régua normal de planos: liberar uma feature premium sem
 * mudar de plano (ex.: cortesia, piloto) ou desativar algo para um grupo específico (ex.:
 * suporte). Não há ainda nenhum código consumindo isso para *aplicar* o gate de fato — nenhuma
 * feature do produto está condicionada a flag hoje; este módulo só gerencia o dado
 * (pendência registrada no plano: quando a primeira feature opcional existir, ler daqui).
 *
 * Sempre PLATFORM-only (equipe GingApp decide os overrides, nunca o próprio grupo).
 */
@Injectable()
export class FeatureOverridesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(organizationId: number) {
    return this.prisma.organizationFeatureOverride.findMany({
      where: { organizationId },
      orderBy: { featureKey: 'asc' },
    });
  }

  /** Upsert pela chave (organizationId, featureKey) — reenviar a mesma featureKey atualiza o
   * override existente em vez de gerar um erro de unicidade. */
  create(organizationId: number, dto: CreateFeatureOverrideDto) {
    return this.prisma.organizationFeatureOverride.upsert({
      where: { organizationId_featureKey: { organizationId, featureKey: dto.featureKey } },
      update: { enabled: dto.enabled ?? true, note: dto.note },
      create: {
        organizationId,
        featureKey: dto.featureKey,
        enabled: dto.enabled ?? true,
        note: dto.note,
      },
    });
  }

  async update(organizationId: number, id: number, dto: UpdateFeatureOverrideDto) {
    await this.findOneOrThrow(organizationId, id);
    return this.prisma.organizationFeatureOverride.update({
      where: { id },
      data: { enabled: dto.enabled, note: dto.note },
    });
  }

  /** Hard delete de verdade (exceção deliberada ao padrão de soft-delete, mesmo espírito de
   * FinancialRecord/Event): um override é só um flag pontual, sem valor de histórico —
   * removê-lo simplesmente volta ao comportamento padrão do plano. */
  async remove(organizationId: number, id: number): Promise<void> {
    await this.findOneOrThrow(organizationId, id);
    await this.prisma.organizationFeatureOverride.delete({ where: { id } });
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
