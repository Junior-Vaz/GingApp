import { IsFutureDate } from '../../../../shared/dates/future-date';
import { IsDateString, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePlatformAnnouncementDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsString()
  @MinLength(2)
  body!: string;

  /** Ausente/undefined = aviso global (todos os grupos da plataforma). */
  @IsOptional()
  @IsInt()
  targetOrganizationId?: number;

  @IsOptional()
  @IsDateString()
  publishedAt?: string;

  @IsOptional()
  @IsDateString()
  @IsFutureDate()
  expiresAt?: string;
}
