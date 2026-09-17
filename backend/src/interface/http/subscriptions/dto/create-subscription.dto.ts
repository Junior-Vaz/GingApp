import { IsIn, IsInt, IsOptional } from 'class-validator';

export class CreateSubscriptionDto {
  @IsInt()
  organizationId!: number;

  @IsInt()
  planId!: number;

  /** Assinatura criada manualmente pela equipe PLATFORM já nasce ACTIVE por padrão — o fluxo
   * de trial self-service (TRIALING) fica para quando houver onboarding público (Fase 3). */
  @IsOptional()
  @IsIn(['TRIALING', 'ACTIVE'])
  status?: 'TRIALING' | 'ACTIVE';
}
