import { ArgumentsHost, CanActivate, Catch, ExceptionFilter, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { OrgRole, UserType } from '@prisma/client';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../../../shared/interfaces/authenticated-request.interface';
import { forbidden } from './feed-access';
import { FeedErrorCode } from './feed-errors';

/**
 * Corpo de erro com `code` estavel nas rotas do feed: 413 do multer (sem code) -> FILE_TOO_LARGE; 429 do throttler (sem
 * code) -> TOO_MANY_REQUESTS. O resto passa como veio (mesmo formato padrao do Nest).
 */
@Catch(HttpException)
export class FeedExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    const raw = exception.getResponse();
    const body: Record<string, unknown> = typeof raw === 'object' && raw !== null ? { ...(raw as Record<string, unknown>) } : { statusCode: status, message: String(raw) };
    if (!body.code) {
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        Object.assign(body, { statusCode: 413, error: 'Payload Too Large', code: FeedErrorCode.FILE_TOO_LARGE, message: 'A foto passa de 5 MB.' });
      } else if (status === HttpStatus.TOO_MANY_REQUESTS) {
        Object.assign(body, { statusCode: 429, error: 'Too Many Requests', code: FeedErrorCode.TOO_MANY_REQUESTS, message: 'Muitas tentativas. Aguarde um minuto.' });
      }
    }
    res.status(status).json(body);
  }
}

/** Rotas de moderacao: MESTRE/PROFESSOR/INSTRUTOR do grupo (o escopo fino e por post, no service). 403 antes do corpo. */
@Injectable()
export class FeedModeratorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    const ok =
      !!user &&
      user.userType === UserType.MEMBER &&
      user.organizationId != null &&
      ([OrgRole.MESTRE, OrgRole.PROFESSOR, OrgRole.INSTRUTOR] as OrgRole[]).includes(user.role as OrgRole);
    if (!ok) throw forbidden('MODERATION_NOT_ALLOWED', 'Você não tem permissão para moderar o feed.');
    return true;
  }
}

/** Limite lido a cada pedido (os e2e trocam a env). */
const envNumber = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Throttle de ESCRITA: o mesmo @Throttle vale para o guard global (roda ANTES do login: conta por IP, IPv6 agrupado pela
 * sub-rede do @nestjs/throttler) e para o UserThrottlerGuard da rota (depois do login: conta por usuario). O limite
 * muda conforme ja exista `req.user`: alto por IP (turma inteira atras do mesmo Wi-Fi) e baixo por usuario.
 */
export function feedThrottle(userEnv: string, userFallback: number, ipEnv: string, ipFallback: number) {
  return {
    default: {
      ttl: 60_000,
      limit: (ctx: ExecutionContext) => (ctx.switchToHttp().getRequest<AuthenticatedRequest>().user ? envNumber(userEnv, userFallback) : envNumber(ipEnv, ipFallback)),
    },
  };
}

export const FEED_WRITE_THROTTLE = feedThrottle('FEED_WRITE_THROTTLE_LIMIT', 30, 'FEED_WRITE_IP_THROTTLE_LIMIT', 300);
/** Marcar story como visto: a tela chama a cada item exibido (uma rajada ao passar os stories), entao o teto e mais alto. */
export const FEED_STORY_VIEW_THROTTLE = feedThrottle('FEED_STORY_VIEW_THROTTLE_LIMIT', 120, 'FEED_STORY_VIEW_IP_THROTTLE_LIMIT', 1200);
export const FEED_UPLOAD_THROTTLE = feedThrottle('FEED_UPLOAD_THROTTLE_LIMIT', 20, 'FEED_UPLOAD_IP_THROTTLE_LIMIT', 120);
/** Leitura publica das fotos (uma tela carrega dezenas de miniaturas de uma vez): so por IP. */
export const FEED_MEDIA_READ_THROTTLE = { default: { ttl: 60_000, limit: () => envNumber('FEED_MEDIA_READ_THROTTLE_LIMIT', 3000) } };
