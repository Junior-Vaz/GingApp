import { Injectable } from '@nestjs/common';
import {
  MP_API_BASE,
  MP_CANCEL_BODY,
  mapMpPayment,
  mapMpTokens,
  mapMpUser,
  mpAuthorizeUrl,
  mpPixPaymentBody,
  mpTokenBody,
} from './mercadopago.mapping';
import {
  CreatePixPaymentInput,
  PaymentProvider,
  PaymentProviderError,
  ProviderPayment,
  ProviderTokens,
  ValidatedCredentials,
} from './payment-provider.interface';
import { MercadoPagoAppConfig, mercadoPagoAppConfig } from './payments.config';

const TIMEOUT_MS = 10_000;

/**
 * Mercado Pago via `fetch` nativo (sem SDK). URLs FIXAS (MP_API_BASE/MP_AUTH_BASE): nenhuma URL vem do usuario (sem
 * SSRF). Erros viram PaymentProviderError SEM token/segredo na mensagem (so metodo, rota sem query e status/codigo do MP).
 * Os nomes de campo vivem em mercadopago.mapping.ts.
 */
@Injectable()
export class MercadoPagoProvider implements PaymentProvider {
  readonly id = 'mercadopago';

  isOAuthConfigured(): boolean {
    return mercadoPagoAppConfig() !== null;
  }

  /** Modo MANUAL: GET /users/me com o token colado (401/403 => UNAUTHORIZED; o token nunca vai para a mensagem). */
  async validateCredentials(input: { accessToken: string }): Promise<ValidatedCredentials> {
    const body = await this.request('GET', '/users/me', { accessToken: input.accessToken });
    const user = mapMpUser(body);
    return { providerUserId: user.providerUserId, nickname: user.nickname };
  }

  private app(): MercadoPagoAppConfig {
    const app = mercadoPagoAppConfig();
    if (!app) throw new PaymentProviderError('Mercado Pago nao configurado no servidor.', 'NOT_CONFIGURED');
    return app;
  }

  buildAuthorizeUrl(state: string): string {
    const app = this.app();
    return mpAuthorizeUrl({ clientId: app.clientId, redirectUri: app.redirectUri, state });
  }

  async exchangeCode(code: string): Promise<ProviderTokens> {
    const body = await this.request('POST', '/oauth/token', { body: mpTokenBody(this.app(), { code }), oauth: true });
    return mapMpTokens(body);
  }

  async refreshToken(refreshToken: string): Promise<ProviderTokens> {
    const body = await this.request('POST', '/oauth/token', { body: mpTokenBody(this.app(), { refreshToken }), oauth: true });
    return mapMpTokens(body);
  }

  async createPixPayment(input: CreatePixPaymentInput): Promise<ProviderPayment> {
    const body = await this.request('POST', '/v1/payments', {
      body: mpPixPaymentBody(input),
      accessToken: input.accessToken,
      idempotencyKey: input.idempotencyKey,
    });
    return mapMpPayment(body);
  }

  async getPayment(input: { accessToken: string; paymentId: string }): Promise<ProviderPayment> {
    const body = await this.request('GET', `/v1/payments/${encodeURIComponent(input.paymentId)}`, { accessToken: input.accessToken });
    return mapMpPayment(body);
  }

  async cancelPayment(input: { accessToken: string; paymentId: string }): Promise<ProviderPayment> {
    const body = await this.request('PUT', `/v1/payments/${encodeURIComponent(input.paymentId)}`, {
      body: MP_CANCEL_BODY,
      accessToken: input.accessToken,
    });
    return mapMpPayment(body);
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    options: { body?: unknown; accessToken?: string; idempotencyKey?: string; oauth?: boolean },
  ): Promise<unknown> {
    const label = `${method} ${path.replace(/\/\d+$/, '/:id')}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
    if (options.idempotencyKey) headers['X-Idempotency-Key'] = options.idempotencyKey;

    let response: Response;
    try {
      response = await fetch(`${MP_API_BASE}${path}`, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError' ? 'tempo esgotado' : 'falha de rede';
      throw new PaymentProviderError(`Mercado Pago indisponivel (${label}: ${reason}).`, 'TRANSIENT');
    }

    let parsed: unknown = null;
    const text = await response.text().catch(() => '');
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (response.ok) {
      if (parsed === null) throw new PaymentProviderError(`Resposta invalida do Mercado Pago (${label}).`, 'TRANSIENT', response.status);
      return parsed;
    }

    // So o codigo de erro do MP (ex.: 'invalid_grant', 'bad_request') - nunca o corpo inteiro (pode ecoar dados).
    const errorCode = parsed && typeof (parsed as Record<string, unknown>).error === 'string'
      ? String((parsed as Record<string, unknown>).error).slice(0, 60)
      : '';
    const message = `Mercado Pago recusou (${label}: HTTP ${response.status}${errorCode ? ` ${errorCode}` : ''}).`;
    const status = response.status;
    if (status === 429 || status >= 500) throw new PaymentProviderError(message, 'TRANSIENT', status);
    if (options.oauth && (status === 400 || status === 401) && /invalid_grant|invalid_client|unauthorized/i.test(errorCode || 'invalid_grant')) {
      throw new PaymentProviderError(message, 'INVALID_GRANT', status);
    }
    if (status === 401 || status === 403) throw new PaymentProviderError(message, 'UNAUTHORIZED', status);
    if (status === 404) throw new PaymentProviderError(message, 'NOT_FOUND', status);
    if (status === 400 || status === 422) throw new PaymentProviderError(message, 'BAD_REQUEST', status);
    throw new PaymentProviderError(message, 'UNKNOWN', status);
  }
}
