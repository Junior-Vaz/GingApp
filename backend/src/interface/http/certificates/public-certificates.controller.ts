import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../../shared/decorators/public.decorator';
import { CertificatesService } from './certificates.service';

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
}
