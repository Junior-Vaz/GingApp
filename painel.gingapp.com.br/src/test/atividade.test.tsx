import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AtividadePage } from "@/modules/atividade/atividade-page";
import { actionLabel } from "@/modules/atividade/atividade-api";
import { clearSession, loginAs } from "./login-as";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const LOG = {
  id: 5,
  createdAt: "2026-10-09T15:00:00.000Z",
  action: "FINANCE_PAY",
  entity: "finance",
  entityId: "42",
  userId: 9,
  userName: "Mestre Bimba",
  userEmail: "mestre@grupo.com",
  ip: "10.0.0.1",
  meta: { paidCents: 15000 },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AtividadePage />
    </QueryClientProvider>,
  );
}

describe("AtividadePage (Atividade do grupo)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearSession();
  });

  it("lista a trilha do grupo com a ação em português e envia o filtro de ação ao servidor", async () => {
    loginAs("MESTRE");
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(json(200, url.includes("action=FINANCE_PAY") ? [LOG] : [LOG, { ...LOG, id: 6, action: "UNIT_CREATE" }], { "X-Total-Count": "2" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    expect(screen.getByRole("heading", { name: "Atividade do grupo" })).toBeInTheDocument();
    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getAllByText("Baixa financeira").length).toBeGreaterThan(0));
    expect(within(table).getByText("Unidade criada")).toBeInTheDocument();
    expect(within(table).getAllByText("Mestre Bimba")[0]).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/audit-logs/me-group");

    fireEvent.change(screen.getByLabelText("Filtrar por ação"), { target: { value: "FINANCE_PAY" } });
    await waitFor(() => expect(within(screen.getByRole("table")).queryByText("Unidade criada")).not.toBeInTheDocument());
  });

  it("código de ação sem tradução aparece como veio; erro da API mostra mensagem", async () => {
    expect(actionLabel("ALGO_NOVO")).toBe("ALGO_NOVO");
    loginAs("MESTRE");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(403, { message: "Apenas o Mestre do grupo pode executar esta operação." })));
    renderPage();
    expect(await screen.findByText(/Apenas o Mestre/)).toBeInTheDocument();
  });
});
