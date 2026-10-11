import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AccessGate, AccessGateUser, accessGateViolation } from '../access/access-gate';
import { ALLOW_DURING_GATE_KEY } from '../decorators/allow-during-gate.decorator';
import { IS_OPTIONAL_AUTH_KEY, IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Guard global de autenticação JWT (registrado como APP_GUARD no AppModule).
 * Toda rota exige um Bearer token válido, exceto as marcadas com @Public().
 * Rotas @Public() + @OptionalAuth() tentam autenticar quando há header Authorization, sem
 * nunca barrar (token inválido = anônimo).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);

    if (isPublic) {
      const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, targets);
      const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown>; user?: unknown }>();
      if (isOptionalAuth && request.headers?.authorization) {
        try {
          await (super.canActivate(context) as Promise<boolean>);
        } catch {
          request.user = undefined; // token inválido/expirado: segue como anônimo
        }
      }
      return true;
    }

    // AuthGuard('jwt') do @nestjs/passport sempre devolve Promise<boolean>.
    const authenticated = await (super.canActivate(context) as Promise<boolean>);
    if (!authenticated) return false;

    // Portoes de acesso (senha provisoria pendente; aceite de termos se TERMS_ENFORCEMENT=true): 403 com `code`
    // em toda rota autenticada que nao se declare isenta com @AllowDuringGate (ver access-gate.ts).
    const request = context.switchToHttp().getRequest<{ user?: AccessGateUser }>();
    const exempt = this.reflector.getAllAndOverride<AccessGate[]>(ALLOW_DURING_GATE_KEY, targets) ?? [];
    const violation = accessGateViolation(request.user, exempt);
    if (violation) {
      throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', message: violation.message, code: violation.code });
    }
    return true;
  }
}
