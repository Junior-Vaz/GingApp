import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessagePayload } from "firebase/messaging";

// FCM em primeiro plano (app aberto): o SDK do Firebase é simulado - nada é enviado nem recebido de verdade.
const mocks = vi.hoisted(() => ({
  onMessageCallback: null as ((payload: unknown) => void) | null,
  unsubscribe: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("firebase/app", () => ({
  getApps: () => [],
  initializeApp: (_config: unknown, name: string) => ({ name }),
}));
vi.mock("firebase/messaging", () => ({
  getMessaging: () => ({}),
  onMessage: (_messaging: unknown, callback: (payload: unknown) => void) => {
    mocks.onMessageCallback = callback;
    return mocks.unsubscribe;
  },
}));

import { messagingSwUrl, noticeFromPayload, type FirebaseWebConfig } from "@/lib/fcm";
import { startForegroundMessages } from "@/lib/push-foreground";

const config: FirebaseWebConfig = {
  apiKey: "AIza-test",
  authDomain: "gingapp-test.firebaseapp.com",
  projectId: "gingapp-test",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc",
};

const payload = (data: Record<string, string>): MessagePayload =>
  ({ from: "123", collapseKey: "k", messageId: "m", data }) as MessagePayload;

describe("FCM em primeiro plano (onMessage)", () => {
  beforeEach(() => {
    mocks.onMessageCallback = null;
    mocks.toast.mockClear();
    mocks.unsubscribe.mockClear();
  });

  it("onMessage mostra o toast do app e atualiza o sino", async () => {
    const refreshNotifications = vi.fn();
    const navigate = vi.fn();
    const stop = await startForegroundMessages(config, { refreshNotifications, navigate });
    expect(mocks.onMessageCallback).not.toBeNull();

    mocks.onMessageCallback!({
      data: { title: "Aula cancelada", body: "A aula de sábado foi cancelada.", url: "/aulas", tag: "gingapp-lessons" },
    });

    expect(mocks.toast).toHaveBeenCalledTimes(1);
    const [title, options] = mocks.toast.mock.calls[0] as [string, { description?: string; id?: string; action?: { label: string; onClick: () => void } }];
    expect(title).toBe("Aula cancelada");
    expect(options.description).toBe("A aula de sábado foi cancelada.");
    expect(options.id).toBe("push-gingapp-lessons");
    expect(refreshNotifications).toHaveBeenCalledTimes(1);

    options.action!.onClick();
    expect(navigate).toHaveBeenCalledWith("/aulas");

    stop();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("URL de outra origem não vira ação no toast (só caminhos do próprio app)", async () => {
    await startForegroundMessages(config, { refreshNotifications: vi.fn(), navigate: vi.fn() });
    mocks.onMessageCallback!({ data: { title: "Aviso", body: "x", url: "https://malicioso.example/x", tag: "t" } });
    const options = mocks.toast.mock.calls[0]?.[1] as { action?: unknown };
    expect(options.action).toBeUndefined();
  });

  it("noticeFromPayload usa a notification quando não há data e saneia o caminho", () => {
    expect(noticeFromPayload({ ...payload({}), notification: { title: "T", body: "B" } } as MessagePayload)).toEqual({
      title: "T",
      body: "B",
      url: null,
      tag: "gingapp",
    });
    expect(noticeFromPayload(payload({ title: "A", body: "B", url: "//evil.example" })).url).toBeNull();
    expect(noticeFromPayload(payload({ title: "A", body: "B", url: "/financeiro" })).url).toBe("/financeiro");
  });

  it("o service worker do FCM recebe a config na URL de registro", () => {
    const url = new URL(messagingSwUrl({ ...config, storageBucket: "gingapp-test.appspot.com" }), "https://app.gingapp.com.br");
    expect(url.pathname).toBe("/firebase-messaging-sw.js");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      apiKey: "AIza-test",
      authDomain: "gingapp-test.firebaseapp.com",
      projectId: "gingapp-test",
      storageBucket: "gingapp-test.appspot.com",
      messagingSenderId: "123456789012",
      appId: "1:123456789012:web:abc",
    });
  });
});
