import { Injectable } from '@nestjs/common';
import { OrganizationType, RecordStatus, StudentStatus, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';

/** Assinaturas que contam como "em uso" por plano (distribuição): ACTIVE e TRIALING. */
const IN_USE_STATUSES: SubscriptionStatus[] = [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING];
/** Mesmo conjunto de SubscriptionsService.OPEN_STATUSES: define o "plano atual" de um grupo. */
const OPEN_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
];
const RECENT_ORGANIZATIONS_LIMIT = 5;
const NEW_ORGANIZATIONS_WINDOW_DAYS = 30;
const MONTHS_IN_YEAR = 12;

export interface PlatformDashboard {
  generatedAt: string;
  organizations: { total: number; active: number; inactive: number };
  newOrganizationsLast30Days: number;
  students: { active: number };
  subscriptions: {
    byStatus: Record<SubscriptionStatus, number>;
    byPlan: Array<{ planId: number; code: string; name: string; count: number }>;
  };
  mrrCents: number;
  /** Assinaturas ACTIVE cujo plano tem billingPeriod desconhecido (fora MONTHLY/YEARLY): ficam fora do MRR. */
  mrrIgnoredSubscriptions: number;
  recentOrganizations: Array<{
    id: number;
    name: string;
    slug: string;
    createdAt: Date;
    currentPlan: { id: number; code: string; name: string; subscriptionStatus: SubscriptionStatus } | null;
  }>;
}

/**
 * Métricas agregadas da plataforma (tela inicial do admin). Tudo é calculado NO BANCO
 * (count/groupBy) — nunca somando uma lista truncada em memória. Sem dados pessoais: só
 * contagens e dados cadastrais de grupos (não de pessoas).
 *
 * "Organização" = tenants reais (OrganizationType.GROUP). A organização SYSTEM (reservada a
 * contas PLATFORM, PLANO_PROJETO.md §2.2) não é um grupo cliente e fica fora de todas as contas.
 *
 * MRR (receita recorrente mensal estimada), em centavos: soma de Plan.priceCents das assinaturas
 * com status ACTIVE (TRIALING/PAST_DUE/CANCELED/EXPIRED não geram receita reconhecida aqui),
 * normalizando pela periodicidade do plano:
 *   - MONTHLY: priceCents;
 *   - YEARLY:  priceCents / 12 (a soma é feita exata e arredondada UMA vez no fim);
 *   - qualquer outro valor de billingPeriod (a coluna é String; a API de planos só aceita
 *     MONTHLY e YEARLY): não é estimável, fica fora do MRR e é contado em mrrIgnoredSubscriptions.
 */
@Injectable()
export class PlatformDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(): Promise<PlatformDashboard> {
    const now = new Date();
    const since = new Date(now.getTime() - NEW_ORGANIZATIONS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const groupOnly = { type: OrganizationType.GROUP };

    const [
      orgTotal,
      orgActive,
      orgInactive,
      newOrgs,
      activeStudents,
      statusGroups,
      inUseByPlan,
      activeByPlan,
      recent,
    ] = await Promise.all([
      this.prisma.organization.count({ where: groupOnly }),
      this.prisma.organization.count({ where: { ...groupOnly, status: RecordStatus.ACTIVE } }),
      this.prisma.organization.count({ where: { ...groupOnly, status: RecordStatus.INACTIVE } }),
      this.prisma.organization.count({ where: { ...groupOnly, createdAt: { gte: since } } }),
      this.prisma.student.count({ where: { status: StudentStatus.ACTIVE, organization: groupOnly } }),
      this.prisma.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.subscription.groupBy({
        by: ['planId'],
        where: { status: { in: IN_USE_STATUSES } },
        _count: { _all: true },
      }),
      this.prisma.subscription.groupBy({
        by: ['planId'],
        where: { status: SubscriptionStatus.ACTIVE },
        _count: { _all: true },
      }),
      this.prisma.organization.findMany({
        where: groupOnly,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: RECENT_ORGANIZATIONS_LIMIT,
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          subscriptions: {
            where: { status: { in: OPEN_STATUSES } },
            orderBy: { id: 'desc' },
            take: 1,
            select: { status: true, plan: { select: { id: true, code: true, name: true } } },
          },
        },
      }),
    ]);

    const byStatus = Object.fromEntries(
      Object.values(SubscriptionStatus).map((status) => [status, 0]),
    ) as Record<SubscriptionStatus, number>;
    for (const group of statusGroups) {
      byStatus[group.status] = group._count._all;
    }

    const planIds = [...new Set([...inUseByPlan, ...activeByPlan].map((g) => g.planId))];
    const plans = planIds.length
      ? await this.prisma.plan.findMany({
          where: { id: { in: planIds } },
          select: { id: true, code: true, name: true, priceCents: true, billingPeriod: true },
        })
      : [];
    const planById = new Map(plans.map((p) => [p.id, p]));

    const byPlan = inUseByPlan
      .map((g) => {
        const plan = planById.get(g.planId);
        return plan ? { planId: plan.id, code: plan.code, name: plan.name, count: g._count._all } : null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

    let monthlyCents = 0;
    let yearlyCents = 0;
    let ignored = 0;
    for (const g of activeByPlan) {
      const plan = planById.get(g.planId);
      if (!plan) continue;
      const total = plan.priceCents * g._count._all;
      if (plan.billingPeriod === 'MONTHLY') monthlyCents += total;
      else if (plan.billingPeriod === 'YEARLY') yearlyCents += total;
      else ignored += g._count._all;
    }

    return {
      generatedAt: now.toISOString(),
      organizations: { total: orgTotal, active: orgActive, inactive: orgInactive },
      newOrganizationsLast30Days: newOrgs,
      students: { active: activeStudents },
      subscriptions: { byStatus, byPlan },
      mrrCents: Math.round(monthlyCents + yearlyCents / MONTHS_IN_YEAR),
      mrrIgnoredSubscriptions: ignored,
      recentOrganizations: recent.map((org) => {
        const open = org.subscriptions[0];
        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          createdAt: org.createdAt,
          currentPlan: open ? { ...open.plan, subscriptionStatus: open.status } : null,
        };
      }),
    };
  }
}
