import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { PaymentAccountMode, PaymentAccountStatus, Prisma } from '@prisma/client';
import { WebhookSignatureCheck, verifyWebhookSignature } from '../../../shared/payments/payment-crypto';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
  PaymentProviderError,
  ProviderPayment,
} from '../../../shared/payments/payment-provider.interface';
import {
  WEBHOOK_SIGNATURE_ALERT_WINDOW_MS,
  parseWebhookOrg,
  webhookSecret,
  webhookUnsignedLimits,
} from '../../../shared/payments/payments.config';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { PaymentAccountService } from './payment-account.service';
import { ApplyOutcome, PixService, safePaymentSnapshot } from './pix.service';

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : typeof value === 'number' ? String(value) : null;

/** No maximo quantas organizacoes candidatas sao testadas por notificacao. */
const MAX_CANDIDATES = 5;
/** Compat: o cooldown padrao (o valor efetivo vem de webhookUnsignedLimits, ajustavel por env). */
export const UNSIGNED_COOLDOWN_MS = 5_000;

export interface WebhookInput {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  body: unknown;
}

/** Resposta CONSTANTE (10.56, B2): nada de `outcome` (oraculo de enumeracao de grupos/contas/pagamentos). */
export type WebhookResponse = { received: true };
const RECEIVED: WebhookResponse = { received: true };

const header = (headers: WebhookInput['headers'], name: string): string | null => {
  const value = headers[name];
  return str(Array.isArray(value) ? value[0] : value);
};

const httpError = (statusCode: number, error: string, code: string, message: string) =>
  new HttpException({ statusCode, error, code, message }, statusCode);

/** Motivo de uma assinatura que NAO conferiu para a candidata (gravado em PaymentWebhookEvent.signatureProblem). */
export type SignatureProblem = 'MISSING' | 'MISMATCH' | 'UNREADABLE';

/** Candidata a dona do pagamento + o segredo de assinatura que vale para ela. */
interface Candidate {
  organizationId: number;
  /** Segredo do GRUPO (MANUAL) ou o global MERCADOPAGO_WEBHOOK_SECRET (SO contas OAUTH - A1); null = nenhum. */
  secret: string | null;
  /** De onde veio o segredo (GROUP = o Mestre controla e pode corrigir; GLOBAL = o do servidor). */
  secretSource: 'GROUP' | 'GLOBAL' | null;
  /** O grupo tem segredo gravado mas ele nao decifra (chave trocada). */
  unreadable: boolean;
  /** O `data.id` ja e o gatewayPaymentId de um lancamento DESTE grupo (evento barato e legitimo - M5-b). */
  knownPayment: boolean;
}

const problemOf = (check: WebhookSignatureCheck): SignatureProblem => (check === 'MISSING' ? 'MISSING' : 'MISMATCH');

/**
 * Webhook do Mercado Pago (PLANO_PROJETO.md 10.52/10.55/10.56). O CORPO NAO E FONTE DE VERDADE: dele so saem o id do
 * pagamento e pistas do grupo. O pagamento e BUSCADO no provedor com o token de cada organizacao candidata e so e
 * aplicado se a external_reference apontar para um lancamento DAQUELA organizacao e o collector for a conta dela
 * (PixService.applyProviderPayment) - valor/status sempre os do provedor.
 *
 * Grupo: `?org=<id>` (notification_url de cada Pix) + pistas: lancamento com esse gatewayPaymentId e, no maximo UMA
 * conta cujo providerUserId = `user_id` do corpo (M5-c). Assinatura x-signature (HMAC, tempo constante) POR CANDIDATA:
 * segredo do GRUPO (so MANUAL) ou, para contas OAUTH, o global MERCADOPAGO_WEBHOOK_SECRET (A1: o global NUNCA vale para
 * grupo MANUAL). Assinatura que confere = evento VERIFICADO. Sem segredo, ou assinatura ausente/errada/ilegivel (A2) = o
 * evento vale so como GATILHO LIMITADO (mesma conferencia ativa no provedor; signatureVerified=false + signatureProblem):
 * nunca 401 por isso (o MP pode nao assinar a notification_url como esperado - CONFERIR NO SANDBOX), e o Mestre e avisado
 * no maximo 1 vez por 24 h quando um Pix REAL do grupo chega com a assinatura errada.
 * Limites dos gatilhos (POR PROCESSO): por grupo/minuto (generoso para pagamento ja conhecido do grupo, apertado para id
 * desconhecido) e 1 consulta por pagamento+grupo a cada 5 s; gatilho que nao resolveu a nada NAO grava linha (M5-a).
 * Respostas: SEMPRE `{ received: true }` (200) nos casos aceitos/ignorados (B2); 401 so quando NENHUM grupo e
 * identificavel e a assinatura presente falha o segredo do servidor; 429 gatilho acima do limite; 503 transitorio
 * (provedor fora / conta do grupo inutilizavel - o MP reenvia).
 */
@Injectable()
export class PaymentsWebhookService {
  private readonly logger = new Logger(PaymentsWebhookService.name);
  /** `${org}:${paymentId}` -> ultima consulta de GATILHO (por processo). */
  private readonly unsignedLastCheck = new Map<string, number>();
  /** `${org}:known|unknown` -> janela de 1 min de gatilhos (por processo). */
  private readonly unsignedWindow = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: PaymentAccountService,
    private readonly pix: PixService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async handle(input: WebhookInput): Promise<WebhookResponse> {
    const body = (input.body && typeof input.body === 'object' ? input.body : {}) as Record<string, unknown>;
    const data = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>;
    const dataId = str(input.query['data.id']) ?? str(data.id);
    const requestId = header(input.headers, 'x-request-id');
    const type = str(input.query.type) ?? str(input.query.topic) ?? str(body.type) ?? str(body.topic);
    if (type !== 'payment' || !dataId || !/^\d{1,20}$/.test(dataId)) return RECEIVED;
    const orgParam = parseWebhookOrg(input.query.org);
    const sellerId = str(body.user_id);
    const rawSafeBase = { type, action: str(body.action), userId: sellerId, org: orgParam, liveMode: body.live_mode === true };

    // ---- Assinatura, por candidata ------------------------------------------------------------
    const candidates = await this.candidates(orgParam, dataId, sellerId);
    const signatureHeader = input.headers['x-signature'];
    const check = (secret: string) => verifyWebhookSignature({ secret, signatureHeader, requestId, dataId });

    if (candidates.length === 0) {
      // Nenhuma pista de grupo: so o segredo global pode autenticar. Assinatura presente e invalida => 401; sem
      // assinatura/segredo => descarta sem gravar nada (anti-DoS). Assinada e valida => trilha UNRESOLVED.
      const global = webhookSecret();
      const signaturePresent = !(signatureHeader === undefined || signatureHeader === null || signatureHeader === '');
      if (!global || !signaturePresent) return RECEIVED;
      if (check(global) !== 'OK') {
        this.logger.warn('Webhook sem grupo identificavel com assinatura recusada.');
        throw httpError(401, 'Unauthorized', 'INVALID_SIGNATURE', 'Assinatura inválida.');
      }
      const eventId = this.eventId(dataId, requestId, input.headers);
      await this.pix.recordEvent({
        eventId,
        source: 'WEBHOOK',
        paymentId: dataId,
        organizationId: null,
        financialRecordId: null,
        outcome: 'UNRESOLVED',
        rawSafe: { ...rawSafeBase, payment: null },
        signatureVerified: true,
      });
      return RECEIVED;
    }

    const verified = new Set<number>();
    const problems = new Map<number, SignatureProblem>();
    for (const c of candidates) {
      if (c.unreadable) {
        problems.set(c.organizationId, 'UNREADABLE');
        continue;
      }
      if (!c.secret) continue; // sem segredo: gatilho simples (sem "problema")
      const result = check(c.secret);
      if (result === 'OK') verified.add(c.organizationId);
      else problems.set(c.organizationId, problemOf(result));
    }

    // ---- Limites dos gatilhos (sem assinatura valida) ------------------------------------------
    const now = Date.now();
    const toProcess: Candidate[] = [];
    for (const c of candidates) {
      if (verified.has(c.organizationId) || this.claimTrigger(c, dataId, now)) toProcess.push(c);
    }
    if (toProcess.length === 0) {
      throw httpError(429, 'Too Many Requests', 'WEBHOOK_RATE_LIMITED', 'Muitas notificações; tente novamente.');
    }
    const anyVerified = toProcess.some((c) => verified.has(c.organizationId));

    // ---- Idempotencia -------------------------------------------------------------------------
    // Id do evento SO de partes assinadas (data.id + x-request-id; B9 de 10.53). Evento VERIFICADO: a linha e criada
    // ANTES (claim). Gatilho: so e gravado no fim SE resolver a algo (M5-a) - reaplicar e idempotente.
    const eventId = this.eventId(dataId, requestId, input.headers);
    const existing = await this.prisma.paymentWebhookEvent.findUnique({
      where: { provider_eventId: { provider: this.provider.id, eventId } },
    });
    if (existing?.processedAt) return RECEIVED; // duplicado
    if (!existing && anyVerified) {
      try {
        await this.prisma.paymentWebhookEvent.create({
          data: { provider: this.provider.id, eventId, paymentId: dataId, source: 'WEBHOOK', signatureVerified: true, rawSafe: rawSafeBase },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return RECEIVED; // simultaneo
        throw error;
      }
    }

    // ---- Conferencia ATIVA no provedor (o corpo nunca e confiado) -----------------------------
    let resolved: { organizationId: number; outcome: ApplyOutcome; financialRecordId: number | null; payment: ProviderPayment } | null = null;
    /** Candidatas cuja conta NAO pode ser usada agora (ERROR/REVOKED/token ilegivel/revogada no meio - B1). */
    const unavailable: number[] = [];
    for (const { organizationId } of toProcess) {
      let connected;
      try {
        connected = await this.accounts.getConnected(organizationId);
      } catch {
        unavailable.push(organizationId); // nao da para conferir: decide depois do laco (A1-a de 10.53)
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
          throw httpError(503, 'Service Unavailable', 'PROVIDER_UNAVAILABLE', 'Tente novamente.');
        }
        if (error instanceof HttpException) {
          // B1: a conta foi descoberta revogada/inutilizavel NO MEIO (MP_ACCOUNT_ERROR / 503 do /users/me): nao e "nao
          // e deste vendedor" - fica como indisponivel (503, evento sem processedAt) para o MP reenviar.
          unavailable.push(organizationId);
          continue;
        }
        continue; // nao e deste vendedor (404): proxima candidata
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
    const signatureVerified = resolved ? verified.has(resolved.organizationId) : anyVerified;
    const signatureProblem = resolved ? (problems.get(resolved.organizationId) ?? null) : null;

    if (!resolved && unavailable.length > 0) {
      // Pode ser um pagamento de um grupo cuja conta esta inutilizavel: NAO marca como processado e responde 503 para o
      // Mercado Pago reenviar (as retentativas dele sao finitas). A rede de seguranca e a reconciliacao (o Pix NUNCA vence
      // localmente sem resposta do provedor). Gatilho nao assinado: nada gravado (M5-a).
      if (anyVerified) {
        await this.pix.recordEvent({
          eventId,
          source: 'WEBHOOK',
          paymentId: dataId,
          organizationId: unavailable[0],
          financialRecordId: null,
          outcome: 'ACCOUNT_UNAVAILABLE',
          rawSafe: { ...rawSafeBase, payment: null },
          processed: false,
          signatureVerified,
        });
      }
      this.logger.warn(`Webhook: conta do provedor indisponivel para conferir o pagamento ${dataId}; o Mercado Pago reenviara.`);
      throw httpError(503, 'Service Unavailable', 'PAYMENTS_ACCOUNT_UNAVAILABLE', 'Tente novamente.');
    }

    if (!resolved && !anyVerified) {
      // Gatilho sem assinatura valida que nao resolveu a nada (404/FOREIGN): nao grava linha (M5-a, anti-DoS).
      return RECEIVED;
    }

    await this.pix.recordEvent({
      eventId,
      source: 'WEBHOOK',
      paymentId: dataId,
      organizationId: resolved?.organizationId ?? null,
      financialRecordId: resolved?.financialRecordId ?? null,
      outcome: resolved?.outcome ?? 'UNRESOLVED',
      rawSafe: { ...rawSafeBase, payment: resolved ? safePaymentSnapshot(resolved.payment) : null },
      signatureVerified,
      signatureProblem,
    });

    if (resolved && signatureProblem) {
      // Pix REAL deste grupo com a assinatura errada/ausente/ilegivel: o segredo do grupo esta errado (ou o MP nao assina
      // como esperado). Aviso UNICO por 24 h; segredo do SERVIDOR (OAUTH) so audita (o Mestre nao o controla).
      const candidate = candidates.find((c) => c.organizationId === resolved!.organizationId);
      const notify = signatureProblem === 'UNREADABLE' || candidate?.secretSource === 'GROUP';
      this.logger.warn(`Webhook: assinatura ${signatureProblem} para o grupo ${resolved.organizationId}; processado como gatilho.`);
      await this.accounts.alertSignatureProblem(resolved.organizationId, signatureProblem, {
        notify,
        windowMs: WEBHOOK_SIGNATURE_ALERT_WINDOW_MS,
      });
    }
    return RECEIVED;
  }

  private eventId(dataId: string, requestId: string | null, headers: WebhookInput['headers']): string {
    const signatureTs = /(?:^|,)\s*ts=(\d{1,16})/.exec(header(headers, 'x-signature') ?? '')?.[1] ?? null;
    return requestId
      ? `payment:${dataId}:request:${requestId}`
      : `payment:${dataId}:ts:${signatureTs ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;
  }

  /**
   * Gatilho (sem assinatura valida): no maximo N por grupo por minuto - `known` (pagamento ja ligado a um lancamento do
   * grupo) ou `unknown` (id desconhecido) - e 1 consulta do mesmo pagamento+grupo por cooldown. POR PROCESSO (cada replica
   * tem os seus contadores - documentado em docs/EASYPANEL.md). true = pode processar (e marca).
   */
  private claimTrigger(candidate: Candidate, paymentId: string, now: number): boolean {
    const limits = webhookUnsignedLimits();
    const key = `${candidate.organizationId}:${paymentId}`;
    const last = this.unsignedLastCheck.get(key);
    if (last !== undefined && now - last < limits.cooldownMs) return false;
    const windowKey = `${candidate.organizationId}:${candidate.knownPayment ? 'known' : 'unknown'}`;
    const max = candidate.knownPayment ? limits.known : limits.unknown;
    const window = this.unsignedWindow.get(windowKey);
    if (window && now - window.start < 60_000) {
      if (window.count >= max) return false;
      window.count += 1;
    } else {
      if (max <= 0) return false;
      this.unsignedWindow.set(windowKey, { start: now, count: 1 });
    }
    if (this.unsignedLastCheck.size > 5000) {
      for (const [k, at] of this.unsignedLastCheck) if (now - at >= limits.cooldownMs) this.unsignedLastCheck.delete(k);
    }
    if (this.unsignedWindow.size > 5000) {
      for (const [k, w] of this.unsignedWindow) if (now - w.start >= 60_000) this.unsignedWindow.delete(k);
    }
    this.unsignedLastCheck.set(key, now);
    return true;
  }

  /**
   * Organizacoes que podem ser donas do pagamento, em ordem: a do `?org=` (se tiver conta ativa), as do lancamento que ja
   * tem esse gatewayPaymentId e NO MAXIMO UMA conta do vendedor `user_id` (M5-c). So PISTAS: a confirmacao vem de buscar
   * o pagamento com o token de cada uma. Cada uma leva o segredo de assinatura que vale para ela (A1/B5: MANUAL = so o
   * proprio; OAUTH = so o global).
   */
  private async candidates(orgParam: number | null, paymentId: string, sellerId: string | null): Promise<Candidate[]> {
    const activeStatuses = [PaymentAccountStatus.CONNECTED, PaymentAccountStatus.ERROR];
    const [orgAccount, records, sellerAccounts] = await Promise.all([
      orgParam
        ? this.prisma.paymentProviderAccount.findFirst({
            where: { organizationId: orgParam, provider: this.provider.id, status: { in: activeStatuses } },
            select: { organizationId: true },
          })
        : Promise.resolve(null),
      this.prisma.financialRecord.findMany({
        where: { gatewayProvider: this.provider.id, gatewayPaymentId: paymentId },
        select: { organizationId: true },
        take: MAX_CANDIDATES,
      }),
      sellerId
        ? this.prisma.paymentProviderAccount.findMany({
            // ERROR tambem: a conta pode ser reconectada (o webhook responde 503 e o MP reenvia - A1-a de 10.53).
            where: { provider: this.provider.id, providerUserId: sellerId, status: { in: activeStatuses } },
            select: { organizationId: true },
            orderBy: { id: 'asc' },
            take: 1,
          })
        : Promise.resolve([]),
    ]);
    const known = new Set(records.map((r) => r.organizationId));
    const ids = [
      ...new Set([...(orgAccount ? [orgAccount] : []), ...records, ...sellerAccounts].map((r) => r.organizationId)),
    ].slice(0, MAX_CANDIDATES);
    if (ids.length === 0) return [];
    const accounts = await this.prisma.paymentProviderAccount.findMany({
      where: { provider: this.provider.id, organizationId: { in: ids } },
      select: { id: true, organizationId: true, webhookSecretEnc: true, status: true, mode: true },
    });
    const global = webhookSecret();
    const out: Candidate[] = [];
    for (const organizationId of ids) {
      const account = accounts.find((a) => a.organizationId === organizationId);
      const base = { organizationId, knownPayment: known.has(organizationId) };
      if (!account || account.status === PaymentAccountStatus.REVOKED) {
        out.push({ ...base, secret: null, secretSource: null, unreadable: false });
      } else if (account.mode === PaymentAccountMode.OAUTH) {
        // B5: OAUTH so com o segredo do servidor (um segredo proprio antigo e ignorado).
        out.push({ ...base, secret: global, secretSource: global ? 'GLOBAL' : null, unreadable: false });
      } else {
        // A1: grupo MANUAL nunca usa o global (a aplicacao do MP do grupo tem outro segredo).
        const own = await this.accounts.readWebhookSecret(account);
        if (own === 'unreadable') {
          this.logger.warn(`Webhook: segredo do grupo ${organizationId} ilegivel (chave trocada?); processado como gatilho.`);
          out.push({ ...base, secret: null, secretSource: 'GROUP', unreadable: true });
        } else {
          out.push({ ...base, secret: own, secretSource: own ? 'GROUP' : null, unreadable: false });
        }
      }
    }
    return out;
  }
}
