import { Controller, Get } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @CanAccess('events', 'view')
  findAll(@CurrentOrganization() organizationId: number) {
    return this.eventsService.findAll(organizationId);
  }
}
