import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { BR_UFS } from '../../../../shared/geo/br-states';
import { IsOptionalLatitude, IsOptionalLongitude } from '../../../../shared/geo/coordinates';
import { GEO_CHECKIN_RADIUS_MAX_METERS, GEO_CHECKIN_RADIUS_MIN_METERS } from '../../../../shared/geo/geo-checkin';
import { trimOrUndefined, UF_MESSAGE, ufOrUndefined } from '../../units/dto/create-unit.dto';
import { blankImageToNull, IsImageRef } from '../../../../shared/uploads/image-ref';
import { IsAfterTimeOf, IsTimeOfDay } from '../../../../shared/dates/time-of-day';

export class CreateClassDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsInt()
  unitId?: number;

  @IsOptional()
  @IsString()
  description?: string;

  /** Professor responsável: User.id de um membro ATIVO MESTRE/PROFESSOR do grupo (validado no service). */
  @IsOptional()
  @IsInt()
  teacherUserId?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number;

  @IsOptional()
  @IsTimeOfDay()
  startTime?: string;

  @IsOptional()
  @IsTimeOfDay()
  @IsAfterTimeOf('startTime')
  endTime?: string;

  /** Foto da turma: caminho de POST /uploads (/api/uploads/<uuid>.<ext>) ou URL http(s). null/'' = sem foto. */
  @IsOptional()
  @Transform(blankImageToNull)
  @IsImageRef()
  photo?: string | null;

  /** Aulas continuas: true (padrao) = o servidor mantem as aulas geradas ate LESSONS_HORIZON_DAYS a frente (precisa de weekday). */
  @IsOptional()
  @IsBoolean()
  autoGenerateLessons?: boolean;

  /**
   * LOCAL DO TREINO proprio (todos opcionais; mesmo desenho da Unidade). Sem nenhum deles a turma herda o endereco e a
   * posicao no mapa da unidade. `locationLabel` = nome livre do lugar (ex.: "Praca da Liberdade").
   */
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(120)
  locationLabel?: string;

  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @Transform(ufOrUndefined)
  @IsIn(BR_UFS, { message: UF_MESSAGE })
  state?: string;

  /** Posicao no mapa (as DUAS juntas). Sem elas, o servidor geocodifica address/city/state (so' com chave do Google). */
  @IsOptionalLatitude()
  latitude?: number;

  @IsOptionalLongitude()
  longitude?: number;

  /**
   * Check-in por localizacao (docs/CONTRATO_CHECKIN_GEOLOCALIZACAO.md): padrao desligado. Ligar exige local (coordenadas
   * da turma ou da unidade) — senao 400 GEO_CHECKIN_NO_LOCATION (validado no service).
   */
  @IsOptional()
  @IsBoolean()
  geoCheckinEnabled?: boolean;

  /** Raio permitido em metros (inteiro, 50..500; padrao 150). */
  @IsOptional()
  @IsInt()
  @Min(GEO_CHECKIN_RADIUS_MIN_METERS)
  @Max(GEO_CHECKIN_RADIUS_MAX_METERS)
  geoCheckinRadiusMeters?: number;
}
