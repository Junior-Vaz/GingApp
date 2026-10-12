import type { MessagePayload } from "firebase/messaging";

/**
 * Firebase Cloud Messaging no navegador. O SDK `firebase` é pesado: aqui ele só é importado DINAMICAMENTE (chunk
 * separado, fora do bundle inicial) e só quando o servidor responde provider "fcm" em GET /push/config. A config
 * do SDK vem desse endpoint em tempo de execução (nada de VITE_* no build).
 */

/** Objeto `firebaseConfig` do SDK web (campos públicos), como GET /push/config devolve. */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId: string;
  appId: string;
}

/** Escopo próprio do service worker do FCM: separado do `/` do sw.js do PWA, então os dois não disputam o controle. */
export const FCM_SW_SCOPE = "/firebase-cloud-messaging-push-scope";
const FCM_SW_PATH = "/firebase-messaging-sw.js";
/** Lembra, neste navegador, que o usuário ativou os avisos (o token em si fica no IndexedDB do SDK). */
const ACTIVE_KEY = "gingapp:fcm-active";

export function isFcmMarkedActive(): boolean {
  try {
    return localStorage.getItem(ACTIVE_KEY) === "1";
  } catch {
    return false;
  }
}

const activeListeners = new Set<() => void>();

/** Para useSyncExternalStore: avisa quando os avisos são ativados/desativados neste navegador. */
export function subscribeFcmActive(listener: () => void): () => void {
  activeListeners.add(listener);
  return () => activeListeners.delete(listener);
}

export function markFcmActive(active: boolean): void {
  try {
    if (active) localStorage.setItem(ACTIVE_KEY, "1");
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* modo privado: segue sem lembrar */
  }
  activeListeners.forEach((listener) => listener());
}

/** URL de registro do service worker: o worker não vê a config de runtime, então ela viaja na query string. */
export function messagingSwUrl(config: FirebaseWebConfig): string {
  const params = new URLSearchParams();
  params.set("apiKey", config.apiKey);
  params.set("authDomain", config.authDomain);
  params.set("projectId", config.projectId);
  if (config.storageBucket) params.set("storageBucket", config.storageBucket);
  params.set("messagingSenderId", config.messagingSenderId);
  params.set("appId", config.appId);
  return `${FCM_SW_PATH}?${params.toString()}`;
}

async function loadMessaging(config: FirebaseWebConfig) {
  const [{ initializeApp, getApps }, messagingModule] = await Promise.all([
    import("firebase/app"),
    import("firebase/messaging"),
  ]);
  const name = "gingapp-fcm";
  const app = getApps().find((a) => a.name === name) ?? initializeApp(config, name);
  return { messagingModule, messaging: messagingModule.getMessaging(app) };
}

/** Espera o worker recém-registrado ativar (getToken exige um registro com worker ativo). */
async function waitUntilActive(registration: ServiceWorkerRegistration, timeoutMs = 10000): Promise<void> {
  if (registration.active) return;
  const worker = registration.installing ?? registration.waiting;
  if (!worker) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("O serviço de avisos não ficou pronto a tempo.")), timeoutMs);
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") {
        clearTimeout(timer);
        resolve();
      } else if (worker.state === "redundant") {
        clearTimeout(timer);
        reject(new Error("O serviço de avisos não pôde ser instalado."));
      }
    });
  });
}

/** Registra (idempotente) o service worker do FCM com a config na URL e o escopo próprio. */
export async function registerMessagingServiceWorker(config: FirebaseWebConfig): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(messagingSwUrl(config), { scope: FCM_SW_SCOPE });
  await waitUntilActive(registration);
  return registration;
}

/** Token de registro do FCM deste navegador (cria se não existir). A permissão de notificação já deve estar concedida. */
export async function getFcmToken(config: FirebaseWebConfig, vapidKey: string): Promise<string> {
  const registration = await registerMessagingServiceWorker(config);
  const { messaging, messagingModule } = await loadMessaging(config);
  const token = await messagingModule.getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error("Não foi possível obter o token de avisos deste aparelho.");
  return token;
}

/** Apaga o token no SDK/FCM (o servidor é avisado à parte por DELETE /push/subscribe). Nunca lança. */
export async function deleteFcmToken(config: FirebaseWebConfig): Promise<void> {
  try {
    const { messaging, messagingModule } = await loadMessaging(config);
    await messagingModule.deleteToken(messaging);
  } catch {
    /* sem token/SDK: nada a apagar */
  }
}

/** Avisos recebidos com o app ABERTO (onMessage). Devolve a função que cancela a escuta. */
export async function listenForegroundMessages(
  config: FirebaseWebConfig,
  handler: (payload: MessagePayload) => void,
): Promise<() => void> {
  const { messaging, messagingModule } = await loadMessaging(config);
  return messagingModule.onMessage(messaging, handler);
}

/** O SDK só funciona em contexto seguro com service worker, Push e Notification (no iOS, só com o app instalado). */
export async function isFcmSupported(): Promise<boolean> {
  try {
    const { isSupported } = await import("firebase/messaging");
    return await isSupported();
  } catch {
    return false;
  }
}

/** Dados do aviso em primeiro plano, já saneados: título/corpo/caminho interno (nunca URL de outra origem). */
export interface ForegroundNotice {
  title: string;
  body: string;
  /** Caminho dentro do app (ex.: "/aulas") ou null. */
  url: string | null;
  tag: string;
}

export function noticeFromPayload(payload: MessagePayload): ForegroundNotice {
  const data = payload.data ?? {};
  const title = data["title"] || payload.notification?.title || "GingApp";
  const body = data["body"] ?? payload.notification?.body ?? "";
  const raw = data["url"] ?? "";
  // Só caminhos do próprio app ("/algo"); "//host" e esquemas viram "sem destino".
  const url = raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
  return { title, body, url, tag: data["tag"] || "gingapp" };
}
