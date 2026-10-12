import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PushService } from '../../../shared/push/push.service';
import { SubscribePushDto, UnsubscribePushDto, UpdatePushPreferencesDto } from './dto/push.dto';

// Aviso de teste (POST /push/test): 3/min por usuário — é um envio real ao FCM/serviço de push.
// O limite é lido a cada requisição (PUSH_TEST_THROTTLE_LIMIT) para o e2e poder prová-lo sem reiniciar.
const TEST_THROTTLE = { default: { limit: () => Number(process.env.PUSH_TEST_THROTTLE_LIMIT ?? 3), ttl: 60_000 } };

/**
 * Avisos push: FCM (principal) ou Web Push VAPID (fallback). Tudo é pessoal (userId do token): ninguém enxerga nem
 * remove a inscrição de outro usuário. Sem nenhum transporte configurado: /push/config responde
 * {enabled:false, provider:null, publicKey:null, firebase:null} e o subscribe responde 503 — o app nem mostra o botão.
 * A config do SDK web do Firebase é servida aqui em runtime (nada de VITE_* no build do app).
 */
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('config')
  config() {
    return this.push.config();
  }

  @Post('subscribe')
  @HttpCode(201)
  subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubscribePushDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    if (dto.provider === 'fcm') {
      return this.push.subscribe(user, { provider: 'fcm', token: dto.token!, userAgent });
    }
    return this.push.subscribe(user, {
      provider: 'webpush',
      endpoint: dto.endpoint!,
      p256dh: dto.keys!.p256dh,
      auth: dto.keys!.auth,
      userAgent,
    });
  }

  @Delete('subscribe')
  unsubscribe(@CurrentUser('id') userId: number, @Body() dto: UnsubscribePushDto) {
    if (!dto.endpoint && !dto.token) throw new BadRequestException('Informe o endpoint ou o token da inscrição.');
    return this.push.unsubscribe(userId, { endpoint: dto.endpoint, token: dto.token });
  }

  /** Envia um aviso de teste aos aparelhos do PRÓPRIO usuário. {sent, devices}; 503 se nenhum transporte estiver ligado. */
  @Post('test')
  @HttpCode(200)
  @UseGuards(UserThrottlerGuard)
  @Throttle(TEST_THROTTLE)
  test(@CurrentUser('id') userId: number) {
    return this.push.sendTest(userId);
  }

  @Get('preferences')
  preferences(@CurrentUser('id') userId: number) {
    return this.push.getPreferences(userId);
  }

  @Put('preferences')
  updatePreferences(@CurrentUser('id') userId: number, @Body() dto: UpdatePushPreferencesDto) {
    return this.push.updatePreferences(userId, dto);
  }
}
