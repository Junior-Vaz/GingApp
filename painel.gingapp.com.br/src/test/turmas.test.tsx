import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, loginAs } from "./login-as";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; query: URLSearchParams; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/** fetch falso: roteia por "METHOD /caminho" (sem prefixo da API NEM query) e registra as chamadas (`query` = params). */
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

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}import { TurmasPage } from "@/modules/turmas/turmas-page";
import { classSchema, classToPayload, classToUpdatePayload, classToCreatePayload, scheduleLabel } from "@/modules/turmas/schema";

const classes = [
  { id: 1, unitId: 7, name: "Infantil", description: "Crianças", weekday: 2, startTime: "18:00", endTime: "19:00", status: "ACTIVE" },
  { id: 2, unitId: null, name: "Adulto noite", description: null, weekday: null, startTime: null, endTime: null, status: "INACTIVE" },
];
const units = [{ id: 7, name: "Sede Centro" }];
/** GET /units?q&limit (busca do UnitPicker): filtra por q; `total` simula mais unidades do que as devolvidas. */
const unitSearch = (rows = units, total?: number) => (c: Call) => {
  const q = (c.query.get("q") ?? "").toLowerCase();
  const found = rows.filter((u) => u.name.toLowerCase().includes(q));
  return json(200, found, { "X-Total-Count": String(total ?? found.length) });
};
const unitCalls = (calls: Call[]) => calls.filter((c) => c.method === "GET" && c.path === "/units");
const base = () => ({
  "GET /classes": () => json(200, classes, { "X-Total-Count": String(classes.length) }),
  "GET /units": unitSearch(),
  "GET /units/7": () => json(200, units[0]),
});

beforeEach(() => {
  loginAs("MESTRE"); // a UI esconde ações conforme o papel (useCan); os testes de PROFESSOR trocam o papel
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("schema de turmas", () => {
  it("valida nome e monta payload (weekday 0 é válido)", () => {
    const v = { name: "Ab", unitId: "", weekday: "0", startTime: "", endTime: "", description: "", status: "ACTIVE" as const };
    expect(classSchema.safeParse(v).success).toBe(true);
    expect(classSchema.safeParse({ ...v, name: "A" }).success).toBe(false);
    expect(classToPayload(v)).toMatchObject({ name: "Ab", weekday: 0, unitId: undefined, startTime: undefined });
    expect(scheduleLabel({ startTime: null, endTime: null })).toBe("—");
    expect(scheduleLabel({ startTime: "18:00", endTime: null })).toBe("18:00 - —");
  });
  it("classToUpdatePayload manda null nos opcionais esvaziados (nome/status nunca); weekday 0 permanece 0", () => {
    const empty = { name: " Ab ", unitId: "", weekday: "", startTime: "", endTime: "", description: " ", status: "ACTIVE" as const };
    expect(classToUpdatePayload(empty)).toEqual({
      name: "Ab", unitId: null, weekday: null, startTime: null, endTime: null, description: null, status: "ACTIVE",
    });
    expect(classToUpdatePayload({ ...empty, weekday: "0", unitId: "7" })).toMatchObject({ weekday: 0, unitId: 7 });
    // criação continua omitindo vazios e sem status
    const created = classToCreatePayload(empty);
    expect(created).toEqual({ name: "Ab", unitId: undefined, weekday: undefined, startTime: undefined, endTime: undefined, description: undefined });
    expect(created).not.toHaveProperty("status");
  });
});

describe("TurmasPage", () => {
  it("lista com unidade, dia e horário; status, unidade e busca vão ao SERVIDOR", async () => {
    const calls = mockApi({
      ...base(),
      "GET /classes": (c) => {
        const status = c.query.get("status");
        const unitId = c.query.get("unitId");
        const q = c.query.get("q")?.toLowerCase();
        const rows = classes.filter(
          (k) => (!status || k.status === status) && (!unitId || String(k.unitId) === unitId) && (!q || k.name.toLowerCase().includes(q)),
        );
        return json(200, rows, { "X-Total-Count": String(rows.length) });
      },
    });
    renderPage(<TurmasPage />);
    expect(await screen.findByText("Infantil")).toBeInTheDocument();
    expect(await screen.findByText("Sede Centro", { selector: "td" })).toBeInTheDocument(); // GET /units/7
    expect(screen.getByText("Terça")).toBeInTheDocument();
    expect(screen.getByText("18:00 - 19:00")).toBeInTheDocument();
    expect(screen.queryByTestId("table-limit-warning")).not.toBeInTheDocument();
    const first = calls.find((c) => c.path === "/classes")!;
    expect(first.query.get("limit")).toBe("10");
    expect(first.query.get("offset")).toBe("0");
    expect(first.query.has("status")).toBe(false);
    expect(first.query.has("unitId")).toBe(false);
    expect(first.query.has("q")).toBe(false);
    // o seletor de unidade busca no servidor (limit=20, sem q), não a lista de 200
    await waitFor(() => expect(unitCalls(calls)).toHaveLength(1));
    expect(unitCalls(calls)[0]!.query.get("limit")).toBe("20");
    expect(unitCalls(calls)[0]!.query.has("q")).toBe(false);
    await screen.findByRole("option", { name: "Sede Centro" });

    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "INACTIVE" } });
    await waitFor(() => expect(screen.queryByText("Infantil")).not.toBeInTheDocument());
    expect(calls.at(-1)!.query.get("status")).toBe("INACTIVE");
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filtrar por unidade"), { target: { value: "7" } });
    await waitFor(() => expect(calls.at(-1)!.query.get("unitId")).toBe("7"));
    expect(calls.at(-1)!.query.has("status")).toBe(false);
    expect(await screen.findByText("Infantil")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrar por unidade"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "adulto" } });
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "adulto n" } });
    await waitFor(() => expect(calls.at(-1)!.query.get("q")).toBe("adulto n"));
    expect(calls.filter((c) => c.path === "/classes" && c.query.has("q"))).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText("Infantil")).not.toBeInTheDocument());
    expect(screen.getByText("Adulto noite")).toBeInTheDocument();
  });

  it("pagina no servidor: total do header, offset da página 2 e volta à pág. 1 ao filtrar", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...classes[0]!, id: 100 + i, name: `Turma ${String(i + 1).padStart(2, "0")}` }));
    const calls = mockApi({
      ...base(),
      "GET /classes": (c) => {
        const offset = Number(c.query.get("offset") ?? 0);
        const limit = Number(c.query.get("limit") ?? 50);
        return json(200, many.slice(offset, offset + limit), { "X-Total-Count": "25" });
      },
    });
    renderPage(<TurmasPage />);
    expect(await screen.findByText("Turma 01")).toBeInTheDocument();
    expect(screen.getByTestId("table-count")).toHaveTextContent("25 registros");
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Próxima página"));
    expect(await screen.findByText("Turma 11")).toBeInTheDocument();
    expect(calls.at(-1)!.query.get("offset")).toBe("10");
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "ACTIVE" } });
    await waitFor(() => expect(calls.at(-1)!.query.get("status")).toBe("ACTIVE"));
    expect(calls.at(-1)!.query.get("offset")).toBe("0");
    expect(await screen.findByText("Página 1 de 3")).toBeInTheDocument();
  });

  it("mais de 20 unidades: o seletor avisa para refinar a busca (o aviso dos 200 primeiros não existe mais)", async () => {
    mockApi({ ...base(), "GET /units": unitSearch(units, 350) });
    renderPage(<TurmasPage />);
    expect(await screen.findByText("Infantil")).toBeInTheDocument();
    expect(await screen.findByTestId("unit-picker-status")).toHaveTextContent("Mostrando 20 de 350 unidades");
    expect(screen.queryByTestId("units-limit-warning")).not.toBeInTheDocument();
  });

  it("filtro: busca com debounce (q) alcança unidade além do teto e filtra por unitId", async () => {
    const calls = mockApi({
      ...base(),
      "GET /units": (c) => {
        const q = (c.query.get("q") ?? "").toLowerCase();
        const rows = q.includes("zeta") ? [{ id: 250, name: "Zeta Distante" }] : units;
        return json(200, rows, { "X-Total-Count": q ? "1" : "251" });
      },
    });
    renderPage(<TurmasPage />);
    await screen.findByText("Infantil");
    await screen.findByRole("option", { name: "Sede Centro" });
    fireEvent.change(screen.getByLabelText("Buscar unidade"), { target: { value: "ze" } });
    fireEvent.change(screen.getByLabelText("Buscar unidade"), { target: { value: "zeta" } });
    expect(unitCalls(calls).filter((c) => c.query.has("q"))).toHaveLength(0); // dentro do debounce
    await waitFor(() => expect(unitCalls(calls).at(-1)!.query.get("q")).toBe("zeta"));
    expect(unitCalls(calls).filter((c) => c.query.has("q"))).toHaveLength(1);
    expect(unitCalls(calls).at(-1)!.query.get("limit")).toBe("20");
    fireEvent.change(await screen.findByRole("combobox", { name: "Filtrar por unidade" }), { target: { value: "250" } });
    await waitFor(() => expect(calls.filter((c) => c.path === "/classes").at(-1)!.query.get("unitId")).toBe("250"));
  });

  it("cria: unidade escolhida no seletor vai como unitId numérico; sem escolher, é omitida", async () => {
    const calls = mockApi({ ...base(), "POST /classes": () => json(201, { id: 3 }) });
    renderPage(<TurmasPage />);
    await screen.findByText("Infantil");
    fireEvent.click(screen.getByRole("button", { name: /Nova turma/ }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Sem unidade" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(calls.find((c) => c.method === "POST")!.body).not.toHaveProperty("unitId");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Nova turma/ }));
    dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Com unidade" } });
    await within(dialog).findByRole("option", { name: "Sede Centro" });
    fireEvent.change(within(dialog).getByLabelText("Unidade"), { target: { value: "7" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(2));
    expect(calls.filter((c) => c.method === "POST")[1]!.body).toMatchObject({ name: "Com unidade", unitId: 7 });
  });

  it("edição: unidade atual FORA dos 20 resultados é resolvida por id (1 GET, cache da coluna) e o PATCH mantém o unitId", async () => {
    const calls = mockApi({
      ...base(),
      "GET /units": unitSearch([{ id: 8, name: "Outra Filial" }], 300), // a 7 não vem na busca
      "PATCH /classes/1": () => json(200, {}),
    });
    renderPage(<TurmasPage />);
    await screen.findByText("Infantil");
    fireEvent.click(screen.getAllByText("Editar")[0]!);
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByLabelText("Unidade") as HTMLSelectElement;
    await waitFor(() => expect(select.selectedOptions[0]).toHaveTextContent("Sede Centro"));
    expect(select).toHaveValue("7");
    expect(calls.filter((c) => c.path === "/units/7")).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect((calls.find((c) => c.method === "PATCH")!.body as Record<string, unknown>)["unitId"]).toBe(7);
  });

  it("coluna Unidade: falha ao resolver mostra 'Unidade #id' e turma sem unidade mostra '—'", async () => {
    mockApi({ ...base(), "GET /classes": () => json(200, [{ ...classes[0]!, unitId: 99 }, classes[1]], { "X-Total-Count": "2" }), "GET /units/99": () => json(404, { message: "x" }) });
    renderPage(<TurmasPage />);
    expect(await screen.findByText("Unidade #99", { selector: "td" })).toBeInTheDocument();
    expect(screen.getAllByText("—", { selector: "td" }).length).toBeGreaterThan(0);
  });

  it("erro e vazio", async () => {
    mockApi({ "GET /classes": () => json(500, { message: "Falhou." }), "GET /units": () => json(200, []) });
    const first = renderPage(<TurmasPage />);
    expect(await screen.findByTestId("table-error")).toHaveTextContent("Falhou.");
    first.unmount();
    mockApi({ "GET /classes": () => json(200, []), "GET /units": () => json(200, []) });
    renderPage(<TurmasPage />);
    expect(await screen.findByTestId("table-empty")).toHaveTextContent("Nenhuma turma cadastrada ainda.");
  });

  it("cria: valida nome e depois POST /classes", async () => {
    const calls = mockApi({ ...base(), "POST /classes": () => json(201, { id: 3 }) });
    renderPage(<TurmasPage />);
    await screen.findByText("Infantil");
    fireEvent.click(screen.getByRole("button", { name: /Nova turma/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText(/mínimo 2 letras/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Juvenil" } });
    fireEvent.change(within(dialog).getByLabelText("Dia da semana"), { target: { value: "0" } });
    fireEvent.change(within(dialog).getByLabelText("Início"), { target: { value: "09:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST");
    expect(post).toMatchObject({
      path: "/classes",
      body: { name: "Juvenil", weekday: 0, startTime: "09:00" },
    });
    // CreateClassDto nao tem status: enviar => 400 (achado no e2e real).
    expect(post?.body).not.toHaveProperty("status");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Turma criada."));
  });

  it("edita: carrega valores e faz PATCH /classes/:id", async () => {
    const calls = mockApi({ ...base(), "PATCH /classes/1": () => json(200, {}) });
    renderPage(<TurmasPage />);
    await screen.findByText("Infantil");
    fireEvent.click(screen.getAllByText("Editar")[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Nome")).toHaveValue("Infantil"));
    expect(within(dialog).getByLabelText("Dia da semana")).toHaveValue("2");
    expect(within(dialog).getByLabelText("Início")).toHaveValue("18:00");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Infantil A" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({
      path: "/classes/1",
      body: { name: "Infantil A", unitId: 7, weekday: 2, startTime: "18:00", endTime: "19:00", status: "ACTIVE" },
    });
  });

  it("edita: esvaziar unidade, dia, horários e descrição envia null (limpa no servidor)", async () => {
    const calls = mockApi({ ...base(), "PATCH /classes/1": () => json(200, {}) });
    renderPage(<TurmasPage />);
    await screen.findByText("Infantil");
    fireEvent.click(screen.getAllByText("Editar")[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Início")).toHaveValue("18:00"));
    await waitFor(() => expect(within(dialog).getByLabelText("Unidade")).toHaveValue("7"));
    fireEvent.change(within(dialog).getByLabelText("Unidade"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Dia da semana"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Início"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Fim"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Descrição"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const body = calls.find((c) => c.method === "PATCH")!.body as Record<string, unknown>;
    expect(body).toEqual({
      name: "Infantil", unitId: null, weekday: null, startTime: null, endTime: null, description: null, status: "ACTIVE",
    });
  });

  it("erro 400 do PATCH aparece em toast e mantém o formulário aberto", async () => {
    mockApi({ ...base(), "PATCH /classes/1": () => json(400, { message: ["name should not be empty"] }) });
    renderPage(<TurmasPage />);
    await screen.findByText("Infantil");
    fireEvent.click(screen.getAllByText("Editar")[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Nome")).toHaveValue("Infantil"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("name should not be empty"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("inativa com confirmação (DELETE) só para turmas ativas", async () => {
    const calls = mockApi({ ...base(), "DELETE /classes/1": () => json(200, {}) });
    renderPage(<TurmasPage />);
    await screen.findByText("Infantil");
    expect(screen.getAllByText("Inativar")).toHaveLength(1);
    fireEvent.click(screen.getByText("Inativar"));
    const alert = await screen.findByRole("alertdialog");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(within(alert).getByRole("button", { name: "Inativar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/classes/1")).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Turma inativada."));
  });

  it("RBAC: MESTRE vê Inativar; PROFESSOR não (classes:delete) mas continua com Editar", async () => {
    mockApi(base());
    const mestre = renderPage(<TurmasPage />);
    await screen.findByText("Infantil");
    expect(screen.getAllByText("Inativar")).toHaveLength(1);
    mestre.unmount();

    loginAs("PROFESSOR");
    renderPage(<TurmasPage />);
    await screen.findByText("Infantil");
    expect(screen.queryByText("Inativar")).toBeNull();
    expect(screen.getAllByText("Editar").length).toBeGreaterThan(0);
  });

  it("erro do backend no DELETE vira toast e mantém o diálogo", async () => {
    mockApi({ ...base(), "DELETE /classes/1": () => json(403, { message: "Sem permissão." }) });
    renderPage(<TurmasPage />);
    await screen.findByText("Infantil");
    fireEvent.click(screen.getByText("Inativar"));
    const alert = await screen.findByRole("alertdialog");
    fireEvent.click(within(alert).getByRole("button", { name: "Inativar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Sem permissão."));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});