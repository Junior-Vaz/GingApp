import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { PaymentAccountStatus, Prisma } from '@prisma/client';
import { isProduction } from '../../../shared/config/runtime-config';
import { verifyWebhookSignature } from '../../../shared/payments/payment-crypto';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
  PaymentProviderError,
  ProviderPayment,
} from '../../../shared/payments/payment-provider.interface';
import { webhookSecret } from '../../../shared/payments/payments.config';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { PaymentAccountService } from './payment-account.service';
import { ApplyOutcome, PixService, safePaymentSnapshot } from './pix.service';

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : typeof value === 'number' ? String(value) : null;

/** No maximo quantas organizacoes candidatas sao testadas por notificacao. */
const MAX_CANDIDATES = 5;

export interface WebhookInput {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  body: unknown;
}

const header = (headers: WebhookInput['headers'], name: string): string | null => {
  const value = headers[name];
  return str(Array.isArray(value) ? value[0] : value);
};

/**
 * Webhook do Mercado Pago (PLANO_PROJETO.md 10.52). O CORPO NAO E FONTE DE VERDADE: dele so saem o id do pagamento e
 * pistas para achar a organizacao (gatewayPaymentId gravado / user_id do vendedor). O pagamento e BUSCADO no provedor
 * com o token de cada organizacao candidata e so e aplicado se a external_reference apontar para um lancamento DAQUELA
 * organizacao (PixService.applyProviderPayment). Assinatura x-signature obrigatoria (HMAC em tempo constante; em
 * producao sem MERCADOPAGO_WEBHOOK_SECRET => recusa). Idempotente por PaymentWebhookEvent (provider + id da notificacao).
 * Respostas: 200 para processado/duplicado/inofensivo; 401 assinatura invalida; 503 transitorio (o MP reenvia).
 */
@Injectable()
export class PaymentsWebhookService {
  private readonly logger = new Logger(PaymentsWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: PaymentAccountService,
    private readonly pix: PixService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async handle(input: WebhookInput): Promise<{ received: true; outcome: string }> {
    const body = (input.body && typeof input.body === 'object' ? input.body : {}) as Record<string, unknown>;
    const data = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>;
    const dataId = str(input.query['data.id']) ?? str(data.id);
    const requestId = header(input.headers, 'x-request-id');

    const secret = webhookSecret();
    if (!secret) {
      if (isProduction()) {
        this.logger.error('Webhook do Mercado Pago recusado: MERCADOPAGO_WEBHOOK_SECRET nao configurado.');
        throw new HttpException(
          { statusCode: 503, error: 'Service Unavailable', code: 'WEBHOOK_NOT_CONFIGURED', message: 'Webhook não configurado.' },
          503,
        );
      }
      this.logger.warn('Webhook sem MERCADOPAGO_WEBHOOK_SECRET (aceito SO fora de producao).');
    } else {
      const check = verifyWebhookSignature({ secret, signatureHeader: input.headers['x-signature'], requestId, dataId });
      if (check !== 'OK') {
        this.logger.warn(`Webhook com assinatura recusada (${check}).`);
        throw new HttpException(
          { statusCode: 401, error: 'Unauthorized', code: 'INVALID_SIGNATURE', message: 'Assinatura inválida.' },
          401,
        );
      }
    }

    const type = str(input.query.type) ?? str(input.query.topic) ?? str(body.type) ?? str(body.topic);
    if (type !== 'payment' || !dataId || !/^\d{1,20}$/.test(dataId)) {
      return { received: true, outcome: 'IGNORED' };
    }

    // Id do evento SO de partes assinadas (data.id + x-request-id; B9): o body.id nao entra na assinatura do MP. Sem
    // x-request-id (so fora de producao, sem segredo) cada entrega vira um evento proprio (aplicar e idempotente).
    const signatureTs = /(?:^|,)\s*ts=(\d{1,16})/.exec(header(input.headers, 'x-signature') ?? '')?.[1] ?? null;
    const eventId = requestId
      ? `payment:${dataId}:request:${requestId}`
      : `payment:${dataId}:ts:${signatureTs ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;
    const sellerId = str(body.user_id);
    const existing = await this.prisma.paymentWebhookEvent.findUnique({
      where: { provider_eventId: { provider: this.provider.id, eventId } },
    });
    if (existing?.processedAt) return { received: true, outcome: 'DUPLICATE' };
    if (!existing) {
      try {
        await this.prisma.paymentWebhookEvent.create({
          data: {
            provider: this.provider.id,
            eventId,
            paymentId: dataId,
            source: 'WEBHOOK',
            rawSafe: { type, action: str(body.action), userId: sellerId, liveMode: body.live_mode === true },
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return { received: true, outcome: 'DUPLICATE' }; // entrega simultanea: a outra processa
        }
        throw error;
      }
    }

    let resolved: { organizationId: number; outcome: ApplyOutcome; financialRecordId: number | null; payment: ProviderPayment } | null = null;
    /** Organizacoes candidatas cuja conta NAO pode ser usada agora (ERROR/REVOKED/token ilegivel/renovacao fora do ar). */
    const unavailable: number[] = [];
    for (const organizationId of await this.candidateOrganizations(dataId, sellerId)) {
      let connected;
      try {
        connected = await this.accounts.getConnected(organizationId);
      } catch {
        unavailable.push(organizationId); // nao da para conferir: decide depois do laco (A1-a)
        continue;
      }
      let payment: ProviderPayment;
      try {
        payment = await this.pix.withToken(organizationId, connected, (accessToken) =>
          this.provider.getPayment({ accessToken, paymentId: dataId }),
        );
      } catch (error) {
        if (error instanceof PaymentProviderError && error.transient) {
          this.logger.warn(`Webhook: provedor indisponivel ao buscar o pagamento ${dataId}; o Mercado Pago reenviara.`);
          throw new HttpException(
            { statusCode: 503, error: 'Service Unavailable', code: 'PROVIDER_UNAVAILABLE', message: 'Tente novamente.' },
            503,
          );
        }
        continue; // nao e deste vendedor (404) / token recusado: proxima candidata
      }
      const result = await this.pix.applyProviderPayment(organizationId, payment, {
        source: 'WEBHOOK',
        providerUserId: connected.account.providerUserId,
        eventId,
      });
      if (result.outcome === 'FOREIGN_REFERENCE' || result.outcome === 'FOREIGN_COLLECTOR') continue;
      resolved = { organizationId, ...result, payment };
      break;
    }

    if (!resolved && unavailable.length > 0) {
      // Pode ser um pagamento de um grupo cuja conta esta inutilizavel: NAO marca como processado e responde 503 para o
      // Mercado Pago reenviar (as retentativas dele sao finitas). A rede de seguranca e a reconciliacao: o lancamento
      // mantem o gatewayPaymentId e o Pix NUNCA vence localmente sem resposta do provedor; reconectada a conta, a baixa
      // acontece. O aviso ao Mestre e o da propria conta em ERROR (uma vez, na transicao - PaymentAccountService).
      await this.pix.recordEvent({
        eventId,
        source: 'WEBHOOK',
        paymentId: dataId,
        organizationId: unavailable[0],
        financialRecordId: null,
        outcome: 'ACCOUNT_UNAVAILABLE',
        rawSafe: { type, action: str(body.action), userId: sellerId, payment: null },
        processed: false,
      });
      this.logger.warn(`Webhook: conta do provedor indisponivel para conferir o pagamento ${dataId}; o Mercado Pago reenviara.`);
      throw new HttpException(
        { statusCode: 503, error: 'Service Unavailable', code: 'PAYMENTS_ACCOUNT_UNAVAILABLE', message: 'Tente novamente.' },
        503,
      );
    }

    await this.pix.recordEvent({
      eventId,
      source: 'WEBHOOK',
      paymentId: dataId,
      organizationId: resolved?.organizationId ?? null,
      financialRecordId: resolved?.financialRecordId ?? null,
      outcome: resolved?.outcome ?? 'UNRESOLVED',
      rawSafe: {
        type,
        action: str(body.action),
        userId: sellerId,
        payment: resolved ? safePaymentSnapshot(resolved.payment) : null,
      },
    });
    return { received: true, outcome: resolved?.outcome ?? 'UNRESOLVED' };
  }

  /**
   * Organizacoes que podem ser donas do pagamento: a do lancamento que ja tem esse gatewayPaymentId e as que conectaram
   * o vendedor `user_id` informado. So PISTAS: a confirmacao vem de buscar o pagamento com o token de cada uma.
   */
  private async candidateOrganizations(paymentId: string, sellerId: string | null): Promise<number[]> {
    const [records, accounts] = await Promise.all([
      this.prisma.financialRecord.findMany({
        where: { gatewayProvider: this.provider.id, gatewayPaymentId: paymentId },
        select: { organizationId: true },
        take: MAX_CANDIDATES,
      }),
      sellerId
        ? this.prisma.paymentProviderAccount.findMany({
            // ERROR tambem: a conta pode ser reconectada (o webhook responde 503 e o MP reenvia - A1-a).
            where: {
              provider: this.provider.id,
              providerUserId: sellerId,
              status: { in: [PaymentAccountStatus.CONNECTED, PaymentAccountStatus.ERROR] },
            },
            select: { organizationId: true },
            orderBy: { id: 'asc' },
            take: MAX_CANDIDATES,
          })
        : Promise.resolve([]),
    ]);
    return [...new Set([...records, ...accounts].map((r) => r.organizationId))].slice(0, MAX_CANDIDATES);
  }
}
