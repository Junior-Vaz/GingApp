import { Controller, Get, Header } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../shared/decorators/public.decorator';
import { PublicTransparency, TransparencyService } from './transparency.service';

/** Limite lido a cada pedido (os e2e trocam a env). */
const envNumber = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** 60/min POR IP (TRANSPARENCY_THROTTLE_LIMIT) no guard global, como o clique publico dos patrocinadores. */
const PUBLIC_THROTTLE = { default: { ttl: 60_000, limit: () => envNumber('TRANSPARENCY_THROTTLE_LIMIT', 60) } };

/**
 * Pagina publica de transparencia (docs/CONTRATO_TRANSPARENCIA.md 4): SEM login, sem query, sem auditoria. Nao le nem
 * guarda IP/User-Agent (o IP so vive na memoria do throttler; a linha do log de requisicao sai sem userId/ip, ver
 * request-log.middleware.ts). So totais por categoria/mes dos meses PUBLICADOS.
 */
@Controller('transparency')
export class TransparencyController {
  constructor(private readonly service: TransparencyService) {}

  @Public()
  @Get()
  @Throttle(PUBLIC_THROTTLE)
  @Header('Cache-Control', 'public, max-age=300')
  get(): Promise<PublicTransparency> {
    return this.service.publicReport();
  }
}
