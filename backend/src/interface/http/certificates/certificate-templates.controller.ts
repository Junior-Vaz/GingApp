import {
  Body,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { RequireFeature } from '../../../shared/decorators/require-feature.decorator';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { CertificateTemplatesService } from './certificate-templates.service';
import {
  CreateCertificateTemplateDto,
  PreviewCertificateTemplateDto,
  UpdateCertificateTemplateDto,
} from './dto/certificate-template.dto';

/** Limite lido a cada pedido (os e2e trocam a env). */
const envNumber = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Pré-visualização (gera PDF): 20/min POR USUÁRIO (UserThrottlerGuard, como o upload) e um teto mais alto por IP no guard
 * global (equipe atrás do mesmo Wi-Fi). CERT_PREVIEW_THROTTLE_LIMIT / CERT_PREVIEW_IP_THROTTLE_LIMIT ajustam.
 */
const PREVIEW_THROTTLE = {
  default: {
    ttl: 60_000,
    limit: (ctx: ExecutionContext) =>
      ctx.switchToHttp().getRequest<{ user?: unknown }>().user
        ? envNumber('CERT_PREVIEW_THROTTLE_LIMIT', 20)
        : envNumber('CERT_PREVIEW_IP_THROTTLE_LIMIT', 120),
  },
};

/**
 * Modelos de certificado (docs/CONTRATO_CERTIFICADOS_MODELOS.md secao 7), na matriz do recurso `certificates`:
 * ler/listar/pré-visualizar = `view` (MESTRE, PROFESSOR, INSTRUTOR); criar/duplicar = `create`; editar/definir padrão =
 * `edit`; EXCLUIR modelo = `edit` também (decisão explícita: a matriz não dá `delete` ao PROFESSOR, e o contrato quer
 * MESTRE e PROFESSOR excluindo modelos — excluir modelo não apaga certificado algum). Rotas fixas (`presets`,
 * `preview`) vêm ANTES de `:id`.
 */
@RequireFeature('certificates')
@Controller('certificate-templates')
export class CertificateTemplatesController {
  constructor(private readonly templates: CertificateTemplatesService) {}

  @Get()
  @CanAccess('certificates', 'view')
  list(@CurrentOrganization() organizationId: number) {
    return this.templates.list(organizationId);
  }

  @Get('presets')
  @CanAccess('certificates', 'view')
  presets() {
    return this.templates.presets();
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @CanAccess('certificates', 'view')
  @UseGuards(UserThrottlerGuard)
  @Throttle(PREVIEW_THROTTLE)
  async preview(
    @CurrentOrganization() organizationId: number,
    @Body() dto: PreviewCertificateTemplateDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.templates.preview(organizationId, dto.layout);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="previa-certificado.pdf"',
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(buffer);
  }

  @Get(':id')
  @CanAccess('certificates', 'view')
  findOne(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.templates.findOne(organizationId, id);
  }

  @Post()
  @CanAccess('certificates', 'create')
  create(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCertificateTemplateDto,
  ) {
    return this.templates.create(organizationId, user, dto);
  }

  @Patch(':id')
  @CanAccess('certificates', 'edit')
  update(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCertificateTemplateDto,
  ) {
    return this.templates.update(organizationId, id, dto);
  }

  @Post(':id/duplicate')
  @CanAccess('certificates', 'create')
  duplicate(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.templates.duplicate(organizationId, user, id);
  }

  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  @CanAccess('certificates', 'edit')
  setDefault(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.templates.setDefault(organizationId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CanAccess('certificates', 'edit')
  async remove(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.templates.remove(organizationId, id);
  }
}
