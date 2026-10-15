import { FinancialRecord, FinancialStatus, PaidVia } from '@prisma/client';

/** Status do Pix de um lancamento, como a UI ve (contrato de PLANO_PROJETO.md 10.52). */
export type PixViewStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';

/**
 * Status crus do provedor em que o Pix ainda pode ser pago. Locais (fora desta lista): 'expired' (vencido) e
 * 'approved_mismatch' (aprovado com valor diferente do lancamento: alerta ao Mestre, sai da fila da reconciliacao).
 */
export const PIX_OPEN_GATEWAY_STATUSES = ['pending', 'in_process', 'authorized', 'in_mediation'];

type PixFields = Pick<
  FinancialRecord,
  'status' | 'paidVia' | 'gatewayStatus' | 'pixGeneratedAt' | 'pixExpiresAt'
>;

/**
 * SSOT da situacao do Pix (lista, "meu financeiro" e /pix): null = nunca gerado. PAID so quando a baixa veio do Pix;
 * lancamento pago a mao / cancelado / Pix recusado-cancelado = CANCELLED; passou da validade = EXPIRED.
 */
export function pixStatusOf(record: PixFields, now: Date = new Date()): PixViewStatus | null {
  if (!record.pixGeneratedAt) return null;
  if (record.status === FinancialStatus.PAID) return record.paidVia === PaidVia.PIX_AUTO ? 'PAID' : 'CANCELLED';
  if (record.status === FinancialStatus.CANCELLED) return 'CANCELLED';
  if (record.gatewayStatus === 'expired') return 'EXPIRED';
  if (!PIX_OPEN_GATEWAY_STATUSES.includes(record.gatewayStatus ?? '')) return 'CANCELLED';
  if (record.pixExpiresAt && record.pixExpiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'PENDING';
}

/** Campos internos do Pix/gateway que NUNCA saem crus pelas rotas de lancamento (o QR so vem de /finance/:id/pix). */
const HIDDEN_KEYS = [
  'gatewayProvider',
  'gatewayPaymentId',
  'gatewayStatus',
  'pixQrCode',
  'pixQrCodeBase64',
  'pixTicketUrl',
  'pixExpiresAt',
  'pixGeneratedAt',
  'pixAmountCents',
  'pixSeq',
  'pixLastCheckedAt',
] as const;

type HiddenKey = (typeof HIDDEN_KEYS)[number];

export type FinanceRecordView<T extends FinancialRecord> = Omit<T, HiddenKey | 'paidVia'> & {
  /** Origem da baixa: so com status PAID (PAID antigo sem a coluna = MANUAL). */
  paidVia: PaidVia | null;
  pix: { status: PixViewStatus; expiresAt: string; generatedAt: string } | null;
};

/**
 * Forma PUBLICA de um lancamento (GET /finance, /finance/me, /finance/:id, criar/editar/baixar/estornar/cancelar):
 * os campos de antes + `paidVia` + `pix` resumido; sem copia-e-cola/QR/ids do provedor.
 */
export function toFinanceRecordView<T extends FinancialRecord>(record: T, now: Date = new Date()): FinanceRecordView<T> {
  const out: Record<string, unknown> = { ...record };
  for (const key of HIDDEN_KEYS) delete out[key];
  const status = pixStatusOf(record, now);
  out.paidVia = record.status === FinancialStatus.PAID ? (record.paidVia ?? PaidVia.MANUAL) : null;
  out.pix =
    status && record.pixGeneratedAt
      ? {
          status,
          expiresAt: (record.pixExpiresAt ?? record.pixGeneratedAt).toISOString(),
          generatedAt: record.pixGeneratedAt.toISOString(),
        }
      : null;
  return out as FinanceRecordView<T>;
}
