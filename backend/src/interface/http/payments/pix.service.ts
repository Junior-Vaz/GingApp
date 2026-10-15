import { ConflictException, HttpException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FinancialRecord, FinancialStatus, PaidVia, PaymentMethod, Prisma } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { KeyedMutex } from '../../../shared/payments/keyed-mutex';
import {
  MP_PIX_MIN_AMOUNT_CENTS,
  buildExternalReference,
  parseExternalReference,
} from '../../../shared/payments/mercadopago.mapping';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
  PaymentProviderError,
  ProviderPayment,
} from '../../../shared/payments/payment-provider.interface';
import { PixInvalidationReason, PixLifecycleHooks } from '../../../shared/payments/pix-lifecycle.hooks';
import {
  PIX_EXPIRATION_MINUTES,
  PIX_REUSE_MIN_REMAINING_MS,
  applicationFeeCents,
  fallbackPayerEmail,
  isValidEmail,
  testModeAllowed,
  webhookNotificationUrl,
} from '../../../shared/payments/payments.config';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { FinanceCollectionService } from '../finance/finance-collection.service';
import { brl } from '../finance/finance-overdue.service';
import { PIX_OPEN_GATEWAY_STATUSES, PixViewStatus, pixStatusOf } from '../finance/finance-record.view';
import { civilTodayStart } from '../finance/finance.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StudentsService } from '../students/students.service';
import { ConnectedAccount, PaymentAccountService } from './payment-account.service';
import { PaymentErrorCode, paymentError, providerHttpError } from './payment-errors';

/** Resposta de POST/GET /finance/:id/pix e /finance/me/:id/pix (contrato de PLANO_PROJETO.md 10.52). */
export interface PixView {
  financeRecordId: number;
  amountCents: number;
  status: PixViewStatus;
  /** Copia-e-cola / imagem / link: SO enquanto PENDING (pago/vencido/cancelado = null, nada para pagar). */
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string;
  generatedAt: string;
}

export type PaymentEventSource = 'WEBHOOK' | 'SYNC' | 'RECONCILE';

/** Resultado da aplicacao de um pagamento do provedor a um lancamento (gravado em PaymentWebhookEvent.outcome). */
export type ApplyOutcome =
  | 'PAID'
  | 'DUPLICATE'
  | 'ALREADY_APPLIED'
  | 'PAID_CONFLICT'
  | 'AMOUNT_MISMATCH'
  | 'PENDING'
  | 'CANCELLED'
  | 'REFUND_ALERT'
  | 'STALE'
  | 'FOREIGN_REFERENCE'
  | 'FOREIGN_COLLECTOR'
  | 'RECORD_NOT_FOUND'
  /** Pagamento APROVADO cujo lancamento nao existe mais (apagado): alerta ao Mestre (dinheiro recebido sem lancamento). */
  | 'ORPHAN_PAID'
  /** Pagamento de TESTE (live_mode=false) em producao sem PAYMENTS_ALLOW_TEST_ACCOUNTS: nunca da baixa. */
  | 'TEST_MODE'
  | 'IGNORED';

type RecordWithPeople = Prisma.FinancialRecordGetPayload<{
  include: {
    student: {
      select: {
        name: true;
        email: true;
        user: { select: { email: true } };
        guardians: { select: { email: true; user: { select: { email: true } } } };
      };
    };
  };
}>;

const RECORD_INCLUDE = {
  student: {
    select: {
      name: true,
      email: true,
      user: { select: { email: true } },
      guardians: { select: { email: true, user: { select: { email: true } } }, orderBy: { id: 'asc' as const } },
    },
  },
} satisfies Prisma.FinancialRecordInclude;

const OPEN = [FinancialStatus.PENDING, FinancialStatus.OVERDUE];
/** Reconciliacao: so Pix gerado ha mais que isto (o webhook normalmente chega antes). */
const RECONCILE_MIN_AGE_MS = 5 * 60 * 1000;
/**
 * Pix que o PROVEDOR ainda diz "pendente" tanto tempo depois da validade = vencido localmente (sai da fila). Nunca sem
 * resposta do provedor (conta indisponivel/erro = continua na fila - achado A1-b).
 */
const RECONCILE_EXPIRED_GRACE_MS = 30 * 60 * 1000;
export const RECONCILE_BATCH_SIZE = 50;
/** Intervalo minimo entre duas conferencias do MESMO Pix pela reconciliacao (fila justa por pixLastCheckedAt). */
export const RECONCILE_RECHECK_MS = 5 * 60 * 1000;
/** GET /pix tambem confere no provedor Pix EXPIRADO ha menos que isto (pagamento no ultimo minuto - achado A1-c). */
const SYNC_EXPIRED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Cache da consulta ao provedor por pagamento no GET /pix (o polling de 5 s nao bate no provedor a cada chamada). */
export const PIX_SYNC_CACHE_MS = 12_000;
/** Status locais de Pix ainda nao confirmados como encerrados pelo provedor (conferir antes de gerar outro - B11). */
const UNSETTLED_GATEWAY_STATUSES = [...PIX_OPEN_GATEWAY_STATUSES, 'expired'];

/**
 * Pix de mensalidade na conta do provedor DO GRUPO (PLANO_PROJETO.md 10.52): gerar (reaproveitando o pendente valido -
 * idempotente), consultar (sincronizando o pendente) e APLICAR o que o provedor disse (webhook, sincronizacao e
 * reconciliacao passam pelo mesmo applyProviderPayment). A baixa e SEMPRE o FinanceCollectionService.pay (SSOT).
 *
 * Regras de dinheiro: valor SEMPRE do lancamento no servidor; external_reference `gingapp:<org>:<lancamento>` so e
 * confiada depois de buscar o pagamento no provedor COM O TOKEN DA PROPRIA ORGANIZACAO; baixa so com status approved
 * e valor igual; um pagamento ja aplicado (evento outcome PAID) nunca baixa de novo.
 */
@Injectable()
export class PixService {
  private readonly logger = new Logger(PixService.name);
  private readonly mutex = new KeyedMutex();
  /** paymentId -> instante da ultima consulta ao provedor pelo GET /pix (B16; por processo). */
  private readonly lastSync = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly students: StudentsService,
    private readonly collection: FinanceCollectionService,
    private readonly accounts: PaymentAccountService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    pixHooks: PixLifecycleHooks,
  ) {
    // Baixa manual / cancelamento / valor alterado no financeiro => cancela o Pix aberto no provedor (achado M3).
    pixHooks.registerCanceller(async (record, reason) => {
      await this.invalidateOpenPix(record, reason);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Rotas
  // ---------------------------------------------------------------------------------------------

  /** POST /finance/:id/pix (gestao). */
  generateForStaff(organizationId: number, recordId: number, actorUserId: number): Promise<PixView> {
    return this.generate(organizationId, recordId, { userId: actorUserId, self: false, email: null });
  }

  /** POST /finance/me/:id/pix (aluno/responsavel dono do lancamento). */
  async generateForSelf(organizationId: number, userId: number, recordId: number): Promise<PixView> {
    await this.assertOwnRecord(organizationId, userId, recordId);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    return this.generate(organizationId, recordId, { userId, self: true, email: user?.email ?? null });
  }

  /** GET /finance/:id/pix (gestao). */
  getForStaff(organizationId: number, recordId: number): Promise<PixView> {
    return this.current(organizationId, recordId);
  }

  /** GET /finance/me/:id/pix. */
  async getForSelf(organizationId: number, userId: number, recordId: number): Promise<PixView> {
    await this.assertOwnRecord(organizationId, userId, recordId);
    return this.current(organizationId, recordId);
  }

  /** Lancamento de um aluno ligado ao usuario (ele ou dependente). Qualquer outro caso = o MESMO 404. */
  private async assertOwnRecord(organizationId: number, userId: number, recordId: number): Promise<void> {
    const [record, mine] = await Promise.all([
      this.prisma.financialRecord.findFirst({ where: { id: recordId, organizationId }, select: { studentId: true } }),
      this.students.findMine(organizationId, userId),
    ]);
    if (!record || record.studentId === null || !mine.some((s) => s.id === record.studentId)) {
      throw new NotFoundException('Registro financeiro não encontrado.');
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Geracao
  // ---------------------------------------------------------------------------------------------

  private generate(
    organizationId: number,
    recordId: number,
    actor: { userId: number; self: boolean; email: string | null },
  ): Promise<PixView> {
    // Cliques duplos / pedidos paralelos do mesmo lancamento: um de cada vez (o 2o reaproveita o Pix do 1o).
    return this.mutex.run(`pix:${recordId}`, async () => {
      if (!this.provider.isConfigured()) {
        throw paymentError(503, PaymentErrorCode.PAYMENTS_UNAVAILABLE, 'Pagamentos online não estão configurados no servidor.');
      }
      let record = await this.loadRecord(organizationId, recordId);
      this.assertPayable(record);
      const connected = await this.accounts.getConnected(organizationId);

      const now = new Date();
      if (this.isReusable(record, now)) return this.toView(record, now);

      // Pix anterior ainda pagavel (valor antigo ou quase vencendo): cancela no provedor antes de gerar outro, para o
      // pagador nunca ter dois Pix validos do mesmo lancamento.
      if (this.hasOpenPix(record, now)) {
        record = await this.cancelPrevious(connected, record);
        if (record.status === FinancialStatus.PAID) return this.toView(record, now);
        this.assertPayable(record);
      } else if (this.hasUnsettledPix(record)) {
        // Pix anterior vencido no relogio/local, mas nao confirmado como encerrado pelo provedor: confere e aplica antes
        // (pagamento no ultimo minuto + webhook atrasado nao pode virar um segundo Pix - achado B11).
        record = await this.syncPrevious(connected, record);
        if (record.status === FinancialStatus.PAID) return this.toView(record, now);
        this.assertPayable(record);
      }

      const payerEmail = this.payerEmail(record, actor);
      const seq = record.pixSeq + 1;
      const expiresAt = new Date(now.getTime() + PIX_EXPIRATION_MINUTES * 60 * 1000);
      const externalReference = buildExternalReference(organizationId, record.id);
      let payment: ProviderPayment;
      try {
        payment = await this.withToken(organizationId, connected, (accessToken) =>
          this.provider.createPixPayment({
            accessToken,
            amountCents: record.amountCents,
            description: record.description,
            externalReference,
            payerEmail,
            expiresAt,
            notificationUrl: webhookNotificationUrl(),
            applicationFeeCents: applicationFeeCents(record.amountCents),
            // Mesma chave = mesmo pagamento no provedor (repeticao/concorrencia entre replicas nao duplica cobranca).
            idempotencyKey: `gingapp-pix-${organizationId}-${record.id}-${record.amountCents}-${seq}`,
          }),
        );
      } catch (error) {
        if (error instanceof HttpException) throw error;
        this.logger.warn(`Falha ao gerar Pix (grupo ${organizationId}, lancamento ${record.id}): ${(error as Error).message}`);
        throw providerHttpError(error);
      }

      if (
        payment.amountCents !== record.amountCents ||
        payment.externalReference !== externalReference ||
        !payment.pix?.qrCode
      ) {
        this.logger.error(`Pix devolvido pelo provedor nao confere (grupo ${organizationId}, lancamento ${record.id}).`);
        await this.cancelQuietly(connected, payment.id);
        // Nova chave de idempotencia na proxima tentativa (a mesma devolveria o mesmo pagamento, agora cancelado - B12).
        await this.bumpSeq(record.id, seq);
        throw paymentError(502, PaymentErrorCode.PROVIDER_ERROR, 'O Mercado Pago devolveu um Pix inconsistente. Tente de novo.');
      }
      if (payment.status !== 'PENDING') {
        // Mesma chave de idempotencia devolveu um pagamento que nao esta mais pendente (B12): aprovado = aplica (baixa);
        // cancelado/recusado = nunca gravar como Pix valido.
        await this.bumpSeq(record.id, seq);
        if (payment.status === 'APPROVED') {
          await this.applyProviderPayment(organizationId, payment, { source: 'SYNC', providerUserId: connected.account.providerUserId });
          const reloaded = await this.loadRecord(organizationId, record.id);
          if (reloaded.status === FinancialStatus.PAID) return this.toView(reloaded, now);
        }
        throw paymentError(502, PaymentErrorCode.PROVIDER_ERROR, 'O Mercado Pago devolveu um Pix que não está mais pendente. Tente de novo.');
      }

      const result = await this.prisma.financialRecord.updateMany({
        where: { id: record.id, organizationId, status: { in: OPEN }, amountCents: record.amountCents },
        data: {
          gatewayProvider: this.provider.id,
          gatewayPaymentId: payment.id,
          gatewayStatus: payment.rawStatus,
          pixQrCode: payment.pix.qrCode,
          pixQrCodeBase64: payment.pix.qrCodeBase64,
          pixTicketUrl: payment.pix.ticketUrl,
          pixExpiresAt: payment.expiresAt ?? expiresAt,
          pixGeneratedAt: now,
          pixAmountCents: record.amountCents,
          pixSeq: seq,
          pixLastCheckedAt: null,
        },
      });
      if (result.count === 0) {
        await this.cancelQuietly(connected, payment.id);
        await this.bumpSeq(record.id, seq);
        throw paymentError(409, PaymentErrorCode.RECORD_CHANGED, 'O lançamento mudou enquanto o Pix era gerado; recarregue.');
      }
      await this.audit.record({
        organizationId,
        userId: actor.userId,
        action: AuditAction.PAYMENT_PIX_GENERATE,
        entity: AuditEntity.FINANCE,
        entityId: record.id,
        meta: {
          amountCents: record.amountCents,
          provider: this.provider.id,
          gatewayPaymentId: payment.id,
          by: actor.self ? 'self' : 'staff',
          seq,
        },
      });
      return this.toView(await this.loadRecord(organizationId, record.id), now);
    });
  }

  private async loadRecord(organizationId: number, recordId: number): Promise<RecordWithPeople> {
    const record = await this.prisma.financialRecord.findFirst({ where: { id: recordId, organizationId }, include: RECORD_INCLUDE });
    if (!record) throw new NotFoundException('Registro financeiro não encontrado.');
    return record;
  }

  private assertPayable(record: FinancialRecord): void {
    if (record.status === FinancialStatus.PAID) {
      throw paymentError(409, PaymentErrorCode.ALREADY_PAID, 'Este lançamento já está pago.');
    }
    if (record.status === FinancialStatus.CANCELLED || record.amountCents <= 0) {
      throw paymentError(409, PaymentErrorCode.RECORD_NOT_PAYABLE, 'Este lançamento não aceita pagamento por Pix.');
    }
    if (record.amountCents < MP_PIX_MIN_AMOUNT_CENTS) {
      throw paymentError(422, PaymentErrorCode.AMOUNT_TOO_LOW, `O valor mínimo para Pix é ${brl(MP_PIX_MIN_AMOUNT_CENTS)}.`);
    }
  }

  /** Pix pendente deste provedor, ainda pagavel no provedor (independe do valor/validade restante). */
  private hasOpenPix(record: FinancialRecord, now: Date): boolean {
    return (
      record.gatewayProvider === this.provider.id &&
      !!record.gatewayPaymentId &&
      PIX_OPEN_GATEWAY_STATUSES.includes(record.gatewayStatus ?? '') &&
      !!record.pixExpiresAt &&
      record.pixExpiresAt.getTime() > now.getTime()
    );
  }

  /** Reaproveita: pendente, mesmo valor, com folga de validade. */
  private isReusable(record: FinancialRecord, now: Date): boolean {
    return (
      this.hasOpenPix(record, now) &&
      record.pixAmountCents === record.amountCents &&
      !!record.pixQrCode &&
      record.pixExpiresAt!.getTime() - now.getTime() > PIX_REUSE_MIN_REMAINING_MS
    );
  }

  /** Pix anterior deste provedor que o provedor ainda NAO confirmou como encerrado (pendente/vencido so localmente). */
  private hasUnsettledPix(record: FinancialRecord): boolean {
    return (
      record.gatewayProvider === this.provider.id &&
      !!record.gatewayPaymentId &&
      UNSETTLED_GATEWAY_STATUSES.includes(record.gatewayStatus ?? '')
    );
  }

  /**
   * Consulta o Pix anterior e aplica o que o provedor disser. Provedor fora do ar => 503 (nao gera um segundo Pix as
   * cegas); pagamento que este token nao enxerga (ex.: de outra conta) => segue (so log).
   */
  private async syncPrevious(connected: ConnectedAccount, record: RecordWithPeople): Promise<RecordWithPeople> {
    const paymentId = record.gatewayPaymentId!;
    let latest: ProviderPayment;
    try {
      latest = await this.withToken(record.organizationId, connected, (accessToken) => this.provider.getPayment({ accessToken, paymentId }));
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof PaymentProviderError && error.transient) {
        throw paymentError(503, PaymentErrorCode.PROVIDER_UNAVAILABLE, 'O Mercado Pago não respondeu. Tente de novo em instantes.');
      }
      this.logger.warn(`Pix anterior ${paymentId} nao conferido (grupo ${record.organizationId}): ${(error as Error).message}`);
      return record;
    }
    // Ainda pendente no provedor apesar de vencido no relogio: cancela antes de gerar outro (nunca dois pagaveis).
    if (latest.status === 'PENDING') return this.cancelPrevious(connected, record);
    await this.applyProviderPayment(record.organizationId, latest, { source: 'SYNC', providerUserId: connected.account.providerUserId });
    return this.loadRecord(record.organizationId, record.id);
  }

  /** Avanca o contador de Pix (a proxima geracao usa outra chave de idempotencia no provedor). */
  private async bumpSeq(recordId: number, seq: number): Promise<void> {
    await this.prisma.financialRecord.updateMany({ where: { id: recordId, pixSeq: { lt: seq } }, data: { pixSeq: seq } });
  }

  /**
   * Cancela o Pix anterior no provedor. Se o provedor recusar (ex.: o pagador acabou de pagar), sincroniza: aprovado =>
   * baixa (devolve o lancamento pago); ainda pendente => 409/503 (nao gera um segundo Pix pagavel).
   */
  private async cancelPrevious(connected: ConnectedAccount, record: RecordWithPeople): Promise<RecordWithPeople> {
    const paymentId = record.gatewayPaymentId!;
    try {
      const cancelled = await this.withToken(record.organizationId, connected, (accessToken) =>
        this.provider.cancelPayment({ accessToken, paymentId }),
      );
      await this.applyProviderPayment(record.organizationId, cancelled, { source: 'SYNC', providerUserId: connected.account.providerUserId });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const latest = await this.fetchQuietly(connected, paymentId);
      if (latest) {
        await this.applyProviderPayment(record.organizationId, latest, { source: 'SYNC', providerUserId: connected.account.providerUserId });
      }
      const reloaded = await this.loadRecord(record.organizationId, record.id);
      if (reloaded.status === FinancialStatus.PAID) return reloaded;
      if (this.hasOpenPix(reloaded, new Date())) {
        throw reloaded.pixAmountCents !== reloaded.amountCents
          ? paymentError(409, PaymentErrorCode.PIX_PENDING_AMOUNT_CHANGED, 'Há um Pix pendente com o valor anterior; tente de novo em alguns minutos.')
          : paymentError(503, PaymentErrorCode.PROVIDER_UNAVAILABLE, 'O Mercado Pago não respondeu. Tente de novo em instantes.');
      }
      return reloaded;
    }
    return this.loadRecord(record.organizationId, record.id);
  }

  /**
   * payer.email (o provedor exige): o do proprio usuario quando o aluno/responsavel gera o Pix; senao o do aluno, o do
   * login do aluno, o dos responsaveis; por fim PAYMENTS_FALLBACK_PAYER_EMAIL. Nada disso => PAYER_EMAIL_REQUIRED.
   * Nunca o e-mail do Mestre (o provedor recusa pagador = recebedor).
   */
  private payerEmail(record: RecordWithPeople, actor: { self: boolean; email: string | null }): string {
    const student = record.student;
    const candidates = [
      actor.self ? actor.email : null,
      student?.email,
      student?.user?.email,
      ...(student?.guardians ?? []).flatMap((g) => [g.email, g.user?.email]),
      fallbackPayerEmail(),
    ];
    const email = candidates.find((c) => isValidEmail(c));
    if (!email) {
      throw paymentError(
        422,
        PaymentErrorCode.PAYER_EMAIL_REQUIRED,
        'Cadastre um e-mail para o aluno ou responsável para gerar o Pix.',
      );
    }
    return email.trim();
  }

  // ---------------------------------------------------------------------------------------------
  // Consulta
  // ---------------------------------------------------------------------------------------------

  /**
   * Situacao atual; se PENDING (ou EXPIRED ha menos de 7 dias - pagamento no ultimo minuto, A1-c), confere no provedor
   * (cobre webhook atrasado/perdido). Consulta ao provedor com cache curto por pagamento (B16).
   */
  private async current(organizationId: number, recordId: number): Promise<PixView> {
    let record = await this.loadRecord(organizationId, recordId);
    if (!record.pixGeneratedAt) throw paymentError(404, PaymentErrorCode.PIX_NOT_FOUND, 'Nenhum Pix foi gerado para este lançamento.');
    const status = pixStatusOf(record);
    const recentExpired =
      status === 'EXPIRED' && !!record.pixExpiresAt && record.pixExpiresAt.getTime() > Date.now() - SYNC_EXPIRED_WINDOW_MS;
    if (
      (status === 'PENDING' || recentExpired) &&
      record.gatewayProvider === this.provider.id &&
      record.gatewayPaymentId &&
      this.claimSync(record.gatewayPaymentId)
    ) {
      try {
        const connected = await this.accounts.getConnected(organizationId);
        const payment = await this.withToken(organizationId, connected, (accessToken) =>
          this.provider.getPayment({ accessToken, paymentId: record.gatewayPaymentId! }),
        );
        await this.applyProviderPayment(organizationId, payment, { source: 'SYNC', providerUserId: connected.account.providerUserId });
        record = await this.loadRecord(organizationId, recordId);
      } catch (error) {
        // Consulta e best-effort: devolve o que temos (a reconciliacao tenta de novo).
        this.logger.warn(`Sincronizacao do Pix falhou (grupo ${organizationId}, lancamento ${recordId}): ${(error as Error).message}`);
      }
    }
    return this.toView(record);
  }

  /** true = pode consultar o provedor agora (e marca); false = consultado ha menos de PIX_SYNC_CACHE_MS. */
  private claimSync(paymentId: string, now: number = Date.now()): boolean {
    const last = this.lastSync.get(paymentId);
    if (last !== undefined && now - last < PIX_SYNC_CACHE_MS) return false;
    if (this.lastSync.size > 5000) {
      for (const [key, at] of this.lastSync) if (now - at >= PIX_SYNC_CACHE_MS) this.lastSync.delete(key);
    }
    this.lastSync.set(paymentId, now);
    return true;
  }

  private toView(record: FinancialRecord, now: Date = new Date()): PixView {
    const status = pixStatusOf(record, now) ?? 'CANCELLED';
    const generatedAt = record.pixGeneratedAt ?? now;
    const pending = status === 'PENDING';
    return {
      financeRecordId: record.id,
      amountCents: record.amountCents,
      status,
      qrCode: pending ? record.pixQrCode : null,
      qrCodeBase64: pending ? record.pixQrCodeBase64 : null,
      ticketUrl: pending ? record.pixTicketUrl : null,
      expiresAt: (record.pixExpiresAt ?? generatedAt).toISOString(),
      generatedAt: generatedAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Aplicacao do que o provedor disse (webhook / sincronizacao / reconciliacao)
  // ---------------------------------------------------------------------------------------------

  /**
   * Aplica um pagamento JA BUSCADO no provedor com o token da organizacao `organizationId`. Confere external_reference
   * (desta organizacao), vendedor (collector = conta do grupo) e valor antes de qualquer baixa. Nunca estorna nada
   * sozinho: estorno/contestacao no provedor so alerta o Mestre. Lanca so em falha transitoria (banco).
   */
  async applyProviderPayment(
    organizationId: number,
    payment: ProviderPayment,
    ctx: { source: PaymentEventSource; providerUserId: string | null; eventId?: string },
  ): Promise<{ outcome: ApplyOutcome; financialRecordId: number | null }> {
    const ref = parseExternalReference(payment.externalReference);
    let outcome: ApplyOutcome;
    let recordId: number | null = null;
    if (!ref || ref.organizationId !== organizationId) {
      outcome = 'FOREIGN_REFERENCE';
    } else if (ctx.providerUserId && payment.collectorId && payment.collectorId !== ctx.providerUserId) {
      outcome = 'FOREIGN_COLLECTOR';
    } else {
      recordId = ref.financialRecordId;
      const record = await this.prisma.financialRecord.findFirst({
        where: { id: ref.financialRecordId, organizationId },
        include: { student: { select: { name: true } } },
      });
      if (!record) {
        outcome = payment.status === 'APPROVED' ? 'ORPHAN_PAID' : 'RECORD_NOT_FOUND';
        if (outcome === 'ORPHAN_PAID') await this.alertOrphan(organizationId, ref.financialRecordId, payment);
      } else if (payment.liveMode === false && !testModeAllowed()) {
        // Pagamento de TESTE em producao (B8): nunca da baixa.
        this.logger.warn(`Pagamento de teste ${payment.id} ignorado em producao (grupo ${organizationId}).`);
        outcome = 'TEST_MODE';
      } else {
        outcome = await this.applyToRecord(record, payment);
      }
    }
    if (ctx.source !== 'WEBHOOK') {
      await this.recordEvent({
        eventId: `${ctx.source.toLowerCase()}:${payment.id}:${payment.rawStatus}:${outcome}`,
        source: ctx.source,
        paymentId: payment.id,
        organizationId,
        financialRecordId: recordId,
        outcome,
        rawSafe: safePaymentSnapshot(payment),
      });
    }
    if (outcome === 'FOREIGN_REFERENCE' || outcome === 'FOREIGN_COLLECTOR') {
      this.logger.warn(`Pagamento ${payment.id} nao pertence ao grupo ${organizationId} (${outcome}); ignorado.`);
    }
    return { outcome, financialRecordId: recordId };
  }

  private async applyToRecord(
    record: FinancialRecord & { student: { name: string } | null },
    payment: ProviderPayment,
  ): Promise<ApplyOutcome> {
    const isCurrent = record.gatewayProvider === this.provider.id && record.gatewayPaymentId === payment.id;
    const paidByThis =
      record.status === FinancialStatus.PAID && record.paidVia === PaidVia.PIX_AUTO && isCurrent;

    switch (payment.status) {
      case 'APPROVED': {
        if (paidByThis) return 'DUPLICATE';
        if (await this.hasOutcome(payment.id, 'PAID')) return 'ALREADY_APPLIED';
        if (record.status === FinancialStatus.PAID || record.status === FinancialStatus.CANCELLED) {
          await this.alertOnce(record, payment, 'PAID_CONFLICT');
          return 'PAID_CONFLICT';
        }
        if (payment.amountCents !== record.amountCents) {
          await this.alertOnce(record, payment, 'AMOUNT_MISMATCH');
          // Status terminal: sai da fila da reconciliacao (antes ficava 'pending' para sempre no topo - M4).
          if (isCurrent) await this.setGatewayStatus(record.id, payment.id, 'approved_mismatch');
          return 'AMOUNT_MISMATCH';
        }
        const approvedAt = payment.approvedAt ?? new Date();
        let applied: boolean;
        try {
          ({ applied } = await this.collection.payWithResult(
            record.organizationId,
            record.id,
            {
              paymentMethod: PaymentMethod.PIX,
              paidAt: civilTodayStart(approvedAt).toISOString().slice(0, 10),
              paidCents: payment.amountCents,
            },
            new Date(),
            {
              via: 'PIX_AUTO',
              provider: this.provider.id,
              paymentId: payment.id,
              gatewayStatus: payment.rawStatus,
              amountCents: payment.amountCents,
            },
          ));
        } catch (error) {
          if (!(error instanceof ConflictException)) throw error;
          // Corrida (baixa manual/valor alterado no meio do caminho): relê e decide.
          const now = await this.prisma.financialRecord.findFirst({ where: { id: record.id } });
          if (now && now.status === FinancialStatus.PAID && now.gatewayPaymentId === payment.id && now.paidVia === PaidVia.PIX_AUTO) {
            return 'DUPLICATE';
          }
          await this.alertOnce(record, payment, now && now.amountCents !== payment.amountCents ? 'AMOUNT_MISMATCH' : 'PAID_CONFLICT');
          return now && now.amountCents !== payment.amountCents ? 'AMOUNT_MISMATCH' : 'PAID_CONFLICT';
        }
        // No-op idempotente (outra via - webhook x consulta - baixou este mesmo pagamento no meio do caminho): quem
        // aplicou ja auditou e avisou; aqui nao repete (B7).
        if (!applied) return 'DUPLICATE';
        await this.audit.record({
          organizationId: record.organizationId,
          userId: null,
          action: AuditAction.PAYMENT_PIX_CONFIRMED,
          entity: AuditEntity.FINANCE,
          entityId: record.id,
          meta: { amountCents: payment.amountCents, provider: this.provider.id, gatewayPaymentId: payment.id, studentId: record.studentId },
        });
        await this.notifyConfirmed(record, payment.amountCents);
        return 'PAID';
      }
      case 'PENDING': {
        if (isCurrent && OPEN.includes(record.status as (typeof OPEN)[number]) && record.gatewayStatus !== payment.rawStatus) {
          await this.prisma.financialRecord.updateMany({
            where: { id: record.id, gatewayPaymentId: payment.id, status: { in: OPEN } },
            data: { gatewayStatus: payment.rawStatus },
          });
        }
        return isCurrent ? 'PENDING' : 'STALE';
      }
      case 'REJECTED':
      case 'CANCELLED': {
        if (!isCurrent || !OPEN.includes(record.status as (typeof OPEN)[number])) return 'STALE';
        // Libera um novo Pix (o status cru fica para a trilha; 'expired' quando o provedor venceu o Pix).
        await this.prisma.financialRecord.updateMany({
          where: { id: record.id, gatewayPaymentId: payment.id, status: { in: OPEN } },
          data: { gatewayStatus: payment.statusDetail === 'expired' ? 'expired' : payment.rawStatus },
        });
        return 'CANCELLED';
      }
      case 'REFUNDED':
      case 'CHARGED_BACK': {
        if (!paidByThis) return 'STALE';
        if (record.gatewayStatus === payment.rawStatus) return 'DUPLICATE';
        // Sem estorno automatico: marca o status do provedor e avisa o Mestre (que decide o estorno contabil).
        await this.prisma.financialRecord.updateMany({
          where: { id: record.id, gatewayPaymentId: payment.id },
          data: { gatewayStatus: payment.rawStatus },
        });
        await this.alertOnce(record, payment, 'REFUND_ALERT');
        return 'REFUND_ALERT';
      }
      default:
        return 'IGNORED';
    }
  }

  private async hasOutcome(paymentId: string, outcome: string): Promise<boolean> {
    const found = await this.prisma.paymentWebhookEvent.findFirst({
      where: { provider: this.provider.id, paymentId, outcome },
      select: { id: true },
    });
    return found !== null;
  }

  /** Alerta (auditoria + aviso aos Mestres) UMA vez por pagamento e motivo. */
  private async alertOnce(
    record: FinancialRecord & { student?: { name: string } | null },
    payment: ProviderPayment,
    reason: 'PAID_CONFLICT' | 'AMOUNT_MISMATCH' | 'REFUND_ALERT',
  ): Promise<void> {
    if (await this.hasOutcome(payment.id, reason)) return;
    await this.audit.record({
      organizationId: record.organizationId,
      userId: null,
      action: AuditAction.PAYMENT_PIX_ALERT,
      entity: AuditEntity.FINANCE,
      entityId: record.id,
      meta: {
        reason,
        provider: this.provider.id,
        gatewayPaymentId: payment.id,
        providerStatus: payment.rawStatus,
        providerAmountCents: payment.amountCents,
        recordAmountCents: record.amountCents,
        recordStatus: record.status,
      },
    });
    const who = record.student?.name ? `${record.student.name}: ` : '';
    const text: Record<typeof reason, string> = {
      PAID_CONFLICT: `${who}recebemos um Pix de ${brl(payment.amountCents)} para "${record.description}", que já estava pago ou cancelado. Confira no Mercado Pago e devolva se for o caso.`,
      AMOUNT_MISMATCH: `${who}recebemos um Pix de ${brl(payment.amountCents)} para "${record.description}" (valor do lançamento: ${brl(record.amountCents)}). Não demos baixa automática: confira e baixe à mão.`,
      REFUND_ALERT: `${who}o Pix de "${record.description}" foi ${payment.status === 'CHARGED_BACK' ? 'contestado' : 'devolvido'} no Mercado Pago. O lançamento continua pago aqui: estorne à mão se for o caso.`,
    };
    await this.accounts.notifyMestres(record.organizationId, { title: 'Pix precisa de atenção', body: text[reason], type: 'FINANCE_PIX_ALERT' });
  }

  /**
   * Pagamento APROVADO de um lancamento que nao existe mais (apagado com o Pix ainda pagavel - M3): dinheiro recebido sem
   * lancamento. Auditoria + aviso aos Mestres UMA vez por pagamento (antes era silencioso).
   */
  private async alertOrphan(organizationId: number, financialRecordId: number, payment: ProviderPayment): Promise<void> {
    if (await this.hasOutcome(payment.id, 'ORPHAN_PAID')) return;
    await this.audit.record({
      organizationId,
      userId: null,
      action: AuditAction.PAYMENT_PIX_ALERT,
      entity: AuditEntity.FINANCE,
      entityId: financialRecordId,
      meta: {
        reason: 'ORPHAN_PAID',
        provider: this.provider.id,
        gatewayPaymentId: payment.id,
        providerStatus: payment.rawStatus,
        providerAmountCents: payment.amountCents,
      },
    });
    await this.accounts.notifyMestres(organizationId, {
      title: 'Pix precisa de atenção',
      body: `Recebemos um Pix de ${brl(payment.amountCents)} de um lançamento que foi excluído (nº ${financialRecordId}). Confira no Mercado Pago e lance o pagamento à mão ou devolva.`,
      type: 'FINANCE_PIX_ALERT',
    });
  }

  private async notifyConfirmed(record: FinancialRecord & { student: { name: string } | null }, amountCents: number): Promise<void> {
    if (record.studentId !== null) {
      await this.notifications.notifyStudents(record.organizationId, [record.studentId], {
        title: 'Pagamento confirmado',
        body: `${record.description} (${brl(amountCents)}) foi paga via Pix. Obrigado!`,
        type: 'FINANCE_PAYMENT_CONFIRMED',
      });
    }
    const who = record.student?.name ? `${record.student.name}: ` : '';
    await this.accounts.notifyMestres(record.organizationId, {
      title: 'Pix recebido',
      body: `${who}${record.description} (${brl(amountCents)}) foi paga via Pix e baixada automaticamente.`,
      type: 'FINANCE_PIX_RECEIVED',
    });
  }

  /** Grava/atualiza um evento (idempotente pela chave provider+eventId). */
  async recordEvent(input: {
    eventId: string;
    source: PaymentEventSource;
    paymentId: string | null;
    organizationId: number | null;
    financialRecordId: number | null;
    outcome: string | null;
    rawSafe: Prisma.InputJsonValue | null;
    processed?: boolean;
  }): Promise<void> {
    const data = {
      paymentId: input.paymentId,
      organizationId: input.organizationId,
      financialRecordId: input.financialRecordId,
      source: input.source,
      outcome: input.outcome,
      rawSafe: input.rawSafe ?? Prisma.JsonNull,
      processedAt: input.processed === false ? null : new Date(),
    };
    const key = { provider: this.provider.id, eventId: input.eventId.slice(0, 190) };
    try {
      await this.prisma.paymentWebhookEvent.upsert({ where: { provider_eventId: key }, create: { ...key, ...data }, update: data });
    } catch (error) {
      // Upsert concorrente do MESMO evento (ex.: duas consultas simultaneas): a outra criou; aqui so atualiza.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      await this.prisma.paymentWebhookEvent.update({ where: { provider_eventId: key }, data });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Reconciliacao (job): Pix pendentes antigos conferidos no provedor (cobre webhook perdido) e vencidos marcados.
  // ---------------------------------------------------------------------------------------------

  /**
   * Fila JUSTA (M4): menos conferido primeiro (pixLastCheckedAt nulls first), cada Pix no maximo a cada
   * RECONCILE_RECHECK_MS, lote limitado. Cada lancamento e "reivindicado" por compare-and-set em pixLastCheckedAt (+
   * updatedAt lido, preservado) antes da consulta: duas replicas nunca conferem o mesmo Pix na mesma rodada (M5) e o
   * formulario aberto no painel nao fica "desatualizado" so por causa da reconciliacao. Conta indisponivel ou erro do
   * provedor => o Pix CONTINUA na fila (nunca vence localmente sem resposta do provedor - A1-b).
   */
  async reconcilePending(now: Date = new Date(), limit = RECONCILE_BATCH_SIZE) {
    const records = await this.prisma.financialRecord.findMany({
      where: {
        gatewayProvider: this.provider.id,
        gatewayPaymentId: { not: null },
        status: { in: OPEN },
        gatewayStatus: { in: PIX_OPEN_GATEWAY_STATUSES },
        pixGeneratedAt: { lt: new Date(now.getTime() - RECONCILE_MIN_AGE_MS) },
        OR: [{ pixLastCheckedAt: null }, { pixLastCheckedAt: { lt: new Date(now.getTime() - RECONCILE_RECHECK_MS) } }],
      },
      orderBy: [{ pixLastCheckedAt: { sort: 'asc', nulls: 'first' } }, { pixGeneratedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true, organizationId: true, gatewayPaymentId: true, pixExpiresAt: true, pixLastCheckedAt: true, updatedAt: true },
    });
    const stats = { checked: 0, paid: 0, cancelled: 0, expired: 0, errors: 0, unavailable: 0, skipped: 0 };
    const byOrg = new Map<number, typeof records>();
    for (const r of records) byOrg.set(r.organizationId, [...(byOrg.get(r.organizationId) ?? []), r]);

    for (const [organizationId, list] of byOrg) {
      let connected: ConnectedAccount | null = null;
      try {
        connected = await this.accounts.getConnected(organizationId);
      } catch {
        connected = null; // conta desconectada/em erro: nada e decidido sem o provedor (volta a ser conferido depois)
      }
      for (const r of list) {
        const claim = await this.prisma.financialRecord.updateMany({
          where: { id: r.id, pixLastCheckedAt: r.pixLastCheckedAt, updatedAt: r.updatedAt },
          data: { pixLastCheckedAt: now, updatedAt: r.updatedAt },
        });
        if (claim.count === 0) {
          stats.skipped += 1; // outra replica pegou / o lancamento mudou: fica para a proxima rodada
          continue;
        }
        stats.checked += 1;
        if (!connected) {
          stats.unavailable += 1;
          continue;
        }
        try {
          const payment = await this.withToken(organizationId, connected, (accessToken) =>
            this.provider.getPayment({ accessToken, paymentId: r.gatewayPaymentId! }),
          );
          const { outcome } = await this.applyProviderPayment(organizationId, payment, {
            source: 'RECONCILE',
            providerUserId: connected.account.providerUserId,
          });
          if (outcome === 'PAID') stats.paid += 1;
          if (outcome === 'CANCELLED') stats.cancelled += 1;
          // O PROVEDOR respondeu "pendente" muito depois da validade: vence localmente (sai da fila).
          if (outcome === 'PENDING' && r.pixExpiresAt && r.pixExpiresAt.getTime() < now.getTime() - RECONCILE_EXPIRED_GRACE_MS) {
            const result = await this.prisma.financialRecord.updateMany({
              where: { id: r.id, gatewayPaymentId: r.gatewayPaymentId, status: { in: OPEN }, gatewayStatus: { in: PIX_OPEN_GATEWAY_STATUSES } },
              data: { gatewayStatus: 'expired' },
            });
            stats.expired += result.count;
          }
        } catch (error) {
          stats.errors += 1;
          this.logger.warn(`Reconciliacao do Pix falhou (grupo ${organizationId}, lancamento ${r.id}): ${(error as Error).message}`);
        }
      }
    }
    await this.accounts.refreshExpiring();
    return stats;
  }

  /** Grava o status do provedor no lancamento (so se o Pix ainda for o mesmo). */
  private async setGatewayStatus(recordId: number, paymentId: string, gatewayStatus: string): Promise<void> {
    await this.prisma.financialRecord.updateMany({ where: { id: recordId, gatewayPaymentId: paymentId }, data: { gatewayStatus } });
  }

  /**
   * Cancela no provedor o Pix ainda aberto de um lancamento que deixou de aceita-lo (baixa manual, cancelamento, valor
   * alterado, desconexao - M3/A1-d). Best-effort: conta indisponivel/erro so vai para o log (sem segredo). Se o cancelamento
   * falhar, consulta e APLICA o que o provedor disser (aprovado num lancamento ja pago/cancelado = alerta ao Mestre).
   * Devolve true se o provedor confirmou o Pix encerrado.
   */
  async invalidateOpenPix(record: FinancialRecord, reason: PixInvalidationReason | 'DISCONNECT'): Promise<boolean> {
    if (record.gatewayProvider !== this.provider.id || !record.gatewayPaymentId) return false;
    if (!PIX_OPEN_GATEWAY_STATUSES.includes(record.gatewayStatus ?? '')) return false;
    const paymentId = record.gatewayPaymentId;
    let connected: ConnectedAccount;
    try {
      connected = await this.accounts.getConnected(record.organizationId);
    } catch (error) {
      this.logger.warn(`Pix ${paymentId} nao cancelado no provedor (${reason}, lancamento ${record.id}): ${(error as Error).message}`);
      return false;
    }
    const ctx = { source: 'SYNC' as const, providerUserId: connected.account.providerUserId };
    let latest: ProviderPayment | null;
    try {
      latest = await this.withToken(record.organizationId, connected, (accessToken) => this.provider.cancelPayment({ accessToken, paymentId }));
    } catch (error) {
      this.logger.warn(`Cancelamento do Pix ${paymentId} recusado (${reason}, lancamento ${record.id}): ${(error as Error).message}`);
      latest = await this.fetchQuietly(connected, paymentId);
    }
    if (!latest) return false;
    await this.applyProviderPayment(record.organizationId, latest, ctx);
    if (latest.status === 'CANCELLED' || latest.status === 'REJECTED') {
      await this.setGatewayStatus(record.id, paymentId, latest.statusDetail === 'expired' ? 'expired' : latest.rawStatus);
      return true;
    }
    return false;
  }

  /** Antes de desconectar a conta: cancela (best-effort) os Pix ainda pagaveis do grupo. */
  async cancelOpenPixOfOrganization(organizationId: number, now: Date = new Date()): Promise<{ cancelled: number; failed: number }> {
    const records = await this.prisma.financialRecord.findMany({
      where: {
        organizationId,
        gatewayProvider: this.provider.id,
        gatewayPaymentId: { not: null },
        status: { in: OPEN },
        gatewayStatus: { in: PIX_OPEN_GATEWAY_STATUSES },
        pixExpiresAt: { gt: now },
      },
      orderBy: { id: 'asc' },
      take: 500,
    });
    let cancelled = 0;
    for (const record of records) {
      if (await this.invalidateOpenPix(record, 'DISCONNECT')) cancelled += 1;
    }
    return { cancelled, failed: records.length - cancelled };
  }

  // ---------------------------------------------------------------------------------------------
  // Token
  // ---------------------------------------------------------------------------------------------

  /** Chama o provedor com o token do grupo; 401 do provedor => renova o token uma vez e tenta de novo. */
  async withToken<T>(organizationId: number, connected: ConnectedAccount, fn: (accessToken: string) => Promise<T>): Promise<T> {
    try {
      return await fn(connected.accessToken);
    } catch (error) {
      if (!(error instanceof PaymentProviderError) || error.kind !== 'UNAUTHORIZED') throw error;
      const renewed = await this.accounts.getConnected(organizationId, { force: true });
      return fn(renewed.accessToken);
    }
  }

  private async fetchQuietly(connected: ConnectedAccount, paymentId: string): Promise<ProviderPayment | null> {
    try {
      return await this.withToken(connected.account.organizationId, connected, (accessToken) =>
        this.provider.getPayment({ accessToken, paymentId }),
      );
    } catch {
      return null;
    }
  }

  private async cancelQuietly(connected: ConnectedAccount, paymentId: string): Promise<void> {
    try {
      await this.withToken(connected.account.organizationId, connected, (accessToken) =>
        this.provider.cancelPayment({ accessToken, paymentId }),
      );
    } catch (error) {
      this.logger.warn(`Nao foi possivel cancelar o pagamento ${paymentId} no provedor: ${(error as Error).message}`);
    }
  }
}

/** Snapshot SEM segredos/PII do pagamento (vai para PaymentWebhookEvent.rawSafe): sem pagador, sem QR. */
export function safePaymentSnapshot(payment: ProviderPayment): Prisma.InputJsonValue {
  return {
    id: payment.id,
    status: payment.rawStatus,
    statusDetail: payment.statusDetail,
    amountCents: payment.amountCents,
    externalReference: payment.externalReference,
    collectorId: payment.collectorId,
    approvedAt: payment.approvedAt?.toISOString() ?? null,
    liveMode: payment.liveMode,
  };
}
