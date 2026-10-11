import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { sendPage } from '../../../shared/pagination/pagination';
import { ListTeachersQueryDto } from './dto/list-teachers-query.dto';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { MestreOnlyGuard } from '../../../shared/guards/mestre-only.guard';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { ResetMemberPasswordDto } from '../../../shared/security/reset-member-password.dto';
import { MESTRE_RESET_THROTTLE_LIMIT } from '../organizations/organizations.controller';
import { TeachersService } from './teachers.service';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { SetTeacherUnitsDto } from './dto/set-teacher-units.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';

@Controller('teachers')
export class TeachersController {
  constructor(private readonly teachersService: TeachersService) {}

  @Get()
  @CanAccess('teachers', 'view')
  async findAll(
    @CurrentOrganization() organizationId: number,
    @Query() query: ListTeachersQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.teachersService.findAll(organizationId, query));
  }

  @Get(':id')
  @CanAccess('teachers', 'view')
  findOne(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.teachersService.findOne(organizationId, id);
  }

  /**
   * Unidades de atuação do professor (E08; `id` = membership). Só o MESTRE do grupo lê/define: quem tem unidades
   * atribuídas só enxerga/edita alunos, turmas, aulas e frequência delas (ver shared/access/unit-scope.ts); sem
   * nenhuma, vê tudo. PUT substitui o conjunto (lista vazia = sem restrição).
   */
  @Get(':id/units')
  @CanAccess('teachers', 'view')
  @UseGuards(MestreOnlyGuard)
  getUnits(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.teachersService.getUnits(organizationId, id);
  }

  @Put(':id/units')
  @CanAccess('teachers', 'edit')
  @UseGuards(MestreOnlyGuard)
  setUnits(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetTeacherUnitsDto,
  ) {
    return this.teachersService.setUnits(organizationId, id, dto);
  }

  @Post()
  @CanAccess('teachers', 'create')
  create(@CurrentOrganization() organizationId: number, @Body() dto: CreateTeacherDto) {
    return this.teachersService.create(organizationId, dto);
  }

  @Patch(':id')
  @CanAccess('teachers', 'edit')
  update(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTeacherDto,
  ) {
    return this.teachersService.update(organizationId, id, dto);
  }

  /** Mestre redefine a senha de um professor do grupo (10/min por IP e por usuário; ver StudentAccessController). */
  @Post(':id/reset-password')
  @CanAccess('teachers', 'edit')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { limit: MESTRE_RESET_THROTTLE_LIMIT, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetMemberPasswordDto,
  ): Promise<void> {
    await this.teachersService.resetPassword(organizationId, id, dto);
  }

  @Delete(':id')
  @CanAccess('teachers', 'delete')
  remove(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.teachersService.remove(organizationId, id);
  }
}
