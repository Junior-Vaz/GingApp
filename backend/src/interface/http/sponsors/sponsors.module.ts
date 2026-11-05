import { Module } from '@nestjs/common';
import { StudentsModule } from '../students/students.module';
import { GroupSponsorCampaignsController, GroupSponsorsController } from './group-sponsors.controller';
import { GroupSponsorsService } from './group-sponsors.service';
import { PlatformSponsorCampaignsController, PlatformSponsorGroupsController, PlatformSponsorsController } from './platform-sponsors.controller';
import { PlatformSponsorsService } from './platform-sponsors.service';
import { SponsorCatalogService } from './sponsor-catalog.service';
import { SponsorsController } from './sponsors.controller';
import { SponsorsService } from './sponsors.service';

/**
 * Patrocinadores no banner da Home (docs/CONTRATO_PATROCINADORES.md e docs/CONTRATO_PATROCINADORES_GRUPO.md):
 * /sponsors (app + clique publico), /platform-sponsors, /platform-sponsor-campaigns e /platform-sponsor-groups (equipe da
 * plataforma), /group-sponsors e /group-sponsor-campaigns (Mestre do grupo). Nucleo compartilhado: SponsorCatalogService.
 * Imagens: POST /platform-uploads e POST /group-sponsor-uploads (UploadsModule).
 * StudentsModule: StudentsService.resolveLink (SSOT de "proprio ou dependente" do ?studentId=).
 */
@Module({
  imports: [StudentsModule],
  controllers: [
    SponsorsController,
    PlatformSponsorsController,
    PlatformSponsorCampaignsController,
    PlatformSponsorGroupsController,
    GroupSponsorsController,
    GroupSponsorCampaignsController,
  ],
  providers: [SponsorsService, SponsorCatalogService, PlatformSponsorsService, GroupSponsorsService],
  exports: [SponsorsService],
})
export class SponsorsModule {}
