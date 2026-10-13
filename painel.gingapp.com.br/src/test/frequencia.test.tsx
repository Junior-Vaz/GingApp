import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { FrequenciaPage } from "@/modules/frequencia/frequencia-page";
import {
  buildPayload,
  markAll,
  nextPresence,
  setJustification,
  setPresence,
  summarize,
  toRows,
} from "@/modules/frequencia/roster";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const lessonsData = [
  { id: 1, classId: 1, unitId: null, teacherUserId: null, date: "2026-03-05T00:00:00.000Z", startTime: "18:00", endTime: "19:00", notes: null, status: "ACTIVE" },
  { id: 2, classId: 2, unitId: null, teacherUserId: null, date: "2026-03-09T00:00:00.000Z", startTime: null, endTime: null, notes: null, status: "ACTIVE" },
  { id: 3, classId: 1, unitId: null, teacherUserId: null, date: "2026-03-12T00:00:00.000Z", startTime: null, endTime: null, notes: null, status: "INACTIVE" },
];
const classes = [{ id: 1, name: "Infantil" }, { id: 2, name: "Adulto" }];
const roster = [
  { studentId: 11, studentName: "Ana", present: null, justification: null },
  { studentId: 12, studentName: "Beto", present: true, justification: null },
  { studentId: 13, studentName: "Caio", present: false, justification: "Gripe" },
];

interface Call { url: string; method: string; body: unknown }

function setup(opts: { roster?: () => Response; save?: () => Response; lessonsTotal?: number; classesTotal?: number } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const url = input.replace(/^.*\/api/, "");
      calls.push({ url, method, body: init.body ? JSON.parse(init.body as string) : undefined });
      const path = url.split("?")[0];
      const withTotal = (body: unknown[], total?: number) =>
        new Response(JSON.stringify(body), { status: 200, headers: total === undefined ? {} : { "X-Total-Count": String(total) } });
      if (path === "/lessons") {
        // o servidor filtra por turma
        const classId = new URLSearchParams(url.split("?")[1] ?? "").get("classId");
        const body = classId ? lessonsData.filter((l) => String(l.classId) === classId) : lessonsData;
        return Promise.resolve(withTotal(body, opts.lessonsTotal));
      }
      if (path === "/classes") return Promise.resolve(withTotal(classes, opts.classesTotal));
      if (method === "GET" && url.startsWith("/attendance/lessons/")) return Promise.resolve(opts.roster?.() ?? json(200, roster));
      if (method === "POST" && url.startsWith("/attendance/lessons/")) return Promise.resolve(opts.save?.() ?? json(201, { count: 2 }));
      return Promise.resolve(json(404, { message: "?" }));
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FrequenciaPage />
    </QueryClientProvider>,
  );
  return { calls };
}

async function openLesson(id = "1") {
  const select = await screen.findByLabelText("Aula");
  await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
  fireEvent.change(select, { target: { value: id } });
}

beforeEach(() => {
  // Só o Date é congelado (waitFor/debounce seguem em tempo real): "hoje" = 10/03/2026, janela 03/03 a 09/04.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("FrequenciaPage", () => {
  it("sem aula selecionada mostra a orientação; só aulas ativas aparecem, na ordem do servidor (order=nearest)", async () => {
    setup();
    expect(screen.getByText(/Selecione uma aula para ver a lista de chamada/)).toBeInTheDocument();
    const select = await screen.findByLabelText("Aula");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(3));
    const labels = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(labels).toEqual(["Selecione uma aula", "Infantil — 05/03/2026", "Adulto — 09/03/2026"]);
  });

  it("filtrar por turma restringe as aulas", async () => {
    setup();
    await openLesson("1");
    fireEvent.change(screen.getByLabelText("Turma"), { target: { value: "2" } });
    const select = screen.getByLabelText("Aula");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(2));
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Selecione uma aula", "Adulto — 09/03/2026"]);
    expect(select).toHaveValue("");
  });

  it("seletor de aulas: janela padrão (hoje-7 a hoje+30, order=nearest, limit 60); turma/período/'Mostrar todas' alcançam as antigas", async () => {
    const { calls } = setup();
    await openLesson("1");
    const lessonCalls = () => calls.filter((c) => c.url.startsWith("/lessons")).map((c) => c.url);
    const windowQs = "from=2026-03-03&to=2026-04-09&order=nearest&limit=60";
    expect(lessonCalls()[0]).toBe(`/lessons?status=ACTIVE&${windowQs}`);
    expect(calls.some((c) => c.url === "/classes?limit=200")).toBe(true);

    fireEvent.change(screen.getByLabelText("Turma"), { target: { value: "2" } });
    await waitFor(() => expect(lessonCalls()).toContain(`/lessons?status=ACTIVE&classId=2&${windowQs}`));
    // datas escolhidas à mão substituem a janela padrão (e liberam o limite de 200)
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-01-31" } });
    await waitFor(() =>
      expect(lessonCalls()).toContain("/lessons?status=ACTIVE&classId=2&from=2026-01-01&to=2026-01-31&order=nearest&limit=200"),
    );
    // mudar o filtro limpa a aula escolhida
    expect(screen.getByLabelText("Aula")).toHaveValue("");
  });

  it("'Mostrar todas' tira a janela (sem from/to, limit 200) e 'Voltar às aulas próximas' a restaura", async () => {
    const { calls } = setup();
    await openLesson("1");
    const lessonCalls = () => calls.filter((c) => c.url.startsWith("/lessons")).map((c) => c.url);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar todas" }));
    await waitFor(() => expect(lessonCalls()).toContain("/lessons?status=ACTIVE&order=nearest&limit=200"));
    expect(screen.getByLabelText("Aula")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Voltar às aulas próximas" }));
    await waitFor(() => expect(lessonCalls().filter((u) => u.includes("limit=60")).length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: "Mostrar todas" })).toBeInTheDocument();
  });

  it("sem aviso quando o total cabe no limite; acima dele avisa que a lista foi truncada", async () => {
    setup({ lessonsTotal: 60 });
    await openLesson("1");
    expect(screen.queryByTestId("lessons-truncated")).toBeNull();
    cleanup();
    vi.unstubAllGlobals();
    setup({ lessonsTotal: 350, classesTotal: 250 });
    expect(await screen.findByTestId("lessons-truncated")).toHaveTextContent("Mostrando 60 de 350 aulas");
    expect(await screen.findByTestId("classes-truncated")).toHaveTextContent("Mostrando 200 de 250 turmas");
    fireEvent.click(screen.getByRole("button", { name: "Mostrar todas" }));
    await waitFor(() => expect(screen.getByTestId("lessons-truncated")).toHaveTextContent("Mostrando 200 de 350 aulas"));
  });

  it("carrega a chamada da aula com o estado existente (sem chamada, presente, falta+justificativa)", async () => {
    const { calls } = setup();
    await openLesson("1");
    await screen.findByText("Ana");
    expect(calls.some((c) => c.url === "/attendance/lessons/1" && c.method === "GET")).toBe(true);
    expect(screen.getByLabelText("Presença de Ana")).toHaveAttribute("data-state", "indeterminate");
    expect(screen.getByLabelText("Presença de Beto")).toHaveAttribute("data-state", "checked");
    expect(screen.getByLabelText("Presença de Caio")).toHaveAttribute("data-state", "unchecked");
    expect(screen.getByLabelText("Justificativa de Caio")).toHaveValue("Gripe");
    expect(screen.getByTestId("count-present")).toHaveTextContent("1 presente");
    expect(screen.getByTestId("count-absent")).toHaveTextContent("1 falta");
    expect(screen.getByTestId("count-undecided")).toHaveTextContent("1 sem chamada");
  });

  it("salva em lote: POST array só com quem foi marcado, justificativa só para falta", async () => {
    const { calls } = setup();
    await openLesson("1");
    await screen.findByText("Ana");
    fireEvent.click(screen.getByLabelText("Presença de Beto")); // presente -> falta
    fireEvent.change(screen.getByLabelText("Justificativa de Beto"), { target: { value: "  Viagem  " } });
    fireEvent.change(screen.getByLabelText("Justificativa de Caio"), { target: { value: "" } });
    // Ana segue sem marcação -> não é enviada
    fireEvent.click(screen.getByRole("button", { name: "Salvar frequência" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/attendance/lessons/1");
    expect(post.body).toEqual([
      { studentId: 12, present: false, justification: "Viagem" },
      { studentId: 13, present: false },
    ]);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Frequência salva (2 alunos)."));
  });

  it("'Todos presentes' marca todos e habilita enviar todos; 'Restantes ausentes' só afeta os sem marcação", async () => {
    const { calls } = setup();
    await openLesson("1");
    await screen.findByText("Ana");
    fireEvent.click(screen.getByRole("button", { name: /Restantes ausentes/ }));
    expect(screen.getByLabelText("Presença de Ana")).toHaveAttribute("data-state", "unchecked");
    expect(screen.getByLabelText("Presença de Beto")).toHaveAttribute("data-state", "checked");
    expect(screen.queryByTestId("count-undecided")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Todos presentes/ }));
    expect(screen.getByTestId("count-present")).toHaveTextContent("3 presentes");
    fireEvent.click(screen.getByRole("button", { name: "Salvar frequência" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect((calls.find((c) => c.method === "POST")!.body as unknown[]).length).toBe(3);
  });

  it("erro do backend ao salvar vira toast e a chamada local é mantida", async () => {
    setup({ save: () => json(400, { message: "Aluno inválido para esta organização." }) });
    await openLesson("1");
    await screen.findByText("Ana");
    fireEvent.click(screen.getByLabelText("Presença de Ana"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar frequência" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Aluno inválido para esta organização."));
    expect(screen.getByLabelText("Presença de Ana")).toHaveAttribute("data-state", "checked");
  });

  it("turma sem alunos e erro ao carregar a chamada", async () => {
    setup({ roster: () => json(200, []) });
    await openLesson("1");
    expect(await screen.findByTestId("roster-empty")).toHaveTextContent("Esta turma não tem alunos matriculados.");
  });

  it("erro ao carregar a chamada mostra mensagem com retry", async () => {
    setup({ roster: () => json(404, { message: "Aula não encontrada." }) });
    await openLesson("1");
    expect(await screen.findByTestId("roster-error")).toHaveTextContent("Aula não encontrada.");
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });
});

describe("roster (lógica da chamada em lote)", () => {
  const rows = toRows([
    { studentId: 1, studentName: "A", present: null, justification: null },
    { studentId: 2, studentName: "B", present: true, justification: null },
    { studentId: 3, studentName: "C", present: false, justification: "x" },
  ]);

  it("nextPresence alterna: sem marcação -> presente -> falta -> presente", () => {
    expect(nextPresence(null)).toBe(true);
    expect(nextPresence(true)).toBe(false);
    expect(nextPresence(false)).toBe(true);
  });

  it("summarize conta presentes, faltas e sem marcação", () => {
    expect(summarize(rows)).toEqual({ total: 3, present: 1, absent: 1, undecided: 1 });
  });

  it("buildPayload ignora sem marcação, apara justificativa e a descarta quando presente", () => {
    let r = setJustification(rows, 3, "  Gripe  ");
    r = setJustification(r, 2, "ignorada");
    expect(buildPayload(r)).toEqual([
      { studentId: 2, present: true },
      { studentId: 3, present: false, justification: "Gripe" },
    ]);
    expect(buildPayload(setPresence(rows, 1, false))).toContainEqual({ studentId: 1, present: false });
  });

  it("markAll respeita onlyUndecided; payload vazio quando ninguém foi marcado", () => {
    expect(markAll(rows, false, true).map((x) => x.present)).toEqual([false, true, false]);
    expect(markAll(rows, true).map((x) => x.present)).toEqual([true, true, true]);
    expect(buildPayload(toRows([{ studentId: 1, studentName: "A", present: null, justification: null }]))).toEqual([]);
  });
});
