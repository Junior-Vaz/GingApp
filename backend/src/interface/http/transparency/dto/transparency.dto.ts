import { LedgerCategory, LedgerEntryType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { PageQueryDto } from '../../../../shared/pagination/pagination';
import { TRANSPARENCY_LIMITS } from '../transparency-rules';

/**
 * DTOs da transparencia (docs/CONTRATO_TRANSPARENCIA.md secao 3). O DTO barra TIPO e tamanho bruto; a regra fina (par
 * tipo x categoria, data civil real e nao futura, mes publicado) e do service, sempre 400/409 com `code`. Campos extras =
 * 400 (ValidationPipe forbidNonWhitelisted). amountCents: inteiro JSON (string "100" ou 10.5 = 400; nunca float).
 */

const L = TRANSPARENCY_LIMITS;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Texto vazio/so espacos vira null (LIMPA a coluna opcional); undefined = nao mexe. */
const blankToNull = ({ value }: { value: unknown }): unknown => (typeof value === 'string' && value.trim() === '' ? null : value);

/** Campo obrigatorio no PATCH: ausente = nao mexe; presente (inclusive null) = validado (null => 400). */
const IfPresent = () => ValidateIf((_o, v) => v !== undefined);

const TYPE_MESSAGE = 'type: use RECEITA ou DESPESA.';
const CATEGORY_MESSAGE = 'category: categoria inválida.';
const AMOUNT_INT = 'amountCents: informe o valor em centavos inteiros (ex.: 1999 = R$ 19,99).';
const AMOUNT_RANGE = `amountCents: entre ${L.amountMin} e ${L.amountMax} centavos.`;
const DAY_MESSAGE = 'occurredOn: use a data no formato AAAA-MM-DD.';
const DESCRIPTION_MESSAGE = `description: informe a descrição (até ${L.descriptionMax} caracteres).`;

export class CreateLedgerEntryDto {
  @IsEnum(LedgerEntryType, { message: TYPE_MESSAGE })
  type: LedgerEntryType;

  @IsEnum(LedgerCategory, { message: CATEGORY_MESSAGE })
  category: LedgerCategory;

  @IsInt({ message: AMOUNT_INT })
  @Min(L.amountMin, { message: AMOUNT_RANGE })
  @Max(L.amountMax, { message: AMOUNT_RANGE })
  amountCents: number;

  @IsString({ message: DAY_MESSAGE })
  @Matches(DAY_PATTERN, { message: DAY_MESSAGE })
  occurredOn: string;

  @IsString({ message: DESCRIPTION_MESSAGE })
  @MaxLength(L.descriptionMax + 200, { message: DESCRIPTION_MESSAGE })
  description: string;
}

export class UpdateLedgerEntryDto {
  @IfPresent()
  @IsEnum(LedgerEntryType, { message: TYPE_MESSAGE })
  type?: LedgerEntryType;

  @IfPresent()
  @IsEnum(LedgerCategory, { message: CATEGORY_MESSAGE })
  category?: LedgerCategory;

  @IfPresent()
  @IsInt({ message: AMOUNT_INT })
  @Min(L.amountMin, { message: AMOUNT_RANGE })
  @Max(L.amountMax, { message: AMOUNT_RANGE })
  amountCents?: number;

  @IfPresent()
  @IsString({ message: DAY_MESSAGE })
  @Matches(DAY_PATTERN, { message: DAY_MESSAGE })
  occurredOn?: string;

  @IfPresent()
  @IsString({ message: DESCRIPTION_MESSAGE })
  @MaxLength(L.descriptionMax + 200, { message: DESCRIPTION_MESSAGE })
  description?: string;
}

/** GET /platform-finance/entries: ?month=&type=&category=&q=&limit=&offset= (q busca na description). */
export class ListLedgerEntriesQueryDto extends PageQueryDto {
  @IsOptional()
  @Matches(MONTH_PATTERN, { message: 'month: use AAAA-MM.' })
  month?: string;

  @IsOptional()
  @IsEnum(LedgerEntryType, { message: TYPE_MESSAGE })
  type?: LedgerEntryType;

  @IsOptional()
  @IsEnum(LedgerCategory, { message: CATEGORY_MESSAGE })
  category?: LedgerCategory;
}

/** GET /platform-finance/entries.csv?month= (opcional: sem mes = todos, ate EXPORT_MAX_ROWS). */
export class LedgerCsvQueryDto {
  @IsOptional()
  @Matches(MONTH_PATTERN, { message: 'month: use AAAA-MM.' })
  month?: string;
}

/** POST /platform-finance/months/:month/publish { note? } (texto PUBLICO; vazio = null). */
export class PublishMonthDto {
  @IsOptional()
  @Transform(blankToNull)
  @IsString({ message: 'note: deve ser texto.' })
  @MaxLength(L.noteMax, { message: `note: no máximo ${L.noteMax} caracteres.` })
  note?: string | null;
}

const CENTS_INT = (field: string) => `${field}: informe o valor em centavos inteiros.`;
const CENTS_RANGE = (field: string) => `${field}: entre 0 e ${L.settingCentsMax} centavos.`;

/**
 * PUT /platform-finance/settings. Todos opcionais: campo AUSENTE = mantem o valor atual; texto vazio/so espacos = null.
 * Mudar a meta NAO altera meses ja publicados (tem retrato).
 */
export class UpdateTransparencySettingsDto {
  @IfPresent()
  @IsInt({ message: CENTS_INT('monthlyGoalCents') })
  @Min(0, { message: CENTS_RANGE('monthlyGoalCents') })
  @Max(L.settingCentsMax, { message: CENTS_RANGE('monthlyGoalCents') })
  monthlyGoalCents?: number;

  @IfPresent()
  @IsInt({ message: CENTS_INT('openingReserveCents') })
  @Min(0, { message: CENTS_RANGE('openingReserveCents') })
  @Max(L.settingCentsMax, { message: CENTS_RANGE('openingReserveCents') })
  openingReserveCents?: number;

  @IsOptional()
  @Transform(blankToNull)
  @IsString({ message: 'entityName: deve ser texto.' })
  @MaxLength(L.entityNameMax, { message: `entityName: no máximo ${L.entityNameMax} caracteres.` })
  entityName?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString({ message: 'introText: deve ser texto.' })
  @MaxLength(L.introTextMax, { message: `introText: no máximo ${L.introTextMax} caracteres.` })
  introText?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString({ message: 'surplusText: deve ser texto.' })
  @MaxLength(L.surplusTextMax, { message: `surplusText: no máximo ${L.surplusTextMax} caracteres.` })
  surplusText?: string | null;
}
