import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { FinanceService } from './finance.service';
import { CreateFinanceRecordDto } from './dto/create-finance-record.dto';
import { UpdateFinanceRecordDto } from './dto/update-finance-record.dto';

@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get()
  @CanAccess('finance', 'view')
  findAll(@CurrentOrganization() organizationId: number) {
    return this.financeService.findAll(organizationId);
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
