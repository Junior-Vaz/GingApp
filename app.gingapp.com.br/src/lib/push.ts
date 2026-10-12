import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** GET /push/config: o recurso é opcional no servidor (sem VAPID => enabled=false e nada aparece no app). */
export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
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

/** Qualquer falha vira "desligado": o app segue funcionando normalmente. */
export async function fetchPushConfig(): Promise<PushConfig> {
  try {
    const data = await api.get<Partial<PushConfig> | undefined>("/push/config");
    return { enabled: data?.enabled === true && !!data.publicKey, publicKey: data?.publicKey ?? null };
  } catch {
    return { enabled: false, publicKey: null };
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

/** Service worker pronto, com limite de tempo (em dev o SW não é registrado e `ready` nunca resolveria). */
async function readyRegistration(timeoutMs = 8000): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("O serviço de avisos não está disponível neste momento.")), timeoutMs),
  );
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

/** Inscrição atual deste navegador (ou null). Nunca lança. */
export async function getBrowserSubscription(): Promise<PushSubscription | null> {
  try {
    if (!isPushSupported()) return null;
    const registration = await readyRegistration(3000);
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** Grava (idempotente) a inscrição do navegador para o usuário logado. */
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

/** Pede permissão, inscreve o navegador e grava no servidor. Lança PushPermissionDeniedError se o usuário negar. */
export async function enablePush(publicKey: string): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new PushPermissionDeniedError();
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
  return subscription;
}

/** Desliga os avisos neste aparelho: remove do servidor e cancela a inscrição do navegador. */
export async function disablePush(subscription: PushSubscription): Promise<void> {
  const endpoint = subscription.endpoint;
  try {
    await api.deleteWithBody("/push/subscribe", { endpoint });
  } finally {
    await subscription.unsubscribe().catch(() => false);
  }
}
