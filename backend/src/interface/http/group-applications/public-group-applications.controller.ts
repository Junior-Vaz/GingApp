import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../shared/decorators/public.decorator';
import { clientIpKey } from '../registration-forms/form-codes';
import { CreateGroupApplicationDto } from './dto/group-application.dto';
import { GroupApplicationsService } from './group-applications.service';

/** Limite lido a cada pedido (os e2e trocam a env). */
const envNumber = (name: string, fallback: number) => (): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Chave do limite por IP (IPv6 agrupado por /64, SSOT clientIpKey): trocar o sufixo do endereco nao zera o limite. */
const ipTracker = (req: Record<string, any>): string =>
  `group-app-ip:${clientIpKey(typeof req.ip === 'string' ? req.ip : null) ?? 'unknown'}`;

/** Pedido: 5 por HORA por IP (GROUP_APPLICATION_SUBMIT_THROTTLE_LIMIT). Status: 30/min por IP (GROUP_APPLICATION_STATUS_THROTTLE_LIMIT). */
const SUBMIT_THROTTLE = { default: { ttl: 3_600_000, limit: envNumber('GROUP_APPLICATION_SUBMIT_THROTTLE_LIMIT', 5), getTracker: ipTracker } };
const STATUS_THROTTLE = { default: { ttl: 60_000, limit: envNumber('GROUP_APPLICATION_STATUS_THROTTLE_LIMIT', 30), getTracker: ipTracker } };

/**
 * Pedido PUBLICO de cadastro de grupo (docs/CONTRATO_ADESAO_GRUPOS.md 3), sem login, para a pagina /comecar do painel.
 * Nao le nem guarda IP/User-Agent (o IP so vive na memoria do throttler; a linha do log de requisicao sai sem userId/ip e
 * nunca com o corpo, ver request-log.middleware.ts). Nao auditado. Respostas sem cache.
 */
@Controller('public/group-applications')
export class PublicGroupApplicationsController {
  constructor(private readonly service: GroupApplicationsService) {}

  /** Sempre 201 `{ statusToken, status: 'PENDING' }` quando o corpo e valido (inclusive e-mail ja cadastrado e honeypot). */
  @Public()
  @Throttle(SUBMIT_THROTTLE)
  @Header('Cache-Control', 'no-store')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  submit(@Body() dto: CreateGroupApplicationDto) {
    return this.service.submit(dto);
  }

  /** Acompanhamento pelo token (no PATH; nunca em query). Mal formado/inexistente = o mesmo 404. */
  @Public()
  @Throttle(STATUS_THROTTLE)
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex')
  @Get(':token')
  status(@Param('token') token: string) {
    return this.service.publicStatus(token);
  }
}
