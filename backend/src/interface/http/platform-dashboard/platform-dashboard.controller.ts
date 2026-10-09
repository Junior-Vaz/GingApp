import { Controller, Get, UseGuards } from '@nestjs/common';
import { PlatformOnlyGuard } from '../../../shared/guards/platform-only.guard';
import { PlatformDashboardService } from './platform-dashboard.service';

/** Métricas agregadas da plataforma — exclusivo da equipe PLATFORM (admin.gingapp.com.br).
 * Distinto de GET /dashboard, que é o painel de UM grupo (escopado por organização). */
@Controller('platform-dashboard')
@UseGuards(PlatformOnlyGuard)
export class PlatformDashboardController {
  constructor(private readonly service: PlatformDashboardService) {}

  @Get()
  get() {
    return this.service.getDashboard();
  }
}
