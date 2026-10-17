import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sendPage } from '../../../shared/pagination/pagination';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { StudentAccessService } from './student-access.service';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { withMaskedDocument } from '../../../shared/security/person-document';

/** Fase 2 da ficha unica: o CPF legado (Student.document) sai MASCARADO em todas as respostas deste controller. */
@Controller('students')
export class StudentsController {
  constructor(
    private readonly studentsService: StudentsService,
    private readonly studentAccess: StudentAccessService,
  ) {}

  @Get()
  @CanAccess('students', 'view')
  async findAll(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListStudentsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const page = await this.studentsService.findAll(organizationId, query, user);
    return sendPage(res, { ...page, items: page.items.map(withMaskedDocument) });
  }

  /** Não passa por @CanAccess: qualquer MEMBER autenticado pode ver os PRÓPRIOS vínculos —
   * a segurança vem da query sempre filtrar por userId do token (StudentsService.findMine),
   * não de uma checagem de papel. Precisa vir antes de `:id` para "me" não ser lido como id. */
  @Get('me')
  async findMine(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number) {
    return (await this.studentsService.findMine(organizationId, userId)).map(withMaskedDocument);
  }

  /** Auto-atendimento do próprio perfil — precisa vir antes de `:id` pelo mesmo motivo de
   * `me` acima (path com 2 segmentos, mas mais seguro registrar antes por clareza). */
  @Patch('me/profile')
  async updateMyProfile(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Body() dto: UpdateMyProfileDto,
  ) {
    return withMaskedDocument(await this.studentsService.updateMyProfile(organizationId, userId, dto));
  }

  @Get(':id')
  @CanAccess('students', 'view')
  async findOne(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return withMaskedDocument(await this.studentsService.findOne(organizationId, id, user));
  }

  /** Ficha única (identidade + matrículas + graduações + frequência + certificados) vista pela equipe do grupo. */
  @Get(':id/ficha')
  @CanAccess('students', 'view')
  ficha(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.studentsService.ficha(organizationId, id, user);
  }

  /**
   * Cadastro (rápido). Resposta: o aluno como sempre; com `createAccess: true` ganha `access`
   * `{ status, email?, temporaryPassword?, mustChangePassword?, reason? }` (ver StudentAccessService.createForNewStudent).
   * O acesso é criado DEPOIS do aluno: falha nele (FAILED) nunca desfaz o cadastro. A senha provisória só existe nesta
   * resposta, com `Cache-Control: no-store`.
   */
  @Post()
  @CanAccess('students', 'create')
  async create(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateStudentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const student = await this.studentsService.create(organizationId, dto, user);
    const masked = withMaskedDocument(student);
    if (!dto.createAccess) return masked;
    const access = await this.studentAccess.createForNewStudent(organizationId, student, user);
    if (access.temporaryPassword) res.set('Cache-Control', 'no-store');
    return { ...masked, access };
  }

  @Patch(':id')
  @CanAccess('students', 'edit')
  async update(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStudentDto,
  ) {
    return withMaskedDocument(await this.studentsService.update(organizationId, id, dto, user));
  }

  @Delete(':id')
  @CanAccess('students', 'delete')
  async remove(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return withMaskedDocument(await this.studentsService.remove(organizationId, id, user));
  }
}
