import { IsBoolean, IsOptional, Matches } from 'class-validator';

/** Data civil "YYYY-MM-DD" (a existência real do dia — ex.: 30/02 — é conferida no service). */
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Corpo de POST /classes/:id/generate-lessons. Dois modos:
 *  - PERÍODO (manual): `from` e `to` (datas civis inclusivas, `from <= to`, no máximo 90 dias). Não mexe em
 *    `autoGenerateLessons`. `from` é obrigatório neste modo.
 *  - CONTÍNUO (sem data final): omita `to` (ou envie `continuous: true`). Liga `autoGenerateLessons` da turma e
 *    gera as aulas de `from` (opcional; padrão hoje) até LESSONS_HORIZON_DAYS (padrão 60) a frente; depois o job
 *    diário mantém o horizonte sozinho.
 * Informar `to` junto com `continuous: true` é contraditório (400).
 */
export class GenerateLessonsDto {
  @IsOptional()
  @Matches(CIVIL_DATE, { message: 'from deve ser uma data no formato YYYY-MM-DD.' })
  from?: string;

  @IsOptional()
  @Matches(CIVIL_DATE, { message: 'to deve ser uma data no formato YYYY-MM-DD.' })
  to?: string;

  /** true = modo contínuo (sem `to`). false sem `to` é 400 (informe `to` para gerar por período). */
  @IsOptional()
  @IsBoolean({ message: 'continuous deve ser true ou false.' })
  continuous?: boolean;
}
