import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate limit POR USUÁRIO autenticado (em vez de por IP). O ThrottlerGuard global roda ANTES do
 * JwtAuthGuard (não há req.user ainda) e limita por IP; este, aplicado na rota com @UseGuards(...),
 * roda DEPOIS do JwtAuthGuard e conta por id de usuário — quem roubou um token não contorna o limite
 * trocando de IP, e vários usuários atrás do mesmo IP (NAT/escola) não se bloqueiam entre si. Usa o
 * mesmo @Throttle() da rota. Sem req.user (não deveria ocorrer numa rota autenticada) cai no IP.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req.user?.id;
    return userId !== undefined && userId !== null ? `user:${userId}` : String(req.ip);
  }
}
