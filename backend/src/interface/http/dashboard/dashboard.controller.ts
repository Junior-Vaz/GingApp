import { Controller, Get } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** O bloco inance da resposta só vem para quem tem finance:view (ver DashboardService). */
  @Get()
  @CanAccess('dashboard', 'view')
  getSummary(@CurrentOrganization() organizationId: number, @CurrentUser() user: AuthenticatedUser) {
    return this.dashboardService.getSummary(organizationId, user);
  }
}