import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { OptionalStudentId } from '../../../../shared/access/linked-student';
import { MAX_LEVELS_PER_SYSTEM } from '../rope';

/** PUT /graduations/systems/:systemId/levels/reorder — ids dos níveis do sistema, do MAIS BAIXO para o mais alto. */
export class ReorderLevelsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LEVELS_PER_SYSTEM)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  order!: number[];
}

/** POST /graduations/systems/from-template */
export class CreateSystemFromTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  code!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;
}

/** GET /graduations/hierarchy?studentId= */
export class HierarchyQueryDto {
  @OptionalStudentId()
  studentId?: number;
}
