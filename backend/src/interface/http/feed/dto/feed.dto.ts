import { FeedPostingMode, FeedReactionType, FeedReportReason, FeedVisibility } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const FEED_BODY_MAX = 2000;
export const FEED_COMMENT_MAX = 500;
export const FEED_REPORT_NOTE_MAX = 300;
export const FEED_MAX_MEDIA_PER_POST = 6;
export const FEED_BLOCKED_WORDS_MAX = 50;
export const FEED_BLOCKED_WORD_MAX_LENGTH = 40;

const CURSOR = /^[A-Za-z0-9_-]{1,80}$/;

/** PUT /feed/settings (MESTRE). */
export class UpdateFeedSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(FeedPostingMode)
  postingMode?: FeedPostingMode;

  @IsOptional()
  @IsBoolean()
  allowComments?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FEED_BLOCKED_WORDS_MAX)
  @IsString({ each: true })
  @MaxLength(FEED_BLOCKED_WORD_MAX_LENGTH, { each: true })
  blockedWords?: string[];
}

export class FeedListQueryDto {
  @IsOptional()
  @IsString()
  @Matches(CURSOR)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number;
}

export class CreateFeedPostDto {
  @IsOptional()
  @IsString()
  @MaxLength(FEED_BODY_MAX)
  body?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FEED_MAX_MEDIA_PER_POST)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2_147_483_647, { each: true })
  mediaIds?: number[];

  @IsEnum(FeedVisibility)
  visibility!: FeedVisibility;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  unitId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  classId?: number;
}

export class UpdateFeedPostDto {
  @IsString()
  @MaxLength(FEED_BODY_MAX)
  body!: string;
}

/** `type: null` remove a reacao; o campo e obrigatorio (ausente = 400). */
export class SetReactionDto {
  @ValidateIf((o: SetReactionDto) => o.type !== null)
  @IsEnum(FeedReactionType)
  type!: FeedReactionType | null;
}

export class FeedCommentsQueryDto extends FeedListQueryDto {}

export class CreateFeedCommentDto {
  @IsString()
  @MaxLength(FEED_COMMENT_MAX)
  body!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  parentId?: number;
}

export class ReportDto {
  @IsEnum(FeedReportReason)
  reason!: FeedReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(FEED_REPORT_NOTE_MAX)
  note?: string;
}

export const MODERATION_KINDS = ['PENDING', 'REPORTED', 'HIDDEN'] as const;
export type ModerationKind = (typeof MODERATION_KINDS)[number];

export class ModerationQueueQueryDto extends FeedListQueryDto {
  @IsOptional()
  @IsIn(MODERATION_KINDS)
  kind?: ModerationKind;
}

export const RESOLVE_ACTIONS = ['DISMISS', 'HIDE', 'REMOVE'] as const;
export type ResolveAction = (typeof RESOLVE_ACTIONS)[number];

export class ResolveReportsDto {
  @IsIn(RESOLVE_ACTIONS)
  action!: ResolveAction;

  /** Extensao do contrato: resolve as denuncias de UM comentario deste post (sem ele = as do post). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  commentId?: number;
}
