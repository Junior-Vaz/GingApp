import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { ClassesService } from './classes.service';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';

@Controller('classes')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Get()
  @CanAccess('classes', 'view')
  findAll(@CurrentOrganization() organizationId: number) {
    return this.classesService.findAll(organizationId);
  }

  @Get(':id')
  @CanAccess('classes', 'view')
  findOne(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.classesService.findOne(organizationId, id);
  }

  @Post()
  @CanAccess('classes', 'create')
  create(@CurrentOrganization() organizationId: number, @Body() dto: CreateClassDto) {
    return this.classesService.create(organizationId, dto);
  }

  @Patch(':id')
  @CanAccess('classes', 'edit')
  update(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateClassDto,
  ) {
    return this.classesService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @CanAccess('classes', 'delete')
  remove(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.classesService.remove(organizationId, id);
  }
}
