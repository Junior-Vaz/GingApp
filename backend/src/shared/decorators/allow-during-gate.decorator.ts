import { SetMetadata } from '@nestjs/common';
import { AccessGate } from '../access/access-gate';

export const ALLOW_DURING_GATE_KEY = 'allowDuringGate';

/**
 * Dispensa a rota dos portoes de acesso listados (ver shared/access/access-gate.ts). Sem este decorator,
 * um usuario com `mustChangePassword` recebe 403 (code MUST_CHANGE_PASSWORD) em TODA rota autenticada.
 *
 * Uso: @AllowDuringGate('mustChangePassword', 'terms')
 *      @Post('change-password')
 */
export const AllowDuringGate = (...gates: AccessGate[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(ALLOW_DURING_GATE_KEY, gates);
