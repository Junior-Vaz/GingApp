import { Body, Controller, Get, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { TOTAL_COUNT_HEADER } from '../../../shared/pagination/pagination';
import {
  GroupOverviewQueryDto,
  GroupsRankingQueryDto,
  HallOfFameQueryDto,
  RankingMeQueryDto,
  SeasonsQueryDto,
  StudentsRankingQueryDto,
  UpdateRankingSettingsDto,
} from './dto/ranking.dto';
import { RankingQueryService } from './ranking-query.service';

/** Cache curto e PRIVADO (a resposta depende de quem pergunta: "me", opt-in, grupo). */
const CACHE_CONTROL = 'private, max-age=30';

/**
 * Ginga Rank. Todas as rotas exigem token de MEMBER do grupo (qualquer papel); o escopo e' o do proprio ranking
 * (RBAC/escopo de unidade nao se aplica). So' `group-overview` e' da equipe (students.view).
 */
@Controller('ranking')
export class RankingController {
  constructor(private readonly ranking: RankingQueryService) {}

  /** Ranking de alunos: scope GROUP|CITY|STATE|COUNTRY, season YYYY-MM|ALL, category, band, paginado. */
  @Get('students')
  async students(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: StudentsRankingQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', CACHE_CONTROL);
    const result = await this.ranking.students(user, query);
    res.setHeader(TOTAL_COUNT_HEADER, String(result.total));
    return result;
  }

  /** Ranking de grupos (media de pontos por aluno ativo; grupos com mapVisible=true e >= 3 alunos ativos). */
  @Get('groups')
  async groups(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GroupsRankingQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', CACHE_CONTROL);
    const result = await this.ranking.groups(user, query);
    res.setHeader(TOTAL_COUNT_HEADER, String(result.total));
    return result;
  }

  /** Meu progresso: pontos, liga, posicoes, conquistas e configuracoes. `?studentId=` = dependente. */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser, @Query() query: RankingMeQueryDto) {
    return this.ranking.me(user, query.studentId);
  }

  /** Opt-in nos rankings abertos e apelido. Menor sem consentimento do responsavel => 403 GUARDIAN_CONSENT_REQUIRED. */
  @Put('me/settings')
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: RankingMeQueryDto,
    @Body() dto: UpdateRankingSettingsDto,
  ) {
    return this.ranking.updateSettings(user, query.studentId, dto);
  }

  /** Campeoes das temporadas fechadas (Brasil e do proprio grupo). */
  @Get('seasons')
  async seasons(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SeasonsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', CACHE_CONTROL);
    return this.ranking.seasons(user, query.limit);
  }

  /** Hall da fama: ranking de todos os tempos (alias de /ranking/students com season=ALL). */
  @Get('hall-of-fame')
  async hallOfFame(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: HallOfFameQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', CACHE_CONTROL);
    const result = await this.ranking.hallOfFame(user, query);
    res.setHeader(TOTAL_COUNT_HEADER, String(result.total));
    return result;
  }

  /** Visao do grupo para MESTRE/PROFESSOR (painel). */
  @Get('group-overview')
  @CanAccess('students', 'view')
  groupOverview(@CurrentUser() user: AuthenticatedUser, @Query() query: GroupOverviewQueryDto) {
    return this.ranking.groupOverview(user, query);
  }
}
