import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional } from 'class-validator';

/**
 * Corpo de POST /lessons/bulk-delete: APAGA DE VERDADE aulas CANCELADAS (status INACTIVE), em lote.
 *  - `onlyCancelled: true` (+ `classId` opcional): todas as canceladas do grupo (ou da turma);
 *  - `ids`: so as aulas listadas (as que NAO estiverem canceladas sao ignoradas e contadas em `skipped`).
 * Informe um dos dois. `dryRun: true` so conta (nada e apagado). `confirm: true` e' obrigatorio quando alguma das aulas
 * tem presencas registradas (sem ele: 409 com a contagem).
 */
export class BulkDeleteLessonsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  classId?: number;

  @IsOptional()
  @IsBoolean()
  onlyCancelled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @Type(() => Number)
  @IsInt({ each: true })
  ids?: number[];

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
