import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
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

  /** Sem @CanAccess: "quero participar" é self-service para qualquer MEMBER, não uma ação
   * administrativa — a autorização fina (admin vs. autoinscrição) é feita no service. */
  @Post(':eventId/participants')
  addParticipant(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: AddEventParticipantDto,
  ) {
    return this.eventsService.addParticipant(organizationId, eventId, user, dto);
  }

  /** Sem @CanAccess: a checagem de papel (MESTRE/PROFESSOR) é feita no service — mesmo
   * espírito de addParticipant/removeParticipant, para dar a mensagem de erro certa. */
  @Patch(':eventId/participants/:participantId/check-in')
  checkIn(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('participantId', ParseIntPipe) participantId: number,
  ) {
    return this.eventsService.checkIn(organizationId, eventId, participantId, user);
  }

  @Delete(':eventId/participants/:participantId')
  removeParticipant(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('participantId', ParseIntPipe) participantId: number,
  ) {
    return this.eventsService.removeParticipant(organizationId, eventId, participantId, user);
  }
}
