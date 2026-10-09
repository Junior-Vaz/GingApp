import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { StudentPicker, type StudentOption, type StudentPickerProps } from "@/components/painel/student-picker";

const STUDENTS: StudentOption[] = [
  { id: 5, name: "Ana", status: "ACTIVE" },
  { id: 6, name: "Beto", status: "INACTIVE" },
  { id: 7, name: "Bruna", status: "ACTIVE" },
];

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

interface Opts {
  search?: (q: string) => Response;
  byId?: (id: number) => Response;
}

/** fetch falso: GET /students?q&limit (busca) e GET /students/:id; registra as URLs chamadas. */
function mockFetch(opts: Opts = {}) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      const url = input.replace(/^.*\/api/, "");
      urls.push(url);
      const [path = "", search = ""] = url.split("?");
      const byId = /^\/students\/(\d+)$/.exec(path);
      if (byId) {
        const id = Number(byId[1]);
        return Promise.resolve(
          opts.byId?.(id) ??
            (STUDENTS.find((s) => s.id === id) ? json(200, STUDENTS.find((s) => s.id === id)) : json(404, { message: "Aluno não encontrado." })),
        );
      }
      if (path === "/students") {
        const q = (new URLSearchParams(search).get("q") ?? "").toLowerCase();
        return Promise.resolve(
          opts.search?.(q) ??
            (() => {
              const rows = STUDENTS.filter((s) => s.name.toLowerCase().includes(q));
              return json(200, rows, { "X-Total-Count": String(rows.length) });
            })(),
        );
      }
      return Promise.resolve(json(404, { message: "sem rota" }));
    }),
  );
  return {
    urls,
    searches: () => urls.filter((u) => u.startsWith("/students?")),
    byIds: () => urls.filter((u) => /^\/students\/\d+$/.test(u)),
  };
}

/** Pai controlado: guarda só o id, como os formulários reais. `onPick` espia o objeto devolvido. */
function Harness({
  initialId = null,
  onPick,
  ...props
}: { initialId?: number | null; onPick?: (s: StudentOption | null) => void } & Partial<StudentPickerProps>) {
  const [id, setId] = useState<number | null>(initialId);
  return (
    <>
      <StudentPicker
        {...props}
        value={id}
        onChange={(s) => {
          setId(s?.id ?? null);
          onPick?.(s);
        }}
      />
      <output data-testid="value">{id === null ? "null" : String(id)}</output>
    </>
  );
}

function renderPicker(props: Parameters<typeof Harness>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

const optionNames = (label = "Aluno") =>
  Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.textContent);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("StudentPicker - busca no servidor", () => {
  it("carrega limit=20 sem q e debounce de 300ms: 2 digitações = 1 chamada com q", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = mockFetch();
    renderPicker();
    await waitFor(() => expect(optionNames()).toEqual(["Selecione…", "Ana", "Beto (inativo)", "Bruna"]));
    expect(f.searches()).toEqual(["/students?limit=20"]);

    fireEvent.change(screen.getByLabelText("Buscar aluno"), { target: { value: "b" } });
    fireEvent.change(screen.getByLabelText("Buscar aluno"), { target: { value: "bet" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(f.searches()).toEqual(["/students?limit=20"]); // ainda dentro do debounce
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await waitFor(() => expect(optionNames()).toEqual(["Selecione…", "Beto (inativo)"]));
    expect(f.searches()).toEqual(["/students?limit=20", "/students?q=bet&limit=20"]); // 1 chamada p/ 2 digitações
  });

  it("espaços em volta do texto são aparados antes de ir ao servidor", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = mockFetch();
    renderPicker();
    await waitFor(() => expect(optionNames()).toHaveLength(4));
    fireEvent.change(screen.getByLabelText("Buscar aluno"), { target: { value: "  ana  " } });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    await waitFor(() => expect(f.searches()).toContain("/students?q=ana&limit=20"));
  });

  it("onChange devolve o OBJETO do aluno e a seleção é preservada quando a busca muda e ele deixa de casar", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = mockFetch();
    const onPick = vi.fn();
    renderPicker({ onPick });
    await waitFor(() => expect(optionNames()).toHaveLength(4));
    fireEvent.change(screen.getByLabelText("Aluno"), { target: { value: "5" } });
    expect(onPick).toHaveBeenLastCalledWith({ id: 5, name: "Ana", status: "ACTIVE" });

    fireEvent.change(screen.getByLabelText("Buscar aluno"), { target: { value: "zz" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    await waitFor(() => expect(f.searches()).toContain("/students?q=zz&limit=20"));
    await waitFor(() => expect(optionNames()).toEqual(["Selecione…", "Ana"])); // Ana segue na lista
    expect(screen.getByLabelText("Aluno")).toHaveValue("5");
    expect(screen.getByTestId("value")).toHaveTextContent("5");
  });

  it("mostra 'Carregando alunos…' enquanto busca e o aviso de refinar quando total > 20", async () => {
    mockFetch({ search: () => json(200, STUDENTS, { "X-Total-Count": "57" }) });
    renderPicker();
    expect(screen.getByTestId("student-picker-status")).toHaveTextContent("Carregando alunos…");
    await waitFor(() =>
      expect(screen.getByTestId("student-picker-status")).toHaveTextContent("Mostrando 20 de 57 alunos. Digite para refinar a busca."),
    );
  });

  it("sem resultados: 'Nenhum aluno encontrado.'", async () => {
    mockFetch({ search: () => json(200, [], { "X-Total-Count": "0" }) });
    renderPicker();
    expect(await screen.findByText("Nenhum aluno encontrado.")).toBeInTheDocument();
  });
});

describe("StudentPicker - limpar (campo opcional) e obrigatório", () => {
  it("obrigatório: opção vazia 'Selecione…'; opcional: 'Sem aluno' e escolher volta com null", async () => {
    mockFetch();
    const onPick = vi.fn();
    renderPicker({ optional: true, onPick });
    await waitFor(() => expect(optionNames()).toEqual(["Sem aluno", "Ana", "Beto (inativo)", "Bruna"]));
    fireEvent.change(screen.getByLabelText("Aluno"), { target: { value: "6" } });
    expect(screen.getByTestId("value")).toHaveTextContent("6");
    fireEvent.change(screen.getByLabelText("Aluno"), { target: { value: "" } });
    expect(onPick).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId("value")).toHaveTextContent("null");
    expect(screen.getByLabelText("Aluno")).toHaveValue("");
  });

  it("emptyLabel e label personalizados", async () => {
    mockFetch();
    renderPicker({ label: "Aluno do certificado", emptyLabel: "Nenhum" });
    await waitFor(() => expect(optionNames("Aluno do certificado")[0]).toBe("Nenhum"));
  });

  it("disabled trava busca e select", async () => {
    mockFetch();
    renderPicker({ disabled: true });
    expect(screen.getByLabelText("Buscar aluno")).toBeDisabled();
    expect(screen.getByLabelText("Aluno")).toBeDisabled();
  });
});

describe("StudentPicker - erro", () => {
  it("erro da busca: alerta com a mensagem da API e 'Tentar novamente' refaz a chamada", async () => {
    let fail = true;
    const f = mockFetch({ search: () => (fail ? json(500, { message: "Banco fora." }) : json(200, STUDENTS, { "X-Total-Count": "3" })) });
    renderPicker();
    expect(await screen.findByRole("alert")).toHaveTextContent("Banco fora.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(optionNames()).toHaveLength(4));
    expect(f.searches().length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("StudentPicker - edição (aluno atual)", () => {
  it("aluno atual FORA dos resultados é resolvido por id (GET /students/:id) e fica selecionado", async () => {
    const f = mockFetch({ search: () => json(200, [STUDENTS[0]], { "X-Total-Count": "300" }) }); // só a Ana vem
    renderPicker({ initialId: 7 });
    expect(await screen.findByRole("option", { name: "Bruna" })).toBeInTheDocument();
    expect(f.byIds()).toEqual(["/students/7"]);
    expect(screen.getByLabelText("Aluno")).toHaveValue("7");
    expect((screen.getByLabelText("Aluno") as HTMLSelectElement).selectedOptions[0]).toHaveTextContent("Bruna");
    expect(optionNames()).toEqual(["Selecione…", "Bruna", "Ana"]); // atual primeiro, sem duplicar
  });

  it("aluno atual DENTRO dos resultados não dispara GET por id", async () => {
    const f = mockFetch();
    renderPicker({ initialId: 5 });
    await waitFor(() => expect(optionNames()).toHaveLength(4));
    expect(screen.getByLabelText("Aluno")).toHaveValue("5");
    expect(f.byIds()).toEqual([]);
  });

  it("`initial` (objeto já presente no registro) dispensa o GET por id", async () => {
    const f = mockFetch({ search: () => json(200, [STUDENTS[0]], { "X-Total-Count": "300" }) });
    renderPicker({ initialId: 7, initial: { id: 7, name: "Bruna" } });
    expect(await screen.findByRole("option", { name: "Bruna" })).toBeInTheDocument();
    await waitFor(() => expect(optionNames()).toHaveLength(3));
    expect(f.byIds()).toEqual([]);
    expect(screen.getByLabelText("Aluno")).toHaveValue("7");
  });

  it("aluno atual fora dos resultados sobrevive a uma nova busca que não o inclui", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetch({ search: (q) => json(200, q ? [] : [STUDENTS[0]], { "X-Total-Count": q ? "0" : "300" }) });
    renderPicker({ initialId: 7 });
    expect(await screen.findByRole("option", { name: "Bruna" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar aluno"), { target: { value: "xyz" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    await waitFor(() => expect(optionNames()).toEqual(["Selecione…", "Bruna"]));
    expect(screen.getByLabelText("Aluno")).toHaveValue("7");
  });

  it("falha ao resolver o aluno atual: mantém o valor ('Aluno #id') e avisa", async () => {
    mockFetch({
      search: () => json(200, [STUDENTS[0]], { "X-Total-Count": "300" }),
      byId: () => json(404, { message: "Aluno não encontrado." }),
    });
    renderPicker({ initialId: 99 });
    expect(await screen.findByRole("alert")).toHaveTextContent("Aluno não encontrado.");
    expect(screen.getByRole("option", { name: "Aluno #99" })).toBeInTheDocument();
    expect(screen.getByLabelText("Aluno")).toHaveValue("99");
  });
});

describe("StudentPicker - modo filtro", () => {
  it("rótulos por aria-label, opção 'Todos os alunos' e sem rótulos visíveis; volta a null", async () => {
    mockFetch();
    const onPick = vi.fn();
    renderPicker({ mode: "filter", onPick });
    await waitFor(() => expect(optionNames("Filtrar por aluno")).toEqual(["Todos os alunos", "Ana", "Beto (inativo)", "Bruna"]));
    expect(screen.getByLabelText("Buscar aluno")).toHaveAttribute("type", "search");
    expect(document.querySelectorAll("label")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Filtrar por aluno"), { target: { value: "7" } });
    expect(onPick).toHaveBeenLastCalledWith({ id: 7, name: "Bruna", status: "ACTIVE" });
    fireEvent.change(screen.getByLabelText("Filtrar por aluno"), { target: { value: "" } });
    expect(onPick).toHaveBeenLastCalledWith(null);
  });

  it("filtro externo zerado (botão Limpar do pai) volta o select para 'Todos os alunos'", async () => {
    mockFetch();
    function Parent() {
      const [id, setId] = useState<number | null>(6);
      return (
        <>
          <StudentPicker mode="filter" value={id} onChange={(s) => setId(s?.id ?? null)} />
          <button onClick={() => setId(null)}>Limpar</button>
        </>
      );
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Parent />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("Filtrar por aluno")).toHaveValue("6"));
    fireEvent.click(screen.getByText("Limpar"));
    expect(screen.getByLabelText("Filtrar por aluno")).toHaveValue("");
  });
});
