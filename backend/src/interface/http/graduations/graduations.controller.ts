import { Controller, Get } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { GraduationsService } from './graduations.service';

@Controller('graduations')
export class GraduationsController {
  constructor(private readonly graduationsService: GraduationsService) {}

  @Get()
  @CanAccess('graduations', 'view')
  findAll(@CurrentOrganization() organizationId: number) {
    return this.graduationsService.findAll(organizationId);
  }
}
