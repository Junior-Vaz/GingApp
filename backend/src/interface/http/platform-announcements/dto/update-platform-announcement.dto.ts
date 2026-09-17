import { IsBoolean, IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

/** targetOrganizationId nunca muda num update — trocar o público-alvo depois de publicado
 * seria confuso (quem já recebeu a notificação recebeu para o alvo original). Para um alvo
 * diferente, crie um novo aviso. */
export class UpdatePlatformAnnouncementDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  body?: string;

  @IsOptional()
  @IsDateString()
  publishedAt?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
