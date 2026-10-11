import { ValidateBy, ValidationArguments } from 'class-validator';

/** Decorator: data ISO que, quando informada (não nula/ausente), tem de estar no futuro. */
export function IsFutureDate(): PropertyDecorator {
  return ValidateBy({
    name: 'isFutureDate',
    validator: {
      validate: (value: unknown) => {
        if (typeof value !== 'string') {
          return true; // tipo/formato já são validados por @IsDateString
        }
        const time = Date.parse(value);
        return Number.isNaN(time) || time > Date.now();
      },
      defaultMessage: (args?: ValidationArguments) => `${args?.property ?? 'data'} deve ser futuro`,
    },
  });
}
