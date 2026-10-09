import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, loginAs } from "./login-as";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { AulasPage } from "@/modules/aulas/aulas-page";
import { toPayload } from "@/modules/aulas/aulas-form";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const classes = [
  { id: 1, name: "Infantil" },
  { id: 2, name: "Adulto" },
];
const teachers = [{ id: 10, role: "MESTRE", status: "ACTIVE", user: { id: 7, name: "Mestre Bimba", email: "b@x.com", phone: null } }];
const baseLessons = [
  { id: 1, classId: 1, unitId: null, teacherUserId: 7, date: "2026-03-05T00:00:00.000Z", startTime: "18:00", endTime: "19:00", notes: "Roda", status: "ACTIVE" },
  { id: 2, classId: 2, unitId: null, teacherUserId: null, date: "2026-03-06T00:00:00.000Z", startTime: null, endTime: null, notes: null, status: "INACTIVE" },
];

interface Call { url: string; method: string; body: unknown }

const page = <T,>(rows: T[], total = rows.length) => json(200, rows, { "X-Total-Count": String(total) });

function setup(
  overrides: {
    lessons?: Response | ((query: URLSearchParams) => Response);
    classesTotal?: number;
    teachersTotal?: number;
    onMutation?: (call: Call) => Response;
  } = {},
) {
  const calls: Call[] = [];
  /** query string de cada GET (por caminho), para conferir o que foi enviado ao servidor */
  const queries: Record<string, URLSearchParams[]> = {};
  const fetchMock = vi.fn((input: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const [url = "", search = ""] = input.replace(/^.*\/api/, "").split("?");
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });
    if (method === "GET") (queries[url] ??= []).push(new URLSearchParams(search));
    if (method === "GET" && url === "/lessons") {
      const o = overrides.lessons;
      return Promise.resolve(typeof o === "function" ? o(new URLSearchParams(search)) : (o ?? page(baseLessons)));
    }
    if (method === "GET" && url === "/classes") return Promise.resolve(page(classes, overrides.classesTotal));
    if (method === "GET" && url === "/teachers") return Promise.resolve(page(teachers, overrides.teachersTotal));
    return Promise.resolve(overrides.onMutation?.({ url, method, body }) ?? json(200, { id: 99 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AulasPage />
    </QueryClientProvider>,
  );
  return { calls, queries };
}

const mutations = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

beforeEach(() => {
  loginAs("MESTRE"); // a UI esconde ações conforme o papel (useCan); os testes de PROFESSOR trocam o papel
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("AulasPage", () => {
  it("lista aulas com turma, data (sem voltar um dia), horário e professor resolvidos", async () => {
    setup();
    await screen.findByRole("cell", { name: "Infantil" });
    const row = screen.getByRole("cell", { name: "Infantil" }).closest("tr")!;
    expect(within(row).getByText("05/03/2026")).toBeInTheDocument();
    expect(within(row).getByText("18:00 – 19:00")).toBeInTheDocument();
    expect(within(row).getByText("Mestre Bimba")).toBeInTheDocument();
    expect(within(row).getByText("Ativa")).toBeInTheDocument();
    const cancelled = screen.getByRole("cell", { name: "Adulto" }).closest("tr")!;
    expect(within(cancelled).getByText("Cancelada")).toBeInTheDocument();
    // aula cancelada não oferece "Cancelar"
    expect(within(cancelled).queryByRole("button", { name: /Cancelar aula/ })).toBeNull();
  });

  it("turma, status, período e busca vão ao SERVIDOR (classId/status/from/to/q)", async () => {
    const { queries } = setup({
      lessons: (q) => {
        const classId = q.get("classId");
        const status = q.get("status");
        const from = q.get("from");
        const to = q.get("to");
        const text = q.get("q")?.toLowerCase();
        const rows = baseLessons.filter(
          (l) =>
            (!classId || String(l.classId) === classId) &&
            (!status || l.status === status) &&
            (!from || l.date.slice(0, 10) >= from) &&
            (!to || l.date.slice(0, 10) <= to) &&
            (!text || (l.notes ?? "").toLowerCase().includes(text)),
        );
        return page(rows);
      },
    });
    await screen.findByRole("cell", { name: "Infantil" });
    const lastQuery = () => queries["/lessons"]!.at(-1)!;
    const first = queries["/lessons"]![0]!;
    expect(first.get("limit")).toBe("10");
    expect(first.get("offset")).toBe("0");
    for (const k of ["classId", "status", "from", "to", "q"]) expect(first.has(k)).toBe(false);
    // selects auxiliares pedem o máximo do servidor
    expect(queries["/classes"]![0]!.get("limit")).toBe("200");
    expect(queries["/teachers"]![0]!.get("limit")).toBe("200");
    expect(screen.queryByTestId("table-limit-warning")).toBeNull();

    fireEvent.change(screen.getByLabelText("Filtrar por turma"), { target: { value: "2" } });
    await waitFor(() => expect(screen.queryByRole("cell", { name: "Infantil" })).toBeNull());
    expect(screen.getByRole("cell", { name: "Adulto" })).toBeInTheDocument();
    expect(lastQuery().get("classId")).toBe("2");
    fireEvent.change(screen.getByLabelText("Filtrar por turma"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "ACTIVE" } });
    await waitFor(() => expect(screen.queryByRole("cell", { name: "Adulto" })).toBeNull());
    expect(lastQuery().get("status")).toBe("ACTIVE");
    expect(lastQuery().has("classId")).toBe(false);
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-03-06" } });
    await waitFor(() => expect(screen.queryByRole("cell", { name: "Infantil" })).toBeNull());
    expect(lastQuery().get("from")).toBe("2026-03-06");
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-03-31" } });
    await waitFor(() => expect(lastQuery().get("to")).toBe("2026-03-31"));
    expect(lastQuery().get("from")).toBe("2026-03-06");
    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "" } });
    await waitFor(() => expect(lastQuery().has("from") || lastQuery().has("to")).toBe(false));
    // busca com debounce: um só GET com q
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "ro" } });
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "roda" } });
    await waitFor(() => expect(lastQuery().get("q")).toBe("roda"));
    expect(queries["/lessons"]!.filter((q) => q.has("q"))).toHaveLength(1);
    expect(await screen.findByRole("cell", { name: "Infantil" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("cell", { name: "Adulto" })).toBeNull());
  });

  it("pagina no servidor: total do header, offset da página 2 e volta à pág. 1 ao filtrar", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...baseLessons[0]!, id: 100 + i, notes: `Aula ${String(i + 1).padStart(2, "0")}` }));
    const { queries } = setup({
      lessons: (q) => {
        const offset = Number(q.get("offset") ?? 0);
        const limit = Number(q.get("limit") ?? 50);
        return page(many.slice(offset, offset + limit), 25);
      },
    });
    await screen.findAllByRole("cell", { name: "Infantil" });
    expect(screen.getByTestId("table-count")).toHaveTextContent("25 registros");
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Próxima página"));
    expect(await screen.findByText("Página 2 de 3")).toBeInTheDocument();
    expect(queries["/lessons"]!.at(-1)!.get("offset")).toBe("10");
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "ACTIVE" } });
    await waitFor(() => expect(queries["/lessons"]!.at(-1)!.get("status")).toBe("ACTIVE"));
    expect(queries["/lessons"]!.at(-1)!.get("offset")).toBe("0");
    expect(await screen.findByText("Página 1 de 3")).toBeInTheDocument();
  });

  it("avisa (sem quebrar) quando há mais de 200 turmas/professores nos selects", async () => {
    setup({ classesTotal: 350, teachersTotal: 260 });
    await screen.findByRole("cell", { name: "Infantil" });
    expect(await screen.findByTestId("classes-limit-warning")).toHaveTextContent("200 de 350 turmas");
    fireEvent.click(screen.getByRole("button", { name: "Nova aula" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/200 de 350 turmas/)).toBeInTheDocument();
    expect(within(dialog).getByText(/200 de 260 professores/)).toBeInTheDocument();
  });

  it("mostra erro com retry quando a lista falha e vazio quando não há aulas", async () => {
    setup({ lessons: json(500, { message: "Falhou feio." }) });    expect(await screen.findByTestId("table-error")).toHaveTextContent("Falhou feio.");
  });

  it("estado vazio", async () => {
    setup({ lessons: json(200, []) });
    expect(await screen.findByTestId("table-empty")).toHaveTextContent("Nenhuma aula cadastrada ainda.");
  });

  it("valida turma e data antes de enviar (nenhuma chamada de escrita)", async () => {
    const { calls } = setup();
    await screen.findByRole("cell", { name: "Infantil" });
    fireEvent.click(screen.getByRole("button", { name: "Nova aula" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Selecione a turma.")).toBeInTheDocument();
    expect(screen.getByText("Informe a data da aula.")).toBeInTheDocument();
    expect(mutations(calls)).toHaveLength(0);
  });

  it("valida fim depois do início", async () => {
    const { calls } = setup();
    await screen.findByRole("cell", { name: "Infantil" });
    fireEvent.click(screen.getByRole("button", { name: "Nova aula" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Turma"), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText("Data"), { target: { value: "2026-04-01" } });
    fireEvent.change(within(dialog).getByLabelText("Início"), { target: { value: "19:00" } });
    fireEvent.change(within(dialog).getByLabelText("Fim"), { target: { value: "18:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("O fim deve ser depois do início.")).toBeInTheDocument();
    expect(mutations(calls)).toHaveLength(0);
  });

  it("cria aula: POST /lessons com números e sem campos vazios + toast", async () => {
    const { calls } = setup();
    await screen.findByRole("cell", { name: "Infantil" });
    fireEvent.click(screen.getByRole("button", { name: "Nova aula" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Turma"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Data"), { target: { value: "2026-04-01" } });
    fireEvent.change(within(dialog).getByLabelText("Professor"), { target: { value: "7" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(mutations(calls)).toHaveLength(1));
    expect(mutations(calls)[0]).toEqual({
      url: "/lessons",
      method: "POST",
      body: { classId: 2, date: "2026-04-01", teacherUserId: 7 },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Aula criada."));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("edita aula: PATCH /lessons/:id, campos limpos vão como null e status é enviado", async () => {
    const { calls } = setup();
    await screen.findByRole("cell", { name: "Infantil" });
    fireEvent.click(screen.getByRole("button", { name: "Editar aula de Infantil" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Início")).toHaveValue("18:00");
    fireEvent.change(within(dialog).getByLabelText("Início"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Fim"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Professor"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Status"), { target: { value: "INACTIVE" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(mutations(calls)).toHaveLength(1));
    expect(mutations(calls)[0]).toEqual({
      url: "/lessons/1",
      method: "PATCH",
      body: { classId: 1, date: "2026-03-05", startTime: null, endTime: null, teacherUserId: null, notes: "Roda", status: "INACTIVE" },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Aula atualizada."));
  });

  it("edita aula: esvaziar observações envia null; classId/date/status nunca null", async () => {
    const { calls } = setup();
    await screen.findByRole("cell", { name: "Infantil" });
    fireEvent.click(screen.getByRole("button", { name: "Editar aula de Infantil" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Observações")).toHaveValue("Roda"));
    fireEvent.change(within(dialog).getByLabelText("Observações"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(mutations(calls)).toHaveLength(1));
    expect(mutations(calls)[0]!.body).toEqual({
      classId: 1, date: "2026-03-05", startTime: "18:00", endTime: "19:00", teacherUserId: 7, notes: null, status: "ACTIVE",
    });
  });

  it("erro 400 do PATCH aparece em toast e mantém o formulário aberto", async () => {
    setup({ onMutation: () => json(400, { message: ["teacherUserId must be an integer number"] }) });
    await screen.findByRole("cell", { name: "Infantil" });
    fireEvent.click(screen.getByRole("button", { name: "Editar aula de Infantil" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Observações")).toHaveValue("Roda"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("teacherUserId must be an integer number"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("erro do backend na criação vira toast e mantém o diálogo aberto", async () => {
    const { calls } = setup({ onMutation: () => json(400, { message: "Turma inválida para esta organização." }) });
    await screen.findByRole("cell", { name: "Infantil" });
    fireEvent.click(screen.getByRole("button", { name: "Nova aula" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Turma"), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText("Data"), { target: { value: "2026-04-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Turma inválida para esta organização."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mutations(calls)).toHaveLength(1);
  });

  it("cancelar aula pede confirmação e só então faz DELETE /lessons/:id", async () => {
    const { calls } = setup();
    await screen.findByRole("cell", { name: "Infantil" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar aula de Infantil" }));
    const alert = await screen.findByRole("alertdialog");
    expect(alert).toHaveTextContent("O histórico é preservado.");
    expect(mutations(calls)).toHaveLength(0);
    fireEvent.click(within(alert).getByRole("button", { name: "Cancelar aula" }));
    await waitFor(() => expect(mutations(calls)).toHaveLength(1));
    expect(mutations(calls)[0]).toMatchObject({ url: "/lessons/1", method: "DELETE" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Aula cancelada."));
  });

  it("RBAC: MESTRE vê Cancelar aula; PROFESSOR não (lessons:delete) mas continua com Editar", async () => {
    setup();
    await screen.findByRole("cell", { name: "Infantil" });
    expect(screen.getByRole("button", { name: "Cancelar aula de Infantil" })).toBeInTheDocument();
    cleanup();

    loginAs("PROFESSOR");
    setup();
    await screen.findByRole("cell", { name: "Infantil" });
    expect(screen.queryByRole("button", { name: /Cancelar aula/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Editar aula de Infantil" })).toBeInTheDocument();
  });

  it("'Voltar' no diálogo de cancelamento não chama a API", async () => {
    const { calls } = setup();
    await screen.findByRole("cell", { name: "Infantil" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar aula de Infantil" }));
    const alert = await screen.findByRole("alertdialog");
    fireEvent.click(within(alert).getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mutations(calls)).toHaveLength(0);
  });
});

describe("toPayload", () => {
  const base = { classId: "3", date: "2026-05-01", startTime: "", endTime: "", teacherUserId: "", notes: "  ", status: "ACTIVE" as const };
  it("criação omite vazios e não envia status", () => {
    expect(toPayload(base, false)).toEqual({ classId: 3, date: "2026-05-01" });
  });
  it("edição envia null nos vazios e o status", () => {
    expect(toPayload(base, true)).toEqual({
      classId: 3, date: "2026-05-01", startTime: null, endTime: null, teacherUserId: null, notes: null, status: "ACTIVE",
    });
  });
});
