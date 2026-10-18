import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  Prisma,
  RecordStatus,
  RegistrationFormStatus,
  RegistrationPaymentMode,
  RegistrationPaymentStatus,
  RegistrationSubmissionStatus,
} from '@prisma/client';
import * as path from 'node:path';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { formatInstantBR } from '../../../shared/dates/format-br';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { parseCpf } from '../../../shared/security/person-document';
import { resolveUploadsDir } from '../../../shared/uploads/uploads-dir';
import { emailDedupKey, MAX_ANSWER_KEYS, MAX_ANSWERS_BYTES, normalizeEmailAnswer, validateAnswers } from './answer-validation';
import { syncConsentSnapshot } from './consent-snapshot';
import { LookupRegistrationDto, SubmitRegistrationDto } from './dto/public-form.dto';
import {
  FormErrorCode,
  formClosedError,
  formFullError,
  generateProtocol,
  hashFileToken,
  hashIp,
  issueStartedToken,
  newFileToken,
  normalizeProtocol,
  publicFormNotFound,
  SLUG_REGEX,
  tooManyRequests,
  validationError,
  verifyStartedToken,
} from './form-codes';
import {
  ACTIVE_SUBMISSION_STATUSES,
  appUrl,
  closedReasonOf,
  consentTextOf,
  encryptCpfAnswer,
  formSpotsLeft,
  identityDocument,
  identityKeys,
  isFormFull,
  OCCUPYING_SUBMISSION_STATUSES,
  publicFormUrl,
  safeBannerUrl,
  waitlistCap,
} from './form-common';
import { FieldValidation, ShowIf } from './form-definition';
import {
  detectPrivateFileType,
  deletePrivateFile,
  formsFileMaxBytes,
  resolvePrivateUploadsDir,
  sanitizeImage,
  sanitizeOriginalName,
  storePrivateFile,
} from './private-storage';
import { RegistrationEffectsService } from './registration-effects.service';
import { absoluteImageUrl, plainExcerpt, renderShareHtml } from './share-html';

/** Validade do token de anexo pendente (upload antes do envio da inscricao). */
export const PENDING_FILE_TTL_MS = 2 * 60 * 60 * 1000;
/** Tempo minimo/maximo entre abrir a pagina e enviar (anti-robo), medido pelo relogio do SERVIDOR (startedToken). */
export const MIN_FILL_MS = 2_000;
export const MAX_FILL_MS = 24 * 60 * 60 * 1000;

const SPAM_MESSAGE = 'Não foi possível validar o envio. Recarregue a página e tente de novo.';

const intEnv = (env: NodeJS.ProcessEnv, name: string, fallback: number): number => {
  const n = Number(env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/**
 * Teto de anexos PENDENTES (sem inscricao) por formulario - contando tambem os ja expirados que a limpeza (a cada 15 min)
 * ainda nao apagou, porque eles ocupam disco do mesmo jeito.
 */
export function pendingFilesCap(env: NodeJS.ProcessEnv = process.env): number {
  return intEnv(env, 'FORMS_PENDING_FILES_MAX', 200);
}
/** Teto de anexos PENDENTES por IP (IPv6 por /64) + formulario (padrao 10), mesma contagem. */
export function pendingFilesPerIpCap(env: NodeJS.ProcessEnv = process.env): number {
  return intEnv(env, 'FORMS_PENDING_FILES_PER_IP', 10);
}
/** Teto de BYTES de anexos pendentes por grupo (FORMS_PENDING_BYTES_MAX_MB, padrao 500 MB). */
export function pendingBytesCap(env: NodeJS.ProcessEnv = process.env): number {
  return intEnv(env, 'FORMS_PENDING_BYTES_MAX_MB', 500) * 1024 * 1024;
}
/** Inscricoes por IP (IPv6 por /64) + formulario: por hora (padrao 5) e por dia (padrao 20). */
export function submissionsPerIpLimits(env: NodeJS.ProcessEnv = process.env): { hour: number; day: number } {
  return { hour: intEnv(env, 'FORMS_SUBMISSIONS_PER_IP_HOUR', 5), day: intEnv(env, 'FORMS_SUBMISSIONS_PER_IP_DAY', 20) };
}
/**
 * FORMS_PUBLIC_LEGACY (padrao true, transicao): aceita o app ANTIGO em cache - `startedAt` do navegador sem
 * `startedToken` e envio sem `consentVersion`. `false` = exige os dois (recomendado depois que o app novo estiver no ar).
 */
export function formsPublicLegacy(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.FORMS_PUBLIC_LEGACY?.trim().toLowerCase();
  return !(v === 'false' || v === '0' || v === 'off');
}

function consentOutdated(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: FormErrorCode.CONSENT_OUTDATED,
    message: 'O termo de consentimento deste formulário foi atualizado. Recarregue a página, leia o termo novo e envie de novo.',
  });
}

export interface UploadedFormFile {
  buffer: Buffer;
  size: number;
  originalname?: string;
}

const PUBLIC_INCLUDE = {
  sections: { orderBy: [{ order: 'asc' }, { id: 'asc' }] },
  fields: { where: { archived: false }, orderBy: [{ order: 'asc' }, { id: 'asc' }] },
  event: { select: { title: true, date: true, location: true, status: true, registrationDeadline: true } },
  organization: { select: { status: true, logo: true } },
} satisfies Prisma.RegistrationFormInclude;

type PublicForm = Prisma.RegistrationFormGetPayload<{ include: typeof PUBLIC_INCLUDE }>;

/**
 * Lado PUBLICO (sem login) do formulario: leitura, anexo pendente, envio, consulta por protocolo e o HTML de
 * pre-visualizacao. Nunca devolve dado de outra inscricao; rascunho/arquivado/inexistente = o MESMO 404.
 */
@Injectable()
export class PublicRegistrationService implements OnModuleInit {
  private readonly logger = new Logger(PublicRegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly effects: RegistrationEffectsService,
  ) {}

  /** O diretorio privado NUNCA pode ficar dentro do diretorio de imagens publicas (GET /api/uploads). */
  onModuleInit(): void {
    const publicDir = path.resolve(resolveUploadsDir());
    const privateDir = path.resolve(resolvePrivateUploadsDir());
    if (privateDir === publicDir || privateDir.startsWith(publicDir + path.sep)) {
      throw new Error('PRIVATE_UPLOADS_DIR não pode ficar dentro de UPLOADS_DIR (os anexos das inscrições seriam públicos).');
    }
  }

  private async loadPublicForm(slug: string): Promise<PublicForm> {
    if (typeof slug !== 'string' || !SLUG_REGEX.test(slug)) throw publicFormNotFound();
    const form = await this.prisma.registrationForm.findUnique({ where: { slug }, include: PUBLIC_INCLUDE });
    if (
      !form ||
      (form.status !== RegistrationFormStatus.OPEN && form.status !== RegistrationFormStatus.CLOSED) ||
      form.organization.status !== RecordStatus.ACTIVE
    ) {
      throw publicFormNotFound();
    }
    return form;
  }

  /** Vagas ocupadas (PENDING/CONFIRMED) e lista de espera do formulario. */
  private async counts(
    formId: number,
    db: Pick<Prisma.TransactionClient, 'registrationSubmission'> = this.prisma,
  ): Promise<{ occupied: number; waitlisted: number }> {
    const [occupied, waitlisted] = await Promise.all([
      db.registrationSubmission.count({ where: { formId, status: { in: OCCUPYING_SUBMISSION_STATUSES } } }),
      db.registrationSubmission.count({ where: { formId, status: RegistrationSubmissionStatus.WAITLIST } }),
    ]);
    return { occupied, waitlisted };
  }

  private async closedReason(form: PublicForm, now: Date = new Date()) {
    const { occupied, waitlisted } = await this.counts(form.id);
    return { reason: closedReasonOf(form, occupied, now, waitlisted), occupied };
  }

  // -------------------------------------------------------------------------------------------------------------
  // GET /public/forms/:slug
  // -------------------------------------------------------------------------------------------------------------

  async getPublic(slug: string) {
    const form = await this.loadPublicForm(slug);
    const { reason: closedReason, occupied } = await this.closedReason(form);
    const isOpen = closedReason === null;
    return {
      slug: form.slug,
      title: form.title,
      intro: form.intro,
      bannerUrl: safeBannerUrl(form.bannerUrl),
      status: form.status,
      isOpen,
      closedReason,
      event: form.event ? { title: form.event.title, date: form.event.date, location: form.event.location } : null,
      paymentMode: form.paymentMode,
      priceCents: form.priceCents,
      // Chave Pix so com o formulario ABERTO (encerrado nao precisa mais receber).
      pix:
        form.paymentMode === RegistrationPaymentMode.PIX_MANUAL && isOpen && form.pixKey
          ? { key: form.pixKey, keyType: form.pixKeyType, beneficiary: form.pixBeneficiary }
          : null,
      sections: form.sections.map((s) => ({ id: s.id, order: s.order, title: s.title, description: s.description })),
      fields: form.fields.map((f) => ({
        key: f.key,
        type: f.type,
        label: f.label,
        helpText: f.helpText,
        required: f.required,
        options: f.options,
        validation: f.validation,
        showIf: f.showIf,
        sectionId: f.sectionId,
        order: f.order,
        mapsTo: f.mapsTo,
      })),
      consent: { text: consentTextOf(form), version: form.consentVersion },
      spotsLeft: formSpotsLeft(form.maxSubmissions, occupied),
      // Devolvido no envio: prova (pelo relogio do servidor) quando a pagina foi aberta.
      startedToken: issueStartedToken(form.slug),
    };
  }

  // -------------------------------------------------------------------------------------------------------------
  // POST /public/forms/:slug/files  (anexo PENDENTE, antes do envio)
  // -------------------------------------------------------------------------------------------------------------

  async uploadFile(slug: string, fieldKey: string, file: UploadedFormFile | undefined, ip?: string) {
    const form = await this.loadPublicForm(slug);
    const { reason } = await this.closedReason(form);
    if (reason) throw formClosedError(reason);
    const field = form.fields.find((f) => f.key === fieldKey && f.type === 'FILE');
    if (!field) throw validationError({ fieldKey: 'Este campo não aceita arquivo.' });
    if (!file || !file.buffer || file.size === 0) throw validationError({ file: 'Envie o arquivo no campo "file".' });
    const max = formsFileMaxBytes();
    const tooLarge = () =>
      new HttpException(
        { statusCode: 413, error: 'Payload Too Large', code: FormErrorCode.FILE_TOO_LARGE, message: `O arquivo passa do limite de ${Math.round(max / 1048576)} MB.` },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    if (file.size > max || file.buffer.length > max) throw tooLarge();
    const notAllowed = () =>
      new UnsupportedMediaTypeException({
        statusCode: 415,
        error: 'Unsupported Media Type',
        code: FormErrorCode.FILE_TYPE_NOT_ALLOWED,
        message: 'Formato não aceito: envie uma imagem (JPG, PNG ou WEBP) ou um PDF.',
      });
    const type = detectPrivateFileType(file.buffer);
    if (!type) throw notAllowed();

    // Tetos de disco (anonimo): pendentes do formulario, do IP (/64) no formulario e BYTES pendentes do grupo. Contam
    // TAMBEM os expirados ainda nao apagados (a limpeza roda a cada 15 min): ocupam disco do mesmo jeito.
    const now = new Date();
    const ipHash = hashIp(ip);
    const pendingWhere = { submissionId: null } as const;
    const [pendingForm, pendingIp, pendingBytes] = await Promise.all([
      this.prisma.registrationSubmissionFile.count({ where: { ...pendingWhere, formId: form.id } }),
      ipHash ? this.prisma.registrationSubmissionFile.count({ where: { ...pendingWhere, formId: form.id, ipHash } }) : Promise.resolve(0),
      this.prisma.registrationSubmissionFile.aggregate({ where: { ...pendingWhere, organizationId: form.organizationId }, _sum: { sizeBytes: true } }),
    ]);
    if (pendingForm >= pendingFilesCap() || pendingIp >= pendingFilesPerIpCap() || (pendingBytes._sum.sizeBytes ?? 0) + file.buffer.length > pendingBytesCap()) {
      throw tooManyRequests('Muitos arquivos enviados agora. Envie a inscrição com os arquivos já anexados ou tente de novo mais tarde.');
    }

    // Imagem: reprocessada SEM metadados (EXIF/GPS). Nao decodifica = 415. PDF intocado.
    const clean = await sanitizeImage(file.buffer, type);
    if (!clean) throw notAllowed();
    if (!clean.reprocessed && type.mime !== 'application/pdf') this.logger.warn('sharp indisponível: anexo de imagem gravado SEM remover EXIF/GPS.');
    if (clean.buffer.length > max) throw tooLarge();

    const stored = await storePrivateFile(form.organizationId, clean.buffer, type);
    const { token, hash } = newFileToken();
    const originalName = sanitizeOriginalName(file.originalname, type.ext);
    try {
      await this.prisma.registrationSubmissionFile.create({
        data: {
          formId: form.id,
          organizationId: form.organizationId,
          fieldKey: field.key,
          storageKey: stored.storageKey,
          originalName,
          mimeType: type.mime,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
          pendingToken: hash,
          expiresAt: new Date(now.getTime() + PENDING_FILE_TTL_MS),
          ipHash,
        },
      });
    } catch (error) {
      await deletePrivateFile(stored.storageKey).catch(() => undefined); // sem arquivo orfao
      throw error;
    }
    return { fileToken: token, originalName, mimeType: type.mime, sizeBytes: stored.sizeBytes };
  }

  // -------------------------------------------------------------------------------------------------------------
  // POST /public/forms/:slug/submissions
  // -------------------------------------------------------------------------------------------------------------

  /**
   * Tempo de preenchimento pelo relogio do SERVIDOR: `startedToken` (HMAC do instante do GET + slug). Sem token, so o
   * app antigo (`startedAt` do navegador) e so com FORMS_PUBLIC_LEGACY ligado. Sem nenhum dos dois = recusa.
   */
  private fillTimeOk(slug: string, dto: SubmitRegistrationDto, now: number): boolean {
    let startedAt: number | null = null;
    if (dto.startedToken !== undefined) startedAt = verifyStartedToken(slug, dto.startedToken);
    else if (formsPublicLegacy() && typeof dto.startedAt === 'number') startedAt = dto.startedAt;
    if (startedAt === null) return false;
    const elapsed = now - startedAt;
    return Number.isFinite(elapsed) && elapsed >= MIN_FILL_MS && elapsed <= MAX_FILL_MS;
  }

  async submit(slug: string, dto: SubmitRegistrationDto, ip: string | undefined, userAgent: string | undefined) {
    const answers = dto.answers ?? {};
    if (Object.keys(answers).length > MAX_ANSWER_KEYS) throw validationError({}, 'Envio inválido.');
    if (Buffer.byteLength(JSON.stringify(answers), 'utf8') > MAX_ANSWERS_BYTES) {
      throw validationError({ answers: 'Respostas grandes demais.' }, 'Envio inválido: as respostas passam do tamanho permitido.');
    }
    // Anti-robo: honeypot preenchido ou tempo de preenchimento impossivel/sem prova => mesma recusa generica.
    if ((dto.hp ?? '').trim() !== '' || !this.fillTimeOk(slug, dto, Date.now())) {
      throw validationError({}, SPAM_MESSAGE);
    }

    const form = await this.loadPublicForm(slug);
    const precheck = (await this.closedReason(form)).reason;
    if (precheck) throw formClosedError(precheck);

    // Termo vigente: snapshot gravado/atualizado ANTES (transacao propria, ja confirmada), para que o 409 abaixo e o GET
    // que o cliente refaz mostrem a MESMA versao (sem laco de 409).
    const consentNow = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "RegistrationForm" WHERE id = ${form.id} FOR UPDATE`;
      return syncConsentSnapshot(tx, form.id);
    });
    if (dto.consentVersion !== undefined ? dto.consentVersion !== consentNow.version : !formsPublicLegacy()) throw consentOutdated();

    const fields = form.fields.map((f) => ({
      key: f.key,
      type: f.type,
      required: f.required,
      options: (f.options as string[] | null) ?? null,
      validation: (f.validation as FieldValidation | null) ?? null,
      showIf: (f.showIf as ShowIf | null) ?? null,
      mapsTo: f.mapsTo,
    }));
    const result = validateAnswers(fields, answers);
    const errors = { ...result.errors };
    if (dto.consent !== true) errors.consent = 'É preciso aceitar o termo de consentimento para enviar.';

    // Anexos: token do MESMO formulario, do MESMO campo, nao usado e nao expirado.
    const now = new Date();
    const fileIdsByKey: Record<string, number> = {};
    for (const [key, token] of Object.entries(result.fileTokens)) {
      const file = await this.prisma.registrationSubmissionFile.findUnique({ where: { pendingToken: hashFileToken(token) } });
      if (!file || file.formId !== form.id || file.fieldKey !== key || file.submissionId !== null || !file.expiresAt || file.expiresAt <= now) {
        errors[key] = 'Arquivo inválido ou expirado: envie o arquivo de novo.';
      } else {
        fileIdsByKey[key] = file.id;
      }
    }
    if (Object.keys(errors).length > 0) throw validationError(errors);

    // Identificacao (so dos campos VISIVEIS respondidos).
    const ids = identityKeys(fields.filter((f) => result.visible.has(f.key)));
    const str = (k: string | null) => (k && typeof result.values[k] === 'string' ? (result.values[k] as string) : null);
    const email = str(ids.email);
    const emailKey = emailDedupKey(email);
    const phone = str(ids.phone);
    const documentDigits = str(ids.document);
    const doc = documentDigits ? identityDocument(documentDigits) : null;
    const ipHash = hashIp(ip);

    // Respostas gravadas: CPF/e-mail/telefone de identificacao ficam nas colunas proprias (aqui so a referencia);
    // outros CPFs cifrados; anexos pelo id.
    const stored: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, value] of Object.entries(result.values)) {
      const field = fields.find((f) => f.key === key)!;
      if (key === ids.document && doc) stored[key] = { ref: 'document' };
      else if (key === ids.email && email) stored[key] = { ref: 'email' };
      else if (key === ids.phone && phone) stored[key] = { ref: 'phone' };
      else if (field.type === 'CPF') stored[key] = { ...encryptCpfAnswer(String(value)) };
      else stored[key] = value as Prisma.InputJsonValue;
    }
    for (const [key, id] of Object.entries(fileIdsByKey)) stored[key] = { fileIds: [id] };

    const outcome = await this.prisma.$transaction(
      async (tx) => {
        // Trava o formulario: contagem de vagas, duplicidade e gravacao numa secao critica (sem estourar o limite).
        await tx.$queryRaw`SELECT id FROM "RegistrationForm" WHERE id = ${form.id} FOR UPDATE`;
        const fresh = await tx.registrationForm.findUniqueOrThrow({
          where: { id: form.id },
          include: { event: { select: { status: true, registrationDeadline: true } } },
        });
        const { occupied, waitlisted } = await this.counts(form.id, tx);
        const reason = closedReasonOf(fresh, occupied, now, waitlisted);
        if (reason) throw formClosedError(reason);

        // Teto por IP (IPv6 por /64) neste formulario: barra o flood de linhas/vagas por um mesmo anonimo.
        if (ipHash) {
          const limits = submissionsPerIpLimits();
          const [lastHour, lastDay] = await Promise.all([
            tx.registrationSubmission.count({ where: { formId: form.id, ipHash, createdAt: { gte: new Date(now.getTime() - 3600_000) } } }),
            tx.registrationSubmission.count({ where: { formId: form.id, ipHash, createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) } } }),
          ]);
          if (lastHour >= limits.hour || lastDay >= limits.day) {
            throw tooManyRequests('Muitas inscrições enviadas desta conexão neste formulário. Tente de novo mais tarde.');
          }
        }

        // Termo: a versao exibida precisa ser a vigente (mudou entre o passo acima e agora = 409 tambem).
        const consent = await syncConsentSnapshot(tx, form.id);
        if (dto.consentVersion !== undefined && dto.consentVersion !== consent.version) throw consentOutdated();

        // Duplicidade (UX: 409 ALREADY_REGISTERED). Risco ACEITO de oraculo "este CPF/e-mail ja se inscreveu aqui",
        // mitigado pelos tetos por IP acima e pelo throttle da rota (docs/PLANO_FORMULARIOS_INSCRICAO.md secao 6).
        const dupOr: Prisma.RegistrationSubmissionWhereInput[] = [];
        if (doc) dupOr.push({ documentHash: doc.documentHash });
        if (emailKey) dupOr.push({ emailKey });
        if (dupOr.length > 0) {
          const dup = await tx.registrationSubmission.findFirst({
            where: { formId: form.id, status: { in: ACTIVE_SUBMISSION_STATUSES }, OR: dupOr },
            select: { id: true },
          });
          if (dup) {
            throw new HttpException(
              {
                statusCode: 409,
                error: 'Conflict',
                code: FormErrorCode.ALREADY_REGISTERED,
                message: 'Já existe uma inscrição com estes dados neste formulário. Consulte a sua inscrição pelo protocolo.',
              },
              HttpStatus.CONFLICT,
            );
          }
        }

        const full = isFormFull(fresh.maxSubmissions, occupied);
        if (full && !fresh.allowWaitlist) throw formFullError();
        const waitlistFull = waitlisted >= waitlistCap(fresh.maxSubmissions);
        if (full && waitlistFull) throw formClosedError('FULL');
        const paymentStatus =
          fresh.paymentMode === RegistrationPaymentMode.PIX_MANUAL && (fresh.priceCents ?? 0) > 0
            ? RegistrationPaymentStatus.PENDING
            : RegistrationPaymentStatus.NOT_REQUIRED;
        let status: RegistrationSubmissionStatus = full
          ? RegistrationSubmissionStatus.WAITLIST
          : !fresh.requireApproval && paymentStatus === RegistrationPaymentStatus.NOT_REQUIRED
            ? RegistrationSubmissionStatus.CONFIRMED
            : RegistrationSubmissionStatus.PENDING;
        // Confirmacao automatica respeita a capacidade do EVENTO ligado (Event.capacity): lotado = lista de espera
        // (se o formulario tem fila com espaco) ou 410 FULL.
        if (status === RegistrationSubmissionStatus.CONFIRMED && fresh.eventId && !(await this.effects.eventHasRoom(tx, fresh.eventId))) {
          if (!fresh.allowWaitlist || waitlistFull) throw formClosedError('FULL');
          status = RegistrationSubmissionStatus.WAITLIST;
        }
        // CPF de aluno ATIVO do grupo: so SUGESTAO (o envio anonimo nunca liga a ficha nem mexe na participacao dele).
        const suggestedStudentId = doc ? await this.effects.matchStudent(tx, form.organizationId, doc.documentHash) : null;

        let protocol = generateProtocol();
        for (let i = 0; i < 10 && (await tx.registrationSubmission.findUnique({ where: { protocol }, select: { id: true } })); i++) {
          protocol = generateProtocol();
        }
        const nameValue = str(ids.name);
        const submission = await tx.registrationSubmission.create({
          data: {
            organizationId: form.organizationId,
            formId: form.id,
            protocol,
            status,
            paymentStatus,
            answers: stored,
            name: (nameValue ?? `Inscrição ${protocol}`).slice(0, 200),
            email,
            emailKey,
            phone,
            documentHash: doc?.documentHash ?? null,
            documentEnc: doc?.documentEnc ?? null,
            documentLast4: doc?.documentLast4 ?? null,
            consentAt: now,
            consentVersion: consent.version,
            ipHash,
            userAgent: userAgent ? userAgent.slice(0, 200) : null,
            suggestedStudentId,
          },
        });
        const fileIds = Object.values(fileIdsByKey);
        if (fileIds.length > 0) {
          // Condicional: um token usado em dois envios simultaneos so liga a UM (o outro reverte).
          const linked = await tx.registrationSubmissionFile.updateMany({
            where: { id: { in: fileIds }, formId: form.id, submissionId: null, expiresAt: { gt: now } },
            data: { submissionId: submission.id, pendingToken: null, expiresAt: null },
          });
          if (linked.count !== fileIds.length) {
            throw validationError(Object.fromEntries(Object.keys(fileIdsByKey).map((k) => [k, 'Arquivo inválido ou expirado: envie o arquivo de novo.'])));
          }
        }
        if (status === RegistrationSubmissionStatus.CONFIRMED) {
          await this.effects.ensureParticipant(tx, submission, fresh.eventId);
        }
        const notifyCount = await this.effects.bumpMestreNotice(tx, fresh, now);
        return { submission, notifyCount, fresh, files: fileIds.length };
      },
      { timeout: 20_000, maxWait: 15_000 },
    );

    const { submission, fresh } = outcome;
    await this.audit.record({
      organizationId: form.organizationId,
      userId: null,
      ip: null, // anonimo: nem o IP cru vai para a trilha (o ipHash fica na propria inscricao)
      action: AuditAction.REGISTRATION_SUBMISSION_CREATE,
      entity: AuditEntity.REGISTRATION_SUBMISSION,
      entityId: submission.id,
      meta: { formId: form.id, status: submission.status, paymentStatus: submission.paymentStatus, files: outcome.files },
    });
    await this.effects.notifyMestres(form.organizationId, form.title, outcome.notifyCount);
    await this.effects.notifyApplicant(
      submission.email,
      submission.status === RegistrationSubmissionStatus.CONFIRMED ? 'CONFIRMED' : submission.status === RegistrationSubmissionStatus.WAITLIST ? 'WAITLIST' : 'RECEIVED',
      { formTitle: form.title, protocol: submission.protocol, slug: form.slug },
      { source: 'public', formId: form.id, emailKey: submission.emailKey, now },
    );

    const paid = submission.paymentStatus === RegistrationPaymentStatus.PENDING;
    return {
      protocol: submission.protocol,
      status: submission.status,
      paymentStatus: submission.paymentStatus,
      message: this.messageFor(submission.status, submission.paymentStatus, fresh.confirmationMessage),
      payment: paid
        ? {
            mode: fresh.paymentMode,
            amountCents: fresh.priceCents,
            pix: fresh.pixKey ? { key: fresh.pixKey, keyType: fresh.pixKeyType, beneficiary: fresh.pixBeneficiary } : null,
          }
        : null,
      // Pagamento pendente sem nenhum comprovante anexado neste envio: a pessoa ainda precisa mandar ao organizador.
      proofRequired: paid && outcome.files === 0,
    };
  }

  private messageFor(status: RegistrationSubmissionStatus, paymentStatus: RegistrationPaymentStatus, custom?: string | null): string {
    if (status === RegistrationSubmissionStatus.WAITLIST) return 'As vagas acabaram e você entrou na lista de espera. Avisaremos se uma vaga abrir.';
    if (status === RegistrationSubmissionStatus.REJECTED) return 'A inscrição não foi aceita pelo organizador.';
    if (status === RegistrationSubmissionStatus.CANCELLED) return 'A inscrição foi cancelada.';
    if (custom && custom.trim()) return custom.trim();
    if (status === RegistrationSubmissionStatus.CONFIRMED) return 'Inscrição confirmada! Guarde o número do protocolo.';
    if (paymentStatus === RegistrationPaymentStatus.PENDING) return 'Inscrição recebida! Ela será confirmada quando o organizador conferir o pagamento.';
    return 'Inscrição recebida! Aguarde a confirmação do organizador.';
  }

  // -------------------------------------------------------------------------------------------------------------
  // POST /public/forms/:slug/lookup
  // -------------------------------------------------------------------------------------------------------------

  async lookup(slug: string, dto: LookupRegistrationDto) {
    const email = dto.email ? normalizeEmailAnswer(dto.email) : null;
    const cpf = dto.document ? parseCpf(dto.document) : null;
    if (!dto.email?.trim() && !dto.document?.trim()) {
      throw validationError({ email: 'Informe o e-mail ou o CPF usado na inscrição.' });
    }
    // Qualquer falha (slug, protocolo, identificador) = o MESMO 404, sem dizer qual parte nao bateu.
    const notFound = new NotFoundException({
      statusCode: 404,
      error: 'Not Found',
      code: FormErrorCode.NOT_FOUND,
      message: 'Inscrição não encontrada. Confira o protocolo e o e-mail ou CPF informados.',
    });
    const protocol = normalizeProtocol(dto.protocol);
    if (!protocol || !SLUG_REGEX.test(slug)) throw notFound;
    const s = await this.prisma.registrationSubmission.findUnique({
      where: { protocol },
      include: { form: { select: { slug: true, status: true, confirmationMessage: true } } },
    });
    const docHash = cpf ? identityDocument(cpf).documentHash : null;
    const matches =
      !!s &&
      !s.anonymizedAt &&
      s.form.slug === slug &&
      (s.form.status === RegistrationFormStatus.OPEN || s.form.status === RegistrationFormStatus.CLOSED) &&
      ((!!email && s.email === email) || (!!docHash && s.documentHash === docHash));
    if (!matches) throw notFound;
    return {
      protocol: s.protocol,
      status: s.status,
      paymentStatus: s.paymentStatus,
      message: this.messageFor(s.status, s.paymentStatus, s.status === RegistrationSubmissionStatus.CONFIRMED ? null : s.form.confirmationMessage),
    };
  }

  // -------------------------------------------------------------------------------------------------------------
  // GET /public/forms/:slug/share  (HTML com Open Graph para robos de pre-visualizacao)
  // -------------------------------------------------------------------------------------------------------------

  async share(slug: string): Promise<{ status: number; html: string; scriptHash: string | null }> {
    const base = appUrl();
    const fallbackImage = `${base}/icone.png`;
    let form: PublicForm | null = null;
    try {
      form = await this.loadPublicForm(slug);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    if (!form) {
      const { html, scriptHash } = renderShareHtml({
        title: 'Inscrições - GingApp',
        description: 'Formulário de inscrição não encontrado.',
        imageUrl: fallbackImage,
        url: base,
        redirectUrl: null,
      });
      return { status: 404, html, scriptHash };
    }
    const when = form.event ? formatInstantBR(form.event.date) : null;
    const excerpt = plainExcerpt(form.intro, 150);
    const description = [excerpt || 'Faça a sua inscrição pelo GingApp.', when].filter(Boolean).join(' · ');
    const url = publicFormUrl(form.slug);
    const { html, scriptHash } = renderShareHtml({
      title: form.title,
      description,
      imageUrl: absoluteImageUrl(safeBannerUrl(form.bannerUrl), base) ?? absoluteImageUrl(form.organization.logo, base) ?? fallbackImage,
      url,
      redirectUrl: `${url}?src=share`,
    });
    return { status: 200, html, scriptHash };
  }
}
