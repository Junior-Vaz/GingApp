import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sendPage } from '../../../shared/pagination/pagination';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { FinanceService } from './finance.service';
import { CreateFinanceRecordDto } from './dto/create-finance-record.dto';
import { UpdateFinanceRecordDto } from './dto/update-finance-record.dto';
import { ListFinanceQueryDto } from './dto/list-finance-query.dto';

@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get()
  @CanAccess('finance', 'view')
  async findAll(
    @CurrentOrganization() organizationId: number,
    @Query() query: ListFinanceQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.financeService.findAll(organizationId, query));
  }

  /** Totais agregados no banco sob os mesmos filtros da lista (limit/offset são ignorados).
   * Precisa vir antes de `:id`. */
  @Get('summary')
  @CanAccess('finance', 'view')
  summary(@CurrentOrganization() organizationId: number, @Query() query: ListFinanceQueryDto) {
    return this.financeService.summary(organizationId, query);
  }

  /** Sem @CanAccess: escopado por construção aos alunos do próprio usuário (nunca à
   * organização inteira) — ver FinanceService.findMine. Precisa vir antes de `:id`. */
  @Get('me')
  findMine(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number) {
    return this.financeService.findMine(organizationId, userId);
  }

  @Get(':id')
  @CanAccess('finance', 'view')
  findOne(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.financeService.findOne(organizationId, id);
  }

  @Post()
  @CanAccess('finance', 'create')
  create(@CurrentOrganization() organizationId: number, @Body() dto: CreateFinanceRecordDto) {
    return this.financeService.create(organizationId, dto);
  }

  @Patch(':id')
  @CanAccess('finance', 'edit')
  update(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFinanceRecordDto,
  ) {
    return this.financeService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @CanAccess('finance', 'delete')
  remove(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.financeService.remove(organizationId, id);
  }
}
