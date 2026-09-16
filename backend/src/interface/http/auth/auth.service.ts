import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { JwtPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { AuthResponse } from './auth-response.interface';
import { LoginDto } from './dto/login.dto';
import { PlatformLoginDto } from './dto/platform-login.dto';

/** Mensagem de erro genérica — nunca revela se o e-mail existe nem qual tipo de conta é
 * (PLANO_PROJETO.md §3.1, mesmo comportamento do GestorPrint). */
const INVALID_CREDENTIALS = 'Credenciais inválidas.';

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
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (!user || user.userType !== UserType.MEMBER || user.status !== 'ACTIVE') {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const memberships = await this.prisma.organizationUser.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
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
      accessToken: await this.jwtService.signAsync(payload),
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
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.userType !== UserType.PLATFORM && !user.isSuperAdmin) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      userType: user.userType,
      isSuperAdmin: user.isSuperAdmin,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        userType: user.userType,
        isSuperAdmin: user.isSuperAdmin,
      },
    };
  }
}
