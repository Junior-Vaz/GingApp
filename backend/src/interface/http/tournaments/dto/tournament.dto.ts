import { TournamentAgeGroup, TournamentFormat, TournamentResultType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TOURNAMENT_LIMITS as L } from '../tournament-rules';

/**
 * DTOs do chaveamento (docs/CONTRATO_CHAVEAMENTO.md 1, 2 e 4). Campos extras = 400 (ValidationPipe global com
 * whitelist + forbidNonWhitelisted). O DTO barra TIPO e tamanho; as regras de estado (SETUP, resultado, etc.) sao do service.
 * Inteiros so como numero JSON (string "3" = 400).
 */

/** Texto: so aparas nas pontas (a limpeza de controle/vazio -> null e do service). Nao-string passa e o validador decide. */
const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/**
 * `photoUrl` NAO existe mais (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md 1): a foto de atleta de fora e um ARQUIVO enviado por
 * `POST .../competitors/:id/photo`. O campo continua declarado aqui so para o service responder 400 `PHOTO_URL_NOT_ALLOWED`
 * (com o codigo do contrato) em vez do 400 generico da lista branca; QUALQUER valor enviado (inclusive null/'') e recusado.
 */

const NAME_MSG = `name: de ${L.nameMin} a ${L.nameMax} caracteres.`;
const DISPLAY_MSG = `displayName: de ${L.displayNameMin} a ${L.displayNameMax} caracteres.`;
const ID_MSG = (field: string) => `${field}: informe um número inteiro positivo.`;

export class UpdateTournamentDto {
  @IsBoolean({ message: 'publicEnabled: use true ou false.' })
  publicEnabled: boolean;
}

export class CreateCategoryDto {
  @Transform(trim)
  @IsString({ message: NAME_MSG })
  @MinLength(L.nameMin, { message: NAME_MSG })
  @MaxLength(L.nameMax, { message: NAME_MSG })
  name: string;

  @IsEnum(TournamentFormat, { message: 'format: SINGLE_ELIMINATION, ROUND_ROBIN ou GROUPS_KNOCKOUT.' })
  format: TournamentFormat;

  @IsOptional()
  @IsBoolean({ message: 'thirdPlace: use true ou false.' })
  thirdPlace?: boolean;

  @IsOptional()
  @IsInt({ message: 'groupCount: número inteiro.' })
  @Min(L.groupCountMin, { message: `groupCount: de ${L.groupCountMin} a ${L.groupCountMax}.` })
  @Max(L.groupCountMax, { message: `groupCount: de ${L.groupCountMin} a ${L.groupCountMax}.` })
  groupCount?: number;

  @IsOptional()
  @IsInt({ message: 'advancePerGroup: número inteiro.' })
  @Min(L.advanceMin, { message: `advancePerGroup: de ${L.advanceMin} a ${L.advanceMax}.` })
  @Max(L.advanceMax, { message: `advancePerGroup: de ${L.advanceMin} a ${L.advanceMax}.` })
  advancePerGroup?: number;
}

/** PATCH: tudo opcional. Fora de SETUP so `name` pode mudar (regra do service). */
export class UpdateCategoryDto {
  @IsOptional()
  @Transform(trim)
  @IsString({ message: NAME_MSG })
  @MinLength(L.nameMin, { message: NAME_MSG })
  @MaxLength(L.nameMax, { message: NAME_MSG })
  name?: string;

  @IsOptional()
  @IsEnum(TournamentFormat, { message: 'format: SINGLE_ELIMINATION, ROUND_ROBIN ou GROUPS_KNOCKOUT.' })
  format?: TournamentFormat;

  @IsOptional()
  @IsBoolean({ message: 'thirdPlace: use true ou false.' })
  thirdPlace?: boolean;

  @IsOptional()
  @IsInt({ message: 'groupCount: número inteiro.' })
  @Min(L.groupCountMin, { message: `groupCount: de ${L.groupCountMin} a ${L.groupCountMax}.` })
  @Max(L.groupCountMax, { message: `groupCount: de ${L.groupCountMin} a ${L.groupCountMax}.` })
  groupCount?: number | null;

  @IsOptional()
  @IsInt({ message: 'advancePerGroup: número inteiro.' })
  @Min(L.advanceMin, { message: `advancePerGroup: de ${L.advanceMin} a ${L.advanceMax}.` })
  @Max(L.advanceMax, { message: `advancePerGroup: de ${L.advanceMin} a ${L.advanceMax}.` })
  advancePerGroup?: number | null;
}

export class GuestCompetitorDto {
  @Transform(trim)
  @IsString({ message: DISPLAY_MSG })
  @MinLength(L.displayNameMin, { message: DISPLAY_MSG })
  @MaxLength(L.displayNameMax, { message: DISPLAY_MSG })
  displayName: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: `groupName: texto de até ${L.groupNameMax} caracteres.` })
  @MaxLength(L.groupNameMax, { message: `groupName: texto de até ${L.groupNameMax} caracteres.` })
  groupName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: `graduationLabel: texto de até ${L.graduationMax} caracteres.` })
  @MaxLength(L.graduationMax, { message: `graduationLabel: texto de até ${L.graduationMax} caracteres.` })
  graduationLabel?: string;

  @IsOptional()
  @IsEnum(TournamentAgeGroup, { message: 'ageGroup: ADULT, MINOR ou UNKNOWN.' })
  ageGroup?: TournamentAgeGroup;

  /** Recusado pelo service (400 PHOTO_URL_NOT_ALLOWED). */
  @IsOptional()
  photoUrl?: unknown;

  /** Semente ja na criacao (mesma validacao e SEED_TAKEN do PATCH). */
  @IsOptional()
  @IsInt({ message: 'seed: número inteiro.' })
  @Min(L.seedMin, { message: `seed: de ${L.seedMin} a ${L.seedMax}.` })
  @Max(L.seedMax, { message: `seed: de ${L.seedMin} a ${L.seedMax}.` })
  seed?: number;

  /** Autorizacao do responsavel ja na criacao (true grava quem autorizou e quando, como o PATCH). */
  @IsOptional()
  @IsBoolean({ message: 'photoAuthorized: use true ou false.' })
  photoAuthorized?: boolean;
}

/** Exatamente UMA das tres formas (a regra "uma so" e conferida no service). */
export class AddCompetitorDto {
  @IsOptional()
  @IsInt({ message: ID_MSG('eventParticipantId') })
  @Min(1, { message: ID_MSG('eventParticipantId') })
  eventParticipantId?: number;

  @IsOptional()
  @IsInt({ message: ID_MSG('studentId') })
  @Min(1, { message: ID_MSG('studentId') })
  studentId?: number;

  @IsOptional()
  @IsObject({ message: 'guest: informe os dados do atleta convidado.' })
  @ValidateNested()
  @Type(() => GuestCompetitorDto)
  guest?: GuestCompetitorDto;

  /** Semente nas formas `studentId`/`eventParticipantId` (no convidado, vai dentro de `guest.seed`). */
  @IsOptional()
  @IsInt({ message: 'seed: número inteiro.' })
  @Min(L.seedMin, { message: `seed: de ${L.seedMin} a ${L.seedMax}.` })
  @Max(L.seedMax, { message: `seed: de ${L.seedMin} a ${L.seedMax}.` })
  seed?: number;
}

export class ImportParticipantsDto {
  @IsArray({ message: 'eventParticipantIds: lista de números.' })
  @ArrayMinSize(1, { message: 'eventParticipantIds: informe ao menos um participante.' })
  @ArrayMaxSize(L.importMax, { message: `eventParticipantIds: no máximo ${L.importMax} por vez.` })
  @ArrayUnique()
  @IsInt({ each: true, message: ID_MSG('eventParticipantIds') })
  @Min(1, { each: true, message: ID_MSG('eventParticipantIds') })
  eventParticipantIds: number[];
}

export class UpdateCompetitorDto {
  @IsOptional()
  @Transform(trim)
  @IsString({ message: DISPLAY_MSG })
  @MinLength(L.displayNameMin, { message: DISPLAY_MSG })
  @MaxLength(L.displayNameMax, { message: DISPLAY_MSG })
  displayName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: `groupName: texto de até ${L.groupNameMax} caracteres.` })
  @MaxLength(L.groupNameMax, { message: `groupName: texto de até ${L.groupNameMax} caracteres.` })
  groupName?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: `graduationLabel: texto de até ${L.graduationMax} caracteres.` })
  @MaxLength(L.graduationMax, { message: `graduationLabel: texto de até ${L.graduationMax} caracteres.` })
  graduationLabel?: string | null;

  @IsOptional()
  @IsInt({ message: 'seed: número inteiro.' })
  @Min(L.seedMin, { message: `seed: de ${L.seedMin} a ${L.seedMax}.` })
  @Max(L.seedMax, { message: `seed: de ${L.seedMin} a ${L.seedMax}.` })
  seed?: number | null;

  @IsOptional()
  @IsEnum(TournamentAgeGroup, { message: 'ageGroup: ADULT, MINOR ou UNKNOWN.' })
  ageGroup?: TournamentAgeGroup;

  @IsOptional()
  @IsBoolean({ message: 'photoAuthorized: use true ou false.' })
  photoAuthorized?: boolean;

  /** Recusado pelo service (400 PHOTO_URL_NOT_ALLOWED). */
  @IsOptional()
  photoUrl?: unknown;
}

export class GenerateDto {
  @IsEnum(['RANDOM', 'BY_SEED', 'AVOID_SAME_GROUP'], { message: 'seeding: RANDOM, BY_SEED ou AVOID_SAME_GROUP.' })
  seeding: 'RANDOM' | 'BY_SEED' | 'AVOID_SAME_GROUP';

  @IsOptional()
  @IsBoolean({ message: 'regenerate: use true ou false.' })
  regenerate?: boolean;
}

export class SwapSlotsDto {
  @IsOptional()
  @IsInt({ message: ID_MSG('slotAId') })
  @Min(1, { message: ID_MSG('slotAId') })
  slotAId?: number;

  @IsOptional()
  @IsInt({ message: ID_MSG('slotBId') })
  @Min(1, { message: ID_MSG('slotBId') })
  slotBId?: number;
}

export class MatchResultDto {
  @IsOptional()
  @IsInt({ message: ID_MSG('winnerId') })
  @Min(1, { message: ID_MSG('winnerId') })
  winnerId?: number | null;

  @IsOptional()
  @IsInt({ message: 'scoreA: número inteiro.' })
  @Min(0, { message: `scoreA: de 0 a ${L.scoreMax}.` })
  @Max(L.scoreMax, { message: `scoreA: de 0 a ${L.scoreMax}.` })
  scoreA?: number | null;

  @IsOptional()
  @IsInt({ message: 'scoreB: número inteiro.' })
  @Min(0, { message: `scoreB: de 0 a ${L.scoreMax}.` })
  @Max(L.scoreMax, { message: `scoreB: de 0 a ${L.scoreMax}.` })
  scoreB?: number | null;

  @IsOptional()
  @IsEnum(TournamentResultType, { message: 'resultType: NORMAL, WALKOVER, DISQUALIFICATION ou DRAW.' })
  resultType?: TournamentResultType;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: `note: texto de até ${L.noteMax} caracteres.` })
  @MaxLength(L.noteMax, { message: `note: texto de até ${L.noteMax} caracteres.` })
  note?: string | null;
}

export class UpdateMatchDto {
  @IsOptional()
  @IsInt({ message: 'mat: número inteiro (tatame).' })
  @Min(0, { message: `mat: de 0 a ${L.matMax}.` })
  @Max(L.matMax, { message: `mat: de 0 a ${L.matMax}.` })
  mat?: number | null;

  @IsOptional()
  @IsInt({ message: 'queueOrder: número inteiro.' })
  @Min(0, { message: `queueOrder: de 0 a ${L.queueOrderMax}.` })
  @Max(L.queueOrderMax, { message: `queueOrder: de 0 a ${L.queueOrderMax}.` })
  queueOrder?: number | null;
}
