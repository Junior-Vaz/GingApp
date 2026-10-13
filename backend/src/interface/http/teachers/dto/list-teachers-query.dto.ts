import { OrgRole } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../../../shared/pagination/pagination';

/** Filtros de GET /teachers: role (MESTRE|PROFESSOR), status da membership e q (nome/e-mail). */
export class ListTeachersQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn([OrgRole.MESTRE, OrgRole.PROFESSOR, OrgRole.INSTRUTOR, OrgRole.MONITOR])
  role?: OrgRole;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;
}