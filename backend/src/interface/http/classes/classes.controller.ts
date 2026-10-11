import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sendPage } from '../../../shared/pagination/pagination';
import { ListClassesQueryDto } from './dto/list-classes-query.dto';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { ClassesService } from './classes.service';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { EnrollStudentDto } from './dto/enroll-student.dto';
import { GenerateLessonsDto } from './dto/generate-lessons.dto';

@Controller('classes')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Get()
  @CanAccess('classes', 'view')
  async findAll(
    @CurrentOrganization() organizationId: number,
    @Query() query: ListClassesQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.classesService.findAll(organizationId, query));
  }

  /** Sem @CanAccess: escopado por construção às turmas do próprio usuário. */
  @Get('me')
  findMine(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number) {
    return this.classesService.findMine(organizationId, userId);
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

  /** Gera as aulas da turma no período (idempotente). Cria Lesson => exige `lessons:create`. */
  @Post(':id/generate-lessons')
  @CanAccess('lessons', 'create')
  generateLessons(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: GenerateLessonsDto,
  ) {
    return this.classesService.generateLessons(organizationId, id, dto);
  }

  @Get(':id/students')
  @CanAccess('classes', 'view')
  listStudents(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.classesService.listStudents(organizationId, id);
  }

  @Post(':id/students')
  @CanAccess('classes', 'edit')
  enrollStudent(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EnrollStudentDto,
  ) {
    return this.classesService.enrollStudent(organizationId, id, dto.studentId);
  }

  @Delete(':id/students/:studentId')
  @CanAccess('classes', 'edit')
  unenrollStudent(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.classesService.unenrollStudent(organizationId, id, studentId);
  }

  @Delete(':id')
  @CanAccess('classes', 'delete')
  remove(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.classesService.remove(organizationId, id);
  }
}
