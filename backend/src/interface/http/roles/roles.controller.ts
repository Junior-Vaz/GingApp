import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { MestreOnlyGuard } from '../../../shared/guards/mestre-only.guard';
import { IsNewPassword } from '../../../shared/security/new-password.decorator';
import { RolesService } from './roles.service';

class RoleTargetDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  studentId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  personId?: number;

  /** Cargo DO GRUPO (GET /group-roles). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupRoleId?: number;

  /** LEGADO: enum do perfil; mapeado para o cargo padrao do grupo (slug mestre/professor/instrutor/monitor). */
  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;
}

export class GrantRoleDto extends RoleTargetDto {
  /** So para quem ainda nao tem login: e-mail + senha provisoria OU convite por e-mail. */
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsNewPassword()
  password?: string;

  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean;
}

export class RevokeRoleDto extends RoleTargetDto {}

class RoleRuleDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupRoleId?: number;

  /** LEGADO (enum); prefira groupRoleId. */
  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  minLevelOrder!: number;
}

export class SetRoleRulesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RoleRuleDto)
  rules!: RoleRuleDto[];
}

/**
 * Cargos acumulaveis (Fase 3). Conceder/revogar e sugestoes: so o MESTRE do grupo. Regras de corda por cargo: leitura
 * para quem ve graduacoes, escrita so do MESTRE.
 */
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('roles/suggestions')
  @UseGuards(MestreOnlyGuard)
  suggestions(@CurrentOrganization() organizationId: number) {
    return this.roles.suggestions(organizationId);
  }

  @Post('roles/grant')
  @UseGuards(MestreOnlyGuard)
  @CanAccess('teachers', 'create')
  grant(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number, @Body() dto: GrantRoleDto) {
    return this.roles.grant(organizationId, userId, dto);
  }

  @Post('roles/revoke')
  @UseGuards(MestreOnlyGuard)
  @CanAccess('teachers', 'edit')
  @HttpCode(HttpStatus.OK)
  revoke(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number, @Body() dto: RevokeRoleDto) {
    return this.roles.revoke(organizationId, userId, dto);
  }

  @Get('graduations/systems/:id/role-rules')
  @CanAccess('graduations', 'view')
  getRules(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.roles.getRules(organizationId, id);
  }

  @Put('graduations/systems/:id/role-rules')
  @UseGuards(MestreOnlyGuard)
  @CanAccess('graduations', 'edit')
  setRules(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: SetRoleRulesDto) {
    return this.roles.setRules(organizationId, id, dto.rules);
  }
}
