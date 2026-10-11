import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, loginAs } from "./login-as";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { TurmasPage } from "@/modules/turmas/turmas-page";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; query: URLSearchParams; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

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
      <TurmasPage />
    </QueryClientProvider>,
  );
}

const turma = { id: 1, unitId: null, name: "Infantil", description: null, weekday: 2, startTime: "18:00", endTime: "19:00", status: "ACTIVE" };
const allStudents = [
  { id: 11, name: "Ana Lima", status: "ACTIVE" },
  { id: 12, name: "Bruno Reis", status: "ACTIVE" },
];
let enrolled: { id: number; studentId: number; name: string; studentStatus: string; enrolledAt: string }[];

const routes = () => ({
  "GET /classes": () => json(200, [turma], { "X-Total-Count": "1" }),
  "GET /units": () => json(200, [], { "X-Total-Count": "0" }),
  "GET /students": () => json(200, allStudents, { "X-Total-Count": String(allStudents.length) }),
  "GET /classes/1/students": () => json(200, enrolled),
});

beforeEach(() => {
  loginAs("MESTRE");
  enrolled = [{ id: 100, studentId: 11, name: "Ana Lima", studentStatus: "ACTIVE", enrolledAt: "2026-01-01T00:00:00Z" }];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

async function openDialog() {
  await screen.findByText("Infantil");
  fireEvent.click(screen.getByRole("button", { name: "Alunos" }));
  return screen.findByRole("dialog");
}

describe("Alunos da turma", () => {
  it("abre o diálogo e lista os matriculados", async () => {
    mockApi(routes());
    renderPage();
    const dialog = await openDialog();
    expect(within(dialog).getByText("Alunos da turma")).toBeInTheDocument();
    expect(await within(dialog).findByText("Ana Lima", { selector: "span" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Remover Ana Lima" })).toBeInTheDocument();
  });

  it("mostra mensagem quando não há matriculados", async () => {
    enrolled = [];
    mockApi(routes());
    renderPage();
    const dialog = await openDialog();
    expect(await within(dialog).findByText("Nenhum aluno matriculado ainda.")).toBeInTheDocument();
  });

  it("adiciona: esconde quem já está matriculado do seletor e faz POST /classes/1/students", async () => {
    const calls = mockApi({ ...routes(), "POST /classes/1/students": () => json(201, { id: 101 }) });
    renderPage();
    const dialog = await openDialog();
    await within(dialog).findByRole("option", { name: "Bruno Reis" });
    expect(within(dialog).queryByRole("option", { name: "Ana Lima" })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Aluno"), { target: { value: "12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar aluno" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ path: "/classes/1/students", body: { studentId: 12 } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Aluno matriculado."));
  });

  it("remove com confirmação: DELETE /classes/1/students/11 e recarrega a lista", async () => {
    const calls = mockApi({ ...routes(), "DELETE /classes/1/students/11": () => json(200, {}) });
    renderPage();
    const dialog = await openDialog();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Remover Ana Lima" }));
    const alert = await screen.findByRole("alertdialog");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    enrolled = [];
    fireEvent.click(within(alert).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/classes/1/students/11")).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Aluno removido da turma."));
    expect(await screen.findByText("Nenhum aluno matriculado ainda.")).toBeInTheDocument();
  });

  it("erro do backend ao matricular vira toast", async () => {
    mockApi({ ...routes(), "POST /classes/1/students": () => json(403, { message: "Sem permissão." }) });
    renderPage();
    const dialog = await openDialog();
    await within(dialog).findByRole("option", { name: "Bruno Reis" });
    fireEvent.change(within(dialog).getByLabelText("Aluno"), { target: { value: "12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar aluno" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Sem permissão."));
  });

  it("sem permissão em turmas (ALUNO), o botão Alunos não aparece", async () => {
    loginAs("ALUNO");
    mockApi(routes());
    renderPage();
    await screen.findByText("Infantil");
    expect(screen.queryByRole("button", { name: "Alunos" })).not.toBeInTheDocument();
  });
});
