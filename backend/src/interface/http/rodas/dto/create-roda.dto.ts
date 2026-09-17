import { IsDateString, IsInt, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

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
  @IsUrl()
  imageUrl?: string;
}
