import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, loginAs } from "./login-as";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; query: URLSearchParams; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/**
 * fetch falso: roteia por "METHOD /caminho" (sem prefixo da API NEM query string) e registra as
 * chamadas (`query` traz os parâmetros). O handler recebe a chamada para responder conforme a query.
 */
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

/** Último GET /students (as outras chamadas — unidades, cobrança — não entram na conta). */
const lastStudents = (calls: Call[]) => calls.filter((c) => c.method === "GET" && c.path === "/students").at(-1)!;

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}import { AlunosPage } from "@/modules/alunos/alunos-page";
import { isMinor, studentToPayload, studentToUpdatePayload, studentSchema } from "@/modules/alunos/schema";
import { clickMenuAction, expectMenuAction, queryMenuAction } from "./row-menu";

const YEAR = new Date().getFullYear();
const students = [
  { id: 1, unitId: 7, name: "Ana Souza", birthDate: "1990-05-10T00:00:00.000Z", document: null, phone: "11999", email: null, status: "ACTIVE", joinedAt: null },
  { id: 2, unitId: null, name: "José Álvaro", birthDate: `${YEAR - 8}-01-01T00:00:00.000Z`, document: null, phone: null, email: "j@x.com", status: "INACTIVE", joinedAt: null },
];
const units = [{ id: 7, name: "Sede Centro" }];
/** GET /units?q&limit (busca do UnitPicker): filtra por q; `total` simula mais unidades do que as devolvidas. */
const unitSearch = (rows = units, total?: number) => (c: Call) => {
  const q = (c.query.get("q") ?? "").toLowerCase();
  const found = rows.filter((u) => u.name.toLowerCase().includes(q));
  return json(200, found, { "X-Total-Count": String(total ?? found.length) });
};
const base = () => ({
  "GET /students": () => json(200, students, { "X-Total-Count": String(students.length) }),
  "GET /units": unitSearch(),
  "GET /units/7": () => json(200, units[0]),
});

beforeEach(() => {
  localStorage.setItem("painel:alunos:view", "table"); // estes testes cobrem a visão em tabela (o padrão novo é cards)
  loginAs("MESTRE"); // a UI esconde ações conforme o papel (useCan); os testes de PROFESSOR trocam o papel
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("schema de alunos", () => {
  it("valida nome, e-mail e monta payload omitindo vazios", () => {
    const ok = { name: "Ab", unitId: "", birthDate: "", document: "", phone: "", email: "", status: "ACTIVE" as const };
    expect(studentSchema.safeParse(ok).success).toBe(true);
    expect(studentSchema.safeParse({ ...ok, name: "A" }).success).toBe(false);
    expect(studentSchema.safeParse({ ...ok, email: "x" }).success).toBe(false);
    expect(studentToPayload({ ...ok, unitId: "7", phone: " 1 " })).toEqual({
      name: "Ab", unitId: 7, birthDate: undefined, document: undefined, phone: "1", email: undefined, status: "ACTIVE",
    });
  });
  it("studentToUpdatePayload manda null nos opcionais esvaziados (nome/status nunca); documento vazio NÃO é enviado", () => {
    const empty = { name: " Ab ", unitId: "", birthDate: "", document: " ", phone: "", email: "", status: "ACTIVE" as const };
    expect(studentToUpdatePayload(empty)).toEqual({
      name: "Ab", unitId: null, birthDate: null, phone: null, email: null, photo: null, status: "ACTIVE",
    });
    expect(studentToUpdatePayload({ ...empty, unitId: "7", phone: "11" })).toMatchObject({ unitId: 7, phone: "11" });
  });
  it("isMinor calcula pela data", () => {
    const today = new Date(2026, 5, 15);
    expect(isMinor("2008-06-16", today)).toBe(true);
    expect(isMinor("2008-06-15", today)).toBe(false);
    expect(isMinor(null, today)).toBe(false);
  });
});

describe("AlunosPage", () => {
  it("lista alunos com unidade, badge de menor e filtros/busca enviados ao SERVIDOR", async () => {
    const calls = mockApi({
      ...base(),
      "GET /students": (c) => {
        const status = c.query.get("status");
        const q = c.query.get("q");
        const rows = students.filter((s) => (!status || s.status === status) && (!q || s.name.includes(q)));
        return json(200, rows, { "X-Total-Count": String(rows.length) });
      },
    });
    renderPage(<AlunosPage />);
    expect(await screen.findByText("Ana Souza")).toBeInTheDocument();
    // nome da unidade na coluna vem de GET /units/:id (não de uma lista com teto)
    expect(await within(screen.getByRole("table")).findByText("Sede Centro")).toBeInTheDocument();
    expect(screen.getByText("Menor")).toBeInTheDocument();
    expect(screen.getByTestId("table-count")).toHaveTextContent("2 registros");
    const first = calls.find((c) => c.path === "/students")!;
    expect(first.query.get("limit")).toBe("10");
    expect(first.query.get("offset")).toBe("0");
    expect(first.query.has("status")).toBe(false);
    expect(first.query.has("q")).toBe(false);

    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "INACTIVE" } });
    await waitFor(() => expect(screen.queryByText("Ana Souza")).not.toBeInTheDocument());
    expect(screen.getByText("José Álvaro")).toBeInTheDocument();
    expect(lastStudents(calls).query.get("status")).toBe("INACTIVE");
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "" } });
    await screen.findByRole("option", { name: "Sede Centro" });
    fireEvent.change(screen.getByLabelText("Filtrar por unidade"), { target: { value: "7" } });
    await waitFor(() => expect(lastStudents(calls).query.get("unitId")).toBe("7"));
    expect(lastStudents(calls).query.has("status")).toBe(false);
    fireEvent.change(screen.getByLabelText("Filtrar por unidade"), { target: { value: "" } });

    // busca com debounce: só depois de ~300ms vai um GET com q (e um só, não um por tecla)
    const before = calls.filter((c) => c.path === "/students").length;
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "Jos" } });
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "José" } });
    expect(calls.filter((c) => c.path === "/students").length).toBe(before);
    await waitFor(() => expect(lastStudents(calls).query.get("q")).toBe("José"));
    expect(calls.filter((c) => c.path === "/students" && c.query.has("q"))).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText("Ana Souza")).not.toBeInTheDocument());
  });

  it("pagina no servidor: total do header, offset da página 2 e volta à pág. 1 ao filtrar", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      ...students[0]!, id: 100 + i, name: `Aluno ${String(i + 1).padStart(2, "0")}`,
    }));
    const calls = mockApi({
      ...base(),
      "GET /students": (c) => {
        const offset = Number(c.query.get("offset") ?? 0);
        const limit = Number(c.query.get("limit") ?? 50);
        return json(200, many.slice(offset, offset + limit), { "X-Total-Count": "25" });
      },
    });
    renderPage(<AlunosPage />);
    expect(await screen.findByText("Aluno 01")).toBeInTheDocument();
    expect(screen.getByTestId("table-count")).toHaveTextContent("25 registros");
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    expect(screen.queryByTestId("table-limit-warning")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Próxima página"));
    expect(await screen.findByText("Aluno 11")).toBeInTheDocument();
    expect(screen.queryByText("Aluno 01")).not.toBeInTheDocument();
    expect(lastStudents(calls).query.get("offset")).toBe("10");
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "ACTIVE" } });
    await waitFor(() => expect(lastStudents(calls).query.get("status")).toBe("ACTIVE"));
    expect(lastStudents(calls).query.get("offset")).toBe("0");
    expect(await screen.findByText("Página 1 de 3")).toBeInTheDocument();
  });

  it("mostra erro com 'Tentar novamente'", async () => {
    const calls = mockApi({ "GET /students": () => json(403, { message: "Sem permissão." }), "GET /units": () => json(200, []) });
    renderPage(<AlunosPage />);
    expect(await screen.findByTestId("table-error")).toHaveTextContent("Sem permissão.");
    fireEvent.click(screen.getByText("Tentar novamente"));
    await waitFor(() => expect(calls.filter((c) => c.path === "/students").length).toBeGreaterThan(1));
  });

  it("estado vazio", async () => {
    mockApi({ "GET /students": () => json(200, []), "GET /units": () => json(200, []) });
    renderPage(<AlunosPage />);
    expect(await screen.findByTestId("table-empty")).toHaveTextContent("Nenhum aluno cadastrado ainda.");
  });

  it("cria: valida nome curto e depois faz POST com o payload", async () => {
    const calls = mockApi({ ...base(), "POST /students": () => json(201, { id: 3 }) });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: /Novo aluno/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "A" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText(/mínimo 2 letras/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Carlos Lima" } });
    await within(dialog).findByRole("option", { name: "Sede Centro" });
    fireEvent.change(within(dialog).getByLabelText("Unidade"), { target: { value: "7" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      path: "/students",
      body: { name: "Carlos Lima", unitId: 7, status: "ACTIVE" },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Aluno cadastrado."));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("e-mail inválido bloqueia o envio", async () => {
    const calls = mockApi(base());
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: /Novo aluno/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Carlos" } });
    fireEvent.change(within(dialog).getByLabelText("E-mail"), { target: { value: "xx" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText("E-mail inválido.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("edita: carrega valores e faz PATCH /students/:id", async () => {
    const calls = mockApi({ ...base(), "PATCH /students/1": () => json(200, {}) });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Nome")).toHaveValue("Ana Souza"));
    expect(within(dialog).getByLabelText("Nascimento")).toHaveValue("1990-05-10");
    fireEvent.change(within(dialog).getByLabelText("Status"), { target: { value: "SUSPENDED" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({
      path: "/students/1",
      body: { name: "Ana Souza", unitId: 7, birthDate: "1990-05-10", phone: "11999", email: null, status: "SUSPENDED" },
    });
    expect(calls.find((c) => c.method === "PATCH")!.body).not.toHaveProperty("document");
  });

  it("edita: esvaziar telefone e unidade envia null (limpa no servidor)", async () => {
    const calls = mockApi({ ...base(), "PATCH /students/1": () => json(200, {}) });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Telefone")).toHaveValue("11999"));
    await waitFor(() => expect(within(dialog).getByLabelText("Unidade")).toHaveValue("7")); // opção carregada
    fireEvent.change(within(dialog).getByLabelText("Telefone"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Unidade"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const body = calls.find((c) => c.method === "PATCH")!.body as Record<string, unknown>;
    expect(body).toMatchObject({ name: "Ana Souza", phone: null, unitId: null, status: "ACTIVE" });
    expect(body["phone"]).toBeNull();
  });

  const unitCalls = (calls: Call[]) => calls.filter((c) => c.method === "GET" && c.path === "/units");

  it("unidades são buscadas no servidor (limit=20, nunca lista inteira) e o aviso do teto de 50 sumiu", async () => {
    const calls = mockApi({ ...base(), "GET /units": unitSearch(units, 300) });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    await waitFor(() => expect(unitCalls(calls).length).toBeGreaterThan(0));
    for (const c of unitCalls(calls)) expect(c.query.get("limit")).toBe("20");
    expect(unitCalls(calls)[0]!.query.has("q")).toBe(false);
    // filtro e formulário compartilham a mesma busca (1 GET, não 2)
    expect(unitCalls(calls)).toHaveLength(1);
    expect(screen.getByTestId("unit-picker-status")).toHaveTextContent("Mostrando 20 de 300 unidades");
    expect(screen.queryByTestId("table-limit-warning")).not.toBeInTheDocument();
  });

  it("filtro: busca com debounce (q) alcança unidade acima do teto e filtra por unitId numérico", async () => {
    const many = [...units, { id: 250, name: "Zeta Distante" }];
    const calls = mockApi({
      ...base(),
      "GET /units": (c) => {
        const q = (c.query.get("q") ?? "").toLowerCase();
        // sem q só as primeiras (a 250 está além do teto); com q a busca do servidor a encontra
        const rows = q ? many.filter((u) => u.name.toLowerCase().includes(q)) : units;
        return json(200, rows, { "X-Total-Count": String(q ? rows.length : 251) });
      },
    });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    await screen.findByRole("option", { name: "Sede Centro" });
    expect(screen.queryByRole("option", { name: "Zeta Distante" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar unidade"), { target: { value: "ze" } });
    fireEvent.change(screen.getByLabelText("Buscar unidade"), { target: { value: "zeta" } });
    expect(unitCalls(calls).filter((c) => c.query.has("q"))).toHaveLength(0); // dentro do debounce
    await waitFor(() => expect(unitCalls(calls).at(-1)!.query.get("q")).toBe("zeta"));
    expect(unitCalls(calls).filter((c) => c.query.has("q"))).toHaveLength(1);
    expect(unitCalls(calls).at(-1)!.query.get("limit")).toBe("20");
    fireEvent.change(await screen.findByLabelText("Filtrar por unidade"), { target: { value: "250" } });
    await waitFor(() => expect(calls.filter((c) => c.path === "/students").at(-1)!.query.get("unitId")).toBe("250"));
    // voltar a "Todas as unidades" remove o filtro
    fireEvent.change(screen.getByLabelText("Filtrar por unidade"), { target: { value: "" } });
    await waitFor(() => expect(calls.filter((c) => c.path === "/students").at(-1)!.query.has("unitId")).toBe(false));
  });

  it("coluna Unidade: 1 GET /units/:id por unidade distinta (cache), nenhum para aluno sem unidade", async () => {
    const outros = [
      { ...students[0]!, id: 3, name: "Carla Dias", unitId: 7 },
      { ...students[0]!, id: 4, name: "Davi Reis", unitId: 99 },
    ];
    const all = [...students, ...outros];
    const calls = mockApi({
      ...base(),
      "GET /students": () => json(200, all, { "X-Total-Count": String(all.length) }),
      "GET /units/99": () => json(404, { message: "Unidade não encontrada." }),
    });
    renderPage(<AlunosPage />);
    const table = within(await screen.findByRole("table"));
    await table.findByText("Carla Dias");
    await waitFor(() => expect(table.getAllByText("Sede Centro")).toHaveLength(2)); // Ana e Carla
    expect(table.getByText("Unidade #99")).toBeInTheDocument(); // falha ao resolver não derruba a tabela
    const byId = calls.filter((c) => /^\/units\/\d+$/.test(c.path)).map((c) => c.path);
    expect([...byId].sort()).toEqual(["/units/7", "/units/99"]);
  });

  it("edição: unidade atual FORA dos 20 resultados é resolvida por id, fica selecionada e o PATCH mantém o unitId", async () => {
    const calls = mockApi({
      ...base(),
      "GET /units": unitSearch([{ id: 8, name: "Outra Filial" }], 300), // a unidade 7 não vem na busca
      "PATCH /students/1": () => json(200, {}),
    });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByLabelText("Unidade") as HTMLSelectElement;
    await waitFor(() => expect(select.selectedOptions[0]).toHaveTextContent("Sede Centro"));
    expect(select).toHaveValue("7");
    // coluna e formulário dividem o mesmo GET /units/7
    expect(calls.filter((c) => c.path === "/units/7")).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect((calls.find((c) => c.method === "PATCH")!.body as Record<string, unknown>)["unitId"]).toBe(7);
  });

  it("edição: trocar para outra unidade envia o novo unitId como número", async () => {
    const calls = mockApi({
      ...base(),
      "GET /units": unitSearch([...units, { id: 8, name: "Filial Norte" }]),
      "PATCH /students/2": () => json(200, {}),
    });
    renderPage(<AlunosPage />);
    await screen.findByText("José Álvaro");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[1]!);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("option", { name: "Filial Norte" });
    expect(within(dialog).getByLabelText("Unidade")).toHaveValue(""); // aluno sem unidade
    fireEvent.change(within(dialog).getByLabelText("Unidade"), { target: { value: "8" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect((calls.find((c) => c.method === "PATCH")!.body as Record<string, unknown>)["unitId"]).toBe(8);
  });

  it("erro 400 do PATCH aparece em toast e mantém o formulário aberto", async () => {
    mockApi({ ...base(), "PATCH /students/1": () => json(400, { message: ["email must be an email"] }) });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Nome")).toHaveValue("Ana Souza"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("email must be an email"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("inativa com confirmação (DELETE) e não oferece ação para aluno já inativo", async () => {
    const calls = mockApi({ ...base(), "DELETE /students/1": () => new Response(null, { status: 200 }) });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    await expectMenuAction("Inativar");
    await clickMenuAction("Inativar");
    const alert = await screen.findByRole("alertdialog");
    expect(alert).toHaveTextContent("Ana Souza");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(within(alert).getByRole("button", { name: "Inativar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/students/1")).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Aluno inativado."));
  });

  it("RBAC: MESTRE vê Inativar; PROFESSOR não (students:delete) mas continua com Editar e Novo aluno", async () => {
    mockApi(base());
    const mestre = renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    await expectMenuAction("Inativar");
    mestre.unmount();

    loginAs("PROFESSOR");
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    expect(queryMenuAction("Inativar")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Editar" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Novo aluno/ })).toBeInTheDocument();
  });

  it("erro do backend no POST vira toast e mantém o formulário aberto", async () => {
    mockApi({ ...base(), "POST /students": () => json(400, { message: "Limite de 10 alunos do plano atingido." }) });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: /Novo aluno/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Carlos" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Limite de 10 alunos do plano atingido."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});