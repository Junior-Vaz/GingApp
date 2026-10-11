import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StudentsModule } from '../students/students.module';
import { FinanceController } from './finance.controller';
import { FinanceOverdueController } from './finance-overdue.controller';
import { FinanceOverdueService } from './finance-overdue.service';
import { FinanceService } from './finance.service';

@Module({
  imports: [StudentsModule, NotificationsModule],
  controllers: [FinanceController, FinanceOverdueController],
  providers: [FinanceService, FinanceOverdueService],
  exports: [FinanceService, FinanceOverdueService],
})
export class FinanceModule {}
