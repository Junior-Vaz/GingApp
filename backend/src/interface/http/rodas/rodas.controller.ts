import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sendPage } from '../../../shared/pagination/pagination';
import { ListRodasQueryDto } from './dto/list-rodas-query.dto';
import { OptionalAuth, Public } from '../../../shared/decorators/public.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { RodasService } from './rodas.service';
import { RodasOccurrencesService } from './rodas-occurrences.service';
import { GenerateOccurrencesDto } from './dto/generate-occurrences.dto';
import { CreateRodaDto } from './dto/create-roda.dto';
import { UpdateRodaDto } from './dto/update-roda.dto';

@Controller('rodas')
export class RodasController {
  constructor(
    private readonly rodasService: RodasService,
    private readonly occurrencesService: RodasOccurrencesService,
  ) {}

  /** Pública; com token válido (@OptionalAuth) cada item traz também `myParticipation`. */
  @Public()
  @OptionalAuth()
  @Get()
  async findAll(
    @Query() query: ListRodasQueryDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.rodasService.findAll(query, user));
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.rodasService.findOne(id);
  }

  /** Dados públicos de referência para os selects de estado/cidade do formulário. */
  @Public()
  @Get('reference/states')
  listStates() {
    return this.rodasService.listStates();
  }

  @Public()
  @Get('reference/cities')
  listCities(@Query('stateId') stateId?: string) {
    return this.rodasService.listCities(stateId ? Number(stateId) : undefined);
  }

  @Post()
  @CanAccess('rodas', 'create')
  create(@CurrentOrganization() organizationId: number, @Body() dto: CreateRodaDto) {
    return this.rodasService.create(organizationId, dto);
  }

  @Patch(':id')
  @CanAccess('rodas', 'edit')
  update(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRodaDto,
  ) {
    return this.rodasService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @CanAccess('rodas', 'delete')
  remove(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query('series') series?: string,
  ) {
    return this.rodasService.remove(organizationId, id, series === 'true');
  }

  /** Gera (de forma idempotente) as próximas ocorrências de uma roda recorrente (ver RodasOccurrencesService). */
  @Post(':id/generate-occurrences')
  @HttpCode(200)
  @CanAccess('rodas', 'edit')
  generateOccurrences(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: GenerateOccurrencesDto,
  ) {
    return this.occurrencesService.generate(organizationId, id, dto);
  }

  /** Lista pública (quem confirmou presença), mas identificada só para a equipe organizadora
   * (ou PLATFORM) — demais recebem terceiros anonimizados (RodasService.listParticipants). */
  @Public()
  @OptionalAuth()
  @Get(':id/participants')
  listParticipants(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser | undefined) {
    return this.rodasService.listParticipants(id, user);
  }

  /** "Quero participar" — sem @CanAccess: qualquer MEMBER autenticado pode confirmar
   * presença na própria conta (não é uma ação administrativa da organização). */
  @Post(':id/participants')
  join(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.rodasService.join(id, userId);
  }

  @Delete(':id/participants/:participantId')
  leave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('participantId', ParseIntPipe) participantId: number,
  ) {
    return this.rodasService.leave(id, participantId, user);
  }
}
