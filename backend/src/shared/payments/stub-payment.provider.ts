import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  CreatePixPaymentInput,
  PaymentProvider,
  PaymentProviderError,
  ProviderPayment,
  ProviderPaymentStatus,
  ProviderTokens,
  ValidatedCredentials,
} from './payment-provider.interface';
import { mercadoPagoAppConfig } from './payments.config';

interface StubPayment extends ProviderPayment {
  /** Token do vendedor dono do pagamento: getPayment com outro token = 404 (como um provedor real). */
  ownerToken: string;
}

const RAW: Record<ProviderPaymentStatus, string> = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  CHARGED_BACK: 'charged_back',
  UNKNOWN: 'unknown',
};

/**
 * Provedor SIMULADO (sem rede) para dev e testes: PAYMENTS_PROVIDER=stub (padrao fora de producao; proibido em
 * producao - payments.config.ts). Comportamento deterministico:
 *  - Modo MANUAL: ver validateCredentials (`TEST-...-<userId>` / `APP_USR-...-<userId>`; `INVALID` => 401).
 *  - OAuth (so com as envs do OAuth, como o real): `code` comecando com 'bad' => INVALID_GRANT; `ok-<userId>` =>
 *    vendedor <userId>; outro => vendedor '9000'.
 *  - Pix: guardado em memoria por id; mesma chave de idempotencia => o MESMO pagamento (como o provedor real).
 *  - getPayment com token de outro vendedor => NOT_FOUND.
 * Os metodos `setStatus`/`seedPayment` existem SO para testes/dev (nao ha rota HTTP para eles).
 */
@Injectable()
export class StubPaymentProvider implements PaymentProvider {
  readonly id = 'stub';
  private readonly payments = new Map<string, StubPayment>();
  private readonly byIdempotencyKey = new Map<string, string>();
  private counter = 0;
  /** Ultimos tokens emitidos (os testes conferem que NAO aparecem em claro no banco/respostas). */
  lastTokens: ProviderTokens | null = null;
  /** Chamadas de createPixPayment (os testes conferem a idempotencia / o corpo enviado). */
  readonly createCalls: CreatePixPaymentInput[] = [];
  /** Falha simulada na proxima chamada de refreshToken. */
  failNextRefresh: 'INVALID_GRANT' | 'TRANSIENT' | null = null;
  /** Falha simulada na proxima validateCredentials (modo MANUAL). */
  failNextValidate: 'TRANSIENT' | null = null;
  /** Tokens manuais "revogados no provedor" (o Mestre gerou outro / apagou a aplicacao): qualquer uso => 401. */
  readonly revokedTokens = new Set<string>();
  /** Chamadas de refreshToken (os testes conferem que conta MANUAL nunca renova). */
  refreshCalls = 0;
  /** Tokens que o provedor responde 403 (politica/permissao, NAO revogacao) em qualquer uso, inclusive /users/me. */
  readonly forbiddenTokens = new Set<string>();
  /** Chamado DEPOIS de criar o Pix e ANTES de devolve-lo (simula algo concorrente durante a chamada ao provedor). */
  onPixCreated: ((payment: ProviderPayment) => Promise<void>) | null = null;

  /** Igual ao provedor real: o OAuth so fica ativo com MERCADOPAGO_CLIENT_ID/SECRET/REDIRECT_URI no ambiente. */
  isOAuthConfigured(): boolean {
    return mercadoPagoAppConfig() !== null;
  }

  /**
   * Modo MANUAL simulado: token `TEST-...` ou `APP_USR-...` com >= 10 caracteres e valido; o dono e o numero final do
   * token (`...-<userId>`, como os tokens reais do MP) ou '9000'. Contem `INVALID` / outro formato / revogado =>
   * UNAUTHORIZED (401). `failNextValidate` simula o provedor fora do ar.
   */
  async validateCredentials(input: { accessToken: string }): Promise<ValidatedCredentials> {
    const failure = this.failNextValidate;
    this.failNextValidate = null;
    if (failure === 'TRANSIENT') throw new PaymentProviderError('Provedor indisponivel (stub).', 'TRANSIENT', 503);
    if (this.forbiddenTokens.has(input.accessToken)) {
      throw new PaymentProviderError('Mercado Pago recusou (GET /users/me: HTTP 403) (stub).', 'UNAUTHORIZED', 403);
    }
    const seller = this.manualSellerOf(input.accessToken);
    if (!seller) throw new PaymentProviderError('Mercado Pago recusou (GET /users/me: HTTP 401) (stub).', 'UNAUTHORIZED', 401);
    return { providerUserId: seller, nickname: `stub-${seller}` };
  }

  /** Dono de um token manual valido (ver validateCredentials) ou null. */
  private manualSellerOf(accessToken: string): string | null {
    if (!/^(TEST|APP_USR)-/.test(accessToken) || accessToken.length < 10 || /INVALID/.test(accessToken)) return null;
    if (this.revokedTokens.has(accessToken)) return null;
    return /-(\d{1,15})$/.exec(accessToken)?.[1] ?? '9000';
  }

  buildAuthorizeUrl(state: string): string {
    return `https://stub-payments.local/authorization?response_type=code&state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(code: string): Promise<ProviderTokens> {
    if (code.startsWith('bad')) throw new PaymentProviderError('Codigo de autorizacao invalido (stub).', 'INVALID_GRANT', 400);
    const match = /^ok-(\d{1,15})$/.exec(code);
    return this.issueTokens(match ? match[1] : '9000');
  }

  async refreshToken(refreshToken: string): Promise<ProviderTokens> {
    this.refreshCalls += 1;
    const failure = this.failNextRefresh;
    this.failNextRefresh = null;
    if (failure === 'INVALID_GRANT') throw new PaymentProviderError('refresh_token invalido (stub).', 'INVALID_GRANT', 400);
    if (failure === 'TRANSIENT') throw new PaymentProviderError('Provedor indisponivel (stub).', 'TRANSIENT', 503);
    const match = /^stub-refresh-(\d+)-/.exec(refreshToken);
    if (!match) throw new PaymentProviderError('refresh_token invalido (stub).', 'INVALID_GRANT', 400);
    return this.issueTokens(match[1]);
  }

  private issueTokens(userId: string): ProviderTokens {
    const tokens: ProviderTokens = {
      accessToken: `stub-access-${userId}-${randomBytes(8).toString('hex')}`,
      refreshToken: `stub-refresh-${userId}-${randomBytes(8).toString('hex')}`,
      expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
      providerUserId: userId,
      publicKey: `TEST-stub-${userId}`,
      liveMode: false,
    };
    this.lastTokens = tokens;
    return tokens;
  }

  /** Dono do token: OAuth simulado (`stub-access-<userId>-...`) ou token manual (`TEST-`/`APP_USR-...-<userId>`). */
  private sellerOf(accessToken: string): string {
    if (this.forbiddenTokens.has(accessToken)) throw new PaymentProviderError('Acesso negado (stub).', 'UNAUTHORIZED', 403);
    const match = /^stub-access-(\d+)-/.exec(accessToken);
    if (match) return match[1];
    const manual = this.manualSellerOf(accessToken);
    if (!manual) throw new PaymentProviderError('Token invalido (stub).', 'UNAUTHORIZED', 401);
    return manual;
  }

  async createPixPayment(input: CreatePixPaymentInput): Promise<ProviderPayment> {
    const seller = this.sellerOf(input.accessToken);
    this.createCalls.push({ ...input, accessToken: '[omitido]' });
    const known = this.byIdempotencyKey.get(`${seller}:${input.idempotencyKey}`);
    if (known && this.payments.has(known)) return this.view(this.payments.get(known)!);
    const id = this.nextId();
    const payment: StubPayment = {
      id,
      status: 'PENDING',
      rawStatus: 'pending',
      statusDetail: 'pending_waiting_transfer',
      amountCents: input.amountCents,
      externalReference: input.externalReference,
      collectorId: seller,
      approvedAt: null,
      expiresAt: input.expiresAt,
      liveMode: false,
      pix: {
        qrCode: `00020126STUBPIX${id}5204000053039865802BR6009SAO PAULO`,
        qrCodeBase64: Buffer.from(`stub-qr-${id}`).toString('base64'),
        ticketUrl: `https://stub-payments.local/pix/${id}`,
      },
      ownerToken: input.accessToken,
    };
    this.payments.set(id, payment);
    this.byIdempotencyKey.set(`${seller}:${input.idempotencyKey}`, id);
    if (this.onPixCreated) await this.onPixCreated(this.view(payment));
    return this.view(payment);
  }

  async getPayment(input: { accessToken: string; paymentId: string }): Promise<ProviderPayment> {
    return this.view(this.owned(input.accessToken, input.paymentId));
  }

  async cancelPayment(input: { accessToken: string; paymentId: string }): Promise<ProviderPayment> {
    const payment = this.owned(input.accessToken, input.paymentId);
    if (payment.status !== 'PENDING') {
      throw new PaymentProviderError('Pagamento nao esta pendente (stub).', 'BAD_REQUEST', 400);
    }
    payment.status = 'CANCELLED';
    payment.rawStatus = 'cancelled';
    payment.statusDetail = 'by_collector';
    return this.view(payment);
  }

  private owned(accessToken: string, paymentId: string): StubPayment {
    const seller = this.sellerOf(accessToken);
    const payment = this.payments.get(paymentId);
    if (!payment || payment.collectorId !== seller) {
      throw new PaymentProviderError('Pagamento nao encontrado (stub).', 'NOT_FOUND', 404);
    }
    return payment;
  }

  private nextId(): string {
    this.counter += 1;
    return `${Date.now()}${String(this.counter).padStart(4, '0')}`;
  }

  private view(payment: StubPayment): ProviderPayment {
    const { ownerToken: _owner, ...rest } = payment;
    return { ...rest, pix: rest.pix ? { ...rest.pix } : null };
  }

  // ---------------------------------------------------------------------------------------------
  // Apoio a testes/dev
  // ---------------------------------------------------------------------------------------------

  /** Muda o status de um pagamento (ex.: o pagador pagou => APPROVED). */
  setStatus(paymentId: string, status: ProviderPaymentStatus, approvedAt: Date = new Date()): void {
    const payment = this.payments.get(paymentId);
    if (!payment) throw new Error(`Pagamento stub ${paymentId} inexistente.`);
    payment.status = status;
    payment.rawStatus = RAW[status];
    payment.approvedAt = status === 'APPROVED' ? approvedAt : payment.approvedAt;
  }

  /** Cria um pagamento "por fora" (ex.: referencia/valor forjados) na conta do vendedor do `sellerUserId`. */
  seedPayment(input: { sellerUserId: string; amountCents: number; externalReference: string; status?: ProviderPaymentStatus }): string {
    const id = this.nextId();
    const status = input.status ?? 'APPROVED';
    this.payments.set(id, {
      id,
      status,
      rawStatus: RAW[status],
      statusDetail: null,
      amountCents: input.amountCents,
      externalReference: input.externalReference,
      collectorId: input.sellerUserId,
      approvedAt: status === 'APPROVED' ? new Date() : null,
      expiresAt: null,
      liveMode: false,
      pix: null,
      ownerToken: '',
    });
    return id;
  }
}
