import { IsBoolean, IsDefined, IsOptional } from 'class-validator';

/**
 * PUT /platform-settings/:key. `value` é qualquer JSON (objeto, array, string, número, booleano),
 * exceto null/ausente; o limite de tamanho (~10KB serializado) é checado no service.
 * `isSecret` omitido = mantém o atual (false ao criar).
 */
export class UpsertPlatformSettingDto {
  @IsDefined({ message: 'value é obrigatório (qualquer JSON, exceto null).' })
  value!: unknown;

  @IsOptional()
  @IsBoolean()
  isSecret?: boolean;
}
