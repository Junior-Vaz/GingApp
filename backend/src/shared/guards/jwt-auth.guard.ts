import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
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
    return super.canActivate(context) as Promise<boolean>;
  }
}
