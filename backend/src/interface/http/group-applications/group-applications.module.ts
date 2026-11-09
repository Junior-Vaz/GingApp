import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { GroupApplicationsService } from './group-applications.service';
import { PlatformGroupApplicationsController } from './platform-group-applications.controller';
import { PublicGroupApplicationsController } from './public-group-applications.controller';

/**
 * Adesao de grupos (docs/CONTRATO_ADESAO_GRUPOS.md): /public/group-applications (pedido e acompanhamento, sem login) e
 * /platform-group-applications (equipe PLATFORM; decidir so super admin). A aprovacao usa o nucleo de criacao de grupo do
 * OrganizationsService (nenhum segundo caminho). A retencao diaria (GROUP_APPLICATIONS_PURGE) fica no JobsModule.
 */
@Module({
  imports: [OrganizationsModule],
  controllers: [PublicGroupApplicationsController, PlatformGroupApplicationsController],
  providers: [GroupApplicationsService],
})
export class GroupApplicationsModule {}
