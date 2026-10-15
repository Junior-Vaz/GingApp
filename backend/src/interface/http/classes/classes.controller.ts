import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { sendPage } from '../../../shared/pagination/pagination';
import { ListClassesQueryDto } from './dto/list-classes-query.dto';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { ClassesService } from './classes.service';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { EnrollStudentDto } from './dto/enroll-student.dto';
import { GenerateLessonsDto } from './dto/generate-lessons.dto';
import { MestreOnlyGuard } from '../../../shared/guards/mestre-only.guard';

@Controller('classes')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Get()
  @CanAccess('classes', 'view')
  async findAll(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListClassesQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.classesService.findAll(organizationId, query, user));
  }

  /** Sem @CanAccess: escopado por construção às turmas do próprio usuário. */
  @Get('me')
  findMine(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number) {
    return this.classesService.findMine(organizationId, userId);
  }

  @Get(':id')
  @CanAccess('classes', 'view')
  findOne(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.classesService.findOne(organizationId, id, user);
  }

  @Post()
  @CanAccess('classes', 'create')
  create(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateClassDto,
  ) {
    return this.classesService.create(organizationId, dto, user);
  }

  @Patch(':id')
  @CanAccess('classes', 'edit')
  update(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateClassDto,
  ) {
    return this.classesService.update(organizationId, id, dto, user);
  }

  /** Gera as aulas da turma no período (idempotente). Cria Lesson => exige `lessons:create`. */
  @Post(':id/generate-lessons')
  @CanAccess('lessons', 'create')
  generateLessons(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: GenerateLessonsDto,
  ) {
    return this.classesService.generateLessons(organizationId, id, dto, user);
  }

  @Get(':id/students')
  @CanAccess('classes', 'view')
  listStudents(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.classesService.listStudents(organizationId, id, user);
  }

  @Post(':id/students')
  @CanAccess('classes', 'edit')
  enrollStudent(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EnrollStudentDto,
  ) {
    return this.classesService.enrollStudent(organizationId, id, dto.studentId, user);
  }

  @Delete(':id/students/:studentId')
  @CanAccess('classes', 'edit')
  unenrollStudent(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.classesService.unenrollStudent(organizationId, id, studentId, user);
  }

  /** Quantas aulas/presenças/matrículas seriam apagadas junto com a turma (diálogo de confirmação do painel). */
  @Get(':id/delete-impact')
  @CanAccess('classes', 'delete')
  @UseGuards(MestreOnlyGuard)
  deleteImpact(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.classesService.deleteImpact(organizationId, id, user);
  }

  /**
   * APAGA de verdade a turma (hard delete), so o Mestre. Inativar = PATCH /classes/:id { status: 'INACTIVE' }.
   * Com aulas ou presencas exige `?confirm=true` (sem ele: 409 com `{ lessons, attendances, students }`).
   */
  @Delete(':id')
  @CanAccess('classes', 'delete')
  @UseGuards(MestreOnlyGuard)
  remove(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('confirm') confirm?: string,
  ) {
    return this.classesService.destroy(organizationId, id, confirm === 'true', user);
  }
}
