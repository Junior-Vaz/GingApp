import { AckRequirement, AckResponse, CommunicationScope, CommunicationStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
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
import { LimitOffsetQueryDto } from '../../../../shared/pagination/pagination';
import { blankImageToNull, IsImageRef } from '../../../../shared/uploads/image-ref';

/** Papeis do alcance ROLE (EQUIPE nao existe em OrgRole: MESTRE + PROFESSOR + INSTRUTOR). */
export const COMMUNICATION_ROLES = ['ALUNO', 'RESPONSAVEL', 'EQUIPE'] as const;
export type CommunicationRole = (typeof COMMUNICATION_ROLES)[number];

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Alcance do Comunicar. GROUP e BIRTHDAY_MONTH nao pedem nada; UNIT pede unitId; CLASS pede classId; ROLE pede role. */
export class CommunicationScopeDto {
  @IsEnum(CommunicationScope, { message: `scope.type deve ser um de: ${Object.values(CommunicationScope).join(', ')}.` })
  type!: CommunicationScope;

  @IsOptional()
  @IsInt()
  unitId?: number;

  @IsOptional()
  @IsInt()
  classId?: number;

  @IsOptional()
  @IsIn(COMMUNICATION_ROLES, { message: `scope.role deve ser um de: ${COMMUNICATION_ROLES.join(', ')}.` })
  role?: CommunicationRole;
}

/** GET /communications/preview?scope=&unitId=&classId=&role= */
export class PreviewCommunicationQueryDto {
  @IsEnum(CommunicationScope, { message: `scope deve ser um de: ${Object.values(CommunicationScope).join(', ')}.` })
  scope!: CommunicationScope;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  unitId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  classId?: number;

  @IsOptional()
  @IsIn(COMMUNICATION_ROLES, { message: `role deve ser um de: ${COMMUNICATION_ROLES.join(', ')}.` })
  role?: CommunicationRole;
}

/** POST /communications */
export class CreateCommunicationDto {
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'title deve ter no mínimo 2 caracteres.' })
  @MaxLength(80, { message: 'title deve ter no máximo 80 caracteres.' })
  title!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'body deve ter no mínimo 2 caracteres.' })
  @MaxLength(2000, { message: 'body deve ter no máximo 2000 caracteres.' })
  body!: string;

  /** Mesmo formato do Event.imageUrl: /api/uploads/<uuid>.<ext> (POST /uploads) ou URL http(s). */
  @IsOptional()
  @Transform(blankImageToNull)
  @MaxLength(2048)
  @IsImageRef()
  imageUrl?: string | null;

  @IsObject()
  @ValidateNested()
  @Type(() => CommunicationScopeDto)
  scope!: CommunicationScopeDto;

  /** Futuro, ate 90 dias. Omitido = envia agora. */
  @IsOptional()
  @IsDateString()
  scheduledAt?: string | null;

  @IsOptional()
  @IsEnum(AckRequirement, { message: `requiresAck deve ser um de: ${Object.values(AckRequirement).join(', ')}.` })
  requiresAck?: AckRequirement;

  @IsOptional()
  @IsBoolean()
  pinToFeed?: boolean;

  /** Futuro (e depois do agendamento). So vale com pinToFeed. */
  @IsOptional()
  @IsDateString()
  pinnedUntil?: string | null;

  /** Contagem que o usuario confirmou na previa; obrigatoria (e igual a atual) so com MAIS de 50 destinatarios. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  confirmCount?: number;
}

/** GET /communications */
export class ListCommunicationsQueryDto extends LimitOffsetQueryDto {
  @IsOptional()
  @IsEnum(CommunicationStatus, { message: `status deve ser um de: ${Object.values(CommunicationStatus).join(', ')}.` })
  status?: CommunicationStatus;

  @IsOptional()
  @IsEnum(CommunicationScope, { message: `scope deve ser um de: ${Object.values(CommunicationScope).join(', ')}.` })
  scope?: CommunicationScope;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** POST /communications/:id/ack */
export class AckCommunicationDto {
  @IsEnum(AckResponse, { message: `response deve ser um de: ${Object.values(AckResponse).join(', ')}.` })
  response!: AckResponse;
}
