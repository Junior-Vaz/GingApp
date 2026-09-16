import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/**
 * Injeta o organizationId do usuário autenticado (extraído do JWT, nunca do corpo da
 * requisição — PLANO_PROJETO.md §3.2 item 4: "nunca confiar em organizationId vindo do
 * corpo da requisição para dados sensíveis").
 *
 * Só se aplica a tokens de userType = 'MEMBER'. Lança 401 se o token autenticado não
 * carregar organizationId (ex.: token de usuário PLATFORM usado em rota de grupo).
 *
 * Uso: findAll(@CurrentOrganization() organizationId: number) {}
 */
export const CurrentOrganization = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const organizationId = request.user?.organizationId;
    if (organizationId === undefined || organizationId === null) {
      throw new UnauthorizedException('Token sem contexto de organização.');
    }
    return organizationId;
  },
);
