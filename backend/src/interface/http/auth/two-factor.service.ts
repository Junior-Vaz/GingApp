import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as QRCode from 'qrcode';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { buildOtpAuthUri, generateTotpSecret, verifyTotp } from '../../../shared/security/totp';
import {
  challengeJwtSecret,
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  findRecoveryHash,
  generateRecoveryCodes,
  hashRecoveryCode,
} from '../../../shared/security/two-factor-crypto';

/** Validade do desafio entre a senha correta e o codigo (5 min). */
export const CHALLENGE_TTL_SECONDS = 5 * 60;
export const WRONG_CODE = 'Código de verificação incorreto.';
export const CHALLENGE_EXPIRED = 'Sessão de verificação expirada ou inválida. Faça login novamente.';
export const TOO_MANY_FAILURES = 'Muitas tentativas incorretas. Aguarde alguns minutos e tente novamente.';
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

/** Falhas de codigo toleradas por usuario na janela de 15 min (TWO_FACTOR_MAX_FAILURES; padrao 5). */
function maxFailures(): number {
  const n = Number(process.env.TWO_FACTOR_MAX_FAILURES);
  return Number.isInteger(n) && n > 0 ? n : 5;
}

export interface ChallengeClaims {
  sub: number;
  /** 'member' = login de grupo (organizationId obrigatorio); 'platform' = login da equipe. */
  scope: 'member' | 'platform';
  organizationId?: number;
}

export interface TwoFactorSecondFactor {
  code?: string;
  recoveryCode?: string;
}

export interface TwoFactorSetupResult {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

/**
 * 2FA TOTP opt-in. O segredo e' cifrado em repouso (two-factor-crypto.ts) e so' sai daqui no setup. Erros de codigo
 * sao 400 (NUNCA 401: os frontends tratam 401 como sessao expirada); excesso de falhas e' 429. Toda falha e' gravada
 * na auditoria e e' ela que alimenta o bloqueio temporario por usuario.
 */
@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  // ----------------------------------------------------------------- desafio de login

  /** JWT curto (5 min), assinado com segredo DERIVADO (nunca vale como token de acesso) e `purpose: '2fa'`. */
  signChallenge(claims: ChallengeClaims): Promise<string> {
    return this.jwt.signAsync(
      { ...claims, purpose: '2fa' },
      { secret: challengeJwtSecret(), expiresIn: CHALLENGE_TTL_SECONDS },
    );
  }

  async readChallenge(token: string): Promise<ChallengeClaims> {
    try {
      const payload = await this.jwt.verifyAsync<ChallengeClaims & { purpose?: string }>(token, {
        secret: challengeJwtSecret(),
      });
      if (payload.purpose !== '2fa' || typeof payload.sub !== 'number') throw new Error('purpose');
      return { sub: payload.sub, scope: payload.scope, organizationId: payload.organizationId };
    } catch {
      throw new BadRequestException(CHALLENGE_EXPIRED);
    }
  }

  // ----------------------------------------------------------------- setup / enable / disable

  /** Gera e guarda (cifrado) um segredo PENDENTE; so' vale depois do `enable`. Chamar de novo troca o pendente. */
  async setup(actor: AuthenticatedUser): Promise<TwoFactorSetupResult> {
    const user = await this.requireUser(actor.id);
    if (user.twoFactorEnabled) throw new ConflictException('A verificação em duas etapas já está ativa.');
    const secret = generateTotpSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: encryptTwoFactorSecret(secret) } });
    const otpauthUrl = buildOtpAuthUri(secret, user.email);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  /** Confirma o setup com um codigo valido, ativa o 2FA e devolve os codigos de recuperacao (UMA unica vez). */
  async enable(actor: AuthenticatedUser, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.requireUser(actor.id);
    if (user.twoFactorEnabled) throw new ConflictException('A verificação em duas etapas já está ativa.');
    if (!user.twoFactorSecret) {
      throw new BadRequestException('Inicie a configuração antes de ativar (POST /auth/2fa/setup).');
    }
    await this.verifyFactor(user, { code });
    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true, twoFactorRecoveryHashes: recoveryCodes.map(hashRecoveryCode) },
    });
    await this.audit.record({
      organizationId: actor.organizationId ?? null,
      userId: user.id,
      action: AuditAction.TWO_FACTOR_ENABLE,
      entity: AuditEntity.USER,
      entityId: user.id,
    });
    return { recoveryCodes };
  }

  /** Desativa: exige a SENHA (400 se errada) E um segundo fator (codigo TOTP ou de recuperacao). */
  async disable(actor: AuthenticatedUser, password: string, factor: TwoFactorSecondFactor): Promise<{ twoFactorEnabled: false }> {
    const user = await this.requireUser(actor.id);
    if (!user.twoFactorEnabled) throw new BadRequestException('A verificação em duas etapas não está ativa.');
    if (!(await bcrypt.compare(password, user.passwordHash))) throw new BadRequestException('Senha incorreta.');
    await this.verifyFactor(user, factor);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecoveryHashes: [], twoFactorLastStep: null },
    });
    await this.audit.record({
      organizationId: actor.organizationId ?? null,
      userId: user.id,
      action: AuditAction.TWO_FACTOR_DISABLE,
      entity: AuditEntity.USER,
      entityId: user.id,
    });
    return { twoFactorEnabled: false };
  }

  // ----------------------------------------------------------------- verificacao do 2o fator

  /**
   * Confere um codigo TOTP (anti-replay: passo ja usado e' recusado) OU um codigo de recuperacao (uso unico, o hash e'
   * removido atomicamente). Lanca 429 se o usuario estourou as falhas recentes e 400 em codigo errado (gravando a falha).
   * Devolve qual fator foi usado.
   */
  async verifyFactor(user: User, factor: TwoFactorSecondFactor, organizationId?: number | null): Promise<'totp' | 'recovery'> {
    await this.assertNotLocked(user.id);
    const hasCode = !!factor.code;
    const hasRecovery = !!factor.recoveryCode;
    if (hasCode === hasRecovery) {
      throw new BadRequestException('Informe o código do aplicativo OU um código de recuperação.');
    }
    if (hasCode) {
      if (await this.consumeTotp(user, factor.code as string)) return 'totp';
    } else if (await this.consumeRecoveryCode(user, factor.recoveryCode as string, organizationId ?? null)) {
      return 'recovery';
    }
    await this.audit.record({
      organizationId: organizationId ?? null,
      userId: user.id,
      action: AuditAction.TWO_FACTOR_FAILURE,
      entity: AuditEntity.USER,
      entityId: user.id,
      meta: { factor: hasCode ? 'totp' : 'recovery' },
    });
    throw new BadRequestException(WRONG_CODE);
  }

  private async consumeTotp(user: User, code: string): Promise<boolean> {
    if (!user.twoFactorSecret) return false;
    let secret: string;
    try {
      secret = decryptTwoFactorSecret(user.twoFactorSecret);
    } catch (error) {
      this.logger.error(`Segredo 2FA ilegivel (usuario ${user.id}): ${error instanceof Error ? error.message : String(error)}`);
      throw new HttpException(
        'Verificação em duas etapas indisponível para esta conta. Contate o suporte.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const step = verifyTotp(secret, code);
    if (step === null) return false;
    // Anti-replay atomico: so' avanca se o passo for maior que o ultimo aceito.
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, OR: [{ twoFactorLastStep: null }, { twoFactorLastStep: { lt: step } }] },
      data: { twoFactorLastStep: step },
    });
    return count === 1;
  }

  private async consumeRecoveryCode(user: User, input: string, organizationId: number | null): Promise<boolean> {
    const index = findRecoveryHash(user.twoFactorRecoveryHashes, input);
    if (index < 0) return false;
    const hash = user.twoFactorRecoveryHashes[index];
    const remaining = user.twoFactorRecoveryHashes.filter((_, i) => i !== index);
    // Condicional ao hash ainda estar na lista: dois usos simultaneos do mesmo codigo => so' um vence.
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, twoFactorRecoveryHashes: { has: hash } },
      data: { twoFactorRecoveryHashes: remaining },
    });
    if (count !== 1) return false;
    await this.audit.record({
      organizationId,
      userId: user.id,
      action: AuditAction.TWO_FACTOR_RECOVERY_USED,
      entity: AuditEntity.USER,
      entityId: user.id,
      meta: { remaining: remaining.length },
    });
    return true;
  }

  private async assertNotLocked(userId: number): Promise<void> {
    const since = new Date(Date.now() - FAILURE_WINDOW_MS);
    const failures = await this.prisma.auditLog.count({
      where: { userId, action: AuditAction.TWO_FACTOR_FAILURE, createdAt: { gte: since } },
    });
    if (failures >= maxFailures()) throw new HttpException(TOO_MANY_FAILURES, HttpStatus.TOO_MANY_REQUESTS);
  }

  private async requireUser(id: number): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.status !== 'ACTIVE') throw new BadRequestException('Usuário inválido ou inativo.');
    return user;
  }

  /** Estado do 2FA para GET /auth/me (nunca o segredo nem os hashes). */
  static status(user: Pick<User, 'twoFactorEnabled' | 'twoFactorRecoveryHashes'>): {
    twoFactorEnabled: boolean;
    recoveryCodesRemaining: number;
  } {
    return {
      twoFactorEnabled: user.twoFactorEnabled,
      recoveryCodesRemaining: user.twoFactorEnabled ? user.twoFactorRecoveryHashes.length : 0,
    };
  }
}
