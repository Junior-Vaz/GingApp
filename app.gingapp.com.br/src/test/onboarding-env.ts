import { vi } from "vitest";

/**
 * Apoio dos testes de instalação/notificações (não é um teste: sem sufixo .test). Simula o aparelho — user agent,
 * modo standalone, prefers-reduced-motion, evento beforeinstallprompt e navegador com push — e desfaz tudo no restore().
 */

const UA = {
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  iphoneEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/126.2592.87 Version/17.0 Mobile/15E148 Safari/604.1",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0",
  ipadSafari:
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  macDesktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
} as const;

const realMatchMedia = window.matchMedia;

function setUserAgent(userAgent: string, touchPoints = 0) {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: touchPoints });
}

/** matchMedia que responde "true" só para as consultas pedidas (as demais ficam false, como no setup global). */
function stubMedia(matching: (query: string) => boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matching(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const flags = { standalone: null as null | "display-mode" | "navigator", reduced: false };

function applyMedia() {
  stubMedia(
    (query) =>
      (flags.standalone === "display-mode" && query.includes("display-mode: standalone")) ||
      (flags.reduced && query.includes("prefers-reduced-motion: reduce")),
  );
}

function setStandalone(kind: "display-mode" | "navigator" | null) {
  flags.standalone = kind;
  if (kind === "navigator") Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
  else Reflect.deleteProperty(navigator, "standalone");
  applyMedia();
}

function setReducedMotion(reduced: boolean) {
  flags.reduced = reduced;
  applyMedia();
}

export interface FakeInstallEvent extends Event {
  prompt: ReturnType<typeof vi.fn>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** Dispara o beforeinstallprompt como o Chrome faz (cancelável, com prompt() e userChoice). */
function dispatchInstallPrompt(outcome: "accepted" | "dismissed" = "accepted"): FakeInstallEvent {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as FakeInstallEvent;
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome, platform: "web" });
  window.dispatchEvent(event);
  return event;
}

/** Navegador com service worker + Push + Notification (jsdom não tem nenhum dos três). */
function stubPushCapableBrowser(permission: NotificationPermission = "default") {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null } }) },
  });
  vi.stubGlobal("PushManager", class {});
  const requestPermission = vi.fn(async () => permission);
  vi.stubGlobal("Notification", Object.assign(class {}, { permission, requestPermission }));
  return { requestPermission };
}

function setNotificationPermission(permission: NotificationPermission) {
  (Notification as unknown as { permission: NotificationPermission }).permission = permission;
}

function restore() {
  Reflect.deleteProperty(navigator, "userAgent");
  Reflect.deleteProperty(navigator, "maxTouchPoints");
  Reflect.deleteProperty(navigator, "standalone");
  Reflect.deleteProperty(navigator, "serviceWorker");
  flags.standalone = null;
  flags.reduced = false;
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: realMatchMedia });
  vi.unstubAllGlobals();
  localStorage.clear();
}

export const env = {
  UA,
  setUserAgent,
  setStandalone,
  setReducedMotion,
  dispatchInstallPrompt,
  stubPushCapableBrowser,
  setNotificationPermission,
  restore,
};
