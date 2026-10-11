import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { ResetMemberPasswordDto } from '../../../shared/security/reset-member-password.dto';
import { MESTRE_RESET_THROTTLE_LIMIT } from '../organizations/organizations.controller';
import { CreateGuardianDto } from './dto/create-guardian.dto';
import { CreateStudentAccountDto } from './dto/create-student-account.dto';
import { UpdateGuardianDto } from './dto/update-guardian.dto';
import { StudentAccessService } from './student-access.service';
import { StudentGuardiansService } from './student-guardians.service';

/** Redefinir senha de terceiros é raro e sensível: mesmo limite do reset de MESTRE pelo admin (10/min, por
 * IP e por usuário autenticado; MESTRE_RESET_THROTTLE_LIMIT sobe só nos e2e/dev). */
const RESET_THROTTLE = { default: { limit: MESTRE_RESET_THROTTLE_LIMIT, ttl: 60_000 } };

/**
 * Acesso do aluno e responsáveis (E01/E05 do plano), sob /students/:id/... Leitura exige `students.view`;
 * toda escrita exige `students.edit` (MESTRE e PROFESSOR na matriz). O grupo vem SEMPRE do token.
 * Registrado ANTES do StudentsController no módulo só por clareza — os paths não colidem com `:id` simples.
 */
@Controller('students')
export class StudentAccessController {
  constructor(
    private readonly access: StudentAccessService,
    private readonly guardians: StudentGuardiansService,
  ) {}

  @Get(':id/account')
  @CanAccess('students', 'view')
  getAccount(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.access.getAccount(organizationId, id);
  }

  @Post(':id/account')
  @CanAccess('students', 'edit')
  createAccount(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateStudentAccountDto,
  ) {
    return this.access.createAccount(organizationId, id, dto);
  }

  @Post(':id/reset-password')
  @CanAccess('students', 'edit')
  @UseGuards(UserThrottlerGuard)
  @Throttle(RESET_THROTTLE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetMemberPasswordDto,
  ): Promise<void> {
    await this.access.resetPassword(organizationId, id, dto);
  }

  @Get(':id/guardians')
  @CanAccess('students', 'view')
  listGuardians(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.guardians.findAll(organizationId, id);
  }

  @Post(':id/guardians')
  @CanAccess('students', 'edit')
  createGuardian(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateGuardianDto,
  ) {
    return this.guardians.create(organizationId, id, dto);
  }

  @Patch(':id/guardians/:guardianId')
  @CanAccess('students', 'edit')
  updateGuardian(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('guardianId', ParseIntPipe) guardianId: number,
    @Body() dto: UpdateGuardianDto,
  ) {
    return this.guardians.update(organizationId, id, guardianId, dto);
  }

  @Delete(':id/guardians/:guardianId')
  @CanAccess('students', 'edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeGuardian(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('guardianId', ParseIntPipe) guardianId: number,
  ): Promise<void> {
    await this.guardians.remove(organizationId, id, guardianId);
  }

  @Post(':id/guardians/:guardianId/account')
  @CanAccess('students', 'edit')
  createGuardianAccount(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('guardianId', ParseIntPipe) guardianId: number,
    @Body() dto: CreateStudentAccountDto,
  ) {
    return this.guardians.createAccount(organizationId, id, guardianId, dto);
  }

  @Post(':id/guardians/:guardianId/reset-password')
  @CanAccess('students', 'edit')
  @UseGuards(UserThrottlerGuard)
  @Throttle(RESET_THROTTLE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetGuardianPassword(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('guardianId', ParseIntPipe) guardianId: number,
    @Body() dto: ResetMemberPasswordDto,
  ): Promise<void> {
    await this.guardians.resetPassword(organizationId, id, guardianId, dto);
  }
}
