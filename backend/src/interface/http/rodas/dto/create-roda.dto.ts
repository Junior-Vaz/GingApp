import { IsDateString, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { IsImageRef } from '../../../../shared/uploads/image-ref';

export class CreateRodaDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsInt()
  stateId?: number;

  @IsOptional()
  @IsInt()
  cityId?: number;

  @IsOptional()
  @IsInt()
  communityId?: number;

  @IsOptional()
  @IsImageRef()
  imageUrl?: string;
}
