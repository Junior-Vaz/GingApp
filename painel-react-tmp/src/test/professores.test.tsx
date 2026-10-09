import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; body: unknown };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

/** fetch falso: roteia por "METHOD /caminho" (sem o prefixo da API) e registra as chamadas. */
function mockApi(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "");
      const method = init.method ?? "GET";
      calls.push({ method, path, body: init.body ? JSON.parse(init.body as string) : undefined });
      const handler = routes[`${method} ${path}`];
      return Promise.resolve(handler ? handler() : json(404, { message: `sem rota ${method} ${path}` }));
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
const base = () => ({ "GET /teachers": () => json(200, teachers) });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("schema de professores", () => {
  it("cadastro exige e-mail válido e senha >= 6", () => {
    const v = { name: "Ab", email: "a@b.com", password: "123456", phone: "", role: "PROFESSOR" as const, status: "ACTIVE" as const };
    expect(createTeacherSchema.safeParse(v).success).toBe(true);
    expect(createTeacherSchema.safeParse({ ...v, password: "12345" }).success).toBe(false);
    expect(createTeacherSchema.safeParse({ ...v, email: "x" }).success).toBe(false);
    expect(createPayload(v)).toEqual({ name: "Ab", email: "a@b.com", password: "123456", phone: undefined, role: "PROFESSOR" });
    expect(editPayload(v)).toEqual({ name: "Ab", phone: undefined, role: "PROFESSOR", status: "ACTIVE" });
  });
});

describe("ProfessoresPage", () => {
  it("lista com papel/status e filtra por papel e busca", async () => {
    mockApi(base());
    renderPage(<ProfessoresPage />);
    expect(await screen.findByText("Mestre Bimba")).toBeInTheDocument();
    expect(screen.getByTestId("table-count")).toHaveTextContent("2 registros");
    fireEvent.change(screen.getByLabelText("Filtrar por papel"), { target: { value: "PROFESSOR" } });
    expect(screen.queryByText("Mestre Bimba")).not.toBeInTheDocument();
    expect(screen.getByText("Pastinha")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrar por papel"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "BIMBA@" } });
    expect(screen.queryByText("Pastinha")).not.toBeInTheDocument();
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
});