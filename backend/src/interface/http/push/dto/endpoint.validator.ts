import { ValidationOptions, registerDecorator } from 'class-validator';
import { isAcceptablePushEndpoint } from '../../../../shared/push/push.config';

/** Endpoint https de host público (ver isAcceptablePushEndpoint): o servidor fará POST nele, então não pode ser interno. */
export function IsAcceptablePushEndpoint(options?: ValidationOptions) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: 'isAcceptablePushEndpoint',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isAcceptablePushEndpoint(value),
      },
    });
  };
}
