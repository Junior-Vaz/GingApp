import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { assertMestre, MestreOnlyGuard } from '../../../shared/guards/mestre-only.guard';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { sendCsv } from '../../../shared/csv/csv';
import { sendPage } from '../../../shared/pagination/pagination';
import {
  CreateRegistrationFormDto,
  ExportSubmissionsQueryDto,
  GetRegistrationFormQueryDto,
  ListRegistrationFormsQueryDto,
  ListSubmissionsQueryDto,
  RejectSubmissionDto,
  SaveRegistrationFormDto,
  UpdateSubmissionDto,
} from './dto/registration-form.dto';
import { RegistrationFormsService } from './registration-forms.service';
import { RegistrationSubmissionsService, SubmissionAction } from './registration-submissions.service';

const EXPORT_THROTTLE = { default: { limit: () => Number(process.env.FORMS_EXPORT_THROTTLE_LIMIT ?? 20), ttl: 60_000 } };

/**
 * Formularios de inscricao - painel. MESMA matriz da area de eventos (recurso `events`), mas a LEITURA exige `edit`
 * (gerenciar eventos), nao `view`: ALUNO/RESPONSAVEL/MONITOR tem `events.view` (agenda) e aqui ha dados pessoais de
 * inscritos. Criar/duplicar = `events.create`; excluir = `events.delete` (so MESTRE na matriz padrao). CSV, anexo,
 * confirmar pagamento e anonimizar: so o MESTRE (MestreOnlyGuard), alem da permissao. Listar e auditado.
 */
@Controller('event-forms')
export class RegistrationFormsController {
  constructor(
    private readonly forms: RegistrationFormsService,
    private readonly submissions: RegistrationSubmissionsService,
  ) {}

  @Get()
  @CanAccess('events', 'edit')
  async list(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListRegistrationFormsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.forms.list(organizationId, query, user));
  }

  /** Declarada antes de ":id" (senao "templates" cairia no ParseIntPipe). */
  @Get('templates')
  @CanAccess('events', 'edit')
  templates() {
    return this.forms.templates();
  }

  @Post()
  @CanAccess('events', 'create')
  create(@CurrentOrganization() organizationId: number, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRegistrationFormDto) {
    return this.forms.create(organizationId, dto, user);
  }

  @Get(':id')
  @CanAccess('events', 'edit')
  get(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: GetRegistrationFormQueryDto,
  ) {
    return this.forms.get(organizationId, id, user, query.includeArchived === true);
  }

  @Put(':id')
  @CanAccess('events', 'edit')
  save(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveRegistrationFormDto,
  ) {
    return this.forms.save(organizationId, id, dto, user);
  }

  @Delete(':id')
  @CanAccess('events', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentOrganization() organizationId: number, @CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    await this.forms.remove(organizationId, id, user);
  }

  @Post(':id/open')
  @CanAccess('events', 'edit')
  @HttpCode(HttpStatus.OK)
  open(@CurrentOrganization() organizationId: number, @CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.forms.open(organizationId, id, user);
  }

  @Post(':id/close')
  @CanAccess('events', 'edit')
  @HttpCode(HttpStatus.OK)
  close(@CurrentOrganization() organizationId: number, @CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.forms.close(organizationId, id, user);
  }

  @Post(':id/archive')
  @CanAccess('events', 'edit')
  @HttpCode(HttpStatus.OK)
  archive(@CurrentOrganization() organizationId: number, @CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.forms.archive(organizationId, id, user);
  }

  @Post(':id/duplicate')
  @CanAccess('events', 'create')
  duplicate(@CurrentOrganization() organizationId: number, @CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.forms.duplicate(organizationId, id, user);
  }

  @Get(':id/summary')
  @CanAccess('events', 'edit')
  summary(@CurrentOrganization() organizationId: number, @CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.forms.summary(organizationId, id, user);
  }

  // ---------------------------------------------------------------- inscricoes

  /**
   * Declarada antes de ":sid". So o MESTRE (dados pessoais de todos os inscritos de uma vez). Stream em lotes (memoria
   * constante); mesmos filtros da lista (status, paymentStatus, q).
   */
  @Get(':id/submissions/export.csv')
  @CanAccess('events', 'edit')
  @UseGuards(MestreOnlyGuard)
  @Throttle(EXPORT_THROTTLE)
  async exportCsv(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ExportSubmissionsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    let started = false;
    try {
      await this.submissions.exportCsv(organizationId, id, user, query, {
        start: (filename, total) => {
          sendCsv(res, filename, '', total);
          res.status(200);
          started = true;
        },
        write: (chunk) =>
          new Promise<boolean>((resolve) => {
            if (res.destroyed || res.writableEnded) return resolve(false);
            if (res.write(chunk)) return resolve(true);
            // Contrapressao: espera o buffer esvaziar (ou o cliente fechar) antes do proximo lote.
            const done = (ok: boolean) => {
              res.off('drain', onDrain);
              res.off('close', onClose);
              resolve(ok);
            };
            const onDrain = () => done(true);
            const onClose = () => done(false);
            res.on('drain', onDrain);
            res.on('close', onClose);
          }),
      });
      if (!res.writableEnded) res.end();
    } catch (error) {
      if (!started) throw error; // 403/404/400 antes do 1o byte: resposta de erro normal
      res.destroy(error instanceof Error ? error : undefined); // no meio do arquivo: corta (o download fica incompleto)
    }
  }

  @Get(':id/submissions')
  @CanAccess('events', 'edit')
  async listSubmissions(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListSubmissionsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const page = await this.submissions.list(organizationId, id, query, user);
    res.setHeader('X-Total-Count', String(page.total));
    res.setHeader('Cache-Control', 'no-store');
    return page;
  }

  @Get(':id/submissions/:sid')
  @CanAccess('events', 'edit')
  detail(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('sid', ParseIntPipe) sid: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.submissions.detail(organizationId, id, sid, user);
  }

  @Patch(':id/submissions/:sid')
  @CanAccess('events', 'edit')
  updateSubmission(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('sid', ParseIntPipe) sid: number,
    @Body() dto: UpdateSubmissionDto,
  ) {
    return this.submissions.updateNote(organizationId, id, sid, dto.internalNote, user);
  }

  /**
   * Anonimizacao manual (titular sem conta pediu exclusao, LGPD): so o MESTRE. Declarada ANTES de ":action".
   * Idempotente (ja anonimizada = 200 com o detalhe).
   */
  @Post(':id/submissions/:sid/anonymize')
  @CanAccess('events', 'edit')
  @UseGuards(MestreOnlyGuard)
  @HttpCode(HttpStatus.OK)
  anonymize(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('sid', ParseIntPipe) sid: number,
  ) {
    return this.submissions.anonymize(organizationId, id, sid, user);
  }

  @Post(':id/submissions/:sid/:action')
  @CanAccess('events', 'edit')
  @HttpCode(HttpStatus.OK)
  act(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('sid', ParseIntPipe) sid: number,
    @Param('action') action: string,
    @Body() dto: RejectSubmissionDto,
  ) {
    const allowed: SubmissionAction[] = ['confirm-payment', 'approve', 'reject', 'cancel', 'waitlist', 'promote'];
    if (!allowed.includes(action as SubmissionAction)) throw new NotFoundException('Ação não encontrada.');
    // Confirmar pagamento = dinheiro do grupo: so o MESTRE (as demais acoes seguem a permissao de eventos).
    if (action === 'confirm-payment') assertMestre(user);
    return this.submissions.act(organizationId, id, sid, action as SubmissionAction, user, dto.reason, dto.linkStudentId);
  }

  /**
   * Anexo PRIVADO (comprovante/documento): so o MESTRE do mesmo grupo. Tipo real (validado e reprocessado no envio),
   * nosniff, no-store e CSP `sandbox` em TODOS os tipos (imagem e PDF).
   */
  @Get(':id/submissions/:sid/files/:fileId')
  @CanAccess('events', 'edit')
  @UseGuards(MestreOnlyGuard)
  async file(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('sid', ParseIntPipe) sid: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Res() res: Response,
  ): Promise<void> {
    const found = await this.submissions.file(organizationId, id, sid, fileId, user);
    const asciiName = found.originalName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.set({
      'Content-Type': found.mimeType,
      'Content-Disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(found.originalName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.sendFile(found.fullPath, { dotfiles: 'deny', cacheControl: false, lastModified: false }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ statusCode: 404, message: 'Arquivo não encontrado.', error: 'Not Found' });
    });
  }
}
