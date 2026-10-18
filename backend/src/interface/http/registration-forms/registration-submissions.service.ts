import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  RegistrationFormField,
  RegistrationPaymentStatus,
  RegistrationSubmission,
  RegistrationSubmissionFile,
  RegistrationSubmissionStatus,
} from '@prisma/client';
import { AuditAction, AuditActionCode, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { CSV_BOM, CSV_EOL, CSV_SEPARATOR, csvCell } from '../../../shared/csv/csv';
import { formatInstantBR } from '../../../shared/dates/format-br';
import { isMestre } from '../../../shared/guards/mestre-only.guard';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { pageArgs, DEFAULT_PAGE_SIZE } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ExportSubmissionsQueryDto, ListSubmissionsQueryDto } from './dto/registration-form.dto';
import { formFullError, invalidTransition, validationError } from './form-codes';
import { isEncryptedCpf, isFormFull, maskDocument, OCCUPYING_SUBMISSION_STATUSES } from './form-common';
import { deletePrivateFile, privateFilePath } from './private-storage';
import { ApplicantNotice, RegistrationEffectsService } from './registration-effects.service';
import { RegistrationFormsService } from './registration-forms.service';
import { anonymizeSubmissions } from './submission-purge';

/** Destino do CSV em stream (o controller liga na resposta HTTP). `write` devolve false se o cliente desistiu. */
export interface CsvSink {
  start(filename: string, total: number): void;
  write(chunk: string): Promise<boolean>;
}

export type SubmissionAction = 'confirm-payment' | 'approve' | 'reject' | 'cancel' | 'waitlist' | 'promote';

const ACTION_AUDIT: Record<SubmissionAction, AuditActionCode> = {
  'confirm-payment': AuditAction.REGISTRATION_SUBMISSION_CONFIRM_PAYMENT,
  approve: AuditAction.REGISTRATION_SUBMISSION_APPROVE,
  reject: AuditAction.REGISTRATION_SUBMISSION_REJECT,
  cancel: AuditAction.REGISTRATION_SUBMISSION_CANCEL,
  waitlist: AuditAction.REGISTRATION_SUBMISSION_WAITLIST,
  promote: AuditAction.REGISTRATION_SUBMISSION_PROMOTE,
};

const STATUS_LABEL: Record<RegistrationSubmissionStatus, string> = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmada',
  WAITLIST: 'Lista de espera',
  REJECTED: 'Recusada',
  CANCELLED: 'Cancelada',
};
const PAYMENT_LABEL: Record<RegistrationPaymentStatus, string> = {
  NOT_REQUIRED: 'Não se aplica',
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
};

/** Campos do resumo da linha (nada de documento/contato: esses ja tem coluna propria). */
const SUMMARY_MAPS = ['nickname', 'cord', 'group', 'city', 'teacher'];
/** Historico da inscricao: acao da auditoria -> codigo curto (as de LEITURA ficam fora). */
const TIMELINE_CODES: Record<string, string> = {
  [AuditAction.REGISTRATION_SUBMISSION_CREATE]: 'SUBMITTED',
  [AuditAction.REGISTRATION_SUBMISSION_CONFIRM_PAYMENT]: 'PAYMENT_CONFIRMED',
  [AuditAction.REGISTRATION_SUBMISSION_APPROVE]: 'APPROVED',
  [AuditAction.REGISTRATION_SUBMISSION_REJECT]: 'REJECTED',
  [AuditAction.REGISTRATION_SUBMISSION_CANCEL]: 'CANCELLED',
  [AuditAction.REGISTRATION_SUBMISSION_WAITLIST]: 'WAITLISTED',
  [AuditAction.REGISTRATION_SUBMISSION_PROMOTE]: 'PROMOTED',
  [AuditAction.REGISTRATION_SUBMISSION_NOTE]: 'NOTE_UPDATED',
  [AuditAction.REGISTRATION_SUBMISSION_ANONYMIZE]: 'ANONYMIZED',
};

const NOT_FOUND = 'Inscrição não encontrada.';
/** Linhas por consulta do CSV em stream (cursor por id): memoria constante, qualquer tamanho de formulario. */
export const CSV_CHUNK_SIZE = 500;

type Stored = Record<string, unknown>;

/** Resposta guardada de um campo SEM ler o prototipo (chaves como "constructor" nunca viram funcao). */
function storedAnswer(answers: Stored | null | undefined, key: string): unknown {
  return answers && typeof answers === 'object' && Object.hasOwn(answers, key) ? answers[key] : undefined;
}

function submissionWhere(formId: number, organizationId: number, query: { status?: RegistrationSubmissionStatus; paymentStatus?: RegistrationPaymentStatus; q?: string }): Prisma.RegistrationSubmissionWhereInput {
  const q = query.q?.trim();
  return {
    formId,
    organizationId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q.toLowerCase() } },
            { protocol: { contains: q.toUpperCase() } },
          ],
        }
      : {}),
  };
}

/**
 * Inscricoes - lado ADMIN (painel): lista, detalhe (auditado), acoes de situacao/pagamento, nota interna, anexo
 * privado (auditado) e CSV (auditado). Formulario sempre carregado por RegistrationFormsService.loadForm (organizacao
 * do token + escopo); inscricao/anexo de outro formulario = 404.
 */
@Injectable()
export class RegistrationSubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly forms: RegistrationFormsService,
    private readonly effects: RegistrationEffectsService,
  ) {}

  async list(organizationId: number, formId: number, query: ListSubmissionsQueryDto, user: AuthenticatedUser) {
    const form = await this.forms.loadForm(organizationId, formId, user);
    const q = query.q?.trim();
    const where = submissionWhere(form.id, organizationId, query);
    const [rows, total] = await Promise.all([
      this.prisma.registrationSubmission.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
        include: { _count: { select: { files: true } } },
      }),
      this.prisma.registrationSubmission.count({ where }),
    ]);
    const summaryFields = SUMMARY_MAPS.map((m) => form.fields.find((f) => f.mapsTo === m)).filter((f): f is RegistrationFormField => !!f);
    // Listar = ver dado pessoal (nome/e-mail/telefone): uma linha de auditoria por consulta, sem o texto buscado.
    await this.audit.record({
      organizationId,
      action: AuditAction.REGISTRATION_SUBMISSION_LIST,
      entity: AuditEntity.REGISTRATION_FORM,
      entityId: form.id,
      meta: {
        rows: rows.length,
        total,
        status: query.status ?? null,
        paymentStatus: query.paymentStatus ?? null,
        searched: !!q,
        offset: query.offset ?? 0,
      },
    });
    return {
      items: rows.map((s) => ({
        id: s.id,
        protocol: s.protocol,
        status: s.status,
        paymentStatus: s.paymentStatus,
        name: s.name,
        email: s.email,
        phone: s.phone,
        createdAt: s.createdAt,
        hasFiles: s._count.files > 0,
        summary: this.summaryOf(s.answers as Stored, summaryFields),
      })),
      total,
      limit: query.limit ?? DEFAULT_PAGE_SIZE,
      offset: query.offset ?? 0,
    };
  }

  private summaryOf(answers: Stored, fields: RegistrationFormField[]): string | null {
    const parts = fields
      .map((f) => storedAnswer(answers, f.key))
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .slice(0, 3);
    return parts.length ? parts.join(' · ').slice(0, 200) : null;
  }

  private async loadSubmission(formId: number, organizationId: number, sid: number) {
    const s = await this.prisma.registrationSubmission.findFirst({ where: { id: sid, formId, organizationId }, include: { files: true } });
    if (!s) throw new NotFoundException(NOT_FOUND);
    return s;
  }

  /**
   * Detalhe completo (respostas com rotulo, anexos, CPF MASCARADO, historico). Visualizacao auditada. Anexos (comprovante
   * /documento) so para o MESTRE: os demais recebem `files: []` + `filesRestricted: true` (e as respostas de arquivo vazias).
   */
  async detail(organizationId: number, formId: number, sid: number, user: AuthenticatedUser, auditView = true) {
    const form = await this.forms.loadForm(organizationId, formId, user);
    const s = await this.loadSubmission(form.id, organizationId, sid);
    const filesRestricted = !isMestre(user);
    if (auditView) {
      await this.audit.record({
        organizationId,
        action: AuditAction.REGISTRATION_SUBMISSION_VIEW,
        entity: AuditEntity.REGISTRATION_SUBMISSION,
        entityId: s.id,
        meta: { formId: form.id },
      });
    }
    const timeline = await this.prisma.auditLog.findMany({
      where: {
        organizationId,
        resource: AuditEntity.REGISTRATION_SUBMISSION,
        resourceId: String(s.id),
        action: { in: Object.keys(TIMELINE_CODES) },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { action: true, createdAt: true, userId: true, user: { select: { name: true } } },
      take: 200,
    });
    // Sugestao (CPF do envio = aluno ATIVO do grupo): so enquanto o Mestre nao ligou ninguem.
    const suggested =
      s.suggestedStudentId && !s.studentId && !s.anonymizedAt
        ? await this.prisma.student.findFirst({ where: { id: s.suggestedStudentId, organizationId }, select: { id: true, name: true } })
        : null;
    const visible = filesRestricted ? { ...s, files: [] } : s;
    return {
      id: s.id,
      formId: form.id,
      protocol: s.protocol,
      status: s.status,
      paymentStatus: s.paymentStatus,
      name: s.name,
      email: s.email,
      phone: s.phone,
      document: maskDocument(s.documentLast4),
      consentAt: s.consentAt,
      consentVersion: s.consentVersion,
      eventParticipantId: s.eventParticipantId,
      studentId: s.studentId,
      suggestedStudent: suggested ? { id: suggested.id, name: suggested.name } : null,
      reviewedAt: s.reviewedAt,
      reviewNote: s.reviewNote,
      internalNote: s.internalNote,
      anonymizedAt: s.anonymizedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      answers: this.renderAnswers(form.fields, visible),
      files: visible.files.map((f) => ({ id: f.id, fieldKey: f.fieldKey, originalName: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes })),
      filesRestricted,
      timeline: timeline
        .filter((t) => TIMELINE_CODES[t.action] !== undefined)
        .map((t) => ({ at: t.createdAt, action: TIMELINE_CODES[t.action], by: t.user?.name ?? null, userId: t.userId })),
    };
  }

  /** Uma linha por campo com resposta (campos arquivados com resposta tambem). CPF sempre mascarado. */
  private renderAnswers(fields: RegistrationFormField[], s: RegistrationSubmission & { files: RegistrationSubmissionFile[] }) {
    const answers = (s.answers ?? {}) as Stored;
    return fields
      .filter((f) => f.type !== 'INFO' && (!f.archived || storedAnswer(answers, f.key) !== undefined))
      .map((f) => ({
        fieldKey: f.key,
        label: f.label,
        type: f.type,
        archived: f.archived,
        value: this.renderValue(storedAnswer(answers, f.key), s),
      }));
  }

  private renderValue(stored: unknown, s: RegistrationSubmission & { files: RegistrationSubmissionFile[] }): unknown {
    if (stored === undefined || stored === null) return null;
    if (typeof stored === 'object' && !Array.isArray(stored)) {
      const ref = (stored as { ref?: string }).ref;
      if (ref === 'document') return maskDocument(s.documentLast4);
      if (ref === 'email') return s.email;
      if (ref === 'phone') return s.phone;
      if (isEncryptedCpf(stored)) return maskDocument(stored.last4);
      const ids = (stored as { fileIds?: unknown }).fileIds;
      if (Array.isArray(ids)) {
        return s.files.filter((f) => ids.includes(f.id)).map((f) => ({ fileId: f.id, originalName: f.originalName, mimeType: f.mimeType }));
      }
      return null;
    }
    return stored;
  }

  /**
   * Transicoes de situacao/pagamento. Idempotentes (repetir = 200 sem efeito novo); transicao invalida = 409
   * INVALID_TRANSITION. Linha do formulario travada (FOR UPDATE): "promover" nunca estoura maxSubmissions.
   */
  async act(
    organizationId: number,
    formId: number,
    sid: number,
    action: SubmissionAction,
    user: AuthenticatedUser,
    reason?: string | null,
    linkStudentId?: number,
  ) {
    const form = await this.forms.loadForm(organizationId, formId, user);
    if (linkStudentId !== undefined && action !== 'approve' && action !== 'confirm-payment') {
      throw validationError({ linkStudentId: 'O vínculo com o aluno só vale ao aprovar ou confirmar o pagamento.' });
    }
    const outcome = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "RegistrationForm" WHERE id = ${form.id} FOR UPDATE`;
        const s = await tx.registrationSubmission.findFirst({ where: { id: sid, formId: form.id, organizationId } });
        if (!s) throw new NotFoundException(NOT_FOUND);
        if (s.anonymizedAt) throw invalidTransition('Inscrição anonimizada (retenção/LGPD): não pode mais ser alterada.');
        const S = RegistrationSubmissionStatus;
        const P = RegistrationPaymentStatus;
        const final = s.status === S.REJECTED || s.status === S.CANCELLED;
        let status = s.status;
        let paymentStatus = s.paymentStatus;
        let notice: ApplicantNotice | null = null;

        switch (action) {
          case 'confirm-payment':
            if (paymentStatus === P.CONFIRMED) break;
            if (paymentStatus === P.NOT_REQUIRED) throw invalidTransition('Esta inscrição não tem pagamento a confirmar.');
            if (final) throw invalidTransition('Inscrição recusada ou cancelada.');
            paymentStatus = P.CONFIRMED;
            if (status === S.PENDING && !form.requireApproval) status = S.CONFIRMED;
            break;
          case 'approve':
            if (status === S.CONFIRMED) break;
            if (status !== S.PENDING) throw invalidTransition('Só inscrições pendentes podem ser aprovadas (lista de espera: use "promover").');
            status = S.CONFIRMED;
            break;
          case 'reject':
            if (status === S.REJECTED) break;
            if (status === S.CANCELLED) throw invalidTransition('Inscrição cancelada.');
            status = S.REJECTED;
            // Pagamento que ainda nao veio deixa de ser cobrado (pago/CONFIRMED fica registrado: pode haver estorno).
            if (paymentStatus === P.PENDING) paymentStatus = P.NOT_REQUIRED;
            break;
          case 'cancel':
            if (status === S.CANCELLED) break;
            if (status === S.REJECTED) throw invalidTransition('Inscrição recusada.');
            status = S.CANCELLED;
            if (paymentStatus === P.PENDING) paymentStatus = P.NOT_REQUIRED;
            break;
          case 'waitlist':
            if (status === S.WAITLIST) break;
            if (final) throw invalidTransition('Inscrição recusada ou cancelada.');
            status = S.WAITLIST;
            break;
          case 'promote': {
            if (status === S.PENDING || status === S.CONFIRMED) break;
            if (status !== S.WAITLIST) throw invalidTransition('Só inscrições da lista de espera podem ser promovidas.');
            const occupied = await tx.registrationSubmission.count({ where: { formId: form.id, status: { in: OCCUPYING_SUBMISSION_STATUSES } } });
            if (isFormFull(form.maxSubmissions, occupied)) throw formFullError();
            // Vaga garantida; continua PENDENTE se ainda falta o pagamento ou a aprovacao.
            status = paymentStatus === P.PENDING || form.requireApproval ? S.PENDING : S.CONFIRMED;
            break;
          }
        }
        // Vinculo com a ficha: so acao EXPLICITA do Mestre (o envio anonimo nunca liga), em inscricao nao recusada/cancelada.
        const link = linkStudentId !== undefined && linkStudentId !== s.studentId;
        if (link && (status === S.REJECTED || status === S.CANCELLED)) throw invalidTransition('Inscrição recusada ou cancelada.');
        const changed = status !== s.status || paymentStatus !== s.paymentStatus;
        if (!changed && !link) return { changed: false as const, linked: false, from: s.status, to: status, paymentStatus, notice, s };
        if (status !== s.status) {
          notice =
            status === S.CONFIRMED ? 'CONFIRMED' : status === S.REJECTED ? 'REJECTED' : status === S.CANCELLED ? 'CANCELLED' : status === S.WAITLIST ? 'WAITLIST' : null;
        }
        if (changed) {
          await tx.registrationSubmission.update({
            where: { id: s.id },
            data: {
              status,
              paymentStatus,
              reviewedById: user.id,
              reviewedAt: new Date(),
              ...(action === 'reject' ? { reviewNote: reason?.trim() || null } : {}),
            },
          });
        }
        let current = { id: s.id, organizationId, name: s.name, studentId: s.studentId, eventParticipantId: s.eventParticipantId };
        if (link) current = await this.effects.linkStudent(tx, current, form.eventId, linkStudentId!);
        if (status === S.CONFIRMED) {
          // Respeita Event.capacity: evento lotado = 409 (nada muda; o Mestre aumenta as vagas ou usa a lista de espera).
          await this.effects.ensureParticipant(tx, current, form.eventId);
        } else if (s.status === S.CONFIRMED || current.eventParticipantId) {
          await this.effects.releaseParticipant(tx, current);
        }
        return { changed: changed as boolean, linked: link, from: s.status, to: status, paymentStatus, notice, s };
      },
      { timeout: 15_000, maxWait: 10_000 },
    );

    if (outcome.changed || outcome.linked) {
      await this.audit.record({
        organizationId,
        action: ACTION_AUDIT[action],
        entity: AuditEntity.REGISTRATION_SUBMISSION,
        entityId: sid,
        meta: {
          formId: form.id,
          from: outcome.from,
          to: outcome.to,
          paymentStatus: outcome.paymentStatus,
          withReason: action === 'reject' && !!reason?.trim(),
          linkedStudentId: outcome.linked ? linkStudentId : undefined,
        },
      });
      if (outcome.notice) {
        await this.effects.notifyApplicant(outcome.s.email, outcome.notice, { formTitle: form.title, protocol: outcome.s.protocol, slug: form.slug });
      }
    }
    return this.detail(organizationId, form.id, sid, user, false);
  }

  async updateNote(organizationId: number, formId: number, sid: number, internalNote: string | null | undefined, user: AuthenticatedUser) {
    const form = await this.forms.loadForm(organizationId, formId, user);
    const s = await this.loadSubmission(form.id, organizationId, sid);
    if (internalNote !== undefined && !s.anonymizedAt) {
      await this.prisma.registrationSubmission.update({ where: { id: s.id }, data: { internalNote: internalNote?.trim() || null } });
      await this.audit.record({
        organizationId,
        action: AuditAction.REGISTRATION_SUBMISSION_NOTE,
        entity: AuditEntity.REGISTRATION_SUBMISSION,
        entityId: s.id,
        meta: { formId: form.id, length: internalNote?.trim().length ?? 0 },
      });
    }
    return this.detail(organizationId, form.id, sid, user, false);
  }

  /** Anexo privado de uma inscricao deste formulario/grupo (auditado). null = 404. */
  async file(organizationId: number, formId: number, sid: number, fileId: number, user: AuthenticatedUser) {
    const form = await this.forms.loadForm(organizationId, formId, user);
    const file = await this.prisma.registrationSubmissionFile.findFirst({
      where: { id: fileId, formId: form.id, organizationId, submissionId: sid, submission: { formId: form.id, organizationId } },
    });
    const fullPath = file ? privateFilePath(file.storageKey) : null;
    if (!file || !fullPath) throw new NotFoundException('Arquivo não encontrado.');
    await this.audit.record({
      organizationId,
      action: AuditAction.REGISTRATION_FILE_VIEW,
      entity: AuditEntity.REGISTRATION_SUBMISSION,
      entityId: sid,
      meta: { formId: form.id, fileId: file.id, mimeType: file.mimeType },
    });
    return { fullPath, mimeType: file.mimeType, originalName: file.originalName };
  }

  /**
   * Anonimizacao MANUAL de uma inscricao pelo Mestre (pedido do titular SEM conta no GingApp, LGPD art. 18): mesmo SSOT
   * da retencao/exclusao (anonymizeSubmissions: respostas, contato, CPF, notas, anexos e o nome no participante do
   * evento), anexos apagados do disco depois do commit, auditado (so ids/contagens). Idempotente: ja anonimizada = 200
   * com o detalhe, sem nova auditoria.
   */
  async anonymize(organizationId: number, formId: number, sid: number, user: AuthenticatedUser) {
    const form = await this.forms.loadForm(organizationId, formId, user);
    const s = await this.loadSubmission(form.id, organizationId, sid);
    if (!s.anonymizedAt) {
      const purged = await this.prisma.$transaction((tx) => anonymizeSubmissions(tx, { id: s.id, formId: form.id, organizationId }, new Date()), {
        timeout: 20_000,
        maxWait: 10_000,
      });
      let deleted = 0;
      for (const key of purged.storageKeys) if (await deletePrivateFile(key).catch(() => false)) deleted += 1;
      if (purged.count > 0) {
        await this.audit.record({
          organizationId,
          action: AuditAction.REGISTRATION_SUBMISSION_ANONYMIZE,
          entity: AuditEntity.REGISTRATION_SUBMISSION,
          entityId: s.id,
          meta: { formId: form.id, files: deleted, participants: purged.participants },
        });
      }
    }
    return this.detail(organizationId, form.id, sid, user, false);
  }

  /**
   * CSV em STREAM (BOM UTF-8, ";", CRLF, celulas de formula neutralizadas - shared/csv): lotes de CSV_CHUNK_SIZE linhas
   * por cursor (id), memoria constante; mesmos filtros da lista (status, paymentStatus, q). CPF SEMPRE mascarado. Uma
   * coluna por campo (rotulo). Erros de permissao/404 acontecem ANTES do primeiro byte. Auditado (so contagens).
   */
  async exportCsv(
    organizationId: number,
    formId: number,
    user: AuthenticatedUser,
    query: ExportSubmissionsQueryDto,
    out: CsvSink,
  ): Promise<{ rows: number; total: number }> {
    const form = await this.forms.loadForm(organizationId, formId, user);
    const where = submissionWhere(form.id, organizationId, query);
    const total = await this.prisma.registrationSubmission.count({ where });
    const columns = form.fields.filter((f) => f.type !== 'INFO');
    const headers = [
      'Protocolo',
      'Data',
      'Situação',
      'Pagamento',
      'Nome',
      'E-mail',
      'Telefone',
      'CPF',
      ...columns.map((f) => (f.archived ? `${f.label} (removido)` : f.label).slice(0, 200)),
    ];
    const line = (cells: readonly unknown[]) => cells.map(csvCell).join(CSV_SEPARATOR) + CSV_EOL;
    out.start(`inscricoes-${form.slug}.csv`, total);
    await out.write(CSV_BOM + line(headers));
    let rows = 0;
    let cursor: number | null = null;
    for (;;) {
      const batch: Array<RegistrationSubmission & { files: RegistrationSubmissionFile[] }> = await this.prisma.registrationSubmission.findMany({
        where,
        orderBy: { id: 'asc' },
        take: CSV_CHUNK_SIZE,
        ...(cursor !== null ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { files: true },
      });
      if (batch.length === 0) break;
      let chunk = '';
      for (const s of batch) {
        chunk += line([
          s.protocol,
          formatInstantBR(s.createdAt),
          STATUS_LABEL[s.status],
          PAYMENT_LABEL[s.paymentStatus],
          s.name,
          s.email,
          s.phone,
          maskDocument(s.documentLast4),
          ...columns.map((f) => this.csvValue(this.renderValue(storedAnswer(s.answers as Stored, f.key), s))),
        ]);
      }
      if (!(await out.write(chunk))) break; // cliente desistiu do download
      rows += batch.length;
      cursor = batch[batch.length - 1].id;
      if (batch.length < CSV_CHUNK_SIZE) break;
    }
    await this.audit.record({
      organizationId,
      action: AuditAction.REGISTRATION_EXPORT,
      entity: AuditEntity.REGISTRATION_FORM,
      entityId: form.id,
      meta: { rows, total, status: query.status ?? null, paymentStatus: query.paymentStatus ?? null, searched: !!query.q?.trim() },
    });
    return { rows, total };
  }

  private csvValue(value: unknown): string | number | boolean | null {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) {
      return value.map((v) => (typeof v === 'object' && v !== null ? String((v as { originalName?: string }).originalName ?? '') : String(v))).join(', ');
    }
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value;
    return String(value);
  }
}
