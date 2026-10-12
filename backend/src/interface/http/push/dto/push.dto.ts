import { Type } from 'class-transformer';
import { IsBoolean, IsNotEmptyObject, IsObject, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { IsAcceptablePushEndpoint } from './endpoint.validator';

/** Chaves de criptografia da inscrição (PushSubscription.toJSON().keys), base64url. */
export class PushKeysDto {
  @IsString({ message: 'Chave p256dh inválida.' })
  @MinLength(20, { message: 'Chave p256dh inválida.' })
  @MaxLength(200, { message: 'Chave p256dh inválida.' })
  p256dh!: string;

  @IsString({ message: 'Chave auth inválida.' })
  @MinLength(8, { message: 'Chave auth inválida.' })
  @MaxLength(100, { message: 'Chave auth inválida.' })
  auth!: string;
}

/** POST /push/subscribe: o JSON da PushSubscription do navegador. */
export class SubscribePushDto {
  @IsString({ message: 'Endpoint inválido.' })
  @IsAcceptablePushEndpoint({ message: 'Endpoint de push inválido.' })
  endpoint!: string;

  @IsObject({ message: 'Informe as chaves da inscrição.' })
  @IsNotEmptyObject({}, { message: 'Informe as chaves da inscrição.' })
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}

/** DELETE /push/subscribe. */
export class UnsubscribePushDto {
  @IsString({ message: 'Endpoint inválido.' })
  @MinLength(1, { message: 'Endpoint inválido.' })
  @MaxLength(2048, { message: 'Endpoint inválido.' })
  endpoint!: string;
}

/** PUT /push/preferences: só as categorias enviadas mudam (as demais permanecem como estavam). */
export class UpdatePushPreferencesDto {
  @IsOptional()
  @IsBoolean({ message: 'Valor inválido para aulas.' })
  lessons?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'Valor inválido para financeiro.' })
  finance?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'Valor inválido para eventos e rodas.' })
  events?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'Valor inválido para graduações.' })
  graduations?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'Valor inválido para comunicados.' })
  announcements?: boolean;
}
