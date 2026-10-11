import { Matches } from 'class-validator';

/** Data civil "YYYY-MM-DD" (a existência real do dia — ex.: 30/02 — é conferida no service). */
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Corpo de POST /classes/:id/generate-lessons. `from` e `to` são datas civis inclusivas; o
 * intervalo máximo (90 dias) e `from <= to` são validados no service.
 */
export class GenerateLessonsDto {
  @Matches(CIVIL_DATE, { message: 'from deve ser uma data no formato YYYY-MM-DD.' })
  from!: string;

  @Matches(CIVIL_DATE, { message: 'to deve ser uma data no formato YYYY-MM-DD.' })
  to!: string;
}
