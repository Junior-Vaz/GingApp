import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  communicationIdOf,
  communicationImageSrc,
  linkifyText,
  notificationRequiresAck,
  safeHttpUrl,
  type PinnedCommunication,
} from "@/lib/communications";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { PinnedCommunications } from "@/components/gingapp/pinned-communications";

/** Comunicados fixados: sanitização do texto, confirmação READ/GOING/NOT_GOING e atualização otimista (API mockada). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const comm = (over: Partial<PinnedCommunication> & { id: number }): PinnedCommunication => ({
  title: "Aviso",
  body: "Texto",
  imageUrl: null,
  requiresAck: "NONE",
  myAck: null,
  pinnedUntil: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  ...over,
});

interface Reply {
  status?: number;
  body: unknown;
  /** Se informado, a resposta só sai quando a promessa resolver (para provar o estado otimista). */
  gate?: Promise<void>;
}
type Handler = (path: string, init: RequestInit) => Reply | undefined;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let requests: { path: string; method: string; body: unknown }[] = [];

function mockApi(handler: Handler) {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = String(input).replace(/^https?:\/\/[^/]+\/api/, "");
      requests.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      const reply = handler(path, init) ?? { status: 404, body: { message: `sem rota ${path}` } };
      if (reply.gate) await reply.gate;
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    }),
  );
}

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}><PinnedCommunications /></QueryClientProvider>));
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
const waitFor = (assertion: () => void) => act(async () => void (await vi.waitFor(assertion, { timeout: 2000 })));
const text = () => (container?.textContent ?? "");
const buttonText = (name: RegExp | string) =>
  [...container!.querySelectorAll("button")].find((b) => (typeof name === "string" ? b.textContent === name : name.test(b.textContent ?? "")));
const acks = () => requests.filter((r) => r.method === "POST");
const pinnedReply = (items: PinnedCommunication[]): Handler => (path) => (path === "/communications/pinned" ? { body: { items } } : undefined);

beforeEach(() => {
  localStorage.clear();
  Object.values(toastMock).forEach((fn) => fn.mockClear());
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("PinnedCommunications: conteúdo e sanitização", () => {
  it("mostra título, 'Fixado', texto com quebras de linha e imagem opcional", async () => {
    mockApi(pinnedReply([comm({ id: 1, title: "Roda de sábado", body: "Linha 1\nLinha 2\n\nLinha 4", imageUrl: "https://img.test/a.jpg" })]));
    mount();
    await waitFor(() => expect(container!.querySelector("[data-testid=pinned-1]")).toBeTruthy());
    expect(text()).toContain("Roda de sábado");
    expect(text()).toContain("Fixado");
    const body = container!.querySelector("[data-testid=communication-body]")!;
    expect(body.textContent).toBe("Linha 1\nLinha 2\n\nLinha 4");
    expect(body.className).toContain("whitespace-pre-line");
    expect(container!.querySelector("img")?.getAttribute("src")).toBe("https://img.test/a.jpg");
  });

  it("links: só http(s), com rel noopener noreferrer nofollow; HTML e javascript: viram texto, nunca elemento", async () => {
    mockApi(
      pinnedReply([
        comm({
          id: 2,
          body: 'Veja https://exemplo.com/inscricao, e <script>window.__xss=1</script> <img src=x onerror="window.__xss=2"> javascript:alert(1) ftp://x.com <b>negrito</b>',
        }),
      ]),
    );
    mount();
    await waitFor(() => expect(container!.querySelector("[data-testid=communication-body]")).toBeTruthy());
    const links = [...container!.querySelectorAll("[data-testid=communication-body] a")];
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("https://exemplo.com/inscricao");
    expect(links[0]!.textContent).toBe("https://exemplo.com/inscricao");
    expect(links[0]!.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(links[0]!.getAttribute("target")).toBe("_blank");
    const body = container!.querySelector("[data-testid=communication-body]")!;
    // nenhum elemento vindo do texto
    expect(body.querySelector("script, img, b")).toBeNull();
    expect(container!.querySelectorAll("img")).toHaveLength(0);
    expect(body.textContent).toContain("<script>window.__xss=1</script>");
    expect(body.textContent).toContain("<b>negrito</b>");
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it("esconde-se sozinho quando não há comunicados fixados ou a API falha", async () => {
    mockApi(pinnedReply([]));
    mount();
    await settle();
    expect(requests.map((r) => r.path)).toContain("/communications/pinned");
    expect(container!.querySelector("[data-testid=pinned-communications]")).toBeNull();
    expect(text()).toBe("");
    act(() => root?.unmount());
    container?.remove();
    root = null;

    mockApi((path) => (path === "/communications/pinned" ? { status: 500, body: { message: "boom" } } : undefined));
    mount();
    await settle();
    expect(text()).toBe("");
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("sem confirmação (NONE) não mostra botões", async () => {
    mockApi(pinnedReply([comm({ id: 3, requiresAck: "NONE" })]));
    mount();
    await waitFor(() => expect(container!.querySelector("[data-testid=pinned-3]")).toBeTruthy());
    expect(container!.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("PinnedCommunications: confirmação", () => {
  it("READ: 'Li e entendi' envia {response:'READ'} e passa a 'Lido ✓' (desabilitado)", async () => {
    let current: PinnedCommunication["myAck"] = null; // o servidor guarda a resposta (o refetch depois do ack a devolve)
    mockApi((path, init) => {
      if (path === "/communications/pinned") return { body: { items: [comm({ id: 10, title: "Regras", requiresAck: "READ", myAck: current })] } };
      if (path === "/communications/10/ack" && init.method === "POST") {
        current = "READ";
        return { status: 201, body: { ok: true, response: "READ" } };
      }
      return undefined;
    });
    mount();
    await waitFor(() => expect(buttonText("Li e entendi")).toBeTruthy());
    expect(buttonText("Li e entendi")!.className).toContain("min-h-11");
    await act(async () => buttonText("Li e entendi")!.click());
    await waitFor(() => expect(buttonText(/Lido/)).toBeTruthy());
    expect(acks()).toEqual([{ path: "/communications/10/ack", method: "POST", body: { response: "READ" } }]);
    expect((buttonText(/Lido/) as HTMLButtonElement).disabled).toBe(true);
    expect(buttonText("Li e entendi")).toBeUndefined();
  });

  it("READ já confirmado (myAck=READ) nasce como 'Lido ✓' e não reenvia", async () => {
    mockApi(pinnedReply([comm({ id: 11, requiresAck: "READ", myAck: "READ" })]));
    mount();
    await waitFor(() => expect(buttonText(/Lido/)).toBeTruthy());
    await act(async () => buttonText(/Lido/)!.click());
    expect(acks()).toHaveLength(0);
  });

  it("GOING: 'Vou' / 'Não vou' com estado selecionado (aria-pressed) e troca GOING -> NOT_GOING -> GOING", async () => {
    let current: PinnedCommunication["myAck"] = null;
    mockApi((path, init) => {
      if (path === "/communications/pinned") return { body: { items: [comm({ id: 20, title: "Roda", requiresAck: "GOING", myAck: current })] } };
      if (path === "/communications/20/ack" && init.method === "POST") {
        current = (JSON.parse(String(init.body)) as { response: PinnedCommunication["myAck"] }).response;
        return { status: 201, body: { ok: true, response: current } };
      }
      return undefined;
    });
    mount();
    await waitFor(() => expect(buttonText("Vou")).toBeTruthy());
    const pressed = (label: string) => buttonText(label)!.getAttribute("aria-pressed");
    expect(pressed("Vou")).toBe("false");
    expect(pressed("Não vou")).toBe("false");

    await act(async () => buttonText("Vou")!.click());
    await waitFor(() => expect(pressed("Vou")).toBe("true"));
    expect(pressed("Não vou")).toBe("false");

    await act(async () => buttonText(/Não vou/)!.click());
    await waitFor(() => expect(pressed("Não vou")).toBe("true"));
    expect(pressed("Vou")).toBe("false");

    // clicar no já selecionado não reenvia
    await act(async () => buttonText(/Não vou/)!.click());
    await act(async () => buttonText("Vou")!.click());
    await waitFor(() => expect(pressed("Vou")).toBe("true"));
    expect(acks().map((r) => r.body)).toEqual([{ response: "GOING" }, { response: "NOT_GOING" }, { response: "GOING" }]);
  });

  it("atualização otimista: o botão muda ANTES da resposta do servidor", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let saved: PinnedCommunication["myAck"] = null;
    mockApi((path, init) => {
      if (path === "/communications/pinned") return { body: { items: [comm({ id: 30, requiresAck: "GOING", myAck: saved })] } };
      if (path === "/communications/30/ack" && init.method === "POST") {
        saved = "GOING";
        return { status: 201, body: { ok: true, response: "GOING" }, gate };
      }
      return undefined;
    });
    mount();
    await waitFor(() => expect(buttonText("Vou")).toBeTruthy());
    await act(async () => buttonText("Vou")!.click());
    // a requisição saiu, a resposta ainda não: a tela já mostra "Vou" selecionado
    await waitFor(() => expect(acks()).toHaveLength(1));
    expect(buttonText("Vou")!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => release());
    await settle();
    expect(buttonText("Vou")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("servidor recusa: volta ao estado anterior e avisa", async () => {
    mockApi((path, init) => {
      if (path === "/communications/pinned") return { body: { items: [comm({ id: 40, requiresAck: "GOING", myAck: "NOT_GOING" })] } };
      if (path === "/communications/40/ack" && init.method === "POST") return { status: 403, body: { message: "Comunicado indisponível." } };
      return undefined;
    });
    mount();
    await waitFor(() => expect(buttonText(/Não vou/)).toBeTruthy());
    await act(async () => buttonText("Vou")!.click());
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Comunicado indisponível."));
    await settle();
    expect(buttonText("Vou")!.getAttribute("aria-pressed")).toBe("false");
    expect(buttonText(/Não vou/)!.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("helpers de comunicados", () => {
  it("linkifyText: separa texto e links, tira pontuação final, ignora esquemas perigosos", () => {
    expect(linkifyText("Veja https://a.com/x), ok")).toEqual([
      { type: "text", text: "Veja " },
      { type: "link", text: "https://a.com/x", href: "https://a.com/x" },
      { type: "text", text: "), ok" },
    ]);
    expect(linkifyText("sem link")).toEqual([{ type: "text", text: "sem link" }]);
    expect(linkifyText("javascript:alert(1) data:text/html,x")).toEqual([{ type: "text", text: "javascript:alert(1) data:text/html,x" }]);
    expect(linkifyText("")).toEqual([]);
  });

  it("safeHttpUrl / communicationImageSrc só aceitam http(s) ou caminho /api/", () => {
    expect(safeHttpUrl("https://a.com")).toBe("https://a.com/");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
    expect(safeHttpUrl("//evil.com/x")).toBeNull();
    expect(communicationImageSrc("javascript:alert(1)")).toBeNull();
    expect(communicationImageSrc("//evil.com/x.png")).toBeNull();
    expect(communicationImageSrc(null)).toBeNull();
    expect(communicationImageSrc("https://img.test/a.png")).toBe("https://img.test/a.png");
    expect(communicationImageSrc("/api/uploads/x.png")).toMatch(/\/api\/uploads\/x\.png$/);
  });

  it("communicationIdOf / notificationRequiresAck leem data da notificação", () => {
    expect(communicationIdOf({ data: { communicationId: 12 } })).toBe(12);
    expect(communicationIdOf({ data: { communicationId: "13" } })).toBe(13);
    expect(communicationIdOf({ data: { communicationId: "x" } })).toBeNull();
    expect(communicationIdOf({ data: null })).toBeNull();
    expect(communicationIdOf({})).toBeNull();
    expect(notificationRequiresAck({ data: { requiresAck: "GOING" } })).toBe("GOING");
    expect(notificationRequiresAck({ data: { requiresAck: "?" } })).toBeUndefined();
  });
});
