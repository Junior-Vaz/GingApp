import { IsBoolean, IsOptional, IsString } from 'class-validator';

/** featureKey nunca muda num override existente — trocar a chave é apagar e criar outro
 * (a chave é o que identifica *qual* feature está sendo sobrescrita). */
export class UpdateFeatureOverrideDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}
