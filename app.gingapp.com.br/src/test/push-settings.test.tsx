import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PushSettings } from "@/components/gingapp/push-settings";

// Avisos no celular: a seção só aparece quando o servidor tem push ligado (backend mockado via fetch).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const BUTTON_TEXT = "Ativar avisos no celular";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });

function mockConfig(config: { enabled: boolean; publicKey: string | null } | Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "");
      if (path === "/push/config") return config instanceof Response ? config : json(200, config);
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
});
