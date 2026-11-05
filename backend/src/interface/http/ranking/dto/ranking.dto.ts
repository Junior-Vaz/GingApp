import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { OptionalStudentId } from '../../../../shared/access/linked-student';
import { BANDS, CATEGORIES, RankingBand, RankingCategory, SHOWCASE_MAX } from '../ranking-rules';

/** 'ALL' (todos os tempos) ou 'YYYY-MM'. */
const SEASON_PATTERN = /^(ALL|\d{4}-(0[1-9]|1[0-2]))$/;
const SEASON_MESSAGE = 'season deve ser "ALL" ou "YYYY-MM".';

export const RANKING_DEFAULT_LIMIT = 50;
export const RANKING_MAX_LIMIT = 100;

class RankingPageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(RANKING_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** GET /ranking/students */
export class StudentsRankingQueryDto extends RankingPageDto {
  @IsOptional()
  @IsIn(['GROUP', 'CITY', 'STATE', 'COUNTRY'])
  scope?: 'GROUP' | 'CITY' | 'STATE' | 'COUNTRY';

  @IsOptional()
  @Matches(SEASON_PATTERN, { message: SEASON_MESSAGE })
  season?: string;

  @IsOptional()
  @IsIn(CATEGORIES as readonly string[])
  category?: RankingCategory;

  @IsOptional()
  @IsIn(BANDS as readonly string[])
  band?: RankingBand;

  /** Dependente do responsavel (como nas rotas /me): define quem e' o "me" da resposta. */
  @OptionalStudentId()
  studentId?: number;
}

/** GET /ranking/groups */
export class GroupsRankingQueryDto extends RankingPageDto {
  @IsOptional()
  @IsIn(['CITY', 'STATE', 'COUNTRY'])
  scope?: 'CITY' | 'STATE' | 'COUNTRY';

  @IsOptional()
  @Matches(SEASON_PATTERN, { message: SEASON_MESSAGE })
  season?: string;
}

/** GET /ranking/hall-of-fame (alias de /ranking/students com season=ALL e category=GENERAL). */
export class HallOfFameQueryDto extends RankingPageDto {
  @IsOptional()
  @IsIn(['GROUP', 'COUNTRY'])
  scope?: 'GROUP' | 'COUNTRY';

  @OptionalStudentId()
  studentId?: number;
}

/** GET /ranking/me e a query do PUT /ranking/me/settings. */
export class RankingMeQueryDto {
  @OptionalStudentId()
  studentId?: number;
}

/** GET /ranking/group-overview */
export class GroupOverviewQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'season deve ser "YYYY-MM".' })
  season?: string;
}

/** PUT /ranking/me/settings */
export class UpdateRankingSettingsDto {
  @IsOptional()
  @IsBoolean()
  optInPublic?: boolean;

  /** null (ou vazio) remove o apelido; regras de conteudo em checkNickname (ranking-rules.ts). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  nickname?: string | null;

  /** Vitrine: 0..3 codigos UNICOS de conquistas ja ganhas (nao ganha => 400 ACHIEVEMENT_NOT_EARNED no service). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SHOWCASE_MAX)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  showcase?: string[] | null;
}

export const POINTS_DEFAULT_LIMIT = 20;
export const POINTS_MAX_LIMIT = 50;

/** GET /ranking/me/points (extrato) */
export class PointStatementQueryDto {
  @IsOptional()
  @Matches(SEASON_PATTERN, { message: SEASON_MESSAGE })
  season?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POINTS_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @OptionalStudentId()
  studentId?: number;
}

export const EVOLUTION_DEFAULT_COUNT = 12;

/** GET /ranking/me/evolution */
export class EvolutionQueryDto {
  @IsOptional()
  @IsIn(['WEEK', 'MONTH'])
  granularity?: 'WEEK' | 'MONTH';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(26)
  count?: number;

  @OptionalStudentId()
  studentId?: number;
}

/** GET /ranking/seasons: quantas temporadas fechadas devolver (mais recentes primeiro). */
export class SeasonsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  limit?: number;
}
