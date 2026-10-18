import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Req, Res, UploadedFile, UseFilters, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../../shared/decorators/public.decorator';
import { LookupRegistrationDto, SubmitRegistrationDto, UploadRegistrationFileDto } from './dto/public-form.dto';
import { formsIpTracker } from './form-codes';
import { formsFileMaxBytes } from './private-storage';
import { PublicFormsExceptionFilter } from './public-forms-exception.filter';
import { PublicRegistrationService, UploadedFormFile } from './public-registration.service';

// Link publico = alvo de spam/abuso: limites PROPRIOS por IP (alem do global). Lidos a cada requisicao (os e2e sobem
// os limites em test/env-setup.ts e o spec prova o 429 rebaixando um deles). Tracker proprio (formsIpTracker): IPv6
// agrupado por /64, para trocar o sufixo do endereco nao zerar o limite.
const limit = (name: string, fallback: number) => () => Number(process.env[name] ?? fallback);
const throttle = (name: string, fallback: number) => ({ default: { limit: limit(name, fallback), ttl: 60_000, getTracker: formsIpTracker } });
const READ_THROTTLE = throttle('FORMS_READ_THROTTLE_LIMIT', 60);
const SHARE_THROTTLE = throttle('FORMS_SHARE_THROTTLE_LIMIT', 120);
const UPLOAD_THROTTLE = throttle('FORMS_UPLOAD_THROTTLE_LIMIT', 10);
const SUBMIT_THROTTLE = throttle('FORMS_SUBMIT_THROTTLE_LIMIT', 10);
const LOOKUP_THROTTLE = throttle('FORMS_LOOKUP_THROTTLE_LIMIT', 5);

/**
 * Formulario de inscricao PUBLICO (sem login): https://app.gingapp.com.br/i/<slug>. Respostas JSON sem cache
 * (no-store); erros com `code` estavel (PublicFormsExceptionFilter). Nenhuma rota daqui le inscricao de terceiros:
 * a consulta exige protocolo + e-mail/CPF que batam (resposta 404 constante).
 */
@Controller('public/forms')
@UseFilters(PublicFormsExceptionFilter)
export class PublicRegistrationFormsController {
  constructor(private readonly service: PublicRegistrationService) {}

  @Public()
  @Throttle(READ_THROTTLE)
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex')
  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.service.getPublic(slug);
  }

  /** HTML com Open Graph (o nginx do app manda so os robos de pre-visualizacao para ca). */
  @Public()
  @Throttle(SHARE_THROTTLE)
  @Get(':slug/share')
  async share(@Param('slug') slug: string, @Res() res: Response): Promise<void> {
    const { status, html, scriptHash } = await this.service.share(slug);
    res.status(status).set({
      'Content-Type': 'text/html; charset=utf-8',
      // Sem dado pessoal (so o que ja e publico no formulario): cache curto para os robos.
      'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; img-src https: data:; ${scriptHash ? `script-src 'sha256-${scriptHash}'; ` : ''}base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      'Referrer-Policy': 'no-referrer',
    });
    res.send(html);
  }

  /** Anexo PENDENTE (multipart: `file` + `fieldKey`). Devolve o `fileToken` a mandar no envio (vale 2 h). */
  @Public()
  @Throttle(UPLOAD_THROTTLE)
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: formsFileMaxBytes(), files: 1, fields: 3, parts: 5 } }))
  @Post(':slug/files')
  @HttpCode(HttpStatus.CREATED)
  upload(@Param('slug') slug: string, @Body() dto: UploadRegistrationFileDto, @UploadedFile() file: UploadedFormFile | undefined, @Req() req: Request) {
    return this.service.uploadFile(slug, dto.fieldKey, file, req.ip);
  }

  @Public()
  @Throttle(SUBMIT_THROTTLE)
  @Header('Cache-Control', 'no-store')
  @Post(':slug/submissions')
  @HttpCode(HttpStatus.CREATED)
  submit(@Param('slug') slug: string, @Body() dto: SubmitRegistrationDto, @Req() req: Request) {
    const ua = req.headers['user-agent'];
    return this.service.submit(slug, dto, req.ip, typeof ua === 'string' ? ua : undefined);
  }

  /** Consulta da propria inscricao: POST (protocolo/e-mail/CPF fora da URL e dos logs). */
  @Public()
  @Throttle(LOOKUP_THROTTLE)
  @Header('Cache-Control', 'no-store')
  @Post(':slug/lookup')
  @HttpCode(HttpStatus.OK)
  lookup(@Param('slug') slug: string, @Body() dto: LookupRegistrationDto) {
    return this.service.lookup(slug, dto);
  }
}
