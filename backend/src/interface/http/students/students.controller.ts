import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sendPage } from '../../../shared/pagination/pagination';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';

@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get()
  @CanAccess('students', 'view')
  async findAll(
    @CurrentOrganization() organizationId: number,
    @Query() query: ListStudentsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.studentsService.findAll(organizationId, query));
  }

  /** Não passa por @CanAccess: qualquer MEMBER autenticado pode ver os PRÓPRIOS vínculos —
   * a segurança vem da query sempre filtrar por userId do token (StudentsService.findMine),
   * não de uma checagem de papel. Precisa vir antes de `:id` para "me" não ser lido como id. */
  @Get('me')
  findMine(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number) {
    return this.studentsService.findMine(organizationId, userId);
  }

  /** Auto-atendimento do próprio perfil — precisa vir antes de `:id` pelo mesmo motivo de
   * `me` acima (path com 2 segmentos, mas mais seguro registrar antes por clareza). */
  @Patch('me/profile')
  updateMyProfile(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Body() dto: UpdateMyProfileDto,
  ) {
    return this.studentsService.updateMyProfile(organizationId, userId, dto);
  }

  @Get(':id')
  @CanAccess('students', 'view')
  findOne(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.studentsService.findOne(organizationId, id);
  }

  @Post()
  @CanAccess('students', 'create')
  create(@CurrentOrganization() organizationId: number, @Body() dto: CreateStudentDto) {
    return this.studentsService.create(organizationId, dto);
  }

  @Patch(':id')
  @CanAccess('students', 'edit')
  update(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.studentsService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @CanAccess('students', 'delete')
  remove(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.studentsService.remove(organizationId, id);
  }
}
