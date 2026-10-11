import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BaseExceptionFilter } from '@nestjs/core';

/**
 * Inteiro fora do range de INT4 (id ou valor gigante vindo do cliente) faz o Prisma lançar um
 * erro "unknown" que virava 500. É erro de entrada, não de servidor: devolve 400.
 * Qualquer outro erro segue o tratamento padrão do Nest.
 */
@Catch(Prisma.PrismaClientUnknownRequestError, Prisma.PrismaClientKnownRequestError)
export class PrismaRangeFilter extends BaseExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientUnknownRequestError | Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const outOfRange =
      /Unable to fit integer value|out of range for the type/i.test(exception.message) ||
      (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2020');
    if (outOfRange) {
      return super.catch(new BadRequestException('Valor numérico fora do intervalo permitido.'), host);
    }
    return super.catch(exception, host);
  }
}
