import { ApplicantRole, EmailVerification, GroupApplicationStatus } from '@prisma/client';
import { isEmail } from 'class-validator';
import { frontendBaseUrl } from '../../../shared/mail/mail.config';

/**
 * Regras PURAS da adesao de grupos (docs/CONTRATO_ADESAO_GRUPOS.md e docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md: confirmacao do
 * e-mail, aviso a equipe e Instagram): sem Prisma/Nest, testaveis em isolamento
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

/** Pedidos "em aberto" (contam para o limite de 1 por e-mail e exigem o hash da senha): UNVERIFIED e PENDING. */
export const OPEN_STATUSES: GroupApplicationStatus[] = [GroupApplicationStatus.UNVERIFIED, GroupApplicationStatus.PENDING];

// ---------------------------------------------------------------------------------------------------------------
// Confirmacao do e-mail (docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md 1)
// ---------------------------------------------------------------------------------------------------------------

/** Validade do link de confirmacao (horas). */
export const VERIFY_TOKEN_TTL_HOURS = 24;
/** Intervalo minimo entre dois envios do link para o MESMO pedido (minutos). */
export const VERIFY_RESEND_COOLDOWN_MINUTES = 5;
/** Maximo de envios do link por pedido, CONTANDO o primeiro (o do ato do pedido): 1 + 2 reenvios. */
export const MAX_VERIFY_SENDS = 3;
/** UNVERIFIED com mais de 3 dias vira EXPIRED (senha e hash do link apagados). */
export const UNVERIFIED_EXPIRE_DAYS = 3;

const MINUTE_MS = 60 * 1000;

export function verifyExpiresAt(now: Date): Date {
  return new Date(now.getTime() + VERIFY_TOKEN_TTL_HOURS * 60 * MINUTE_MS);
}

/**
 * Estado do "Reenviar e-mail" de um pedido UNVERIFIED. `resendAvailableAt` = quando o proximo envio fica liberado se for
 * no FUTURO (espera de 5 min); null quando ja pode (canResend true) ou quando o limite de 3 envios acabou (canResend false).
 * Com o e-mail transacional desligado nao ha reenvio.
 */
export function resendState(
  app: { verifySentAt: Date | null; verifySentCount: number },
  now: Date,
  mailEnabled: boolean,
): { canResend: boolean; resendAvailableAt: Date | null } {
  if (!mailEnabled || app.verifySentCount >= MAX_VERIFY_SENDS) return { canResend: false, resendAvailableAt: null };
  const next = app.verifySentAt ? new Date(app.verifySentAt.getTime() + VERIFY_RESEND_COOLDOWN_MINUTES * MINUTE_MS) : null;
  if (next && next.getTime() > now.getTime()) return { canResend: false, resendAvailableAt: next };
  return { canResend: true, resendAvailableAt: null };
}

/** Motivo de recusa do reenvio (429), ou null quando o reenvio e permitido. */
export function resendBlock(app: { verifySentAt: Date | null; verifySentCount: number }, now: Date): 'LIMIT' | 'COOLDOWN' | null {
  if (app.verifySentCount >= MAX_VERIFY_SENDS) return 'LIMIT';
  const state = resendState(app, now, true);
  return state.canResend ? null : 'COOLDOWN';
}

/** Inicio da janela do cooldown: o ultimo envio precisa ser ANTES disto para liberar um novo. */
export function resendCooldownStart(now: Date): Date {
  return new Date(now.getTime() - VERIFY_RESEND_COOLDOWN_MINUTES * MINUTE_MS);
}

// ---------------------------------------------------------------------------------------------------------------
// Aviso a equipe (docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md 2)
// ---------------------------------------------------------------------------------------------------------------

/** Janela de agrupamento: no maximo 1 aviso a equipe a cada 10 minutos. */
export const TEAM_NOTIFY_WINDOW_MINUTES = 10;
/** Linha de PlatformSetting que guarda o instante do ultimo aviso (ISO 8601), sem tabela nova. */
export const TEAM_NOTIFY_SETTING_KEY = 'group_applications.last_notified_at';

export function teamNotifyWindowStart(now: Date): Date {
  return new Date(now.getTime() - TEAM_NOTIFY_WINDOW_MINUTES * MINUTE_MS);
}

/**
 * GROUP_APPLICATIONS_NOTIFY_EMAILS: lista separada por virgula (ou ponto e virgula); cada item aparado, em minusculas,
 * sem duplicatas; itens que nao sao e-mail sao IGNORADOS. Vazia = usar os super admins PLATFORM ativos.
 */
export function parseNotifyEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.GROUP_APPLICATIONS_NOTIFY_EMAILS ?? '';
  const out: string[] = [];
  for (const part of raw.split(/[,;]/)) {
    const email = part.trim().toLowerCase();
    if (email && email.length <= 254 && isEmail(email) && !out.includes(email)) out.push(email);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Instagram (docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md 7)
// ---------------------------------------------------------------------------------------------------------------

/** Handle puro: minusculo, 1..30 de [a-z0-9._], sem ".." seguidos e sem terminar em ".". */
export const INSTAGRAM_HANDLE_PATTERN = /^(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$/;
export const INSTAGRAM_INVALID_MESSAGE = 'Informe o Instagram como @usuario ou o link do perfil.';
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'instagr.am']);
/** Forma "sem esquema" aceita: o host do Instagram seguido de "/" (ex.: instagram.com/meugrupo). */
const INSTAGRAM_BARE_HOST = /^(www\.instagram\.com|instagram\.com|instagr\.am)\//i;

function asHandle(candidate: string): string | null {
  const handle = candidate.toLowerCase();
  return INSTAGRAM_HANDLE_PATTERN.test(handle) ? handle : null;
}

/**
 * Normaliza o Instagram digitado para o HANDLE puro. Aceita `@meugrupo`, `meugrupo`, `instagram.com/meugrupo` e
 * `http(s)://(www.)instagram.com/meugrupo/?igsh=...` (ou `instagr.am`), descartando query, fragmento e barra final.
 * Devolve `null` para vazio/ausente (campo opcional) e `undefined` para INVALIDO (outro dominio, texto livre, espacos,
 * `javascript:`, usuario:senha@, porta, mais de um segmento no caminho, caracteres fora de [a-z0-9._], handle longo).
 * O que se grava e so o handle (nunca a URL digitada).
 */
export function normalizeInstagram(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (value === '') return null;
  // Espacos, barra invertida (o URL do WHATWG a trata como "/") e segmentos "." / ".." (o URL os resolveria) = invalido.
  if (value.length > 200 || /[\s\\]/.test(value) || /\/\.{1,2}(?=\/|$|[?#])/.test(value)) return undefined;
  if (value.startsWith('@')) return asHandle(value.slice(1)) ?? undefined;
  if (/^[A-Za-z0-9._]+$/.test(value)) return asHandle(value) ?? undefined;

  let candidate: string;
  if (/^https?:\/\//i.test(value)) candidate = value;
  else if (INSTAGRAM_BARE_HOST.test(value)) candidate = `https://${value}`;
  else return undefined;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username || url.password || url.port) return undefined;
  if (!INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) return undefined;
  const segments = url.pathname.replace(/\/+$/, '').split('/').filter((s, i) => i > 0 || s !== '');
  if (segments.length !== 1) return undefined;
  return asHandle(segments[0]) ?? undefined;
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
  /** UNVERIFIED com createdAt ANTES disto expira (3 dias). */
  expireUnverifiedBefore: Date;
  /** REJECTED/EXPIRED com a data de referencia (decidedAt, ou updatedAt na falta) ANTES disto sao apagados. */
  deleteClosedBefore: Date;
  /** APPROVED com a data de referencia ANTES disto sao apagados. */
  deleteApprovedBefore: Date;
}

export function retentionCutoffs(now: Date): RetentionCutoffs {
  return {
    expirePendingBefore: new Date(now.getTime() - PENDING_EXPIRE_DAYS * DAY_MS),
    expireUnverifiedBefore: new Date(now.getTime() - UNVERIFIED_EXPIRE_DAYS * DAY_MS),
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
    case GroupApplicationStatus.UNVERIFIED:
      return app.createdAt < c.expireUnverifiedBefore ? 'expire' : 'keep';
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

/** `<PAINEL_URL>/comecar/confirmar/<verifyToken>` (link do e-mail de confirmacao; a pagina confirma por POST, nunca ao abrir). */
export function painelConfirmUrl(verifyToken: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${painelBaseUrl(env)}/comecar/confirmar/${encodeURIComponent(verifyToken)}`;
}

/** Padrao seguro quando ADMIN_URL (env ja existente, mail.config.ts) falta ou e invalida: o admin de producao (https). */
export const DEFAULT_ADMIN_URL = 'https://admin.gingapp.com.br';

/** `<ADMIN_URL>/pedidos-de-adesao` (link do aviso a equipe). */
export function adminApplicationsUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${frontendBaseUrl('ADMIN', env) ?? DEFAULT_ADMIN_URL}/pedidos-de-adesao`;
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
  /** docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md 1 e 7 (so a equipe ve o instagram). */
  emailVerification: EmailVerification;
  emailVerifiedAt: Date | null;
  instagram: string | null;
}

/**
 * Lista FECHADA de campos do contrato 4 (+ emailVerification/emailVerifiedAt/instagram do contrato de e-mail): copia campo
 * a campo, entao passwordHash/statusTokenHash/verifyTokenHash nunca passam, mesmo se lidos.
 */
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
    emailVerification: row.emailVerification,
    emailVerifiedAt: row.emailVerifiedAt ?? null,
    instagram: row.instagram ?? null,
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
  emailVerification: EmailVerification;
  /** So quando UNVERIFIED (docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md 1). */
  canResend?: boolean;
  resendAvailableAt?: Date | null;
}

/**
 * So os campos do contrato (lista FECHADA): nunca e-mail, telefone, nome do solicitante, nota interna, instagram, id,
 * hash ou token. `rejectionReason` so quando REJECTED; `loginUrl` so quando APPROVED; `canResend`/`resendAvailableAt` so
 * quando UNVERIFIED (a tela diz "enviamos para o e-mail informado", sem mostrar o e-mail).
 */
export function toPublicStatus(
  app: {
    status: GroupApplicationStatus;
    groupName: string;
    createdAt: Date;
    decidedAt: Date | null;
    rejectionReason: string | null;
    emailVerification: EmailVerification;
    verifySentAt?: Date | null;
    verifySentCount?: number;
  },
  env: NodeJS.ProcessEnv = process.env,
  options: { now?: Date; mailEnabled?: boolean } = {},
): PublicApplicationStatus {
  const out: PublicApplicationStatus = {
    status: app.status,
    groupName: app.groupName,
    createdAt: app.createdAt,
    decidedAt: app.decidedAt ?? null,
    rejectionReason: app.status === GroupApplicationStatus.REJECTED ? (app.rejectionReason ?? null) : null,
    loginUrl: app.status === GroupApplicationStatus.APPROVED ? painelLoginUrl(env) : null,
    emailVerification: app.emailVerification,
  };
  if (app.status === GroupApplicationStatus.UNVERIFIED) {
    const state = resendState(
      { verifySentAt: app.verifySentAt ?? null, verifySentCount: app.verifySentCount ?? 0 },
      options.now ?? new Date(),
      options.mailEnabled ?? true,
    );
    out.canResend = state.canResend;
    out.resendAvailableAt = state.resendAvailableAt;
  }
  return out;
}
