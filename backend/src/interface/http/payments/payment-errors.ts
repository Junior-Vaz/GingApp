import { HttpException } from '@nestjs/common';
import { PaymentProviderError } from '../../../shared/payments/payment-provider.interface';

/**
 * Codigos ESTAVEIS do modulo de pagamentos (campo `code` do corpo de erro padrao do projeto:
 * { statusCode, error, code, message }). A UI decide a mensagem/acao pelo `code` (contrato de PLANO_PROJETO.md 10.52).
 */
export const PaymentErrorCode = {
  /** Servidor sem credenciais do provedor (MERCADOPAGO_CLIENT_ID/SECRET/REDIRECT_URI). */
  PAYMENTS_UNAVAILABLE: 'PAYMENTS_UNAVAILABLE',
  /** O grupo nao conectou a conta do Mercado Pago (ou desconectou). */
  MP_NOT_CONNECTED: 'MP_NOT_CONNECTED',
  /** A conta conectada falhou (renovacao do token recusada): o Mestre precisa reconectar. */
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
} as const;

export type PaymentErrorCodeValue = (typeof PaymentErrorCode)[keyof typeof PaymentErrorCode];

const ERROR_NAMES: Record<number, string> = {
  400: 'Bad Request',
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
