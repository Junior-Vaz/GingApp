import { RopeStyle } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Matches, Min, MinLength, ValidateIf } from 'class-validator';
import { HEX_COLOR_RE, MAX_ROPE_COLORS } from '../rope';

/**
 * Update parcial. name/order nao aceitam null (400). Corda: `style` e/ou `colors` (1 a 3 hex); `color` (legado) so
 * sozinho = corda SOLID dessa cor; `null` em color e' ignorado (a corda nunca fica sem cor).
 */
export class UpdateGraduationLevelDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  name?: string;

  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @Matches(HEX_COLOR_RE, { message: 'color deve ser hexadecimal (#RRGGBB).' })
  color?: string | null;

  @IsOptional()
  @IsEnum(RopeStyle)
  style?: RopeStyle;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ROPE_COLORS)
  @Matches(HEX_COLOR_RE, { each: true, message: 'cada cor de colors deve ser hexadecimal (#RRGGBB).' })
  colors?: string[];
}
