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
