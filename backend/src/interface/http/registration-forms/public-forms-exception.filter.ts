import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { FormErrorCode } from './form-codes';

/**
 * Corpo de erro ESTAVEL das rotas publicas do formulario (o app depende do `code`):
 *  - 429 do ThrottlerGuard -> code TOO_MANY_REQUESTS (mensagem em portugues);
 *  - 413 do multer (arquivo acima do limite) -> code FILE_TOO_LARGE;
 *  - 400 do ValidationPipe/multer sem `code` -> code VALIDATION + `fields: {}` (mensagens unidas);
 *  - o resto (ja com `code`) passa como veio. Nunca ecoa o corpo enviado. Respostas de erro sem cache.
 */
@Catch(HttpException)
export class PublicFormsExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    const raw = exception.getResponse();
    const body: Record<string, unknown> =
      typeof raw === 'object' && raw !== null ? { ...(raw as Record<string, unknown>) } : { statusCode: status, message: String(raw) };

    if (!body.code) {
      if (status === HttpStatus.TOO_MANY_REQUESTS) {
        Object.assign(body, {
          statusCode: 429,
          error: 'Too Many Requests',
          code: FormErrorCode.TOO_MANY_REQUESTS,
          message: 'Muitas tentativas. Aguarde um minuto e tente de novo.',
        });
      } else if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        Object.assign(body, { statusCode: 413, error: 'Payload Too Large', code: FormErrorCode.FILE_TOO_LARGE, message: 'O arquivo passa do limite permitido.' });
      } else if (status === HttpStatus.BAD_REQUEST) {
        const message = Array.isArray(body.message) ? (body.message as unknown[]).map(String).join(' ') : String(body.message ?? 'Pedido inválido.');
        Object.assign(body, { statusCode: 400, error: 'Bad Request', code: FormErrorCode.VALIDATION, message, fields: {} });
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json(body);
  }
}
