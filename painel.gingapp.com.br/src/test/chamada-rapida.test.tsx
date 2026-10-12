import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, loginAs } from "./login-as";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { QuickAttendance } from "@/modules/frequencia/chamada-rapida";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; body: unknown };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const sessions = [
  { lessonId: 1, classId: 1, className: "Infantil", classPhoto: null, startTime: "16:00", endTime: "17:00", unitName: "Sede", status: "ENDED", studentsCount: 3, markedCount: 3 },
  { lessonId: 2, classId: 2, className: "Adulto", classPhoto: "https://exemplo.com/adulto.jpg", startTime: "19:00", endTime: "20:30", unitName: "Sede", status: "ONGOING", studentsCount: 2, markedCount: 0 },
  { lessonId: 3, classId: 3, className: "Juvenil", classPhoto: null, startTime: "21:00", endTime: "22:00", unitName: null, status: "UPCOMING", studentsCount: 1, markedCount: 0 },
];
const rosters: Record<string, unknown[]> = {
  "1": [{ studentId: 5, studentName: "Eva", present: true, justification: null, photo: null }],
  "2": [
    { studentId: 11, studentName: "Ana Souza", present: null, justification: null, photo: "https://exemplo.com/ana.jpg" },
    { studentId: 12, studentName: "Beto", present: null, justification: null, photo: null },
  ],
  "3": [{ studentId: 21, studentName: "Caio", present: null, justification: null, photo: null }],
};

function setup(opts: { sessions?: unknown[]; saveStatus?: number } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const path = input.replace(/^.*\/api/, "").split("?")[0]!;
      calls.push({ method, path, body: init.body ? JSON.parse(init.body as string) : undefined });
      if (method === "GET" && path === "/attendance/quick-sessions") return Promise.resolve(json(200, opts.sessions ?? sessions));
      const m = /^\/attendance\/lessons\/(\d+)$/.exec(path);
      if (m && method === "GET") return Promise.resolve(json(200, rosters[m[1]!] ?? []));
      if (m && method === "POST") return Promise.resolve(json(opts.saveStatus ?? 201, opts.saveStatus && opts.saveStatus >= 400 ? { message: "Falhou ao salvar." } : { count: 2 }));
      return Promise.resolve(json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <QuickAttendance />
    </QueryClientProvider>,
  );
  return calls;
}

beforeEach(() => loginAs("PROFESSOR"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

const fab = () => screen.findByRole("button", { name: /Chamada rápida/ });

describe("Chamada rápida (botão flutuante)", () => {
  it("aparece para MESTRE e PROFESSOR (attendance:view) e NÃO para outros papéis", async () => {
    setup();
    expect(await fab()).toBeInTheDocument();
    cleanup();

    loginAs("MESTRE");
    setup();
    expect(await fab()).toBeInTheDocument();
    cleanup();

    loginAs("ALUNO");
    const calls = setup();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("button", { name: /Chamada rápida/ })).not.toBeInTheDocument();
    expect(calls).toHaveLength(0); // nem consulta o servidor
  });

  it("mostra o selo com o número de aulas de hoje e o pulso quando há aula em andamento", async () => {
    setup();
    const button = await fab();
    await waitFor(() => expect(screen.getByTestId("quick-attendance-badge")).toHaveTextContent("3"));
    expect(button).toHaveAccessibleName("Chamada rápida (3 aulas hoje)");
    expect(screen.getByTestId("quick-attendance-pulse")).toBeInTheDocument();
  });

  it("sem aula em andamento não pulsa", async () => {
    setup({ sessions: [sessions[0], sessions[2]] });
    await waitFor(() => expect(screen.getByTestId("quick-attendance-badge")).toHaveTextContent("2"));
    expect(screen.queryByTestId("quick-attendance-pulse")).not.toBeInTheDocument();
  });

  it("abre o painel com a aula EM ANDAMENTO pré-selecionada, alunos com foto e 'marcados X/Y' nas abas", async () => {
    const calls = setup();
    fireEvent.click(await fab());
    const dialog = await screen.findByRole("dialog", { name: "Chamada rápida" });
    const tabs = await within(dialog).findAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true"); // Adulto (em andamento)
    expect(tabs[1]).toHaveTextContent("Adulto");
    expect(tabs[1]).toHaveTextContent("19:00–20:30");
    expect(tabs[1]).toHaveTextContent("Em andamento");
    expect(tabs[1]).toHaveTextContent("marcados 0/2");
    expect(tabs[0]).toHaveTextContent("marcados 3/3");
    expect(tabs[2]).toHaveTextContent("Próxima");

    const rows = await within(dialog).findAllByTestId("quick-student-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Ana Souza")).toBeInTheDocument();
    expect(rows[0]!.querySelector("img")).toHaveAttribute("src", "https://exemplo.com/ana.jpg");
    expect(within(rows[1]!).getByText("B")).toBeInTheDocument(); // sem foto: iniciais
    expect(calls.some((c) => c.method === "GET" && c.path === "/attendance/lessons/2")).toBe(true);
  });

  it("um toque marca Presente/Ausente (estado imediato) e 'Salvar chamada' faz POST /attendance/lessons/:id só com quem foi marcado", async () => {
    const calls = setup();
    fireEvent.click(await fab());
    const dialog = await screen.findByRole("dialog");
    const presente = await within(dialog).findByRole("button", { name: "Presente: Ana Souza" });
    const save = within(dialog).getByRole("button", { name: "Salvar chamada" });
    expect(save).toBeDisabled();

    fireEvent.click(presente);
    expect(presente).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByTestId("quick-summary")).toHaveTextContent("1 presentes · 0 ausentes · 1 sem chamada");
    expect(within(dialog).getByText("Alterações não salvas.")).toBeInTheDocument();
    expect(save).toBeEnabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Ausente: Beto" }));
    expect(within(dialog).getByRole("button", { name: "Ausente: Beto" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(save);

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.path).toBe("/attendance/lessons/2");
    expect(post.body).toEqual([
      { studentId: 11, present: true },
      { studentId: 12, present: false },
    ]);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Frequência salva (2 alunos)."));
  });

  it("'Todos presentes' marca a turma toda e envia todos como presentes", async () => {
    const calls = setup();
    fireEvent.click(await fab());
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findAllByTestId("quick-student-row");
    fireEvent.click(within(dialog).getByRole("button", { name: /Todos presentes/ }));
    expect(within(dialog).getByTestId("quick-summary")).toHaveTextContent("2 presentes · 0 ausentes");
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar chamada" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual([
      { studentId: 11, present: true },
      { studentId: 12, present: true },
    ]);
  });

  it("trocar de aba carrega a chamada da outra aula", async () => {
    const calls = setup();
    fireEvent.click(await fab());
    const dialog = await screen.findByRole("dialog");
    const tabs = await within(dialog).findAllByRole("tab");
    fireEvent.click(tabs[2]!);
    expect(await within(dialog).findByText("Caio")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "GET" && c.path === "/attendance/lessons/3")).toBe(true);
  });

  it("erro ao salvar mostra toast e mantém as marcações na tela", async () => {
    setup({ saveStatus: 400 });
    fireEvent.click(await fab());
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Presente: Ana Souza" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar chamada" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Falhou ao salvar."));
    expect(within(dialog).getByRole("button", { name: "Presente: Ana Souza" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByRole("button", { name: "Salvar chamada" })).toBeEnabled();
  });

  it("sem aulas hoje mostra 'Nenhuma aula hoje.' e sem selo", async () => {
    setup({ sessions: [] });
    const button = await fab();
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Nenhuma aula hoje.")).toBeInTheDocument();
    expect(screen.queryByTestId("quick-attendance-badge")).not.toBeInTheDocument();
    expect(button).toHaveAccessibleName("Chamada rápida");
  });

  it("fecha com o botão X e com Esc", async () => {
    setup();
    fireEvent.click(await fab());
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar chamada rápida" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(await fab());
    dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
