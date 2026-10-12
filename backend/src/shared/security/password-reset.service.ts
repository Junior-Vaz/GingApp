import { BadRequestException, Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { OrgRole, User, UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { isMembershipBlockedByInactiveStudent } from '../access/inactive-student-access';
import { AuditAction, AuditEntity } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import { FrontendKind, frontendBaseUrl } from '../mail/mail.config';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { findUserIdsByEmail } from './email-lookup';
import {
  generatePasswordToken,
  hashPasswordToken,
  PasswordTokenPurpose,
  RESET_TOKEN_TTL_MS,
  tokenTtlMs,
} from './password-reset-token';
import { BCRYPT_ROUNDS } from './password-policy';
import { revocationCutoff } from './token-revocation';

export const INVALID_RESET_LINK = 'Link inválido ou expirado. Solicite um novo.';
export const RESET_DISABLED_MESSAGE = 'A redefinição de senha por e-mail não está habilitada neste ambiente.';
export const FORGOT_ACCEPTED_MESSAGE = 'Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.';
export const RESET_DONE_MESSAGE = 'Senha redefinida com sucesso. Entre com a nova senha.';

/** Pedidos de reset expirados há mais de 7 dias são apagados de carona num novo pedido. */
const PURGE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Frontend de destino conforme o papel: aluno/responsável -> app; mestre/professor -> painel; equipe -> admin. */
export function frontendForRole(role: OrgRole): FrontendKind {
  return role === OrgRole.ALUNO || role === OrgRole.RESPONSAVEL ? 'APP' : 'PAINEL';
}

interface ResetTarget {
  user: User;
  frontend: FrontendKind;
}

/**
 * Redefinição/definição de senha por e-mail (E05): "esqueci a senha" e convite de aluno/responsável.
 *
 *  - O pedido NUNCA revela se o e-mail existe: o trabalho (consulta + token + envio) roda em segundo plano
 *    depois que o controller já respondeu 202, então nem o conteúdo nem o tempo da resposta diferem.
 *  - Token aleatório de 256 bits, só o SHA-256 vai ao banco, uso único; um token novo invalida os anteriores.
 *  - Respeita grupo inativo e aluno inativo: sem vínculo utilizável não há e-mail nem reset.
 *  - Nada sensível é logado (nem e-mail, nem token, nem link).
 */
@Injectable()
export class PasswordResetService implements OnModuleDestroy {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  isEnabled(): boolean {
    return this.mail.isEnabled();
  }

  /** Agenda o processamento do pedido em segundo plano e devolve na hora (a resposta é sempre a mesma). */
  requestReset(email: string, organizationSlug?: string): void {
    if (!this.isEnabled()) throw new ServiceUnavailableException(RESET_DISABLED_MESSAGE);
    const job = this.processRequest(email, organizationSlug)
      .catch(() => this.logger.warn('Falha ao processar um pedido de redefinição de senha.'))
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  /** Aguarda os pedidos em andamento (testes e desligamento ordenado). */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.drain();
  }

  private async processRequest(email: string, organizationSlug?: string): Promise<void> {
    const target = await this.findTarget(email, organizationSlug);
    if (!target) return;
    const base = frontendBaseUrl(target.frontend);
    if (!base) {
      this.logger.warn(`URL do frontend (${target.frontend}) não configurada: e-mail de redefinição não enviado.`);
      return;
    }
    const token = await this.issueToken(target.user.id, 'RESET');
    await this.mail.sendPasswordReset({
      to: target.user.email,
      name: target.user.name,
      link: buildLink(base, token),
      expiresInMinutes: RESET_TOKEN_TTL_MS / 60_000,
    });
    // Limpeza oportunista (barata e idempotente) de tokens vencidos há muito tempo.
    await this.prisma.passwordResetToken
      .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - PURGE_AFTER_MS) } } })
      .catch(() => undefined);
  }

  /**
   * Convite por e-mail (aluno/responsável recém-criado): token INVITE de 72 h e e-mail com o link do APP.
   * Devolve false se o e-mail estiver desligado, sem URL do app ou o envio falhar (o acesso já foi criado;
   * o Mestre vê `inviteSent: false`).
   */
  async sendInvite(user: { id: number; email: string; name: string }, groupName: string): Promise<boolean> {
    if (!this.isEnabled()) return false;
    const base = frontendBaseUrl('APP');
    if (!base) {
      this.logger.warn('APP_URL não configurada: convite por e-mail não enviado.');
      return false;
    }
    const token = await this.issueToken(user.id, 'INVITE');
    return this.mail.sendInvite({
      to: user.email,
      name: user.name,
      groupName,
      link: buildLink(base, token),
      expiresInHours: tokenTtlMs('INVITE') / 3_600_000,
    });
  }

  /** Cria um token novo e invalida os anteriores ainda abertos do mesmo usuário. Devolve o token em claro. */
  async issueToken(userId: number, purpose: PasswordTokenPurpose): Promise<string> {
    const { token, tokenHash } = generatePasswordToken();
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } }),
      this.prisma.passwordResetToken.create({
        data: { userId, tokenHash, purpose, expiresAt: new Date(now.getTime() + tokenTtlMs(purpose)) },
      }),
    ]);
    return token;
  }

  /**
   * Consome o token e grava a senha nova: revoga TODAS as sessões (tokenValidAfter) e zera mustChangePassword.
   * Qualquer falha de validação do link (inexistente, usado, expirado, conta inativa/sem vínculo utilizável)
   * devolve a MESMA mensagem 400. A política da senha já foi validada no DTO (@IsNewPassword).
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashPasswordToken(token) },
      include: { user: true },
    });
    const now = new Date();
    if (!record || record.usedAt || record.expiresAt <= now) throw new BadRequestException(INVALID_RESET_LINK);
    if (!(await this.isUsable(record.user))) throw new BadRequestException(INVALID_RESET_LINK);

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction(async (tx) => {
      // Condicional: dois usos simultâneos do mesmo link => só um vence.
      const { count } = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (count !== 1) throw new BadRequestException(INVALID_RESET_LINK);
      await tx.passwordResetToken.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: now } });
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, tokenValidAfter: revocationCutoff(), mustChangePassword: false },
      });
    });
    // Autor = o proprio dono da conta (o link prova a posse do e-mail); grupo so quando ha um unico vinculo ativo.
    const memberships = await this.prisma.organizationUser.findMany({
      where: { userId: record.userId, status: 'ACTIVE' },
      select: { organizationId: true },
      take: 2,
    });
    await this.audit.record({
      organizationId: memberships.length === 1 ? memberships[0].organizationId : null,
      userId: record.userId,
      action: AuditAction.PASSWORD_RESET,
      entity: AuditEntity.USER,
      entityId: record.userId,
      meta: { via: 'email-link', purpose: record.purpose },
    });
  }

  /** Conta pode redefinir a senha: ativa e (equipe da plataforma OU com algum vínculo utilizável). */
  private async isUsable(user: User): Promise<boolean> {
    if (user.status !== 'ACTIVE') return false;
    if (user.isSuperAdmin || user.userType === UserType.PLATFORM) return true;
    return (await this.usableMemberships(user.id)).length > 0;
  }

  private async usableMemberships(userId: number, organizationSlug?: string) {
    const memberships = await this.prisma.organizationUser.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        organization: { status: 'ACTIVE', ...(organizationSlug ? { slug: organizationSlug } : {}) },
      },
      orderBy: { id: 'asc' },
    });
    const usable: typeof memberships = [];
    for (const m of memberships) {
      if (!(await isMembershipBlockedByInactiveStudent(this.prisma, m))) usable.push(m);
    }
    return usable;
  }

  private async findTarget(email: string, organizationSlug?: string): Promise<ResetTarget | null> {
    const ids = await findUserIdsByEmail(this.prisma, email, 5);
    for (const id of ids) {
      const user = await this.prisma.user.findUnique({ where: { id } });
      if (!user || user.status !== 'ACTIVE') continue;
      if (user.isSuperAdmin || user.userType === UserType.PLATFORM) return { user, frontend: 'ADMIN' };
      const [membership] = await this.usableMemberships(user.id, organizationSlug);
      if (membership) return { user, frontend: frontendForRole(membership.role) };
    }
    return null;
  }
}

function buildLink(base: string, token: string): string {
  return `${base}/redefinir-senha?token=${encodeURIComponent(token)}`;
}
