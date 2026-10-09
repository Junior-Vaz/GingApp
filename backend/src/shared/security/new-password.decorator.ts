import { applyDecorators } from '@nestjs/common';
import { IsByteLength, IsString, MinLength, ValidateBy, ValidationArguments } from 'class-validator';
import { isForbiddenPassword, NEW_PASSWORD_MIN_LENGTH, PASSWORD_MAX_BYTES } from './password-policy';

/**
 * Política da senha NOVA (SSOT em password-policy.ts) como decorator de DTO: string, no mínimo 12
 * caracteres, no máximo 72 BYTES UTF-8 e sem a senha padrão de desenvolvimento (Dev@12345, em
 * qualquer caixa, inclusive embutida). Não apara espaços (podem fazer parte da senha) e as mensagens
 * nunca incluem o valor recebido.
 *
 * "Diferente da atual" depende do usuário e fica no service.
 */
export function IsNewPassword(): PropertyDecorator {
  const field = (args: ValidationArguments) => args.property;
  return applyDecorators(
    IsString({ message: (args) => `${field(args)} deve ser um texto.` }),
    MinLength(NEW_PASSWORD_MIN_LENGTH, {
      message: (args) => `${field(args)} deve ter no mínimo ${NEW_PASSWORD_MIN_LENGTH} caracteres.`,
    }),
    IsByteLength(0, PASSWORD_MAX_BYTES, {
      message: (args) => `${field(args)} deve ter no máximo ${PASSWORD_MAX_BYTES} caracteres (bytes UTF-8).`,
    }),
    ValidateBy({
      name: 'isNotForbiddenPassword',
      validator: {
        validate: (value: unknown) => typeof value !== 'string' || !isForbiddenPassword(value),
        defaultMessage: (args?: ValidationArguments) =>
          `${args?.property ?? 'password'} não pode ser a senha padrão de desenvolvimento.`,
      },
    }),
  );
}
