import { RolesModule } from '../roles/roles.module';
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RankingModule } from '../ranking/ranking.module';
import { StudentsModule } from '../students/students.module';
import { GraduationEquivalencesController } from './graduation-equivalences.controller';
import { GraduationEquivalencesService } from './graduation-equivalences.service';
import { GraduationsController } from './graduations.controller';
import { GraduationsHierarchyService } from './graduations-hierarchy.service';
import { GraduationsService } from './graduations.service';

@Module({
  imports: [StudentsModule, NotificationsModule, RankingModule, RolesModule],
  // Equivalencias ANTES do GraduationsController: `graduations/equivalences` nao pode cair numa rota com parametro.
  controllers: [GraduationEquivalencesController, GraduationsController],
  providers: [GraduationsService, GraduationsHierarchyService, GraduationEquivalencesService],
  exports: [GraduationsService],
})
export class GraduationsModule {}
