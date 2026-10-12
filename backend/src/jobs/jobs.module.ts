import { Module } from '@nestjs/common';
import { FinanceModule } from '../interface/http/finance/finance.module';
import { RankingModule } from '../interface/http/ranking/ranking.module';
import { AuditRetentionCronService } from './audit-retention-cron.service';
import { OverdueCronService } from './overdue-cron.service';
import { RankingCronService } from './ranking-cron.service';
import { UploadsGcCronService } from './uploads-gc-cron.service';

/**
 * Jobs agendados. So entra no AppModule (junto com ScheduleModule.forRoot()) quando pelo menos um deles esta ligado
 * (OVERDUE_CRON / AUDIT_RETENTION_CRON / UPLOADS_GC / RANKING_CRON != 'false'); cada job ainda confere o proprio flag ao rodar.
 */
@Module({
  imports: [FinanceModule, RankingModule],
  providers: [OverdueCronService, AuditRetentionCronService, UploadsGcCronService, RankingCronService],
})
export class JobsModule {}
