import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StudentsModule } from '../students/students.module';
import { FinanceCollectionController } from './finance-collection.controller';
import { FinanceCollectionService } from './finance-collection.service';
import { FinanceController } from './finance.controller';
import { FinanceOverdueController } from './finance-overdue.controller';
import { FinanceOverdueService } from './finance-overdue.service';
import { FinanceService } from './finance.service';

@Module({
  imports: [StudentsModule, NotificationsModule],
  // FinanceCollectionController ANTES do FinanceController: as rotas literais (/finance/billing, /delinquents)
  // têm de ser registradas antes de `GET /finance/:id`.
  controllers: [FinanceCollectionController, FinanceController, FinanceOverdueController],
  providers: [FinanceService, FinanceOverdueService, FinanceCollectionService],
  exports: [FinanceService, FinanceOverdueService],
})
export class FinanceModule {}
