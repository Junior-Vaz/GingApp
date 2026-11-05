import { Module } from '@nestjs/common';
import { GroupSponsorUploadsController } from './group-sponsor-uploads.controller';
import { PlatformUploadsController } from './platform-uploads.controller';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  // POST /platform-uploads: variante da equipe da plataforma (patrocinadores); POST /group-sponsor-uploads: imagem de
  // patrocinador do grupo (Mestre, <= 250 KB); o upload de grupo segue em UploadsController.
  controllers: [UploadsController, PlatformUploadsController, GroupSponsorUploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
