import { Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { MestreOnlyGuard } from '../../../shared/guards/mestre-only.guard';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { PLATFORM_UPLOAD_THROTTLE } from './platform-uploads.controller';
import { UPLOAD_MAX_BYTES, UploadedImageFile, UploadResult, UploadsService } from './uploads.service';

/**
 * Upload de logo/imagem de PATROCINADOR DO GRUPO (docs/CONTRATO_PATROCINADORES_GRUPO.md secao 3): so o MESTRE (403 antes de
 * ler o arquivo), mesmo multipart do POST /uploads (campo "file", JPEG/PNG/WebP ate 5 MB recebidos), dono = grupo do token e
 * o reprocessamento do upload de plataforma ate o peso final <= 250 KB (PLATFORM_UPLOAD_MAX_KB; acima = 413). O POST /uploads
 * dos grupos continua igual (sem teto de peso final); uma imagem dele so serve para patrocinador se tiver <= 250 KB.
 */
@Controller('group-sponsor-uploads')
@UseGuards(MestreOnlyGuard)
export class GroupSponsorUploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @UseGuards(UserThrottlerGuard)
  @Throttle(PLATFORM_UPLOAD_THROTTLE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_MAX_BYTES, files: 1, fields: 5 } }))
  upload(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @UploadedFile() file: UploadedImageFile | undefined,
  ): Promise<UploadResult> {
    return this.uploads.saveGroupSponsor(file, organizationId, userId);
  }
}
