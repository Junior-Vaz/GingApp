import { registerDecorator, ValidationOptions, isURL } from 'class-validator';

/** Prefixo publico dos arquivos enviados por POST /uploads (GET /api/uploads/<uuid>.<ext>). */
export const UPLOAD_URL_PREFIX = '/api/uploads/';

/** Nome de arquivo que o backend gera: uuid v4 + extensao (nunca o nome do cliente). */
export const UPLOAD_FILENAME_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$/;

const UPLOAD_PATH_REGEX = /^\/api\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$/;

/** true se for um caminho de upload do proprio backend OU uma URL http(s) absoluta valida. */
export function isImageRef(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (UPLOAD_PATH_REGEX.test(value)) return true;
  return isURL(value, { protocols: ['http', 'https'], require_protocol: true });
}

/**
 * Valida o campo de imagem (foto, logo, capa): aceita o caminho `/api/uploads/<uuid>.<ext>` devolvido por
 * POST /uploads OU uma URL http(s) completa (URL manual continua valendo). Combine com @IsOptional().
 */
export function IsImageRef(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isImageRef',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} deve ser uma URL http(s) valida ou o caminho devolvido por POST /uploads.`,
        ...validationOptions,
      },
      validator: { validate: (value: unknown) => isImageRef(value) },
    });
  };
}

/**
 * Para usar com @Transform antes de @IsOptional() + @IsImageRef(): texto vazio/so espacos vira `null` (LIMPA a
 * coluna no PATCH; no POST grava null); `undefined` = nao mexe; qualquer outro valor passa e a validacao decide.
 */
export function blankImageToNull({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}