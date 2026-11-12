import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
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
import { TOURNAMENT_PHOTO_MAX_BYTES } from './tournament-photo-storage';
import { TournamentPhotoUploadErrorInterceptor } from './tournament-photo-upload.interceptor';
import { PhotoUpload, TournamentsService } from './tournaments.service';

/** Enviar foto e acao cara (sharp + disco): 20/min por usuario (e por IP). Limite lido a cada pedido (os e2e trocam a env). */
const PHOTO_THROTTLE = {
  default: {
    ttl: 60_000,
    limit: (): number => {
      const n = Number(process.env.TOURNAMENT_PHOTO_THROTTLE_LIMIT);
      return Number.isFinite(n) && n > 0 ? n : 20;
    },
  },
};

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

  // ---- Foto propria do atleta de fora (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md 1) ----

  /** Multipart, campo `file` (JPEG/PNG/WebP ate 5 MB). Define/substitui; devolve a categoria completa. */
  @Post('categories/:cid/competitors/:id/photo')
  @HttpCode(HttpStatus.OK)
  @CanAccess('events', 'edit')
  @UseGuards(UserThrottlerGuard)
  @Throttle(PHOTO_THROTTLE)
  @UseInterceptors(
    TournamentPhotoUploadErrorInterceptor,
    FileInterceptor('file', { limits: { fileSize: TOURNAMENT_PHOTO_MAX_BYTES, files: 1, fields: 5 } }),
  )
  setPhoto(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('cid', ParseIntPipe) cid: number,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: PhotoUpload | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Cliente que desiste (fecha a conexao antes da resposta): a foto na fila do sharp e descartada, sem ocupar vaga.
    const abort = new AbortController();
    res.once('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    return this.service.setCompetitorPhoto(org, user, eventId, cid, id, file, abort.signal);
  }

  @Delete('categories/:cid/competitors/:id/photo')
  @CanAccess('events', 'edit')
  removePhoto(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('cid', ParseIntPipe) cid: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.removeCompetitorPhoto(org, user, eventId, cid, id);
  }

  /** A imagem para o OPERADOR autenticado (o painel baixa como blob): sem cache, sem sniffing, CSP sandbox, CORP same-origin. */
  @Get('categories/:cid/competitors/:id/photo')
  @CanAccess('events', 'view')
  async getPhoto(
    @CurrentOrganization() org: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('cid', ParseIntPipe) cid: number,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const image = await this.service.readCompetitorPhoto(org, user, eventId, cid, id);
    res.set({
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Disposition': 'inline',
    });
    res.status(200).send(image);
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
