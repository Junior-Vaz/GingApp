import { Module } from '@nestjs/common';
import { FinanceModule } from '../interface/http/finance/finance.module';
import { AuditRetentionCronService } from './audit-retention-cron.service';
import { OverdueCronService } from './overdue-cron.service';
import { UploadsGcCronService } from './uploads-gc-cron.service';

/**
 * Jobs agendados. So entra no AppModule (junto com ScheduleModule.forRoot()) quando pelo menos um deles esta ligado
 * (OVERDUE_CRON / AUDIT_RETENTION_CRON / UPLOADS_GC != 'false'); cada job ainda confere o proprio flag ao rodar.
 */
@Module({
  imports: [FinanceModule],
  providers: [OverdueCronService, AuditRetentionCronService, UploadsGcCronService],
})
export class JobsModule {}
