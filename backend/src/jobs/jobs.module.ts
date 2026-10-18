import { Module } from '@nestjs/common';
import { ClassesModule } from '../interface/http/classes/classes.module';
import { FinanceModule } from '../interface/http/finance/finance.module';
import { PaymentsModule } from '../interface/http/payments/payments.module';
import { PeopleModule } from '../interface/http/people/people.module';
import { RankingModule } from '../interface/http/ranking/ranking.module';
import { AuditRetentionCronService } from './audit-retention-cron.service';
import { LessonsCronService } from './lessons-cron.service';
import { OverdueCronService } from './overdue-cron.service';
import { PixReconcileCronService } from './pix-reconcile-cron.service';
import { RankingCronService } from './ranking-cron.service';
import { TransferCronService } from './transfer-cron.service';
import { UploadsGcCronService } from './uploads-gc-cron.service';
import { FormsRetentionCronService } from './forms-retention-cron.service';

/**
 * Jobs agendados. So entra no AppModule (junto com ScheduleModule.forRoot()) quando pelo menos um deles esta ligado
 * (OVERDUE_CRON / AUDIT_RETENTION_CRON / UPLOADS_GC / RANKING_CRON / LESSONS_CRON / TRANSFER_CRON / PAYMENTS_RECONCILE_CRON != 'false'); cada job ainda
 * confere o proprio flag ao rodar.
 */
@Module({
  imports: [FinanceModule, RankingModule, ClassesModule, PeopleModule, PaymentsModule],
  providers: [
    OverdueCronService,
    AuditRetentionCronService,
    UploadsGcCronService,
    RankingCronService,
    LessonsCronService,
    TransferCronService,
    PixReconcileCronService,
    // Retencao LGPD dos formularios de inscricao + limpeza de anexos pendentes (FORMS_RETENTION_PURGE).
    FormsRetentionCronService,
  ],
})
export class JobsModule {}
