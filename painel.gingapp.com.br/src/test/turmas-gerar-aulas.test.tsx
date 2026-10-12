import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, loginAs } from "./login-as";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { toast } from "sonner";
import { AulasPage } from "@/modules/aulas/aulas-page";
import { TurmasPage } from "@/modules/turmas/turmas-page";
import {
  MAX_GENERATE_DAYS,
  daysBetween,
  generateLessonsMessage,
  generateLessonsSchema,
} from "@/modules/turmas/generate-lessons";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; query: URLSearchParams; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const page = <T,>(rows: T[]) => json(200, rows, { "X-Total-Count": String(rows.length) });

const teachers = [
  { id: 10, role: "MESTRE", status: "ACTIVE", user: { id: 7, name: "Mestre Bimba", email: "b@x.com", phone: null } },
  { id: 11, role: "PROFESSOR", status: "ACTIVE", user: { id: 8, name: "Prof Pastinha", email: "p@x.com", phone: null } },
];
const classes = [
  { id: 1, unitId: null, name: "Infantil", description: null, weekday: 2, startTime: "18:00", endTime: "19:00", teacherUserId: 8, status: "ACTIVE" },
  { id: 2, unitId: null, name: "Sem dia", description: null, weekday: null, startTime: null, endTime: null, teacherUserId: null, status: "ACTIVE" },
  { id: 3, unitId: null, name: "Antiga", description: null, weekday: 4, startTime: "20:00", endTime: "21:00", teacherUserId: null, status: "INACTIVE" },
];

function mockApi(routes: Record<string, (call: Call) => Response> = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const [path = "", search = ""] = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
      const method = init.method ?? "GET";
      const call: Call = { method, path, query: new URLSearchParams(search), body: init.body ? JSON.parse(init.body as string) : undefined };
      calls.push(call);
      const handler = routes[`${method} ${path}`];
      if (handler) return Promise.resolve(handler(call));
      if (method === "GET" && path === "/classes") return Promise.resolve(page(classes));
      if (method === "GET" && path === "/teachers") return Promise.resolve(page(teachers));
      if (method === "GET" && path === "/units") return Promise.resolve(page([]));
      if (method === "GET" && path === "/lessons") return Promise.resolve(page([]));
      return Promise.resolve(json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  return calls;
}

function renderUi(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  loginAs("MESTRE");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("período de geração de aulas", () => {
  const ok = (from: string, to: string) => generateLessonsSchema.safeParse({ mode: "period", from, to }).success;

  it("aceita de 0 a 90 dias e recusa vazio, invertido e mais de 90 dias", () => {
    expect(ok("2026-11-01", "2026-11-01")).toBe(true);
    expect(ok("2026-11-01", "2027-01-30")).toBe(true); // 90 dias
    expect(ok("2026-11-01", "2027-01-31")).toBe(false); // 91 dias
    expect(ok("2026-11-10", "2026-11-09")).toBe(false);
    expect(ok("", "2026-11-09")).toBe(false);
    expect(ok("2026-11-01", "")).toBe(false);
    expect(MAX_GENERATE_DAYS).toBe(90);
  });

  it("modo contínuo não exige nem limita datas (sem data final, sem teto de 90 dias)", () => {
    const cont = (from: string, to: string) => generateLessonsSchema.safeParse({ mode: "continuous", from, to }).success;
    expect(cont("2026-11-01", "")).toBe(true);
    expect(cont("2026-11-01", "2030-01-01")).toBe(true);
    expect(cont("", "")).toBe(true);
  });

  it("daysBetween conta dias civis sem efeito de horário de verão", () => {
    expect(daysBetween("2026-11-01", "2026-11-01")).toBe(0);
    expect(daysBetween("2026-10-01", "2026-11-01")).toBe(31);
    expect(daysBetween("2019-02-15", "2019-02-17")).toBe(2); // virada do horário de verão no Brasil
    expect(daysBetween("2026-11-02", "2026-11-01")).toBe(-1);
  });

  it("mensagem do resultado: singular/plural, ignoradas e período sem ocorrência", () => {
    expect(generateLessonsMessage({ occurrences: 4, created: 4, ignored: 0 })).toBe("4 aulas criadas.");
    expect(generateLessonsMessage({ occurrences: 1, created: 1, ignored: 0 })).toBe("1 aula criada.");
    expect(generateLessonsMessage({ occurrences: 6, created: 2, ignored: 4 })).toBe("2 aulas criadas, 4 já existiam.");
    expect(generateLessonsMessage({ occurrences: 1, created: 0, ignored: 1 })).toBe("0 aulas criadas, 1 já existia.");
    expect(generateLessonsMessage({ occurrences: 0, created: 0, ignored: 0 })).toBe("Nenhuma data do período cai no dia da semana da turma.");
  });
});

describe("Turmas: professor responsável", () => {
  it("lista o nome do professor da turma (GET /teachers) e '—' quando não há", async () => {
    mockApi();
    renderUi(<TurmasPage />);
    expect(await screen.findByText("Infantil")).toBeInTheDocument();
    expect(await screen.findByText("Prof Pastinha", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Professor/ })).toBeInTheDocument();
  });

  it("cria com professor: POST /classes envia teacherUserId; sem escolher, omite", async () => {
    const calls = mockApi({ "POST /classes": () => json(201, { id: 9 }) });
    renderUi(<TurmasPage />);
    await screen.findByText("Infantil");
    fireEvent.click(screen.getByRole("button", { name: /Nova turma/ }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("option", { name: "Mestre Bimba" });
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Juvenil" } });
    fireEvent.change(within(dialog).getByLabelText("Professor responsável"), { target: { value: "7" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ name: "Juvenil", teacherUserId: 7 });
  });

  it("edita: carrega o professor atual e remover o professor envia null", async () => {
    const calls = mockApi({ "PATCH /classes/1": () => json(200, {}) });
    renderUi(<TurmasPage />);
    await screen.findByText("Infantil");
    fireEvent.click(screen.getAllByText("Editar")[0]!);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("option", { name: "Prof Pastinha" });
    await waitFor(() => expect(within(dialog).getByLabelText("Professor responsável")).toHaveValue("8"));
    fireEvent.change(within(dialog).getByLabelText("Professor responsável"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ teacherUserId: null });
  });

  it("erro do backend (professor inválido) aparece em toast e mantém o formulário aberto", async () => {
    mockApi({ "PATCH /classes/1": () => json(400, { message: "Professor inválido para esta organização." }) });
    renderUi(<TurmasPage />);
    await screen.findByText("Infantil");
    fireEvent.click(screen.getAllByText("Editar")[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Nome")).toHaveValue("Infantil"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Professor inválido para esta organização."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("Turmas: Gerar aulas", () => {
  it("o botão só aparece para turma ATIVA com dia da semana (e para quem pode criar aulas)", async () => {
    mockApi();
    renderUi(<TurmasPage />);
    await screen.findByText("Infantil");
    expect(screen.getByRole("button", { name: "Gerar aulas de Infantil" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gerar aulas de Sem dia" })).not.toBeInTheDocument(); // sem dia
    expect(screen.queryByRole("button", { name: "Gerar aulas de Antiga" })).not.toBeInTheDocument(); // inativa
  });

  it("PROFESSOR (lessons:create) vê o botão; ALUNO não", async () => {
    loginAs("PROFESSOR");
    mockApi();
    const first = renderUi(<TurmasPage />);
    await screen.findByText("Infantil");
    expect(screen.getByRole("button", { name: "Gerar aulas de Infantil" })).toBeInTheDocument();
    first.unmount();

    loginAs("ALUNO");
    mockApi();
    renderUi(<TurmasPage />);
    await screen.findByText("Infantil");
    expect(screen.queryByRole("button", { name: /Gerar aulas/ })).not.toBeInTheDocument();
  });

  it("abre em modo Contínuo (padrão): sem campos de período, texto dos ~60 dias e POST SEM `to`", async () => {
    const calls = mockApi({
      "POST /classes/1/generate-lessons": () =>
        json(201, { classId: 1, from: "x", to: "y", occurrences: 8, created: 8, ignored: 0, createdDates: [], ignoredDates: [] }),
    });
    renderUi(<TurmasPage />);
    await screen.findByText("Infantil");
    fireEvent.click(screen.getByRole("button", { name: "Gerar aulas de Infantil" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("switch", { name: "Contínuo (sem data final)" })).toBeChecked();
    expect(within(dialog).getByText(/mantém ~60 dias de aulas à frente automaticamente/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("De")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Até")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/90 dias/)).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Gerar aulas" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.path).toBe("/classes/1/generate-lessons");
    expect(post.body).toEqual({ from: format(new Date(), "yyyy-MM-dd") });
    expect(post.body).not.toHaveProperty("to");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Aulas contínuas ligadas. 8 aulas criadas."));
  });

  it("'Período específico' (desliga o contínuo) mostra De/Até e mantém o limite de 90 dias; faz POST /classes/1/generate-lessons com from/to; toast com o resumo", async () => {
    const calls = mockApi({
      "POST /classes/1/generate-lessons": () =>
        json(201, { classId: 1, from: "x", to: "y", occurrences: 6, created: 2, ignored: 4, createdDates: [], ignoredDates: [] }),
    });
    renderUi(<TurmasPage />);
    await screen.findByText("Infantil");
    fireEvent.click(screen.getByRole("button", { name: "Gerar aulas de Infantil" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/uma aula para cada terça/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("switch", { name: "Contínuo (sem data final)" }));
    expect(within(dialog).getByText(/máximo de 90 dias/)).toBeInTheDocument();
    const today = new Date();
    await waitFor(() => expect(within(dialog).getByLabelText("De")).toHaveValue(format(today, "yyyy-MM-dd")));
    expect(within(dialog).getByLabelText("Até")).toHaveValue(format(addDays(today, 28), "yyyy-MM-dd"));

    fireEvent.change(within(dialog).getByLabelText("De"), { target: { value: "2026-11-01" } });
    fireEvent.change(within(dialog).getByLabelText("Até"), { target: { value: "2026-12-08" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Gerar aulas" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      path: "/classes/1/generate-lessons",
      body: { from: "2026-11-01", to: "2026-12-08" },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("2 aulas criadas, 4 já existiam."));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("período inválido (invertido / mais de 90 dias) mostra o erro e NÃO chama a API", async () => {
    const calls = mockApi();
    renderUi(<TurmasPage />);
    await screen.findByText("Infantil");
    fireEvent.click(screen.getByRole("button", { name: "Gerar aulas de Infantil" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("switch", { name: "Contínuo (sem data final)" }));

    fireEvent.change(within(dialog).getByLabelText("De"), { target: { value: "2026-11-10" } });
    fireEvent.change(within(dialog).getByLabelText("Até"), { target: { value: "2026-11-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Gerar aulas" }));
    expect(await within(dialog).findByText("A data final deve ser igual ou depois da inicial.")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Até"), { target: { value: "2027-06-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Gerar aulas" }));
    expect(await within(dialog).findByText("O período não pode passar de 90 dias.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("erro do backend vira toast e o diálogo continua aberto", async () => {
    mockApi({ "POST /classes/1/generate-lessons": () => json(400, { message: "Turma inativa: reative a turma antes de gerar aulas." }) });
    renderUi(<TurmasPage />);
    await screen.findByText("Infantil");
    fireEvent.click(screen.getByRole("button", { name: "Gerar aulas de Infantil" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Gerar aulas" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Turma inativa: reative a turma antes de gerar aulas."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("depois de gerar, a lista de aulas é invalidada (nova consulta de /lessons)", async () => {
    // As duas páginas compartilham o QueryClient: gerar na tela de Turmas recarrega Aulas.
    const calls = mockApi({
      "POST /classes/1/generate-lessons": () =>
        json(201, { classId: 1, from: "a", to: "b", occurrences: 1, created: 1, ignored: 0, createdDates: [], ignoredDates: [] }),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AulasPage />
        <TurmasPage />
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: "Gerar aulas de Infantil" });
    const lessonFetches = () => calls.filter((c) => c.method === "GET" && c.path === "/lessons").length;
    await waitFor(() => expect(lessonFetches()).toBeGreaterThan(0));
    const before = lessonFetches();
    fireEvent.click(screen.getByRole("button", { name: "Gerar aulas de Infantil" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Gerar aulas" }));
    await waitFor(() => expect(lessonFetches()).toBeGreaterThan(before));
  });
});

describe("Aulas: turma e professor", () => {
  const lessons = [
    { id: 1, classId: 1, unitId: null, teacherUserId: 7, date: "2026-11-03T00:00:00.000Z", startTime: "18:00", endTime: "19:00", notes: null, status: "ACTIVE" },
    { id: 2, classId: 1, unitId: null, teacherUserId: null, date: "2026-11-10T00:00:00.000Z", startTime: "18:00", endTime: "19:00", notes: null, status: "ACTIVE" },
    { id: 3, classId: 2, unitId: null, teacherUserId: null, date: "2026-11-11T00:00:00.000Z", startTime: null, endTime: null, notes: null, status: "ACTIVE" },
  ];

  it("mostra a turma e o professor da aula; sem professor próprio mostra o da turma '(turma)'; sem nenhum, '—'", async () => {
    mockApi({ "GET /lessons": () => page(lessons) });
    renderUi(<AulasPage />);
    expect(await screen.findByText("Mestre Bimba", { selector: "td" })).toBeInTheDocument(); // professor da própria aula
    expect(await screen.findByText("Prof Pastinha (turma)", { selector: "td" })).toBeInTheDocument(); // herdado da turma
    const rows = screen.getAllByRole("row");
    const semDia = rows.find((r) => within(r).queryByText("Sem dia"));
    expect(semDia).toBeTruthy();
    expect(within(semDia!).getAllByRole("cell").some((c) => c.textContent === "—")).toBe(true);
  });
});
