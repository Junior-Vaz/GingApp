import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca uma rota (ou controller inteiro) como pública, isto é, isenta do JwtAuthGuard
 * global. Usado em /auth/login, /auth/platform-login e /health.
 *
 * Uso: @Public()
 *      @Post('login')
 *      login(...) {}
 */
export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC_KEY, true);
