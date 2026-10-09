import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { GraduacoesPage } from "@/modules/graduacoes/graduacoes-page";
import { levelOptions, type GraduationSystem } from "@/modules/graduacoes/graduacoes-api";
import { toLevelInput, toRegistrationInput, toSystemInput } from "@/modules/graduacoes/graduacoes-forms";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const level = (id: number, name: string, order: number, color: string | null, systemId = 1) => ({
  id,
  graduationSystemId: systemId,
  name,
  order,
  color,
});
const systemsData: GraduationSystem[] = [
  {
    id: 1,
    name: "Cordas",
    description: "Sistema de cordas",
    isActive: true,
    // fora de ordem de propósito: a UI ordena por `order`
    levels: [level(2, "Amarela", 1, "#ffff00"), level(1, "Crua", 0, "#f5f5dc"), level(3, "Verde", 2, null)],
  },
  { id: 2, name: "Antigo", description: null, isActive: false, levels: [level(9, "X", 0, null, 2)] },
  { id: 3, name: "Vazio", description: null, isActive: true, levels: [] },
];
const studentsData = [
  { id: 5, name: "Ana", status: "ACTIVE" },
  { id: 6, name: "Beto", status: "INACTIVE" },
];
const historyData = [
  { id: 100, studentId: 5, graduationLevelId: 2, graduatedAt: "2026-02-10T00:00:00.000Z", notes: "Batizado", graduationLevel: level(2, "Amarela", 1, "#ffff00") },
  { id: 101, studentId: 5, graduationLevelId: 1, graduatedAt: "2025-08-01T00:00:00.000Z", notes: null, graduationLevel: level(1, "Crua", 0, "#f5f5dc") },
];

interface Call { url: string; method: string; body: unknown }
interface Opts {
  systems?: () => Response;
  history?: () => Response;
  write?: (call: Call) => Response;
  studentsTotal?: number;
}

function setup(opts: Opts = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const url = input.replace(/^.*\/api/, "");
      const call = { url, method, body: init.body ? JSON.parse(init.body as string) : undefined };
      calls.push(call);
      if (method === "GET" && url === "/graduations/systems") return Promise.resolve(opts.systems?.() ?? json(200, systemsData));
      if (method === "GET" && url.split("?")[0] === "/students") {
        // o servidor busca por nome (q)
        const q = (new URLSearchParams(url.split("?")[1] ?? "").get("q") ?? "").toLowerCase();
        const body = studentsData.filter((s) => s.name.toLowerCase().includes(q));
        const headers = opts.studentsTotal === undefined ? {} : { "X-Total-Count": String(opts.studentsTotal) };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers }));
      }
      if (method === "GET" && url.startsWith("/graduations/students/")) return Promise.resolve(opts.history?.() ?? json(200, historyData));
      return Promise.resolve(opts.write?.(call) ?? json(201, { id: 77 }));
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GraduacoesPage />
    </QueryClientProvider>,
  );
  return { calls };
}
const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Graduações - sistemas e níveis", () => {
  it("lista sistemas com níveis ordenados por `order`, descrição e selo de inativo", async () => {
    setup();
    const list = await screen.findByRole("list", { name: "Níveis de Cordas" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["0. Crua", "1. Amarela", "2. Verde"]);
    expect(screen.getByText("Sistema de cordas")).toBeInTheDocument();
    expect(screen.getByText("Inativo")).toBeInTheDocument();
    expect(screen.getByText("Nenhum nível cadastrado neste sistema ainda.")).toBeInTheDocument();
  });

  it("estado de erro com retry e estado vazio", async () => {
    setup({ systems: () => json(500, { message: "Banco fora." }) });
    expect(await screen.findByTestId("systems-error")).toHaveTextContent("Banco fora.");
    cleanup();
    vi.unstubAllGlobals();
    setup({ systems: () => json(200, []) });
    expect(await screen.findByTestId("systems-empty")).toHaveTextContent("Nenhum sistema de graduação cadastrado ainda.");
  });

  it("valida nome do sistema (mín. 2) sem chamar a API", async () => {
    const { calls } = setup();
    await screen.findByRole("list", { name: "Níveis de Cordas" });
    fireEvent.click(screen.getByRole("button", { name: "Novo sistema" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "A" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText(/Informe o nome do sistema/)).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);
  });

  it("cria sistema: POST /graduations/systems com nome aparado e descrição omitida se vazia", async () => {
    const { calls } = setup();
    await screen.findByRole("list", { name: "Níveis de Cordas" });
    fireEvent.click(screen.getByRole("button", { name: "Novo sistema" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "  Faixas  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toEqual({ url: "/graduations/systems", method: "POST", body: { name: "Faixas" } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Sistema de graduação criado."));
  });

  it("adiciona nível: ordem sugerida = qtd de níveis, valida ordem e envia cor", async () => {
    const { calls } = setup();
    await screen.findByRole("list", { name: "Níveis de Cordas" });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar nível em Cordas" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Ordem")).toHaveValue(3);

    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText("Informe o nome do nível.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Nome do nível"), { target: { value: "Azul" } });
    fireEvent.change(within(dialog).getByLabelText("Ordem"), { target: { value: "-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText(/Informe a ordem/)).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("Ordem"), { target: { value: "3" } });
    fireEvent.change(within(dialog).getByLabelText("Cor do nível"), { target: { value: "#0000ff" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toEqual({
      url: "/graduations/systems/1/levels",
      method: "POST",
      body: { name: "Azul", order: 3, color: "#0000ff" },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Nível adicionado."));
  });

  it("nível sem cor omite `color`; 'Remover cor' limpa a escolha", async () => {
    const { calls } = setup();
    await screen.findByRole("list", { name: "Níveis de Cordas" });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar nível em Vazio" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Cor do nível"), { target: { value: "#ff0000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remover cor" }));
    expect(within(dialog).getByText("Sem cor")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Nome do nível"), { target: { value: "Branca" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ name: "Branca", order: 0 });
  });

  it("erro do backend (sistema inexistente) vira toast e mantém o diálogo", async () => {
    setup({ write: () => json(404, { message: "Sistema de graduação não encontrado." }) });
    await screen.findByRole("list", { name: "Níveis de Cordas" });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar nível em Cordas" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome do nível"), { target: { value: "Azul" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Sistema de graduação não encontrado."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

async function goStudents() {
  const tab = await screen.findByRole("tab", { name: "Graduação de alunos" });
  fireEvent.mouseDown(tab, { button: 0 }); // Radix Tabs ativa no mouseDown
  fireEvent.click(tab);
  await screen.findByLabelText("Aluno");
}

describe("Graduações - alunos", () => {
  async function openStudents() {
    const calls = setup();
    await goStudents();
    return calls;
  }

  it("sem aluno: botão de registrar desabilitado; com aluno: histórico com nível, sistema, data e observação", async () => {
    const { calls } = await openStudents();
    expect(screen.getByRole("button", { name: "Registrar graduação" })).toBeDisabled();
    await waitFor(() => expect(within(screen.getByLabelText("Aluno")).getAllByRole("option")).toHaveLength(3));
    expect(screen.getByRole("option", { name: "Beto (inativo)" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Aluno"), { target: { value: "5" } });
    const row = (await screen.findByRole("cell", { name: "Amarela" })).closest("tr")!;
    expect(calls.some((c) => c.url === "/graduations/students/5" && c.method === "GET")).toBe(true);
    expect(within(row).getByText("Cordas")).toBeInTheDocument();
    expect(within(row).getByText("10/02/2026")).toBeInTheDocument();
    expect(within(row).getByText("Batizado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar graduação" })).toBeEnabled();
  });

  it("histórico vazio e erro de histórico", async () => {
    setup({ history: () => json(200, []) });
    await goStudents();
    await waitFor(() => expect(within(screen.getByLabelText("Aluno")).getAllByRole("option")).toHaveLength(3));
    fireEvent.change(screen.getByLabelText("Aluno"), { target: { value: "5" } });
    expect(await screen.findByTestId("table-empty")).toHaveTextContent("Este aluno ainda não tem graduações registradas.");
  });

  it("registra graduação: valida campos, só lista níveis de sistemas ativos e faz POST", async () => {
    const { calls } = await openStudents();
    await waitFor(() => expect(within(screen.getByLabelText("Aluno")).getAllByRole("option")).toHaveLength(3));
    fireEvent.change(screen.getByLabelText("Aluno"), { target: { value: "5" } });
    await screen.findByRole("cell", { name: "Amarela" });
    fireEvent.click(screen.getByRole("button", { name: "Registrar graduação" }));
    const dialog = await screen.findByRole("dialog");

    const labels = within(within(dialog).getByLabelText("Nível alcançado")).getAllByRole("option").map((o) => o.textContent);
    expect(labels).toEqual(["Selecione…", "Cordas — Crua", "Cordas — Amarela", "Cordas — Verde"]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText("Selecione o nível alcançado.")).toBeInTheDocument();
    expect(within(dialog).getByText("Informe a data da graduação.")).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("Nível alcançado"), { target: { value: "3" } });
    fireEvent.change(within(dialog).getByLabelText("Data"), { target: { value: "2026-06-15" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toEqual({
      url: "/graduations/students/5",
      method: "POST",
      body: { graduationLevelId: 3, graduatedAt: "2026-06-15" },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Graduação registrada."));
    // invalida o histórico -> novo GET
    await waitFor(() => expect(calls.filter((c) => c.url === "/graduations/students/5" && c.method === "GET").length).toBeGreaterThan(1));
  });

  it("nível de outra organização (400 do backend) vira toast", async () => {
    setup({ write: () => json(400, { message: "Nível de graduação inválido para esta organização." }) });
    await goStudents();
    await waitFor(() => expect(within(screen.getByLabelText("Aluno")).getAllByRole("option")).toHaveLength(3));
    fireEvent.change(screen.getByLabelText("Aluno"), { target: { value: "5" } });
    await screen.findByRole("cell", { name: "Amarela" });
    fireEvent.click(screen.getByRole("button", { name: "Registrar graduação" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nível alcançado"), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText("Data"), { target: { value: "2026-06-15" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nível de graduação inválido para esta organização."));
  });
});

describe("Graduações - busca de aluno no servidor", () => {
  const studentCalls = (calls: Call[]) => calls.filter((c) => c.url.startsWith("/students")).map((c) => c.url);
  const optionNames = () => within(screen.getByLabelText("Aluno")).getAllByRole("option").map((o) => o.textContent);

  it("carrega os 20 primeiros (limit=20, sem q) e busca com debounce de 300ms em /students?q=", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { calls } = setup();
      await goStudents();
      await waitFor(() => expect(optionNames()).toEqual(["Selecione…", "Ana", "Beto (inativo)"]));
      expect(studentCalls(calls)).toEqual(["/students?limit=20"]);

      fireEvent.change(screen.getByLabelText("Buscar aluno"), { target: { value: "be" } });
      fireEvent.change(screen.getByLabelText("Buscar aluno"), { target: { value: "bet" } });
      await act(async () => { await vi.advanceTimersByTimeAsync(250); });
      expect(studentCalls(calls)).toEqual(["/students?limit=20"]); // ainda dentro do debounce
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      await waitFor(() => expect(optionNames()).toEqual(["Selecione…", "Beto (inativo)"]));
      expect(studentCalls(calls)).toEqual(["/students?limit=20", "/students?q=bet&limit=20"]); // 1 só chamada p/ 2 digitações
    } finally {
      vi.useRealTimers();
    }
  });

  it("o aluno selecionado é preservado quando a busca muda e ele deixa de casar", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { calls } = setup();
      await goStudents();
      await waitFor(() => expect(optionNames()).toHaveLength(3));
      fireEvent.change(screen.getByLabelText("Aluno"), { target: { value: "5" } });
      await screen.findByRole("cell", { name: "Amarela" });

      fireEvent.change(screen.getByLabelText("Buscar aluno"), { target: { value: "zz" } });
      await act(async () => { await vi.advanceTimersByTimeAsync(350); });
      await waitFor(() => expect(optionNames()).toEqual(["Selecione…", "Ana"]));
      // a busca "zz" não casa ninguém; a Ana (selecionada) segue na lista
      expect(screen.getByLabelText("Aluno")).toHaveValue("5");
      expect(screen.getByRole("cell", { name: "Amarela" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Registrar graduação" })).toBeEnabled();
      expect(studentCalls(calls)).toContain("/students?q=zz&limit=20");
    } finally {
      vi.useRealTimers();
    }
  });

  it("avisa quando há mais alunos que o limite da busca (total > 20)", async () => {
    setup({ studentsTotal: 57 });
    await goStudents();
    expect(await screen.findByTestId("students-truncated")).toHaveTextContent("Mostrando 20 de 57 alunos");
  });
});

describe("helpers de graduações", () => {
  it("levelOptions ignora sistemas inativos e ordena por order", () => {
    expect(levelOptions(systemsData).map((o) => o.label)).toEqual(["Cordas — Crua", "Cordas — Amarela", "Cordas — Verde"]);
    expect(levelOptions(undefined)).toEqual([]);
  });
  it("conversores de formulário para payload", () => {
    expect(toSystemInput({ name: " A1 ", description: "  " })).toEqual({ name: "A1", description: undefined });
    expect(toLevelInput({ name: " N ", order: "2", color: "" })).toEqual({ name: "N", order: 2, color: undefined });
    expect(toRegistrationInput({ graduationLevelId: "4", graduatedAt: "2026-01-01", notes: " ok " })).toEqual({
      graduationLevelId: 4,
      graduatedAt: "2026-01-01",
      notes: "ok",
    });
  });
});
