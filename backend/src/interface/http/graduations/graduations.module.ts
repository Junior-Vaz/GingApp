import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RankingModule } from '../ranking/ranking.module';
import { StudentsModule } from '../students/students.module';
import { GraduationsController } from './graduations.controller';
import { GraduationsHierarchyService } from './graduations-hierarchy.service';
import { GraduationsService } from './graduations.service';

@Module({
  imports: [StudentsModule, NotificationsModule, RankingModule],
  controllers: [GraduationsController],
  providers: [GraduationsService, GraduationsHierarchyService],
  exports: [GraduationsService],
})
export class GraduationsModule {}
