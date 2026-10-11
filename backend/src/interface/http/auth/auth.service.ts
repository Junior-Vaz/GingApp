import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User, UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { AuthenticatedUser, JwtPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { BCRYPT_ROUNDS } from '../../../shared/security/password-policy';
import { findUserIdsByEmail } from '../../../shared/security/email-lookup';
import { issuedAtFor, revocationCutoff } from '../../../shared/security/token-revocation';
import { AuthResponse } from './auth-response.interface';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { PlatformLoginDto } from './dto/platform-login.dto';

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
  ) {}

  /**
   * Login de usuários MEMBER (mestre/professor/aluno/responsável).
   *
   * Um usuário pode ter memberships ativos em mais de uma organização. Se houver só um,
   * ele é selecionado automaticamente; se houver mais de um, `organizationSlug` é exigido
   * no payload (decisão de modelagem registrada em LoginDto).
   */
  async login(dto: LoginDto): Promise<AuthResponse> {
    const candidates = await this.findUsersByEmail(dto.email);
    const user = await this.findPasswordMatch(
      candidates.filter((u) => u.userType === UserType.MEMBER && u.status === 'ACTIVE'),
      dto.password,
    );
    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const memberships = await this.prisma.organizationUser.findMany({
      // Grupo INACTIVE (desativado pela plataforma) não conta: sem vínculo utilizável => 401 genérico.
      where: { userId: user.id, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
      include: { organization: true },
    });

    if (memberships.length === 0) {
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
        throw new UnauthorizedException(INVALID_CREDENTIALS);
      }
      membership = found;
    }

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
      },
    };
  }

  /** Login exclusivo da equipe interna GingApp (userType = 'PLATFORM'). */
  async platformLogin(dto: PlatformLoginDto): Promise<AuthResponse> {
    const candidates = await this.findUsersByEmail(dto.email);
    const user = await this.findPasswordMatch(
      candidates.filter(
        (u) => u.status === 'ACTIVE' && (u.userType === UserType.PLATFORM || u.isSuperAdmin),
      ),
      dto.password,
    );
    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

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
      },
    };
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
      if (!membership) {
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
      data: { passwordHash, tokenValidAfter },
    });
    if (count !== 1) {
      throw new ConflictException('A senha foi alterada em outra sessão. Tente novamente.');
    }

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
