import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { OccurrenceKind } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { MestreOnlyGuard } from '../../../shared/guards/mestre-only.guard';
import { OccurrencesService } from './occurrences.service';

export class CreateOccurrenceDto {
  @IsEnum(OccurrenceKind)
  kind!: OccurrenceKind;

  @IsDateString()
  occurredAt!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(280)
  reason!: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  /** So com EXPULSAO: encerra a matricula (Ex-aluno, leftReason EXPELLED). */
  @IsOptional()
  @IsBoolean()
  expel?: boolean;
}

export class RetractOccurrenceDto {
  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}

export class ContestOccurrenceDto {
  @IsString()
  @MinLength(3)
  @MaxLength(280)
  note!: string;
}

/**
 * Ocorrencias do PROPRIO grupo sobre uma matricula: so o MESTRE (PROFESSOR/INSTRUTOR/MONITOR/ALUNO/RESPONSAVEL = 403;
 * aluno de outro grupo = 404). Leitura das ocorrencias de grupos anteriores: so na ficha, via compartilhamento.
 */
@Controller('students/:id/occurrences')
@UseGuards(MestreOnlyGuard)
export class OccurrencesController {
  constructor(private readonly occurrences: OccurrencesService) {}

  @Get()
  list(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.occurrences.list(organizationId, id);
  }

  @Post()
  create(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateOccurrenceDto,
  ) {
    return this.occurrences.create(organizationId, userId, id, dto);
  }

  @Patch(':occurrenceId/retract')
  retract(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('occurrenceId', ParseIntPipe) occurrenceId: number,
    @Body() dto: RetractOccurrenceDto,
  ) {
    return this.occurrences.retract(organizationId, userId, id, occurrenceId, dto.note);
  }
}
