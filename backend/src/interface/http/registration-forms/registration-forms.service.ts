import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import {
  Prisma,
  RegistrationForm,
  RegistrationFormField,
  RegistrationFormSection,
  RegistrationFormStatus,
  RegistrationPaymentMode,
  RegistrationPaymentStatus,
  RegistrationSubmissionStatus,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { isRestricted, UNIT_ACCESS_DENIED, UnitScopeService } from '../../../shared/access/unit-scope';
import {
  CreateRegistrationFormDto,
  ListRegistrationFormsQueryDto,
  SaveRegistrationFormDto,
} from './dto/registration-form.dto';
import {
  FormErrorCode,
  generateSlug,
  invalidTransition,
  paymentModeNotAvailable,
  validationError,
} from './form-codes';
import { syncConsentSnapshot } from './consent-snapshot';
import { consentTextOf, formSpotsLeft, OCCUPYING_SUBMISSION_STATUSES, publicFormUrl, safeBannerUrl } from './form-common';
import { FieldErrors, FIELD_KEY_REGEX, publishErrors, RawFieldInput, validateFields } from './form-definition';
import { FORM_TEMPLATES, listTemplates, TemplateKey } from './form-templates';
import { deletePrivateFile } from './private-storage';
import { formsRetentionMode, formsRetentionModeLabel } from './submission-purge';

type FormWithDefinition = RegistrationForm & {
  sections: RegistrationFormSection[];
  fields: RegistrationFormField[];
  event: { id: number; title: string; date: Date; status: string; unitId: number | null } | null;
};

const DEFINITION_INCLUDE = {
  sections: { orderBy: [{ order: 'asc' }, { id: 'asc' }] },
  fields: { orderBy: [{ order: 'asc' }, { id: 'asc' }] },
  event: { select: { id: true, title: true, date: true, status: true, unitId: true } },
} satisfies Prisma.RegistrationFormInclude;

const NOT_FOUND = 'Formulário não encontrado.';

/**
 * Formularios de inscricao - lado ADMIN (painel). Sempre isolado por organizationId (do token). Escopo por unidade
 * (E08): equipe restrita a unidades so enxerga/gerencia formularios ligados a EVENTO de uma das suas unidades
 * (formulario avulso ou de evento do grupo inteiro = 404 para ela, como registro fora do escopo).
 */
@Injectable()
export class RegistrationFormsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RegistrationFormsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly unitScope: UnitScopeService,
  ) {}

  /**
   * Aviso no boot: ha inscricoes guardadas e a retencao NAO apaga de verdade (FORMS_RETENTION_PURGE dry-run/false). O
   * termo padrao promete apagar/anonimizar depois de N meses; o painel mostra o mesmo aviso (summary.retention.mode).
   */
  async onApplicationBootstrap(): Promise<void> {
    const mode = formsRetentionMode();
    if (mode === 'on') return;
    try {
      const stored = await this.prisma.registrationSubmission.count({ where: { anonymizedAt: null } });
      if (stored > 0) {
        this.logger.warn(
          `FORMS_RETENTION_PURGE=${mode}: ${stored} inscrição(ões) de formulários guardadas e a retenção LGPD NÃO está apagando ` +
            'nada (só registra no log). Ligue FORMS_RETENTION_PURGE=true depois de conferir o dry-run (docs/EASYPANEL.md, seção 26).',
        );
      }
    } catch {
      // aviso e best-effort: nunca impede a subida
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Escopo / carga
  // -------------------------------------------------------------------------------------------------------------

  async scopeWhere(user: AuthenticatedUser | undefined, organizationId: number): Promise<Prisma.RegistrationFormWhereInput> {
    const scope = await this.unitScope.resolve(user, organizationId);
    return isRestricted(scope) ? { event: { unitId: { in: scope } } } : {};
  }

  /** Formulario do grupo dentro do escopo, ou 404 (mesma mensagem do inexistente/de outro grupo). */
  async loadForm(organizationId: number, id: number, user: AuthenticatedUser | undefined): Promise<FormWithDefinition> {
    const form = await this.prisma.registrationForm.findFirst({
      where: { id, organizationId, AND: [await this.scopeWhere(user, organizationId)] },
      include: DEFINITION_INCLUDE,
    });
    if (!form) throw new NotFoundException(NOT_FOUND);
    return form as FormWithDefinition;
  }

  /** Evento do grupo que o usuario pode usar (restrito: so de uma das suas unidades). */
  private async loadEvent(organizationId: number, eventId: number, user: AuthenticatedUser | undefined) {
    const scope = await this.unitScope.resolve(user, organizationId);
    const event = await this.prisma.event.findFirst({ where: { id: eventId, organizationId } });
    if (!event || (isRestricted(scope) && (event.unitId == null || !scope.includes(event.unitId)))) {
      throw validationError({ eventId: 'Evento não encontrado.' });
    }
    return event;
  }

  private async uniqueSlug(title: string, tx: Prisma.TransactionClient | PrismaService = this.prisma): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const slug = generateSlug(title);
      if (!(await tx.registrationForm.findUnique({ where: { slug }, select: { id: true } }))) return slug;
    }
    throw new ConflictException('Não foi possível gerar o link do formulário; tente de novo.');
  }

  // -------------------------------------------------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------------------------------------------------

  templates() {
    return listTemplates();
  }

  async list(organizationId: number, query: ListRegistrationFormsQueryDto, user: AuthenticatedUser): Promise<Page<unknown>> {
    const and: Prisma.RegistrationFormWhereInput[] = [await this.scopeWhere(user, organizationId)];
    const q = query.q?.trim();
    if (q) and.push({ OR: [{ title: { contains: q, mode: 'insensitive' } }, { slug: { contains: q.toLowerCase() } }] });
    const where: Prisma.RegistrationFormWhereInput = {
      organizationId,
      ...(query.eventId ? { eventId: query.eventId } : {}),
      // Sem filtro de status, os arquivados ficam fora da lista (ver com status=ARCHIVED).
      status: query.status ?? { not: RegistrationFormStatus.ARCHIVED },
      AND: and,
    };
    const [rows, total] = await Promise.all([
      this.prisma.registrationForm.findMany({
        where,
        orderBy: [{ id: 'desc' }],
        ...pageArgs(query),
        include: { event: { select: { title: true } } },
      }),
      this.prisma.registrationForm.count({ where }),
    ]);
    const counts = rows.length
      ? await this.prisma.registrationSubmission.groupBy({
          by: ['formId', 'status'],
          where: { organizationId, formId: { in: rows.map((r) => r.id) } },
          _count: { _all: true },
        })
      : [];
    const items = rows.map((form) => {
      const mine = counts.filter((c) => c.formId === form.id);
      const by = (s: RegistrationSubmissionStatus) => mine.find((c) => c.status === s)?._count._all ?? 0;
      return {
        id: form.id,
        slug: form.slug,
        title: form.title,
        eventId: form.eventId,
        eventTitle: form.event?.title ?? null,
        status: form.status,
        paymentMode: form.paymentMode,
        priceCents: form.priceCents,
        submissionsCount: mine.reduce((sum, c) => sum + c._count._all, 0),
        pendingCount: by(RegistrationSubmissionStatus.PENDING),
        confirmedCount: by(RegistrationSubmissionStatus.CONFIRMED),
        opensAt: form.opensAt,
        closesAt: form.closesAt,
        // Link so depois da 1a publicacao (o slug do rascunho ainda pode mudar e o link daria 404).
        publicUrl: form.publishedAt ? publicFormUrl(form.slug) : null,
        createdAt: form.createdAt,
      };
    });
    return { items, total };
  }

  async get(organizationId: number, id: number, user: AuthenticatedUser, includeArchived = false) {
    return this.definition(await this.loadForm(organizationId, id, user), includeArchived);
  }

  /** Definicao completa (painel): configuracao + secoes + campos ordenados (arquivados so com includeArchived). */
  async definition(form: FormWithDefinition, includeArchived = false) {
    const submissionsCount = await this.prisma.registrationSubmission.count({ where: { formId: form.id } });
    return {
      id: form.id,
      slug: form.slug,
      slugLocked: form.publishedAt !== null,
      publicUrl: form.publishedAt ? publicFormUrl(form.slug) : null,
      title: form.title,
      intro: form.intro,
      bannerUrl: form.bannerUrl,
      status: form.status,
      eventId: form.eventId,
      eventTitle: form.event?.title ?? null,
      event: form.event ? { id: form.event.id, title: form.event.title, date: form.event.date, status: form.event.status } : null,
      opensAt: form.opensAt,
      closesAt: form.closesAt,
      maxSubmissions: form.maxSubmissions,
      allowWaitlist: form.allowWaitlist,
      paymentMode: form.paymentMode,
      priceCents: form.priceCents,
      pixKey: form.pixKey,
      pixKeyType: form.pixKeyType,
      pixBeneficiary: form.pixBeneficiary,
      requireApproval: form.requireApproval,
      confirmationMessage: form.confirmationMessage,
      consentText: form.consentText,
      consentEffectiveText: consentTextOf(form),
      consentVersion: form.consentVersion,
      retentionMonths: form.retentionMonths,
      publishedAt: form.publishedAt,
      closedAt: form.closedAt,
      archivedAt: form.archivedAt,
      createdAt: form.createdAt,
      updatedAt: form.updatedAt,
      submissionsCount,
      sections: form.sections.map((s) => ({ id: s.id, order: s.order, title: s.title, description: s.description })),
      fields: form.fields
        .filter((f) => includeArchived || !f.archived)
        .map((f) => ({
          id: f.id,
          key: f.key,
          sectionId: f.sectionId,
          order: f.order,
          type: f.type,
          label: f.label,
          helpText: f.helpText,
          required: f.required,
          options: f.options,
          validation: f.validation,
          showIf: f.showIf,
          mapsTo: f.mapsTo,
          archived: f.archived,
        })),
    };
  }

  async summary(organizationId: number, id: number, user: AuthenticatedUser) {
    const form = await this.loadForm(organizationId, id, user);
    const [byStatus, byPayment] = await Promise.all([
      this.prisma.registrationSubmission.groupBy({ by: ['status'], where: { formId: form.id }, _count: { _all: true } }),
      this.prisma.registrationSubmission.groupBy({
        by: ['paymentStatus'],
        where: { formId: form.id, status: { notIn: [RegistrationSubmissionStatus.CANCELLED, RegistrationSubmissionStatus.REJECTED] } },
        _count: { _all: true },
      }),
    ]);
    const statusCounts = Object.fromEntries(
      Object.values(RegistrationSubmissionStatus).map((s) => [s, byStatus.find((b) => b.status === s)?._count._all ?? 0]),
    ) as Record<RegistrationSubmissionStatus, number>;
    const paymentConfirmed = byPayment.find((b) => b.paymentStatus === RegistrationPaymentStatus.CONFIRMED)?._count._all ?? 0;
    const occupied = OCCUPYING_SUBMISSION_STATUSES.reduce((sum, s) => sum + statusCounts[s], 0);
    return {
      total: byStatus.reduce((sum, b) => sum + b._count._all, 0),
      byStatus: statusCounts,
      paymentPending: byPayment.find((b) => b.paymentStatus === RegistrationPaymentStatus.PENDING)?._count._all ?? 0,
      paymentConfirmed,
      // Valor vigente do formulario x pagamentos confirmados (o valor nao e gravado por inscricao nesta versao).
      paidCents: paymentConfirmed * (form.priceCents ?? 0),
      spotsLeft: formSpotsLeft(form.maxSubmissions, occupied),
      // Painel avisa quando a retencao NAO esta apagando de verdade (dry-run/false): o termo promete apagar.
      retention: { mode: formsRetentionModeLabel(), months: form.retentionMonths },
    };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Escrita
  // -------------------------------------------------------------------------------------------------------------

  async create(organizationId: number, dto: CreateRegistrationFormDto, user: AuthenticatedUser) {
    const event = dto.eventId ? await this.loadEvent(organizationId, dto.eventId, user) : null;
    // Equipe restrita a unidades so cria formulario de evento da sua unidade (nunca avulso/do grupo inteiro).
    if (!event && isRestricted(await this.unitScope.resolve(user, organizationId))) throw new ForbiddenException(UNIT_ACCESS_DENIED);
    const title = (dto.title?.trim() || event?.title || '').slice(0, 150);
    if (title.length < 2) throw validationError({ title: 'Informe o título do formulário (mínimo 2 caracteres).' });
    const template = dto.template ? FORM_TEMPLATES[dto.template as TemplateKey] : null;
    const eventPrice = event?.priceCents && event.priceCents > 0 ? event.priceCents : null;

    const form = await this.prisma.$transaction(async (tx) => {
      const created = await tx.registrationForm.create({
        data: {
          organizationId,
          eventId: event?.id ?? null,
          slug: await this.uniqueSlug(title, tx),
          title,
          intro: event?.description?.trim() || template?.intro || null,
          // Formulario publico: so banner https ou do proprio backend (imagem http do evento fica de fora).
          bannerUrl: safeBannerUrl(event?.imageUrl),
          closesAt: event?.registrationDeadline ?? null,
          maxSubmissions: event?.capacity ?? null,
          paymentMode: eventPrice || template?.paid ? RegistrationPaymentMode.PIX_MANUAL : RegistrationPaymentMode.NONE,
          priceCents: eventPrice,
          createdById: user.id,
        },
      });
      if (template) {
        let order = 0;
        for (const [sIndex, section] of template.sections.entries()) {
          const s = await tx.registrationFormSection.create({
            data: { formId: created.id, order: sIndex, title: section.title, description: section.description ?? null },
          });
          for (const f of section.fields) {
            await tx.registrationFormField.create({
              data: {
                formId: created.id,
                sectionId: s.id,
                key: f.key,
                order: order++,
                type: f.type,
                label: f.label,
                helpText: f.helpText ?? null,
                required: f.required ?? false,
                options: f.options ?? Prisma.DbNull,
                showIf: f.showIf ?? Prisma.DbNull,
                mapsTo: f.mapsTo ?? null,
              },
            });
          }
        }
      }
      await syncConsentSnapshot(tx, created.id);
      return created;
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.REGISTRATION_FORM_CREATE,
      entity: AuditEntity.REGISTRATION_FORM,
      entityId: form.id,
      meta: { template: dto.template ?? null, eventId: form.eventId },
    });
    return this.get(organizationId, form.id, user);
  }

  /**
   * Salva a definicao de forma ATOMICA (uma transacao): configuracao + secoes (upsert por id) + campos (upsert por
   * `key`). Campo que sai da definicao: se o formulario ja tem inscricoes vira `archived` (respostas preservadas),
   * senao e apagado. Formulario publicado (OPEN) continua tendo de cumprir os requisitos de publicacao.
   */
  async save(organizationId: number, id: number, dto: SaveRegistrationFormDto, user: AuthenticatedUser) {
    const form = await this.loadForm(organizationId, id, user);
    if (form.status === RegistrationFormStatus.ARCHIVED) throw invalidTransition('Formulário arquivado não pode ser editado.');
    if (dto.paymentMode === RegistrationPaymentMode.PIX_AUTO) throw paymentModeNotAvailable();
    const errors: FieldErrors = {};

    let eventId = form.eventId;
    if (dto.eventId !== undefined) {
      if (dto.eventId === null) {
        if (isRestricted(await this.unitScope.resolve(user, organizationId))) throw new ForbiddenException(UNIT_ACCESS_DENIED);
        eventId = null;
      } else {
        eventId = (await this.loadEvent(organizationId, dto.eventId, user)).id;
      }
    }
    // Inscricoes CONFIRMADAS ja tem participante no evento atual: trocar o evento deixaria esses participantes no
    // evento antigo e o formulario apontando para outro (409 FORM_HAS_CONFIRMED).
    if (eventId !== form.eventId) {
      const confirmed = await this.prisma.registrationSubmission.count({ where: { formId: form.id, status: RegistrationSubmissionStatus.CONFIRMED } });
      if (confirmed > 0) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: FormErrorCode.FORM_HAS_CONFIRMED,
          message: 'Este formulário já tem inscrições confirmadas no evento atual: não é possível trocar o evento. Duplique o formulário para outro evento.',
        });
      }
    }
    // Formulario publico: banner so https ou do proprio backend (/api/uploads/...).
    if (dto.bannerUrl && !safeBannerUrl(dto.bannerUrl)) {
      throw validationError({ bannerUrl: 'Use uma imagem enviada pelo GingApp ou um endereço https://.' });
    }
    const pick = <K extends keyof SaveRegistrationFormDto & keyof RegistrationForm>(k: K): RegistrationForm[K] =>
      (dto[k] === undefined ? form[k] : dto[k]) as RegistrationForm[K];
    const date = (v: string | null | undefined, current: Date | null) => (v === undefined ? current : v === null ? null : new Date(v));
    const opensAt = date(dto.opensAt, form.opensAt);
    const closesAt = date(dto.closesAt, form.closesAt);
    if (opensAt && closesAt && opensAt.getTime() >= closesAt.getTime()) errors.closesAt = 'O encerramento deve ser depois da abertura.';
    const title = dto.title === undefined ? form.title : dto.title.trim();
    if (title.length < 2) errors.title = 'Informe o título do formulário (mínimo 2 caracteres).';

    // ---- Definicao (secoes + campos andam juntos) ----
    const hasSections = dto.sections !== undefined;
    const hasFields = dto.fields !== undefined;
    if (hasSections !== hasFields) throw validationError({ fields: 'Envie "sections" e "fields" juntos (a definição inteira).' });
    let normalized: ReturnType<typeof validateFields>['fields'] = [];
    const fieldSection: Array<{ index: number | null; id: number | null }> = [];
    if (hasFields) {
      const existingSectionIds = new Set(form.sections.map((s) => s.id));
      dto.sections!.forEach((s, i) => {
        if (s.id !== undefined && !existingSectionIds.has(s.id)) errors[`sections[${i}]`] = 'Seção não encontrada neste formulário.';
        if (!s.title?.trim()) errors[`sections[${i}]`] = 'Informe o título da seção.';
      });
      const incomingIds = dto.sections!.map((s) => s.id ?? null);
      const raw: RawFieldInput[] = dto.fields!.map((f) => ({
        ...f,
        key: f.key?.trim() || `f_${randomBytes(5).toString('hex')}`,
      }));
      const result = validateFields(raw);
      Object.assign(errors, result.errors);
      normalized = result.fields;
      const hasSubmissions = (await this.prisma.registrationSubmission.count({ where: { formId: form.id } })) > 0;
      const existingByKey = new Map(form.fields.map((f) => [f.key, f]));
      dto.fields!.forEach((f, i) => {
        const key = raw[i].key!;
        let index: number | null = null;
        let sid: number | null = null;
        if (f.sectionIndex !== undefined && f.sectionIndex !== null) {
          if (f.sectionIndex >= dto.sections!.length) errors[key] = 'Seção do campo inválida.';
          else index = f.sectionIndex;
        } else if (f.sectionId !== undefined && f.sectionId !== null) {
          const at = incomingIds.indexOf(f.sectionId);
          if (at < 0) errors[key] = 'Seção do campo inválida.';
          else index = at;
          sid = f.sectionId;
        }
        fieldSection.push({ index, id: sid });
        const previous = existingByKey.get(key);
        if (previous && hasSubmissions && previous.type !== f.type && FIELD_KEY_REGEX.test(key) && !errors[key]) {
          errors[key] = 'Não é possível mudar o tipo de um campo que já tem respostas. Crie um campo novo.';
        }
      });
    }
    if (Object.keys(errors).length > 0) throw validationError(errors);

    const paymentMode = pick('paymentMode');
    const merged = {
      title,
      paymentMode,
      priceCents: pick('priceCents'),
      pixKey: pick('pixKey'),
      pixKeyType: pick('pixKeyType'),
      pixBeneficiary: pick('pixBeneficiary'),
      closesAt,
    };
    if (form.status === RegistrationFormStatus.OPEN) {
      const publishErrs = publishErrors({
        ...merged,
        fields: hasFields ? normalized : form.fields,
        closesAt: null, // prazo vencido num formulario ja aberto apenas o encerra (closedReason DEADLINE)
      });
      if (Object.keys(publishErrs).length > 0) {
        throw validationError(publishErrs, 'O formulário está publicado: corrija os campos indicados para salvar.');
      }
    }
    const consentText = dto.consentText === undefined ? form.consentText : dto.consentText?.trim() || null;
    let consentVersionBumped = false;

    await this.prisma.$transaction(
      async (tx) => {
        await tx.registrationForm.update({
          where: { id: form.id },
          data: {
            title,
            intro: dto.intro === undefined ? undefined : dto.intro?.trim() || null,
            bannerUrl: dto.bannerUrl === undefined ? undefined : dto.bannerUrl,
            eventId,
            opensAt,
            closesAt,
            maxSubmissions: dto.maxSubmissions === undefined ? undefined : dto.maxSubmissions,
            allowWaitlist: dto.allowWaitlist,
            paymentMode: dto.paymentMode,
            // 0 = gratuito (guardado como null), como em Event.priceCents.
            priceCents: dto.priceCents === undefined ? undefined : dto.priceCents || null,
            pixKey: dto.pixKey === undefined ? undefined : dto.pixKey?.trim() || null,
            pixKeyType: dto.pixKeyType,
            pixBeneficiary: dto.pixBeneficiary === undefined ? undefined : dto.pixBeneficiary?.trim() || null,
            requireApproval: dto.requireApproval,
            confirmationMessage: dto.confirmationMessage === undefined ? undefined : dto.confirmationMessage?.trim() || null,
            consentText,
            retentionMonths: dto.retentionMonths ?? undefined,
          },
        });
        // Texto efetivo do consentimento (termo/padrao com retentionMonths + rotulos dos CONSENT): snapshot novo e versao
        // + 1 quando muda. Sempre no fim da transacao (depois dos campos).
        const syncConsent = async () => {
          consentVersionBumped = (await syncConsentSnapshot(tx, form.id)).bumped;
        };
        if (!hasFields) return syncConsent();

        // Secoes: atualiza as que vieram com id, cria as novas, apaga as que sairam (campos ficam sem secao via FK).
        const sectionIds: number[] = [];
        for (const [i, s] of dto.sections!.entries()) {
          const data = { order: i, title: s.title.trim(), description: s.description?.trim() || null };
          if (s.id !== undefined) {
            await tx.registrationFormSection.update({ where: { id: s.id }, data });
            sectionIds.push(s.id);
          } else {
            sectionIds.push((await tx.registrationFormSection.create({ data: { formId: form.id, ...data } })).id);
          }
        }
        await tx.registrationFormSection.deleteMany({ where: { formId: form.id, id: { notIn: sectionIds } } });

        // Campos: upsert por key; os que sairam viram arquivados (se ha inscricoes) ou sao apagados.
        const hasSubmissions = (await tx.registrationSubmission.count({ where: { formId: form.id } })) > 0;
        for (const [i, f] of normalized.entries()) {
          const at = fieldSection[i].index;
          const data = {
            sectionId: at === null ? null : sectionIds[at],
            order: i,
            type: f.type,
            label: f.label,
            helpText: f.helpText,
            required: f.required,
            options: f.options ?? Prisma.DbNull,
            validation: f.validation ? (f.validation as Prisma.InputJsonObject) : Prisma.DbNull,
            showIf: f.showIf ? (f.showIf as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
            mapsTo: f.mapsTo,
            archived: false,
          };
          await tx.registrationFormField.upsert({
            where: { formId_key: { formId: form.id, key: f.key } },
            create: { formId: form.id, key: f.key, ...data },
            update: data,
          });
        }
        const keep = normalized.map((f) => f.key);
        if (hasSubmissions) {
          await tx.registrationFormField.updateMany({ where: { formId: form.id, key: { notIn: keep } }, data: { archived: true } });
        } else {
          await tx.registrationFormField.deleteMany({ where: { formId: form.id, key: { notIn: keep } } });
        }
        await syncConsent();
      },
      { timeout: 20_000, maxWait: 10_000 },
    );

    await this.audit.record({
      organizationId,
      action: AuditAction.REGISTRATION_FORM_UPDATE,
      entity: AuditEntity.REGISTRATION_FORM,
      entityId: form.id,
      // So os NOMES das configuracoes alteradas e contagens; nunca valores (a chave Pix pode ser um CPF).
      meta: {
        changed: Object.keys(dto).filter(
          (k) => !['sections', 'fields', 'consentVersion'].includes(k) && (dto as Record<string, unknown>)[k] !== undefined,
        ),
        sections: hasSections ? dto.sections!.length : undefined,
        fields: hasFields ? normalized.length : undefined,
        consentVersionBumped,
      },
    });
    return this.get(organizationId, form.id, user);
  }

  async open(organizationId: number, id: number, user: AuthenticatedUser) {
    const form = await this.loadForm(organizationId, id, user);
    if (form.status === RegistrationFormStatus.ARCHIVED) throw invalidTransition('Formulário arquivado não pode ser reaberto. Duplique-o.');
    if (form.status === RegistrationFormStatus.OPEN) return this.definition(form);
    if (form.paymentMode === RegistrationPaymentMode.PIX_AUTO) throw paymentModeNotAvailable();
    const errors = publishErrors({ ...form, fields: form.fields });
    if (Object.keys(errors).length > 0) throw validationError(errors, 'O formulário ainda não pode ser publicado.');
    const firstPublish = form.publishedAt === null;
    await this.prisma.$transaction(async (tx) => {
      await tx.registrationForm.update({
        where: { id: form.id },
        data: {
          status: RegistrationFormStatus.OPEN,
          closedAt: null,
          // Slug DEFINITIVO na 1a publicacao (a partir do titulo atual); depois nunca muda.
          ...(firstPublish ? { slug: await this.uniqueSlug(form.title, tx), publishedAt: new Date() } : {}),
        },
      });
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.REGISTRATION_FORM_OPEN,
      entity: AuditEntity.REGISTRATION_FORM,
      entityId: form.id,
      meta: { firstPublish },
    });
    return this.get(organizationId, form.id, user);
  }

  async close(organizationId: number, id: number, user: AuthenticatedUser) {
    const form = await this.loadForm(organizationId, id, user);
    if (form.status === RegistrationFormStatus.CLOSED) return this.definition(form);
    if (form.status !== RegistrationFormStatus.OPEN) throw invalidTransition('Só um formulário publicado pode ser encerrado.');
    await this.prisma.registrationForm.update({ where: { id: form.id }, data: { status: RegistrationFormStatus.CLOSED, closedAt: new Date() } });
    await this.audit.record({ organizationId, action: AuditAction.REGISTRATION_FORM_CLOSE, entity: AuditEntity.REGISTRATION_FORM, entityId: form.id });
    return this.get(organizationId, form.id, user);
  }

  async archive(organizationId: number, id: number, user: AuthenticatedUser) {
    const form = await this.loadForm(organizationId, id, user);
    if (form.status === RegistrationFormStatus.ARCHIVED) return this.definition(form, false);
    await this.prisma.registrationForm.update({
      where: { id: form.id },
      data: { status: RegistrationFormStatus.ARCHIVED, archivedAt: new Date() },
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.REGISTRATION_FORM_ARCHIVE,
      entity: AuditEntity.REGISTRATION_FORM,
      entityId: form.id,
      meta: { from: form.status },
    });
    return this.get(organizationId, form.id, user);
  }

  /** Copia configuracao + secoes + campos ATIVOS num RASCUNHO novo (sem evento: o Mestre liga ao evento novo). */
  async duplicate(organizationId: number, id: number, user: AuthenticatedUser) {
    const source = await this.loadForm(organizationId, id, user);
    const restricted = isRestricted(await this.unitScope.resolve(user, organizationId));
    const title = `Cópia de ${source.title}`.slice(0, 150);
    const copy = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.registrationForm.create({
          data: {
            organizationId,
            // Equipe restrita mantem o evento (senao o formulario sairia do escopo dela).
            eventId: restricted ? source.eventId : null,
            slug: await this.uniqueSlug(title, tx),
            title,
            intro: source.intro,
            bannerUrl: source.bannerUrl,
            maxSubmissions: source.maxSubmissions,
            allowWaitlist: source.allowWaitlist,
            paymentMode: source.paymentMode,
            priceCents: source.priceCents,
            pixKey: source.pixKey,
            pixKeyType: source.pixKeyType,
            pixBeneficiary: source.pixBeneficiary,
            requireApproval: source.requireApproval,
            confirmationMessage: source.confirmationMessage,
            consentText: source.consentText,
            retentionMonths: source.retentionMonths,
            createdById: user.id,
          },
        });
        const sectionMap = new Map<number, number>();
        for (const s of source.sections) {
          const n = await tx.registrationFormSection.create({
            data: { formId: created.id, order: s.order, title: s.title, description: s.description },
          });
          sectionMap.set(s.id, n.id);
        }
        let order = 0;
        for (const f of source.fields.filter((x) => !x.archived)) {
          await tx.registrationFormField.create({
            data: {
              formId: created.id,
              sectionId: f.sectionId ? (sectionMap.get(f.sectionId) ?? null) : null,
              key: f.key,
              order: order++,
              type: f.type,
              label: f.label,
              helpText: f.helpText,
              required: f.required,
              options: f.options ?? Prisma.DbNull,
              validation: f.validation ?? Prisma.DbNull,
              showIf: f.showIf ?? Prisma.DbNull,
              mapsTo: f.mapsTo,
            },
          });
        }
        await syncConsentSnapshot(tx, created.id);
        return created;
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
    await this.audit.record({
      organizationId,
      action: AuditAction.REGISTRATION_FORM_DUPLICATE,
      entity: AuditEntity.REGISTRATION_FORM,
      entityId: copy.id,
      meta: { sourceFormId: source.id },
    });
    return this.get(organizationId, copy.id, user);
  }

  /** Exclui de verdade SO sem inscricoes (senao 409 FORM_HAS_SUBMISSIONS: use arquivar). Anexos pendentes vao junto. */
  async remove(organizationId: number, id: number, user: AuthenticatedUser): Promise<void> {
    const form = await this.loadForm(organizationId, id, user);
    if ((await this.prisma.registrationSubmission.count({ where: { formId: form.id } })) > 0) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: FormErrorCode.FORM_HAS_SUBMISSIONS,
        message: 'Este formulário já tem inscrições: arquive-o em vez de excluir.',
      });
    }
    const files = await this.prisma.registrationSubmissionFile.findMany({ where: { formId: form.id }, select: { storageKey: true } });
    await this.prisma.registrationForm.delete({ where: { id: form.id } }); // secoes, campos e anexos em cascata
    for (const f of files) await deletePrivateFile(f.storageKey).catch(() => undefined);
    await this.audit.record({
      organizationId,
      action: AuditAction.REGISTRATION_FORM_DELETE,
      entity: AuditEntity.REGISTRATION_FORM,
      entityId: form.id,
      meta: { title: form.title },
    });
  }
}
