import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { OptionalStudentId } from '../../../../shared/access/linked-student';

/** POST /people/merge: a ficha `mergeId` e mesclada na `keepId` (que continua valendo). */
export class MergePeopleDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  keepId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  mergeId!: number;
}

/** ?studentId= das rotas /people/me/* (dependente selecionado do RESPONSAVEL; conferido por resolveLink). */
export class PeopleMeQueryDto {
  @OptionalStudentId()
  studentId?: number;
}
