import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  deleteFcmToken,
  getFcmToken,
  isFcmMarkedActive,
  markFcmActive,
  type FirebaseWebConfig,
} from "@/lib/fcm";

/** Transporte de avisos oferecido pelo servidor: FCM (principal), Web Push VAPID (fallback) ou nenhum. */
export type PushProvider = "fcm" | "webpush";

/**
 * GET /push/config: o recurso é opcional no servidor (sem FCM nem VAPID => enabled=false e nada aparece no app).
 * `firebase` (config pública do SDK web) só vem com provider "fcm" e é lida em tempo de execução - nunca no build.
 */
export interface PushConfig {
  enabled: boolean;
  provider: PushProvider | null;
  publicKey: string | null;
  firebase: FirebaseWebConfig | null;
}

export type PushCategory = "lessons" | "finance" | "events" | "graduations" | "announcements";
export type PushPreferences = Record<PushCategory, boolean>;

export const PUSH_CATEGORIES: { key: PushCategory; label: string; hint: string }[] = [
  { key: "lessons", label: "Aulas", hint: "Aula cancelada ou com horário alterado." },
  { key: "finance", label: "Financeiro", hint: "Mensalidade vencida (sem valores na tela de bloqueio)." },
  { key: "events", label: "Eventos e rodas", hint: "Novo evento ou roda no seu grupo." },
  { key: "graduations", label: "Graduações", hint: "Nova graduação ou troca de corda." },
  { key: "announcements", label: "Comunicados", hint: "Recados do grupo e da equipe GingApp." },
];

const OFF: PushConfig = { enabled: false, provider: null, publicKey: null, firebase: null };

function validFirebase(value: unknown): value is FirebaseWebConfig {
  const v = value as Partial<FirebaseWebConfig> | null | undefined;
  return !!v && !!v.apiKey && !!v.projectId && !!v.messagingSenderId && !!v.appId && !!v.authDomain;
}

/** Qualquer falha vira "desligado": o app segue funcionando normalmente. */
export async function fetchPushConfig(): Promise<PushConfig> {
  try {
    const data = await api.get<Partial<PushConfig> | undefined>("/push/config");
    if (data?.enabled !== true || !data.publicKey) return OFF;
    // Servidor antigo (sem `provider`): era sempre Web Push VAPID.
    const provider: PushProvider = data.provider === "fcm" ? "fcm" : "webpush";
    if (provider === "fcm" && !validFirebase(data.firebase)) return OFF;
    return {
      enabled: true,
      provider,
      publicKey: data.publicKey,
      firebase: provider === "fcm" ? (data.firebase as FirebaseWebConfig) : null,
    };
  } catch {
    return OFF;
  }
}

export function usePushConfig() {
  return useQuery({ queryKey: ["push-config"], queryFn: fetchPushConfig, retry: false, staleTime: 5 * 60 * 1000 });
}

export function usePushPreferences(enabled: boolean) {
  return useQuery({
    queryKey: ["push-preferences"],
    queryFn: () => api.get<PushPreferences>("/push/preferences"),
    enabled,
    retry: false,
  });
}

/** Navegador com service worker + Push + Notification. (No iOS isso só existe com o app instalado na tela inicial.) */
export function isPushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ se identifica como Macintosh, mas tem tela de toque.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

/** iOS só entrega push ao app instalado na tela inicial: fora dele o botão não funciona e mostramos a dica. */
export function needsIosInstall(): boolean {
  return isIos() && !isStandalone();
}

/** Chave pública VAPID (base64url) -> bytes, como exige pushManager.subscribe. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Service worker do PWA pronto, com limite de tempo (em dev o SW não é registrado e `ready` nunca resolveria). */
async function readyRegistration(timeoutMs = 8000): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("O serviço de avisos não está disponível neste momento.")), timeoutMs),
  );
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

/** Inscrição Web Push (VAPID) atual deste navegador no sw.js do PWA (ou null). Nunca lança. */
export async function getBrowserSubscription(): Promise<PushSubscription | null> {
  try {
    if (!isPushSupported()) return null;
    const registration = await readyRegistration(3000);
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** Grava (idempotente) a inscrição Web Push do navegador para o usuário logado. */
export async function registerSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const p256dh = json.keys?.["p256dh"];
  const auth = json.keys?.["auth"];
  if (!json.endpoint || !p256dh || !auth) throw new Error("Inscrição de push inválida.");
  await api.post("/push/subscribe", { endpoint: json.endpoint, keys: { p256dh, auth } });
}

export class PushPermissionDeniedError extends Error {
  constructor() {
    super("Permissão de notificações negada.");
    this.name = "PushPermissionDeniedError";
  }
}

/** O que este navegador tem ativo: uma inscrição Web Push (VAPID) ou um token FCM. */
export type PushHandle =
  | { provider: "webpush"; subscription: PushSubscription }
  | { provider: "fcm"; token: string };

/** Grava (idempotente) o token FCM para o usuário logado. */
async function registerFcmToken(token: string): Promise<void> {
  await api.post("/push/subscribe", { provider: "fcm", token, platform: "web" });
}

let fcmSync: Promise<string | null> | null = null;

/**
 * Renova o token FCM deste navegador e o grava para o usuário logado (idempotente). Só age se o usuário já ativou os
 * avisos aqui e a permissão continua concedida. Chamadas simultâneas (abertura do app + tela de avisos) dividem a
 * mesma requisição. Nunca lança; devolve o token ou null.
 */
export function syncFcmRegistration(config: PushConfig): Promise<string | null> {
  if (config.provider !== "fcm" || !config.firebase || !config.publicKey) return Promise.resolve(null);
  if (!isFcmMarkedActive() || typeof Notification === "undefined" || Notification.permission !== "granted") {
    return Promise.resolve(null);
  }
  const firebase = config.firebase;
  const publicKey = config.publicKey;
  fcmSync ??= (async () => {
    try {
      const token = await getFcmToken(firebase, publicKey);
      await registerFcmToken(token);
      return token;
    } catch {
      return null;
    } finally {
      fcmSync = null;
    }
  })();
  return fcmSync;
}

/** Estado real do aparelho para o transporte do servidor (regrava para o usuário logado ser o dono). */
export async function getCurrentPush(config: PushConfig): Promise<PushHandle | null> {
  if (config.provider === "fcm") {
    const token = await syncFcmRegistration(config);
    return token ? { provider: "fcm", token } : null;
  }
  const subscription = await getBrowserSubscription();
  if (subscription && Notification.permission === "granted") await registerSubscription(subscription).catch(() => undefined);
  return subscription ? { provider: "webpush", subscription } : null;
}

/** Remove a inscrição Web Push antiga deste aparelho (ao migrar para FCM não pode sobrar um aviso em duplicidade). */
async function dropLegacyWebPush(): Promise<void> {
  const subscription = await getBrowserSubscription();
  if (!subscription) return;
  await api.deleteWithBody("/push/subscribe", { endpoint: subscription.endpoint }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => false);
}

async function enableWebPush(publicKey: string): Promise<PushHandle> {
  const registration = await readyRegistration();
  const key = urlBase64ToUint8Array(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  try {
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  } catch (error) {
    // Chave do servidor trocada desde a última inscrição: descarta a antiga e inscreve de novo.
    if (error instanceof DOMException && error.name === "InvalidStateError") {
      await (await registration.pushManager.getSubscription())?.unsubscribe();
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    } else {
      throw error;
    }
  }
  await registerSubscription(subscription);
  return { provider: "webpush", subscription };
}

/** Pede permissão, ativa o transporte do servidor neste navegador e grava no servidor. Lança PushPermissionDeniedError se negar. */
export async function enablePush(config: PushConfig): Promise<PushHandle> {
  if (!config.publicKey) throw new Error("Avisos indisponíveis neste momento.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new PushPermissionDeniedError();
  if (config.provider === "fcm" && config.firebase) {
    const token = await getFcmToken(config.firebase, config.publicKey);
    await registerFcmToken(token);
    markFcmActive(true);
    void dropLegacyWebPush();
    return { provider: "fcm", token };
  }
  return enableWebPush(config.publicKey);
}

/** Desliga os avisos neste aparelho: remove do servidor e cancela a inscrição/token no navegador. */
export async function disablePush(config: PushConfig, handle: PushHandle): Promise<void> {
  if (handle.provider === "fcm") {
    try {
      await api.deleteWithBody("/push/subscribe", { token: handle.token });
    } finally {
      markFcmActive(false);
      if (config.firebase) await deleteFcmToken(config.firebase);
    }
    return;
  }
  const endpoint = handle.subscription.endpoint;
  try {
    await api.deleteWithBody("/push/subscribe", { endpoint });
  } finally {
    await handle.subscription.unsubscribe().catch(() => false);
  }
}

/** Resultado de POST /push/test: aparelhos do usuário e quantos receberam. */
export interface PushTestResult {
  sent: number;
  devices: number;
}

export function sendTestPush(): Promise<PushTestResult> {
  return api.post<PushTestResult>("/push/test");
}
