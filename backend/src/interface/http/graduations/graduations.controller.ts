import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { GraduationsService } from './graduations.service';
import { CreateGraduationSystemDto } from './dto/create-graduation-system.dto';
import { CreateGraduationLevelDto } from './dto/create-graduation-level.dto';
import { CreateStudentGraduationDto } from './dto/create-student-graduation.dto';
import { UpdateGraduationSystemDto } from './dto/update-graduation-system.dto';
import { UpdateGraduationLevelDto } from './dto/update-graduation-level.dto';
import { UpdateStudentGraduationDto } from './dto/update-student-graduation.dto';

@Controller('graduations')
export class GraduationsController {
  constructor(private readonly graduationsService: GraduationsService) {}

  @Get()
  @CanAccess('graduations', 'view')
  findAll(@CurrentOrganization() organizationId: number) {
    return this.graduationsService.findAll(organizationId);
  }

  @Get('systems')
  @CanAccess('graduations', 'view')
  findAllSystems(@CurrentOrganization() organizationId: number) {
    return this.graduationsService.findAllSystems(organizationId);
  }

  @Post('systems')
  @CanAccess('graduations', 'create')
  createSystem(@CurrentOrganization() organizationId: number, @Body() dto: CreateGraduationSystemDto) {
    return this.graduationsService.createSystem(organizationId, dto);
  }

  @Patch('systems/:systemId')
  @CanAccess('graduations', 'edit')
  updateSystem(
    @CurrentOrganization() organizationId: number,
    @Param('systemId', ParseIntPipe) systemId: number,
    @Body() dto: UpdateGraduationSystemDto,
  ) {
    return this.graduationsService.updateSystem(organizationId, systemId, dto);
  }

  @Delete('systems/:systemId')
  @CanAccess('graduations', 'delete')
  removeSystem(@CurrentOrganization() organizationId: number, @Param('systemId', ParseIntPipe) systemId: number) {
    return this.graduationsService.removeSystem(organizationId, systemId);
  }

  @Post('systems/:systemId/levels')
  @CanAccess('graduations', 'create')
  createLevel(
    @CurrentOrganization() organizationId: number,
    @Param('systemId', ParseIntPipe) systemId: number,
    @Body() dto: CreateGraduationLevelDto,
  ) {
    return this.graduationsService.createLevel(organizationId, systemId, dto);
  }

  @Patch('levels/:levelId')
  @CanAccess('graduations', 'edit')
  updateLevel(
    @CurrentOrganization() organizationId: number,
    @Param('levelId', ParseIntPipe) levelId: number,
    @Body() dto: UpdateGraduationLevelDto,
  ) {
    return this.graduationsService.updateLevel(organizationId, levelId, dto);
  }

  @Delete('levels/:levelId')
  @CanAccess('graduations', 'delete')
  removeLevel(@CurrentOrganization() organizationId: number, @Param('levelId', ParseIntPipe) levelId: number) {
    return this.graduationsService.removeLevel(organizationId, levelId);
  }

  /**
   * Sem @CanAccess de propósito: a mesma rota serve o painel (staff com graduations.view na
   * matriz vê qualquer aluno da organização) e o app do capoeirista (ALUNO/RESPONSAVEL, sem
   * graduations.view, só vê o PRÓPRIO aluno ou um dependente — senão 404, sem vazar a
   * existência). A decisão é feita no service (PermissionsService + StudentsService.resolveLink).
   */
  @Get('students/:studentId')
  findStudentHistory(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.graduationsService.findStudentHistory(organizationId, studentId, user);
  }

  @Post('students/:studentId')
  @CanAccess('graduations', 'create')
  createStudentGraduation(
    @CurrentOrganization() organizationId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: CreateStudentGraduationDto,
  ) {
    return this.graduationsService.createStudentGraduation(organizationId, studentId, dto);
  }

  @Patch('students/:studentId/:graduationId')
  @CanAccess('graduations', 'edit')
  updateStudentGraduation(
    @CurrentOrganization() organizationId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('graduationId', ParseIntPipe) graduationId: number,
    @Body() dto: UpdateStudentGraduationDto,
  ) {
    return this.graduationsService.updateStudentGraduation(organizationId, studentId, graduationId, dto);
  }

  @Delete('students/:studentId/:graduationId')
  @CanAccess('graduations', 'delete')
  removeStudentGraduation(
    @CurrentOrganization() organizationId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('graduationId', ParseIntPipe) graduationId: number,
  ) {
    return this.graduationsService.removeStudentGraduation(organizationId, studentId, graduationId);
  }
}
