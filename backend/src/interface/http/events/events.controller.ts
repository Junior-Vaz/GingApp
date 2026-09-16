import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { AddEventParticipantDto } from './dto/add-event-participant.dto';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @CanAccess('events', 'view')
  findAll(@CurrentOrganization() organizationId: number) {
    return this.eventsService.findAll(organizationId);
  }

  @Get(':id')
  @CanAccess('events', 'view')
  findOne(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.eventsService.findOne(organizationId, id);
  }

  @Post()
  @CanAccess('events', 'create')
  create(@CurrentOrganization() organizationId: number, @Body() dto: CreateEventDto) {
    return this.eventsService.create(organizationId, dto);
  }

  @Patch(':id')
  @CanAccess('events', 'edit')
  update(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventsService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @CanAccess('events', 'delete')
  remove(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.eventsService.remove(organizationId, id);
  }

  @Get(':eventId/participants')
  @CanAccess('events', 'view')
  listParticipants(
    @CurrentOrganization() organizationId: number,
    @Param('eventId', ParseIntPipe) eventId: number,
  ) {
    return this.eventsService.listParticipants(organizationId, eventId);
  }

  @Post(':eventId/participants')
  @CanAccess('events', 'create')
  addParticipant(
    @CurrentOrganization() organizationId: number,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: AddEventParticipantDto,
  ) {
    return this.eventsService.addParticipant(organizationId, eventId, dto);
  }

  @Delete(':eventId/participants/:participantId')
  @CanAccess('events', 'edit')
  removeParticipant(
    @CurrentOrganization() organizationId: number,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('participantId', ParseIntPipe) participantId: number,
  ) {
    return this.eventsService.removeParticipant(organizationId, eventId, participantId);
  }
}
