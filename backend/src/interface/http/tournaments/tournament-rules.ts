import { HttpException, HttpStatus } from '@nestjs/common';
import { OrgRole, TournamentFormat } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { isUploadPath, uploadFilenameOf } from '../../../shared/uploads/image-ref';
import { isMinorByBirthDate } from '../feed/feed-minor';

/**
 * Regras PURAS do chaveamento de campeonato (docs/CONTRATO_CHAVEAMENTO.md): limites, papeis, codigos de erro, token do
 * telao, validacao de URL de foto, faixa etaria e janela de visibilidade publica. Sem banco e sem relogio implicito (o
 * `now` e sempre parametro com padrao). Testadas em test/tournaments.spec.ts.
 */

/** Limites do contrato (secoes 1 e 2). */
export const TOURNAMENT_LIMITS = {
  maxCategories: 40,
  minCompetitors: 2,
  maxCompetitors: 128,
  nameMin: 1,
  nameMax: 80,
  displayNameMin: 2,
  displayNameMax: 80,
  groupNameMax: 80,
  graduationMax: 60,
  groupCountMin: 2,
  groupCountMax: 16,
  advanceMin: 1,
  advanceMax: 4,
  seedMin: 1,
  seedMax: 128,
  scoreMax: 999,
  noteMax: 200,
  matMax: 40,
  queueOrderMax: 9999,
  photoUrlMax: 500,
  importMax: 200,
} as const;

/** Tipo de evento que pode ter chaveamento (Event.type e texto livre validado no DTO de eventos). */
export const TOURNAMENT_EVENT_TYPE = 'CAMPEONATO';

/** O telao publico some 30 dias depois do evento (404 identico ao de token inexistente). */
export const PUBLIC_VIEW_DAYS_AFTER_EVENT = 30;
const DAY_MS = 86_400_000;

/** Quem escreve (mesma lista do EventsService.ADMIN_ROLES). MONITOR so le; ALUNO/RESPONSAVEL nem le (403). */
export const TOURNAMENT_WRITE_ROLES: readonly OrgRole[] = [OrgRole.MESTRE, OrgRole.PROFESSOR, OrgRole.INSTRUTOR];
export const TOURNAMENT_READ_ROLES: readonly OrgRole[] = [...TOURNAMENT_WRITE_ROLES, OrgRole.MONITOR];

/** Codigos de erro (campo `code` do corpo `{ statusCode, message, code }`). */
export const TournamentErrorCode = {
  TOURNAMENT_NOT_FOUND: 'TOURNAMENT_NOT_FOUND',
  TOURNAMENT_EXISTS: 'TOURNAMENT_EXISTS',
  EVENT_NOT_TOURNAMENT: 'EVENT_NOT_TOURNAMENT',
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  CATEGORY_NOT_FOUND: 'CATEGORY_NOT_FOUND',
  CATEGORY_LIMIT: 'CATEGORY_LIMIT',
  CATEGORY_NAME_TAKEN: 'CATEGORY_NAME_TAKEN',
  CATEGORY_FULL: 'CATEGORY_FULL',
  NOT_IN_SETUP: 'NOT_IN_SETUP',
  COMPETITOR_NOT_FOUND: 'COMPETITOR_NOT_FOUND',
  COMPETITOR_EXISTS: 'COMPETITOR_EXISTS',
  SEED_TAKEN: 'SEED_TAKEN',
  PARTICIPANT_NOT_ELIGIBLE: 'PARTICIPANT_NOT_ELIGIBLE',
  STUDENT_NOT_ELIGIBLE: 'STUDENT_NOT_ELIGIBLE',
  INVALID_COMPETITOR: 'INVALID_COMPETITOR',
  INVALID_GROUP_CONFIG: 'INVALID_GROUP_CONFIG',
  INVALID_PHOTO_URL: 'INVALID_PHOTO_URL',
  PHOTO_URL_NOT_ALLOWED: 'PHOTO_URL_NOT_ALLOWED',
  PHOTO_FROM_STUDENT: 'PHOTO_FROM_STUDENT',
  PHOTO_FILE_REQUIRED: 'PHOTO_FILE_REQUIRED',
  PHOTO_TOO_LARGE: 'PHOTO_TOO_LARGE',
  PHOTO_TYPE_NOT_ALLOWED: 'PHOTO_TYPE_NOT_ALLOWED',
  PHOTO_UNREADABLE: 'PHOTO_UNREADABLE',
  PHOTO_QUOTA: 'PHOTO_QUOTA',
  PHOTO_PROCESSING_UNAVAILABLE: 'PHOTO_PROCESSING_UNAVAILABLE',
  PHOTO_NOT_FOUND: 'PHOTO_NOT_FOUND',
  AGE_GROUP_FROM_STUDENT: 'AGE_GROUP_FROM_STUDENT',
  NOT_ENOUGH_COMPETITORS: 'NOT_ENOUGH_COMPETITORS',
  ALREADY_GENERATED: 'ALREADY_GENERATED',
  NOT_GENERATED: 'NOT_GENERATED',
  HAS_RESULTS: 'HAS_RESULTS',
  MATCH_NOT_FOUND: 'MATCH_NOT_FOUND',
  SWAP_NOT_ALLOWED: 'SWAP_NOT_ALLOWED',
  MATCH_ALREADY_FINISHED: 'MATCH_ALREADY_FINISHED',
  MATCH_NOT_READY: 'MATCH_NOT_READY',
  MATCH_IS_BYE: 'MATCH_IS_BYE',
  NOTHING_TO_UNDO: 'NOTHING_TO_UNDO',
  INVALID_RESULT: 'INVALID_RESULT',
  DEPENDENT_MATCH_PLAYED: 'DEPENDENT_MATCH_PLAYED',
  INCONSISTENT_STATE: 'INCONSISTENT_STATE',
  TOO_MANY_VIEWERS: 'TOO_MANY_VIEWERS',
} as const;
export type TournamentErrorCodeValue = (typeof TournamentErrorCode)[keyof typeof TournamentErrorCode];

/** Erro HTTP com o corpo do contrato: `{ statusCode, message, code }`. */
export function tournamentError(status: HttpStatus, code: TournamentErrorCodeValue, message: string): HttpException {
  return new HttpException({ statusCode: status, message, code }, status);
}
export const notFound = (code: TournamentErrorCodeValue, message: string) => tournamentError(HttpStatus.NOT_FOUND, code, message);
export const conflict = (code: TournamentErrorCodeValue, message: string) => tournamentError(HttpStatus.CONFLICT, code, message);
export const badRequest = (code: TournamentErrorCodeValue, message: string) => tournamentError(HttpStatus.BAD_REQUEST, code, message);
export const unsupportedMedia = (code: TournamentErrorCodeValue, message: string) => tournamentError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, code, message);

/** 503: o torneio atingiu o limite de conexoes simultaneas do telao. */
export const tooManyViewers = () =>
  tournamentError(HttpStatus.SERVICE_UNAVAILABLE, TournamentErrorCode.TOO_MANY_VIEWERS, 'Muitas pessoas assistindo agora. Tente de novo em instantes.');

/** 404 UNICO do telao publico: token mal formado/inexistente, desligado, evento rascunho/cancelado ou antigo. */
export const PUBLIC_NOT_FOUND_MESSAGE = 'Campeonato não encontrado.';
export const publicNotFound = () => notFound(TournamentErrorCode.TOURNAMENT_NOT_FOUND, PUBLIC_NOT_FOUND_MESSAGE);

export function canReadTournaments(role: OrgRole | null | undefined): boolean {
  return !!role && TOURNAMENT_READ_ROLES.includes(role);
}
export function canWriteTournaments(role: OrgRole | null | undefined): boolean {
  return !!role && TOURNAMENT_WRITE_ROLES.includes(role);
}

// --------------------------------------------------------------------------------------------------------------
// Token do telao
// --------------------------------------------------------------------------------------------------------------

/** 24 bytes aleatorios (192 bits) em base64url = 32 caracteres URL-safe. */
export function generatePublicToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Formato aceito no path (rejeita lixo antes de consultar o banco): 24..64 caracteres base64url. */
const PUBLIC_TOKEN_REGEX = /^[A-Za-z0-9_-]{24,64}$/;
export function isWellFormedPublicToken(token: unknown): token is string {
  return typeof token === 'string' && PUBLIC_TOKEN_REGEX.test(token);
}

// --------------------------------------------------------------------------------------------------------------
// Foto (URL de aluno/evento; a foto de atleta de fora e arquivo proprio: tournament-photo-storage.ts)
// --------------------------------------------------------------------------------------------------------------

/**
 * Referencia de foto validada (`/api/uploads/<uuid>.<ext>` ou `https://...`; nunca `http:`, `javascript:`, `data:` nem caminho
 * relativo estranho). Sem espacos/controle, ate 500 caracteres. O convidado NAO envia mais photoUrl (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md 1);
 * isto serve para REAVALIAR a foto do aluno (Student.photo) e a imagem do evento na leitura publica.
 */
export function isAllowedPhotoRef(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > TOURNAMENT_LIMITS.photoUrlMax) return false;
  if (/[\s\u0000-\u001F\u007F\\]/.test(value)) return false;
  if (isUploadPath(value)) return true;
  if (!/^https:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Caminho publico da foto PROPRIA de um atleta: montado a cada resposta a partir do token (o nome do arquivo nunca vaza fora disto). */
export function ownPhotoPublicPath(token: string, file: string): string {
  return `/api/public/tournaments/${token}/photos/${file}`;
}

/**
 * Foto de ALUNO/EVENTO como o TELAO PUBLICO a entrega: SEMPRE reavalia a referencia (defesa em profundidade: a foto do aluno vem de
 * Student.photo, de outro modulo). Caminho de upload vira `/api/uploads/<uuid>.<ext>` (inclusive URL absoluta que termina nele);
 * `https://` valido passa; qualquer outra coisa = null.
 */
export function publicPhotoRef(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const file = uploadFilenameOf(value);
  if (file) return `/api/uploads/${file}`;
  return isAllowedPhotoRef(value) ? value : null;
}

// --------------------------------------------------------------------------------------------------------------
// Faixa etaria / privacidade da foto (contrato 5)
// --------------------------------------------------------------------------------------------------------------

export type AgeGroupValue = 'ADULT' | 'MINOR' | 'UNKNOWN';

/**
 * Faixa etaria de um atleta LIGADO A ALUNO, recalculada na leitura da(s) data(s) de nascimento disponiveis (Person e/ou
 * Student). Regra conservadora: sem nenhuma data = UNKNOWN; se QUALQUER data indicar menor de 18 anos = MINOR. Usa o helper
 * unico de menoridade do feed (`isMinorByBirthDate`, dia civil de Sao Paulo).
 */
export function ageGroupFromBirthDates(birthDates: Array<Date | null | undefined>, now: Date = new Date()): AgeGroupValue {
  const known = birthDates.filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
  if (known.length === 0) return 'UNKNOWN';
  return known.some((d) => isMinorByBirthDate(d, true, now)) ? 'MINOR' : 'ADULT';
}

/** A foto pode aparecer no telao publico? So ADULT, ou MINOR/UNKNOWN com autorizacao registrada. */
export function photoVisibleOnPublic(ageGroup: AgeGroupValue, photoAuthorized: boolean): boolean {
  return ageGroup === 'ADULT' || photoAuthorized === true;
}

// --------------------------------------------------------------------------------------------------------------
// Visibilidade publica
// --------------------------------------------------------------------------------------------------------------

export interface PublicVisibilityInput {
  publicEnabled: boolean;
  eventStatus: string;
  eventDate: Date;
}

/** O telao esta disponivel? Ligado, evento publicado/encerrado (nao rascunho nem cancelado) e ate 30 dias depois do evento. */
export function isPublicViewAllowed(input: PublicVisibilityInput, now: Date = new Date()): boolean {
  if (!input.publicEnabled) return false;
  if (input.eventStatus !== 'PUBLISHED' && input.eventStatus !== 'CLOSED') return false;
  return now.getTime() - input.eventDate.getTime() <= PUBLIC_VIEW_DAYS_AFTER_EVENT * DAY_MS;
}

// --------------------------------------------------------------------------------------------------------------
// Configuracao de grupos
// --------------------------------------------------------------------------------------------------------------

export interface GroupConfig {
  groupCount: number | null;
  advancePerGroup: number | null;
}

/** Configuracao de grupos do contrato (secao 1): groupCount 2..16, advancePerGroup 1..4, produto >= 2. Devolve a mensagem de erro ou null. */
export function groupConfigError(config: GroupConfig): string | null {
  const { groupCount, advancePerGroup } = config;
  if (groupCount === null || advancePerGroup === null) return 'Informe o número de grupos e quantos classificados avançam por grupo.';
  if (!Number.isInteger(groupCount) || groupCount < TOURNAMENT_LIMITS.groupCountMin || groupCount > TOURNAMENT_LIMITS.groupCountMax) {
    return `O número de grupos deve ficar entre ${TOURNAMENT_LIMITS.groupCountMin} e ${TOURNAMENT_LIMITS.groupCountMax}.`;
  }
  if (!Number.isInteger(advancePerGroup) || advancePerGroup < TOURNAMENT_LIMITS.advanceMin || advancePerGroup > TOURNAMENT_LIMITS.advanceMax) {
    return `Os classificados por grupo devem ficar entre ${TOURNAMENT_LIMITS.advanceMin} e ${TOURNAMENT_LIMITS.advanceMax}.`;
  }
  if (groupCount * advancePerGroup < 2) return 'O mata-mata precisa de pelo menos 2 classificados no total.';
  return null;
}

/** Normaliza a configuracao pelo formato: so GROUPS_KNOCKOUT guarda grupos; so formatos com chave guardam 3o lugar. */
export function normalizeCategoryConfig(
  format: TournamentFormat,
  input: { thirdPlace?: boolean | null; groupCount?: number | null; advancePerGroup?: number | null },
): { thirdPlace: boolean; groupCount: number | null; advancePerGroup: number | null } {
  const grouped = format === TournamentFormat.GROUPS_KNOCKOUT;
  return {
    thirdPlace: format === TournamentFormat.ROUND_ROBIN ? false : input.thirdPlace === true,
    groupCount: grouped ? (input.groupCount ?? null) : null,
    advancePerGroup: grouped ? (input.advancePerGroup ?? null) : null,
  };
}

/**
 * Com `athletes` atletas, cada grupo precisa de ao menos 2 (senao nao ha lutas) e de pelo menos `advancePerGroup` atletas
 * (menor grupo = floor(N / groupCount)). Devolve a mensagem de erro ou null.
 */
export function groupSizeError(athletes: number, config: GroupConfig): string | null {
  if (config.groupCount === null || config.advancePerGroup === null) return 'Configuração de grupos ausente.';
  const smallest = Math.floor(athletes / config.groupCount);
  if (smallest < 2) return `Com ${athletes} atletas e ${config.groupCount} grupos, algum grupo ficaria com menos de 2 atletas.`;
  if (smallest < config.advancePerGroup) {
    return `Com ${athletes} atletas e ${config.groupCount} grupos, o menor grupo teria ${smallest} atleta(s): não dá para classificar ${config.advancePerGroup} por grupo.`;
  }
  return null;
}

// --------------------------------------------------------------------------------------------------------------
// Texto
// --------------------------------------------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Tira caracteres de controle e espacos das pontas; texto vazio vira null. */
export function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned;
}

/** Semente do sorteio: inteiro positivo de 31 bits (cabe em Int do Postgres). */
export function newDrawSeed(): number {
  return (randomBytes(4).readUInt32BE(0) & 0x7fffffff) || 1;
}
