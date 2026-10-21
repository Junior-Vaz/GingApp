import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { QuickSendDto } from './dto/quick-send.dto';
import { QuickSendService } from './quick-send.service';

/** Envio rápido: 10/min POR USUÁRIO (spam de push); configurável por env só para os e2e. */
const QUICK_SEND_THROTTLE = { default: { limit: Number(process.env.QUICK_SEND_THROTTLE_LIMIT ?? 10), ttl: 60_000 } };

/**
 * Envio rápido de avisos (botão flutuante do painel). Vive no módulo de comunicados (reusa a audiência e o
 * AnnouncementsService; NotificationsModule não pode importar AnnouncementsModule sem ciclo), mas na rota /notifications.
 * Permissão = a de publicar comunicado (announcements:create): MESTRE/PROFESSOR/INSTRUTOR; MONITOR/ALUNO/RESPONSAVEL = 403.
 */
@Controller('notifications')
export class QuickSendController {
  constructor(private readonly quickSend: QuickSendService) {}

  @Post('send')
  @CanAccess('announcements', 'create')
  @UseGuards(UserThrottlerGuard)
  @Throttle(QUICK_SEND_THROTTLE)
  send(@CurrentOrganization() organizationId: number, @CurrentUser() user: AuthenticatedUser, @Body() dto: QuickSendDto) {
    return this.quickSend.send(organizationId, user, dto);
  }

  @Get('audiences')
  @CanAccess('announcements', 'create')
  audiences(@CurrentOrganization() organizationId: number, @CurrentUser() user: AuthenticatedUser, @Query('own') own?: string) {
    // ?own=1 (Comunicar): para quem nao e Mestre, as turmas sao so as que ele leciona (as outras dariam 403 ao enviar).
    return this.quickSend.audiences(organizationId, user, { ownClasses: own === '1' || own === 'true' });
  }
}
