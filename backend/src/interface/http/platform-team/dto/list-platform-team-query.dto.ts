import { IsIn, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../../../shared/pagination/pagination';
import { PLATFORM_USER_STATUSES, PlatformUserStatus } from './update-platform-user.dto';

/** Filtros de GET /platform-team: paginação, q (nome/e-mail) e status. */
export class ListPlatformTeamQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(PLATFORM_USER_STATUSES)
  status?: PlatformUserStatus;
}
