import { Module } from '@nestjs/common';
import { PlatformUploadsController } from './platform-uploads.controller';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  // POST /platform-uploads: variante da equipe da plataforma (patrocinadores); o upload de grupo segue em UploadsController.
  controllers: [UploadsController, PlatformUploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
