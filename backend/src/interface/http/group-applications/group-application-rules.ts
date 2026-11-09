import { ApplicantRole, GroupApplicationStatus } from '@prisma/client';
import { frontendBaseUrl } from '../../../shared/mail/mail.config';

/**
 * Regras PURAS da adesao de grupos (docs/CONTRATO_ADESAO_GRUPOS.md): sem Prisma/Nest, testaveis em isolamento
 * (test/group-applications.spec.ts). O comportamento HTTP esta em test/group-applications.e2e-spec.ts.
 */

/** Rotulos em portugues do cargo INFORMADO (so informacao para a equipe; nao concede nada). SSOT do `claimedRoleLabel`. */
export const APPLICANT_ROLE_LABELS: Record<ApplicantRole, string> = {
  MESTRE: 'Mestre',
  CONTRAMESTRE: 'Contramestre',
  PROFESSOR: 'Professor(a)',
  INSTRUTOR: 'Instrutor(a)',
  MONITOR: 'Monitor(a)',
  OUTRO: 'Outro',
};

export function applicantRoleLabel(role: ApplicantRole): string {
  return APPLICANT_ROLE_LABELS[role] ?? role;
}

// ---------------------------------------------------------------------------------------------------------------
// Anti-abuso (regra 4)
// ---------------------------------------------------------------------------------------------------------------

/** Maximo de pedidos por e-mail numa janela de 30 dias (acima disso: o mesmo 201, nada gravado). */
export const MAX_APPLICATIONS_PER_EMAIL = 3;
export const APPLICATIONS_PER_EMAIL_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function perEmailWindowStart(now: Date): Date {
  return new Date(now.getTime() - APPLICATIONS_PER_EMAIL_WINDOW_DAYS * DAY_MS);
}

/** Honeypot: o campo `website` e invisivel para pessoas; qualquer texto nao vazio = robo (201 falso, nada gravado). */
export function isHoneypotFilled(website: unknown): boolean {
  return typeof website === 'string' && website.trim().length > 0;
}

/**
 * Token de acompanhamento: 32 bytes aleatorios em base64url = exatamente 43 caracteres. Qualquer outra coisa no path e
 * recusada ANTES do banco com o mesmo 404 de um token inexistente.
 */
export const STATUS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedStatusToken(token: unknown): token is string {
  return typeof token === 'string' && STATUS_TOKEN_PATTERN.test(token);
}

// ---------------------------------------------------------------------------------------------------------------
// Retencao (secao 2)
// ---------------------------------------------------------------------------------------------------------------

/** PENDING com mais de 60 dias vira EXPIRED (senha apagada). */
export const PENDING_EXPIRE_DAYS = 60;
/** REJECTED/EXPIRED com mais de 90 dias e APPROVED com mais de 180 dias sao APAGADOS. */
export const CLOSED_DELETE_DAYS = 90;
export const APPROVED_DELETE_DAYS = 180;

export interface RetentionCutoffs {
  /** PENDING com createdAt ANTES disto expira. */
  expirePendingBefore: Date;
  /** REJECTED/EXPIRED com a data de referencia (decidedAt, ou updatedAt na falta) ANTES disto sao apagados. */
  deleteClosedBefore: Date;
  /** APPROVED com a data de referencia ANTES disto sao apagados. */
  deleteApprovedBefore: Date;
}

export function retentionCutoffs(now: Date): RetentionCutoffs {
  return {
    expirePendingBefore: new Date(now.getTime() - PENDING_EXPIRE_DAYS * DAY_MS),
    deleteClosedBefore: new Date(now.getTime() - CLOSED_DELETE_DAYS * DAY_MS),
    deleteApprovedBefore: new Date(now.getTime() - APPROVED_DELETE_DAYS * DAY_MS),
  };
}

/**
 * Destino de UM pedido na retencao (para os testes e para documentar a regra; o job aplica a mesma regra em lote).
 * Referencia de idade: PENDING = createdAt; decididos/expirados = decidedAt (expirado grava decidedAt = momento da
 * expiracao), com createdAt como reserva.
 */
export function retentionAction(
  app: { status: GroupApplicationStatus; createdAt: Date; decidedAt: Date | null },
  now: Date,
): 'expire' | 'delete' | 'keep' {
  const c = retentionCutoffs(now);
  const ref = app.decidedAt ?? app.createdAt;
  switch (app.status) {
    case GroupApplicationStatus.PENDING:
      return app.createdAt < c.expirePendingBefore ? 'expire' : 'keep';
    case GroupApplicationStatus.REJECTED:
    case GroupApplicationStatus.EXPIRED:
      return ref < c.deleteClosedBefore ? 'delete' : 'keep';
    case GroupApplicationStatus.APPROVED:
      return ref < c.deleteApprovedBefore ? 'delete' : 'keep';
    default:
      return 'keep';
  }
}

/**
 * GROUP_APPLICATIONS_PURGE: `true` executa (expira e apaga); `dry-run` (PADRAO, protecao contra perda de dados) so
 * registra no log o que faria; `false` desliga o job. Mesma convencao de FORMS_RETENTION_PURGE.
 */
export function groupApplicationsPurgeMode(env: NodeJS.ProcessEnv = process.env): 'on' | 'off' | 'dry-run' {
  const v = env.GROUP_APPLICATIONS_PURGE?.trim().toLowerCase();
  if (v === 'true' || v === 'on' || v === '1') return 'on';
  if (v === 'false' || v === 'off' || v === '0') return 'off';
  return 'dry-run';
}

// ---------------------------------------------------------------------------------------------------------------
// Links do painel
// ---------------------------------------------------------------------------------------------------------------

/** Padrao seguro quando PAINEL_URL (env ja existente, mail.config.ts) falta ou e invalida: o painel de producao (https). */
export const DEFAULT_PAINEL_URL = 'https://painel.gingapp.com.br';

export function painelBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return frontendBaseUrl('PAINEL', env) ?? DEFAULT_PAINEL_URL;
}

/** `<PAINEL_URL>/login` (loginUrl do status APPROVED e link do e-mail de aprovacao). */
export function painelLoginUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${painelBaseUrl(env)}/login`;
}

/** `<PAINEL_URL>/comecar` (link do e-mail de rejeicao: fazer novo pedido). */
export function painelApplyUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${painelBaseUrl(env)}/comecar`;
}

// ---------------------------------------------------------------------------------------------------------------
// Visao do admin (GET /platform-group-applications[/:id])
// ---------------------------------------------------------------------------------------------------------------

export interface AdminApplicationItem {
  id: number;
  status: GroupApplicationStatus;
  applicantName: string;
  email: string;
  phone: string | null;
  claimedRole: ApplicantRole;
  claimedRoleLabel: string;
  groupName: string;
  city: string;
  state: string;
  estimatedStudents: number | null;
  message: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  decidedBy: { id: number; name: string } | null;
  rejectionReason: string | null;
  internalNote: string | null;
  organization: { id: number; name: string; slug: string } | null;
}

/** Lista FECHADA de campos do contrato 4 (copia campo a campo: passwordHash/statusTokenHash nunca passam, mesmo se lidos). */
export function toAdminItem(
  row: Omit<AdminApplicationItem, 'claimedRoleLabel' | 'decidedBy'>,
  decidedBy: { id: number; name: string } | null,
): AdminApplicationItem {
  return {
    id: row.id,
    status: row.status,
    applicantName: row.applicantName,
    email: row.email,
    phone: row.phone ?? null,
    claimedRole: row.claimedRole,
    claimedRoleLabel: applicantRoleLabel(row.claimedRole),
    groupName: row.groupName,
    city: row.city,
    state: row.state,
    estimatedStudents: row.estimatedStudents ?? null,
    message: row.message ?? null,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt ?? null,
    decidedBy: decidedBy ? { id: decidedBy.id, name: decidedBy.name } : null,
    rejectionReason: row.rejectionReason ?? null,
    internalNote: row.internalNote ?? null,
    organization: row.organization ? { id: row.organization.id, name: row.organization.name, slug: row.organization.slug } : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Visao publica (GET /public/group-applications/:token)
// ---------------------------------------------------------------------------------------------------------------

export interface PublicApplicationStatus {
  status: GroupApplicationStatus;
  groupName: string;
  createdAt: Date;
  decidedAt: Date | null;
  rejectionReason: string | null;
  loginUrl: string | null;
}

/**
 * So os campos do contrato (lista FECHADA): nunca e-mail, telefone, nome do solicitante, nota interna, id, hash ou token.
 * `rejectionReason` so quando REJECTED; `loginUrl` so quando APPROVED.
 */
export function toPublicStatus(
  app: { status: GroupApplicationStatus; groupName: string; createdAt: Date; decidedAt: Date | null; rejectionReason: string | null },
  env: NodeJS.ProcessEnv = process.env,
): PublicApplicationStatus {
  return {
    status: app.status,
    groupName: app.groupName,
    createdAt: app.createdAt,
    decidedAt: app.decidedAt ?? null,
    rejectionReason: app.status === GroupApplicationStatus.REJECTED ? (app.rejectionReason ?? null) : null,
    loginUrl: app.status === GroupApplicationStatus.APPROVED ? painelLoginUrl(env) : null,
  };
}
