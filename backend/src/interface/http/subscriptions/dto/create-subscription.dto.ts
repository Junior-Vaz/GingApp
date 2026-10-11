import { IsIn, IsInt, IsOptional, Max } from 'class-validator';

export class CreateSubscriptionDto {
  @IsInt()
  @Max(2147483647)
  organizationId!: number;

  @IsInt()
  @Max(2147483647)
  planId!: number;

  /** Assinatura criada manualmente pela equipe PLATFORM já nasce ACTIVE por padrão — o fluxo
   * de trial self-service (TRIALING) fica para quando houver onboarding público (Fase 3). */
  @IsOptional()
  @IsIn(['TRIALING', 'ACTIVE'])
  status?: 'TRIALING' | 'ACTIVE';
}
