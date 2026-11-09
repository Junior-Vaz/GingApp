import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../shared/decorators/public.decorator';
import { clientIpKey } from '../registration-forms/form-codes';
import { ConfirmGroupApplicationEmailDto, CreateGroupApplicationDto } from './dto/group-application.dto';
import { GroupApplicationsService } from './group-applications.service';

/** Limite lido a cada pedido (os e2e trocam a env). */
const envNumber = (name: string, fallback: number) => (): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Chave do limite por IP (IPv6 agrupado por /64, SSOT clientIpKey): trocar o sufixo do endereco nao zera o limite. */
const ipTracker = (req: Record<string, any>): string =>
  `group-app-ip:${clientIpKey(typeof req.ip === 'string' ? req.ip : null) ?? 'unknown'}`;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** Pedido: 5 por HORA por IP (GROUP_APPLICATION_SUBMIT_THROTTLE_LIMIT). Status: 30/min por IP (GROUP_APPLICATION_STATUS_THROTTLE_LIMIT). */
const SUBMIT_THROTTLE = { default: { ttl: HOUR_MS, limit: envNumber('GROUP_APPLICATION_SUBMIT_THROTTLE_LIMIT', 5), getTracker: ipTracker } };
const STATUS_THROTTLE = { default: { ttl: MINUTE_MS, limit: envNumber('GROUP_APPLICATION_STATUS_THROTTLE_LIMIT', 30), getTracker: ipTracker } };
/** Confirmar o e-mail: 20/min por IP (GROUP_APPLICATION_CONFIRM_THROTTLE_LIMIT). Reenviar: 3/HORA por IP (GROUP_APPLICATION_RESEND_THROTTLE_LIMIT). */
const CONFIRM_THROTTLE = { default: { ttl: MINUTE_MS, limit: envNumber('GROUP_APPLICATION_CONFIRM_THROTTLE_LIMIT', 20), getTracker: ipTracker } };
const RESEND_THROTTLE = { default: { ttl: HOUR_MS, limit: envNumber('GROUP_APPLICATION_RESEND_THROTTLE_LIMIT', 3), getTracker: ipTracker } };

/**
 * Pedido PUBLICO de cadastro de grupo (docs/CONTRATO_ADESAO_GRUPOS.md 3 e docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md 1), sem
 * login, para as paginas /comecar do painel. Nao le nem guarda IP/User-Agent (o IP so vive na memoria do throttler; a
 * linha do log de requisicao sai sem userId/ip, so com o PADRAO da rota, e nunca com o corpo, ver
 * request-log.middleware.ts). Nao auditado. Respostas sem cache.
 */
@Controller('public/group-applications')
export class PublicGroupApplicationsController {
  constructor(private readonly service: GroupApplicationsService) {}

  /**
   * Sempre 201 `{ statusToken, status, emailVerification }` quando o corpo e valido (inclusive e-mail ja cadastrado e
   * honeypot). Os valores dependem so de o e-mail transacional estar ligado.
   */
  @Public()
  @Throttle(SUBMIT_THROTTLE)
  @Header('Cache-Control', 'no-store')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  submit(@Body() dto: CreateGroupApplicationDto) {
    return this.service.submit(dto);
  }

  /**
   * Confirma o e-mail pelo token do LINK, no CORPO (POST de proposito: scanners de e-mail que abrem links nao consomem
   * o token). 200 `{ status: 'PENDING' }`; mal formado/inexistente/vencido/ja usado = o mesmo 404. Declarada antes de
   * `:token` (rota estatica primeiro).
   */
  @Public()
  @Throttle(CONFIRM_THROTTLE)
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex')
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@Body() dto: ConfirmGroupApplicationEmailDto) {
    return this.service.confirmEmail(dto.token);
  }

  /**
   * Reenvia o link de confirmacao (`:token` = token de ACOMPANHAMENTO). Sempre 204 neutro (token desconhecido tambem),
   * exceto 429 (limite por IP, 5 min entre envios ou 3 envios por pedido).
   */
  @Public()
  @Throttle(RESEND_THROTTLE)
  @Header('Cache-Control', 'no-store')
  @Post(':token/resend')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resend(@Param('token') token: string): Promise<void> {
    await this.service.resendVerification(token);
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
