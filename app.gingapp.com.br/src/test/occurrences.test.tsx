import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children, to, className }: { children?: React.ReactNode; to?: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

import { OccurrencesPage, OccurrencesShortcut } from "@/components/gingapp/occurrences";
import { isOccurrenceNotification, type PersonOccurrenceView } from "@/lib/queries";

/** Ficha única, Fase 5: ocorrências registradas pelos grupos e contestação (backend mockado via fetch). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function occurrence(overrides: Partial<PersonOccurrenceView> = {}): PersonOccurrenceView {
  return {
    id: 8,
    kind: "SUSPENSAO",
    occurredAt: "2026-10-01T12:00:00.000Z",
    endsAt: "2026-10-15T12:00:00.000Z",
    reason: "Faltou com o respeito na roda.",
    status: "ACTIVE",
    organization: { id: 10, name: "Grupo Antigo", logoUrl: null },
    person: { id: 1, name: "Ana Souza" },
    contestedAt: null,
    contestNote: null,
    retractedAt: null,
    canContest: true,
    decidingAs: "SELF",
    ...overrides,
  };
}

interface Call {
  method: string;
  path: string;
  body: unknown;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let calls: Call[] = [];

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

function mockApi(list: PersonOccurrenceView[], contest?: () => Response) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace(/^https?:\/\/[^/]+\/api/, "");
      const method = init?.method ?? "GET";
      calls.push({ method, path, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (method === "GET" && path === "/people/me/occurrences") return json(200, list);
      if (method === "POST" && /^\/people\/me\/occurrences\/\d+\/contest$/.test(path)) {
        return contest ? contest() : json(200, { ...list[0], status: "CONTESTED", canContest: false });
      }
      return json(404, { message: `sem rota ${path}` });
    }),
  );
}

async function mount(ui: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>));
  await settle();
  await settle();
}

const button = (name: RegExp) => [...container!.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""));
const posts = () => calls.filter((c) => c.method === "POST");

function type(el: HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  localStorage.clear();
});

describe("atalho Minhas ocorrências (Perfil)", () => {
  it("aparece quando há ocorrências e leva à tela", async () => {
    mockApi([occurrence()]);
    await mount(<OccurrencesShortcut />);
    expect(container!.querySelector("[data-testid=occurrences-shortcut]")).not.toBeNull();
    expect(container!.textContent).toContain("Minhas ocorrências");
    expect(container!.querySelector("a")?.getAttribute("href")).toBe("/ocorrencias");
  });

  it("não aparece sem ocorrências", async () => {
    mockApi([]);
    await mount(<OccurrencesShortcut />);
    expect(container!.querySelector("[data-testid=occurrences-shortcut]")).toBeNull();
  });

  it("responsável vê o nome do dependente no atalho", async () => {
    mockApi([occurrence({ decidingAs: "GUARDIAN", person: { id: 2, name: "Bruno Lima" } })]);
    await mount(<OccurrencesShortcut />);
    expect(container!.querySelector("[data-testid=occurrences-shortcut-text]")?.textContent).toContain("Bruno Lima");
  });
});

describe("tela Minhas ocorrências", () => {
  it("mostra tipo, grupo, data, fim da suspensão e motivo", async () => {
    mockApi([occurrence()]);
    await mount(<OccurrencesPage />);
    const card = container!.querySelector("[data-testid=occurrence-card]")!.textContent!;
    expect(card).toContain("Suspensão");
    expect(card).toContain("Grupo Antigo");
    expect(card).toContain("01/10/2026");
    expect(card).toContain("suspensão até 15/10/2026");
    expect(card).toContain("Faltou com o respeito na roda.");
    expect(container!.querySelector("[data-testid=occurrence-person]")).toBeNull(); // adulto: sem "Sobre ..."
  });

  it("responsável vê sobre quem é a ocorrência", async () => {
    mockApi([occurrence({ decidingAs: "GUARDIAN", person: { id: 2, name: "Bruno Lima" } })]);
    await mount(<OccurrencesPage />);
    expect(container!.querySelector("[data-testid=occurrence-person]")?.textContent).toBe("Sobre Bruno Lima");
  });

  it("contestada mostra a nota e não oferece Contestar; retratada diz que o grupo retratou", async () => {
    mockApi([
      occurrence({ id: 1, status: "CONTESTED", canContest: false, contestedAt: "2026-10-03T12:00:00.000Z", contestNote: "Não foi bem assim." }),
      occurrence({ id: 2, kind: "ADVERTENCIA", endsAt: null, status: "RETRACTED", canContest: false, retractedAt: "2026-10-05T12:00:00.000Z" }),
    ]);
    await mount(<OccurrencesPage />);
    expect(container!.querySelector("[data-testid=occurrence-contested]")?.textContent).toContain("Não foi bem assim.");
    expect(container!.querySelector("[data-testid=occurrence-retracted]")?.textContent).toContain("retratou");
    const statuses = [...container!.querySelectorAll("[data-testid=occurrence-status]")].map((e) => e.textContent);
    expect(statuses).toEqual(["Contestada", "Retratada pelo grupo"]);
    expect(button(/^Contestar$/)).toBeUndefined();
  });

  it("sem canContest: só leitura, sem botão", async () => {
    mockApi([occurrence({ canContest: false, decidingAs: null })]);
    await mount(<OccurrencesPage />);
    expect(button(/^Contestar$/)).toBeUndefined();
    expect(container!.querySelector("[data-testid=occurrence-read-only]")).not.toBeNull();
  });

  it("Contestar: contador 280, confirmação e só então chama a rota com a nota", async () => {
    mockApi([occurrence()]);
    await mount(<OccurrencesPage />);

    act(() => button(/^Contestar$/)!.click());
    const area = container!.querySelector("textarea")!;
    expect(button(/Revisar e enviar/)!.disabled).toBe(true); // sem texto não envia
    type(area, "  Houve um mal-entendido.  ");
    expect(container!.querySelector("[data-testid=contest-counter]")?.textContent).toBe("27/280");

    act(() => button(/Revisar e enviar/)!.click());
    expect(container!.querySelector("[data-testid=contest-preview]")?.textContent).toBe("Houve um mal-entendido.");
    expect(container!.textContent).toContain("Grupo Antigo");
    expect(posts()).toEqual([]); // ainda nada foi enviado

    await act(async () => button(/Confirmar contestação/)!.click());
    await settle();
    expect(posts()).toEqual([{ method: "POST", path: "/people/me/occurrences/8/contest", body: { note: "Houve um mal-entendido." } }]);
    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });

  it("409 OCCURRENCE_NOT_CONTESTABLE: mensagem clara e recarrega a lista", async () => {
    mockApi([occurrence()], () => json(409, { code: "OCCURRENCE_NOT_CONTESTABLE", message: "x" }));
    await mount(<OccurrencesPage />);
    act(() => button(/^Contestar$/)!.click());
    type(container!.querySelector("textarea")!, "Discordo.");
    act(() => button(/Revisar e enviar/)!.click());
    await act(async () => button(/Confirmar contestação/)!.click());
    await settle();
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("não pode mais ser contestada"));
    expect(calls.filter((c) => c.method === "GET" && c.path === "/people/me/occurrences").length).toBeGreaterThanOrEqual(2);
  });

  it("isOccurrenceNotification", () => {
    expect(isOccurrenceNotification("OCCURRENCE_REGISTERED")).toBe(true);
    expect(isOccurrenceNotification("TRANSFER_REQUESTED")).toBe(false);
    expect(isOccurrenceNotification(null)).toBe(false);
  });
});
