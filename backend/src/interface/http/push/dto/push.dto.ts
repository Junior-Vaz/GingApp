import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmptyObject,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
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

/** Transportes aceitos em POST /push/subscribe. Omitido = 'webpush' (formato antigo: endpoint + keys). */
export const PUSH_PROVIDERS = ['webpush', 'fcm'] as const;

/** Registration token do FCM: opaco, ~150-250 caracteres (limite folgado de 1024). */
const FCM_TOKEN_RE = /^[A-Za-z0-9_:.\-]{20,1024}$/;

/**
 * POST /push/subscribe. Dois formatos:
 *  - Web Push (VAPID): o JSON da PushSubscription do navegador ({endpoint, keys}); `provider` omitido ou 'webpush';
 *  - FCM: {provider:'fcm', token, platform?} com o registration token do SDK do Firebase.
 */
export class SubscribePushDto {
  @IsOptional()
  @IsIn(PUSH_PROVIDERS, { message: 'Transporte de push inválido.' })
  provider?: 'webpush' | 'fcm';

  @ValidateIf((o: SubscribePushDto) => o.provider !== 'fcm')
  @IsString({ message: 'Endpoint inválido.' })
  @IsAcceptablePushEndpoint({ message: 'Endpoint de push inválido.' })
  endpoint?: string;

  @ValidateIf((o: SubscribePushDto) => o.provider !== 'fcm')
  @IsObject({ message: 'Informe as chaves da inscrição.' })
  @IsNotEmptyObject({}, { message: 'Informe as chaves da inscrição.' })
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys?: PushKeysDto;

  @ValidateIf((o: SubscribePushDto) => o.provider === 'fcm')
  @IsString({ message: 'Token de push inválido.' })
  @Matches(FCM_TOKEN_RE, { message: 'Token de push inválido.' })
  token?: string;

  /** Informativo (hoje só 'web'): aceito para o app nativo futuro; não é gravado. */
  @IsOptional()
  @IsIn(['web', 'android', 'ios'], { message: 'Plataforma inválida.' })
  platform?: 'web' | 'android' | 'ios';
}

/** DELETE /push/subscribe: informe o `endpoint` (Web Push) OU o `token` (FCM). */
export class UnsubscribePushDto {
  @IsOptional()
  @IsString({ message: 'Endpoint inválido.' })
  @MinLength(1, { message: 'Endpoint inválido.' })
  @MaxLength(2048, { message: 'Endpoint inválido.' })
  endpoint?: string;

  @IsOptional()
  @IsString({ message: 'Token de push inválido.' })
  @Matches(FCM_TOKEN_RE, { message: 'Token de push inválido.' })
  token?: string;
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
