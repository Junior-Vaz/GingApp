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
}import { AlunosPage } from "@/modules/alunos/alunos-page";
import { isMinor, studentToPayload, studentSchema } from "@/modules/alunos/schema";

const YEAR = new Date().getFullYear();
const students = [
  { id: 1, unitId: 7, name: "Ana Souza", birthDate: "1990-05-10T00:00:00.000Z", document: null, phone: "11999", email: null, status: "ACTIVE", joinedAt: null },
  { id: 2, unitId: null, name: "José Álvaro", birthDate: `${YEAR - 8}-01-01T00:00:00.000Z`, document: null, phone: null, email: "j@x.com", status: "INACTIVE", joinedAt: null },
];
const units = [{ id: 7, name: "Sede Centro" }];
const base = () => ({
  "GET /students": () => json(200, students),
  "GET /units": () => json(200, units),
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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
  it("isMinor calcula pela data", () => {
    const today = new Date(2026, 5, 15);
    expect(isMinor("2008-06-16", today)).toBe(true);
    expect(isMinor("2008-06-15", today)).toBe(false);
    expect(isMinor(null, today)).toBe(false);
  });
});

describe("AlunosPage", () => {
  it("lista alunos com unidade, badge de menor e filtro de status/busca", async () => {
    mockApi(base());
    renderPage(<AlunosPage />);
    expect(await screen.findByText("Ana Souza")).toBeInTheDocument();
    expect(screen.getByText("Sede Centro")).toBeInTheDocument();
    expect(screen.getByText("Menor")).toBeInTheDocument();
    expect(screen.getByTestId("table-count")).toHaveTextContent("2 registros");
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "INACTIVE" } });
    expect(screen.queryByText("Ana Souza")).not.toBeInTheDocument();
    expect(screen.getByText("José Álvaro")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "jose alvaro" } });
    expect(screen.queryByText("Ana Souza")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getAllByText("Editar")[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Nome")).toHaveValue("Ana Souza"));
    expect(within(dialog).getByLabelText("Nascimento")).toHaveValue("1990-05-10");
    fireEvent.change(within(dialog).getByLabelText("Status"), { target: { value: "SUSPENDED" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({
      path: "/students/1",
      body: { name: "Ana Souza", unitId: 7, birthDate: "1990-05-10", status: "SUSPENDED" },
    });
  });

  it("inativa com confirmação (DELETE) e não oferece ação para aluno já inativo", async () => {
    const calls = mockApi({ ...base(), "DELETE /students/1": () => new Response(null, { status: 200 }) });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    expect(screen.getAllByText("Inativar")).toHaveLength(1);
    fireEvent.click(screen.getByText("Inativar"));
    const alert = await screen.findByRole("alertdialog");
    expect(alert).toHaveTextContent("Ana Souza");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(within(alert).getByRole("button", { name: "Inativar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/students/1")).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Aluno inativado."));
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