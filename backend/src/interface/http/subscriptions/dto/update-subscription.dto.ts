import { IsIn, IsInt, IsOptional } from 'class-validator';

/** Update administrativo: trocar de plano (upgrade/downgrade) e/ou forçar um status (ex.:
 * marcar PAST_DUE manualmente após falha de cobrança). Cancelamento tem endpoint próprio
 * (POST /subscriptions/:id/cancel) por precisar chamar o gateway — não passa por aqui. */
export class UpdateSubscriptionDto {
  @IsOptional()
  @IsInt()
  planId?: number;

  @IsOptional()
  @IsIn(['TRIALING', 'ACTIVE', 'PAST_DUE', 'EXPIRED'])
  status?: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED';
}
