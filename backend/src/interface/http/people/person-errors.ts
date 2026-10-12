import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/**
 * Codigos de erro da FICHA UNICA (campo `code` do corpo; os frontends reagem a eles). Corpo sempre
 * `{ statusCode, error, code, message, ...extras }` - mesmo formato dos 403 do access-gate.
 */
export const PersonErrorCode = {
  INVALID_CPF: 'INVALID_CPF',
  BIRTHDATE_REQUIRED_FOR_GUARDIAN_DOCUMENT: 'BIRTHDATE_REQUIRED_FOR_GUARDIAN_DOCUMENT',
  GINGAPP_CODE_NOT_FOUND: 'GINGAPP_CODE_NOT_FOUND',
  IDENTITY_MISMATCH: 'IDENTITY_MISMATCH',
  PERSON_ALREADY_IN_GROUP: 'PERSON_ALREADY_IN_GROUP',
  PERSON_EXISTS_ELSEWHERE: 'PERSON_EXISTS_ELSEWHERE',
  POSSIBLE_DUPLICATE: 'POSSIBLE_DUPLICATE',
  DOCUMENT_BELONGS_TO_OTHER_PERSON: 'DOCUMENT_BELONGS_TO_OTHER_PERSON',
  PERSON_DOCUMENT_LOCKED: 'PERSON_DOCUMENT_LOCKED',
  PERSON_NOT_FOUND: 'PERSON_NOT_FOUND',
  SAME_PERSON: 'SAME_PERSON',
  PERSON_ALREADY_MERGED: 'PERSON_ALREADY_MERGED',
  PERSON_MERGE_SAME_GROUP: 'PERSON_MERGE_SAME_GROUP',
  PERSON_MERGE_USER_CONFLICT: 'PERSON_MERGE_USER_CONFLICT',
} as const;

export type PersonErrorCodeValue = (typeof PersonErrorCode)[keyof typeof PersonErrorCode];

export const PERSON_MESSAGES: Record<PersonErrorCodeValue, string> = {
  INVALID_CPF: 'CPF inválido.',
  BIRTHDATE_REQUIRED_FOR_GUARDIAN_DOCUMENT: 'Informe a data de nascimento para identificar a criança pelo CPF do responsável.',
  GINGAPP_CODE_NOT_FOUND: 'Código GingApp não encontrado.',
  IDENTITY_MISMATCH: 'O código GingApp e o CPF informados pertencem a pessoas diferentes.',
  PERSON_ALREADY_IN_GROUP: 'Esta pessoa já está cadastrada no seu grupo.',
  PERSON_EXISTS_ELSEWHERE:
    'Este capoeirista já tem ficha no GingApp em outro grupo. Ninguém é cadastrado duas vezes: a entrada no seu grupo será por transferência (pedido ao outro grupo, aprovado pela própria pessoa), disponível em breve.',
  POSSIBLE_DUPLICATE:
    'Encontramos fichas com o mesmo nome e data de nascimento em outros grupos. Confira se é a mesma pessoa antes de cadastrar.',
  DOCUMENT_BELONGS_TO_OTHER_PERSON:
    'Este CPF já pertence a outra ficha no GingApp. Se for a mesma pessoa, peça ao suporte para mesclar as fichas.',
  PERSON_DOCUMENT_LOCKED:
    'O CPF desta ficha não pode ser trocado por um grupo porque ela tem matrícula em mais de um grupo. Fale com o suporte.',
  PERSON_NOT_FOUND: 'Ficha não encontrada.',
  SAME_PERSON: 'Informe duas fichas diferentes.',
  PERSON_ALREADY_MERGED: 'Uma das fichas já foi mesclada em outra.',
  PERSON_MERGE_SAME_GROUP:
    'As duas fichas têm matrícula no mesmo grupo. Inative/resolva uma das matrículas nesse grupo antes de mesclar (nenhum dado é apagado).',
  PERSON_MERGE_USER_CONFLICT: 'As duas fichas têm logins diferentes; não é possível mesclar automaticamente.',
};

function body(code: PersonErrorCodeValue, status: number, error: string, extra: Record<string, unknown> = {}) {
  return { statusCode: status, error, code, message: PERSON_MESSAGES[code], ...extra };
}

export const personBadRequest = (code: PersonErrorCodeValue, extra?: Record<string, unknown>) =>
  new BadRequestException(body(code, 400, 'Bad Request', extra));
export const personConflict = (code: PersonErrorCodeValue, extra?: Record<string, unknown>) =>
  new ConflictException(body(code, 409, 'Conflict', extra));
export const personNotFound = (extra?: Record<string, unknown>) =>
  new NotFoundException(body(PersonErrorCode.PERSON_NOT_FOUND, 404, 'Not Found', extra));
