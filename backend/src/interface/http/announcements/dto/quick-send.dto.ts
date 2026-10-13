import { OrgRole } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const QUICK_SEND_SCOPES = ['GROUP', 'UNIT', 'CLASS', 'ROLE', 'STUDENTS'] as const;
export type QuickSendScope = (typeof QUICK_SEND_SCOPES)[number];

/** Teto de alunos escolhidos num envio (scope STUDENTS). */
export const QUICK_SEND_MAX_STUDENTS = 200;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Alcance do envio rápido. GROUP = todo membro ativo; UNIT/CLASS/ROLE/STUDENTS filtram (cada um exige o seu campo). */
export class QuickSendAudienceDto {
  @IsIn(QUICK_SEND_SCOPES, { message: `audience.scope deve ser um de: ${QUICK_SEND_SCOPES.join(', ')}.` })
  scope!: QuickSendScope;

  /** UNIT: obrigatório. ROLE: opcional (restringe o papel à unidade). */
  @IsOptional()
  @IsInt()
  unitId?: number;

  /** CLASS: obrigatório (alunos matriculados + responsáveis + professor da turma). */
  @IsOptional()
  @IsInt()
  classId?: number;

  /** ROLE: obrigatório (ALUNO, RESPONSAVEL, PROFESSOR, INSTRUTOR, MONITOR, MESTRE). */
  @ValidateIf((o: QuickSendAudienceDto) => o.scope === 'ROLE' || o.audienceRole !== undefined)
  @IsEnum(OrgRole, { message: `audience.audienceRole deve ser um de: ${Object.values(OrgRole).join(', ')}.` })
  audienceRole?: OrgRole;

  /** STUDENTS: obrigatório (1..200 alunos do grupo; recebem o aluno com login e os responsáveis com login). */
  @ValidateIf((o: QuickSendAudienceDto) => o.scope === 'STUDENTS' || o.studentIds !== undefined)
  @IsArray()
  @ArrayMinSize(1, { message: 'audience.studentIds deve ter ao menos 1 aluno.' })
  @ArrayMaxSize(QUICK_SEND_MAX_STUDENTS, { message: `audience.studentIds aceita no máximo ${QUICK_SEND_MAX_STUDENTS} alunos.` })
  @ArrayUnique()
  @IsInt({ each: true })
  studentIds?: number[];
}

/** POST /notifications/send — aviso rápido (notificação/push) sem precisar publicar um comunicado. */
export class QuickSendDto {
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'title deve ter no mínimo 2 caracteres.' })
  @MaxLength(80, { message: 'title deve ter no máximo 80 caracteres.' })
  title!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'body deve ter no mínimo 2 caracteres.' })
  @MaxLength(280, { message: 'body deve ter no máximo 280 caracteres.' })
  body!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => QuickSendAudienceDto)
  audience!: QuickSendAudienceDto;

  /** true também publica um comunicado no mural com o mesmo alcance (sem notificar duas vezes). Não vale para STUDENTS. */
  @IsOptional()
  @IsBoolean()
  alsoPublish?: boolean;
}
