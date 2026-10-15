import { Inject, Injectable, Logger } from '@nestjs/common';
import { FinancialStatus, OrgRole, PaymentAccountStatus, PaymentProviderAccount } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { frontendBaseUrl } from '../../../shared/mail/mail.config';
import { KeyedMutex } from '../../../shared/payments/keyed-mutex';
import {
  decryptProviderToken,
  encryptProviderToken,
  newOAuthNonce,
  signOAuthState,
  verifyOAuthState,
} from '../../../shared/payments/payment-crypto';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
  PaymentProviderError,
  ProviderTokens,
} from '../../../shared/payments/payment-provider.interface';
import { OAUTH_STATE_TTL_MS, TOKEN_REFRESH_WINDOW_MS, testModeAllowed } from '../../../shared/payments/payments.config';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { PIX_OPEN_GATEWAY_STATUSES } from '../finance/finance-record.view';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentErrorCode, paymentError, providerHttpError } from './payment-errors';

export interface PaymentAccountStatusDto {
  provider: string;
  /** O servidor tem as credenciais do provedor (sem isso nenhum grupo conecta). */
  available: boolean;
  connected: boolean;
  liveMode: boolean;
  providerUserId: string | null;
  connectedAt: string | null;
  status: PaymentAccountStatus | 'NOT_CONNECTED';
}

/** Conta conectada + access token EM CLARO (so em memoria, nunca sai do processo). */
export interface ConnectedAccount {
  account: PaymentProviderAccount;
  accessToken: string;
}

/** Resultado do callback do OAuth (vira `?mp=<valor>` no redirecionamento ao painel). */
export type OAuthCallbackResult = 'ok' | 'erro' | 'pix-aberto';

/** Namespace do advisory lock da renovacao do token (par com o id do grupo): uma renovacao por conta entre replicas. */
export const PAYMENT_TOKEN_LOCK_NS = 7310;

const accountError = () =>
  paymentError(409, PaymentErrorCode.MP_ACCOUNT_ERROR, 'A conta do Mercado Pago do grupo precisa ser reconectada pelo Mestre.');

type RefreshOutcome =
  | { kind: 'ok'; connected: ConnectedAccount }
  | { kind: 'mark-error'; account: PaymentProviderAccount; reason: string }
  | { kind: 'fail'; error: unknown };

/**
 * Conexao OAuth da conta do provedor de pagamento DO GRUPO (PLANO_PROJETO.md 10.52/10.53) e o access token em uso.
 * Tokens: cifrados em repouso com AAD do grupo (payment-crypto.ts), NUNCA em resposta, log ou auditoria. O `state` do
 * OAuth e assinado (HMAC: grupo + usuario + nonce + validade de 10 min) e DE USO UNICO (nonce em PaymentOauthState,
 * consumido atomicamente no callback, que e publico: o navegador volta do provedor sem o nosso JWT).
 *
 * Decisao (achado M6): o state AINDA NAO e amarrado ao navegador por cookie - o POST /connect e um fetch autenticado por
 * JWT (Bearer), o projeto nao usa cookies e em desenvolvimento painel e API tem origens diferentes (portas). Em producao
 * (EasyPanel: painel e API no mesmo dominio, /api) o cookie httpOnly SameSite=Lax seria viavel - pendencia registrada em
 * PLANO_PROJETO.md 10.53. Mitigacoes no lugar do cookie: state de uso unico + vinculo grupo/usuario Mestre ativo conferido
 * no callback + troca de conta (providerUserId diferente) BLOQUEADA enquanto houver Pix pagavel e, quando acontece, AVISO
 * a todos os Mestres + auditoria.
 */
@Injectable()
export class PaymentAccountService {
  private readonly logger = new Logger(PaymentAccountService.name);
  private readonly refreshMutex = new KeyedMutex();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  get providerId(): string {
    return this.provider.id;
  }

  private findAccount(organizationId: number) {
    return this.prisma.paymentProviderAccount.findUnique({
      where: { organizationId_provider: { organizationId, provider: this.provider.id } },
    });
  }

  private tokenContext(organizationId: number) {
    return { organizationId, provider: this.provider.id };
  }

  async status(organizationId: number): Promise<PaymentAccountStatusDto> {
    const account = await this.findAccount(organizationId);
    const connected = account?.status === PaymentAccountStatus.CONNECTED;
    return {
      provider: this.provider.id,
      available: this.provider.isConfigured(),
      connected,
      liveMode: connected ? account.liveMode : false,
      providerUserId: connected ? account.providerUserId : null,
      connectedAt: connected && account.connectedAt ? account.connectedAt.toISOString() : null,
      status: account?.status ?? 'NOT_CONNECTED',
    };
  }

  /** URL de autorizacao (o painel redireciona o Mestre para ela). Grava o nonce do state (uso unico). */
  async connectUrl(organizationId: number, userId: number): Promise<{ url: string }> {
    if (!this.provider.isConfigured()) {
      throw paymentError(503, PaymentErrorCode.PAYMENTS_UNAVAILABLE, 'Pagamentos online não estão configurados no servidor.');
    }
    const now = new Date();
    const nonce = newOAuthNonce();
    await this.prisma.paymentOauthState.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } });
    await this.prisma.paymentOauthState.create({
      data: { nonce, organizationId, userId, provider: this.provider.id, expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS) },
    });
    const state = signOAuthState({ organizationId, userId, provider: this.provider.id, nonce }, now);
    try {
      return { url: this.provider.buildAuthorizeUrl(state) };
    } catch (error) {
      throw providerHttpError(error);
    }
  }

  /** Pix ainda PAGAVEL (pendente no provedor e dentro da validade) de lancamentos em aberto do grupo. */
  countPayableOpenPix(organizationId: number, now: Date = new Date()): Promise<number> {
    return this.prisma.financialRecord.count({
      where: {
        organizationId,
        gatewayProvider: this.provider.id,
        gatewayPaymentId: { not: null },
        status: { in: [FinancialStatus.PENDING, FinancialStatus.OVERDUE] },
        gatewayStatus: { in: PIX_OPEN_GATEWAY_STATUSES },
        pixExpiresAt: { gt: now },
      },
    });
  }

  /**
   * Volta do OAuth (rota PUBLICA). Devolve SEMPRE a URL de redirecionamento ao painel (`?mp=ok|erro|pix-aberto`), nunca
   * detalhes: state invalido/expirado/JA USADO, Mestre que deixou de ser Mestre, `code` recusado, conta de TESTE em
   * producao => `mp=erro`; troca para OUTRA conta do provedor com Pix pagavel da conta atual => `mp=pix-aberto`.
   */
  async handleCallback(query: Record<string, unknown>): Promise<string> {
    const base = frontendBaseUrl('PAINEL');
    const target = (result: OAuthCallbackResult) => (base ? `${base}/financeiro?mp=${result}` : `/?mp=${result}`);

    const state = verifyOAuthState(query.state);
    const code = typeof query.code === 'string' && query.code.length > 0 && query.code.length <= 512 ? query.code : null;
    if (!state || state.provider !== this.provider.id) {
      this.logger.warn('Callback do OAuth com state invalido/expirado.');
      return target('erro');
    }
    const now = new Date();
    // Uso unico: consome o nonce atomicamente (reuso/replay do mesmo state => 0 linhas => erro).
    const consumed = await this.prisma.paymentOauthState.updateMany({
      where: {
        nonce: state.nonce,
        organizationId: state.organizationId,
        userId: state.userId,
        provider: this.provider.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (consumed.count === 0) {
      this.logger.warn(`Callback do OAuth com state ja usado/desconhecido (grupo ${state.organizationId}).`);
      return target('erro');
    }
    if (!code) {
      // Usuario negou a autorizacao (ou o provedor devolveu erro): nada a gravar.
      return target('erro');
    }
    const membership = await this.prisma.organizationUser.findFirst({
      where: { organizationId: state.organizationId, userId: state.userId, role: OrgRole.MESTRE, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!membership) {
      this.logger.warn(`Callback do OAuth: usuario ${state.userId} nao e mais Mestre do grupo ${state.organizationId}.`);
      return target('erro');
    }

    let tokens: ProviderTokens;
    try {
      tokens = await this.provider.exchangeCode(code);
    } catch (error) {
      this.logger.warn(`Troca do code OAuth falhou (grupo ${state.organizationId}): ${(error as Error).message}`);
      return target('erro');
    }
    if (!tokens.liveMode && !testModeAllowed()) {
      this.logger.warn(`Callback do OAuth: conta de TESTE recusada em producao (grupo ${state.organizationId}).`);
      return target('erro');
    }

    const existing = await this.findAccount(state.organizationId);
    const previousProviderUserId = existing?.providerUserId ?? null;
    const accountChanged = previousProviderUserId !== null && previousProviderUserId !== tokens.providerUserId;
    if (accountChanged && (await this.countPayableOpenPix(state.organizationId, now)) > 0) {
      // Os Pix abertos so podem ser conferidos/cancelados com o token da conta ATUAL: trocar agora perderia a baixa.
      this.logger.warn(`Troca de conta do provedor recusada: ha Pix pagavel da conta atual (grupo ${state.organizationId}).`);
      return target('pix-aberto');
    }

    const ctx = this.tokenContext(state.organizationId);
    const data = {
      providerUserId: tokens.providerUserId,
      accessTokenEnc: encryptProviderToken(tokens.accessToken, ctx),
      refreshTokenEnc: tokens.refreshToken ? encryptProviderToken(tokens.refreshToken, ctx) : null,
      tokenExpiresAt: tokens.expiresAt,
      publicKey: tokens.publicKey,
      liveMode: tokens.liveMode,
      status: PaymentAccountStatus.CONNECTED,
      connectedAt: now,
      connectedById: state.userId,
      lastError: null,
    };
    await this.prisma.paymentProviderAccount.upsert({
      where: { organizationId_provider: { organizationId: state.organizationId, provider: this.provider.id } },
      create: { organizationId: state.organizationId, provider: this.provider.id, ...data },
      update: data,
    });
    await this.audit.record({
      organizationId: state.organizationId,
      userId: state.userId,
      action: AuditAction.PAYMENT_ACCOUNT_CONNECT,
      entity: AuditEntity.PAYMENT_ACCOUNT,
      entityId: this.provider.id,
      meta: {
        provider: this.provider.id,
        providerUserId: tokens.providerUserId,
        liveMode: tokens.liveMode,
        ...(accountChanged ? { accountChanged: true, previousProviderUserId } : {}),
      },
    });
    if (accountChanged) {
      await this.notifyMestres(state.organizationId, {
        title: 'Conta do Mercado Pago trocada',
        body: 'A conta do Mercado Pago que recebe os Pix do grupo foi trocada por outra. Se não foi você (ou outro Mestre), desconecte em Financeiro e avise o suporte.',
        type: 'FINANCE_PAYMENTS_ACCOUNT_CHANGED',
      });
    }
    return target('ok');
  }

  /**
   * Desconecta: apaga os tokens e marca REVOKED (idempotente). Os Pix abertos sao cancelados no provedor ANTES (pelo
   * PaymentsConnectionController via PixService.cancelOpenPixOfOrganization) e os lancamentos mantem o gatewayPaymentId
   * (reconectar a MESMA conta volta a conferi-los na reconciliacao). `openPix` vai para a auditoria.
   */
  async disconnect(
    organizationId: number,
    userId: number,
    openPix?: { cancelled: number; failed: number },
  ): Promise<PaymentAccountStatusDto> {
    const account = await this.findAccount(organizationId);
    if (account && (account.accessTokenEnc || account.refreshTokenEnc || account.status !== PaymentAccountStatus.REVOKED)) {
      await this.prisma.paymentProviderAccount.update({
        where: { id: account.id },
        data: {
          accessTokenEnc: null,
          refreshTokenEnc: null,
          tokenExpiresAt: null,
          status: PaymentAccountStatus.REVOKED,
          lastError: null,
        },
      });
      await this.audit.record({
        organizationId,
        userId,
        action: AuditAction.PAYMENT_ACCOUNT_DISCONNECT,
        entity: AuditEntity.PAYMENT_ACCOUNT,
        entityId: this.provider.id,
        meta: { provider: this.provider.id, providerUserId: account.providerUserId, ...(openPix ? { openPix } : {}) },
      });
    }
    return this.status(organizationId);
  }

  /**
   * Access token valido da conta do grupo, renovando quando faltar menos de 7 dias para vencer (ou `force`, ex.: o
   * provedor respondeu 401). Refresh recusado (INVALID_GRANT) ou token ilegivel (chave trocada) => conta ERROR + aviso
   * ao Mestre + MP_ACCOUNT_ERROR. Falha transitoria na renovacao com token ainda valido => segue com o token atual.
   */
  async getConnected(organizationId: number, options: { force?: boolean } = {}): Promise<ConnectedAccount> {
    const account = await this.findAccount(organizationId);
    if (!account || account.status === PaymentAccountStatus.REVOKED || !account.accessTokenEnc) {
      throw paymentError(409, PaymentErrorCode.MP_NOT_CONNECTED, 'O grupo não conectou uma conta do Mercado Pago.');
    }
    if (account.status === PaymentAccountStatus.ERROR) throw accountError();
    const now = Date.now();
    const expiresAt = account.tokenExpiresAt?.getTime() ?? null;
    const needsRefresh = options.force || (expiresAt !== null && expiresAt - now < TOKEN_REFRESH_WINDOW_MS);
    if (!needsRefresh) return { account, accessToken: await this.decryptOrMarkError(account, account.accessTokenEnc) };
    return this.refreshMutex.run(`token:${organizationId}`, () => this.refresh(organizationId, expiresAt, options.force ?? false));
  }

  /** Decifra; ilegivel (chave-mestra trocada / valor adulterado) => conta ERROR + aviso (uma vez) + MP_ACCOUNT_ERROR. */
  private async decryptOrMarkError(account: PaymentProviderAccount, stored: string): Promise<string> {
    try {
      return decryptProviderToken(stored, this.tokenContext(account.organizationId));
    } catch {
      await this.markError(account, 'Token cifrado ilegível (chave trocada?). Reconecte a conta.');
      throw accountError();
    }
  }

  /**
   * Renovacao serializada ENTRE REPLICAS por advisory lock transacional (por grupo) + KeyedMutex no processo (achado
   * M5). Dentro do lock rele a conta: outra replica pode ter acabado de renovar. Efeitos colaterais (markError com
   * auditoria/aviso) acontecem DEPOIS da transacao.
   */
  private async refresh(organizationId: number, previousExpiresAt: number | null, force: boolean): Promise<ConnectedAccount> {
    const outcome = await this.prisma.$transaction(
      async (tx): Promise<RefreshOutcome> => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PAYMENT_TOKEN_LOCK_NS}::int, ${organizationId}::int)`;
        const account = await tx.paymentProviderAccount.findUnique({
          where: { organizationId_provider: { organizationId, provider: this.provider.id } },
        });
        if (!account || account.status !== PaymentAccountStatus.CONNECTED || !account.accessTokenEnc) {
          return {
            kind: 'fail',
            error:
              account?.status === PaymentAccountStatus.ERROR
                ? accountError()
                : paymentError(409, PaymentErrorCode.MP_NOT_CONNECTED, 'O grupo não conectou uma conta do Mercado Pago.'),
          };
        }
        const ctx = this.tokenContext(organizationId);
        let accessToken: string;
        let refreshToken: string | null;
        try {
          accessToken = decryptProviderToken(account.accessTokenEnc, ctx);
          refreshToken = account.refreshTokenEnc ? decryptProviderToken(account.refreshTokenEnc, ctx) : null;
        } catch {
          return { kind: 'mark-error', account, reason: 'Token cifrado ilegível (chave trocada?). Reconecte a conta.' };
        }
        const currentExpiresAt = account.tokenExpiresAt?.getTime() ?? null;
        if (currentExpiresAt !== previousExpiresAt && currentExpiresAt !== null && currentExpiresAt - Date.now() >= TOKEN_REFRESH_WINDOW_MS) {
          return { kind: 'ok', connected: { account, accessToken } };
        }
        if (!refreshToken) {
          if (!force && currentExpiresAt !== null && currentExpiresAt > Date.now()) return { kind: 'ok', connected: { account, accessToken } };
          return { kind: 'mark-error', account, reason: 'Sem refresh token para renovar o acesso.' };
        }
        try {
          const tokens = await this.provider.refreshToken(refreshToken);
          const updated = await tx.paymentProviderAccount.update({
            where: { id: account.id },
            data: {
              accessTokenEnc: encryptProviderToken(tokens.accessToken, ctx),
              refreshTokenEnc: tokens.refreshToken ? encryptProviderToken(tokens.refreshToken, ctx) : account.refreshTokenEnc,
              tokenExpiresAt: tokens.expiresAt,
              publicKey: tokens.publicKey ?? account.publicKey,
              liveMode: tokens.liveMode,
              lastError: null,
            },
          });
          return { kind: 'ok', connected: { account: updated, accessToken: tokens.accessToken } };
        } catch (error) {
          if (error instanceof PaymentProviderError && (error.kind === 'INVALID_GRANT' || error.kind === 'UNAUTHORIZED')) {
            return { kind: 'mark-error', account, reason: 'Renovação do acesso recusada pelo Mercado Pago.' };
          }
          // Transitoria: se o token atual ainda vale, segue com ele (a proxima chamada tenta renovar de novo).
          if (!force && currentExpiresAt !== null && currentExpiresAt > Date.now()) {
            this.logger.warn(`Renovacao do token adiada (grupo ${organizationId}): ${(error as Error).message}`);
            return { kind: 'ok', connected: { account, accessToken } };
          }
          return { kind: 'fail', error: providerHttpError(error) };
        }
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
    if (outcome.kind === 'ok') return outcome.connected;
    if (outcome.kind === 'mark-error') {
      await this.markError(outcome.account, outcome.reason);
      throw accountError();
    }
    throw outcome.error;
  }

  /**
   * Conta em ERROR + auditoria + aviso aos Mestres (uma vez: so na transicao CONNECTED -> ERROR). Condicionado aos
   * tokens LIDOS: se outra replica acabou de renovar/reconectar (tokens diferentes), nao derruba a conta nova.
   */
  private async markError(account: PaymentProviderAccount, reason: string): Promise<void> {
    const result = await this.prisma.paymentProviderAccount.updateMany({
      where: {
        id: account.id,
        status: PaymentAccountStatus.CONNECTED,
        accessTokenEnc: account.accessTokenEnc,
        refreshTokenEnc: account.refreshTokenEnc,
      },
      data: { status: PaymentAccountStatus.ERROR, lastError: reason },
    });
    if (result.count === 0) return;
    await this.audit.record({
      organizationId: account.organizationId,
      userId: null,
      action: AuditAction.PAYMENT_ACCOUNT_ERROR,
      entity: AuditEntity.PAYMENT_ACCOUNT,
      entityId: account.provider,
      meta: { provider: account.provider, reason },
    });
    await this.notifyMestres(account.organizationId, {
      title: 'Reconecte o Mercado Pago',
      body: 'Não foi possível usar a conta do Mercado Pago do grupo. Reconecte em Financeiro para voltar a receber por Pix (os Pix já pagos serão conferidos depois da reconexão).',
      type: 'FINANCE_PAYMENTS_ACCOUNT_ERROR',
    });
  }

  /** Aviso SEGURO (nunca lanca) a todos os Mestres ativos do grupo. */
  async notifyMestres(organizationId: number, payload: { title: string; body: string; type: string }): Promise<number> {
    return this.notifications.safely('payments.notifyMestres', async () => {
      const mestres = await this.prisma.organizationUser.findMany({
        where: { organizationId, role: OrgRole.MESTRE, status: 'ACTIVE' },
        select: { userId: true },
      });
      return this.notifications.notifyUsers(organizationId, mestres.map((m) => m.userId), payload);
    });
  }

  /** Renova (em lote, pela reconciliacao) os tokens de contas que vencem em breve. Devolve quantas tentou. */
  async refreshExpiring(limit = 20): Promise<number> {
    const soon = new Date(Date.now() + TOKEN_REFRESH_WINDOW_MS);
    const accounts = await this.prisma.paymentProviderAccount.findMany({
      where: { provider: this.provider.id, status: PaymentAccountStatus.CONNECTED, tokenExpiresAt: { lt: soon } },
      select: { organizationId: true },
      orderBy: { tokenExpiresAt: 'asc' },
      take: limit,
    });
    for (const a of accounts) {
      try {
        await this.getConnected(a.organizationId);
      } catch (error) {
        this.logger.warn(`Renovacao periodica falhou (grupo ${a.organizationId}): ${(error as Error).message}`);
      }
    }
    return accounts.length;
  }
}
