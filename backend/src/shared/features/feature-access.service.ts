import { Injectable } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Assinatura "em aberto" (conta como plano vigente do grupo). SSOT: SubscriptionsService e o FeatureGuard usam esta lista. */
export const OPEN_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['TRIALING', 'ACTIVE', 'PAST_DUE'];

/**
 * Modulos que podem ser ligados/desligados por plano (`Plan.features`) ou por grupo (OrganizationFeatureOverride).
 * Chave = `featureKey`. Lista deliberadamente curta: so o que o produto de fato condiciona hoje.
 */
export const GATED_FEATURES = {
  certificates: 'Certificados',
  finance: 'Financeiro',
} as const;
export type GatedFeatureKey = keyof typeof GATED_FEATURES;

/**
 * Resolve se um recurso esta disponivel para um grupo. Precedencia (a mais especifica vence):
 *  1. OrganizationFeatureOverride (organizationId + featureKey): `enabled` decide, para ligar OU desligar;
 *  2. Plan.features da assinatura em aberto: a chave presente com valor booleano decide (`{ "certificates": false }`);
 *  3. padrao = LIGADO (sem assinatura, plano sem a chave ou valor nao booleano nao bloqueiam: grupos existentes
 *     continuam funcionando como antes — o recurso so e' desligado por decisao explicita da equipe).
 */
@Injectable()
export class FeatureAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(organizationId: number, featureKey: string): Promise<boolean> {
    const override = await this.prisma.organizationFeatureOverride.findUnique({
      where: { organizationId_featureKey: { organizationId, featureKey } },
      select: { enabled: true },
    });
    if (override) return override.enabled;

    const subscription = await this.prisma.subscription.findFirst({
      where: { organizationId, status: { in: OPEN_SUBSCRIPTION_STATUSES } },
      orderBy: { id: 'desc' },
      select: { plan: { select: { features: true } } },
    });
    const features = subscription?.plan.features;
    if (features && typeof features === 'object' && !Array.isArray(features)) {
      const flag = (features as Record<string, unknown>)[featureKey];
      if (typeof flag === 'boolean') return flag;
    }
    return true;
  }
}
