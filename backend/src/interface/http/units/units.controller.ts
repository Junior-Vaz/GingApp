import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { sendPage } from '../../../shared/pagination/pagination';
import { CreateUnitDto } from './dto/create-unit.dto';
import { ListUnitsQueryDto } from './dto/list-units-query.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { UnitsService } from './units.service';

/**
 * Unidades (matriz/filiais). RBAC pelo recurso `units` da matriz RolePermission: MESTRE tem tudo;
 * PROFESSOR/ALUNO/RESPONSAVEL só `view` (os pickers do painel e o nome da unidade nos registros).
 */
@Controller('units')
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @Get()
  @CanAccess('units', 'view')
  async findAll(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListUnitsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.unitsService.findAll(organizationId, query, user));
  }

  /** Uma unidade da própria organização (o painel resolve a unidade atual de um registro em edição). */
  @Get(':id')
  @CanAccess('units', 'view')
  findOne(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.unitsService.findOne(organizationId, id, user);
  }

  @Post()
  @CanAccess('units', 'create')
  create(@CurrentOrganization() organizationId: number, @Body() dto: CreateUnitDto) {
    return this.unitsService.create(organizationId, dto);
  }

  @Patch(':id')
  @CanAccess('units', 'edit')
  update(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUnitDto,
  ) {
    return this.unitsService.update(organizationId, id, dto);
  }

  /** Inativa a unidade (nunca apaga). Reativar é PATCH { status: "ACTIVE" }. */
  @Delete(':id')
  @CanAccess('units', 'delete')
  remove(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.unitsService.remove(organizationId, id);
  }
}
