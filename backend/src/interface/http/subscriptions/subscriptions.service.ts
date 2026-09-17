import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { BILLING_GATEWAY_SERVICE, BillingGatewayService } from '../../../shared/billing/billing-gateway.interface';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

const OPEN_STATUSES: SubscriptionStatus[] = ['TRIALING', 'ACTIVE', 'PAST_DUE'];

/**
 * Assinaturas (organização ↔ plano) — PLANO_PROJETO.md §10.13. Gerido pela equipe PLATFORM
 * (SubscriptionsController atrás de PlatformOnlyGuard), com uma exceção de leitura própria
 * (findMine) para o próprio grupo ver seu plano/limites — mesmo padrão de StudentsService.
 * findMine.
 *
 * Toda mutação grava uma linha em SubscriptionEvent (audit trail dedicado deste domínio,
 * distinto do AuditLog genérico) e, quando envolve o gateway (criar/cancelar), passa pelo
 * BillingGatewayService injetado por token — hoje sempre StubBillingGatewayService.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(BILLING_GATEWAY_SERVICE) private readonly gateway: BillingGatewayService,
  ) {}

  findAll() {
    return this.prisma.subscription.findMany({
      include: { organization: true, plan: true },
      orderBy: { id: 'desc' },
    });
  }

  async findOne(id: number) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: { organization: true, plan: true, events: { orderBy: { createdAt: 'desc' } } },
    });
    if (!subscription) {
      throw new NotFoundException('Assinatura não encontrada.');
    }
    return subscription;
  }

  /** Assinatura mais recente do grupo autenticado, aberta ou não — o painel usa isso para
   * mostrar plano atual e status (inclusive CANCELED/EXPIRED, para orientar reativação). */
  findMine(organizationId: number) {
    return this.prisma.subscription.findFirst({
      where: { organizationId },
      include: { plan: true },
      orderBy: { id: 'desc' },
    });
  }

  /** Assinatura em aberto (TRIALING/ACTIVE/PAST_DUE) do grupo, com o plano — usado para
   * checagem de limites (ex.: StudentsService.create). Retorna null se o grupo não tem
   * assinatura aberta: no estado atual do produto isso NÃO bloqueia a operação (ver
   * StudentsService), só deixa de aplicar limite. */
  findOpenForOrganization(organizationId: number) {
    return this.prisma.subscription.findFirst({
      where: { organizationId, status: { in: OPEN_STATUSES } },
      include: { plan: true },
      orderBy: { id: 'desc' },
    });
  }

  async create(dto: CreateSubscriptionDto) {
    const organization = await this.prisma.organization.findUnique({ where: { id: dto.organizationId } });
    if (!organization) {
      throw new NotFoundException('Organização não encontrada.');
    }

    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan || !plan.isActive) {
      throw new NotFoundException('Plano não encontrado ou inativo.');
    }

    const existingOpen = await this.findOpenForOrganization(dto.organizationId);
    if (existingOpen) {
      throw new ConflictException(
        'Esta organização já tem uma assinatura em aberto — cancele-a ou atualize-a em vez de criar outra.',
      );
    }

    const status = dto.status ?? 'ACTIVE';
    const customer = await this.gateway.createCustomer({
      organizationId: organization.id,
      organizationName: organization.name,
      email: organization.email ?? '',
    });
    const gatewaySubscription = await this.gateway.createSubscription({
      gatewayCustomerId: customer.gatewayCustomerId,
      planCode: plan.code,
      priceCents: plan.priceCents,
      billingPeriod: plan.billingPeriod,
    });

    const subscription = await this.prisma.subscription.create({
      data: {
        organizationId: organization.id,
        planId: plan.id,
        status,
        gatewayProvider: this.gateway.provider,
        gatewayCustomerId: customer.gatewayCustomerId,
        gatewaySubscriptionId: gatewaySubscription.gatewaySubscriptionId,
        currentPeriodEnd: gatewaySubscription.currentPeriodEnd,
      },
      include: { organization: true, plan: true },
    });

    await this.logEvent(subscription.id, 'CREATED', { planCode: plan.code, status });
    return subscription;
  }

  async update(id: number, dto: UpdateSubscriptionDto) {
    const current = await this.findOne(id);

    if (dto.planId && dto.planId !== current.planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
      if (!plan || !plan.isActive) {
        throw new NotFoundException('Plano não encontrado ou inativo.');
      }
    }

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: { planId: dto.planId, status: dto.status },
      include: { organization: true, plan: true },
    });

    await this.logEvent(id, 'UPDATED', {
      before: { planId: current.planId, status: current.status },
      after: { planId: updated.planId, status: updated.status },
    });
    return updated;
  }

  async cancel(id: number) {
    const current = await this.findOne(id);
    if (current.status === 'CANCELED') {
      throw new BadRequestException('Esta assinatura já está cancelada.');
    }

    if (current.gatewaySubscriptionId) {
      await this.gateway.cancelSubscription(current.gatewaySubscriptionId);
    }

    const canceled = await this.prisma.subscription.update({
      where: { id },
      data: { status: 'CANCELED', canceledAt: new Date() },
      include: { organization: true, plan: true },
    });

    await this.logEvent(id, 'CANCELED', { previousStatus: current.status });
    return canceled;
  }

  private logEvent(subscriptionId: number, type: string, payload: Record<string, unknown>) {
    return this.prisma.subscriptionEvent.create({
      data: { subscriptionId, type, payload: payload as Prisma.InputJsonValue },
    });
  }
}
