import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { UnitPicker, type UnitOption, type UnitPickerProps } from "@/components/painel/unit-picker";

const UNITS: UnitOption[] = [
  { id: 5, name: "Alvorada", status: "ACTIVE" },
  { id: 6, name: "Betim", status: "INACTIVE" },
  { id: 7, name: "Brusque", status: "ACTIVE" },
];

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

interface Opts {
  search?: (q: string) => Response;
  byId?: (id: number) => Response;
}

/** fetch falso: GET /units?q&limit (busca) e GET /units/:id; registra as URLs chamadas. */
function mockFetch(opts: Opts = {}) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      const url = input.replace(/^.*\/api/, "");
      urls.push(url);
      const [path = "", search = ""] = url.split("?");
      const byId = /^\/units\/(\d+)$/.exec(path);
      if (byId) {
        const id = Number(byId[1]);
        return Promise.resolve(
          opts.byId?.(id) ??
            (UNITS.find((s) => s.id === id) ? json(200, UNITS.find((s) => s.id === id)) : json(404, { message: "Unidade não encontrada." })),
        );
      }
      if (path === "/units") {
        const q = (new URLSearchParams(search).get("q") ?? "").toLowerCase();
        return Promise.resolve(
          opts.search?.(q) ??
            (() => {
              const rows = UNITS.filter((s) => s.name.toLowerCase().includes(q));
              return json(200, rows, { "X-Total-Count": String(rows.length) });
            })(),
        );
      }
      return Promise.resolve(json(404, { message: "sem rota" }));
    }),
  );
  return {
    urls,
    searches: () => urls.filter((u) => u.startsWith("/units?")),
    byIds: () => urls.filter((u) => /^\/units\/\d+$/.test(u)),
  };
}

/** Pai controlado: guarda só o id, como os formulários reais. `onPick` espia o objeto devolvido. */
function Harness({
  initialId = null,
  onPick,
  ...props
}: { initialId?: number | null; onPick?: (s: UnitOption | null) => void } & Partial<UnitPickerProps>) {
  const [id, setId] = useState<number | null>(initialId);
  return (
    <>
      <UnitPicker
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

const optionNames = (label = "Unidade") =>
  Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.textContent);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("UnitPicker - busca no servidor", () => {
  it("carrega limit=20 sem q e debounce de 300ms: 2 digitações = 1 chamada com q", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = mockFetch();
    renderPicker();
    await waitFor(() => expect(optionNames()).toEqual(["Selecione…", "Alvorada", "Betim (inativa)", "Brusque"]));
    expect(f.searches()).toEqual(["/units?limit=20"]);

    fireEvent.change(screen.getByLabelText("Buscar unidade"), { target: { value: "b" } });
    fireEvent.change(screen.getByLabelText("Buscar unidade"), { target: { value: "bet" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(f.searches()).toEqual(["/units?limit=20"]); // ainda dentro do debounce
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await waitFor(() => expect(optionNames()).toEqual(["Selecione…", "Betim (inativa)"]));
    expect(f.searches()).toEqual(["/units?limit=20", "/units?q=bet&limit=20"]); // 1 chamada p/ 2 digitações
  });

  it("espaços em volta do texto são aparados antes de ir ao servidor", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = mockFetch();
    renderPicker();
    await waitFor(() => expect(optionNames()).toHaveLength(4));
    fireEvent.change(screen.getByLabelText("Buscar unidade"), { target: { value: "  alv  " } });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    await waitFor(() => expect(f.searches()).toContain("/units?q=alv&limit=20"));
  });

  it("onChange devolve o OBJETO do unidade e a seleção é preservada quando a busca muda e ele deixa de casar", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = mockFetch();
    const onPick = vi.fn();
    renderPicker({ onPick });
    await waitFor(() => expect(optionNames()).toHaveLength(4));
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "5" } });
    expect(onPick).toHaveBeenLastCalledWith({ id: 5, name: "Alvorada", status: "ACTIVE" });

    fireEvent.change(screen.getByLabelText("Buscar unidade"), { target: { value: "zz" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    await waitFor(() => expect(f.searches()).toContain("/units?q=zz&limit=20"));
    await waitFor(() => expect(optionNames()).toEqual(["Selecione…", "Alvorada"])); // Alvorada segue na lista
    expect(screen.getByLabelText("Unidade")).toHaveValue("5");
    expect(screen.getByTestId("value")).toHaveTextContent("5");
  });

  it("mostra 'Carregando unidades…' enquanto busca e o aviso de refinar quando total > 20", async () => {
    mockFetch({ search: () => json(200, UNITS, { "X-Total-Count": "57" }) });
    renderPicker();
    expect(screen.getByTestId("unit-picker-status")).toHaveTextContent("Carregando unidades…");
    await waitFor(() =>
      expect(screen.getByTestId("unit-picker-status")).toHaveTextContent("Mostrando 20 de 57 unidades. Digite para refinar a busca."),
    );
  });

  it("sem resultados: 'Nenhuma unidade encontrada.'", async () => {
    mockFetch({ search: () => json(200, [], { "X-Total-Count": "0" }) });
    renderPicker();
    expect(await screen.findByText("Nenhuma unidade encontrada.")).toBeInTheDocument();
  });
});

describe("UnitPicker - limpar (campo opcional) e obrigatório", () => {
  it("obrigatório: opção vazia 'Selecione…'; opcional: 'Sem unidade' e escolher volta com null", async () => {
    mockFetch();
    const onPick = vi.fn();
    renderPicker({ optional: true, onPick });
    await waitFor(() => expect(optionNames()).toEqual(["Sem unidade", "Alvorada", "Betim (inativa)", "Brusque"]));
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "6" } });
    expect(screen.getByTestId("value")).toHaveTextContent("6");
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "" } });
    expect(onPick).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId("value")).toHaveTextContent("null");
    expect(screen.getByLabelText("Unidade")).toHaveValue("");
  });

  it("emptyLabel e label personalizados", async () => {
    mockFetch();
    renderPicker({ label: "Público do comunicado", emptyLabel: "Nenhum" });
    await waitFor(() => expect(optionNames("Público do comunicado")[0]).toBe("Nenhum"));
  });

  it("disabled trava busca e select", async () => {
    mockFetch();
    renderPicker({ disabled: true });
    expect(screen.getByLabelText("Buscar unidade")).toBeDisabled();
    expect(screen.getByLabelText("Unidade")).toBeDisabled();
  });
});

describe("UnitPicker - erro", () => {
  it("erro da busca: alerta com a mensagem da API e 'Tentar novamente' refaz a chamada", async () => {
    let fail = true;
    const f = mockFetch({ search: () => (fail ? json(500, { message: "Banco fora." }) : json(200, UNITS, { "X-Total-Count": "3" })) });
    renderPicker();
    expect(await screen.findByRole("alert")).toHaveTextContent("Banco fora.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(optionNames()).toHaveLength(4));
    expect(f.searches().length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("UnitPicker - edição (unidade atual)", () => {
  it("unidade atual FORA dos resultados é resolvido por id (GET /units/:id) e fica selecionado", async () => {
    const f = mockFetch({ search: () => json(200, [UNITS[0]], { "X-Total-Count": "300" }) }); // só a Alvorada vem
    renderPicker({ initialId: 7 });
    expect(await screen.findByRole("option", { name: "Brusque" })).toBeInTheDocument();
    expect(f.byIds()).toEqual(["/units/7"]);
    expect(screen.getByLabelText("Unidade")).toHaveValue("7");
    expect((screen.getByLabelText("Unidade") as HTMLSelectElement).selectedOptions[0]).toHaveTextContent("Brusque");
    expect(optionNames()).toEqual(["Selecione…", "Brusque", "Alvorada"]); // atual primeiro, sem duplicar
  });

  it("unidade atual DENTRO dos resultados não dispara GET por id", async () => {
    const f = mockFetch();
    renderPicker({ initialId: 5 });
    await waitFor(() => expect(optionNames()).toHaveLength(4));
    expect(screen.getByLabelText("Unidade")).toHaveValue("5");
    expect(f.byIds()).toEqual([]);
  });

  it("`initial` (objeto já presente no registro) dispensa o GET por id", async () => {
    const f = mockFetch({ search: () => json(200, [UNITS[0]], { "X-Total-Count": "300" }) });
    renderPicker({ initialId: 7, initial: { id: 7, name: "Brusque" } });
    expect(await screen.findByRole("option", { name: "Brusque" })).toBeInTheDocument();
    await waitFor(() => expect(optionNames()).toHaveLength(3));
    expect(f.byIds()).toEqual([]);
    expect(screen.getByLabelText("Unidade")).toHaveValue("7");
  });

  it("unidade atual fora dos resultados sobrevive a uma nova busca que não o inclui", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetch({ search: (q) => json(200, q ? [] : [UNITS[0]], { "X-Total-Count": q ? "0" : "300" }) });
    renderPicker({ initialId: 7 });
    expect(await screen.findByRole("option", { name: "Brusque" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar unidade"), { target: { value: "xyz" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    await waitFor(() => expect(optionNames()).toEqual(["Selecione…", "Brusque"]));
    expect(screen.getByLabelText("Unidade")).toHaveValue("7");
  });

  it("falha ao resolver o unidade atual: mantém o valor ('Unidade #id') e avisa", async () => {
    mockFetch({
      search: () => json(200, [UNITS[0]], { "X-Total-Count": "300" }),
      byId: () => json(404, { message: "Unidade não encontrada." }),
    });
    renderPicker({ initialId: 99 });
    expect(await screen.findByRole("alert")).toHaveTextContent("Unidade não encontrada.");
    expect(screen.getByRole("option", { name: "Unidade #99" })).toBeInTheDocument();
    expect(screen.getByLabelText("Unidade")).toHaveValue("99");
  });
});

describe("UnitPicker - modo filtro", () => {
  it("rótulos por aria-label, opção 'Todas as unidades' e sem rótulos visíveis; volta a null", async () => {
    mockFetch();
    const onPick = vi.fn();
    renderPicker({ mode: "filter", onPick });
    await waitFor(() => expect(optionNames("Filtrar por unidade")).toEqual(["Todas as unidades", "Alvorada", "Betim (inativa)", "Brusque"]));
    expect(screen.getByLabelText("Buscar unidade")).toHaveAttribute("type", "search");
    expect(document.querySelectorAll("label")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Filtrar por unidade"), { target: { value: "7" } });
    expect(onPick).toHaveBeenLastCalledWith({ id: 7, name: "Brusque", status: "ACTIVE" });
    fireEvent.change(screen.getByLabelText("Filtrar por unidade"), { target: { value: "" } });
    expect(onPick).toHaveBeenLastCalledWith(null);
  });

  it("filtro externo zerado (botão Limpar do pai) volta o select para 'Todas as unidades'", async () => {
    mockFetch();
    function Parent() {
      const [id, setId] = useState<number | null>(6);
      return (
        <>
          <UnitPicker mode="filter" value={id} onChange={(s) => setId(s?.id ?? null)} />
          <button onClick={() => setId(null)}>Limpar</button>
        </>
      );
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Parent />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("Filtrar por unidade")).toHaveValue("6"));
    fireEvent.click(screen.getByText("Limpar"));
    expect(screen.getByLabelText("Filtrar por unidade")).toHaveValue("");
  });
});
