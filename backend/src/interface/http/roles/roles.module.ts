import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PeopleCoreModule } from '../people/people-core.module';
import { StudentsModule } from '../students/students.module';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/** Cargos acumulaveis (ficha unica, Fase 3). Importado por Teachers (sincronia da tela Equipe) e Graduations (aviso de corda). */
@Module({
  imports: [NotificationsModule, PeopleCoreModule, StudentsModule],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
