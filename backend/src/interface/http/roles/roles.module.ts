import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PeopleCoreModule } from '../people/people-core.module';
import { StudentsModule } from '../students/students.module';
import { GroupRolesController } from './group-roles.controller';
import { GroupRolesService } from './group-roles.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/**
 * Cargos acumulaveis (ficha unica, Fase 3) + cargos DO GRUPO (secao 13). Importado por Teachers (sincronia da tela
 * Equipe) e Graduations (aviso de corda).
 */
@Module({
  imports: [NotificationsModule, PeopleCoreModule, StudentsModule],
  controllers: [RolesController, GroupRolesController],
  providers: [RolesService, GroupRolesService],
  exports: [RolesService, GroupRolesService],
})
export class RolesModule {}
