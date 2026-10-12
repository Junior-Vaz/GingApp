import { Body, Controller, Delete, Get, Headers, HttpCode, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PushService } from '../../../shared/push/push.service';
import { SubscribePushDto, UnsubscribePushDto, UpdatePushPreferencesDto } from './dto/push.dto';

/**
 * Web Push (I13). Tudo é pessoal (userId do token): ninguém enxerga nem remove a inscrição de outro usuário.
 * Sem VAPID: /push/config responde {enabled:false, publicKey:null} e o subscribe responde 503 — o app nem mostra o botão.
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
    return this.push.subscribe(user, {
      endpoint: dto.endpoint,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      userAgent,
    });
  }

  @Delete('subscribe')
  unsubscribe(@CurrentUser('id') userId: number, @Body() dto: UnsubscribePushDto) {
    return this.push.unsubscribe(userId, dto.endpoint);
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
