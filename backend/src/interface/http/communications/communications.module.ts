import { Module } from '@nestjs/common';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';

/** Comunicar: compositor com alcance/agendamento/confirmacao/fixados (contrato secao 3). Exporta o service para o agendador (jobs). */
@Module({
  imports: [AnnouncementsModule, NotificationsModule],
  controllers: [CommunicationsController],
  providers: [CommunicationsService],
  exports: [CommunicationsService],
})
export class CommunicationsModule {}
