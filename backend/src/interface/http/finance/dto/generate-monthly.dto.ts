import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

/** POST /finance/generate-monthly — gera as mensalidades da competência `month` (YYYY-MM). */
export class GenerateMonthlyDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month deve estar no formato YYYY-MM (ex.: 2026-11).' })
  month!: string;

  /** Opcional: gera só para os alunos desta unidade. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  unitId?: number;
}
