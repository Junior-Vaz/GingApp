/**
 * Configuração do e-mail transacional (E05), como funções puras para poderem ser testadas sem Nest/SMTP.
 *
 * O recurso é OPCIONAL: sem SMTP_HOST (e um remetente) o e-mail fica DESLIGADO e o sistema funciona como
 * antes (sem "Esqueci a senha", sem convite por e-mail). Nada aqui é logado: SMTP_PASS é segredo.
 */

type Env = Record<string, string | undefined>;

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

const EMAIL_LIKE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/**
 * SMTP_HOST (obrigatório para ligar), SMTP_PORT (587 por padrão; 465 quando SMTP_SECURE=true e a porta
 * não for informada), SMTP_USER/SMTP_PASS (opcionais — relay sem autenticação), SMTP_FROM (remetente; cai
 * para SMTP_USER se este for um e-mail), SMTP_SECURE ("true" = TLS direto, típico da porta 465; "false"/
 * ausente = STARTTLS oportunista nas portas 587/25). Devolve null (e-mail desligado) quando falta o host
 * ou não há remetente utilizável.
 */
export function readSmtpConfig(env: Env = process.env): SmtpConfig | null {
  const host = clean(env.SMTP_HOST);
  if (!host) return null;

  const secure = clean(env.SMTP_SECURE)?.toLowerCase() === 'true';
  const rawPort = clean(env.SMTP_PORT);
  const parsedPort = rawPort && /^\d+$/.test(rawPort) ? Number(rawPort) : undefined;
  const port = parsedPort && parsedPort > 0 && parsedPort < 65536 ? parsedPort : secure ? 465 : 587;

  const user = clean(env.SMTP_USER);
  const pass = env.SMTP_PASS === undefined || env.SMTP_PASS === '' ? undefined : env.SMTP_PASS;
  const from = clean(env.SMTP_FROM) ?? (user && EMAIL_LIKE.test(user) ? user : undefined);
  if (!from) return null;

  return { host, port, secure, user, pass, from };
}

/** As três origens públicas dos frontends, para montar os links dos e-mails (sem barra final). */
export type FrontendKind = 'APP' | 'PAINEL' | 'ADMIN';

const FRONTEND_ENV: Record<FrontendKind, string> = {
  APP: 'APP_URL',
  PAINEL: 'PAINEL_URL',
  ADMIN: 'ADMIN_URL',
};

/** Origem do frontend (APP_URL/PAINEL_URL/ADMIN_URL) ou null se não configurada ou inválida (http/https). */
export function frontendBaseUrl(kind: FrontendKind, env: Env = process.env): string | null {
  const raw = clean(env[FRONTEND_ENV[kind]]);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return raw.replace(/\/+$/, '');
}
