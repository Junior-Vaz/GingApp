import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UnidadesPage } from "@/modules/unidades/unidades-page";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

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

  it("lista unidades (somente leitura, sem botões de escrita)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, [
        { id: 2, organizationId: 1, name: "Filial Sul", address: "Rua A, 10", city: "Salvador", state: "BA", isMain: false, status: "INACTIVE" },
        { id: 1, organizationId: 1, name: "Matriz", address: null, city: null, state: null, isMain: true, status: "ACTIVE" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    expect(await screen.findByText("Filial Sul")).toBeInTheDocument();
    expect(screen.getByText("Salvador / BA")).toBeInTheDocument();
    expect(screen.getByText("Ativa")).toBeInTheDocument();
    expect(screen.getByText("Inativa")).toBeInTheDocument();
    expect(screen.getAllByText("Matriz").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /nov|editar|excluir/i })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string])[0]).toMatch(/\/units$/);
  });

  it("erro do backend aparece com Tentar novamente", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(500, { message: "Falhou." })));
    renderPage();
    expect(await screen.findByText("Falhou.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });
});
