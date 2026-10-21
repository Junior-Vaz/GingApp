import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { FeedAccessService } from './feed-access';
import { FeedInteractionsService } from './feed-interactions.service';
import { FeedMediaController } from './feed-media.controller';
import { FeedMediaService } from './feed-media.service';
import { FeedModerationController } from './feed-moderation.controller';
import { FeedModerationService } from './feed-moderation.service';
import { FeedNoticesService } from './feed-notices.service';
import { FeedPresenter } from './feed-presenter';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';

/** Feed do grupo (docs/CONTRATO_FEED_ANIVERSARIOS_COMUNICACAO.md secao 4). Limpeza das fotos: jobs/feed-media-cleanup-cron.service.ts. */
@Module({
  imports: [NotificationsModule],
  // FeedMediaController antes do FeedController: rotas mais especificas (`feed/media/...`) registradas primeiro.
  controllers: [FeedMediaController, FeedModerationController, FeedController],
  providers: [FeedAccessService, FeedPresenter, FeedNoticesService, FeedService, FeedInteractionsService, FeedModerationService, FeedMediaService],
})
export class FeedModule {}
