import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sendPage } from '../../../shared/pagination/pagination';
import { ListTeachersQueryDto } from './dto/list-teachers-query.dto';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { TeachersService } from './teachers.service';
import { CreateTeacherDto } from './dto/create-teacher.dto';
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

  @Delete(':id')
  @CanAccess('teachers', 'delete')
  remove(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.teachersService.remove(organizationId, id);
  }
}
