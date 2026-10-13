import { RopeStyle } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Matches, Min, MinLength, ValidateIf } from 'class-validator';
import { HEX_COLOR_RE, MAX_ROPE_COLORS } from '../rope';

/**
 * Nível de graduação. Corda: `style` + `colors` (1 a 3 hex #RRGGBB, a ordem importa); `color` (legado) continua aceito
 * — se só `color` vier, a corda é SOLID. A regra por estilo (SOLID = 1 cor; SPLIT/BRAIDED = 2 ou 3; sem cores
 * consecutivas iguais) é aplicada em `resolveRope` (400).
 */
export class CreateGraduationLevelDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsInt()
  @Min(0)
  order!: number;

  @IsOptional()
  @Matches(HEX_COLOR_RE, { message: 'color deve ser hexadecimal (#RRGGBB).' })
  color?: string;

  @IsOptional()
  @IsEnum(RopeStyle)
  style?: RopeStyle;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ROPE_COLORS)
  @Matches(HEX_COLOR_RE, { each: true, message: 'cada cor de colors deve ser hexadecimal (#RRGGBB).' })
  colors?: string[];

  /** Ponta de CIMA (corda com pontas): hex #RRGGBB/#RGB; null ou '' = sem ponta. */
  @ValidateIf((_, v) => typeof v === 'string' && v.trim() !== '')
  @Matches(HEX_COLOR_RE, { message: 'tipStart deve ser hexadecimal (#RRGGBB).' })
  tipStart?: string | null;

  /** Ponta de BAIXO (corda com pontas): hex #RRGGBB/#RGB; null ou '' = sem ponta. */
  @ValidateIf((_, v) => typeof v === 'string' && v.trim() !== '')
  @Matches(HEX_COLOR_RE, { message: 'tipEnd deve ser hexadecimal (#RRGGBB).' })
  tipEnd?: string | null;
}