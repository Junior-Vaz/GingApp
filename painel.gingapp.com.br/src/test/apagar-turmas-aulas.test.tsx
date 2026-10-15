import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, loginAs } from "./login-as";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { StrongConfirmDialog } from "@/components/painel/strong-confirm-dialog";
import { AulasPage } from "@/modules/aulas/aulas-page";
import { TurmasPage } from "@/modules/turmas/turmas-page";
import { TurmaDetailPage } from "@/modules/turmas/turma-detail-page";
import { clickMenuAction, queryMenuAction } from "./row-menu";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; query: URLSearchParams; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const page = (rows: unknown[]) => json(200, rows, { "X-Total-Count": String(rows.length) });

/** fetch falso: roteia por "METHOD /caminho" (sem prefixo da API nem query) e registra as chamadas. */
function mockApi(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const [path = "", search = ""] = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
      const method = init.method ?? "GET";
      const call: Call = { method, path, query: new URLSearchParams(search), body: init.body ? JSON.parse(init.body as string) : undefined };
      calls.push({ ...call, path: search ? `${path}?${search}` : path });
      const handler = routes[`${method} ${path}`];
      return Promise.resolve(handler ? handler(call) : json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  return calls;
}

function renderUi(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => loginAs("MESTRE"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("StrongConfirmDialog", () => {
  function Harness({ impactLoading = false, onConfirm = vi.fn() }: { impactLoading?: boolean; onConfirm?: () => void }) {
    return (
      <StrongConfirmDialog
        open
        onOpenChange={() => undefined}
        title="Apagar?"
        impact="Isto apagará 3 aulas e 12 presenças. Não pode ser desfeito."
        impactLoading={impactLoading}
        phrase="Infantil"
        confirmLabel="Apagar definitivamente"
        onConfirm={onConfirm}
      />
    );
  }

  it("o botão vermelho só habilita ao digitar a frase (sem diferenciar maiúsculas) e mostra o impacto", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const button = screen.getByRole("button", { name: "Apagar definitivamente" });
    expect(screen.getByTestId("strong-confirm-impact")).toHaveTextContent("Isto apagará 3 aulas e 12 presenças. Não pode ser desfeito.");
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Infant" } });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  infantil " } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it("enquanto o impacto carrega o botão fica desabilitado mesmo com a frase certa", () => {
    render(<Harness impactLoading />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Infantil" } });
    expect(screen.getByRole("button", { name: "Apagar definitivamente" })).toBeDisabled();
  });
});

describe("Apagar turma (Turmas)", () => {
  const turma = { id: 1, unitId: null, name: "Infantil", description: null, weekday: 2, startTime: "18:00", endTime: "19:00", status: "ACTIVE" };
  const routes = () => ({
    "GET /classes": () => page([turma]),
    "GET /units": () => page([]),
    "GET /teachers": () => page([]),
    "GET /classes/1/delete-impact": () => json(200, { class: { id: 1, name: "Infantil" }, lessons: 8, attendances: 21, students: 5 }),
    "DELETE /classes/1": () => json(200, { deleted: true }),
  });

  it("MESTRE: Apagar busca o impacto, mostra as contagens, exige digitar o nome e faz DELETE ?confirm=true", async () => {
    const calls = mockApi(routes());
    renderUi(<TurmasPage />);
    await screen.findByText("Infantil");
    await clickMenuAction(/^Apagar/);
    const alert = await screen.findByRole("alertdialog");
    await waitFor(() => expect(within(alert).getByTestId("strong-confirm-impact")).toHaveTextContent("Isto apagará 8 aulas e 21 presenças"));
    expect(within(alert).getByTestId("strong-confirm-impact")).toHaveTextContent("Não pode ser desfeito.");
    const confirm = within(alert).getByRole("button", { name: "Apagar definitivamente" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(alert).getByRole("textbox"), { target: { value: "Infantil" } });
    expect(confirm).toBeEnabled();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/classes/1?confirm=true")).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Turma apagada."));
  });

  it("PROFESSOR não vê Apagar", async () => {
    loginAs("PROFESSOR");
    mockApi(routes());
    renderUi(<TurmasPage />);
    await screen.findByText("Infantil");
    expect(queryMenuAction(/^Apagar/)).toBeNull();
  });
});

describe("Apagar aula e apagar canceladas (Aulas)", () => {
  const lessons = [
    { id: 1, classId: 1, unitId: null, teacherUserId: null, date: "2026-03-05T00:00:00.000Z", startTime: "18:00", endTime: "19:00", notes: null, status: "ACTIVE" },
    { id: 2, classId: 1, unitId: null, teacherUserId: null, date: "2026-03-06T00:00:00.000Z", startTime: null, endTime: null, notes: null, status: "INACTIVE" },
  ];
  const routes = (attendances: number) => ({
    "GET /lessons": () => page(lessons),
    "GET /classes": () => page([{ id: 1, name: "Infantil" }]),
    "GET /teachers": () => page([]),
    "GET /lessons/1/delete-impact": () => json(200, { attendances }),
    "DELETE /lessons/1": () => json(200, { deleted: true }),
    "POST /lessons/bulk-delete": (c: Call) =>
      (c.body as { dryRun?: boolean }).dryRun ? json(200, { lessons: 4, attendances: 0, skipped: 0, deleted: false }) : json(200, { lessons: 4, attendances: 0, skipped: 0, deleted: true }),
  });

  it("Apagar aula com presenças: mostra a contagem, exige digitar APAGAR e manda ?confirm=true", async () => {
    const calls = mockApi(routes(6));
    renderUi(<AulasPage />);
    await screen.findAllByRole("cell", { name: "Infantil" });
    fireEvent.click((await screen.findAllByRole("button", { name: "Apagar aula de Infantil" }))[0]!);
    const alert = await screen.findByRole("alertdialog");
    await waitFor(() => expect(within(alert).getByTestId("strong-confirm-impact")).toHaveTextContent("Isto apagará 1 aula e 6 presenças. Não pode ser desfeito."));
    const confirm = within(alert).getByRole("button", { name: "Apagar definitivamente" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(alert).getByRole("textbox"), { target: { value: "apagar" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/lessons/1?confirm=true")).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Aula apagada."));
  });

  it("Apagar aula sem presenças não manda confirm", async () => {
    const calls = mockApi(routes(0));
    renderUi(<AulasPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Apagar aula de Infantil" }))[0]!);
    const alert = await screen.findByRole("alertdialog");
    await waitFor(() => expect(within(alert).getByTestId("strong-confirm-impact")).toHaveTextContent("1 aula e 0 presenças"));
    fireEvent.change(within(alert).getByRole("textbox"), { target: { value: "APAGAR" } });
    fireEvent.click(within(alert).getByRole("button", { name: "Apagar definitivamente" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/lessons/1")).toBe(true));
  });

  it("Apagar canceladas (lote): conta por dryRun, exige APAGAR e faz POST /lessons/bulk-delete", async () => {
    const calls = mockApi(routes(0));
    renderUi(<AulasPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Apagar canceladas/ }));
    const alert = await screen.findByRole("alertdialog");
    await waitFor(() => expect(within(alert).getByTestId("strong-confirm-impact")).toHaveTextContent("Isto apagará 4 aulas canceladas e 0 presenças"));
    expect(calls.some((c) => c.method === "POST" && (c.body as { dryRun?: boolean }).dryRun === true)).toBe(true);
    fireEvent.change(within(alert).getByRole("textbox"), { target: { value: "APAGAR" } });
    fireEvent.click(within(alert).getByRole("button", { name: "Apagar canceladas" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/lessons/bulk-delete" && !(c.body as { dryRun?: boolean }).dryRun)).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("4 aulas canceladas apagadas."));
  });

  it("PROFESSOR não vê Apagar nem Apagar canceladas", async () => {
    loginAs("PROFESSOR");
    mockApi(routes(0));
    renderUi(<AulasPage />);
    await screen.findAllByRole("cell", { name: "Infantil" });
    expect(screen.queryByRole("button", { name: /Apagar/ })).toBeNull();
  });
});

describe("Detalhe da turma: lista de alunos", () => {
  it("mostra dados da turma e cada aluno com foto, nome, apelido, graduação, status e presenças", async () => {
    mockApi({
      "GET /classes/1": () =>
        json(200, {
          id: 1, unitId: 7, name: "Infantil", description: null, weekday: 2, startTime: "18:00", endTime: "19:00", status: "ACTIVE", teacherUserId: 3,
          unit: { id: 7, name: "Sede Centro", photo: null }, teacher: { id: 3, name: "Mestre Bimba", photo: null },
        }),
      "GET /classes/1/students": () =>
        json(200, [
          {
            id: 100, studentId: 11, name: "Ana Lima", nickname: "Aninha", studentStatus: "ACTIVE", photo: "https://x.com/ana.jpg", enrolledAt: "2026-01-01T00:00:00Z",
            currentCord: { name: "Cordel Verde", style: "SOLID", colors: ["#00A000"], tipStart: null, tipEnd: null },
            presences: 8, presencesTotal: 20, lessonsInPeriod: 10, attendanceRate: 80,
          },
          { id: 101, studentId: 12, name: "Bruno Reis", nickname: null, studentStatus: "INACTIVE", photo: null, enrolledAt: "2026-01-01T00:00:00Z", currentCord: null, presences: 0, presencesTotal: 0, lessonsInPeriod: 0, attendanceRate: null },
        ]),
      "GET /lessons": () => page([{ id: 9, classId: 1, unitId: null, teacherUserId: null, date: "2031-03-05T00:00:00.000Z", startTime: "18:00", endTime: "19:00", notes: null, status: "ACTIVE" }]),
    });
    renderUi(<TurmaDetailPage classId={1} />);
    expect(await screen.findByRole("heading", { name: "Infantil" })).toBeInTheDocument();
    expect(screen.getByText("Sede Centro")).toBeInTheDocument();
    expect(screen.getByText("Mestre Bimba")).toBeInTheDocument();
    expect(screen.getByText("Terça")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("turma-next-lesson")).toHaveTextContent("05/03/2031"));

    const rows = await screen.findAllByTestId("class-student-row");
    expect(rows).toHaveLength(2);
    const ana = rows[0]!;
    expect(within(ana).getByText("Ana Lima")).toBeInTheDocument();
    expect(within(ana).getByText("“Aninha”")).toBeInTheDocument();
    expect(within(ana).getByTestId("student-avatar").querySelector("img")).toHaveAttribute("src", "https://x.com/ana.jpg");
    expect(within(ana).getByTestId("class-student-cord")).toHaveTextContent("Cordel Verde");
    expect(within(ana).getByTestId("class-student-attendance")).toHaveTextContent("8 de 10 aulas (80%)");
    const bruno = rows[1]!;
    expect(within(bruno).getByText("Inativo")).toBeInTheDocument();
    expect(within(bruno).getByText("Sem graduação")).toBeInTheDocument();
    expect(within(bruno).getByTestId("class-student-attendance")).toHaveTextContent("Sem aulas no período");
  });

  it("turma sem alunos mostra a mensagem vazia", async () => {
    mockApi({
      "GET /classes/1": () => json(200, { id: 1, unitId: null, name: "Vazia", description: null, weekday: null, startTime: null, endTime: null, status: "ACTIVE", teacherUserId: null }),
      "GET /classes/1/students": () => json(200, []),
      "GET /lessons": () => page([]),
    });
    renderUi(<TurmaDetailPage classId={1} />);
    expect(await screen.findByText("Nenhum aluno matriculado ainda.")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma aula ativa à frente")).toBeInTheDocument();
  });
});
