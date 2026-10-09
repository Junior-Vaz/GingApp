import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { FinanceiroPage } from "@/modules/financeiro/financeiro-page";
import {
  effectiveStatus,
  parseReaisToCents,
  toCreatePayload,
  toUpdatePayload,
  type FinanceRecord,
  type FinanceSummary,
} from "@/modules/financeiro/finance-utils";
import { formatCurrency } from "@/lib/format";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const rec = (o: Partial<FinanceRecord> & { id: number }): FinanceRecord => ({
  studentId: 1,
  unitId: null,
  description: "Mensalidade",
  amountCents: 15000,
  type: "Mensalidade",
  dueDate: "2099-01-10T00:00:00.000Z",
  paidAt: null,
  status: "PENDING",
  ...o,
});

const records: FinanceRecord[] = [
  rec({ id: 1, description: "Mensalidade Ana", amountCents: 15000, status: "PAID", paidAt: "2024-01-05T10:00:00.000Z", dueDate: "2024-01-10T00:00:00.000Z" }),
  rec({ id: 2, description: "Mensalidade Bia", amountCents: 20050, status: "PENDING", dueDate: "2099-02-10T00:00:00.000Z", studentId: 2 }),
  rec({ id: 3, description: "Camiseta", type: null, studentId: null, amountCents: 5000, status: "PENDING", dueDate: "2020-01-10T00:00:00.000Z" }),
];

// Numeros propositalmente MAIORES que a pagina de 3 itens: provam que os cards vem do servidor.
const SUMMARY: FinanceSummary = {
  paid: 1234500,
  pending: 98765,
  overdue: 18050,
  count: 120,
  paidCount: 80,
  pendingCount: 30,
  overdueCount: 10,
};

type Call = { method: string; path: string; query: URLSearchParams; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/** fetch falso roteado por "METHOD /caminho" (sem prefixo da API nem query); registra as chamadas. */
function mockApi(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const [path = "", search = ""] = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
      const method = init.method ?? "GET";
      const call: Call = {
        method,
        path,
        query: new URLSearchParams(search),
        body: init.body ? JSON.parse(init.body as string) : undefined,
      };
      calls.push(call);
      const handler = routes[`${method} ${path}`];
      return Promise.resolve(handler ? handler(call) : json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  return calls;
}

const base = () => ({
  "GET /finance": () => json(200, records, { "X-Total-Count": String(records.length) }),
  "GET /finance/summary": () => json(200, SUMMARY),
  "GET /students": () =>
    json(200, [{ id: 1, name: "Ana" }, { id: 2, name: "Bia" }], { "X-Total-Count": "2" }),
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FinanceiroPage />
    </QueryClientProvider>,
  );
}

const lastOf = (calls: Call[], path: string) => calls.filter((c) => c.method === "GET" && c.path === path).at(-1)!;
const mutations = (calls: Call[], method: string) => calls.filter((c) => c.method === method);

const formValues = {
  description: " X ",
  studentId: "2",
  type: "",
  amountReais: "10,00",
  dueDate: "2025-03-01",
  status: "PAID" as const,
  paidAt: "2025-03-02",
};

describe("financeiro utils", () => {
  it("parse de reais e BRL", () => {
    expect(parseReaisToCents("12,50")).toBe(1250);
    expect(parseReaisToCents("1.234,56")).toBe(123456);
    expect(parseReaisToCents("12.5")).toBe(1250);
    expect(parseReaisToCents("abc")).toBeNaN();
    expect(formatCurrency(20050).replace(/\s/g, " ")).toBe("R$ 200,50");
  });

  it("status efetivo concorda com o servidor: PENDING vencido = OVERDUE; vence hoje = PENDING", () => {
    const today = new Date(2026, 9, 9); // 2026-10-09 local
    const at = (dueDate: string, status: FinanceRecord["status"] = "PENDING") => rec({ id: 9, dueDate, status });
    expect(effectiveStatus(at("2026-10-08T00:00:00.000Z"), today)).toBe("OVERDUE");
    expect(effectiveStatus(at("2026-10-09T00:00:00.000Z"), today)).toBe("PENDING");
    expect(effectiveStatus(at("2026-10-10T00:00:00.000Z"), today)).toBe("PENDING");
    expect(effectiveStatus(at("2020-01-01T00:00:00.000Z", "PAID"), today)).toBe("PAID");
    expect(effectiveStatus(at("2020-01-01T00:00:00.000Z", "CANCELLED"), today)).toBe("CANCELLED");
    expect(effectiveStatus(at("2020-01-01T00:00:00.000Z", "OVERDUE"), today)).toBe("OVERDUE");
    expect(effectiveStatus(records[2]!)).toBe("OVERDUE");
    expect(effectiveStatus(records[1]!)).toBe("PENDING");
  });

  it("create omite vazios; update manda null em type/studentId esvaziados e nunca null nos obrigatorios", () => {
    expect(toCreatePayload(formValues)).toEqual({ description: "X", amountCents: 1000, dueDate: "2025-03-01", studentId: 2 });
    expect(toUpdatePayload(formValues)).toEqual({
      description: "X",
      amountCents: 1000,
      dueDate: "2025-03-01",
      studentId: 2,
      type: null,
      status: "PAID",
      paidAt: "2025-03-02",
    });
    const cleared = toUpdatePayload({ ...formValues, studentId: "", type: "  ", status: "PENDING" });
    expect(cleared).toMatchObject({ studentId: null, type: null, status: "PENDING" });
    expect(cleared).not.toHaveProperty("paidAt");
    expect(cleared).not.toHaveProperty("unitId");
    expect(toUpdatePayload({ ...formValues, paidAt: "" })).not.toHaveProperty("paidAt");
  });
});

describe("FinanceiroPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("lista no servidor: params iniciais, sem filtros vazios e sem aviso de lista parcial", async () => {
    const calls = mockApi(base());
    renderPage();
    await screen.findByText("Mensalidade Ana");
    expect(screen.getByText("Camiseta")).toBeInTheDocument();
    const list = calls.find((c) => c.path === "/finance")!;
    expect(list.query.get("limit")).toBe("10");
    expect(list.query.get("offset")).toBe("0");
    for (const k of ["status", "studentId", "from", "to", "q"]) expect(list.query.has(k)).toBe(false);
    expect(screen.getByTestId("table-count")).toHaveTextContent("3 registros");
    expect(screen.queryByText(/Parcial/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Todos os lançamentos carregados/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Atrasado").length).toBeGreaterThan(1); // card + badge da linha
  });

  it("cards refletem o GET /finance/summary (numeros maiores que a pagina), sem limit/offset", async () => {
    const calls = mockApi(base());
    renderPage();
    await screen.findByText("Mensalidade Ana");
    await waitFor(() => {
      const cards = screen.getAllByTestId("stat-card").map((c) => (c.textContent ?? "").replace(/\s/g, " "));
      expect(cards[0]).toMatch(/Recebido.*12\.345,00/);
      expect(cards[0]).toMatch(/80 lançamento/);
      expect(cards[1]).toMatch(/A receber.*987,65/);
      expect(cards[2]).toMatch(/Atrasado.*180,50/);
    });
    const summary = calls.find((c) => c.path === "/finance/summary")!;
    expect(summary.query.has("limit")).toBe(false);
    expect(summary.query.has("offset")).toBe(false);
  });

  it("filtros (status, aluno, vencimento) e busca vao ao servidor na lista E no summary", async () => {
    const calls = mockApi(base());
    renderPage();
    await screen.findByText("Mensalidade Ana");

    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "OVERDUE" } });
    await waitFor(() => expect(lastOf(calls, "/finance/summary").query.get("status")).toBe("OVERDUE"));
    expect(lastOf(calls, "/finance").query.get("status")).toBe("OVERDUE");

    fireEvent.change(await screen.findByLabelText("Filtrar por aluno"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Vencimento de"), { target: { value: "2099-01-01" } });
    fireEvent.change(screen.getByLabelText("Vencimento até"), { target: { value: "2099-12-31" } });
    await waitFor(() => expect(lastOf(calls, "/finance/summary").query.get("to")).toBe("2099-12-31"));
    for (const path of ["/finance", "/finance/summary"]) {
      const q = lastOf(calls, path).query;
      expect(Object.fromEntries(q)).toMatchObject({
        status: "OVERDUE",
        studentId: "2",
        from: "2099-01-01",
        to: "2099-12-31",
      });
    }
    expect(lastOf(calls, "/finance").query.get("limit")).toBe("10");
    expect(lastOf(calls, "/finance").query.get("offset")).toBe("0");
    expect(lastOf(calls, "/finance/summary").query.has("limit")).toBe(false);

    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "camis" } });
    await waitFor(() => expect(lastOf(calls, "/finance/summary").query.get("q")).toBe("camis"));
    expect(lastOf(calls, "/finance").query.get("q")).toBe("camis");

    fireEvent.click(screen.getByText("Limpar"));
    await waitFor(() => expect(lastOf(calls, "/finance").query.has("status")).toBe(false));
    expect(lastOf(calls, "/finance").query.has("studentId")).toBe(false);
    expect(lastOf(calls, "/finance/summary").query.has("from")).toBe(false);
  });

  it("pagina no servidor: offset da pagina 2 na lista, summary inalterado (sem offset)", async () => {
    const many = Array.from({ length: 25 }, (_, i) => rec({ id: 100 + i, description: `Lanc ${String(i + 1).padStart(2, "0")}` }));
    const calls = mockApi({
      ...base(),
      "GET /finance": (c) => {
        const offset = Number(c.query.get("offset") ?? 0);
        return json(200, many.slice(offset, offset + Number(c.query.get("limit") ?? 50)), { "X-Total-Count": "25" });
      },
    });
    renderPage();
    expect(await screen.findByText("Lanc 01")).toBeInTheDocument();
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Próxima página"));
    expect(await screen.findByText("Lanc 11")).toBeInTheDocument();
    expect(lastOf(calls, "/finance").query.get("offset")).toBe("10");
    expect(lastOf(calls, "/finance/summary").query.has("offset")).toBe(false);
  });

  it("erro da lista com retry", async () => {
    mockApi({ ...base(), "GET /finance": () => json(403, { message: "Sem permissão." }) });
    renderPage();
    expect(await screen.findByTestId("table-error")).toHaveTextContent("Sem permissão.");
    expect(screen.getByText("Tentar novamente")).toBeInTheDocument();
  });

  it("estado vazio", async () => {
    mockApi({ ...base(), "GET /finance": () => json(200, [], { "X-Total-Count": "0" }) });
    renderPage();
    expect(await screen.findByTestId("table-empty")).toHaveTextContent("Nenhum lançamento financeiro ainda.");
  });

  it("alunos do formulario vem de /students?limit=200 e avisa se total > 200", async () => {
    const calls = mockApi({
      ...base(),
      "GET /students": () => json(200, [{ id: 1, name: "Ana" }], { "X-Total-Count": "350" }),
    });
    renderPage();
    await screen.findByText("Mensalidade Ana");
    expect(calls.find((c) => c.path === "/students")!.query.get("limit")).toBe("200");
    fireEvent.click(screen.getByText("Novo lançamento", { selector: "button" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("students-truncated")).toHaveTextContent("200 de 350");
  });

  it("valida o formulário e cria (POST /finance com centavos, vazios omitidos)", async () => {
    const calls = mockApi({ ...base(), "POST /finance": () => json(201, { id: 9 }) });
    renderPage();
    await screen.findByText("Mensalidade Ana");
    fireEvent.click(screen.getByText("Novo lançamento", { selector: "button" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByTestId("students-truncated")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByText("Salvar"));
    expect(await within(dialog).findByText("Informe a descrição do lançamento.")).toBeInTheDocument();
    expect(within(dialog).getByText("Informe um valor válido (maior que zero).")).toBeInTheDocument();
    expect(within(dialog).getByText("Informe a data de vencimento.")).toBeInTheDocument();
    expect(mutations(calls, "POST")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("Descrição"), { target: { value: "Mensalidade Cris" } });
    fireEvent.change(within(dialog).getByLabelText("Valor (R$)"), { target: { value: "199,90" } });
    fireEvent.change(within(dialog).getByLabelText("Vencimento"), { target: { value: "2099-05-10" } });
    fireEvent.change(within(dialog).getByLabelText("Aluno"), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByText("Salvar"));
    await waitFor(() => expect(mutations(calls, "POST")).toHaveLength(1));
    expect(mutations(calls, "POST")[0]).toMatchObject({
      path: "/finance",
      body: { description: "Mensalidade Cris", amountCents: 19990, dueDate: "2099-05-10", studentId: 2 },
    });
    expect(mutations(calls, "POST")[0]!.body).not.toHaveProperty("type");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Lançamento criado."));
  });

  it("totais sao refeitos depois de uma mutacao (invalida o summary)", async () => {
    const calls = mockApi({ ...base(), "DELETE /finance/3": () => json(200, {}) });
    renderPage();
    await screen.findByText("Camiseta");
    const before = calls.filter((c) => c.path === "/finance/summary").length;
    fireEvent.click(within(screen.getByText("Camiseta").closest("tr")!).getByText("Excluir"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByText("Excluir"));
    await waitFor(() => expect(mutations(calls, "DELETE")).toHaveLength(1));
    await waitFor(() => expect(calls.filter((c) => c.path === "/finance/summary").length).toBeGreaterThan(before));
  });

  it("edita marcando como pago (PATCH /finance/:id com paidAt informado)", async () => {
    const calls = mockApi({ ...base(), "PATCH /finance/2": () => json(200, {}) });
    renderPage();
    await screen.findByText("Mensalidade Bia");
    fireEvent.click(within(screen.getByText("Mensalidade Bia").closest("tr")!).getByText("Editar"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Valor (R$)")).toHaveValue("200.50");
    fireEvent.change(within(dialog).getByLabelText("Status"), { target: { value: "PAID" } });
    fireEvent.change(await within(dialog).findByLabelText("Data de pagamento"), { target: { value: "2099-02-11" } });
    fireEvent.click(within(dialog).getByText("Salvar"));
    await waitFor(() => expect(mutations(calls, "PATCH")).toHaveLength(1));
    expect(mutations(calls, "PATCH")[0]).toMatchObject({
      path: "/finance/2",
      body: { amountCents: 20050, status: "PAID", paidAt: "2099-02-11" },
    });
  });

  it("edicao: limpar Aluno e Tipo envia null (e nunca null em descricao/valor/vencimento/status)", async () => {
    const calls = mockApi({ ...base(), "PATCH /finance/2": () => json(200, {}) });
    renderPage();
    await screen.findByText("Mensalidade Bia");
    fireEvent.click(within(screen.getByText("Mensalidade Bia").closest("tr")!).getByText("Editar"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Aluno"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Tipo"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByText("Salvar"));
    await waitFor(() => expect(mutations(calls, "PATCH")).toHaveLength(1));
    const body = mutations(calls, "PATCH")[0]!.body as Record<string, unknown>;
    expect(body).toEqual({
      description: "Mensalidade Bia",
      amountCents: 20050,
      dueDate: "2099-02-10",
      studentId: null,
      type: null,
      status: "PENDING",
    });
  });

  it("sair de PAID para PENDING NAO envia paidAt (o backend limpa sozinho)", async () => {
    const calls = mockApi({ ...base(), "PATCH /finance/1": () => json(200, {}) });
    renderPage();
    await screen.findByText("Mensalidade Ana");
    fireEvent.click(within(screen.getByText("Mensalidade Ana").closest("tr")!).getByText("Editar"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Data de pagamento")).toHaveValue("2024-01-05");
    fireEvent.change(within(dialog).getByLabelText("Status"), { target: { value: "PENDING" } });
    fireEvent.click(within(dialog).getByText("Salvar"));
    await waitFor(() => expect(mutations(calls, "PATCH")).toHaveLength(1));
    const body = mutations(calls, "PATCH")[0]!.body as Record<string, unknown>;
    expect(body["status"]).toBe("PENDING");
    expect(body).not.toHaveProperty("paidAt");
  });

  it("erro 400 do PATCH e exibido ao usuario e o dialogo permanece aberto", async () => {
    const calls = mockApi({
      ...base(),
      "PATCH /finance/2": () => json(400, { message: ["amountCents must not be less than 1"] }),
    });
    renderPage();
    await screen.findByText("Mensalidade Bia");
    fireEvent.click(within(screen.getByText("Mensalidade Bia").closest("tr")!).getByText("Editar"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("Salvar"));
    await waitFor(() => expect(mutations(calls, "PATCH")).toHaveLength(1));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("amountCents must not be less than 1"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("exclui só depois de confirmar (DELETE /finance/:id)", async () => {
    const calls = mockApi({ ...base(), "DELETE /finance/3": () => json(200, {}) });
    renderPage();
    await screen.findByText("Camiseta");
    fireEvent.click(within(screen.getByText("Camiseta").closest("tr")!).getByText("Excluir"));
    expect(mutations(calls, "DELETE")).toHaveLength(0);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("R$");
    fireEvent.click(within(dialog).getByText("Excluir"));
    await waitFor(() => expect(mutations(calls, "DELETE")).toHaveLength(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Lançamento excluído."));
  });
});
