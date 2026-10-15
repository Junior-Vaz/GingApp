import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Emoji vazio ("") vira null (= sem emoji); só aparece no PATCH/POST quando o campo vem no corpo. */
const emptyToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? null : t;
};

/** Mesmos limites do aviso (QuickSendDto): o modelo sempre cabe num envio. */
export const QUICK_TEMPLATE_TITLE_MAX = 80;
export const QUICK_TEMPLATE_BODY_MAX = 280;
export const QUICK_TEMPLATE_EMOJI_MAX = 8;
/** Teto de modelos próprios por grupo (os padrão do sistema não contam). */
export const QUICK_TEMPLATE_LIMIT = 30;

/** POST /notifications/quick-templates (só MESTRE). */
export class CreateQuickTemplateDto {
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'title deve ter no mínimo 2 caracteres.' })
  @MaxLength(QUICK_TEMPLATE_TITLE_MAX, { message: `title deve ter no máximo ${QUICK_TEMPLATE_TITLE_MAX} caracteres.` })
  title!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'body deve ter no mínimo 2 caracteres.' })
  @MaxLength(QUICK_TEMPLATE_BODY_MAX, { message: `body deve ter no máximo ${QUICK_TEMPLATE_BODY_MAX} caracteres.` })
  body!: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(QUICK_TEMPLATE_EMOJI_MAX, { message: `emoji deve ter no máximo ${QUICK_TEMPLATE_EMOJI_MAX} caracteres.` })
  emoji?: string | null;

  /** Posição na lista (menor = primeiro). Omitido no POST = vai para o fim. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}

/** PATCH /notifications/quick-templates/:id — todos os campos opcionais. */
export class UpdateQuickTemplateDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'title deve ter no mínimo 2 caracteres.' })
  @MaxLength(QUICK_TEMPLATE_TITLE_MAX, { message: `title deve ter no máximo ${QUICK_TEMPLATE_TITLE_MAX} caracteres.` })
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'body deve ter no mínimo 2 caracteres.' })
  @MaxLength(QUICK_TEMPLATE_BODY_MAX, { message: `body deve ter no máximo ${QUICK_TEMPLATE_BODY_MAX} caracteres.` })
  body?: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(QUICK_TEMPLATE_EMOJI_MAX, { message: `emoji deve ter no máximo ${QUICK_TEMPLATE_EMOJI_MAX} caracteres.` })
  emoji?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}
