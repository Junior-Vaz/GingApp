import { PaymentMethod } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * POST /finance/:id/pay — baixa (marcar como pago). `paidAt` é a data civil do pagamento (padrão: hoje em
 * São Paulo; não pode ser futura). `paidCents` é o valor efetivamente recebido (padrão: o valor do lançamento).
 */
export class PayFinanceRecordDto {
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  paidCents?: number;
}
