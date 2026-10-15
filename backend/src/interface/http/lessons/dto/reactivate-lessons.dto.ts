import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional } from 'class-validator';

/**
 * Corpo de POST /lessons/reactivate: reativa em massa as aulas CANCELADAS (INACTIVE) do intervalo [from, to]
 * (datas civis, inclusivas; `to` so com data vale o dia inteiro, como em GET /lessons), opcionalmente de uma turma.
 * `notify` (padrao false) avisa os alunos com o gatilho "Aula reativada" de cada aula; sem ele a reativacao e silenciosa.
 */
export class ReactivateLessonsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  classId?: number;

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}
