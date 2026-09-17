import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateFeatureOverrideDto {
  @IsString()
  @MinLength(2)
  featureKey!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}
