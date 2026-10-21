import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Res, UseFilters, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { sendPage } from '../../../shared/pagination/pagination';
import { CommunicationsExceptionFilter } from './communications-http';
import { CommunicationsService } from './communications.service';
import {
  AckCommunicationDto,
  CreateCommunicationDto,
  ListCommunicationsQueryDto,
  PreviewCommunicationQueryDto,
} from './dto/communications.dto';

/** Criar/reenviar comunicado: POR USUARIO (spam de push); configuravel por env so para os e2e. */
const CREATE_THROTTLE = { default: { limit: Number(process.env.COMM_CREATE_THROTTLE_LIMIT ?? 10), ttl: 60_000 } };
const RESEND_THROTTLE = { default: { limit: Number(process.env.COMM_RESEND_THROTTLE_LIMIT ?? 5), ttl: 60_000 } };
const ACK_THROTTLE = { default: { limit: Number(process.env.COMM_ACK_THROTTLE_LIMIT ?? 60), ttl: 60_000 } };

/**
 * Comunicar (contrato secao 3). Painel: `announcements:create` (MESTRE/PROFESSOR/INSTRUTOR; o alcance permitido e
 * decidido no service). App (qualquer membro autenticado do grupo): `GET /communications/pinned` e `POST :id/ack`.
 * As rotas fixas (`preview`, `pinned`) vem ANTES de `:id`.
 */
@Controller('communications')
@UseFilters(CommunicationsExceptionFilter)
export class CommunicationsController {
  constructor(private readonly communications: CommunicationsService) {}

  @Get('preview')
  @CanAccess('announcements', 'create')
  preview(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PreviewCommunicationQueryDto,
  ) {
    return this.communications.preview(organizationId, user, {
      type: query.scope,
      unitId: query.unitId,
      classId: query.classId,
      role: query.role,
    });
  }

  @Get('pinned')
  pinned(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number) {
    return this.communications.pinned(organizationId, userId);
  }

  @Post()
  @CanAccess('announcements', 'create')
  @UseGuards(UserThrottlerGuard)
  @Throttle(CREATE_THROTTLE)
  create(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCommunicationDto,
  ) {
    return this.communications.create(organizationId, user, dto);
  }

  @Get()
  @CanAccess('announcements', 'create')
  async findAll(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCommunicationsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.communications.findAll(organizationId, user, query));
  }

  @Get(':id')
  @CanAccess('announcements', 'create')
  findOne(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.communications.findOne(organizationId, user, id);
  }

  @Post(':id/resend-unread')
  @CanAccess('announcements', 'create')
  @UseGuards(UserThrottlerGuard)
  @Throttle(RESEND_THROTTLE)
  resendUnread(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.communications.resendUnread(organizationId, user, id);
  }

  @Delete(':id')
  @CanAccess('announcements', 'create')
  cancel(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.communications.cancel(organizationId, user, id);
  }

  @Post(':id/ack')
  @UseGuards(UserThrottlerGuard)
  @Throttle(ACK_THROTTLE)
  ack(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AckCommunicationDto,
  ) {
    return this.communications.ack(organizationId, userId, id, dto.response);
  }
}
