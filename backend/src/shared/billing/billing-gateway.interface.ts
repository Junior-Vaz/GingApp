/**
 * Abstração do gateway de pagamento externo (Fase 2 — PLANO_PROJETO.md §10.13).
 *
 * Nenhuma credencial de gateway real (Asaas, Stripe, etc.) foi integrada ainda — a
 * implementação em produção hoje é StubBillingGatewayService (100% simulada, sem chamada de
 * rede nenhuma). Quando houver credenciais de sandbox de um gateway real, basta criar uma
 * nova classe implementando esta mesma interface (ex.: AsaasBillingGatewayService) e trocar o
 * provider em BillingModule — SubscriptionsService não muda nada, pois só depende do token
 * BILLING_GATEWAY_SERVICE, nunca da classe concreta.
 *
 * Os IDs retornados aqui são persistidos em Subscription.gatewayCustomerId/
 * gatewaySubscriptionId (ver migration add_subscription_gateway_fields).
 */
export interface BillingGatewayCustomer {
  gatewayCustomerId: string;
}

export interface BillingGatewaySubscription {
  gatewaySubscriptionId: string;
  /** Data em que o gateway cobraria a próxima fatura — usada para popular currentPeriodEnd. */
  currentPeriodEnd: Date;
}

export interface BillingGatewayService {
  /** Identificador do provider desta implementação (gravado em Subscription.gatewayProvider). */
  readonly provider: string;

  createCustomer(input: {
    organizationId: number;
    organizationName: string;
    email: string;
  }): Promise<BillingGatewayCustomer>;

  createSubscription(input: {
    gatewayCustomerId: string;
    planCode: string;
    priceCents: number;
    billingPeriod: string;
  }): Promise<BillingGatewaySubscription>;

  cancelSubscription(gatewaySubscriptionId: string): Promise<void>;
}

export const BILLING_GATEWAY_SERVICE = 'BILLING_GATEWAY_SERVICE';
