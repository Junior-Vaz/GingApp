import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sendPage } from '../../../shared/pagination/pagination';
import { ListEventsQueryDto } from './dto/list-events-query.dto';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { AddEventParticipantDto } from './dto/add-event-participant.dto';
import { EventCheckinSelfDto } from './dto/event-checkin-self.dto';
import { EventsCheckinService } from './events-checkin.service';

@Controller('events')
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly checkinService: EventsCheckinService,
  ) {}

  /** Token + QR (data URL) de check-in do evento, para a equipe exibir/imprimir. */
  @Get(':id/checkin-token')
  @CanAccess('events', 'edit')
  checkinToken(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.checkinService.issueToken(organizationId, id, user);
  }

  /** O aluno (ou responsável, por um dependente) confirma a PRÓPRIA presença lendo o QR. Sem @CanAccess: self-service
   * de qualquer membro; a autorização está no vínculo aluno/inscrição, validado no service. */
  @Post(':id/checkin-self')
  @HttpCode(200)
  checkinSelf(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EventCheckinSelfDto,
  ) {
    return this.checkinService.checkinSelf(organizationId, id, user, dto);
  }

  @Get()
  @CanAccess('events', 'view')
  async findAll(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListEventsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.eventsService.findAll(organizationId, query, user));
  }

  @Get(':id')
  @CanAccess('events', 'view')
  findOne(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.eventsService.findOne(organizationId, id, user);
  }

  @Post()
  @CanAccess('events', 'create')
  create(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEventDto,
  ) {
    return this.eventsService.create(organizationId, dto, user);
  }

  @Patch(':id')
  @CanAccess('events', 'edit')
  update(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventsService.update(organizationId, id, dto, user);
  }

  @Delete(':id')
  @CanAccess('events', 'delete')
  remove(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.eventsService.remove(organizationId, id, user);
  }

  @Get(':eventId/participants')
  @CanAccess('events', 'view')
  listParticipants(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
  ) {
    return this.eventsService.listParticipants(organizationId, eventId, user);
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
