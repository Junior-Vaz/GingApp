import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

/**
 * Injeta o usuário autenticado (req.user, populado pela JwtStrategy) no handler.
 *
 * Uso: findAll(@CurrentUser() user: AuthenticatedUser) {}
 *      findAll(@CurrentUser('id') userId: number) {}
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
