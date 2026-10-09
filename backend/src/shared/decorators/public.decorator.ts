import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * Marca uma rota (ou controller inteiro) como pública, isto é, isenta do JwtAuthGuard
 * global. Usado em /auth/login, /auth/platform-login e /health.
 *
 * Uso: @Public()
 *      @Post('login')
 *      login(...) {}
 */
export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Complemento de @Public(): a rota continua aberta a anônimos, mas SE vier um Bearer token
 * válido o JwtAuthGuard popula `req.user` (token inválido/expirado = segue como anônimo, nunca
 * 401). Serve para rotas públicas que devolvem MENOS dados a anônimos e mais ao próprio dono
 * — ex.: GET /rodas/:id/participants (nomes só para quem organiza; o próprio vê a sua
 * participação). Sem @Public() junto, não tem efeito (a rota já exige token).
 */
export const OptionalAuth = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
