import {
  BadRequestException,
  Body,
  Controller,
  ExecutionContext,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { Public } from '../../../shared/decorators/public.decorator';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { CommunicationsExceptionFilter } from '../communications/communications-http';
import { SponsorViewerQueryDto } from './dto/sponsor.dto';
import { SponsorSlide, SponsorsService } from './sponsors.service';

/** Limite lido a cada pedido (os e2e trocam a env). */
const envNumber = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Impressao: 120/min POR USUARIO (SPONSOR_IMPRESSION_THROTTLE_LIMIT) no UserThrottlerGuard da rota; antes do login o guard
 * global conta por IP com o teto global (SPONSOR_IMPRESSION_IP_THROTTLE_LIMIT, padrao = GLOBAL_THROTTLE_LIMIT). Mesmo
 * desenho do POST /attendance/geo-checkin.
 */
const IMPRESSION_THROTTLE = {
  default: {
    ttl: 60_000,
    limit: (ctx: ExecutionContext) =>
      ctx.switchToHttp().getRequest<{ user?: unknown }>().user
        ? envNumber('SPONSOR_IMPRESSION_THROTTLE_LIMIT', 120)
        : envNumber('SPONSOR_IMPRESSION_IP_THROTTLE_LIMIT', envNumber('GLOBAL_THROTTLE_LIMIT', 600)),
  },
};

/** Clique (publico): 60/min POR IP (SPONSOR_CLICK_THROTTLE_LIMIT) no guard global. O IP so vive na memoria do throttler. */
const CLICK_THROTTLE = { default: { ttl: 60_000, limit: () => envNumber('SPONSOR_CLICK_THROTTLE_LIMIT', 60) } };

/**
 * Patrocinadores no app (docs/CONTRATO_PATROCINADORES.md 4.1 e 4.2). Nenhuma destas rotas grava ou loga usuario, IP ou
 * User-Agent (o log de requisicao sai sem userId/ip para /api/sponsors/*; ver request-log.middleware.ts).
 */
@Controller('sponsors')
export class SponsorsController {
  constructor(private readonly sponsors: SponsorsService) {}

  /**
   * Ate 2 slides para o espectador: no maximo 1 do GRUPO (primeiro) e 1 da PLATAFORMA, com `scope` e `groupName`
   * (menor / interruptor desligado = { items: [] }). Token de MEMBER do grupo.
   */
  @Get('active')
  @Header('Cache-Control', 'private, max-age=300')
  active(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SponsorViewerQueryDto,
  ): Promise<{ items: SponsorSlide[] }> {
    return this.sponsors.active(organizationId, user, query.studentId);
  }

  /**
   * Conta UMA impressao (sem corpo; corpo ou campo extra = 400). Sempre 204, contando ou nao (menor, campanha inelegivel,
   * robo, interruptor desligado): a resposta nao revela nada. `?studentId=` opcional, mesma regra do GET /sponsors/active.
   */
  @Post(':id/impression')
  @HttpCode(204)
  @UseGuards(UserThrottlerGuard)
  @Throttle(IMPRESSION_THROTTLE)
  @UseFilters(CommunicationsExceptionFilter)
  async impression(
    @Param('id', ParseIntPipe) id: number,
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SponsorViewerQueryDto,
    @Body() body: unknown,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<void> {
    if (body !== undefined && body !== null && (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0)) {
      throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: 'VALIDATION', message: 'Esta rota não recebe corpo.' });
    }
    await this.sponsors.impression(organizationId, user, id, userAgent, query.studentId);
  }

  /**
   * Redirecionador PUBLICO do clique (o link abre numa nova aba, sem Authorization): 302 para a URL GRAVADA + utm. Qualquer
   * outro parametro da query (ex.: `?url=`) e ignorado. Inelegivel/inexistente/desligado = 302 para `<APP_URL>/` (404 sem
   * APP_URL). Nunca grava nem loga IP/User-Agent.
   */
  @Public()
  @Get(':id/click')
  @Throttle(CLICK_THROTTLE)
  @UseFilters(CommunicationsExceptionFilter)
  async click(@Param('id') id: string, @Query('s') state: unknown, @Res() res: Response): Promise<void> {
    const target = await this.sponsors.click(id, state);
    res.set({ 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' });
    if (!target) {
      res.status(404).json({ statusCode: 404, error: 'Not Found', message: 'Link não encontrado.' });
      return;
    }
    res.redirect(302, target);
  }
}
