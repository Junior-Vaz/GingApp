import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

/**
 * Catálogo de planos (PLANO_PROJETO.md §10.13) — gerido só pela equipe PLATFORM
 * (PlansController inteiro atrás de PlatformOnlyGuard). Nunca há hard delete: um plano com
 * assinaturas ativas não pode desaparecer do histórico, então "remover" é isActive = false
 * (mesma convenção de soft-delete usada em Student/Class/Lesson/Teacher).
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll() {
    return this.prisma.plan.findMany({ orderBy: { priceCents: 'asc' } });
  }

  async findOne(id: number) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException('Plano não encontrado.');
    }
    return plan;
  }

  async create(dto: CreatePlanDto) {
    await this.assertCodeAvailable(dto.code);

    const created = await this.prisma.plan.create({
      data: {
        name: dto.name,
        code: dto.code,
        priceCents: dto.priceCents,
        billingPeriod: dto.billingPeriod ?? 'MONTHLY',
        maxUnits: dto.maxUnits,
        maxStudents: dto.maxStudents,
        features: (dto.features ?? {}) as Prisma.InputJsonValue,
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit.record({
      organizationId: null,
      action: AuditAction.PLAN_CREATE,
      entity: AuditEntity.PLAN,
      entityId: created.id,
      meta: { code: created.code, priceCents: created.priceCents },
    });
    return created;
  }

  async update(id: number, dto: UpdatePlanDto) {
    await this.findOne(id);
    if (dto.code) {
      await this.assertCodeAvailable(dto.code, id);
    }

    const updated = await this.prisma.plan.update({
      where: { id },
      data: {
        name: dto.name,
        code: dto.code,
        priceCents: dto.priceCents,
        billingPeriod: dto.billingPeriod,
        maxUnits: dto.maxUnits,
        maxStudents: dto.maxStudents,
        features: dto.features as Prisma.InputJsonValue | undefined,
        isActive: dto.isActive,
      },
    });
    await this.audit.record({
      organizationId: null,
      action: AuditAction.PLAN_UPDATE,
      entity: AuditEntity.PLAN,
      entityId: id,
      meta: {
        fields: Object.entries(dto)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => key),
      },
    });
    return updated;
  }

  async deactivate(id: number) {
    await this.findOne(id);
    const updated = await this.prisma.plan.update({ where: { id }, data: { isActive: false } });
    await this.audit.record({
      organizationId: null,
      action: AuditAction.PLAN_DELETE,
      entity: AuditEntity.PLAN,
      entityId: id,
      meta: { softDelete: true },
    });
    return updated;
  }

  private async assertCodeAvailable(code: string, ignoreId?: number) {
    const existing = await this.prisma.plan.findUnique({ where: { code } });
    if (existing && existing.id !== ignoreId) {
      throw new ConflictException(`Já existe um plano com o código "${code}".`);
    }
  }
}
