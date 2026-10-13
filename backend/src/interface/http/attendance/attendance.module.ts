import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RankingModule } from '../ranking/ranking.module';
import { StudentsModule } from '../students/students.module';
import { AttendanceNoticeService } from './attendance-notice.service';
import { AttendanceCheckinService } from './attendance-checkin.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [StudentsModule, NotificationsModule, RankingModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceCheckinService, AttendanceNoticeService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
