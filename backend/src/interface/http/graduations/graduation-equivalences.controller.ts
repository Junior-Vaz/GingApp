import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { MestreOnlyGuard } from '../../../shared/guards/mestre-only.guard';
import { GraduationEquivalencesService } from './graduation-equivalences.service';

export class DeclareEquivalenceDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fromLevelId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  toLevelId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  recognizeForStudentId?: number;
}

export class EquivalenceSuggestionsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  studentId!: number;
}

/** Equivalencia de cordas (Fase 5): so o MESTRE do grupo (quem recebe alunos transferidos). */
@Controller('graduations/equivalences')
@UseGuards(MestreOnlyGuard)
export class GraduationEquivalencesController {
  constructor(private readonly equivalences: GraduationEquivalencesService) {}

  @Get('suggestions')
  @CanAccess('graduations', 'view')
  suggestions(@CurrentOrganization() organizationId: number, @Query() query: EquivalenceSuggestionsQueryDto) {
    return this.equivalences.suggestions(organizationId, query.studentId);
  }

  @Get()
  @CanAccess('graduations', 'view')
  list(@CurrentOrganization() organizationId: number) {
    return this.equivalences.list(organizationId);
  }

  @Post()
  @CanAccess('graduations', 'create')
  declare(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number, @Body() dto: DeclareEquivalenceDto) {
    return this.equivalences.declare(organizationId, userId, dto);
  }
}
