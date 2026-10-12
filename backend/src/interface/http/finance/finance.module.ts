import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StudentsModule } from '../students/students.module';
import { FinanceCollectionController } from './finance-collection.controller';
import { FinanceCollectionService } from './finance-collection.service';
import { FinanceExportController } from './finance-export.controller';
import { FinanceExportService } from './finance-export.service';
import { FinanceController } from './finance.controller';
import { FinanceOverdueController } from './finance-overdue.controller';
import { FinanceOverdueService } from './finance-overdue.service';
import { FinanceService } from './finance.service';

@Module({
  imports: [StudentsModule, NotificationsModule],
  // FinanceExportController e FinanceCollectionController ANTES do FinanceController: as rotas literais
  // (/finance/export.csv, /billing, /delinquents) têm de ser registradas antes de `GET /finance/:id`.
  controllers: [FinanceExportController, FinanceCollectionController, FinanceController, FinanceOverdueController],
  providers: [FinanceService, FinanceOverdueService, FinanceCollectionService, FinanceExportService],
  exports: [FinanceService, FinanceOverdueService],
})
export class FinanceModule {}
