import { afterEach, describe, expect, it, vi } from "vitest";
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
const base = () => ({
  "GET /classes": () => json(200, classes, { "X-Total-Count": String(classes.length) }),
  "GET /units": () => json(200, [{ id: 7, name: "Sede Centro" }], { "X-Total-Count": "1" }),
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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
    expect(screen.getByText("Sede Centro", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByText("Terça")).toBeInTheDocument();
    expect(screen.getByText("18:00 - 19:00")).toBeInTheDocument();
    expect(screen.queryByTestId("table-limit-warning")).not.toBeInTheDocument();
    const first = calls.find((c) => c.path === "/classes")!;
    expect(first.query.get("limit")).toBe("10");
    expect(first.query.get("offset")).toBe("0");
    expect(first.query.has("status")).toBe(false);
    expect(first.query.has("unitId")).toBe(false);
    expect(first.query.has("q")).toBe(false);
    // selects auxiliares pedem o máximo do servidor
    expect(calls.find((c) => c.path === "/units")!.query.get("limit")).toBe("200");

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

  it("avisa (sem quebrar) quando há mais de 200 unidades nos selects", async () => {
    mockApi({ ...base(), "GET /units": () => json(200, [{ id: 7, name: "Sede Centro" }], { "X-Total-Count": "350" }) });
    renderPage(<TurmasPage />);
    expect(await screen.findByText("Infantil")).toBeInTheDocument();
    expect(await screen.findByTestId("units-limit-warning")).toHaveTextContent("200 de 350 unidades");
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