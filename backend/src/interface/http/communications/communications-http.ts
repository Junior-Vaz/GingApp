import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Corpo de erro com `code` estavel nas rotas do Comunicar: o 429 do throttler sai sem `code` ("ThrottlerException");
 * aqui vira { code: 'TOO_MANY_REQUESTS' } (mesmo codigo que o modulo do feed devolve). O resto passa como veio.
 */
@Catch(HttpException)
export class CommunicationsExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    const raw = exception.getResponse();
    const body: Record<string, unknown> = typeof raw === 'object' && raw !== null ? { ...(raw as Record<string, unknown>) } : { statusCode: status, message: String(raw) };
    if (!body.code && status === HttpStatus.TOO_MANY_REQUESTS) {
      Object.assign(body, { statusCode: 429, error: 'Too Many Requests', code: 'TOO_MANY_REQUESTS', message: 'Muitas tentativas. Aguarde um minuto.' });
    }
    res.status(status).json(body);
  }
}
