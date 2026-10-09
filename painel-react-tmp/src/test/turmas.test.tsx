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
}import { TurmasPage } from "@/modules/turmas/turmas-page";
import { classSchema, classToPayload, scheduleLabel } from "@/modules/turmas/schema";

const classes = [
  { id: 1, unitId: 7, name: "Infantil", description: "Crianças", weekday: 2, startTime: "18:00", endTime: "19:00", status: "ACTIVE" },
  { id: 2, unitId: null, name: "Adulto noite", description: null, weekday: null, startTime: null, endTime: null, status: "INACTIVE" },
];
const base = () => ({
  "GET /classes": () => json(200, classes),
  "GET /units": () => json(200, [{ id: 7, name: "Sede Centro" }]),
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
});

describe("TurmasPage", () => {
  it("lista com unidade, dia e horário; filtra por status e busca", async () => {
    mockApi(base());
    renderPage(<TurmasPage />);
    expect(await screen.findByText("Infantil")).toBeInTheDocument();
    expect(screen.getByText("Sede Centro", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByText("Terça")).toBeInTheDocument();
    expect(screen.getByText("18:00 - 19:00")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "INACTIVE" } });
    expect(screen.queryByText("Infantil")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "adulto" } });
    expect(screen.queryByText("Infantil")).not.toBeInTheDocument();
    expect(screen.getByText("Adulto noite")).toBeInTheDocument();
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