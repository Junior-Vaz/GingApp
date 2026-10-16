import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  FinancialStatus,
  OrgRole,
  PaymentAccountMode,
  PaymentAccountStatus,
  PaymentProviderAccount,
  Prisma,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { frontendBaseUrl } from '../../../shared/mail/mail.config';
import { KeyedMutex } from '../../../shared/payments/keyed-mutex';
import { liveModeFromAccessToken } from '../../../shared/payments/mercadopago.mapping';
import {
  decryptProviderTokenWithRotation,
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
  ValidatedCredentials,
} from '../../../shared/payments/payment-provider.interface';
import {
  OAUTH_STATE_TTL_MS,
  PIX_UNRESOLVED_WINDOW_MS,
  TOKEN_REFRESH_WINDOW_MS,
  groupWebhookUrl,
  paymentsAvailable,
  testModeAllowed,
} from '../../../shared/payments/payments.config';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { PIX_EXPIRED_UNCONFIRMED, PIX_OPEN_GATEWAY_STATUSES } from '../finance/finance-record.view';
import { TwoFactorService } from '../auth/two-factor.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { SaveMercadoPagoCredentialsDto } from './dto/save-mercadopago-credentials.dto';
import { PaymentErrorCode, paymentError, providerHttpError } from './payment-errors';

/** Resposta de GET /payments/mercadopago/status, DELETE /disconnect e PUT /credentials (contrato 10.53 + 10.55 + 10.56). */
export interface PaymentAccountStatusDto {
  provider: string;
  /** Pagamentos online ligados no servidor (PAYMENTS_PROVIDER valido). NAO depende de credencial no ambiente. */
  available: boolean;
  /** OAuth do vendedor disponivel (MERCADOPAGO_CLIENT_ID/SECRET/REDIRECT_URI no servidor). Opcional/avancado. */
  oauthAvailable: boolean;
  /** Como a conta foi ligada (null = sem conta ativa: nunca conectou ou desconectou). */
  mode: PaymentAccountMode | null;
  connected: boolean;
  liveMode: boolean;
  providerUserId: string | null;
  connectedAt: string | null;
  status: PaymentAccountStatus | 'NOT_CONNECTED';
  /** Ultimos 4 caracteres do Access Token colado (modo MANUAL); nunca mais que isso (nao identifica o token). */
  tokenHint: string | null;
  /** Chave publica (nao e segredo) informada pelo Mestre / devolvida pelo OAuth. */
  publicKey: string | null;
  /** O grupo (MANUAL) cadastrou a assinatura secreta do webhook (o valor NUNCA volta). OAUTH: sempre false (B5). */
  hasWebhookSecret: boolean;
  /** false = ha segredo do webhook gravado mas ele NAO decifra (chave trocada): cole de novo (10.56, A2). */
  webhookSecretReadable: boolean;
  /** `${PAINEL_URL}/api/webhooks/mercadopago?org=<id>` (null sem PAINEL_URL https). */
  webhookUrl: string | null;
  /** Motivo curto (texto do proprio servidor, sem segredo) quando status = ERROR; senao null (10.56, B8). */
  lastError: string | null;
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
/**
 * Namespace do advisory lock da CONTA do grupo (10.56, M3-b): troca/definicao da conta (exclusivo) x gravacao de um Pix
 * novo (compartilhado). Transacoes curtas (nenhuma chamada ao provedor dentro).
 */
export const PAYMENT_ACCOUNT_LOCK_NS = 7311;

const accountError = () =>
  paymentError(
    409,
    PaymentErrorCode.MP_ACCOUNT_ERROR,
    'A conta do Mercado Pago do grupo precisa ser reconectada pelo Mestre (cole as credenciais novamente em Financeiro).',
  );

const notConnectedError = () =>
  paymentError(409, PaymentErrorCode.MP_NOT_CONNECTED, 'O grupo não conectou uma conta do Mercado Pago.');

type RefreshOutcome =
  | { kind: 'ok'; connected: ConnectedAccount }
  | { kind: 'mark-error'; account: PaymentProviderAccount; reason: string }
  | { kind: 'fail'; error: unknown };

/** Motivo (texto curto, sem segredo) de token ilegivel: chave-mestra/JWT_SECRET trocado ou valor adulterado. */
const UNREADABLE_REASON = 'Credencial cifrada ilegível (PAYMENTS_TOKEN_KEY/JWT_SECRET trocado?). Cole as credenciais novamente.';
/** B7: conta OAUTH vencida sem o OAuth configurado no servidor (nao ha como renovar). */
const OAUTH_OFF_REASON =
  'A conexão por autorização não está disponível no servidor e o acesso venceu. Reconecte colando as credenciais (Access Token) em Financeiro.';

type Tx = Prisma.TransactionClient;

/**
 * Conta do provedor de pagamento DO GRUPO (PLANO_PROJETO.md 10.52/10.53/10.55/10.56) e o access token em uso.
 *
 * Dois modos:
 *  - MANUAL (caminho principal, 10.55): o Mestre cola o Access Token (e opcionalmente a chave publica e a assinatura
 *    secreta do webhook) da PROPRIA conta Mercado Pago na tela de configuracao do painel. Definir/trocar o token exige
 *    REAUTENTICACAO (senha atual + 2FA se ativo - 10.56, M6) e avisa TODOS os Mestres. O token e validado no provedor
 *    (dono = providerUserId), nao tem refresh nem expiracao (a renovacao/cron PULA a conta) e, se o provedor passar a
 *    recusa-lo em uso (401 confirmado em /users/me), a conta vira ERROR + aviso ao Mestre para colar de novo.
 *  - OAUTH (opcional/avancado): o fluxo do vendedor de antes, so com MERCADOPAGO_CLIENT_ID/SECRET/REDIRECT_URI.
 *
 * Tokens e segredo do webhook: cifrados em repouso com AAD do grupo (payment-crypto.ts; decifra com a lista de chaves e
 * re-cifra com a primaria - rotacao preguicosa, 10.56 M2), NUNCA em resposta, log ou auditoria. Troca para OUTRA conta
 * (providerUserId diferente) e BLOQUEADA enquanto houver Pix nao resolvido (pagavel ou vencido ha menos de 7 dias sem
 * confirmacao) e e SERIALIZADA com a gravacao de Pix novos por advisory lock do grupo (entre replicas).
 *
 * OAuth: o `state` e assinado (HMAC: grupo + usuario + nonce + validade de 10 min) e DE USO UNICO (nonce em
 * PaymentOauthState, consumido atomicamente no callback, que e publico). Decisao (achado M6 de 10.53): sem cookie.
 */
@Injectable()
export class PaymentAccountService {
  private readonly logger = new Logger(PaymentAccountService.name);
  private readonly refreshMutex = new KeyedMutex();
  private readonly credentialsMutex = new KeyedMutex();
  /**
   * Pagamentos online disponiveis: decidido no BOOT (o provedor efetivo nao muda depois - shared.module.ts valida
   * PAYMENTS_PROVIDER e derruba o boot com stub em producao). NAO depende de credencial nenhuma no ambiente.
   */
  readonly available: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly twoFactor: TwoFactorService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {
    this.available = paymentsAvailable();
  }

  get providerId(): string {
    return this.provider.id;
  }

  private findAccount(organizationId: number, client: Tx | PrismaService = this.prisma) {
    return client.paymentProviderAccount.findUnique({
      where: { organizationId_provider: { organizationId, provider: this.provider.id } },
    });
  }

  private tokenContext(organizationId: number) {
    return { organizationId, provider: this.provider.id };
  }

  private webhookSecretContext(organizationId: number) {
    return { organizationId, provider: this.provider.id, purpose: 'webhook-secret' as const };
  }

  /**
   * Advisory lock TRANSACIONAL da conta do grupo (10.56, M3-b), entre replicas: `exclusive` para definir/trocar a conta,
   * `shared` para gravar um Pix novo (varias geracoes em paralelo, nenhuma durante uma troca). `fn` deve ser curto: nada
   * de chamada ao provedor la dentro.
   */
  async withAccountLock<T>(organizationId: number, mode: 'shared' | 'exclusive', fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        if (mode === 'shared') {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${PAYMENT_ACCOUNT_LOCK_NS}::int, ${organizationId}::int)`;
        } else {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PAYMENT_ACCOUNT_LOCK_NS}::int, ${organizationId}::int)`;
        }
        return fn(tx);
      },
      { maxWait: 15_000, timeout: 20_000 },
    );
  }

  async status(organizationId: number): Promise<PaymentAccountStatusDto> {
    const account = await this.findAccount(organizationId);
    const connected = account?.status === PaymentAccountStatus.CONNECTED;
    // Conta "ativa" = CONNECTED ou ERROR (ERROR ainda guarda o que o Mestre cadastrou; REVOKED apagou tudo).
    const active = !!account && account.status !== PaymentAccountStatus.REVOKED;
    const manualSecret = active && account.mode === PaymentAccountMode.MANUAL && !!account.webhookSecretEnc;
    return {
      provider: this.provider.id,
      available: this.available,
      oauthAvailable: this.provider.isOAuthConfigured(),
      mode: active ? account.mode : null,
      connected,
      liveMode: connected ? account.liveMode : false,
      providerUserId: connected ? account.providerUserId : null,
      connectedAt: connected && account.connectedAt ? account.connectedAt.toISOString() : null,
      status: account?.status ?? 'NOT_CONNECTED',
      tokenHint: active ? account.tokenHint : null,
      publicKey: active ? account.publicKey : null,
      hasWebhookSecret: manualSecret,
      webhookSecretReadable: manualSecret ? this.secretReadable(account) : true,
      webhookUrl: groupWebhookUrl(organizationId),
      lastError: account?.status === PaymentAccountStatus.ERROR ? (account.lastError ?? null) : null,
    };
  }

  assertAvailable(): void {
    if (!this.available) {
      throw paymentError(503, PaymentErrorCode.PAYMENTS_UNAVAILABLE, 'Pagamentos online não estão configurados no servidor.');
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Modo MANUAL (10.55): credenciais coladas pelo Mestre
  // ---------------------------------------------------------------------------------------------

  /**
   * PUT /payments/mercadopago/credentials. Com `accessToken`: REAUTENTICA o Mestre (senha atual + 2FA se ativo - 10.56,
   * M6), valida o token no provedor (dono + teste/producao) e, sob o lock EXCLUSIVO da conta do grupo, bloqueia troca para
   * OUTRA conta com Pix nao resolvido (409 PIX_OPEN_ACCOUNT_CHANGE) e grava cifrado como conta MANUAL CONNECTED (sem
   * refresh/expiracao); audita e avisa TODOS os Mestres. Sem `accessToken`: atualizacao parcial (chave publica /
   * assinatura do webhook) de uma conta que ja tem token - nao pede senha. Devolve o status (nunca o token/segredo).
   */
  async saveManualCredentials(
    organizationId: number,
    userId: number,
    dto: SaveMercadoPagoCredentialsDto,
  ): Promise<PaymentAccountStatusDto> {
    this.assertAvailable();
    return this.credentialsMutex.run(`cred:${organizationId}`, async () => {
      const accessToken = dto.accessToken;
      if (accessToken === undefined) return this.updateExtras(organizationId, userId, dto);

      const actor = await this.reauthenticate(organizationId, userId, dto);
      const liveMode = liveModeFromAccessToken(accessToken);
      if (!liveMode && !testModeAllowed()) {
        throw paymentError(
          422,
          PaymentErrorCode.INVALID_CREDENTIALS,
          'Credenciais de TESTE não são aceitas em produção. Cole o Access Token de PRODUÇÃO da conta do grupo.',
        );
      }
      let owner: ValidatedCredentials;
      try {
        owner = await this.provider.validateCredentials({ accessToken });
      } catch (error) {
        throw this.credentialsError(error, organizationId);
      }
      const effectiveLiveMode = owner.liveMode ?? liveMode;
      if (!effectiveLiveMode && !testModeAllowed()) {
        throw paymentError(
          422,
          PaymentErrorCode.INVALID_CREDENTIALS,
          'Credenciais de TESTE não são aceitas em produção. Cole o Access Token de PRODUÇÃO da conta do grupo.',
        );
      }

      const now = new Date();
      const accessTokenEnc = encryptProviderToken(accessToken, this.tokenContext(organizationId));
      const extras = this.extrasData(organizationId, dto);
      // Leitura + bloqueio + gravacao sob o lock EXCLUSIVO (entre replicas): o "anterior" da auditoria e o bloqueio por
      // Pix aberto valem para o estado REAL no momento da gravacao (B6), e nenhum Pix novo e gravado no meio (M3-b).
      const outcome = await this.withAccountLock(organizationId, 'exclusive', async (tx) => {
        const existing = await this.findAccount(organizationId, tx);
        const previousProviderUserId = existing?.providerUserId ?? null;
        const accountChanged = previousProviderUserId !== null && previousProviderUserId !== owner.providerUserId;
        if (accountChanged && (await this.countUnresolvedPix(organizationId, now, tx)) > 0) {
          return { blocked: true as const };
        }
        // Segredo do webhook gravado que nao decifra mais (chave trocada): limpa ao colar um token novo (A2).
        const dropUnreadableSecret =
          !!existing?.webhookSecretEnc && dto.webhookSecret === undefined && !this.secretReadable(existing);
        const data = {
          mode: PaymentAccountMode.MANUAL,
          providerUserId: owner.providerUserId,
          accessTokenEnc,
          refreshTokenEnc: null,
          tokenExpiresAt: null,
          tokenHint: accessToken.slice(-4),
          liveMode: effectiveLiveMode,
          status: PaymentAccountStatus.CONNECTED,
          connectedAt: now,
          connectedById: userId,
          lastError: null,
          ...(dropUnreadableSecret ? { webhookSecretEnc: null } : {}),
          // Conta NOVA: a assinatura do webhook e a chave publica eram da conta antiga (o Mestre cadastra as novas).
          ...(accountChanged ? { webhookSecretEnc: null, publicKey: null, signatureAlertAt: null } : {}),
          ...extras,
        };
        await tx.paymentProviderAccount.upsert({
          where: { organizationId_provider: { organizationId, provider: this.provider.id } },
          create: { organizationId, provider: this.provider.id, ...data },
          update: data,
        });
        return { blocked: false as const, accountChanged, previousProviderUserId };
      });
      if (outcome.blocked) {
        // Os Pix abertos so podem ser conferidos/cancelados com o token da conta ATUAL: trocar agora perderia a baixa.
        throw paymentError(
          409,
          PaymentErrorCode.PIX_OPEN_ACCOUNT_CHANGE,
          'Há Pix em aberto (ou vencidos há menos de 7 dias sem confirmação) da conta atual. Espere a confirmação/vencimento ou cancele os lançamentos antes de trocar de conta do Mercado Pago.',
        );
      }
      await this.audit.record({
        organizationId,
        userId,
        action: AuditAction.PAYMENT_ACCOUNT_CONNECT,
        entity: AuditEntity.PAYMENT_ACCOUNT,
        entityId: this.provider.id,
        meta: {
          provider: this.provider.id,
          mode: PaymentAccountMode.MANUAL,
          providerUserId: owner.providerUserId,
          liveMode: effectiveLiveMode,
          reauthenticated: true,
          ...this.extrasAuditMeta(dto),
          ...(outcome.accountChanged ? { accountChanged: true, previousProviderUserId: outcome.previousProviderUserId } : {}),
        },
      });
      // Aviso a TODOS os Mestres (sino + push), sem segredo: definir/trocar a conta que recebe o dinheiro e sensivel (M6).
      await this.notifyMestres(
        organizationId,
        outcome.accountChanged
          ? {
              title: 'Conta do Mercado Pago trocada',
              body: `${actor.name} trocou a conta do Mercado Pago que recebe os Pix do grupo. Se não foi você (ou outro Mestre), desconecte em Financeiro, troque a sua senha e avise o suporte.`,
              type: 'FINANCE_PAYMENTS_ACCOUNT_CHANGED',
            }
          : {
              title: 'Mercado Pago do grupo atualizado',
              body: `${actor.name} definiu o Access Token do Mercado Pago que recebe os Pix do grupo. Se não foi você (ou outro Mestre), desconecte em Financeiro, troque a sua senha e avise o suporte.`,
              type: 'FINANCE_PAYMENTS_ACCOUNT_CONNECTED',
            },
      );
      return this.status(organizationId);
    });
  }

  /**
   * Reautenticacao do PUT com accessToken (10.56, M6): senha ATUAL (bcrypt, o mesmo do login) e, com 2FA ativo, o codigo
   * TOTP (TwoFactorService - anti-replay, bloqueio por falhas = 429). Falhas => 403 com code estavel e auditoria (sem a
   * senha/codigo). Devolve o nome do Mestre (para o aviso aos demais).
   */
  private async reauthenticate(organizationId: number, userId: number, dto: SaveMercadoPagoCredentialsDto): Promise<{ name: string }> {
    if (!dto.currentPassword) {
      throw paymentError(403, PaymentErrorCode.REAUTH_REQUIRED, 'Confirme com a sua senha para conectar ou trocar o Access Token.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      await this.audit.record({
        organizationId,
        userId,
        action: AuditAction.PAYMENT_ACCOUNT_REAUTH_FAILED,
        entity: AuditEntity.PAYMENT_ACCOUNT,
        entityId: this.provider.id,
        meta: { provider: this.provider.id, reason: 'PASSWORD' },
      });
      throw paymentError(403, PaymentErrorCode.INVALID_PASSWORD, 'Senha incorreta.');
    }
    if (user.twoFactorEnabled) {
      if (!dto.twoFactorCode) {
        throw paymentError(
          403,
          PaymentErrorCode.TWO_FACTOR_REQUIRED,
          'Informe o código do seu aplicativo autenticador (verificação em duas etapas).',
        );
      }
      try {
        await this.twoFactor.verifyFactor(user, { code: dto.twoFactorCode }, organizationId);
      } catch (error) {
        // 400 = codigo errado (o TwoFactorService ja audita TWO_FACTOR_FAILURE); 429/503 seguem como estao.
        if (error instanceof BadRequestException) {
          throw paymentError(403, PaymentErrorCode.INVALID_TWO_FACTOR_CODE, 'Código de verificação incorreto.');
        }
        throw error;
      }
    }
    return { name: user.name };
  }

  /**
   * Atualizacao parcial (sem trocar o token): chave publica e/ou assinatura do webhook. Sob o lock exclusivo e
   * condicionada ao token LIDO (B6): se outra replica trocou a conta no meio, nada e gravado (409).
   */
  private async updateExtras(organizationId: number, userId: number, dto: SaveMercadoPagoCredentialsDto): Promise<PaymentAccountStatusDto> {
    const data = this.extrasData(organizationId, dto);
    const mode = await this.withAccountLock(organizationId, 'exclusive', async (tx) => {
      const account = await this.findAccount(organizationId, tx);
      if (!account || account.status === PaymentAccountStatus.REVOKED || !account.accessTokenEnc) {
        throw paymentError(400, PaymentErrorCode.ACCESS_TOKEN_REQUIRED, 'Informe o Access Token de produção da conta Mercado Pago do grupo.');
      }
      if (account.mode === PaymentAccountMode.OAUTH && dto.webhookSecret) {
        // B5: conta OAUTH confere o webhook so com o segredo do servidor; segredo proprio nao e suportado.
        throw paymentError(
          409,
          PaymentErrorCode.WEBHOOK_SECRET_NOT_SUPPORTED,
          'Na conexão por autorização o segredo do webhook não é usado. Para usar o seu, conecte colando o Access Token.',
        );
      }
      if (Object.keys(data).length === 0) return null;
      const result = await tx.paymentProviderAccount.updateMany({
        where: { id: account.id, accessTokenEnc: account.accessTokenEnc, providerUserId: account.providerUserId },
        data,
      });
      if (result.count === 0) {
        throw paymentError(409, PaymentErrorCode.RECORD_CHANGED, 'A conta do Mercado Pago mudou enquanto salvava; recarregue.');
      }
      return account.mode;
    });
    if (mode !== null) {
      await this.audit.record({
        organizationId,
        userId,
        action: AuditAction.PAYMENT_ACCOUNT_UPDATE,
        entity: AuditEntity.PAYMENT_ACCOUNT,
        entityId: this.provider.id,
        meta: { provider: this.provider.id, mode, ...this.extrasAuditMeta(dto) },
      });
    }
    return this.status(organizationId);
  }

  /** Campos opcionais do corpo: ausente = nao muda; '' = limpa; valor = grava (assinatura do webhook cifrada). */
  private extrasData(
    organizationId: number,
    dto: SaveMercadoPagoCredentialsDto,
  ): { publicKey?: string | null; webhookSecretEnc?: string | null; signatureAlertAt?: null } {
    const data: { publicKey?: string | null; webhookSecretEnc?: string | null; signatureAlertAt?: null } = {};
    if (dto.publicKey !== undefined) data.publicKey = dto.publicKey === '' ? null : dto.publicKey;
    if (dto.webhookSecret !== undefined) {
      data.webhookSecretEnc =
        dto.webhookSecret === '' ? null : encryptProviderToken(dto.webhookSecret, this.webhookSecretContext(organizationId));
      // Segredo novo/limpo: um novo problema de assinatura volta a avisar o Mestre.
      data.signatureAlertAt = null;
    }
    return data;
  }

  /** O QUE mudou, sem valor nenhum (o AuditService ainda remove chaves token/secret por seguranca). */
  private extrasAuditMeta(dto: SaveMercadoPagoCredentialsDto): Record<string, unknown> {
    const meta: Record<string, unknown> = {};
    if (dto.publicKey !== undefined) meta.publicKey = dto.publicKey === '' ? 'CLEARED' : 'SET';
    if (dto.webhookSecret !== undefined) meta.signatureKey = dto.webhookSecret === '' ? 'CLEARED' : 'SET';
    return meta;
  }

  /** Erro do provedor ao validar o token colado -> HTTP (mensagem SEM eco do token). */
  private credentialsError(error: unknown, organizationId: number) {
    if (error instanceof PaymentProviderError && ['UNAUTHORIZED', 'BAD_REQUEST', 'NOT_FOUND', 'INVALID_GRANT'].includes(error.kind)) {
      this.logger.warn(`Credenciais do Mercado Pago recusadas pelo provedor (grupo ${organizationId}).`);
      return paymentError(
        422,
        PaymentErrorCode.INVALID_CREDENTIALS,
        'O Mercado Pago recusou o Access Token informado. Confira se copiou o Access Token de PRODUÇÃO completo.',
      );
    }
    this.logger.warn(`Validacao das credenciais falhou (grupo ${organizationId}): ${(error as Error).message}`);
    return providerHttpError(error);
  }

  /** O segredo do webhook gravado decifra com alguma das chaves? (so leitura, sem regravar.) */
  private secretReadable(account: Pick<PaymentProviderAccount, 'organizationId' | 'webhookSecretEnc'>): boolean {
    if (!account.webhookSecretEnc) return true;
    try {
      decryptProviderTokenWithRotation(account.webhookSecretEnc, this.webhookSecretContext(account.organizationId));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Assinatura secreta do webhook DO GRUPO, decifrada (so em memoria). null = o grupo nao cadastrou. Ilegivel (chave
   * trocada) => `unreadable` (o webhook trata como gatilho com problema UNREADABLE). Decifrada com chave antiga =>
   * re-cifra com a primaria (condicional ao valor lido: uma vez, sem corrida).
   */
  async readWebhookSecret(
    account: Pick<PaymentProviderAccount, 'id' | 'organizationId' | 'webhookSecretEnc'>,
  ): Promise<string | null | 'unreadable'> {
    if (!account.webhookSecretEnc) return null;
    const ctx = this.webhookSecretContext(account.organizationId);
    let result: { plain: string; rotated: boolean };
    try {
      result = decryptProviderTokenWithRotation(account.webhookSecretEnc, ctx);
    } catch {
      return 'unreadable';
    }
    if (result.rotated) {
      await this.prisma.paymentProviderAccount.updateMany({
        where: { id: account.id, webhookSecretEnc: account.webhookSecretEnc },
        data: { webhookSecretEnc: encryptProviderToken(result.plain, ctx) },
      });
    }
    return result.plain;
  }

  // ---------------------------------------------------------------------------------------------
  // OAuth (opcional/avancado; dormente sem MERCADOPAGO_CLIENT_ID/SECRET/REDIRECT_URI)
  // ---------------------------------------------------------------------------------------------

  /** URL de autorizacao (o painel redireciona o Mestre para ela). Grava o nonce do state (uso unico). */
  async connectUrl(organizationId: number, userId: number): Promise<{ url: string }> {
    this.assertAvailable();
    if (!this.provider.isOAuthConfigured()) {
      throw paymentError(
        409,
        PaymentErrorCode.OAUTH_UNAVAILABLE,
        'A conexão automática (OAuth) não está habilitada no servidor. Cole as credenciais da conta em Financeiro.',
      );
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

  /**
   * Pix NAO RESOLVIDO de lancamentos em aberto do grupo (10.56, M3-a): pendente no provedor (mesmo ja vencido no relogio)
   * ou vencido localmente sem confirmacao, com validade ate 7 dias atras (pagamento no ultimo minuto + webhook atrasado).
   */
  countUnresolvedPix(organizationId: number, now: Date = new Date(), client: Tx | PrismaService = this.prisma): Promise<number> {
    return client.financialRecord.count({
      where: {
        organizationId,
        gatewayProvider: this.provider.id,
        gatewayPaymentId: { not: null },
        status: { in: [FinancialStatus.PENDING, FinancialStatus.OVERDUE] },
        gatewayStatus: { in: [...PIX_OPEN_GATEWAY_STATUSES, PIX_EXPIRED_UNCONFIRMED] },
        pixExpiresAt: { gt: new Date(now.getTime() - PIX_UNRESOLVED_WINDOW_MS) },
      },
    });
  }

  /**
   * Volta do OAuth (rota PUBLICA). Devolve SEMPRE a URL de redirecionamento ao painel (`?mp=ok|erro|pix-aberto`), nunca
   * detalhes: state invalido/expirado/JA USADO, Mestre que deixou de ser Mestre, `code` recusado, OAuth desligado no
   * servidor, conta de TESTE em producao => `mp=erro`; troca para OUTRA conta do provedor com Pix nao resolvido da conta
   * atual => `mp=pix-aberto`.
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
    if (!this.provider.isOAuthConfigured()) {
      this.logger.warn(`Callback do OAuth com o OAuth desligado no servidor (grupo ${state.organizationId}).`);
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

    const ctx = this.tokenContext(state.organizationId);
    const outcome = await this.withAccountLock(state.organizationId, 'exclusive', async (tx) => {
      const existing = await this.findAccount(state.organizationId, tx);
      const previousProviderUserId = existing?.providerUserId ?? null;
      const accountChanged = previousProviderUserId !== null && previousProviderUserId !== tokens.providerUserId;
      if (accountChanged && (await this.countUnresolvedPix(state.organizationId, now, tx)) > 0) {
        return { blocked: true as const };
      }
      const data = {
        mode: PaymentAccountMode.OAUTH,
        providerUserId: tokens.providerUserId,
        accessTokenEnc: encryptProviderToken(tokens.accessToken, ctx),
        refreshTokenEnc: tokens.refreshToken ? encryptProviderToken(tokens.refreshToken, ctx) : null,
        tokenExpiresAt: tokens.expiresAt,
        // OAuth: o token gira na renovacao; o "final do token" nao ajuda o Mestre a reconhecer nada.
        tokenHint: null,
        publicKey: tokens.publicKey,
        liveMode: tokens.liveMode,
        status: PaymentAccountStatus.CONNECTED,
        connectedAt: now,
        connectedById: state.userId,
        lastError: null,
        // B5: OAUTH confere o webhook so com o segredo do servidor; um segredo proprio antigo nao vale mais.
        webhookSecretEnc: null,
        signatureAlertAt: null,
      };
      await tx.paymentProviderAccount.upsert({
        where: { organizationId_provider: { organizationId: state.organizationId, provider: this.provider.id } },
        create: { organizationId: state.organizationId, provider: this.provider.id, ...data },
        update: data,
      });
      return { blocked: false as const, accountChanged, previousProviderUserId };
    });
    if (outcome.blocked) {
      // Os Pix abertos so podem ser conferidos/cancelados com o token da conta ATUAL: trocar agora perderia a baixa.
      this.logger.warn(`Troca de conta do provedor recusada: ha Pix nao resolvido da conta atual (grupo ${state.organizationId}).`);
      return target('pix-aberto');
    }
    await this.audit.record({
      organizationId: state.organizationId,
      userId: state.userId,
      action: AuditAction.PAYMENT_ACCOUNT_CONNECT,
      entity: AuditEntity.PAYMENT_ACCOUNT,
      entityId: this.provider.id,
      meta: {
        provider: this.provider.id,
        mode: PaymentAccountMode.OAUTH,
        providerUserId: tokens.providerUserId,
        liveMode: tokens.liveMode,
        ...(outcome.accountChanged ? { accountChanged: true, previousProviderUserId: outcome.previousProviderUserId } : {}),
      },
    });
    if (outcome.accountChanged) {
      await this.notifyMestres(state.organizationId, {
        title: 'Conta do Mercado Pago trocada',
        body: 'A conta do Mercado Pago que recebe os Pix do grupo foi trocada por outra. Se não foi você (ou outro Mestre), desconecte em Financeiro e avise o suporte.',
        type: 'FINANCE_PAYMENTS_ACCOUNT_CHANGED',
      });
    }
    return target('ok');
  }

  /**
   * Desconecta: apaga tokens, assinatura do webhook, chave publica e final do token e marca REVOKED (idempotente). Os
   * Pix abertos sao cancelados no provedor ANTES (pelo PaymentsConnectionController via
   * PixService.cancelOpenPixOfOrganization) e os lancamentos mantem o gatewayPaymentId (reconectar a MESMA conta volta a
   * conferi-los na reconciliacao). `openPix` vai para a auditoria.
   */
  async disconnect(
    organizationId: number,
    userId: number,
    openPix?: { cancelled: number; failed: number },
  ): Promise<PaymentAccountStatusDto> {
    const account = await this.findAccount(organizationId);
    if (
      account &&
      (account.accessTokenEnc || account.refreshTokenEnc || account.webhookSecretEnc || account.status !== PaymentAccountStatus.REVOKED)
    ) {
      await this.prisma.paymentProviderAccount.update({
        where: { id: account.id },
        data: {
          accessTokenEnc: null,
          refreshTokenEnc: null,
          tokenExpiresAt: null,
          webhookSecretEnc: null,
          tokenHint: null,
          publicKey: null,
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
        meta: { provider: this.provider.id, mode: account.mode, providerUserId: account.providerUserId, ...(openPix ? { openPix } : {}) },
      });
    }
    return this.status(organizationId);
  }

  // ---------------------------------------------------------------------------------------------
  // Token em uso
  // ---------------------------------------------------------------------------------------------

  /**
   * Access token valido da conta do grupo.
   *  - MANUAL: sem renovacao. `force` (o provedor respondeu 401/403 ao token em uso) => confere em /users/me: 401 =>
   *    conta ERROR + aviso ao Mestre ("cole as credenciais novamente") + MP_ACCOUNT_ERROR; 403/400 => 503 sem ERROR.
   *  - OAUTH: renova quando faltar menos de 7 dias para vencer (ou `force`). Refresh recusado (INVALID_GRANT) => conta
   *    ERROR + aviso + MP_ACCOUNT_ERROR. Sem o OAuth no servidor e o acesso vencido => ERROR ("cole as credenciais",
   *    B7). Falha transitoria com token ainda valido => segue com o token atual.
   * Token ilegivel (nenhuma chave decifra) => conta ERROR + aviso + MP_ACCOUNT_ERROR (nos dois modos; nunca crash).
   */
  async getConnected(organizationId: number, options: { force?: boolean } = {}): Promise<ConnectedAccount> {
    const account = await this.findAccount(organizationId);
    if (!account || account.status === PaymentAccountStatus.REVOKED || !account.accessTokenEnc) throw notConnectedError();
    if (account.status === PaymentAccountStatus.ERROR) throw accountError();
    if (account.mode === PaymentAccountMode.MANUAL) {
      const accessToken = await this.decryptOrMarkError(account);
      if (options.force) await this.confirmManualTokenOrMarkError(account, accessToken);
      return { account, accessToken };
    }
    const now = Date.now();
    const expiresAt = account.tokenExpiresAt?.getTime() ?? null;
    const needsRefresh = options.force || (expiresAt !== null && expiresAt - now < TOKEN_REFRESH_WINDOW_MS);
    if (!needsRefresh) return { account, accessToken: await this.decryptOrMarkError(account) };
    return this.refreshMutex.run(`token:${organizationId}`, () => this.refresh(organizationId, expiresAt, options.force ?? false));
  }

  /**
   * Conta MANUAL cujo token levou 401/403 numa chamada: CONFIRMA no provedor (GET /users/me) antes de derrubar a conta -
   * um 401/403 pontual (ex.: webhook forjado com `?org=` apontando um pagamento que o token nao alcanca) NAO pode por a
   * conta em ERROR. So 401 (ou invalid_grant) em /users/me = token revogado => ERROR + aviso + MP_ACCOUNT_ERROR. 403/400
   * ali = politica/permissao/transitorio (B3/B4, CONFERIR NO SANDBOX) => 503 sem ERROR. Token valido => volta (o chamador
   * repete a chamada uma vez e o erro original segue para ele). Provedor fora => 503.
   */
  private async confirmManualTokenOrMarkError(account: PaymentProviderAccount, accessToken: string): Promise<void> {
    try {
      await this.provider.validateCredentials({ accessToken });
    } catch (error) {
      if (
        error instanceof PaymentProviderError &&
        (error.kind === 'INVALID_GRANT' || (error.kind === 'UNAUTHORIZED' && error.status !== 403))
      ) {
        await this.markError(account, 'O Mercado Pago recusou o Access Token do grupo. Cole as credenciais novamente.');
        throw accountError();
      }
      if (error instanceof PaymentProviderError && (error.kind === 'UNAUTHORIZED' || error.kind === 'BAD_REQUEST')) {
        this.logger.warn(`Mercado Pago respondeu ${error.status ?? '?'} em /users/me (grupo ${account.organizationId}); conta mantida.`);
        throw paymentError(503, PaymentErrorCode.PROVIDER_UNAVAILABLE, 'O Mercado Pago não respondeu como esperado. Tente de novo em instantes.');
      }
      throw providerHttpError(error);
    }
  }

  /**
   * Decifra o access token (lista de chaves); ilegivel => conta ERROR + aviso (uma vez) + MP_ACCOUNT_ERROR. Decifrado
   * com chave antiga => re-cifra com a primaria (condicional ao valor lido: uma vez, sem corrida nem loop - M2).
   */
  private async decryptOrMarkError(account: PaymentProviderAccount): Promise<string> {
    const stored = account.accessTokenEnc!;
    const ctx = this.tokenContext(account.organizationId);
    let result: { plain: string; rotated: boolean };
    try {
      result = decryptProviderTokenWithRotation(stored, ctx);
    } catch {
      await this.markError(account, UNREADABLE_REASON);
      throw accountError();
    }
    if (result.rotated) {
      const accessTokenEnc = encryptProviderToken(result.plain, ctx);
      const rotated = await this.prisma.paymentProviderAccount.updateMany({
        where: { id: account.id, accessTokenEnc: stored },
        data: { accessTokenEnc },
      });
      if (rotated.count === 1) {
        account.accessTokenEnc = accessTokenEnc;
        this.logger.log(`Token do provedor re-cifrado com a chave atual (grupo ${account.organizationId}).`);
      }
    }
    return result.plain;
  }

  /**
   * Renovacao (SO contas OAUTH) serializada ENTRE REPLICAS por advisory lock transacional (por grupo) + KeyedMutex no
   * processo (achado M5). Dentro do lock rele a conta: outra replica pode ter acabado de renovar. Efeitos colaterais
   * (markError com auditoria/aviso) acontecem DEPOIS da transacao.
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
            error: account?.status === PaymentAccountStatus.ERROR ? accountError() : notConnectedError(),
          };
        }
        const ctx = this.tokenContext(organizationId);
        let accessToken: string;
        let refreshToken: string | null;
        try {
          accessToken = decryptProviderTokenWithRotation(account.accessTokenEnc, ctx).plain;
          refreshToken = account.refreshTokenEnc ? decryptProviderTokenWithRotation(account.refreshTokenEnc, ctx).plain : null;
        } catch {
          return { kind: 'mark-error', account, reason: UNREADABLE_REASON };
        }
        if (account.mode === PaymentAccountMode.MANUAL) {
          // A conta virou MANUAL no meio do caminho (o Mestre colou credenciais novas): nada a renovar, usa o token novo.
          return { kind: 'ok', connected: { account, accessToken } };
        }
        const currentExpiresAt = account.tokenExpiresAt?.getTime() ?? null;
        const stillValid = currentExpiresAt !== null && currentExpiresAt > Date.now();
        if (currentExpiresAt !== previousExpiresAt && currentExpiresAt !== null && currentExpiresAt - Date.now() >= TOKEN_REFRESH_WINDOW_MS) {
          return { kind: 'ok', connected: { account, accessToken } };
        }
        if (!this.provider.isOAuthConfigured()) {
          // B7: sem o OAuth no servidor nao ha como renovar. Ainda valido => usa; vencido (ou recusado) => ERROR com
          // mensagem "cole as credenciais" + aviso (uma vez), em vez de 503 eterno.
          if (!force && stillValid) return { kind: 'ok', connected: { account, accessToken } };
          return { kind: 'mark-error', account, reason: OAUTH_OFF_REASON };
        }
        if (!refreshToken) {
          if (!force && stillValid) return { kind: 'ok', connected: { account, accessToken } };
          return { kind: 'mark-error', account, reason: 'Sem refresh token para renovar o acesso.' };
        }
        try {
          const tokens = await this.provider.refreshToken(refreshToken);
          const updated = await tx.paymentProviderAccount.update({
            where: { id: account.id },
            data: {
              accessTokenEnc: encryptProviderToken(tokens.accessToken, ctx),
              // Sempre re-cifrado com a chave primaria atual (rotacao preguicosa - M2), mesmo sem refresh token novo.
              refreshTokenEnc: encryptProviderToken(tokens.refreshToken ?? refreshToken, ctx),
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
          if (!force && stillValid) {
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
      meta: { provider: account.provider, mode: account.mode, reason },
    });
    await this.notifyMestres(account.organizationId, {
      title: 'Reconecte o Mercado Pago',
      body:
        account.mode === PaymentAccountMode.MANUAL
          ? 'O Mercado Pago recusou as credenciais do grupo. Cole o Access Token de produção novamente em Financeiro para voltar a receber por Pix (os Pix já pagos serão conferidos depois).'
          : 'Não foi possível usar a conta do Mercado Pago do grupo. Reconecte em Financeiro colando o Access Token de produção da conta para voltar a receber por Pix (os Pix já pagos serão conferidos depois da reconexão).',
      type: 'FINANCE_PAYMENTS_ACCOUNT_ERROR',
    });
  }

  /**
   * Webhook de um Pix REAL do grupo cuja assinatura nao conferiu (10.56, A2): auditoria + aviso aos Mestres no maximo
   * UMA vez por janela (claim atomico em signatureAlertAt - entre replicas). `notify=false` (segredo do SERVIDOR, que o
   * Mestre nao controla) so audita. Nunca o segredo/assinatura no texto.
   */
  async alertSignatureProblem(
    organizationId: number,
    problem: 'MISSING' | 'MISMATCH' | 'UNREADABLE',
    options: { notify: boolean; windowMs: number; now?: Date },
  ): Promise<boolean> {
    const now = options.now ?? new Date();
    const claim = await this.prisma.paymentProviderAccount.updateMany({
      where: {
        organizationId,
        provider: this.provider.id,
        OR: [{ signatureAlertAt: null }, { signatureAlertAt: { lt: new Date(now.getTime() - options.windowMs) } }],
      },
      data: { signatureAlertAt: now },
    });
    if (claim.count === 0) return false;
    await this.audit.record({
      organizationId,
      userId: null,
      action: AuditAction.PAYMENT_WEBHOOK_SIGNATURE_PROBLEM,
      entity: AuditEntity.PAYMENT_ACCOUNT,
      entityId: this.provider.id,
      meta: { provider: this.provider.id, problem, notified: options.notify },
    });
    if (options.notify) {
      await this.notifyMestres(organizationId, {
        title: 'Webhook do Mercado Pago: assinatura não confere',
        body:
          problem === 'UNREADABLE'
            ? 'O segredo do webhook salvo no GingApp não pode mais ser lido. Cole o segredo do webhook de novo em Financeiro. Os Pix continuam sendo confirmados pela consulta ao Mercado Pago.'
            : 'A assinatura dos avisos do Mercado Pago não confere com o segredo do webhook salvo no GingApp. Confira o segredo em Financeiro (ou remova-o). Os Pix continuam sendo confirmados pela consulta ao Mercado Pago.',
        type: 'FINANCE_PAYMENTS_WEBHOOK_SIGNATURE',
      });
    }
    return true;
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

  /** Renova (em lote, pela reconciliacao) os tokens de contas OAUTH que vencem em breve. MANUAL nunca entra. */
  async refreshExpiring(limit = 20): Promise<number> {
    const soon = new Date(Date.now() + TOKEN_REFRESH_WINDOW_MS);
    const accounts = await this.prisma.paymentProviderAccount.findMany({
      where: {
        provider: this.provider.id,
        mode: PaymentAccountMode.OAUTH,
        status: PaymentAccountStatus.CONNECTED,
        tokenExpiresAt: { lt: soon },
      },
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
