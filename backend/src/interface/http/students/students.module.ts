import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { StudentAccessController } from './student-access.controller';
import { StudentAccessService } from './student-access.service';
import { StudentGuardiansService } from './student-guardians.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [SubscriptionsModule],
  controllers: [StudentsController, StudentAccessController],
  providers: [StudentsService, StudentAccessService, StudentGuardiansService],
  exports: [StudentsService],
})
export class StudentsModule {}
