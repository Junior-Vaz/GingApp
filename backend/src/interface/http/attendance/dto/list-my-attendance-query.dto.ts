import { IsDateString, IsOptional } from 'class-validator';
import { OptionalStudentId } from '../../../../shared/access/linked-student';
import { LimitOffsetQueryDto } from '../../../../shared/pagination/pagination';

/**
 * Filtros de GET /attendance/me: limit/offset (padrão 50, teto 200; total em X-Total-Count) e
 * from/to = intervalo INCLUSIVO da DATA DA AULA (YYYY-MM-DD; `to` só com data inclui o dia todo).
 * Os indicadores do corpo (last30dPercent, currentStreak) ignoram from/to/limit/offset.
 */
export class ListMyAttendanceQueryDto extends LimitOffsetQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /** Seletor de dependente: restringe a UM aluno ligado ao usuário (checado por resolveLink). Sem
   * ele, agrega todos os alunos ligados (comportamento histórico). Vale também para os indicadores. */
  @OptionalStudentId()
  studentId?: number;
}
