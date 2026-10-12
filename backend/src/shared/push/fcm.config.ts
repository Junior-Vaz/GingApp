/**
 * Configuração e regras puras do Firebase Cloud Messaging (FCM), testáveis sem rede nem firebase-admin.
 *
 * Duas metades, ambas só por variáveis de ambiente (nada vai no build do app):
 *  - CREDENCIAIS DE SERVIDOR (conta de serviço) -> o backend envia. FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL +
 *    FIREBASE_PRIVATE_KEY, ou FIREBASE_SERVICE_ACCOUNT_JSON (JSON inteiro da chave, em base64).
 *  - CONFIG WEB (SDK do navegador) -> servida em GET /push/config: FIREBASE_WEB_API_KEY, FIREBASE_WEB_AUTH_DOMAIN,
 *    FIREBASE_WEB_MESSAGING_SENDER_ID, FIREBASE_WEB_APP_ID, FIREBASE_WEB_VAPID_KEY (+ FIREBASE_WEB_STORAGE_BUCKET opcional).
 * Sem as duas metades válidas o FCM fica DESLIGADO (o Web Push VAPID segue como fallback, se configurado).
 * NADA aqui é logado: a chave privada é segredo.
 */
import type { PushPayload } from './push.config';

type Env = Record<string, string | undefined>;

export interface FirebaseAdminConfig {
  projectId: string;
  clientEmail: string;
  /** PEM com quebras de linha reais (o `\n` escapado do .env já foi convertido). */
  privateKey: string;
}

/** Objeto `firebaseConfig` do SDK web (console Firebase > Configurações do projeto > Seus apps). */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId: string;
  appId: string;
}

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/** Remove aspas que o painel/.env às vezes deixam em volta do valor. */
function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1).trim();
  return v;
}

/** `\n` escapado (como vem no .env/Easypanel) -> quebra de linha real; também normaliza CRLF. */
export function normalizePrivateKey(raw: string): string {
  return unquote(raw).replace(/\\r\\n|\\n/g, '\n').replace(/\r\n/g, '\n').trim();
}

const PEM = /^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROJECT_ID = /^[a-z][a-z0-9-]{3,}$/;

/** FIREBASE_SERVICE_ACCOUNT_JSON: base64 do arquivo .json (aceita também o JSON cru, por conveniência). */
function readServiceAccountJson(env: Env): { project_id?: string; client_email?: string; private_key?: string } | null {
  const raw = clean(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (!raw) return null;
  try {
    const text = unquote(raw);
    const json = text.startsWith('{') ? text : Buffer.from(text, 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : null;
  } catch {
    return null;
  }
}

/** ID do projeto Firebase (variável explícita ou o `project_id` do JSON da conta de serviço). */
export function readFirebaseProjectId(env: Env = process.env): string | null {
  const id = clean(env.FIREBASE_PROJECT_ID) ?? clean(readServiceAccountJson(env)?.project_id);
  const value = id ? unquote(id) : null;
  return value && PROJECT_ID.test(value) ? value : null;
}

/** Credenciais da conta de serviço válidas ou null (FCM desligado). Variáveis soltas têm precedência sobre o JSON. */
export function readFirebaseAdminConfig(env: Env = process.env): FirebaseAdminConfig | null {
  const json = readServiceAccountJson(env);
  const projectId = readFirebaseProjectId(env);
  const clientEmail = clean(env.FIREBASE_CLIENT_EMAIL) ?? clean(json?.client_email);
  const privateKeyRaw = clean(env.FIREBASE_PRIVATE_KEY) ?? clean(json?.private_key);
  if (!projectId || !clientEmail || !privateKeyRaw) return null;
  const email = unquote(clientEmail);
  const privateKey = normalizePrivateKey(privateKeyRaw);
  if (!EMAIL.test(email) || !PEM.test(privateKey)) return null;
  return { projectId, clientEmail: email, privateKey };
}

export interface FirebaseWebSettings {
  firebase: FirebaseWebConfig;
  /** Chave pública Web Push (VAPID) do FCM: Cloud Messaging > Web configuration > Web Push certificates. */
  vapidKey: string;
}

/** Config web completa ou null. `authDomain` assume `<projectId>.firebaseapp.com` quando não informado. */
export function readFirebaseWebSettings(env: Env = process.env): FirebaseWebSettings | null {
  const projectId = readFirebaseProjectId(env);
  const apiKey = clean(env.FIREBASE_WEB_API_KEY);
  const messagingSenderId = clean(env.FIREBASE_WEB_MESSAGING_SENDER_ID);
  const appId = clean(env.FIREBASE_WEB_APP_ID);
  const vapidKey = clean(env.FIREBASE_WEB_VAPID_KEY);
  if (!projectId || !apiKey || !messagingSenderId || !appId || !vapidKey) return null;
  if (!/^\d{6,}$/.test(messagingSenderId) || !/^[A-Za-z0-9_-]{60,120}$/.test(vapidKey)) return null;
  const firebase: FirebaseWebConfig = {
    apiKey,
    authDomain: clean(env.FIREBASE_WEB_AUTH_DOMAIN) ?? `${projectId}.firebaseapp.com`,
    projectId,
    messagingSenderId,
    appId,
  };
  const storageBucket = clean(env.FIREBASE_WEB_STORAGE_BUCKET);
  if (storageBucket) firebase.storageBucket = storageBucket;
  return { firebase, vapidKey };
}

/** TTL do aviso no FCM: se o aparelho ficar offline, o aviso vale por até 24 h. */
export const FCM_TTL_SECONDS = 60 * 60 * 24;

/** Códigos do FCM que significam "este token nunca mais vai funcionar": a linha é apagada. */
export const FCM_DEAD_TOKEN_CODES: ReadonlySet<string> = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export function isDeadFcmToken(errorCode: string | undefined): boolean {
  return errorCode !== undefined && FCM_DEAD_TOKEN_CODES.has(errorCode);
}

/** Origem do app (APP_URL) sem barra final, só se for http(s); usada para o link absoluto exigido pelo FCM. */
export function appOrigin(env: Env = process.env): string | null {
  const raw = clean(env.APP_URL);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Mensagem multicast do FCM. `data` leva {title, body, url, tag} (o app em primeiro plano lê daqui via onMessage);
 * `notification` leva só {title, body} (o navegador exibe sozinho com o app fechado). Nada de ids nem dados
 * financeiros: o `payload` já vem de buildPushPayload (mensalidade genérica).
 */
export function buildFcmMessage(tokens: string[], payload: PushPayload, origin: string | null = appOrigin()) {
  const icon = `${origin ?? ''}/icon-192.png`;
  return {
    tokens,
    notification: { title: payload.title, body: payload.body },
    data: { title: payload.title, body: payload.body, url: payload.url, tag: payload.tag },
    android: { priority: 'high' as const, ttl: FCM_TTL_SECONDS * 1000 },
    webpush: {
      headers: { TTL: String(FCM_TTL_SECONDS), Urgency: 'high' },
      notification: { icon, badge: icon, tag: payload.tag, renotify: true },
      ...(origin ? { fcmOptions: { link: `${origin}${payload.url}` } } : {}),
    },
  };
}
