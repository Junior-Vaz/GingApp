import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
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
  findAll(@CurrentOrganization() organizationId: number) {
    return this.teachersService.findAll(organizationId);
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
