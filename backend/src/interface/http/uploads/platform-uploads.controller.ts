import { Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { PlatformOnlyGuard } from '../../../shared/guards/platform-only.guard';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { UPLOAD_MAX_BYTES, UploadedImageFile, UploadResult, UploadsService } from './uploads.service';

/** Mesmo teto do upload de grupo (UPLOAD_THROTTLE_LIMIT, 20/min por IP e por usuario), lido a cada pedido. */
const PLATFORM_UPLOAD_THROTTLE = {
  default: {
    ttl: 60_000,
    limit: () => {
      const n = Number(process.env.UPLOAD_THROTTLE_LIMIT);
      return Number.isFinite(n) && n > 0 ? n : 20;
    },
  },
};

/**
 * Variante MINIMA de upload para a equipe da plataforma (docs/CONTRATO_PATROCINADORES.md secao 4.3): o POST /uploads de
 * grupo exige token de grupo (CurrentOrganization => 401 para PLATFORM) e continua igual. Aqui: so PLATFORM autenticado
 * (PlatformOnlyGuard), mesmo multipart (campo "file", JPEG/PNG/WebP ate 5 MB recebidos), mesma validacao por assinatura e
 * reprocessamento (sharp, sem EXIF) e peso FINAL <= PLATFORM_UPLOAD_MAX_KB (250 KB). Devolve o mesmo formato do upload de
 * grupo ({ url: '/api/uploads/<uuid>.webp', ... }), servido pelo mesmo GET publico /api/uploads/:file.
 */
@Controller('platform-uploads')
@UseGuards(PlatformOnlyGuard)
export class PlatformUploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @UseGuards(UserThrottlerGuard)
  @Throttle(PLATFORM_UPLOAD_THROTTLE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_MAX_BYTES, files: 1, fields: 5 } }))
  upload(@CurrentUser('id') userId: number, @UploadedFile() file: UploadedImageFile | undefined): Promise<UploadResult> {
    return this.uploads.savePlatform(file, userId);
  }
}
