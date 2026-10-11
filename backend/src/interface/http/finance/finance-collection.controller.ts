import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { sendPage } from '../../../shared/pagination/pagination';
import { GenerateMonthlyDto } from './dto/generate-monthly.dto';
import { ListDelinquentsQueryDto } from './dto/list-delinquents-query.dto';
import { PayFinanceRecordDto } from './dto/pay-finance-record.dto';
import { ListStudentBillingQueryDto, UpsertStudentBillingDto } from './dto/student-billing.dto';
import { FinanceCollectionService } from './finance-collection.service';

/**
 * Cobrança de mensalidade (E07). Mesmo prefixo `/finance` do FinanceController e MESMO RBAC (recurso
 * `finance`: só o MESTRE). IMPORTANTE: este controller precisa vir ANTES do FinanceController na lista
 * `controllers` do módulo — senão `GET /finance/billing` e `/finance/delinquents` cairiam em `GET /finance/:id`
 * (ParseIntPipe => 400).
 */
@Controller('finance')
export class FinanceCollectionController {
  constructor(private readonly collection: FinanceCollectionService) {}

  @Get('billing')
  @CanAccess('finance', 'view')
  listBilling(@CurrentOrganization() organizationId: number, @Query() query: ListStudentBillingQueryDto) {
    return this.collection.listBilling(organizationId, query.studentIds);
  }

  @Get('billing/:studentId')
  @CanAccess('finance', 'view')
  getBilling(@CurrentOrganization() organizationId: number, @Param('studentId', ParseIntPipe) studentId: number) {
    return this.collection.getBilling(organizationId, studentId);
  }

  @Put('billing/:studentId')
  @CanAccess('finance', 'edit')
  setBilling(
    @CurrentOrganization() organizationId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: UpsertStudentBillingDto,
  ) {
    return this.collection.setBilling(organizationId, studentId, dto);
  }

  /** Gera as mensalidades do mês (idempotente) — devolve criados/ignorados. */
  @Post('generate-monthly')
  @CanAccess('finance', 'create')
  @HttpCode(HttpStatus.OK)
  generateMonthly(@CurrentOrganization() organizationId: number, @Body() dto: GenerateMonthlyDto) {
    return this.collection.generateMonthly(organizationId, dto);
  }

  @Get('delinquents')
  @CanAccess('finance', 'view')
  async listDelinquents(
    @CurrentOrganization() organizationId: number,
    @Query() query: ListDelinquentsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.collection.listDelinquents(organizationId, query));
  }

  /** Totais (alunos, valor e quantidade atrasados) sob os mesmos filtros da lista; limit/offset ignorados. */
  @Get('delinquents/summary')
  @CanAccess('finance', 'view')
  delinquentsSummary(@CurrentOrganization() organizationId: number, @Query() query: ListDelinquentsQueryDto) {
    return this.collection.delinquentsSummary(organizationId, query);
  }

  @Post(':id/pay')
  @CanAccess('finance', 'edit')
  @HttpCode(HttpStatus.OK)
  pay(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PayFinanceRecordDto,
  ) {
    return this.collection.pay(organizationId, id, dto);
  }

  @Post(':id/refund')
  @CanAccess('finance', 'edit')
  @HttpCode(HttpStatus.OK)
  refund(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.collection.refund(organizationId, id);
  }

  @Post(':id/cancel')
  @CanAccess('finance', 'edit')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.collection.cancel(organizationId, id);
  }

  @Get(':id/receipt')
  @CanAccess('finance', 'view')
  receipt(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.collection.receipt(organizationId, id);
  }
}
