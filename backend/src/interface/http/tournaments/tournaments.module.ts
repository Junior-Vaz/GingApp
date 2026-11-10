import { Module } from '@nestjs/common';
import { PublicTournamentsController } from './public-tournaments.controller';
import { TournamentLiveHub } from './tournament-live-hub';
import { TournamentPublicService } from './tournament-public.service';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';

/**
 * Chaveamento de campeonato ao vivo (docs/CONTRATO_CHAVEAMENTO.md): API do operador (/events/:eventId/tournament/*), telao
 * publico por token (GET /public/tournaments/:token e /stream, SSE) e o hub em memoria que liga as duas pontas. O motor de
 * sorteio/classificacao e puro (engine/). Prisma, auditoria e escopo de unidade vem do SharedModule (global).
 */
@Module({
  controllers: [TournamentsController, PublicTournamentsController],
  providers: [TournamentsService, TournamentPublicService, TournamentLiveHub],
  exports: [TournamentLiveHub, TournamentPublicService],
})
export class TournamentsModule {}
