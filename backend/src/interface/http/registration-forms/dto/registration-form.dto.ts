import { Transform, Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { RegistrationFormStatus, RegistrationPaymentMode, RegistrationPaymentStatus, RegistrationSubmissionStatus } from '@prisma/client';
import { PageQueryDto } from '../../../../shared/pagination/pagination';
import { IsImageRef, blankImageToNull } from '../../../../shared/uploads/image-ref';
import { FORM_LIMITS, PIX_KEY_TYPES } from '../form-definition';
import { TEMPLATE_KEYS } from '../form-templates';

const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? null : value);

export class CreateRegistrationFormDto {
  /** Opcional quando ha eventId (herda o titulo do evento). */
  @IsOptional()
  @IsString()
  @MaxLength(FORM_LIMITS.titleMax)
  title?: string;

  @IsOptional()
  @IsInt()
  eventId?: number;

  @IsOptional()
  @IsIn(TEMPLATE_KEYS as unknown as string[])
  template?: string;
}

export class FormSectionInputDto {
  /** Secao existente (atualiza) ou ausente (cria). */
  @IsOptional()
  @IsInt()
  id?: number;

  @IsString()
  @MaxLength(FORM_LIMITS.sectionTitleMax)
  title!: string;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(FORM_LIMITS.sectionDescriptionMax)
  description?: string | null;
}

export class FormFieldInputDto {
  /** Chave estavel (gerada pelo cliente). Ausente = o servidor gera. */
  @IsOptional()
  @IsString()
  @MaxLength(48)
  key?: string;

  /** Secao existente (id) OU posicao na lista `sections` deste mesmo PUT (sectionIndex). Ambos ausentes = sem secao. */
  @IsOptional()
  @IsInt()
  sectionId?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(FORM_LIMITS.maxSections - 1)
  sectionIndex?: number | null;

  @IsString()
  @MaxLength(20)
  type!: string;

  @IsString()
  @MaxLength(FORM_LIMITS.consentTextMax)
  label!: string;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(FORM_LIMITS.helpTextMax)
  helpText?: string | null;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FORM_LIMITS.maxOptions + 1)
  options?: unknown[] | null;

  @IsOptional()
  @IsObject()
  validation?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  showIf?: Record<string, unknown> | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(20)
  mapsTo?: string | null;
}

/** PUT /event-forms/:id: salva a definicao INTEIRA de forma atomica (config + secoes + campos). */
export class SaveRegistrationFormDto {
  @IsOptional()
  @IsString()
  @MaxLength(FORM_LIMITS.titleMax)
  title?: string;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(FORM_LIMITS.introMax)
  intro?: string | null;

  @IsOptional()
  @Transform(blankImageToNull)
  @IsImageRef()
  bannerUrl?: string | null;

  @IsOptional()
  @IsInt()
  eventId?: number | null;

  @IsOptional()
  @IsISO8601()
  opensAt?: string | null;

  @IsOptional()
  @IsISO8601()
  closesAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  maxSubmissions?: number | null;

  @IsOptional()
  @IsBoolean()
  allowWaitlist?: boolean;

  @IsOptional()
  @IsIn(Object.values(RegistrationPaymentMode))
  paymentMode?: RegistrationPaymentMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  priceCents?: number | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(FORM_LIMITS.pixKeyMax)
  pixKey?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsIn(PIX_KEY_TYPES as unknown as string[])
  pixKeyType?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(FORM_LIMITS.pixBeneficiaryMax)
  pixBeneficiary?: string | null;

  @IsOptional()
  @IsBoolean()
  requireApproval?: boolean;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(FORM_LIMITS.confirmationMessageMax)
  confirmationMessage?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(FORM_LIMITS.consentTextMax)
  consentText?: string | null;

  /** null = mantem o atual. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  retentionMonths?: number | null;

  /** Aceito e IGNORADO (o painel devolve o que recebeu no GET): a versao e do servidor e sobe quando o texto muda. */
  @Allow()
  consentVersion?: unknown;

  /** sections e fields andam JUNTOS: se vier um, o outro tambem (definicao inteira). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FORM_LIMITS.maxSections)
  @ValidateNested({ each: true })
  @Type(() => FormSectionInputDto)
  sections?: FormSectionInputDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FORM_LIMITS.maxFields)
  @ValidateNested({ each: true })
  @Type(() => FormFieldInputDto)
  fields?: FormFieldInputDto[];
}

export class ListRegistrationFormsQueryDto extends PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  eventId?: number;

  @IsOptional()
  @IsIn(Object.values(RegistrationFormStatus))
  status?: RegistrationFormStatus;
}

export class GetRegistrationFormQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeArchived?: boolean;
}

export class ListSubmissionsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(Object.values(RegistrationSubmissionStatus))
  status?: RegistrationSubmissionStatus;

  @IsOptional()
  @IsIn(Object.values(RegistrationPaymentStatus))
  paymentStatus?: RegistrationPaymentStatus;
}

/** GET /event-forms/:id/submissions/export.csv: os MESMOS filtros da lista, sem paginacao (o arquivo sai em stream). */
export class ExportSubmissionsQueryDto {
  @IsOptional()
  @IsIn(Object.values(RegistrationSubmissionStatus))
  status?: RegistrationSubmissionStatus;

  @IsOptional()
  @IsIn(Object.values(RegistrationPaymentStatus))
  paymentStatus?: RegistrationPaymentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/**
 * Corpo (opcional) de POST /event-forms/:id/submissions/:sid/:action. `reason` so vale para `reject`; `linkStudentId`
 * so para `approve` e `confirm-payment` (o MESTRE confirma o vinculo com a ficha do aluno; o envio anonimo nunca liga).
 */
export class RejectSubmissionDto {
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(1000)
  reason?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  linkStudentId?: number;
}

export class UpdateSubmissionDto {
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(5000)
  internalNote?: string | null;
}
