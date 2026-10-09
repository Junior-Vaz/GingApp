/**
 * Configuração de runtime sensível a segurança (JWT, CORS, trust proxy), como funções puras
 * para poderem ser testadas sem subir o app. Em produção (NODE_ENV=production) configuração
 * insegura ou ausente FAZ O BOOT FALHAR; em dev/test mantém os padrões permissivos de sempre.
 */

/** Valor histórico do fallback; conhecido publicamente, por isso proibido em produção. */
export const DEV_JWT_SECRET = 'dev-secret-change-me';

const MIN_PROD_JWT_SECRET_LENGTH = 32;

type Env = Record<string, string | undefined>;

export const isProduction = (env: Env = process.env): boolean => env.NODE_ENV === 'production';

/**
 * Em produção exige JWT_SECRET definido, com pelo menos 32 caracteres e diferente do valor de
 * dev. Fora de produção cai no valor de dev quando ausente (compatível com dev/test).
 */
export function resolveJwtSecret(value: string | undefined, env: Env = process.env): string {
  const secret = value?.trim();

  if (isProduction(env)) {
    if (!secret) {
      throw new Error('JWT_SECRET é obrigatório em produção (string longa e aleatória).');
    }
    if (secret === DEV_JWT_SECRET) {
      throw new Error('JWT_SECRET não pode ser o valor de desenvolvimento em produção.');
    }
    if (secret.length < MIN_PROD_JWT_SECRET_LENGTH) {
      throw new Error(`JWT_SECRET deve ter pelo menos ${MIN_PROD_JWT_SECRET_LENGTH} caracteres em produção.`);
    }
    return secret;
  }

  return secret || DEV_JWT_SECRET;
}

/**
 * CORS_ORIGINS: origens permitidas, separadas por vírgula (ex.: https://app.x.com,https://painel.x.com).
 * Em produção é obrigatório (nunca "qualquer origem"). Fora de produção, vazio = qualquer origem
 * (retorna `true`, o que `enableCors({ origin: true })` entende como refletir a origem do pedido).
 */
export function parseCorsOrigins(value: string | undefined, env: Env = process.env): true | string[] {
  const origins = (value ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  if (origins.includes('*')) {
    if (isProduction(env)) {
      throw new Error('CORS_ORIGINS não pode conter "*" em produção; liste as origens explicitamente.');
    }
    return true;
  }

  if (origins.length === 0) {
    if (isProduction(env)) {
      throw new Error('CORS_ORIGINS é obrigatório em produção (origens dos frontends, separadas por vírgula).');
    }
    return true;
  }

  return origins;
}

/**
 * TRUST_PROXY: quantos proxies reversos confiar para derivar o IP real (req.ip). Aceita um
 * número de saltos (ex.: 1 = um nginx/Caddy na frente), "true"/"false" ou um valor do Express
 * (ex.: "loopback"). Ausente = não confiar (req.ip é o do peer direto), o padrão seguro: sem
 * proxy, confiar no X-Forwarded-For permitiria forjar IP e burlar allowlist e throttling.
 */
export function parseTrustProxy(value: string | undefined): boolean | number | string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}
