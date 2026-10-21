import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** GET /birthdays?month=1..12&unitId&classId. Sem `month` = mes corrente (America/Sao_Paulo). */
export class ListBirthdaysQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  classId?: number;
}

/** POST /birthdays/:personId/greet. Sem `message` usa a mensagem padrao do grupo. */
export class GreetBirthdayDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  message?: string;
}

/** PUT /birthdays/settings (MESTRE): atualizacao parcial; `autoGreetingMessage` vazia volta para a mensagem padrao. */
export class UpdateBirthdaySettingsDto {
  @IsOptional()
  @IsBoolean()
  dailyDigest?: boolean;

  @IsOptional()
  @IsBoolean()
  autoGreeting?: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  autoGreetingMessage?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  autoGreetingHour?: number;
}
