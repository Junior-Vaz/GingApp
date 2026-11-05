import { Module } from '@nestjs/common';
import { StudentsModule } from '../students/students.module';
import { PlatformSponsorCampaignsController, PlatformSponsorsController } from './platform-sponsors.controller';
import { PlatformSponsorsService } from './platform-sponsors.service';
import { SponsorsController } from './sponsors.controller';
import { SponsorsService } from './sponsors.service';

/**
 * Patrocinadores no banner da Home (piloto, docs/CONTRATO_PATROCINADORES.md): /sponsors (app + clique publico),
 * /platform-sponsors e /platform-sponsor-campaigns (equipe da plataforma). Imagens: POST /platform-uploads (UploadsModule).
 * StudentsModule: StudentsService.resolveLink (SSOT de "proprio ou dependente" do ?studentId=).
 */
@Module({
  imports: [StudentsModule],
  controllers: [SponsorsController, PlatformSponsorsController, PlatformSponsorCampaignsController],
  providers: [SponsorsService, PlatformSponsorsService],
  exports: [SponsorsService],
})
export class SponsorsModule {}
