import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OrgRole, User, UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { AuthenticatedUser, JwtPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { isMembershipBlockedByInactiveStudent } from '../../../shared/access/inactive-student-access';
import { buildTermsStatus } from '../../../shared/legal/legal-documents';
import { BCRYPT_ROUNDS } from '../../../shared/security/password-policy';
import { findUserIdsByEmail } from '../../../shared/security/email-lookup';
import { issuedAtFor, revocationCutoff } from '../../../shared/security/token-revocation';
import { AuthResponse, LoginResponse, TwoFactorChallengeResponse } from './auth-response.interface';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { VerifyTwoFactorDto } from './dto/two-factor.dto';
import { CHALLENGE_EXPIRED, ChallengeClaims, TwoFactorService } from './two-factor.service';

/** Mensagem de erro genérica — nunca revela se o e-mail existe nem qual tipo de conta é
 * (PLANO_PROJETO.md §3.1, mesmo comportamento do GestorPrint). */
const INVALID_CREDENTIALS = 'Credenciais inválidas.';

/** Senha atual errada na troca de senha: 400 (e NÃO 401 — os frontends tratam 401 como sessão expirada
 * e deslogam o usuário). */
export const WRONG_CURRENT_PASSWORD = 'Senha atual incorreta.';
export const SAME_PASSWORD = 'A nova senha deve ser diferente da atual.';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly audit: AuditService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  /**
   * Login de usuários MEMBER (mestre/professor/aluno/responsável).
   *
   * Um usuário pode ter memberships ativos em mais de uma organização. Se houver só um,
   * ele é selecionado automaticamente; se houver mais de um, `organizationSlug` é exigido
   * no payload (decisão de modelagem registrada em LoginDto).
   */
  async login(dto: LoginDto): Promise<LoginResponse> {
    const candidates = await this.findUsersByEmail(dto.email);
    const eligible = candidates.filter((u) => u.userType === UserType.MEMBER && u.status === 'ACTIVE');
    const user = await this.findPasswordMatch(eligible, dto.password);
    if (!user) {
      await this.auditLoginFailure('member', dto.email, eligible[0], eligible.length > 0 ? 'BAD_PASSWORD' : 'UNKNOWN_USER');
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const activeMemberships = await this.prisma.organizationUser.findMany({
      // Grupo INACTIVE (desativado pela plataforma) não conta: sem vínculo utilizável => 401 genérico.
      where: { userId: user.id, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
      include: { organization: true },
    });
    // Aluno inativado: o vínculo ALUNO daquele grupo não é utilizável (os outros vínculos da pessoa seguem).
    const memberships = [];
    for (const candidate of activeMemberships) {
      if (!(await isMembershipBlockedByInactiveStudent(this.prisma, candidate))) memberships.push(candidate);
    }

    if (memberships.length === 0) {
      await this.auditLoginFailure('member', dto.email, user, 'NO_ACTIVE_MEMBERSHIP');
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    let membership = memberships[0];
    if (memberships.length > 1) {
      if (!dto.organizationSlug) {
        throw new BadRequestException(
          'Usuário pertence a múltiplas organizações. Informe organizationSlug.',
        );
      }
      const found = memberships.find((m) => m.organization.slug === dto.organizationSlug);
      if (!found) {
        await this.auditLoginFailure('member', dto.email, user, 'UNKNOWN_ORGANIZATION');
        throw new UnauthorizedException(INVALID_CREDENTIALS);
      }
      membership = found;
    }

    if (user.twoFactorEnabled) {
      // Senha correta, mas falta o 2o fator: sem sessao ainda (LOGIN_SUCCESS so' depois do codigo).
      return this.challengeFor({ sub: user.id, scope: 'member', organizationId: membership.organizationId });
    }
    return this.memberSession(user, membership);
  }

  private challengeFor(claims: ChallengeClaims): Promise<TwoFactorChallengeResponse> {
    return this.twoFactor
      .signChallenge(claims)
      .then((challengeToken) => ({ twoFactorRequired: true as const, challengeToken }));
  }

  /** Sessao completa (auditoria + accessToken) de um login de grupo ja autenticado (senha e, se houver, 2FA). */
  private async memberSession(
    user: User,
    membership: { organizationId: number; role: OrgRole; organization: { slug: string } },
  ): Promise<AuthResponse> {
    await this.audit.record({
      organizationId: membership.organizationId,
      userId: user.id,
      action: AuditAction.LOGIN_SUCCESS,
      entity: AuditEntity.USER,
      entityId: user.id,
      meta: { scope: 'member', role: membership.role },
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      userType: user.userType,
      isSuperAdmin: user.isSuperAdmin,
      organizationId: membership.organizationId,
      role: membership.role,
    };

    return {
      accessToken: await this.signAccessToken(payload, user.tokenValidAfter),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        userType: user.userType,
        isSuperAdmin: user.isSuperAdmin,
        organizationId: membership.organizationId,
        organizationSlug: membership.organization.slug,
        role: membership.role,
        mustChangePassword: user.mustChangePassword,
        twoFactorEnabled: user.twoFactorEnabled,
        ...buildTermsStatus(user),
      },
    };
  }

  /** Login exclusivo da equipe interna GingApp (userType = 'PLATFORM'). */
  async platformLogin(dto: PlatformLoginDto): Promise<LoginResponse> {
    const candidates = await this.findUsersByEmail(dto.email);
    const eligible = candidates.filter(
      (u) => u.status === 'ACTIVE' && (u.userType === UserType.PLATFORM || u.isSuperAdmin),
    );
    const user = await this.findPasswordMatch(eligible, dto.password);
    if (!user) {
      await this.auditLoginFailure('platform', dto.email, eligible[0], eligible.length > 0 ? 'BAD_PASSWORD' : 'UNKNOWN_USER');
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (user.twoFactorEnabled) {
      return this.challengeFor({ sub: user.id, scope: 'platform' });
    }
    return this.platformSession(user);
  }

  private async platformSession(user: User): Promise<AuthResponse> {
    await this.audit.record({
      organizationId: null,
      userId: user.id,
      action: AuditAction.LOGIN_SUCCESS,
      entity: AuditEntity.USER,
      entityId: user.id,
      meta: { scope: 'platform' },
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      userType: user.userType,
      isSuperAdmin: user.isSuperAdmin,
    };

    return {
      accessToken: await this.signAccessToken(payload, user.tokenValidAfter),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        userType: user.userType,
        isSuperAdmin: user.isSuperAdmin,
        mustChangePassword: user.mustChangePassword,
        twoFactorEnabled: user.twoFactorEnabled,
        ...buildTermsStatus(user),
      },
    };
  }

  /**
   * Segundo passo do login com 2FA: valida o desafio (JWT de 5 min emitido apos a senha correta), confere o codigo TOTP
   * ou de recuperacao e so entao emite o accessToken normal. Reconfere conta e vinculo (podem ter mudado nos 5 min).
   */
  async verifyTwoFactor(dto: VerifyTwoFactorDto): Promise<AuthResponse> {
    const claims = await this.twoFactor.readChallenge(dto.challengeToken);
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.status !== 'ACTIVE' || !user.twoFactorEnabled) {
      throw new BadRequestException(CHALLENGE_EXPIRED);
    }
    await this.twoFactor.verifyFactor(user, dto, claims.organizationId ?? null);

    if (claims.scope === 'platform') {
      if (!(user.userType === UserType.PLATFORM || user.isSuperAdmin)) throw new BadRequestException(CHALLENGE_EXPIRED);
      return this.platformSession(user);
    }
    const membership = claims.organizationId
      ? await this.prisma.organizationUser.findFirst({
          where: { userId: user.id, organizationId: claims.organizationId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
          include: { organization: true },
        })
      : null;
    if (!membership || (await isMembershipBlockedByInactiveStudent(this.prisma, membership))) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    return this.memberSession(user, membership);
  }

  /**
   * Troca da PRÓPRIA senha (MEMBER ou PLATFORM). A política da senha nova (12..72 bytes, sem
   * Dev@12345) é validada no DTO; aqui: senha atual correta (400, não 401), nova diferente da atual,
   * novo hash com BCRYPT_ROUNDS e REVOGAÇÃO de todas as outras sessões (tokenValidAfter). Devolve um
   * accessToken NOVO (mesmo formato/expiração do login) para a sessão atual continuar — o token
   * usado na chamada deixa de valer, junto com todos os demais.
   *
   * Nunca loga nem devolve senha/hash. A troca é condicional ao hash lido (corrida entre duas
   * trocas simultâneas: a segunda recebe 409 em vez de sobrescrever).
   */
  async changePassword(actor: AuthenticatedUser, dto: ChangePasswordDto): Promise<{ accessToken: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: actor.id } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Usuário inválido ou inativo.');
    }

    // MEMBER: o vínculo do token precisa continuar ativo (não se emite sessão nova para quem foi removido).
    let membershipPayload: Pick<JwtPayload, 'organizationId' | 'role'> = {};
    if (user.userType === UserType.MEMBER) {
      const membership = actor.organizationId
        ? await this.prisma.organizationUser.findFirst({
            where: {
              userId: user.id,
              organizationId: actor.organizationId,
              status: 'ACTIVE',
              organization: { status: 'ACTIVE' },
            },
          })
        : null;
      if (!membership || (await isMembershipBlockedByInactiveStudent(this.prisma, membership))) {
        throw new UnauthorizedException('Usuário inválido ou inativo.');
      }
      membershipPayload = { organizationId: membership.organizationId, role: membership.role };
    }

    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException(WRONG_CURRENT_PASSWORD);
    }
    if (
      dto.newPassword === dto.currentPassword ||
      (await bcrypt.compare(dto.newPassword, user.passwordHash))
    ) {
      throw new BadRequestException(SAME_PASSWORD);
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    const tokenValidAfter = revocationCutoff();
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, passwordHash: user.passwordHash, status: 'ACTIVE' },
      data: { passwordHash, tokenValidAfter, mustChangePassword: false },
    });
    if (count !== 1) {
      throw new ConflictException('A senha foi alterada em outra sessão. Tente novamente.');
    }

    await this.audit.record({
      organizationId: actor.organizationId ?? null,
      userId: user.id,
      action: AuditAction.PASSWORD_CHANGE,
      entity: AuditEntity.USER,
      entityId: user.id,
      meta: { self: true },
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      userType: user.userType,
      isSuperAdmin: user.isSuperAdmin,
      ...membershipPayload,
    };
    return { accessToken: await this.signAccessToken(payload, tokenValidAfter) };
  }

  /**
   * Falha de login na trilha de auditoria: SEM senha, so o motivo e a CONTAGEM de falhas recentes (ultimos
   * 15 min) do usuario. Usuario identificado (e-mail existe): autor = ele, grupo = o unico vinculo ativo dele (se
   * houver um so). E-mail desconhecido: sem autor; guarda so o e-mail digitado (e so se parecer e-mail, para nao
   * gravar uma senha digitada no campo errado).
   */
  private async auditLoginFailure(
    scope: 'member' | 'platform',
    rawEmail: string,
    user: User | undefined,
    reason: string,
  ): Promise<void> {
    try {
      let organizationId: number | null = null;
      let recentFailures = 1;
      if (user) {
        const since = new Date(Date.now() - 15 * 60 * 1000);
        recentFailures =
          1 + (await this.prisma.auditLog.count({ where: { userId: user.id, action: AuditAction.LOGIN_FAILURE, createdAt: { gte: since } } }));
        if (scope === 'member') {
          const memberships = await this.prisma.organizationUser.findMany({
            where: { userId: user.id, status: 'ACTIVE' },
            select: { organizationId: true },
            take: 2,
          });
          if (memberships.length === 1) organizationId = memberships[0].organizationId;
        }
      }
      const typed = rawEmail.trim().toLowerCase();
      await this.audit.record({
        organizationId,
        userId: user?.id ?? null,
        action: AuditAction.LOGIN_FAILURE,
        entity: AuditEntity.USER,
        entityId: user?.id ?? null,
        meta: { scope, reason, recentFailures, ...(!user && typed.includes('@') ? { email: typed.slice(0, 120) } : {}) },
      });
    } catch {
      // Auditoria nunca pode mudar a resposta do login (AuditService.record ja nao lanca; o count acima sim poderia).
    }
  }

  /**
   * Usuários cujo e-mail coincide (igualdade exata, sem LIKE) com o digitado, sem diferenciar maiúsculas/espaços: contas antigas
   * podem ter sido gravadas com maiúsculas (ex.: professor cadastrado antes da normalização), e o
   * login normalizado não pode deixá-las de fora. Em geral volta 0 ou 1 linha.
   */
  private async findUsersByEmail(rawEmail: string): Promise<User[]> {
    const ids = await findUserIdsByEmail(this.prisma, rawEmail);
    if (ids.length === 0) return [];
    return this.prisma.user.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
  }

  /** Primeiro candidato cuja senha confere (só há mais de um candidato com contas legadas que diferem
   * apenas na caixa do e-mail). */
  private async findPasswordMatch(candidates: User[], password: string): Promise<User | null> {
    for (const candidate of candidates) {
      if (await bcrypt.compare(password, candidate.passwordHash)) {
        return candidate;
      }
    }
    return null;
  }

  /** Assina o JWT; depois de uma revogação o `iat` nunca fica antes do corte (ver token-revocation.ts). */
  private signAccessToken(payload: JwtPayload, tokenValidAfter: Date | null): Promise<string> {
    return this.jwtService.signAsync({ ...payload, iat: issuedAtFor(tokenValidAfter) });
  }
}
