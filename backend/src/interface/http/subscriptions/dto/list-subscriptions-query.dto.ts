import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Maior Int do Postgres (colunas id): acima disso o Prisma lançaria erro (500). */
const MAX_DB_ID = 2_147_483_647;

/** GET /subscriptions?organizationId= — filtra as assinaturas de UM grupo (plataforma). */
export class ListSubscriptionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'organizationId deve ser um número inteiro.' })
  @Min(1, { message: 'organizationId deve ser maior que zero.' })
  @Max(MAX_DB_ID, { message: 'organizationId inválido.' })
  organizationId?: number;
}
