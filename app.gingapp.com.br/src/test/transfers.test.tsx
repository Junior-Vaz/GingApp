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

import { TransfersPage, TransfersShortcut } from "@/components/gingapp/transfers";
import { isTransferNotification, pendingTransfersOf, type PersonTransferView } from "@/lib/queries";

/** Ficha única, Fase 2: pedidos de transferência entre grupos (backend mockado via fetch). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function transfer(overrides: Partial<PersonTransferView> = {}): PersonTransferView {
  return {
    id: 5,
    status: "PENDING_PERSON",
    person: { id: 1, name: "Ana Souza", photo: null },
    fromOrganization: { id: 10, name: "Grupo Antigo", logoUrl: null },
    toOrganization: { id: 20, name: "Grupo Novo", logoUrl: null },
    toUnit: { id: 3, name: "Unidade Centro" },
    requestedAt: "2026-10-01T12:00:00.000Z",
    expiresAt: "2026-10-15T12:00:00.000Z",
    contestUntil: "2026-10-05T12:00:00.000Z",
    decidedAt: null,
    note: null,
    contests: [],
    canDecide: true,
    decidingAs: "SELF",
    sharedOnApproval: ["ATTENDANCE", "GRADUATIONS", "CERTIFICATES"],
    ...overrides,
  };
}

interface Call {
  method: string;
  path: string;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let calls: Call[] = [];

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

function mockApi(list: PersonTransferView[], decision?: () => Response) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace(/^https?:\/\/[^/]+\/api/, "");
      const method = init?.method ?? "GET";
      calls.push({ method, path });
      if (method === "GET" && path === "/people/me/transfers") return json(200, list);
      if (method === "POST" && /^\/people\/me\/transfers\/\d+\/(approve|decline)$/.test(path)) {
        return decision ? decision() : json(200, { ...list[0], status: path.endsWith("approve") ? "APPROVED" : "DECLINED", canDecide: false });
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
const posts = () => calls.filter((c) => c.method === "POST").map((c) => c.path);

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

describe("TransfersPage", () => {
  it("lista o pedido pendente; Aprovar abre a confirmação clara e só então chama a rota de aprovação", async () => {
    mockApi([transfer()]);
    await mount(<TransfersPage />);

    expect(container!.querySelector("[data-testid=transfer-card]")).not.toBeNull();
    expect(container!.textContent).toContain("Grupo Antigo");
    expect(container!.textContent).toContain("Grupo Novo");
    expect(container!.textContent).toContain("Aguardando decisão");
    expect(container!.querySelector("[data-testid=deciding-as]")?.textContent).toBe("Você decide por si.");
    expect(posts()).toEqual([]);

    act(() => button(/^Aprovar$/)!.click());
    const confirm = container!.querySelector("[data-testid=transfer-confirm]")!.textContent!;
    expect(confirm).toContain("frequência por turma, graduações, certificados");
    expect(confirm).toContain("financeiro nunca é compartilhado");
    expect(confirm).toContain("matrícula em Grupo Antigo será encerrada");
    expect(posts()).toEqual([]); // ainda nada foi enviado

    await act(async () => button(/Confirmar aprovação/)!.click());
    await settle();
    expect(posts()).toEqual(["/people/me/transfers/5/approve"]);
    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });

  it("Recusar confirma e chama a rota de recusa", async () => {
    mockApi([transfer()]);
    await mount(<TransfersPage />);

    act(() => button(/^Recusar$/)!.click());
    expect(container!.querySelector("[data-testid=transfer-confirm]")!.textContent).toContain("Nada muda");
    await act(async () => button(/Confirmar recusa/)!.click());
    await settle();
    expect(posts()).toEqual(["/people/me/transfers/5/decline"]);
  });

  it("mostra a contestação do grupo antigo (motivo + texto) dizendo que não impede a decisão", async () => {
    mockApi([
      transfer({
        contests: [
          {
            id: 1,
            reason: "PENDING_PAYMENT",
            note: "Mensalidade de setembro em aberto.",
            createdAt: "2026-10-02T12:00:00.000Z",
            organization: { id: 10, name: "Grupo Antigo" },
          },
        ],
      }),
    ]);
    await mount(<TransfersPage />);

    const contests = container!.querySelector("[data-testid=transfer-contests]")!.textContent!;
    expect(contests).toContain("Pendência financeira");
    expect(contests).toContain("Mensalidade de setembro em aberto.");
    expect(contests).toContain("não impedem a sua decisão");
    expect(button(/^Aprovar$/)).toBeTruthy(); // a contestação não bloqueia o botão

    act(() => button(/^Aprovar$/)!.click());
    expect(container!.querySelector("[data-testid=transfer-confirm]")!.textContent).toContain("não impedem");
  });

  it("responsável vê que decide pelo dependente e a confirmação fala do dependente", async () => {
    mockApi([transfer({ decidingAs: "GUARDIAN", person: { id: 2, name: "Bruno Lima", photo: null } })]);
    await mount(<TransfersPage />);

    expect(container!.querySelector("[data-testid=deciding-as]")?.textContent).toBe("Você decide por Bruno Lima.");
    act(() => button(/^Aprovar$/)!.click());
    expect(container!.querySelector("[data-testid=transfer-confirm]")!.textContent).toContain("A matrícula de Bruno Lima em Grupo Antigo será encerrada");
  });

  it("sem canDecide: só leitura, com explicação e sem botões", async () => {
    mockApi([transfer({ canDecide: false, decidingAs: null })]);
    await mount(<TransfersPage />);

    expect(button(/^Aprovar$/)).toBeUndefined();
    expect(button(/^Recusar$/)).toBeUndefined();
    expect(container!.querySelector("[data-testid=read-only-note]")?.textContent).toContain("Quem decide é o responsável");
  });

  it("409 TRANSFER_EXPIRED: mostra mensagem clara e recarrega a lista", async () => {
    mockApi([transfer()], () => json(409, { code: "TRANSFER_EXPIRED", message: "expirado" }));
    await mount(<TransfersPage />);

    act(() => button(/^Aprovar$/)!.click());
    await act(async () => button(/Confirmar aprovação/)!.click());
    await settle();
    expect(toastMock.error).toHaveBeenCalledWith("Este pedido expirou e não pode mais ser decidido.");
    expect(calls.filter((c) => c.method === "GET" && c.path === "/people/me/transfers").length).toBeGreaterThanOrEqual(2);
  });
});

describe("selo de pedidos pendentes", () => {
  it("o atalho mostra o contador só dos pedidos que o usuário pode decidir", async () => {
    mockApi([transfer({ id: 1 }), transfer({ id: 2 }), transfer({ id: 3, canDecide: false, decidingAs: null }), transfer({ id: 4, status: "DECLINED" })]);
    await mount(<TransfersShortcut />);

    expect(container!.querySelector("[data-testid=transfers-badge]")?.textContent).toBe("2");
    expect(container!.textContent).toContain("2 pedidos aguardando a sua decisão");
    expect(container!.querySelector("a")?.getAttribute("href")).toBe("/transferencias");
  });

  it("sem nenhum pedido (ou erro) o atalho não aparece", async () => {
    mockApi([]);
    await mount(<TransfersShortcut />);
    expect(container!.querySelector("[data-testid=transfers-shortcut]")).toBeNull();
  });

  it("pendingTransfersOf e isTransferNotification", () => {
    expect(pendingTransfersOf([transfer(), transfer({ canDecide: false })]).length).toBe(1);
    expect(pendingTransfersOf(undefined)).toEqual([]);
    expect(isTransferNotification("TRANSFER_REQUEST")).toBe(true);
    expect(isTransferNotification("CLASS_REMINDER")).toBe(false);
    expect(isTransferNotification(null)).toBe(false);
  });
});
