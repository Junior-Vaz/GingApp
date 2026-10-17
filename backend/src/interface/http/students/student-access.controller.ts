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
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { ResetStudentPasswordDto } from '../../../shared/security/reset-member-password.dto';
import { MESTRE_RESET_THROTTLE_LIMIT } from '../organizations/organizations.controller';
import { CreateGuardianDto } from './dto/create-guardian.dto';
import { CreateStudentAccountDto } from './dto/create-student-account.dto';
import { sendResetPasswordResult } from './member-account';
import { UpdateGuardianDto } from './dto/update-guardian.dto';
import { StudentAccessService } from './student-access.service';
import { StudentGuardiansService } from './student-guardians.service';
import { StudentsService } from './students.service';

/** Redefinir senha de terceiros é raro e sensível: mesmo limite do reset de MESTRE pelo admin (10/min, por
 * IP e por usuário autenticado; MESTRE_RESET_THROTTLE_LIMIT sobe só nos e2e/dev). */
const RESET_THROTTLE = { default: { limit: MESTRE_RESET_THROTTLE_LIMIT, ttl: 60_000 } };

/**
 * Acesso do aluno e responsáveis (E01/E05 do plano), sob /students/:id/... Leitura exige `students.view`;
 * toda escrita exige `students.edit` (MESTRE e PROFESSOR na matriz). O grupo vem SEMPRE do token.
 * Registrado ANTES do StudentsController no módulo só por clareza — os paths não colidem com `:id` simples.
 * Escopo por unidade (E08): TODA rota passa antes por `scoped` (StudentsService.findOne com o usuário), então o
 * PROFESSOR com unidades atribuídas recebe 404 para aluno de outra unidade — mesmo 404 de aluno inexistente.
 */
@Controller('students')
export class StudentAccessController {
  constructor(
    private readonly access: StudentAccessService,
    private readonly guardians: StudentGuardiansService,
    private readonly students: StudentsService,
  ) {}

  private scoped(organizationId: number, id: number, user: AuthenticatedUser) {
    return this.students.findOne(organizationId, id, user);
  }

  @Get(':id/account')
  @CanAccess('students', 'view')
  async getAccount(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.scoped(organizationId, id, user);
    return this.access.getAccount(organizationId, id);
  }

  @Post(':id/account')
  @CanAccess('students', 'edit')
  async createAccount(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateStudentAccountDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.scoped(organizationId, id, user);
    const result = await this.access.createAccount(organizationId, id, dto);
    // Senha provisória gerada pelo servidor: aparece só nesta resposta e nunca pode ficar em cache.
    if (result.temporaryPassword) res.set('Cache-Control', 'no-store');
    return result;
  }

  /**
   * `newPassword` opcional: informada => 204 sem corpo; omitida => o servidor gera a provisória e responde
   * 200 `{ temporaryPassword, mustChangePassword: true }` (no-store). Ver sendResetPasswordResult.
   */
  @Post(':id/reset-password')
  @CanAccess('students', 'edit')
  @UseGuards(UserThrottlerGuard)
  @Throttle(RESET_THROTTLE)
  async resetPassword(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetStudentPasswordDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.scoped(organizationId, id, user);
    sendResetPasswordResult(res, await this.access.resetPassword(organizationId, id, dto));
  }

  @Get(':id/guardians')
  @CanAccess('students', 'view')
  async listGuardians(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.scoped(organizationId, id, user);
    return this.guardians.findAll(organizationId, id);
  }

  @Post(':id/guardians')
  @CanAccess('students', 'edit')
  async createGuardian(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateGuardianDto,
  ) {
    await this.scoped(organizationId, id, user);
    return this.guardians.create(organizationId, id, dto);
  }

  @Patch(':id/guardians/:guardianId')
  @CanAccess('students', 'edit')
  async updateGuardian(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('guardianId', ParseIntPipe) guardianId: number,
    @Body() dto: UpdateGuardianDto,
  ) {
    await this.scoped(organizationId, id, user);
    return this.guardians.update(organizationId, id, guardianId, dto);
  }

  @Delete(':id/guardians/:guardianId')
  @CanAccess('students', 'edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeGuardian(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('guardianId', ParseIntPipe) guardianId: number,
  ): Promise<void> {
    await this.scoped(organizationId, id, user);
    await this.guardians.remove(organizationId, id, guardianId);
  }

  @Post(':id/guardians/:guardianId/account')
  @CanAccess('students', 'edit')
  async createGuardianAccount(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('guardianId', ParseIntPipe) guardianId: number,
    @Body() dto: CreateStudentAccountDto,
  ) {
    await this.scoped(organizationId, id, user);
    return this.guardians.createAccount(organizationId, id, guardianId, dto);
  }

  /** Mesmo contrato de `:id/reset-password` (newPassword opcional; omitida => 200 com temporaryPassword). */
  @Post(':id/guardians/:guardianId/reset-password')
  @CanAccess('students', 'edit')
  @UseGuards(UserThrottlerGuard)
  @Throttle(RESET_THROTTLE)
  async resetGuardianPassword(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('guardianId', ParseIntPipe) guardianId: number,
    @Body() dto: ResetStudentPasswordDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.scoped(organizationId, id, user);
    sendResetPasswordResult(res, await this.guardians.resetPassword(organizationId, id, guardianId, dto));
  }
}
