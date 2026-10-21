import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BirthdayAutomationService } from './birthday-automation.service';
import { BirthdaysController } from './birthdays.controller';
import { BirthdaysService } from './birthdays.service';

/** Aniversariantes (contrato secao 2). Os jobs (src/jobs/birthdays-cron.service.ts) usam BirthdayAutomationService. */
@Module({
  imports: [NotificationsModule],
  controllers: [BirthdaysController],
  providers: [BirthdaysService, BirthdayAutomationService],
  exports: [BirthdaysService, BirthdayAutomationService],
})
export class BirthdaysModule {}
