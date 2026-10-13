import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { MestreOnlyGuard } from '../../../shared/guards/mestre-only.guard';
import { ContestTransferDto, CreateTransferDto, ListTransfersQueryDto } from './dto/transfers.dto';
import { TransfersService } from './transfers.service';

/**
 * Transferencias do ponto de vista dos GRUPOS (so o MESTRE): o grupo novo pede/cancela, o grupo antigo contesta
 * (sem bloquear). A decisao e da pessoa: /people/me/transfers/:id/approve|decline (PeopleController).
 * Pedido de outro grupo (nem origem nem destino) = 404.
 */
@Controller('transfers')
@UseGuards(MestreOnlyGuard)
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  /** 201 = pedido novo; 200 = ja havia pedido pendente para esta pessoa e este grupo (idempotente). */
  @Post()
  @CanAccess('students', 'create')
  async create(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Body() dto: CreateTransferDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, transfer, approvalLink } = await this.transfers.create(organizationId, userId, dto);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    // approvalLink so existe na criacao (o token nao e guardado em claro): depois, POST :id/approval-link gera outro.
    return { ...transfer, approvalLink };
  }

  /** Link de aprovacao novo (invalida o anterior) para adulto sem login. */
  @Post(':id/approval-link')
  @CanAccess('students', 'create')
  @HttpCode(HttpStatus.OK)
  approvalLink(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.transfers.regenerateApprovalLink(organizationId, userId, id);
  }

  @Get()
  @CanAccess('students', 'view')
  list(@CurrentOrganization() organizationId: number, @Query() query: ListTransfersQueryDto) {
    return this.transfers.list(organizationId, query.direction);
  }

  @Get(':id')
  @CanAccess('students', 'view')
  get(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.transfers.get(organizationId, id);
  }

  @Post(':id/cancel')
  @CanAccess('students', 'create')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.transfers.cancel(organizationId, userId, id);
  }

  @Post(':id/contest')
  @CanAccess('students', 'view')
  contest(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ContestTransferDto,
  ) {
    return this.transfers.contest(organizationId, userId, id, dto);
  }
}
