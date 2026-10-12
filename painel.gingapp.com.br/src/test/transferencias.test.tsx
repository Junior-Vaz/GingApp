import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { clearSession, loginAs } from "./login-as";
import { TransferenciasPage } from "@/modules/transferencias/transferencias-page";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; query: URLSearchParams; body: unknown };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function mockApi(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const [path = "", search = ""] = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
      const method = init.method ?? "GET";
      const call: Call = { method, path, query: new URLSearchParams(search), body: init.body ? JSON.parse(init.body as string) : undefined };
      calls.push(call);
      const handler = routes[`${method} ${path}`];
      return Promise.resolve(handler ? handler(call) : json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  return calls;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TransferenciasPage />
    </QueryClientProvider>,
  );
}

const transfer = (over: Record<string, unknown> = {}) => ({
  id: 31,
  status: "PENDING_PERSON",
  direction: "SENT",
  person: { id: 77, name: "Joana Mestra", nickname: "Jojo", photo: null, gingappCode: "GING-7K3Q-9XPM" },
  fromOrganization: { id: 3, name: "Grupo Antigo Axé", logoUrl: null },
  toOrganization: { id: 1, name: "Ginga Brasil", logoUrl: null },
  toUnit: { id: 7, name: "Sede" },
  requestedAt: "2026-10-10T15:00:00.000Z",
  expiresAt: "2026-10-24T15:00:00.000Z",
  contestUntil: "2026-10-17T15:00:00.000Z",
  decidedAt: null,
  note: "Combinado na aula",
  toStudentId: null,
  canContest: false,
  canCancel: true,
  contests: [],
  ...over,
});

const selectTab = (name: string) => fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });

beforeEach(() => loginAs("MESTRE"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("Página Transferências", () => {
  it("aba Enviadas lista pessoa, grupos, status em português, datas e observação", async () => {
    const calls = mockApi({ "GET /transfers": () => json(200, [transfer()]) });
    renderPage();
    expect(screen.getByRole("heading", { name: "Transferências" })).toBeInTheDocument();
    const card = await screen.findByTestId("transfer-card");
    expect(card).toHaveTextContent("Joana Mestra");
    expect(card).toHaveTextContent("Jojo");
    expect(card).toHaveTextContent("GING-7K3Q-9XPM");
    expect(card).toHaveTextContent("Grupo Antigo Axé");
    expect(card).toHaveTextContent("Ginga Brasil");
    expect(card).toHaveTextContent("Unidade: Sede");
    expect(card).toHaveTextContent("Aguardando a pessoa");
    expect(card).toHaveTextContent("Pedido em");
    expect(card).toHaveTextContent("Expira em");
    expect(card).toHaveTextContent("Contestação até");
    expect(card).toHaveTextContent("Combinado na aula");
    expect(calls[0]!.query.get("direction")).toBe("sent");
  });

  it("aba Recebidas consulta direction=received e mostra as contestações com o motivo em português", async () => {
    const calls = mockApi({
      "GET /transfers": (c) =>
        c.query.get("direction") === "received"
          ? json(200, [
              transfer({
                id: 40,
                direction: "RECEIVED",
                status: "COMPLETED",
                canCancel: false,
                contests: [
                  { id: 1, reason: "PENDING_PAYMENT", note: "Deve duas mensalidades", createdAt: "2026-10-11T10:00:00.000Z", organization: { id: 3, name: "Grupo Antigo Axé" } },
                ],
              }),
            ])
          : json(200, []),
    });
    renderPage();
    expect(await screen.findByText("Nenhum pedido de transferência enviado.")).toBeInTheDocument();
    selectTab("Recebidas");
    const card = await screen.findByTestId("transfer-card");
    expect(card).toHaveTextContent("Concluída");
    expect(card).toHaveTextContent("Pendência financeira");
    expect(card).toHaveTextContent("Deve duas mensalidades");
    expect(within(card).queryByRole("button", { name: /Cancelar pedido/ })).not.toBeInTheDocument();
    expect(calls.map((c) => c.query.get("direction"))).toEqual(["sent", "received"]);
  });

  it("Cancelar pede confirmação e chama POST /transfers/:id/cancel; sem canCancel o botão não existe", async () => {
    const calls = mockApi({
      "GET /transfers": () => json(200, [transfer(), transfer({ id: 32, canCancel: false, status: "DECLINED" })]),
      "POST /transfers/31/cancel": () => json(201, transfer({ status: "CANCELLED", canCancel: false })),
    });
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId("transfer-card")).toHaveLength(2));
    expect(screen.getAllByRole("button", { name: /Cancelar pedido de/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar pedido de Joana Mestra" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(calls.some((c) => c.method === "POST")).toBe(false); // ainda não confirmou
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar pedido" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/transfers/31/cancel")).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pedido de transferência cancelado."));
  });

  it("Contestar abre o diálogo (avisa que NÃO bloqueia a saída) e chama POST /transfers/:id/contest com motivo e texto", async () => {
    const calls = mockApi({
      "GET /transfers": () => json(200, [transfer({ direction: "RECEIVED", canCancel: false, canContest: true })]),
      "POST /transfers/31/contest": () => json(201, { id: 5 }),
    });
    renderPage();
    selectTab("Recebidas");
    fireEvent.click(await screen.findByRole("button", { name: "Contestar transferência de Joana Mestra" }));
    const dialog = await screen.findByRole("dialog", { name: "Contestar transferência" });
    expect(dialog).toHaveTextContent(/NÃO bloqueia a saída/);
    expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Selecione…",
      "Pendência financeira",
      "Material/equipamento",
      "Outro",
    ]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar contestação" }));
    expect(await within(dialog).findByText("Escolha o motivo da contestação.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText("Motivo"), { target: { value: "EQUIPMENT" } });
    fireEvent.change(within(dialog).getByLabelText("Explicação (opcional)"), { target: { value: "Levou o berimbau do grupo" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar contestação" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/transfers/31/contest")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ reason: "EQUIPMENT", note: "Levou o berimbau do grupo" });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Contestação registrada. Ela é informativa e não bloqueia a saída."),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Contestar transferência" })).not.toBeInTheDocument());
  });

  it("erro da API na lista mostra a mensagem", async () => {
    mockApi({ "GET /transfers": () => json(403, { message: "Somente o mestre acessa transferências." }) });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Somente o mestre acessa transferências.");
  });
});
