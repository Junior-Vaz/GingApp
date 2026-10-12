import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RankingModule } from '../ranking/ranking.module';
import { RodasController } from './rodas.controller';
import { RodasOccurrencesService } from './rodas-occurrences.service';
import { RodasService } from './rodas.service';

@Module({
  imports: [NotificationsModule, RankingModule],
  controllers: [RodasController],
  providers: [RodasService, RodasOccurrencesService],
  exports: [RodasService],
})
export class RodasModule {}
