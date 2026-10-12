import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PushSettings } from "@/components/gingapp/push-settings";

// Avisos no celular: a seção só aparece quando o servidor tem push ligado (backend mockado via fetch).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// SDK do Firebase simulado: nada vai ao FCM de verdade.
vi.mock("firebase/app", () => ({ getApps: () => [], initializeApp: (_c: unknown, name: string) => ({ name }) }));
vi.mock("firebase/messaging", () => ({
  getMessaging: () => ({}),
  getToken: async () => "tok-fcm-teste",
  deleteToken: async () => true,
  onMessage: () => () => undefined,
  isSupported: async () => true,
}));

const FIREBASE = {
  apiKey: "AIza-test",
  authDomain: "gingapp-test.firebaseapp.com",
  projectId: "gingapp-test",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc",
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const BUTTON_TEXT = "Ativar avisos no celular";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });

function mockConfig(config: Record<string, unknown> | Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "");
      if (path === "/push/config") return config instanceof Response ? config : json(200, config);
      if (path === "/push/test") return json(200, { sent: 1, devices: 1 });
      if (path === "/push/subscribe") return json(201, { subscribed: true });
      if (path === "/push/preferences") return json(200, { lessons: true, finance: true, events: true, graduations: true, announcements: true });
      return json(404, { message: `sem rota ${path}` });
    }),
  );
}

/** Navegador com suporte a push, sem inscrição prévia (jsdom não tem service worker nem PushManager). */
function stubPushCapableBrowser() {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null } }) },
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", Object.assign(class {}, { permission: "default", requestPermission: async () => "default" }));
}

async function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}><PushSettings /></QueryClientProvider>));
  await settle();
  await settle();
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
  localStorage.clear();
});

describe("PushSettings", () => {
  it("push desligado no servidor: não mostra o botão nem a seção", async () => {
    stubPushCapableBrowser();
    mockConfig({ enabled: false, publicKey: null });
    await mount();
    expect(container!.textContent).not.toContain(BUTTON_TEXT);
    expect(container!.querySelector('[data-testid="push-settings"]')).toBeNull();
  });

  it("falha ao consultar a configuração também esconde (o app segue normal)", async () => {
    stubPushCapableBrowser();
    mockConfig(json(500, { message: "erro" }));
    await mount();
    expect(container!.textContent).not.toContain(BUTTON_TEXT);
  });

  it("push ligado: mostra o botão 'Ativar avisos no celular'", async () => {
    stubPushCapableBrowser();
    mockConfig({ enabled: true, publicKey: "BPublicKeyDeTeste" });
    await mount();
    expect(container!.textContent).toContain(BUTTON_TEXT);
    expect(container!.querySelector('[data-testid="push-settings"]')).not.toBeNull();
  });

  it("config FCM: mostra o botão 'Ativar avisos' (sem baixar o SDK enquanto os avisos não foram ativados)", async () => {
    stubPushCapableBrowser();
    mockConfig({ enabled: true, provider: "fcm", publicKey: "BVapidFcm", firebase: FIREBASE });
    await mount();
    expect(container!.textContent).toContain("Ativar avisos");
    expect(container!.textContent).not.toContain("Enviar aviso de teste");
  });

  it("config FCM sem o bloco firebase (ou sem config) oculta tudo", async () => {
    stubPushCapableBrowser();
    mockConfig({ enabled: true, provider: "fcm", publicKey: "BVapidFcm", firebase: null });
    await mount();
    expect(container!.querySelector('[data-testid="push-settings"]')).toBeNull();
  });

  it("FCM já ativado neste aparelho: mostra preferências e 'Enviar aviso de teste', que chama POST /push/test", async () => {
    stubPushCapableBrowser();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register: async () => ({ active: {} }), ready: Promise.resolve({ pushManager: { getSubscription: async () => null } }) },
    });
    vi.stubGlobal("Notification", Object.assign(class {}, { permission: "granted", requestPermission: async () => "granted" }));
    localStorage.setItem("gingapp:fcm-active", "1");
    mockConfig({ enabled: true, provider: "fcm", publicKey: "BVapidFcm", firebase: FIREBASE });
    await mount();
    expect(container!.querySelector('[data-testid="push-preferences"]')).not.toBeNull();
    const button = Array.from(container!.querySelectorAll("button")).find((b) => b.textContent?.includes("Enviar aviso de teste"));
    expect(button).toBeDefined();
    act(() => button!.click());
    await settle();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls;
    const test = calls.find(([url]) => url.endsWith("/push/test"));
    expect(test?.[1]?.method).toBe("POST");
    const subscribe = calls.find(([url]) => url.endsWith("/push/subscribe"));
    expect(JSON.parse(String(subscribe?.[1]?.body))).toEqual({ provider: "fcm", token: "tok-fcm-teste", platform: "web" });
  });

  it("servidor antigo sem provider continua tratado como Web Push (compatibilidade)", async () => {
    stubPushCapableBrowser();
    mockConfig({ enabled: true, publicKey: "BPublicKeyDeTeste" });
    await mount();
    expect(container!.textContent).toContain(BUTTON_TEXT);
  });
});
