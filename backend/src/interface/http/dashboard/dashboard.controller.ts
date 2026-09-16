import { Controller, Get } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @CanAccess('dashboard', 'view')
  getSummary(@CurrentOrganization() organizationId: number) {
    return this.dashboardService.getSummary(organizationId);
  }
}
