import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { OrgRole } from '@prisma/client';
import { resolveJwtSecret } from '../../../../shared/config/runtime-config';
import { PrismaService } from '../../../../shared/prisma/prisma.service';
import { AuthenticatedUser, JwtPayload } from '../../../../shared/interfaces/jwt-payload.interface';
import { isRevokedByCutoff } from '../../../../shared/security/token-revocation';
import {
  INACTIVE_STUDENT_MESSAGE,
  isMembershipBlockedByInactiveStudent,
} from '../../../../shared/access/inactive-student-access';

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
      secretOrKey: resolveJwtSecret(config.get<string>('JWT_SECRET')),
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

    if (isRevokedByCutoff(payload.iat, user.tokenValidAfter)) {
      throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    }

    // Token escopado a um grupo: a membership precisa continuar ativa (professor inativado
    // perde o acesso na hora, sem esperar o token expirar).
    let membershipRole: OrgRole | undefined;
    if (payload.organizationId != null) {
      const membership = await this.prisma.organizationUser.findFirst({
        where: {
          userId: user.id,
          organizationId: payload.organizationId,
          status: 'ACTIVE',
          organization: { status: 'ACTIVE' }, // grupo desativado pela plataforma: o token cai na hora
        },
        select: { id: true, role: true },
      });
      if (!membership) {
        throw new UnauthorizedException('Acesso ao grupo inativo.');
      }
      // Aluno inativado: o vinculo ALUNO deste grupo cai na hora (outros vinculos/dependentes ativos nao).
      if (
        await isMembershipBlockedByInactiveStudent(this.prisma, {
          userId: user.id,
          organizationId: payload.organizationId,
          role: membership.role,
        })
      ) {
        throw new UnauthorizedException(INACTIVE_STUDENT_MESSAGE);
      }
      membershipRole = membership.role;
    }

    return {
      id: user.id,
      email: user.email,
      userType: user.userType,
      isSuperAdmin: user.isSuperAdmin,
      organizationId: payload.organizationId,
      // Papel SEMPRE do banco (Fase 3: cargos concedidos/revogados valem na hora, sem esperar o token expirar).
      role: membershipRole ?? payload.role,
      // Sempre do banco (nunca do token): ver shared/access/access-gate.ts (aplicado pelo JwtAuthGuard).
      mustChangePassword: user.mustChangePassword,
      acceptedTermsVersion: user.acceptedTermsVersion,
    };
  }
}
