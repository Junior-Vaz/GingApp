import { Injectable } from '@nestjs/common';
import {
  BillingGatewayCustomer,
  BillingGatewayService,
  BillingGatewaySubscription,
} from './billing-gateway.interface';

/**
 * Implementação simulada do BillingGatewayService (Fase 2 — sem gateway real integrado ainda,
 * ver PLANO_PROJETO.md §10.13). Não faz nenhuma chamada de rede: gera IDs determinísticos e
 * calcula currentPeriodEnd localmente, só para o domínio de billing (Plan/Subscription/
 * SubscriptionEvent) já funcionar de ponta a ponta.
 */
@Injectable()
export class StubBillingGatewayService implements BillingGatewayService {
  readonly provider = 'stub';

  async createCustomer(input: {
    organizationId: number;
    organizationName: string;
    email: string;
  }): Promise<BillingGatewayCustomer> {
    return { gatewayCustomerId: `stub-cust-${input.organizationId}` };
  }

  async createSubscription(input: {
    gatewayCustomerId: string;
    planCode: string;
    priceCents: number;
    billingPeriod: string;
  }): Promise<BillingGatewaySubscription> {
    const currentPeriodEnd = new Date();
    const days = input.billingPeriod === 'YEARLY' ? 365 : 30;
    currentPeriodEnd.setDate(currentPeriodEnd.getDate() + days);

    return {
      gatewaySubscriptionId: `stub-sub-${input.gatewayCustomerId}-${input.planCode}-${Date.now()}`,
      currentPeriodEnd,
    };
  }

  async cancelSubscription(_gatewaySubscriptionId: string): Promise<void> {
    // Stub: nada a chamar externamente — o cancelamento real fica só no nosso banco
    // (Subscription.status = CANCELED), como acontece em SubscriptionsService.cancel.
  }
}
