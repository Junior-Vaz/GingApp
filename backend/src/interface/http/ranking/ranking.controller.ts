import {
  BadRequestException,
  Body,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { TOTAL_COUNT_HEADER } from '../../../shared/pagination/pagination';
import { CommunicationsExceptionFilter } from '../communications/communications-http';
import {
  EvolutionQueryDto,
  GroupOverviewQueryDto,
  GroupsRankingQueryDto,
  HallOfFameQueryDto,
  PointStatementQueryDto,
  RankingMeQueryDto,
  SeasonsQueryDto,
  StudentsRankingQueryDto,
  UpdateRankingSettingsDto,
} from './dto/ranking.dto';
import { RankingQueryService } from './ranking-query.service';
import { RankingStudentService } from './ranking-student.service';

/** Cache curto e PRIVADO (a resposta depende de quem pergunta: "me", opt-in, grupo). */
const CACHE_CONTROL = 'private, max-age=30';

/** Limite lido a cada pedido (os e2e trocam a env). */
const envNumber = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * POST /ranking/me/daily-checkin: 30/min POR USUARIO (RANKING_DAILY_CHECKIN_THROTTLE_LIMIT) pelo UserThrottlerGuard da
 * rota; antes do login o guard global conta por IP com o teto global (RANKING_DAILY_CHECKIN_IP_THROTTLE_LIMIT, padrao =
 * GLOBAL_THROTTLE_LIMIT). Mesmo desenho do POST /attendance/geo-checkin. 429 com code TOO_MANY_REQUESTS.
 */
const DAILY_CHECKIN_THROTTLE = {
  default: {
    ttl: 60_000,
    limit: (ctx: ExecutionContext) =>
      ctx.switchToHttp().getRequest<{ user?: unknown }>().user
        ? envNumber('RANKING_DAILY_CHECKIN_THROTTLE_LIMIT', 30)
        : envNumber('RANKING_DAILY_CHECKIN_IP_THROTTLE_LIMIT', envNumber('GLOBAL_THROTTLE_LIMIT', 600)),
  },
};

/**
 * Ginga Rank. Todas as rotas exigem token de MEMBER do grupo (qualquer papel); o escopo e' o do proprio ranking
 * (RBAC/escopo de unidade nao se aplica). So' `group-overview` e' da equipe (students.view).
 */
@Controller('ranking')
export class RankingController {
  constructor(
    private readonly ranking: RankingQueryService,
    private readonly student: RankingStudentService,
  ) {}

  /** "Como funciona": as constantes REAIS de ranking-rules.ts (pontos, limites, ligas, categorias, faixas, conquistas). */
  @Get('rules')
  rules(@Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', CACHE_CONTROL);
    return this.student.rules();
  }

  /** Extrato de pontos do aluno (ou dependente): paginado, rotulo pt-BR montado no servidor, totais por temporada. */
  @Get('me/points')
  async points(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PointStatementQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', CACHE_CONTROL);
    const result = await this.student.points(user, query);
    res.setHeader(TOTAL_COUNT_HEADER, String(result.total));
    return result;
  }

  /** Evolucao semanal/mensal (sempre `count` pontos, zeros incluidos) + melhor semana e sequencias. */
  @Get('me/evolution')
  evolution(@CurrentUser() user: AuthenticatedUser, @Query() query: EvolutionQueryDto, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', CACHE_CONTROL);
    return this.student.evolution(user, query);
  }

  /** Meta do mes (bonus de consistencia) e proxima liga. */
  @Get('me/goal')
  goal(@CurrentUser() user: AuthenticatedUser, @Query() query: RankingMeQueryDto, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', CACHE_CONTROL);
    return this.student.goal(user, query.studentId);
  }

  /** Todas as conquistas (ganhas ou nao) com progresso, raridade (agregada; null em grupo < 10 ativos) e vitrine. */
  @Get('me/achievements')
  achievements(@CurrentUser() user: AuthenticatedUser, @Query() query: RankingMeQueryDto, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', CACHE_CONTROL);
    return this.student.achievements(user, query.studentId);
  }

  /** Estado do check-in diario (hoje, semana, mes, ultimos 7 dias). So aluno ATIVO (403 STUDENT_NOT_ACTIVE). */
  @Get('me/daily-checkin')
  dailyStatus(@CurrentUser() user: AuthenticatedUser, @Query() query: RankingMeQueryDto, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', CACHE_CONTROL);
    return this.student.dailyStatus(user, query.studentId);
  }

  /**
   * Check-in do dia (idempotente). SEM corpo: a data e' SEMPRE a do servidor (America/Sao_Paulo); qualquer campo no corpo
   * = 400 (o corpo nao tem DTO de classe — o ValidationPipe nao o ve —, entao a recusa e' explicita aqui).
   */
  @Post('me/daily-checkin')
  @HttpCode(200)
  @UseGuards(UserThrottlerGuard)
  @Throttle(DAILY_CHECKIN_THROTTLE)
  @UseFilters(CommunicationsExceptionFilter)
  dailyCheckin(@CurrentUser() user: AuthenticatedUser, @Query() query: RankingMeQueryDto, @Body() body: unknown) {
    const extra = body && typeof body === 'object' ? Object.keys(body as Record<string, unknown>) : [];
    if (extra.length > 0 || (body !== undefined && body !== null && typeof body !== 'object')) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: extra.length > 0 ? extra.map((k) => `property ${k} should not exist`) : ['o corpo deve ser vazio'],
      });
    }
    return this.student.dailyCheckin(user, query.studentId);
  }

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
