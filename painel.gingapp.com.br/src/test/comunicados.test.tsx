import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { ComunicadosPage } from "@/modules/comunicados/comunicados-page";
import { saveSession, clearSession, type AuthUser } from "@/lib/session";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const urlPath = (url: string) => url.replace(/^https?:\/\/[^/]+\/api/, "").split("?")[0]!;
const urlQuery = (url: string) => new URLSearchParams(url.split("?")[1] ?? "");
const user = (role: AuthUser["role"]): AuthUser => ({
  id: 1, name: "M", email: "m@x.com", userType: "MEMBER", isSuperAdmin: false,
  organizationId: 1, organizationSlug: "g", role,
});

const ANNOUNCEMENTS = [
  { id: 1, unitId: null, title: "Feriado", body: "Sem aula na segunda", publishedAt: "2026-10-01T12:00:00.000Z", isActive: true, createdAt: "2026-10-01T12:00:00.000Z" },
  { id: 2, unitId: 7, title: "Roda extra", body: "Sábado na matriz", publishedAt: null, isActive: false, createdAt: "2026-10-02T12:00:00.000Z" },
];
const unit = (id: number, name: string) => ({ id, organizationId: 1, name, address: null, city: null, state: null, isMain: id === 7, status: "ACTIVE" });
const UNITS = [unit(7, "Matriz"), unit(8, "Filial Norte")];

/** fetch falso: /announcements, busca /units?q&limit (filtra por q) e /units/:id (404 se não existir). */
function mountFetch() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = urlPath(url);
    if (method === "GET" && path === "/announcements")
      return Promise.resolve(json(200, ANNOUNCEMENTS, { "X-Total-Count": String(ANNOUNCEMENTS.length) }));
    if (method === "GET" && path === "/units") {
      const q = (urlQuery(url).get("q") ?? "").toLowerCase();
      const rows = UNITS.filter((u) => u.name.toLowerCase().includes(q));
      return Promise.resolve(json(200, rows, { "X-Total-Count": String(rows.length) }));
    }
    const byId = method === "GET" ? /^\/units\/(\d+)$/.exec(path) : null;
    if (byId) {
      const found = UNITS.find((u) => u.id === Number(byId[1]));
      return Promise.resolve(found ? json(200, found) : json(404, { message: "Unidade não encontrada." }));
    }
    return Promise.resolve(json(200, { id: 9 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ComunicadosPage />
    </QueryClientProvider>,
  );
}

const calls = (m: ReturnType<typeof mountFetch>, method: string) =>
  m.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method) as Array<[string, RequestInit]>;
const unitSearches = (m: ReturnType<typeof mountFetch>) =>
  calls(m, "GET").map(([url]) => url.replace(/^https?:\/\/[^/]+\/api/, "")).filter((u) => u.startsWith("/units?"));
const unitByIds = (m: ReturnType<typeof mountFetch>) =>
  calls(m, "GET").map(([url]) => urlPath(url)).filter((p) => /^\/units\/\d+$/.test(p));
const selectOptions = (el: HTMLElement) => Array.from((el as HTMLSelectElement).options).map((o) => o.textContent);

describe("ComunicadosPage", () => {
  beforeEach(() => {
    saveSession("tok", user("MESTRE"));
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    clearSession();
  });

  it("lista comunicados com público (grupo/unidade) e situação", async () => {
    mountFetch();
    renderPage();
    await screen.findByText("Feriado");
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Todo o grupo")).toBeInTheDocument();
    await waitFor(() => expect(table.getAllByText("Matriz").length).toBeGreaterThan(0));
    expect(screen.getByText("Ativo")).toBeInTheDocument();
    expect(screen.getByText("Inativo")).toBeInTheDocument();
  });

  it("valida mínimo de 2 caracteres e publica com POST (unitId null = grupo)", async () => {
    const fetchMock = mountFetch();
    renderPage();
    await screen.findByText("Feriado");
    fireEvent.click(screen.getByRole("button", { name: /novo comunicado/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText(/Informe o título/)).toBeInTheDocument();
    expect(calls(fetchMock, "POST")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Aviso" } });
    fireEvent.change(within(dialog).getByLabelText("Texto"), { target: { value: "Reunião de pais" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls(fetchMock, "POST")).toHaveLength(1));
    const [url, init] = calls(fetchMock, "POST")[0]!;
    expect(url).toMatch(/\/announcements$/);
    expect(JSON.parse(init.body as string)).toEqual({ title: "Aviso", body: "Reunião de pais", unitId: null });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("editar envia PATCH com isActive; Desativar confirma e faz DELETE (MESTRE)", async () => {
    const fetchMock = mountFetch();
    renderPage();
    await screen.findByText("Feriado");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Feriado 2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls(fetchMock, "PATCH")).toHaveLength(1));
    const [url, init] = calls(fetchMock, "PATCH")[0]!;
    expect(url).toMatch(/\/announcements\/1$/);
    expect(JSON.parse(init.body as string)).toMatchObject({ title: "Feriado 2", unitId: null, isActive: true });

    // Só o comunicado ativo (id 1) oferece "Desativar".
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Desativar" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Desativar" }));
    await waitFor(() => expect(calls(fetchMock, "DELETE")).toHaveLength(1));
    expect(calls(fetchMock, "DELETE")[0]![0]).toMatch(/\/announcements\/1$/);
  });

  it("PROFESSOR não vê o botão Desativar (sem announcements:delete)", async () => {
    saveSession("tok", user("PROFESSOR"));
    mountFetch();
    renderPage();
    await screen.findByText("Feriado");
    expect(screen.queryByRole("button", { name: "Desativar" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Editar" })).toHaveLength(2);
  });

  it("envia limit/offset ao servidor e mostra o total; filtros e busca (debounce) vão como query", async () => {
    const fetchMock = mountFetch();
    renderPage();
    await screen.findByText("Feriado");
    const gets = () =>
      calls(fetchMock, "GET").map(([url]) => ({ path: urlPath(url), query: urlQuery(url) })).filter((c) => c.path === "/announcements");
    const first = gets()[0]!;
    expect(first.query.get("limit")).toBe("10");
    expect(first.query.get("offset")).toBe("0");
    for (const key of ["q", "isActive", "unitId"]) expect(first.query.has(key)).toBe(false);
    expect(screen.getByTestId("table-count")).toHaveTextContent("2 registros");
    expect(screen.queryByTestId("table-limit-warning")).not.toBeInTheDocument();
    // o seletor de unidade busca no servidor (limit=20, sem q) em vez de carregar a lista de 200
    await waitFor(() => expect(unitSearches(fetchMock)).toEqual(["/units?limit=20"]));
    expect(unitSearches(fetchMock).some((u) => u.includes("limit=200"))).toBe(false);

    fireEvent.change(screen.getByLabelText("Filtrar por situação"), { target: { value: "false" } });
    await waitFor(() => expect(gets().at(-1)!.query.get("isActive")).toBe("false"));
    await waitFor(() => expect(screen.getAllByRole("option", { name: "Matriz" }).length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Filtrar por unidade"), { target: { value: "7" } });
    await waitFor(() => expect(gets().at(-1)!.query.get("unitId")).toBe("7"));
    expect(gets().at(-1)!.query.get("isActive")).toBe("false");
    // voltar para "Todas as unidades" remove o filtro da URL (os outros filtros ficam)
    fireEvent.change(screen.getByLabelText("Filtrar por unidade"), { target: { value: "" } });
    await waitFor(() => expect(gets().at(-1)!.query.has("unitId")).toBe(false));
    expect(gets().at(-1)!.query.get("isActive")).toBe("false");
    fireEvent.change(screen.getByLabelText("Filtrar por unidade"), { target: { value: "7" } });
    await waitFor(() => expect(gets().at(-1)!.query.get("unitId")).toBe("7"));

    const before = gets().length;
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "Fe" } });
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "Feriado" } });
    expect(gets().length).toBe(before);
    await waitFor(() => expect(gets().at(-1)!.query.get("q")).toBe("Feriado"));
    expect(gets().filter((c) => c.query.has("q"))).toHaveLength(1);
  });

  it("filtro por unidade busca no servidor: debounce de 300ms, q e limit=20; a unidade escolhida segue selecionada", async () => {
    const fetchMock = mountFetch();
    renderPage();
    await screen.findByText("Feriado");
    await waitFor(() =>
      expect(selectOptions(screen.getByLabelText("Filtrar por unidade"))).toEqual(["Todas as unidades", "Matriz", "Filial Norte"]),
    );
    fireEvent.change(screen.getByLabelText("Filtrar por unidade"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Buscar unidade"), { target: { value: "ma" } });
    fireEvent.change(screen.getByLabelText("Buscar unidade"), { target: { value: "matr" } });
    expect(unitSearches(fetchMock)).toEqual(["/units?limit=20"]); // ainda dentro do debounce
    await waitFor(() => expect(unitSearches(fetchMock)).toEqual(["/units?limit=20", "/units?q=matr&limit=20"]));
    // a Filial Norte (escolhida) não casa com "matr" mas continua na lista e selecionada
    await waitFor(() =>
      expect(selectOptions(screen.getByLabelText("Filtrar por unidade"))).toEqual(["Todas as unidades", "Filial Norte", "Matriz"]),
    );
    expect(screen.getByLabelText("Filtrar por unidade")).toHaveValue("8");
  });

  it("mais de 20 unidades: o seletor avisa para refinar a busca (não existe mais o aviso dos 200 primeiros)", async () => {
    const fetchMock = mountFetch();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      urlPath(url) === "/units" ? Promise.resolve(json(200, UNITS, { "X-Total-Count": "260" })) : original(url, init),
    );
    renderPage();
    await screen.findByText("Feriado");
    fireEvent.click(screen.getByRole("button", { name: /novo comunicado/i }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByTestId("unit-picker-status")).toHaveTextContent("Mostrando 20 de 260 unidades"),
    );
  });

  it("publicar para uma unidade escolhida no seletor envia unitId numérico", async () => {
    const fetchMock = mountFetch();
    renderPage();
    await screen.findByText("Feriado");
    fireEvent.click(screen.getByRole("button", { name: /novo comunicado/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Aviso" } });
    fireEvent.change(within(dialog).getByLabelText("Texto"), { target: { value: "Só a filial" } });
    expect(selectOptions(within(dialog).getByLabelText("Público"))[0]).toBe("Todo o grupo"); // padrão
    await waitFor(() => expect(selectOptions(within(dialog).getByLabelText("Público"))).toContain("Filial Norte"));
    fireEvent.change(within(dialog).getByLabelText("Público"), { target: { value: "8" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls(fetchMock, "POST")).toHaveLength(1));
    expect(JSON.parse(calls(fetchMock, "POST")[0]![1].body as string)).toEqual({ title: "Aviso", body: "Só a filial", unitId: 8 });
  });

  it("editar um comunicado de unidade e voltar ao grupo inteiro envia unitId null", async () => {
    const fetchMock = mountFetch();
    renderPage();
    await screen.findByText("Roda extra");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[1]!); // id 2, unitId 7
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Título")).toHaveValue("Roda extra"));
    const publico = within(dialog).getByLabelText("Público") as HTMLSelectElement;
    await waitFor(() => expect(publico.selectedOptions[0]).toHaveTextContent("Matriz"));
    fireEvent.change(publico, { target: { value: "" } });
    expect(publico.selectedOptions[0]).toHaveTextContent("Todo o grupo");
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls(fetchMock, "PATCH")).toHaveLength(1));
    const [url, init] = calls(fetchMock, "PATCH")[0]!;
    expect(url).toMatch(/\/announcements\/2$/);
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toHaveProperty("unitId", null);
    // title/body/isActive obrigatórios: nunca null
    expect(body).toMatchObject({ title: "Roda extra", body: "Sábado na matriz", isActive: false });
  });

  it("edição com unidade fora dos 20 resultados: resolve por GET /units/:id (1 só, cache da coluna) e preserva o unitId", async () => {
    const fetchMock = mountFetch();
    const original = fetchMock.getMockImplementation()!;
    const FORA = unit(99, "Filial Distante");
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && urlPath(url) === "/announcements")
        return Promise.resolve(json(200, [{ ...ANNOUNCEMENTS[1]!, unitId: 99 }], { "X-Total-Count": "1" }));
      if (method === "GET" && urlPath(url) === "/units/99") return Promise.resolve(json(200, FORA));
      if (method === "GET" && urlPath(url) === "/units") return Promise.resolve(json(200, UNITS, { "X-Total-Count": "300" }));
      return original(url, init);
    });
    renderPage();
    await screen.findByText("Roda extra");
    expect(await within(screen.getByRole("table")).findByText("Filial Distante")).toBeInTheDocument(); // coluna Público
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog");
    const publico = within(dialog).getByLabelText("Público") as HTMLSelectElement;
    await waitFor(() => expect(publico.selectedOptions[0]).toHaveTextContent("Filial Distante"));
    expect(publico).toHaveValue("99");
    expect(unitByIds(fetchMock)).toEqual(["/units/99"]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls(fetchMock, "PATCH")).toHaveLength(1));
    expect(JSON.parse(calls(fetchMock, "PATCH")[0]![1].body as string)).toMatchObject({ unitId: 99 });
  });

  it("erro ao buscar unidades aparece no seletor do formulário e 'Tentar novamente' recarrega", async () => {
    const fetchMock = mountFetch();
    const original = fetchMock.getMockImplementation()!;
    let fail = true;
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      urlPath(url) === "/units" && fail ? Promise.resolve(json(500, { message: "Banco fora." })) : original(url, init),
    );
    renderPage();
    await screen.findByText("Feriado");
    fireEvent.click(screen.getByRole("button", { name: /novo comunicado/i }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Banco fora.");
    fail = false;
    fireEvent.click(within(dialog).getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(selectOptions(within(dialog).getByLabelText("Público"))).toContain("Matriz"));
  });

  it("erro 400 do PATCH aparece em toast e mantém o diálogo aberto", async () => {
    const fetchMock = mountFetch();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      (init?.method ?? "GET") === "PATCH"
        ? Promise.resolve(json(400, { message: ["unitId must be an integer number"] }))
        : original(url, init),
    );
    renderPage();
    await screen.findByText("Feriado");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("unitId must be an integer number"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("erro 403 do backend vira toast e mantém o diálogo aberto", async () => {
    const fetchMock = mountFetch();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") return Promise.resolve(json(403, { message: "Sem permissão." }));
      return Promise.resolve(json(200, urlPath(url) === "/units" ? UNITS : ANNOUNCEMENTS, { "X-Total-Count": "2" }));
    });
    renderPage();
    await screen.findByText("Feriado");
    fireEvent.click(screen.getByRole("button", { name: /novo comunicado/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Aviso" } });
    fireEvent.change(within(dialog).getByLabelText("Texto"), { target: { value: "Texto" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Sem permissão."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
