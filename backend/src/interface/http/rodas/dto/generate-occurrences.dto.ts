import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Corpo de POST /rodas/:id/generate-occurrences. */
export class GenerateOccurrencesDto {
  /** Quantas ocorrencias futuras manter abertas (padrao 3, maximo 12). Repetir a chamada nao duplica. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  count?: number;
}
