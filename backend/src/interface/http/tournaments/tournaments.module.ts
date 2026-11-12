import { Module } from '@nestjs/common';
import { RegistrationFormsModule } from '../registration-forms/registration-forms.module';
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
  // RegistrationFormsModule exporta o provedor de foto/nascimento da inscricao (TOURNAMENT_PHOTO_SOURCE) para a importacao do evento.
  imports: [RegistrationFormsModule],
  controllers: [TournamentsController, PublicTournamentsController],
  providers: [TournamentsService, TournamentPublicService, TournamentLiveHub],
  // TournamentsService: a anonimizacao LGPD (aluno/inscricao) chama anonymizeCompetitors().
  exports: [TournamentLiveHub, TournamentPublicService, TournamentsService],
})
export class TournamentsModule {}
