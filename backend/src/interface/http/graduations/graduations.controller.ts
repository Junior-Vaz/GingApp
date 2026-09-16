import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
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

  @Get('students/:studentId')
  @CanAccess('graduations', 'view')
  findStudentHistory(
    @CurrentOrganization() organizationId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.graduationsService.findStudentHistory(organizationId, studentId);
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
