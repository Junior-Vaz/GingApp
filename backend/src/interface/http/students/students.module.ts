import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { StudentAccessController } from './student-access.controller';
import { StudentAccessService } from './student-access.service';
import { StudentGuardiansService } from './student-guardians.service';
import { StudentTransferController } from './student-transfer.controller';
import { StudentTransferService } from './student-transfer.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [SubscriptionsModule],
  // StudentTransferController ANTES do StudentsController: `GET /students/export.csv` não pode cair em `GET /students/:id`.
  controllers: [StudentTransferController, StudentsController, StudentAccessController],
  providers: [StudentsService, StudentAccessService, StudentGuardiansService, StudentTransferService],
  exports: [StudentsService],
})
export class StudentsModule {}
