/**
 * Configuração e regras puras do Web Push (I13), testáveis sem Nest/rede.
 *
 * O recurso é OPCIONAL: sem VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT válidos o push fica DESLIGADO e o
 * sistema funciona como antes (notificações só no sino do app). Nada aqui é logado: a chave privada é segredo.
 */

type Env = Record<string, string | undefined>;

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** `mailto:contato@dominio` ou `https://...` (exigido pelos serviços de push para contato em caso de abuso). */
  subject: string;
}

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

// Chaves VAPID: P-256 em base64url sem padding. Pública = 65 bytes (87 chars); privada = 32 bytes (43 chars).
const PUBLIC_KEY = /^[A-Za-z0-9_-]{80,100}$/;
const PRIVATE_KEY = /^[A-Za-z0-9_-]{40,50}$/;
const MAILTO = /^mailto:[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Config VAPID válida ou null (push desligado) — qualquer variável ausente/malformada desliga o recurso. */
export function readVapidConfig(env: Env = process.env): VapidConfig | null {
  const publicKey = clean(env.VAPID_PUBLIC_KEY);
  const privateKey = clean(env.VAPID_PRIVATE_KEY);
  const subject = clean(env.VAPID_SUBJECT);
  if (!publicKey || !privateKey || !subject) return null;
  if (!PUBLIC_KEY.test(publicKey) || !PRIVATE_KEY.test(privateKey)) return null;
  const subjectOk = MAILTO.test(subject) || /^https:\/\/[^\s]+$/.test(subject);
  if (!subjectOk) return null;
  return { publicKey, privateKey, subject };
}

/** Categorias que o usuário liga/desliga em GET/PUT /push/preferences. */
export const PUSH_CATEGORIES = ['lessons', 'finance', 'events', 'graduations', 'announcements'] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number];

/** Notification.type -> categoria de preferência. Tipo desconhecido cai em "announcements" (comunicados). */
export function pushCategoryOf(type: string | null | undefined): PushCategory {
  if (!type) return 'announcements';
  if (type.startsWith('LESSON')) return 'lessons';
  if (type.startsWith('FINANCE')) return 'finance';
  if (type === 'EVENT' || type === 'RODA') return 'events';
  if (type.startsWith('GRADUATION')) return 'graduations';
  return 'announcements';
}

/** Conteúdo mínimo de um push: nada além do necessário para o aviso e o destino ao tocar. */
export interface PushPayload {
  title: string;
  body: string;
  /** Caminho relativo dentro do app (ex.: "/financeiro"); o service worker abre `origin + url`. */
  url: string;
  /** Agrupa avisos da mesma categoria na bandeja do aparelho. */
  tag: string;
}

const URL_BY_CATEGORY: Record<PushCategory, string> = {
  lessons: '/aulas',
  finance: '/financeiro',
  events: '/eventos',
  graduations: '/jornada',
  announcements: '/notificacoes',
};

const MAX_TITLE = 80;
const MAX_BODY = 140;

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Monta o payload do push a partir de uma notificação in-app. Dados financeiros (descrição e valor da
 * mensalidade) NUNCA vão no push — a tela de bloqueio é pública: o corpo vira um aviso genérico e o detalhe
 * fica no app, atrás do login.
 */
export function buildPushPayload(n: { title: string; body: string; type?: string | null }): PushPayload {
  const category = pushCategoryOf(n.type);
  const body = category === 'finance' ? 'Há uma pendência financeira. Toque para ver os detalhes no app.' : n.body;
  return {
    title: truncate(n.title, MAX_TITLE),
    body: truncate(body, MAX_BODY),
    url: URL_BY_CATEGORY[category],
    tag: `gingapp-${category}`,
  };
}

/**
 * Valida o endpoint de uma inscrição: https, host público com nome DNS (sem IP literal, localhost nem nomes
 * internos). O servidor fará POST para essa URL, então não pode apontar para a rede interna (SSRF).
 */
export function isAcceptablePushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host)) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }
  return true;
}
