import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { LessonsService } from './lessons.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';

@Controller('lessons')
export class LessonsController {
  constructor(private readonly lessonsService: LessonsService) {}

  @Get()
  @CanAccess('lessons', 'view')
  findAll(@CurrentOrganization() organizationId: number) {
    return this.lessonsService.findAll(organizationId);
  }

  @Get(':id')
  @CanAccess('lessons', 'view')
  findOne(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.lessonsService.findOne(organizationId, id);
  }

  @Post()
  @CanAccess('lessons', 'create')
  create(@CurrentOrganization() organizationId: number, @Body() dto: CreateLessonDto) {
    return this.lessonsService.create(organizationId, dto);
  }

  @Patch(':id')
  @CanAccess('lessons', 'edit')
  update(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLessonDto,
  ) {
    return this.lessonsService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @CanAccess('lessons', 'delete')
  remove(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.lessonsService.remove(organizationId, id);
  }
}
