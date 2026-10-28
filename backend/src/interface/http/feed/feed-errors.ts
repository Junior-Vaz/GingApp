import { BadRequestException, ConflictException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';

/** Codigos estaveis (`code` do corpo de erro) do feed, usados pelo app e pelo painel. */
export const FeedErrorCode = {
  FEED_DISABLED: 'FEED_DISABLED',
  POSTING_NOT_ALLOWED: 'POSTING_NOT_ALLOWED',
  POST_LIMIT: 'POST_LIMIT',
  STORY_LIMIT: 'STORY_LIMIT',
  COMMENT_LIMIT: 'COMMENT_LIMIT',
  COMMENTS_DISABLED: 'COMMENTS_DISABLED',
  VISIBILITY_NOT_ALLOWED: 'VISIBILITY_NOT_ALLOWED',
  MEDIA_INVALID: 'MEDIA_INVALID',
  MEDIA_LIMIT: 'MEDIA_LIMIT',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  MEDIA_PROCESSING_UNAVAILABLE: 'MEDIA_PROCESSING_UNAVAILABLE',
  INVALID_STATE: 'INVALID_STATE',
  INVALID_CURSOR: 'INVALID_CURSOR',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  MODERATION_NOT_ALLOWED: 'MODERATION_NOT_ALLOWED',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  VALIDATION: 'VALIDATION',
} as const;

/** 404 IDENTICO para inexistente, de outro grupo, fora da visibilidade, oculto ou removido (nao enumeravel). */
export function postNotFound(): NotFoundException {
  return new NotFoundException({ statusCode: 404, error: 'Not Found', code: FeedErrorCode.NOT_FOUND, message: 'Post não encontrado.' });
}

/** 404 IDENTICO do story: inexistente, de outro grupo, fora do alcance, vencido, oculto/removido ou que nem e story. */
export function storyNotFound(): NotFoundException {
  return new NotFoundException({ statusCode: 404, error: 'Not Found', code: FeedErrorCode.NOT_FOUND, message: 'Story não encontrado.' });
}

export function commentNotFound(): NotFoundException {
  return new NotFoundException({ statusCode: 404, error: 'Not Found', code: FeedErrorCode.NOT_FOUND, message: 'Comentário não encontrado.' });
}

export function tooMany(code: string, message: string): HttpException {
  return new HttpException({ statusCode: 429, error: 'Too Many Requests', code, message }, HttpStatus.TOO_MANY_REQUESTS);
}

export function invalidState(message: string): ConflictException {
  return new ConflictException({ statusCode: 409, error: 'Conflict', code: FeedErrorCode.INVALID_STATE, message });
}

export function badRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', code, message });
}

export function invalidCursor(): BadRequestException {
  return badRequest(FeedErrorCode.INVALID_CURSOR, 'Cursor inválido.');
}
