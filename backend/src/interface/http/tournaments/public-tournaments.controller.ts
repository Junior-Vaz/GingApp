import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../../shared/decorators/public.decorator';
import { TournamentLiveHub } from './tournament-live-hub';
import { TournamentPublicService } from './tournament-public.service';
import { composeSnapshotJson } from './tournament-snapshot';
import { openTournamentStream } from './tournament-stream';

/** Limite lido a cada pedido (os e2e trocam a env). */
const envNumber = (name: string, fallback: number) => (): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * O IP do wi-fi do ginasio e UNICO para centenas de pessoas: limite proprio e ALTO por IP, bem acima do global. GET (e a
 * consulta a cada 3 s do plano B): TOURNAMENT_PUBLIC_THROTTLE_LIMIT, padrao 6000/min (o plano B consulta a cada 3 s = 20/min por tela: 1200 so cabia 60 telas atras do mesmo IP). Abrir o stream:
 * TOURNAMENT_PUBLIC_STREAM_THROTTLE_LIMIT, padrao 120/min.
 */
const READ_THROTTLE = { default: { ttl: 60_000, limit: envNumber('TOURNAMENT_PUBLIC_THROTTLE_LIMIT', 6000) } };
const STREAM_THROTTLE = { default: { ttl: 60_000, limit: envNumber('TOURNAMENT_PUBLIC_STREAM_THROTTLE_LIMIT', 120) } };

/** `If-None-Match` (lista, `*`, `W/`) casa com o ETag atual? */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === etag);
}

/**
 * Telao publico (docs/CONTRATO_CHAVEAMENTO.md 5), SEM login. O token vai no PATH e nunca e logado: a linha do log de
 * requisicao sai so com o PADRAO `/api/public/tournaments/:token` e SEM IP/usuario (request-log.middleware.ts). Nao auditado.
 * Token invalido, desligado, evento rascunho/cancelado ou antigo = o MESMO 404.
 */
@Controller('public/tournaments')
export class PublicTournamentsController {
  constructor(
    private readonly service: TournamentPublicService,
    private readonly hub: TournamentLiveHub,
  ) {}

  /** Cabecalhos de seguranca/cache presentes em TODA resposta (inclusive o 404). */
  private baseHeaders(res: Response): void {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
  }

  @Public()
  @Throttle(STREAM_THROTTLE)
  @Get(':token/stream')
  async stream(@Param('token') token: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    this.baseHeaders(res);
    await openTournamentStream(token, req, res, this.service, this.hub);
  }

  /**
   * Foto PROPRIA de atleta (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md 1). So serve se o token resolve um torneio hoje visivel E a
   * regra de privacidade permite a foto NAQUELE instante; todo outro caso (token errado/rotacionado, torneio de outro grupo,
   * nome inexistente, menor sem autorizacao, autorizacao removida) = o MESMO 404 do snapshot, sem revelar o motivo.
   */
  @Public()
  @Throttle(READ_THROTTLE)
  @Get(':token/photos/:file')
  async photo(@Param('token') token: string, @Param('file') file: string, @Res() res: Response): Promise<void> {
    this.baseHeaders(res);
    const image = await this.service.getPhoto(token, file);
    res.set({
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Robots-Tag': 'noindex',
      'Content-Disposition': 'inline',
    });
    res.status(200).send(image);
  }

  @Public()
  @Throttle(READ_THROTTLE)
  @Get(':token')
  async get(@Param('token') token: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    this.baseHeaders(res);
    const entry = await this.service.getSnapshot(token);
    res.setHeader('ETag', entry.etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (etagMatches(req.headers['if-none-match'], entry.etag)) {
      res.status(304).end();
      return;
    }
    res.status(200).type('application/json').send(composeSnapshotJson(entry.serialized, new Date()));
  }
}
