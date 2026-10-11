import { LEGAL_VERSION } from '../legal/legal-documents';

/**
 * "Portoes" de acesso aplicados pelo servidor a toda rota autenticada (JwtAuthGuard), por cima do JWT:
 *
 *  - `mustChangePassword`: a senha atual foi definida por outra pessoa (conta criada/redefinida pelo Mestre).
 *    Enquanto a flag estiver ligada o usuario so pode trocar a senha e consultar o proprio perfil.
 *  - `terms`: aceite pendente dos Termos/Politica (E10). So barra no servidor quando TERMS_ENFORCEMENT=true
 *    (padrao: desligado; o frontend e quem exige o aceite, para nao quebrar seed/demo/e2e).
 *
 * Regra pura (sem Nest/Prisma) para ser testavel isoladamente.
 */
export type AccessGate = 'mustChangePassword' | 'terms';

/** Codigos devolvidos em `code` no corpo do 403 (os frontends reagem a eles). */
export const MUST_CHANGE_PASSWORD_CODE = 'MUST_CHANGE_PASSWORD';
export const TERMS_NOT_ACCEPTED_CODE = 'TERMS_NOT_ACCEPTED';

export const MUST_CHANGE_PASSWORD_MESSAGE =
  'Você precisa trocar a senha provisória antes de continuar. Use a opção "Alterar senha".';
export const TERMS_NOT_ACCEPTED_MESSAGE =
  'Você precisa aceitar os Termos de Uso e a Política de Privacidade vigentes antes de continuar.';

export interface AccessGateUser {
  mustChangePassword?: boolean;
  acceptedTermsVersion?: string | null;
}

export interface AccessGateViolation {
  code: typeof MUST_CHANGE_PASSWORD_CODE | typeof TERMS_NOT_ACCEPTED_CODE;
  message: string;
}

/** TERMS_ENFORCEMENT=true liga o bloqueio de uso por aceite pendente no servidor. Lido a cada chamada. */
export function isTermsEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TERMS_ENFORCEMENT === 'true';
}

/**
 * Primeiro portao fechado para este usuario nesta rota (ou null = pode passar). `exempt` lista os portoes
 * que a rota dispensa (ver @AllowDuringGate). A senha provisoria vem antes do aceite.
 */
export function accessGateViolation(
  user: AccessGateUser | undefined,
  exempt: readonly AccessGate[],
  options: { enforceTerms: boolean } = { enforceTerms: isTermsEnforced() },
): AccessGateViolation | null {
  if (!user) return null;
  if (user.mustChangePassword === true && !exempt.includes('mustChangePassword')) {
    return { code: MUST_CHANGE_PASSWORD_CODE, message: MUST_CHANGE_PASSWORD_MESSAGE };
  }
  if (options.enforceTerms && user.acceptedTermsVersion !== LEGAL_VERSION && !exempt.includes('terms')) {
    return { code: TERMS_NOT_ACCEPTED_CODE, message: TERMS_NOT_ACCEPTED_MESSAGE };
  }
  return null;
}
