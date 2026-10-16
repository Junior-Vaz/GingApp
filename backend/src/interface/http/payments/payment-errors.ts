import { HttpException } from '@nestjs/common';
import { PaymentProviderError } from '../../../shared/payments/payment-provider.interface';

/**
 * Codigos ESTAVEIS do modulo de pagamentos (campo `code` do corpo de erro padrao do projeto:
 * { statusCode, error, code, message }). A UI decide a mensagem/acao pelo `code` (contrato de PLANO_PROJETO.md 10.52).
 */
export const PaymentErrorCode = {
  /** Pagamentos online desligados no servidor (PAYMENTS_PROVIDER invalido). Nao depende de credencial no ambiente. */
  PAYMENTS_UNAVAILABLE: 'PAYMENTS_UNAVAILABLE',
  /** POST /connect (OAuth) sem MERCADOPAGO_CLIENT_ID/SECRET/REDIRECT_URI no servidor: use as credenciais manuais. */
  OAUTH_UNAVAILABLE: 'OAUTH_UNAVAILABLE',
  /** PUT /credentials: Access Token recusado pelo Mercado Pago (ou de TESTE em producao). */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** PUT /credentials: o grupo ainda nao tem conta e o corpo veio sem accessToken. */
  ACCESS_TOKEN_REQUIRED: 'ACCESS_TOKEN_REQUIRED',
  /** Troca para OUTRA conta do Mercado Pago com Pix ainda pagavel da conta atual (o OAuth usa `?mp=pix-aberto`). */
  PIX_OPEN_ACCOUNT_CHANGE: 'PIX_OPEN_ACCOUNT_CHANGE',
  /** O grupo nao conectou a conta do Mercado Pago (ou desconectou). */
  MP_NOT_CONNECTED: 'MP_NOT_CONNECTED',
  /** A conta conectada falhou (token recusado/ilegivel ou renovacao recusada): o Mestre cola as credenciais de novo. */
  MP_ACCOUNT_ERROR: 'MP_ACCOUNT_ERROR',
  /** Lancamento cancelado / sem valor: nao aceita Pix. */
  RECORD_NOT_PAYABLE: 'RECORD_NOT_PAYABLE',
  ALREADY_PAID: 'ALREADY_PAID',
  /** Valor abaixo do minimo aceito pelo provedor para Pix. */
  AMOUNT_TOO_LOW: 'AMOUNT_TOO_LOW',
  /** Sem e-mail do aluno/responsavel nem PAYMENTS_FALLBACK_PAYER_EMAIL. */
  PAYER_EMAIL_REQUIRED: 'PAYER_EMAIL_REQUIRED',
  /** GET /pix de um lancamento que nunca teve Pix gerado. */
  PIX_NOT_FOUND: 'PIX_NOT_FOUND',
  /** Ha um Pix pendente com o valor ANTIGO que nao pode ser cancelado agora; tente de novo em instantes. */
  PIX_PENDING_AMOUNT_CHANGED: 'PIX_PENDING_AMOUNT_CHANGED',
  /** O lancamento mudou durante a geracao (pago/cancelado/valor alterado) ou desde que o formulario foi aberto (PATCH). */
  RECORD_CHANGED: 'RECORD_CHANGED',
  /** PATCH tentou tirar de PAID (ou mudar o valor de) um lancamento pago pelo Pix automatico: so pelo /refund. */
  RECORD_PAID_VIA_PIX: 'RECORD_PAID_VIA_PIX',
  /** DELETE de lancamento com Pix ainda pagavel ou pago via Pix: cancelar/estornar antes. */
  RECORD_HAS_PIX: 'RECORD_HAS_PIX',
  /** Provedor fora do ar / tempo esgotado (tente de novo). */
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  /** Provedor recusou o pedido (dados invalidos, conta sem Pix habilitado, etc.). */
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  /** PUT /credentials com accessToken sem `currentPassword` (reautenticacao obrigatoria - 10.56, M6). 403. */
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  /** PUT /credentials: `currentPassword` incorreta. 403. */
  INVALID_PASSWORD: 'INVALID_PASSWORD',
  /** PUT /credentials: o Mestre tem 2FA ativo e nao mandou `twoFactorCode`. 403. */
  TWO_FACTOR_REQUIRED: 'TWO_FACTOR_REQUIRED',
  /** PUT /credentials: `twoFactorCode` incorreto. 403 (excesso de falhas = 429 do 2FA). */
  INVALID_TWO_FACTOR_CODE: 'INVALID_TWO_FACTOR_CODE',
  /** Assinatura do webhook propria em conta OAUTH (nao suportado: OAUTH usa so o segredo do servidor - 10.56, B5). */
  WEBHOOK_SECRET_NOT_SUPPORTED: 'WEBHOOK_SECRET_NOT_SUPPORTED',
  /** A conta do Mercado Pago do grupo foi trocada/desconectada enquanto o Pix era gerado (o Pix criado foi cancelado). */
  ACCOUNT_CHANGED: 'ACCOUNT_CHANGED',
} as const;

export type PaymentErrorCodeValue = (typeof PaymentErrorCode)[keyof typeof PaymentErrorCode];

const ERROR_NAMES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

export function paymentError(statusCode: number, code: PaymentErrorCodeValue, message: string): HttpException {
  return new HttpException({ statusCode, error: ERROR_NAMES[statusCode] ?? 'Error', code, message }, statusCode);
}

/** Erro do provedor -> HTTP com codigo estavel (mensagem SEM detalhes internos/segredos). */
export function providerHttpError(error: unknown): HttpException {
  if (error instanceof PaymentProviderError && error.kind === 'NOT_CONFIGURED') {
    return paymentError(503, PaymentErrorCode.PAYMENTS_UNAVAILABLE, 'Pagamentos online não estão configurados no servidor.');
  }
  if (error instanceof PaymentProviderError && error.transient) {
    return paymentError(503, PaymentErrorCode.PROVIDER_UNAVAILABLE, 'O Mercado Pago não respondeu. Tente de novo em instantes.');
  }
  return paymentError(502, PaymentErrorCode.PROVIDER_ERROR, 'O Mercado Pago recusou a operação. Confira a conta conectada do grupo.');
}
