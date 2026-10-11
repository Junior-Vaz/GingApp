import { Module } from '@nestjs/common';
import { FinanceModule } from '../interface/http/finance/finance.module';
import { OverdueCronService } from './overdue-cron.service';

/**
 * Jobs agendados. So entra no AppModule (junto com ScheduleModule.forRoot()) quando OVERDUE_CRON != 'false'.
 */
@Module({
  imports: [FinanceModule],
  providers: [OverdueCronService],
})
export class JobsModule {}
