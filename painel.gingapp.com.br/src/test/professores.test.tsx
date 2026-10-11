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
}import { ProfessoresPage } from "@/modules/professores/professores-page";
import { createTeacherSchema, editPayload, createPayload } from "@/modules/professores/schema";

const teachers = [
  { id: 10, role: "MESTRE", status: "ACTIVE", user: { id: 1, name: "Mestre Bimba", email: "bimba@x.com", phone: "7133" } },
  { id: 11, role: "PROFESSOR", status: "INACTIVE", user: { id: 2, name: "Pastinha", email: "pastinha@x.com", phone: null } },
];
const base = () => ({ "GET /teachers": () => json(200, teachers, { "X-Total-Count": String(teachers.length) }) });

beforeEach(() => {
  loginAs("MESTRE"); // a UI esconde ações conforme o papel (useCan); os testes de PROFESSOR trocam o papel
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("schema de professores", () => {
  it("cadastro exige e-mail válido e senha >= 6", () => {
    const v = { name: "Ab", email: "a@b.com", password: "123456", phone: "", role: "PROFESSOR" as const, status: "ACTIVE" as const };
    expect(createTeacherSchema.safeParse(v).success).toBe(true);
    expect(createTeacherSchema.safeParse({ ...v, password: "12345" }).success).toBe(false);
    expect(createTeacherSchema.safeParse({ ...v, email: "x" }).success).toBe(false);
    expect(createPayload(v)).toEqual({ name: "Ab", email: "a@b.com", password: "123456", phone: undefined, role: "PROFESSOR" });
    // edição: telefone esvaziado => null (limpa); criação omite
    expect(editPayload(v)).toEqual({ name: "Ab", phone: null, role: "PROFESSOR", status: "ACTIVE" });
    expect(editPayload({ ...v, phone: " 71 " })).toMatchObject({ phone: "71" });
  });
});

describe("ProfessoresPage", () => {
  it("lista com papel/status e envia papel, status e busca ao SERVIDOR", async () => {
    const calls = mockApi({
      "GET /teachers": (c) => {
        const role = c.query.get("role");
        const status = c.query.get("status");
        const q = c.query.get("q")?.toLowerCase();
        const rows = teachers.filter(
          (t) => (!role || t.role === role) && (!status || t.status === status) && (!q || t.user.email.includes(q)),
        );
        return json(200, rows, { "X-Total-Count": String(rows.length) });
      },
    });
    renderPage(<ProfessoresPage />);
    expect(await screen.findByText("Mestre Bimba")).toBeInTheDocument();
    expect(screen.getByTestId("table-count")).toHaveTextContent("2 registros");
    expect(screen.queryByTestId("table-limit-warning")).not.toBeInTheDocument();
    const first = calls.find((c) => c.path === "/teachers")!;
    expect(first.query.get("limit")).toBe("10");
    expect(first.query.get("offset")).toBe("0");
    expect(first.query.has("role")).toBe(false);
    expect(first.query.has("status")).toBe(false);
    expect(first.query.has("q")).toBe(false);

    fireEvent.change(screen.getByLabelText("Filtrar por papel"), { target: { value: "PROFESSOR" } });
    await waitFor(() => expect(screen.queryByText("Mestre Bimba")).not.toBeInTheDocument());
    expect(screen.getByText("Pastinha")).toBeInTheDocument();
    expect(calls.at(-1)!.query.get("role")).toBe("PROFESSOR");
    fireEvent.change(screen.getByLabelText("Filtrar por papel"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "ACTIVE" } });
    await waitFor(() => expect(calls.at(-1)!.query.get("status")).toBe("ACTIVE"));
    expect(calls.at(-1)!.query.has("role")).toBe(false);
    expect(await screen.findByText("Mestre Bimba")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "" } });

    // busca com debounce: um só GET com q
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "bimba" } });
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "bimba@" } });
    await waitFor(() => expect(calls.at(-1)!.query.get("q")).toBe("bimba@"));
    expect(calls.filter((c) => c.path === "/teachers" && c.query.has("q"))).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText("Pastinha")).not.toBeInTheDocument());
  });

  it("pagina no servidor: total do header, offset da página 2 e volta à pág. 1 ao filtrar", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      ...teachers[0]!, id: 100 + i, user: { ...teachers[0]!.user, id: 100 + i, name: `Prof ${String(i + 1).padStart(2, "0")}` },
    }));
    const calls = mockApi({
      "GET /teachers": (c) => {
        const offset = Number(c.query.get("offset") ?? 0);
        const limit = Number(c.query.get("limit") ?? 50);
        return json(200, many.slice(offset, offset + limit), { "X-Total-Count": "25" });
      },
    });
    renderPage(<ProfessoresPage />);
    expect(await screen.findByText("Prof 01")).toBeInTheDocument();
    expect(screen.getByTestId("table-count")).toHaveTextContent("25 registros");
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Próxima página"));
    expect(await screen.findByText("Prof 11")).toBeInTheDocument();
    expect(calls.at(-1)!.query.get("offset")).toBe("10");
    fireEvent.change(screen.getByLabelText("Filtrar por papel"), { target: { value: "MESTRE" } });
    await waitFor(() => expect(calls.at(-1)!.query.get("role")).toBe("MESTRE"));
    expect(calls.at(-1)!.query.get("offset")).toBe("0");
    expect(await screen.findByText("Página 1 de 3")).toBeInTheDocument();
  });

  it("erro e vazio", async () => {
    mockApi({ "GET /teachers": () => json(500, { message: "Falhou." }) });
    const first = renderPage(<ProfessoresPage />);
    expect(await screen.findByTestId("table-error")).toHaveTextContent("Falhou.");
    first.unmount();
    mockApi({ "GET /teachers": () => json(200, []) });
    renderPage(<ProfessoresPage />);
    expect(await screen.findByTestId("table-empty")).toHaveTextContent("Nenhum professor cadastrado ainda.");
  });

  it("cria: valida senha curta, depois POST /teachers", async () => {
    const calls = mockApi({ ...base(), "POST /teachers": () => json(201, { id: 12 }) });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Mestre Bimba");
    fireEvent.click(screen.getByRole("button", { name: /Novo professor/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Novo Prof" } });
    fireEvent.change(within(dialog).getByLabelText("E-mail"), { target: { value: "novo@x.com" } });
    fireEvent.change(within(dialog).getByLabelText("Senha inicial"), { target: { value: "123" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText(/pelo menos 6 caracteres/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText("Senha inicial"), { target: { value: "segredo1" } });
    fireEvent.change(within(dialog).getByLabelText("Papel"), { target: { value: "MESTRE" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      path: "/teachers",
      body: { name: "Novo Prof", email: "novo@x.com", password: "segredo1", role: "MESTRE" },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Professor cadastrado."));
  });

  it("edita: e-mail bloqueado, sem senha, PATCH /teachers/:id (id da membership)", async () => {
    const calls = mockApi({ ...base(), "PATCH /teachers/10": () => json(200, {}) });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Mestre Bimba");
    fireEvent.click(screen.getAllByText("Editar")[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Nome")).toHaveValue("Mestre Bimba"));
    expect(within(dialog).getByLabelText("E-mail")).toBeDisabled();
    expect(within(dialog).queryByLabelText("Senha inicial")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Status"), { target: { value: "INACTIVE" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({
      path: "/teachers/10",
      body: { name: "Mestre Bimba", phone: "7133", role: "MESTRE", status: "INACTIVE" },
    });
  });

  it("edita: esvaziar o telefone envia null (limpa no servidor); nome/papel/status nunca null", async () => {
    const calls = mockApi({ ...base(), "PATCH /teachers/10": () => json(200, {}) });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Mestre Bimba");
    fireEvent.click(screen.getAllByText("Editar")[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Telefone")).toHaveValue("7133"));
    fireEvent.change(within(dialog).getByLabelText("Telefone"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const body = calls.find((c) => c.method === "PATCH")!.body as Record<string, unknown>;
    expect(body).toEqual({ name: "Mestre Bimba", phone: null, role: "MESTRE", status: "ACTIVE" });
  });

  it("erro 400 do PATCH aparece em toast e mantém o formulário aberto", async () => {
    mockApi({ ...base(), "PATCH /teachers/10": () => json(400, { message: ["phone must be a string"] }) });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Mestre Bimba");
    fireEvent.click(screen.getAllByText("Editar")[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Nome")).toHaveValue("Mestre Bimba"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("phone must be a string"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("inativa com confirmação (DELETE) só para ativos", async () => {
    const calls = mockApi({ ...base(), "DELETE /teachers/10": () => json(200, {}) });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Mestre Bimba");
    expect(screen.getAllByText("Inativar")).toHaveLength(1);
    fireEvent.click(screen.getByText("Inativar"));
    const alert = await screen.findByRole("alertdialog");
    fireEvent.click(within(alert).getByRole("button", { name: "Inativar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/teachers/10")).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Professor inativado."));
  });

  it("RBAC: MESTRE vê Novo professor/Editar/Inativar; PROFESSOR (só teachers:view) não vê nenhum nem a coluna Ações", async () => {
    mockApi(base());
    const mestre = renderPage(<ProfessoresPage />);
    await screen.findByText("Mestre Bimba");
    expect(screen.getByRole("button", { name: /Novo professor/ })).toBeInTheDocument();
    expect(screen.getAllByText("Editar").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inativar")).toHaveLength(1);
    mestre.unmount();

    loginAs("PROFESSOR");
    renderPage(<ProfessoresPage />);
    await screen.findByText("Mestre Bimba");
    expect(screen.queryByRole("button", { name: /Novo professor/ })).toBeNull();
    expect(screen.queryByText("Editar")).toBeNull();
    expect(screen.queryByText("Inativar")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Ações" })).toBeNull();
    expect(screen.getByText("Mestre Bimba")).toBeInTheDocument(); // a lista (teachers:view) continua
  });

  it("e-mail já cadastrado (400) vira toast e mantém o formulário", async () => {
    mockApi({ ...base(), "POST /teachers": () => json(400, { message: "E-mail já cadastrado." }) });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Mestre Bimba");
    fireEvent.click(screen.getByRole("button", { name: /Novo professor/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Dup" } });
    fireEvent.change(within(dialog).getByLabelText("E-mail"), { target: { value: "bimba@x.com" } });
    fireEvent.change(within(dialog).getByLabelText("Senha inicial"), { target: { value: "segredo1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("E-mail já cadastrado."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  describe("Unidades de atuação (E08)", () => {
    const units = [
      { id: 1, organizationId: 1, name: "Matriz", address: null, city: null, state: null, isMain: true, status: "ACTIVE" },
      { id: 2, organizationId: 1, name: "Filial B", address: null, city: null, state: null, isMain: false, status: "ACTIVE" },
    ];
    const withUnits = [
      teachers[0]!,
      { id: 11, role: "PROFESSOR", status: "ACTIVE", unitIds: [1], user: { id: 2, name: "Pastinha", email: "pastinha@x.com", phone: null } },
    ];
    const routes = () => ({
      "GET /teachers": () => json(200, withUnits, { "X-Total-Count": "2" }),
      "GET /units": () => json(200, units, { "X-Total-Count": "2" }),
    });

    it("coluna resumida e diálogo com checkboxes: PUT /teachers/:id/units substitui o conjunto", async () => {
      const calls = mockApi({ ...routes(), "PUT /teachers/11/units": () => json(200, { unitIds: [1, 2] }) });
      renderPage(<ProfessoresPage />);
      expect(await screen.findByText("Pastinha")).toBeInTheDocument();
      expect(await screen.findByText("Matriz")).toBeInTheDocument(); // coluna: nome da unidade, não o id
      fireEvent.click(screen.getByRole("button", { name: "Unidades de atuação de Pastinha" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByRole("checkbox", { name: "Matriz" })).toBeChecked();
      expect(within(dialog).getByRole("checkbox", { name: "Filial B" })).not.toBeChecked();
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "Filial B" }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Unidades de atuação atualizadas."));
      const put = calls.find((c) => c.method === "PUT")!;
      expect(put.path).toBe("/teachers/11/units");
      expect(put.body).toEqual({ unitIds: [1, 2] });
    });

    it("erro do servidor vira toast e mantém o diálogo; o Mestre (linha) não tem a ação", async () => {
      mockApi({ ...routes(), "PUT /teachers/11/units": () => json(400, { message: "Unidade inválida para esta organização." }) });
      renderPage(<ProfessoresPage />);
      await screen.findByText("Pastinha");
      expect(screen.queryByRole("button", { name: /Unidades de atuação de Mestre Bimba/ })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Unidades de atuação de Pastinha" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Unidade inválida para esta organização."));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });
});