import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { normalizeEmail } from '../security/password-policy';

/** Padrão: 3 pedidos por e-mail a cada 10 minutos (configurável por env — os e2e sobem o limite). */
const DEFAULT_LIMIT = 3;
const WINDOW_MS = 10 * 60_000;

export function forgotEmailThrottleLimit(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.FORGOT_EMAIL_THROTTLE_LIMIT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
}

/**
 * Rate limit POR E-MAIL do corpo (em vez de por IP) para "Esqueci a senha": impede que um atacante com vários
 * IPs encha a caixa de uma vítima de e-mails de redefinição (e-mail bombing). Roda além do ThrottlerGuard global
 * (que limita por IP). Vale para QUALQUER e-mail digitado — existente ou não — então o 429 não revela nada.
 * Limite lido da env a cada pedido (FORGOT_EMAIL_THROTTLE_LIMIT).
 */
@Injectable()
export class EmailThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const email = req.body?.email;
    return typeof email === 'string' ? `email:${normalizeEmail(email).slice(0, 254)}` : `ip:${String(req.ip)}`;
  }

  protected override async handleRequest(props: Parameters<ThrottlerGuard['handleRequest']>[0]): Promise<boolean> {
    return super.handleRequest({
      ...props,
      limit: forgotEmailThrottleLimit(),
      ttl: WINDOW_MS,
      blockDuration: WINDOW_MS,
    });
  }
}
