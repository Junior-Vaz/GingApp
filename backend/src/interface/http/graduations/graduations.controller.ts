import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { GraduationsService } from './graduations.service';
import { CreateGraduationSystemDto } from './dto/create-graduation-system.dto';
import { CreateGraduationLevelDto } from './dto/create-graduation-level.dto';
import { CreateStudentGraduationDto } from './dto/create-student-graduation.dto';

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

  @Post('systems/:systemId/levels')
  @CanAccess('graduations', 'create')
  createLevel(
    @CurrentOrganization() organizationId: number,
    @Param('systemId', ParseIntPipe) systemId: number,
    @Body() dto: CreateGraduationLevelDto,
  ) {
    return this.graduationsService.createLevel(organizationId, systemId, dto);
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
}
