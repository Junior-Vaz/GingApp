import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StudentsModule } from '../students/students.module';
import { AttendanceCheckinService } from './attendance-checkin.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [StudentsModule, NotificationsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceCheckinService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
