import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import {
  AddCompetitorDto,
  CreateCategoryDto,
  GenerateDto,
  ImportParticipantsDto,
  MatchResultDto,
  SwapSlotsDto,
  UpdateCategoryDto,
  UpdateCompetitorDto,
  UpdateMatchDto,
  UpdateTournamentDto,
} from './dto/tournament.dto';
import { TournamentsService } from './tournaments.service';

/**
 * API do OPERADOR do chaveamento (docs/CONTRATO_CHAVEAMENTO.md 4), sob o evento. Leitura = `events:view`; escrita =
 * `events:edit`; o service ainda exige a EQUIPE (escrita: MESTRE/PROFESSOR/INSTRUTOR; leitura: + MONITOR), porque a matriz de
 * permissoes deixa `events:view` aberto a ALUNO/RESPONSAVEL e a visao do operador tem dados pessoais (faixa etaria, ids).
 * `organizationId` vem SEMPRE do token.
 */
@Controller('events/:eventId/tournament')
export class TournamentsController {
  constructor(private readonly service: TournamentsService) {}

  @Get()
  @CanAccess('events', 'view')
  get(@CurrentOrganization() org: number, @CurrentUser() user: AuthenticatedUser, @Param('eventId', ParseIntPipe) eventId: number) {
    return this.service.getTournament(org, user, eventId);
  }

  @Post()
  @CanAccess('events', 'edit')
  create(@CurrentOrganization() org: number, @CurrentUser() user: AuthenticatedUser, @Param('eventId', ParseIntPipe) eventId: number) {
    return this.service.createTournament(org, user, eventId);
  }

  @Patch()
  @CanAccess('events', 'edit')
  update(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: UpdateTournamentDto,
  ) {
    return this.service.updateTournament(org, user, eventId, dto.publicEnabled);
  }

  @Post('rotate-token')
  @HttpCode(HttpStatus.OK)
  @CanAccess('events', 'edit')
  rotateToken(@CurrentOrganization() org: number, @CurrentUser() user: AuthenticatedUser, @Param('eventId', ParseIntPipe) eventId: number) {
    return this.service.rotateToken(org, user, eventId);
  }

  // ---- Categorias ----

  @Post('categories')
  @CanAccess('events', 'edit')
  createCategory(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.service.createCategory(org, user, eventId, dto);
  }

  @Get('categories/:cid')
  @CanAccess('events', 'view')
  getCategory(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('cid', ParseIntPipe) cid: number,
  ) {
    return this.service.getCategory(org, user, eventId, cid);
  }

  @Patch('categories/:cid')
  @CanAccess('events', 'edit')
  updateCategory(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('cid', ParseIntPipe) cid: number,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.service.updateCategory(org, user, eventId, cid, dto);
  }

  @Delete('categories/:cid')
  @CanAccess('events', 'edit')
  deleteCategory(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('cid', ParseIntPipe) cid: number,
  ) {
    return this.service.deleteCategory(org, user, eventId, cid);
  }

  // ---- Atletas ----

  /** Rota estatica ANTES de `:cid/competitors` nao e necessaria (caminhos distintos), mas fica junto por clareza. */
  @Post('categories/:cid/competitors/from-participants')
  @HttpCode(HttpStatus.OK)
  @CanAccess('events', 'edit')
  importParticipants(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('cid', ParseIntPipe) cid: number,
    @Body() dto: ImportParticipantsDto,
  ) {
    return this.service.importFromParticipants(org, user, eventId, cid, dto);
  }

  @Post('categories/:cid/competitors')
  @CanAccess('events', 'edit')
  addCompetitor(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('cid', ParseIntPipe) cid: number,
    @Body() dto: AddCompetitorDto,
  ) {
    return this.service.addCompetitor(org, user, eventId, cid, dto);
  }

  @Patch('competitors/:id')
  @CanAccess('events', 'edit')
  updateCompetitor(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCompetitorDto,
  ) {
    return this.service.updateCompetitor(org, user, eventId, id, dto);
  }

  @Delete('competitors/:id')
  @CanAccess('events', 'edit')
  removeCompetitor(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.removeCompetitor(org, user, eventId, id);
  }

  // ---- Sorteio e lutas ----

  @Post('categories/:cid/generate')
  @HttpCode(HttpStatus.OK)
  @CanAccess('events', 'edit')
  generate(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('cid', ParseIntPipe) cid: number,
    @Body() dto: GenerateDto,
  ) {
    return this.service.generate(org, user, eventId, cid, dto);
  }

  @Patch('matches/:mid/slots')
  @CanAccess('events', 'edit')
  swapSlots(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('mid', ParseIntPipe) mid: number,
    @Body() dto: SwapSlotsDto,
  ) {
    return this.service.swapSlots(org, user, eventId, mid, dto);
  }

  @Post('matches/:mid/start')
  @HttpCode(HttpStatus.OK)
  @CanAccess('events', 'edit')
  start(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('mid', ParseIntPipe) mid: number,
  ) {
    return this.service.startMatch(org, user, eventId, mid);
  }

  @Post('matches/:mid/result')
  @HttpCode(HttpStatus.OK)
  @CanAccess('events', 'edit')
  result(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('mid', ParseIntPipe) mid: number,
    @Body() dto: MatchResultDto,
  ) {
    return this.service.recordResult(org, user, eventId, mid, dto);
  }

  @Post('matches/:mid/undo')
  @HttpCode(HttpStatus.OK)
  @CanAccess('events', 'edit')
  undo(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('mid', ParseIntPipe) mid: number,
  ) {
    return this.service.undoMatch(org, user, eventId, mid);
  }

  @Patch('matches/:mid')
  @CanAccess('events', 'edit')
  updateMatch(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('mid', ParseIntPipe) mid: number,
    @Body() dto: UpdateMatchDto,
  ) {
    return this.service.updateMatch(org, user, eventId, mid, dto);
  }
}
