import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

const NUMBER_OPTIONS = { allowNaN: false, allowInfinity: false };

/**
 * Corpo de POST /attendance/geo-checkin (docs/CONTRATO_CHECKIN_GEOLOCALIZACAO.md secao 3). Whitelist: campo extra = 400.
 * PRIVACIDADE: latitude/longitude/accuracyMeters sao usados SO em memoria para calcular a distancia; nunca sao gravados,
 * auditados, logados nem repetidos em mensagem de erro (as mensagens abaixo nao interpolam o valor recebido).
 */
export class GeoCheckinDto {
  @IsInt()
  @Min(1)
  lessonId!: number;

  @IsNumber(NUMBER_OPTIONS, { message: 'latitude deve ser um numero entre -90 e 90.' })
  @Min(-90, { message: 'latitude deve estar entre -90 e 90.' })
  @Max(90, { message: 'latitude deve estar entre -90 e 90.' })
  latitude!: number;

  @IsNumber(NUMBER_OPTIONS, { message: 'longitude deve ser um numero entre -180 e 180.' })
  @Min(-180, { message: 'longitude deve estar entre -180 e 180.' })
  @Max(180, { message: 'longitude deve estar entre -180 e 180.' })
  longitude!: number;

  /** Precisao informada pelo aparelho (metros). */
  @IsOptional()
  @IsNumber(NUMBER_OPTIONS, { message: 'accuracyMeters deve ser um numero entre 0 e 100000.' })
  @Min(0, { message: 'accuracyMeters deve estar entre 0 e 100000.' })
  @Max(100_000, { message: 'accuracyMeters deve estar entre 0 e 100000.' })
  accuracyMeters?: number;

  /** Qual aluno (o proprio ou um dependente ATIVO). Obrigatorio so quando mais de um aluno seu esta na turma. */
  @IsOptional()
  @IsInt()
  @Min(1)
  studentId?: number;
}
