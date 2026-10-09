import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api, buildQuery } from "@/lib/api";
import { createCrud } from "@/lib/crud";
import { useListParams } from "@/lib/list-params";
import { DataTable, type Column } from "@/components/painel/data-table";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const urlOf = (fetchMock: ReturnType<typeof vi.fn>, n: number) => (fetchMock.mock.calls[n] as [string])[0];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("api.getPage / buildQuery", () => {
  it("buildQuery ignora undefined, null e vazio", () => {
    expect(buildQuery({ a: 1, b: "", c: undefined, d: null, e: "x y", f: 0, g: false })).toBe(
      "?a=1&e=x+y&f=0&g=false",
    );
    expect(buildQuery({ a: undefined })).toBe("");
    expect(buildQuery()).toBe("");
  });

  it("lê o total do header X-Total-Count e monta a query string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, [{ id: 1 }, { id: 2 }], { "X-Total-Count": "137" }));
    vi.stubGlobal("fetch", fetchMock);
    const page = await api.getPage<{ id: number }>("/students", { limit: 10, offset: 20, q: "", status: undefined });
    expect(page).toEqual({ items: [{ id: 1 }, { id: 2 }], total: 137 });
    expect(urlOf(fetchMock, 0)).toMatch(/\/students\?limit=10&offset=20$/);
  });

  it("sem header (ou inválido) o total é items.length", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, [{ id: 1 }, { id: 2 }, { id: 3 }])));
    await expect(api.getPage("/x")).resolves.toMatchObject({ total: 3 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, [{ id: 1 }], { "X-Total-Count": "abc" })));
    await expect(api.getPage("/x")).resolves.toMatchObject({ total: 1 });
  });

  it("erro HTTP vira ApiError com a mensagem do backend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(400, { message: ["limit must not be greater than 200"] })));
    await expect(api.getPage("/x", { limit: 999 })).rejects.toMatchObject({
      status: 400,
      message: "limit must not be greater than 200",
    });
  });
});

describe("createCrud.usePage", () => {
  interface Thing {
    id: number;
  }
  const things = createCrud<Thing, { name: string }>("/things");
  const wrapper = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };

  it("devolve items/total, mantém a página anterior ao trocar params e invalida após create", async () => {
    let resolveP2: (r: Response) => void = () => {};
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(json(201, { id: 9 }));
      if (url.includes("offset=10")) return new Promise<Response>((res) => (resolveP2 = res));
      return Promise.resolve(json(200, [{ id: 1 }], { "X-Total-Count": "42" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(
      ({ offset }) => ({ page: things.usePage({ limit: 10, offset }), create: things.useCreate() }),
      { wrapper: wrapper(), initialProps: { offset: 0 } },
    );
    await waitFor(() => expect(result.current.page.items).toEqual([{ id: 1 }]));
    expect(result.current.page.total).toBe(42);
    expect(urlOf(fetchMock as never, 0)).toMatch(/\/things\?limit=10&offset=0$/);

    rerender({ offset: 10 });
    // keepPreviousData: enquanto a página 2 carrega, a 1 continua visível (sem piscar)
    await waitFor(() => expect(result.current.page.isFetching).toBe(true));
    expect(result.current.page.items).toEqual([{ id: 1 }]);
    expect(result.current.page.isLoading).toBe(false);
    resolveP2(json(200, [{ id: 11 }], { "X-Total-Count": "42" }));
    await waitFor(() => expect(result.current.page.items).toEqual([{ id: 11 }]));

    const before = fetchMock.mock.calls.length;
    await act(async () => {
      await result.current.create.mutateAsync({ name: "n" });
    });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before + 1)); // POST + refetch
  });

  it("queryKey inclui os params (params diferentes = novas requisições)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, [], { "X-Total-Count": "0" }));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = renderHook(({ q }) => things.usePage({ q }), {
      wrapper: wrapper(),
      initialProps: { q: "a" },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender({ q: "b" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(urlOf(fetchMock, 1)).toMatch(/\?q=b$/);
  });
});

describe("useListParams", () => {
  it("monta limit/offset, ignora vazios e volta à página 0 ao mudar busca/filtro", () => {
    const { result } = renderHook(() => useListParams({ pageSize: 20, filters: { status: "" } }));
    expect(result.current.params).toEqual({ status: "", q: "", limit: 20, offset: 0 });
    act(() => result.current.setPage(3));
    expect(result.current.params).toMatchObject({ limit: 20, offset: 60 });
    act(() => result.current.setFilter("status", "ACTIVE"));
    expect(result.current.params).toMatchObject({ status: "ACTIVE", offset: 0 });
    act(() => result.current.setPage(2));
    act(() => result.current.setQuery(" ana "));
    expect(result.current.params).toMatchObject({ q: "ana", offset: 0 });
    expect(buildQuery(result.current.params)).toBe("?status=ACTIVE&q=ana&limit=20&offset=0");
  });
});

interface Row {
  id: number;
  name: string;
}
const columns: Column<Row>[] = [{ id: "name", header: "Nome", sortValue: (r) => r.name }];

function ServerHarness({ total = 95, onState }: { total?: number; onState?: (s: { page: number; q: string }) => void }) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  onState?.({ page, q: query });
  const data = Array.from({ length: 10 }, (_, i) => ({ id: page * 10 + i, name: `Linha ${page * 10 + i}` }));
  return (
    <DataTable
      columns={columns}
      data={data}
      getRowId={(r) => r.id}
      searchText={(r) => r.name}
      server={{ total, page, pageSize: 10, onPageChange: setPage, query, onQueryChange: setQuery }}
    />
  );
}

describe("DataTable modo servidor", () => {
  beforeEach(() => vi.useFakeTimers());

  it("usa o total do servidor, não pagina localmente e não mostra o aviso de teto de 50", () => {
    render(<ServerHarness total={95} />);
    expect(screen.getByTestId("table-count")).toHaveTextContent("95 registros");
    expect(screen.getByText("Página 1 de 10")).toBeInTheDocument();
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(10);
    expect(screen.queryByTestId("table-limit-warning")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Próxima página"));
    expect(screen.getByText("Página 2 de 10")).toBeInTheDocument();
    expect(screen.getByText("Linha 10")).toBeInTheDocument();
    expect(screen.getByLabelText("Página anterior")).not.toBeDisabled();
  });

  it("busca com debounce de 300ms e volta à página 1", () => {
    const states: { page: number; q: string }[] = [];
    render(<ServerHarness onState={(s) => states.push(s)} />);
    fireEvent.click(screen.getByLabelText("Próxima página"));
    fireEvent.click(screen.getByLabelText("Próxima página"));
    expect(screen.getByText("Página 3 de 10")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "an" } });
    act(() => void vi.advanceTimersByTime(200));
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "ana" } });
    act(() => void vi.advanceTimersByTime(200));
    expect(states.at(-1)).toEqual({ page: 2, q: "" }); // ainda dentro do debounce
    act(() => void vi.advanceTimersByTime(150));
    expect(states.at(-1)).toEqual({ page: 0, q: "ana" });
    expect(states.filter((s) => s.q !== "")).toSatisfy((l: unknown[]) => l.every((s) => (s as { q: string }).q === "ana"));
    expect(screen.getByText("Página 1 de 10")).toBeInTheDocument();
  });

  it("ordena localmente só a página corrente", () => {
    render(<ServerHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Nome" }));
    fireEvent.click(screen.getByRole("button", { name: "Nome" }));
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Linha 9"); // desc dentro de 0..9
    expect(screen.getByText("Página 1 de 10")).toBeInTheDocument();
  });

  it("corrige a página quando ela sai do intervalo (total encolheu)", () => {
    const seen: number[] = [];
    function Shrinking() {
      const [page, setPage] = useState(4);
      seen.push(page);
      return (
        <DataTable
          columns={columns}
          data={[{ id: 1, name: "x" }]}
          getRowId={(r) => r.id}
          server={{ total: 21, page, pageSize: 10, onPageChange: setPage }}
        />
      );
    }
    render(<Shrinking />);
    expect(seen.at(-1)).toBe(2);
    expect(screen.getByText("Página 3 de 3")).toBeInTheDocument();
  });
});
