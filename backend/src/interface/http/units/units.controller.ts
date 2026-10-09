import { Controller, Get, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { sendPage } from '../../../shared/pagination/pagination';
import { ListUnitsQueryDto } from './dto/list-units-query.dto';
import { UnitsService } from './units.service';

@Controller('units')
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @Get()
  async findAll(
    @CurrentOrganization() organizationId: number,
    @Query() query: ListUnitsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.unitsService.findAll(organizationId, query));
  }

  /** Uma unidade da própria organização (o painel resolve a unidade atual de um registro em edição). */
  @Get(':id')
  findOne(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.unitsService.findOne(organizationId, id);
  }
}
