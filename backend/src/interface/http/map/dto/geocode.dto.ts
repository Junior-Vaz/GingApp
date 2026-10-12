import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** POST /map/geocode — texto livre do endereco ("Rua X, 10, Goiania, GO"). */
export class GeocodeDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3, { message: 'query deve ter no mínimo 3 caracteres.' })
  @MaxLength(300)
  query!: string;
}
