import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { MestreOnlyGuard } from '../../../shared/guards/mestre-only.guard';
import { GROUP_ROLE_ICONS, GROUP_ROLE_RANK_MAX, HEX_COLOR, MAX_GROUP_ROLES } from './group-roles';
import { GroupRolesService } from './group-roles.service';

class GroupRoleStyleDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(GROUP_ROLE_RANK_MAX)
  rank?: number;

  /** #RRGGBB; null limpa. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(HEX_COLOR, { message: 'color deve ser uma cor hex #RRGGBB.' })
  color?: string | null;

  /** Nome de icone lucide da lista permitida; null limpa. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(GROUP_ROLE_ICONS as unknown as string[])
  icon?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateGroupRoleDto extends GroupRoleStyleDto {
  /** 2-30 caracteres (validado no servico, com o codigo INVALID_GROUP_ROLE_NAME). */
  @IsString()
  @MaxLength(60)
  name!: string;

  /** PERFIL DE ACESSO base (o que a pessoa pode fazer no sistema). */
  @IsEnum(StaffRole)
  accessRole!: StaffRole;
}

export class UpdateGroupRoleDto extends GroupRoleStyleDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsEnum(StaffRole)
  accessRole?: StaffRole;
}

export class ReorderGroupRolesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_GROUP_ROLES)
  @Type(() => Number)
  @IsInt({ each: true })
  order!: number[];
}

export class MigrateGroupRoleDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetGroupRoleId!: number;
}

/**
 * CARGOS DO GRUPO (docs/FICHA_UNICA.md secao 13). Leitura: quem le alunos no grupo (filtros/selos do painel); escrita:
 * so o MESTRE do grupo. Outro grupo = 404.
 */
@Controller('group-roles')
export class GroupRolesController {
  constructor(private readonly groupRoles: GroupRolesService) {}

  @Get()
  @CanAccess('students', 'view')
  list(@CurrentOrganization() organizationId: number) {
    return this.groupRoles.list(organizationId);
  }

  @Post()
  @UseGuards(MestreOnlyGuard)
  create(@CurrentOrganization() organizationId: number, @Body() dto: CreateGroupRoleDto) {
    return this.groupRoles.create(organizationId, dto);
  }

  @Put('reorder')
  @UseGuards(MestreOnlyGuard)
  reorder(@CurrentOrganization() organizationId: number, @Body() dto: ReorderGroupRolesDto) {
    return this.groupRoles.reorder(organizationId, dto.order);
  }

  @Patch(':id')
  @UseGuards(MestreOnlyGuard)
  update(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGroupRoleDto) {
    return this.groupRoles.update(organizationId, id, dto);
  }

  @Delete(':id')
  @UseGuards(MestreOnlyGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    await this.groupRoles.remove(organizationId, id);
  }

  @Post(':id/migrate')
  @UseGuards(MestreOnlyGuard)
  @HttpCode(HttpStatus.OK)
  migrate(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MigrateGroupRoleDto,
  ) {
    return this.groupRoles.migrate(organizationId, userId, id, dto.targetGroupRoleId);
  }
}
