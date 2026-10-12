import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { Public } from '../../../shared/decorators/public.decorator';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { UPLOAD_MAX_BYTES, UploadedImageFile, UploadResult, UploadsService } from './uploads.service';

// Enviar imagem e' acao ocasional e cara (sharp + disco): 20/min por IP E por usuario (UserThrottlerGuard).
const UPLOAD_THROTTLE_LIMIT = Number(process.env.UPLOAD_THROTTLE_LIMIT ?? 20);
const UPLOAD_THROTTLE = { default: { limit: UPLOAD_THROTTLE_LIMIT, ttl: 60_000 } };
// Leitura publica de imagens: uma tela de lista carrega dezenas de fotos de uma vez (atras do mesmo NAT).
const READ_THROTTLE = { default: { limit: Number(process.env.UPLOAD_READ_THROTTLE_LIMIT ?? 3000), ttl: 60_000 } };

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /**
   * Envia UMA imagem (multipart, campo "file"; JPEG/PNG/WebP, ate 5 MB). Qualquer MEMBER autenticado
   * (o aluno envia a propria foto no app; o painel envia logo/foto/capa). Devolve a URL a gravar no campo
   * de imagem do recurso (Student.photo, Organization.logo, Event.imageUrl, ...). Sem `dest`/`storage`, o
   * multer guarda o arquivo em memoria (<= 5 MB): nada toca o disco antes de validar e reprocessar.
   */
  @UseGuards(UserThrottlerGuard)
  @Throttle(UPLOAD_THROTTLE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_MAX_BYTES, files: 1, fields: 5 } }))
  @Post()
  upload(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @UploadedFile() file: UploadedImageFile | undefined,
  ): Promise<UploadResult> {
    return this.uploads.save(file, organizationId, userId);
  }

  /** Publico: o nome e' um uuid imprevisivel. Imutavel (nome novo a cada upload) => cache de 1 ano. */
  @Public()
  @Throttle(READ_THROTTLE)
  @Get(':file')
  async serve(@Param('file') file: string, @Res() res: Response): Promise<void> {
    const found = await this.uploads.resolveFile(file);
    if (!found) throw new NotFoundException('Arquivo nao encontrado.');
    res.set({
      'Content-Type': found.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Content-Disposition': 'inline',
    });
    res.sendFile(found.fullPath, { dotfiles: 'deny', cacheControl: false }, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ statusCode: 404, message: 'Arquivo nao encontrado.', error: 'Not Found' });
      }
    });
  }
}
