import { ValidateBy, ValidationArguments } from 'class-validator';

/** Hora do dia "HH:mm" (00:00 a 23:59). */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === 'string' && TIME_OF_DAY_PATTERN.test(value);
}

/** "HH:mm" já validada -> minutos desde 00:00 (comparação sem depender de ordem lexical). */
export function timeToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

/** true quando a janela é coerente: início estritamente antes do fim. */
export function isValidTimeRange(start: string, end: string): boolean {
  return timeToMinutes(start) < timeToMinutes(end);
}

/** Decorator: string no formato HH:mm (00:00-23:59). */
export function IsTimeOfDay(): PropertyDecorator {
  return ValidateBy({
    name: 'isTimeOfDay',
    validator: {
      validate: (value: unknown) => isTimeOfDay(value),
      defaultMessage: (args?: ValidationArguments) =>
        `${args?.property ?? 'horário'} deve estar no formato HH:mm (00:00 a 23:59).`,
    },
  });
}

/** Decorator: o campo (fim) deve ser posterior ao campo `startProperty` quando AMBOS são HH:mm válidos
 * (formato inválido já é reportado por @IsTimeOfDay; ausente/null não compara). */
export function IsAfterTimeOf(startProperty: string): PropertyDecorator {
  return ValidateBy({
    name: 'isAfterTimeOf',
    constraints: [startProperty],
    validator: {
      validate: (value: unknown, args?: ValidationArguments) => {
        const start = (args?.object as Record<string, unknown> | undefined)?.[startProperty];
        if (!isTimeOfDay(value) || !isTimeOfDay(start)) {
          return true;
        }
        return isValidTimeRange(start, value);
      },
      defaultMessage: (args?: ValidationArguments) =>
        `${args?.property ?? 'endTime'} deve ser posterior a ${startProperty}.`,
    },
  });
}
