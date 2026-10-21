import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { notificationDestination, notificationKind, type NotificationDto } from "@/lib/queries";
import type { PinnedCommunication } from "@/lib/communications";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
const navigateMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigateMock,
  Link: ({ children, to, className }: { children?: React.ReactNode; to?: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

import { NotificationsPage } from "@/components/gingapp/pages";

/** Tela de notificações: tipos novos (ícone/rótulo/destino) e confirmação de comunicado dentro da notificação. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (id: number, type: string | null, over: Partial<NotificationDto> = {}): NotificationDto => ({
  id,
  title: `Aviso ${id}`,
  body: `Corpo ${id}`,
  type,
  readAt: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  ...over,
});
const pinned = (over: Partial<PinnedCommunication> & { id: number }): PinnedCommunication => ({
  title: "Comunicado",
  body: "Texto",
  imageUrl: null,
  requiresAck: "READ",
  myAck: null,
  pinnedUntil: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  ...over,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let requests: { path: string; method: string; body: unknown }[] = [];

function mockApi(notifications: NotificationDto[], pinnedItems: PinnedCommunication[] = []) {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = String(input).replace(/^https?:\/\/[^/]+\/api/, "");
      const pathname = path.split("?")[0]!;
      requests.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      const json = (body: unknown, headers: Record<string, string> = {}, status = 200) =>
        new Response(JSON.stringify(body), { status, headers });
      if (pathname === "/notifications") return json(notifications, { "X-Total-Count": String(notifications.length) });
      if (pathname === "/notifications/unread-count") return json({ count: notifications.filter((n) => n.readAt === null).length });
      if (pathname === "/communications/pinned") return json({ items: pinnedItems });
      if (/^\/communications\/\d+\/ack$/.test(pathname)) return json({ ok: true }, {}, 201);
      if (/^\/notifications\/\d+\/read$/.test(pathname)) return json({});
      return json([], { "X-Total-Count": "0" });
    }),
  );
}

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}><NotificationsPage /></QueryClientProvider>));
}

const waitFor = (assertion: () => void) => act(async () => void (await vi.waitFor(assertion, { timeout: 3000 })));
const items = () => [...container!.querySelectorAll<HTMLElement>(".notice-item")];
const itemWith = (title: string) => items().find((el) => el.textContent?.includes(title))!;
const buttonIn = (el: HTMLElement, name: string | RegExp) =>
  [...el.querySelectorAll("button")].find((b) => (typeof name === "string" ? b.textContent === name : name.test(b.textContent ?? "")));
const posts = (suffix: RegExp) => requests.filter((r) => r.method === "POST" && suffix.test(r.path));

beforeEach(() => {
  localStorage.clear();
  navigateMock.mockClear();
  Object.values(toastMock).forEach((fn) => fn.mockClear());
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("Notificações: tipos novos", () => {
  it("cada tipo novo mostra o rótulo e o ícone próprios; tipo antigo/desconhecido mantém 'GingApp' + sino", async () => {
    mockApi([
      note(1, "BIRTHDAY_GREETING"),
      note(2, "BIRTHDAY_CONGRATS"),
      note(3, "BIRTHDAY_DIGEST"),
      note(4, "COMMUNICATION"),
      note(5, "FEED_ACTIVITY"),
      note(6, "FEED_APPROVED"),
      note(7, "FEED_HIDDEN"),
      note(8, "ATTENDANCE_PRESENT"),
      note(9, null),
    ]);
    mount();
    await waitFor(() => expect(items()).toHaveLength(9));
    const meta = (title: string) => itemWith(title).querySelector(".notice-meta")!;
    const expected: [string, string, string][] = [
      ["Aviso 1", "Parabéns", "lucide-cake"],
      ["Aviso 2", "Parabéns do grupo", "lucide-party-popper"],
      ["Aviso 3", "Aniversariantes", "lucide-cake"],
      ["Aviso 4", "Comunicado", "lucide-megaphone"],
      ["Aviso 5", "Feed do grupo", "lucide-messages-square"],
      ["Aviso 6", "Feed do grupo", "lucide-circle-check"],
      ["Aviso 7", "Feed do grupo", "lucide-eye-off"],
      ["Aviso 8", "GingApp", "lucide-bell"],
      ["Aviso 9", "GingApp", "lucide-bell"],
    ];
    for (const [title, label, icon] of expected) {
      expect(meta(title).querySelector("span")?.textContent, title).toBe(label);
      expect(meta(title).querySelector(`svg.${icon}`), `${title} ${icon}`).toBeTruthy();
    }
  });

  it("destino ao tocar: FEED_* -> /feed; COMMUNICATION fica na tela; cargo/transferência/ocorrência seguem iguais", async () => {
    mockApi([note(1, "FEED_ACTIVITY"), note(2, "COMMUNICATION"), note(3, "ROLE_GRANTED"), note(4, "TRANSFER_REQUESTED"), note(5, "OCCURRENCE_REGISTERED"), note(6, "BIRTHDAY_GREETING")]);
    mount();
    await waitFor(() => expect(items()).toHaveLength(6));
    const tap = async (title: string) => act(async () => itemWith(title).click());

    await tap("Aviso 1");
    expect(navigateMock).toHaveBeenLastCalledWith({ to: "/feed" });
    navigateMock.mockClear();
    await tap("Aviso 2");
    await tap("Aviso 6");
    expect(navigateMock).not.toHaveBeenCalled();
    await tap("Aviso 3");
    expect(navigateMock).toHaveBeenLastCalledWith({ to: "/perfil" });
    await tap("Aviso 4");
    expect(navigateMock).toHaveBeenLastCalledWith({ to: "/transferencias" });
    await tap("Aviso 5");
    expect(navigateMock).toHaveBeenLastCalledWith({ to: "/ocorrencias" });
    // tocar marca como lida
    expect(requests.some((r) => r.method === "PATCH" && r.path === "/notifications/1/read")).toBe(true);
  });

  it("notificationKind / notificationDestination (funções puras)", () => {
    expect(notificationKind("FEED_HIDDEN")).toEqual({ label: "Feed do grupo", icon: "hidden" });
    expect(notificationKind("QUALQUER")).toEqual({ label: "GingApp", icon: "default" });
    expect(notificationDestination("FEED_APPROVED")).toBe("/feed");
    expect(notificationDestination("COMMUNICATION")).toBe("/notificacoes");
    expect(notificationDestination("BIRTHDAY_DIGEST")).toBeNull();
    expect(notificationDestination(null)).toBeNull();
  });
});

describe("Notificações: confirmação do comunicado (data.communicationId)", () => {
  it("comunicado fixado com READ: mostra 'Li e entendi'; clicar envia o ack, marca a notificação como lida e NÃO navega", async () => {
    mockApi([note(1, "COMMUNICATION", { data: { communicationId: 55 } })], [pinned({ id: 55, requiresAck: "READ" })]);
    mount();
    await waitFor(() => expect(buttonIn(itemWith("Aviso 1"), "Li e entendi")).toBeTruthy());
    await act(async () => buttonIn(itemWith("Aviso 1"), "Li e entendi")!.click());
    await waitFor(() => expect(posts(/\/communications\/55\/ack$/)).toHaveLength(1));
    expect(posts(/ack$/)[0]!.body).toEqual({ response: "READ" });
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH" && r.path === "/notifications/1/read")).toBe(true));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("comunicado fixado com GOING: 'Vou' / 'Não vou' e mostra a resposta atual (myAck)", async () => {
    mockApi([note(1, "COMMUNICATION", { data: { communicationId: 56 } })], [pinned({ id: 56, requiresAck: "GOING", myAck: "GOING" })]);
    mount();
    await waitFor(() => expect(buttonIn(itemWith("Aviso 1"), "Vou")).toBeTruthy());
    expect(buttonIn(itemWith("Aviso 1"), "Vou")!.getAttribute("aria-pressed")).toBe("true");
    expect(buttonIn(itemWith("Aviso 1"), /Não vou/)!.getAttribute("aria-pressed")).toBe("false");
    expect(buttonIn(itemWith("Aviso 1"), "Li e entendi")).toBeUndefined();
    await act(async () => buttonIn(itemWith("Aviso 1"), /Não vou/)!.click());
    await waitFor(() => expect(posts(/\/communications\/56\/ack$/)[0]?.body).toEqual({ response: "NOT_GOING" }));
  });

  it("comunicado NÃO fixado: só 'Li e entendi' (sem requiresAck no contrato da notificação)", async () => {
    mockApi([note(1, "COMMUNICATION", { data: { communicationId: 77 } })], []);
    mount();
    await waitFor(() => expect(buttonIn(itemWith("Aviso 1"), "Li e entendi")).toBeTruthy());
    expect(buttonIn(itemWith("Aviso 1"), "Vou")).toBeUndefined();
    await act(async () => buttonIn(itemWith("Aviso 1"), "Li e entendi")!.click());
    await waitFor(() => expect(buttonIn(itemWith("Aviso 1"), /Lido/)).toBeTruthy());
    expect(posts(/\/communications\/77\/ack$/)[0]!.body).toEqual({ response: "READ" });
  });

  it("sem communicationId, ou comunicado fixado sem confirmação (NONE), não mostra botões", async () => {
    mockApi(
      [note(1, "COMMUNICATION"), note(2, "COMMUNICATION", { data: { communicationId: 90 } }), note(3, "FEED_ACTIVITY", { data: { postId: 4 } })],
      [pinned({ id: 90, requiresAck: "NONE" })],
    );
    mount();
    await waitFor(() => expect(items()).toHaveLength(3));
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 60))));
    expect(container!.querySelectorAll(".notice-item button")).toHaveLength(0);
  });
});
