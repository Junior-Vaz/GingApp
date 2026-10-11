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
import { billingChanged, billingFieldsError, billingPayload, currentMonth, toPayPayload } from "@/modules/financeiro/collection";

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
  rec({ id: 1, student: { id: 1, name: "Ana" }, description: "Mensalidade Ana", amountCents: 15000, status: "PAID", paidAt: "2024-01-05T10:00:00.000Z", dueDate: "2024-01-10T00:00:00.000Z" }),
  rec({ id: 2, student: { id: 2, name: "Bia" }, description: "Mensalidade Bia", amountCents: 20050, status: "PENDING", dueDate: "2099-02-10T00:00:00.000Z", studentId: 2 }),
  rec({ id: 3, description: "Camiseta", type: null, studentId: null, student: null, amountCents: 5000, status: "PENDING", dueDate: "2020-01-10T00:00:00.000Z" }),
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

const STUDENTS = [
  { id: 1, name: "Ana" },
  { id: 2, name: "Bia" },
];

/** Busca no servidor: filtra por q (como o backend) e devolve o total no header. */
const studentsRoute = (c: Call) => {
  const q = (c.query.get("q") ?? "").toLowerCase();
  const rows = STUDENTS.filter((s) => s.name.toLowerCase().includes(q));
  return json(200, rows, { "X-Total-Count": String(rows.length) });
};

const base = () => ({
  "GET /finance": () => json(200, records, { "X-Total-Count": String(records.length) }),
  "GET /finance/summary": () => json(200, SUMMARY),
  "GET /students": studentsRoute,
  // aluno por id: SO o aluno atual na edicao (a coluna "Aluno" da tabela vem em GET /finance)
  "GET /students/1": () => json(200, STUDENTS[0]),
  "GET /students/2": () => json(200, STUDENTS[1]),
});

/** Sem q so a Ana vem nos resultados (a Bia simula um aluno alem dos 20 primeiros: so aparece buscando). */
const onlyAnaInResults = () => ({
  ...base(),
  "GET /students": (c: Call) =>
    c.query.get("q") === "bia"
      ? json(200, [STUDENTS[1]], { "X-Total-Count": "1" })
      : json(200, [STUDENTS[0]], { "X-Total-Count": "300" }),
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

  it("seletor de aluno: busca no servidor com limit=20 (nunca limit=200) e sem aviso students-truncated", async () => {
    const calls = mockApi(base());
    renderPage();
    await screen.findByText("Mensalidade Ana");
    const studentCalls = () => calls.filter((c) => c.method === "GET" && c.path === "/students");
    await waitFor(() => expect(studentCalls().length).toBeGreaterThan(0));
    for (const c of studentCalls()) expect(c.query.get("limit")).toBe("20");
    fireEvent.click(screen.getByText("Novo lançamento", { selector: "button" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByTestId("students-truncated")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Buscar aluno"), { target: { value: "bi" } });
    await waitFor(() => expect(studentCalls().at(-1)!.query.get("q")).toBe("bi"));
    expect(studentCalls().some((c) => c.query.get("limit") === "200")).toBe(false);
  });

  it("coluna Aluno usa student.name vindo de GET /finance, sem NENHUM GET /students/:id por linha", async () => {
    const calls = mockApi(onlyAnaInResults());
    renderPage();
    await screen.findByText("Mensalidade Bia");
    const bia = screen.getByText("Mensalidade Bia").closest("tr")!;
    const ana = screen.getByText("Mensalidade Ana").closest("tr")!;
    const camiseta = screen.getByText("Camiseta").closest("tr")!;
    expect(within(bia).getByText("Bia")).toBeInTheDocument(); // sincrono: nao depende de chamada extra
    expect(within(ana).getByText("Ana")).toBeInTheDocument();
    expect(within(camiseta).queryByText("Bia")).toBeNull();
    expect(within(camiseta).queryByText("Ana")).toBeNull();
    expect(within(camiseta).getAllByText("—").length).toBeGreaterThan(0); // sem aluno = "—"
    // da pagina carregada em diante, nenhuma chamada por id de aluno
    await waitFor(() => expect(calls.some((c) => c.path === "/finance/summary")).toBe(true));
    expect(calls.filter((c) => /^\/students\/\d+$/.test(c.path))).toHaveLength(0);
  });

  it("lista antiga sem o campo student (compat): coluna Aluno mostra traço e a tabela não quebra", async () => {
    mockApi({
      ...base(),
      "GET /finance": () => json(200, [rec({ id: 7, description: "Legado" })], { "X-Total-Count": "1" }),
    });
    renderPage();
    const row = (await screen.findByText("Legado")).closest("tr")!;
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("filtro por aluno: busca no servidor, envia studentId na lista E no summary e voltar a Todos remove", async () => {
    const calls = mockApi(onlyAnaInResults());
    renderPage();
    await screen.findByText("Mensalidade Ana");
    fireEvent.change(screen.getByLabelText("Buscar aluno"), { target: { value: "bia" } });
    await waitFor(() => expect(lastOf(calls, "/students").query.get("q")).toBe("bia"));
    expect(lastOf(calls, "/students").query.get("limit")).toBe("20");
    await waitFor(() => expect(within(screen.getByLabelText("Filtrar por aluno")).queryByRole("option", { name: "Bia" })).not.toBeNull());
    fireEvent.change(screen.getByLabelText("Filtrar por aluno"), { target: { value: "2" } });
    await waitFor(() => expect(lastOf(calls, "/finance/summary").query.get("studentId")).toBe("2"));
    expect(lastOf(calls, "/finance").query.get("studentId")).toBe("2");
    expect(lastOf(calls, "/finance").query.get("offset")).toBe("0");

    fireEvent.change(screen.getByLabelText("Filtrar por aluno"), { target: { value: "" } });
    await waitFor(() => expect(lastOf(calls, "/finance").query.has("studentId")).toBe(false));
    expect(lastOf(calls, "/finance/summary").query.has("studentId")).toBe(false);
  });

  it("criacao: aluno achado so pela busca vai no POST como studentId numerico", async () => {
    const calls = mockApi({ ...onlyAnaInResults(), "POST /finance": () => json(201, { id: 9 }) });
    renderPage();
    await screen.findByText("Mensalidade Ana");
    fireEvent.click(screen.getByText("Novo lançamento", { selector: "button" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Descrição"), { target: { value: "Taxa" } });
    fireEvent.change(within(dialog).getByLabelText("Valor (R$)"), { target: { value: "10,00" } });
    fireEvent.change(within(dialog).getByLabelText("Vencimento"), { target: { value: "2099-05-10" } });
    expect(within(dialog).getByRole("option", { name: "Sem aluno" })).toBeInTheDocument(); // campo opcional
    fireEvent.change(within(dialog).getByLabelText("Buscar aluno"), { target: { value: "bia" } });
    await within(dialog).findByRole("option", { name: "Bia" });
    fireEvent.change(within(dialog).getByLabelText("Aluno"), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByText("Salvar"));
    await waitFor(() => expect(mutations(calls, "POST")).toHaveLength(1));
    expect(mutations(calls, "POST")[0]!.body).toMatchObject({ description: "Taxa", amountCents: 1000, studentId: 2 });
  });

  it("criacao sem escolher aluno omite studentId (campo opcional)", async () => {
    const calls = mockApi({ ...base(), "POST /finance": () => json(201, { id: 9 }) });
    renderPage();
    await screen.findByText("Mensalidade Ana");
    fireEvent.click(screen.getByText("Novo lançamento", { selector: "button" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Descrição"), { target: { value: "Taxa" } });
    fireEvent.change(within(dialog).getByLabelText("Valor (R$)"), { target: { value: "10,00" } });
    fireEvent.change(within(dialog).getByLabelText("Vencimento"), { target: { value: "2099-05-10" } });
    fireEvent.click(within(dialog).getByText("Salvar"));
    await waitFor(() => expect(mutations(calls, "POST")).toHaveLength(1));
    expect(mutations(calls, "POST")[0]!.body).not.toHaveProperty("studentId");
  });

  it("edicao mostra o aluno ATUAL mesmo fora dos resultados (resolvido por id) e preserva o studentId no PATCH", async () => {
    const calls = mockApi({ ...onlyAnaInResults(), "PATCH /finance/2": () => json(200, {}) });
    renderPage();
    await screen.findByText("Mensalidade Bia");
    fireEvent.click(within(screen.getByText("Mensalidade Bia").closest("tr")!).getByText("Editar"));
    const dialog = await screen.findByRole("dialog");
    // os resultados so tem a Ana; a Bia (studentId 2) vem de GET /students/2
    await within(dialog).findByRole("option", { name: "Bia" });
    const select = within(dialog).getByLabelText("Aluno") as HTMLSelectElement;
    expect(select).toHaveValue("2");
    expect(select.selectedOptions[0]).toHaveTextContent("Bia");
    expect(calls.some((c) => c.path === "/students/2")).toBe(true);

    // a busca muda e a Bia deixa de casar: continua selecionada
    fireEvent.change(within(dialog).getByLabelText("Buscar aluno"), { target: { value: "zzz" } });
    await waitFor(() => expect(calls.some((c) => c.path === "/students" && c.query.get("q") === "zzz")).toBe(true));
    expect(within(dialog).getByLabelText("Aluno")).toHaveValue("2");

    fireEvent.click(within(dialog).getByText("Salvar"));
    await waitFor(() => expect(mutations(calls, "PATCH")).toHaveLength(1));
    expect(mutations(calls, "PATCH")[0]!.body).toMatchObject({ studentId: 2 });
  });

  it("valida o formulário e cria (POST /finance com centavos, vazios omitidos)", async () => {
    const calls = mockApi({ ...base(), "POST /finance": () => json(201, { id: 9 }) });
    renderPage();
    await screen.findByText("Mensalidade Ana");
    fireEvent.click(screen.getByText("Novo lançamento", { selector: "button" }));
    const dialog = await screen.findByRole("dialog");
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

  it("baixa rapida: abre com hoje/PIX/valor do lancamento e envia POST /finance/:id/pay", async () => {
    const calls = mockApi({
      ...base(),
      "POST /finance/2/pay": () => json(200, { ...records[1], status: "PAID" }),
    });
    renderPage();
    await screen.findByText("Mensalidade Bia");
    fireEvent.click(screen.getByLabelText("Dar baixa em Mensalidade Bia"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("Confirmar baixa"));
    await waitFor(() => expect(mutations(calls, "POST").filter((c) => c.path === "/finance/2/pay")).toHaveLength(1));
    const body = mutations(calls, "POST").find((c) => c.path === "/finance/2/pay")!.body as Record<string, unknown>;
    expect(body).toMatchObject({ paymentMethod: "PIX", paidCents: 20050 });
    expect(body["paidAt"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Baixa registrada."));
  });

  it("gerar mensalidades do mes: POST /finance/generate-monthly com o mes e resumo criados/ignorados", async () => {
    const calls = mockApi({
      ...base(),
      "POST /finance/generate-monthly": () =>
        json(200, { month: currentMonth(), created: 3, ignored: 1, withoutFee: 2, ignoredStudents: [] }),
    });
    renderPage();
    await screen.findByText("Mensalidade Bia");
    fireEvent.click(screen.getByText("Gerar mensalidades do mês"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("Gerar"));
    await waitFor(() => expect(mutations(calls, "POST")).toHaveLength(1));
    expect(mutations(calls, "POST")[0]!.body).toEqual({ month: currentMonth() });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("3 mensalidade(s) criada(s)")),
    );
  });

  it("destaque de inadimplencia vem do servidor e leva a aba Inadimplentes", async () => {
    mockApi({
      ...base(),
      "GET /finance/delinquents/summary": () => json(200, { students: 4, overdueCents: 123400, overdueCount: 6 }),
      "GET /finance/delinquents": () => json(200, [], { "X-Total-Count": "0" }),
    });
    renderPage();
    const box = await screen.findByTestId("delinquents-highlight");
    expect(box).toHaveTextContent("4 aluno(s) inadimplente(s)");
    expect(box).toHaveTextContent("6 lançamento(s)");
    fireEvent.click(within(box).getByText("Ver inadimplentes"));
    expect(await screen.findByText("Nenhum aluno inadimplente.")).toBeInTheDocument();
  });
});

describe("cobranca (utils)", () => {
  it("valor e dia andam juntos; payload manda os dois ou null nos dois; so grava se mudou", () => {
    expect(billingFieldsError({ monthlyFee: "", dueDay: "" })).toBeNull();
    expect(billingFieldsError({ monthlyFee: "150,00", dueDay: "10" })).toBeNull();
    expect(billingFieldsError({ monthlyFee: "150,00", dueDay: "" })?.field).toBe("dueDay");
    expect(billingFieldsError({ monthlyFee: "", dueDay: "10" })?.field).toBe("monthlyFee");
    expect(billingFieldsError({ monthlyFee: "10", dueDay: "32" })?.field).toBe("dueDay");
    expect(billingPayload({ monthlyFee: "150,50", dueDay: "31" })).toEqual({ monthlyFeeCents: 15050, dueDay: 31 });
    expect(billingPayload({ monthlyFee: "", dueDay: "" })).toEqual({ monthlyFeeCents: null, dueDay: null });
    const saved = { studentId: 1, monthlyFeeCents: 15000, dueDay: 10 };
    expect(billingChanged({ monthlyFee: "150,00", dueDay: "10" }, saved)).toBe(false);
    expect(billingChanged({ monthlyFee: "", dueDay: "" }, saved)).toBe(true);
    expect(toPayPayload({ paidAt: "2026-10-01", paymentMethod: "CASH", amountReais: "9,00" })).toEqual({
      paymentMethod: "CASH",
      paidAt: "2026-10-01",
      paidCents: 900,
    });
  });
});
