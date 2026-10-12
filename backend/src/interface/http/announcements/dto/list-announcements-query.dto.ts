import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../../../shared/pagination/pagination';

/** Filtros de GET /announcements: ativo/inativo, unidade e `q` (título/corpo). Sem `isActive`,
 * lista ativos e inativos (comportamento anterior). */
export class ListAnnouncementsQueryDto extends PageQueryDto {
  /** 'true' | 'false' na query string (qualquer outro valor -> 400). */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  unitId?: number;

  /** Só os comunicados dirigidos a esta turma. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  classId?: number;
}
