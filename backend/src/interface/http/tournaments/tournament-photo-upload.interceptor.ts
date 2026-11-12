import { CallHandler, ExecutionContext, HttpStatus, Injectable, NestInterceptor, PayloadTooLargeException } from '@nestjs/common';
import { catchError, Observable, throwError } from 'rxjs';
import { TournamentErrorCode, tournamentError } from './tournament-rules';

/**
 * Fica ANTES do `FileInterceptor` da foto do atleta: o multer corta o envio acima do limite (5 MB) com o 413 generico do Nest
 * (sem `code`); aqui ele vira o 413 do contrato `{ statusCode, message, code: 'PHOTO_TOO_LARGE' }`. Qualquer outro erro passa
 * intacto (so o 413 SEM `code` e reescrito: os erros do service ja trazem o proprio codigo).
 */
@Injectable()
export class TournamentPhotoUploadErrorInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof PayloadTooLargeException) {
          const body = error.getResponse();
          const hasCode = typeof body === 'object' && body !== null && 'code' in body;
          if (!hasCode) {
            return throwError(() => tournamentError(HttpStatus.PAYLOAD_TOO_LARGE, TournamentErrorCode.PHOTO_TOO_LARGE, 'A foto excede o limite de 5 MB.'));
          }
        }
        return throwError(() => error);
      }),
    );
  }
}
