import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../../shared/decorators/public.decorator';
import { CertificatesService } from './certificates.service';

// Gerar PDF é mais caro que consultar: 30/min por IP.
const PDF_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

/** Verificação de autenticidade via QR Code (projeto.txt §52) — sem autenticação, de propósito:
 * quem escaneia o QR de um certificado físico/PDF não tem (nem precisa ter) uma conta GingApp. */
@Controller('public/certificates')
export class PublicCertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  @Public()
  @Get(':code')
  verify(@Param('code') code: string) {
    return this.certificatesService.findByVerificationCode(code);
  }

  /** PDF do certificado pelo código de verificação (mesmos dados da verificação pública, sem graduação). */
  @Public()
  @Throttle(PDF_THROTTLE)
  @Get(':code/pdf')
  async pdf(@Param('code') code: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { filename, buffer } = await this.certificatesService.buildPublicPdf(code);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    return new StreamableFile(buffer);
  }
}
