import { Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Query, Res, UploadedFile, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { Public } from '../../../shared/decorators/public.decorator';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { FeedAccessService } from './feed-access';
import { FeedErrorCode } from './feed-errors';
import { FEED_MEDIA_READ_THROTTLE, FEED_UPLOAD_THROTTLE, FeedExceptionFilter } from './feed-http';
import { FEED_MEDIA_MAX_BYTES, MediaVariant } from './feed-media-storage';
import { FeedMediaService, UploadedFeedFile } from './feed-media.service';

const mediaNotFound = () => new NotFoundException({ statusCode: 404, error: 'Not Found', code: FeedErrorCode.NOT_FOUND, message: 'Arquivo não encontrado.' });

/** Fotos do feed: envio (membro autenticado) e entrega por URL assinada (publica, sem Authorization). */
@Controller('feed/media')
@UseFilters(FeedExceptionFilter)
export class FeedMediaController {
  constructor(
    private readonly access: FeedAccessService,
    private readonly media: FeedMediaService,
  ) {}

  /** multipart `file` (<= 5 MB; o multer corta acima: 413). Sem `dest`: fica em memoria ate validar e regravar. */
  @UseGuards(UserThrottlerGuard)
  @Throttle(FEED_UPLOAD_THROTTLE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: FEED_MEDIA_MAX_BYTES, files: 1, fields: 2, parts: 3 } }))
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async upload(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: UploadedFeedFile | undefined) {
    return this.media.upload(await this.access.viewer(user), file);
  }

  @Public()
  @Throttle(FEED_MEDIA_READ_THROTTLE)
  @Get(':id')
  async full(@Param('id') id: string, @Query('e') e: unknown, @Query('s') s: unknown, @Query('r') r: unknown, @Res() res: Response): Promise<void> {
    await this.serve(id, 'full', e, s, r, res);
  }

  @Public()
  @Throttle(FEED_MEDIA_READ_THROTTLE)
  @Get(':id/thumb')
  async thumb(@Param('id') id: string, @Query('e') e: unknown, @Query('s') s: unknown, @Query('r') r: unknown, @Res() res: Response): Promise<void> {
    await this.serve(id, 'thumb', e, s, r, res);
  }

  private async serve(id: string, variant: MediaVariant, e: unknown, s: unknown, r: unknown, res: Response): Promise<void> {
    const found = await this.media.resolveSigned(id, variant, e, s, r);
    if (!found) throw mediaNotFound();
    res.set({
      'Content-Type': 'image/webp',
      // Privado (navegador do membro, nunca CDN/proxy compartilhado) e curto; a URL assinada muda a cada hora.
      'Cache-Control': found.review ? 'private, max-age=300' : 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline',
      'Cross-Origin-Resource-Policy': 'same-site',
      'Referrer-Policy': 'no-referrer',
    });
    res.sendFile(found.fullPath, { dotfiles: 'deny', cacheControl: false, lastModified: false }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ statusCode: 404, error: 'Not Found', code: FeedErrorCode.NOT_FOUND, message: 'Arquivo não encontrado.' });
    });
  }
}
