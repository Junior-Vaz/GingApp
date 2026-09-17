import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../../shared/decorators/public.decorator';
import { PassportService } from './passport.service';

/** Passaporte público (projeto.txt §51) — sem autenticação, de propósito: é o que abre ao
 * escanear o QR Code que o aluno/responsável optou por compartilhar. */
@Controller('public/passport')
export class PublicPassportController {
  constructor(private readonly passportService: PassportService) {}

  @Public()
  @Get(':code')
  get(@Param('code') code: string) {
    return this.passportService.getPublicByCode(code);
  }
}
