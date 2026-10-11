import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/**
 * Para rotas de entrada pública (login): o ValidationPipe devolve `message` como ARRAY de mensagens;
 * aqui vira UMA string amigável (mensagens unidas por " ") para o frontend exibir direto.
 * Só toca em 400 cujo `message` é array; os demais passam intactos.
 */
@Catch(BadRequestException)
export class JoinedValidationMessageFilter extends BaseExceptionFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost) {
    const body = exception.getResponse();
    if (typeof body === 'object' && body !== null && Array.isArray((body as { message?: unknown }).message)) {
      const messages = (body as { message: unknown[] }).message.map(String);
      return super.catch(new BadRequestException(messages.join(' ')), host);
    }
    return super.catch(exception, host);
  }
}
