import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../../shared/prisma/prisma.service';
import { AuthenticatedUser, JwtPayload } from '../../../../shared/interfaces/jwt-payload.interface';

interface JwtPayloadWithIat extends JwtPayload {
  iat: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'dev-secret-change-me'),
    });
  }

  /**
   * Roda em toda requisição autenticada. Além de decodificar o payload, revalida contra o
   * banco para suportar "revoke sessions" via User.tokenValidAfter (PLANO_PROJETO.md §2.2):
   * qualquer token emitido antes de tokenValidAfter é considerado inválido.
   */
  async validate(payload: JwtPayloadWithIat): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Usuário inválido ou inativo.');
    }

    if (user.tokenValidAfter && payload.iat * 1000 < user.tokenValidAfter.getTime()) {
      throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    }

    return {
      id: user.id,
      email: user.email,
      userType: user.userType,
      isSuperAdmin: user.isSuperAdmin,
      organizationId: payload.organizationId,
      role: payload.role,
    };
  }
}
