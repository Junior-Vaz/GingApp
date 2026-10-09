import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UnidadesPage } from "@/modules/unidades/unidades-page";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const unit = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id, organizationId: 1, name, address: null, city: null, state: null, isMain: false, status: "ACTIVE", ...extra,
});

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
}

/** fetch falso de GET /units (limit/offset/q + X-Total-Count); registra as chamadas. */
function mockUnits(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const [path = "", search = ""] = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
      const call: Call = { method: init.method ?? "GET", path, query: new URLSearchParams(search) };
      calls.push(call);
      return Promise.resolve(handler(call));
    }),
  );
  return calls;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UnidadesPage />
    </QueryClientProvider>,
  );
}

describe("UnidadesPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lista unidades (somente leitura, sem botões de escrita) pedindo limit=10 e offset=0 ao servidor", async () => {
    const rows = [
      unit(2, "Filial Sul", { address: "Rua A, 10", city: "Salvador", state: "BA", status: "INACTIVE" }),
      unit(1, "Matriz", { isMain: true }),
    ];
    const calls = mockUnits(() => json(200, rows, { "X-Total-Count": "2" }));
    renderPage();
    expect(await screen.findByText("Filial Sul")).toBeInTheDocument();
    expect(screen.getByText("Salvador / BA")).toBeInTheDocument();
    expect(screen.getByText("Ativa")).toBeInTheDocument();
    expect(screen.getByText("Inativa")).toBeInTheDocument();
    expect(screen.getAllByText("Matriz").length).toBeGreaterThan(0);
    expect(screen.getByTestId("table-count")).toHaveTextContent("2 registros");
    expect(screen.queryByRole("button", { name: /nov|editar|excluir/i })).not.toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/units");
    expect(calls[0]!.query.get("limit")).toBe("10");
    expect(calls[0]!.query.get("offset")).toBe("0");
    expect(calls[0]!.query.has("q")).toBe(false);
  });

  it("pagina no servidor: mais de 50 unidades, total do header e offset da página 2", async () => {
    const many = Array.from({ length: 120 }, (_, i) => unit(i + 1, `Unidade ${String(i + 1).padStart(3, "0")}`));
    const calls = mockUnits((c) => {
      const offset = Number(c.query.get("offset") ?? 0);
      const limit = Number(c.query.get("limit") ?? 50);
      return json(200, many.slice(offset, offset + limit), { "X-Total-Count": String(many.length) });
    });
    renderPage();
    expect(await screen.findByText("Unidade 001")).toBeInTheDocument();
    expect(screen.getByTestId("table-count")).toHaveTextContent("120 registros"); // não trava nas 50 primeiras
    expect(screen.getByText("Página 1 de 12")).toBeInTheDocument();
    expect(screen.queryByTestId("table-limit-warning")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Próxima página"));
    expect(await screen.findByText("Unidade 011")).toBeInTheDocument();
    expect(screen.queryByText("Unidade 001")).not.toBeInTheDocument();
    expect(calls.at(-1)!.query.get("offset")).toBe("10");
    expect(screen.getByText("Página 2 de 12")).toBeInTheDocument();
  });

  it("busca no servidor com debounce: 2 digitações = 1 GET com q, volta à página 1", async () => {
    const many = [...Array.from({ length: 25 }, (_, i) => unit(i + 1, `Filial ${i + 1}`)), unit(500, "Zeta Distante")];
    const calls = mockUnits((c) => {
      const q = (c.query.get("q") ?? "").toLowerCase();
      const found = many.filter((u) => u.name.toLowerCase().includes(q));
      const offset = Number(c.query.get("offset") ?? 0);
      const limit = Number(c.query.get("limit") ?? 50);
      return json(200, found.slice(offset, offset + limit), { "X-Total-Count": String(found.length) });
    });
    renderPage();
    await screen.findByText("Filial 1");
    fireEvent.click(screen.getByLabelText("Próxima página"));
    await waitFor(() => expect(calls.at(-1)!.query.get("offset")).toBe("10"));

    const before = calls.length;
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "ze" } });
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "zeta" } });
    expect(calls.length).toBe(before); // dentro do debounce de 300ms: nenhuma chamada
    await waitFor(() => expect(calls.at(-1)!.query.get("q")).toBe("zeta"));
    expect(calls.filter((c) => c.query.has("q"))).toHaveLength(1);
    expect(calls.at(-1)!.query.get("offset")).toBe("0");
    expect(calls.at(-1)!.query.get("limit")).toBe("10");
    expect(await screen.findByText("Zeta Distante")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Filial 1")).not.toBeInTheDocument());
    expect(screen.getByTestId("table-count")).toHaveTextContent("1 registro");
  });

  it("busca sem resultado mostra a mensagem de vazio da busca", async () => {
    mockUnits((c) => (c.query.get("q") ? json(200, [], { "X-Total-Count": "0" }) : json(200, [unit(1, "Matriz")], { "X-Total-Count": "1" })));
    renderPage();
    await screen.findByText("Matriz");
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "xyz" } });
    expect(await screen.findByTestId("table-empty")).toHaveTextContent("Nenhum resultado para a busca.");
  });

  it("estado vazio sem busca", async () => {
    mockUnits(() => json(200, [], { "X-Total-Count": "0" }));
    renderPage();
    expect(await screen.findByTestId("table-empty")).toHaveTextContent("Nenhuma unidade cadastrada.");
  });

  it("erro do backend aparece com Tentar novamente, que refaz o GET", async () => {
    let fail = true;
    const calls = mockUnits(() => (fail ? json(500, { message: "Falhou." }) : json(200, [unit(1, "Matriz")], { "X-Total-Count": "1" })));
    renderPage();
    expect(await screen.findByText("Falhou.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Matriz")).toBeInTheDocument();
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
});
