import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { UnidadesPage } from "@/modules/unidades/unidades-page";
import {
  locationOf,
  unitSchema,
  unitToCreatePayload,
  unitToForm,
  unitToUpdatePayload,
  type Unit,
} from "@/modules/unidades/units";
import { clearSession, loginAs } from "./login-as";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const unit = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id, organizationId: 1, name, address: null, city: null, state: null, isMain: false, status: "ACTIVE", ...extra,
});

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body?: unknown;
}

/** fetch falso de GET /units (limit/offset/q + X-Total-Count); registra as chamadas. */
function mockUnits(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const [path = "", search = ""] = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
      const call: Call = {
        method: init.method ?? "GET",
        path,
        query: new URLSearchParams(search),
        body: init.body ? (JSON.parse(init.body as string) as unknown) : undefined,
      };
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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    clearSession();
  });

  it("lista unidades pedindo limit=10 e offset=0 ao servidor; sem sessão (falha fechada) não mostra botões de escrita", async () => {
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

const MATRIZ = unit(1, "Matriz", { isMain: true, address: "Rua Central, 1", city: "Goiânia", state: "GO" });
const FILIAL = unit(2, "Filial Norte", { address: "Av. Norte, 20", city: "Anápolis", state: "GO" });
const ANTIGA = unit(3, "Filial Antiga", { status: "INACTIVE" });
const ALL = [MATRIZ, FILIAL, ANTIGA];

/** GET /units devolve ALL (filtrando status); mutações respondem 200/201 e podem ser sobrescritas. */
function crudApi(overrides: Record<string, (call: Call) => Response> = {}) {
  return mockUnits((call) => {
    const handler = overrides[`${call.method} ${call.path}`];
    if (handler) return handler(call);
    if (call.method === "GET" && call.path === "/units") {
      const status = call.query.get("status");
      const rows = ALL.filter((u) => !status || u.status === status);
      return json(200, rows, { "X-Total-Count": String(rows.length) });
    }
    if (call.method === "POST") return json(201, unit(9, "Nova"));
    return json(200, {});
  });
}
const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

describe("UnidadesPage — CRUD", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    clearSession();
  });

  it("MESTRE vê Nova unidade e as ações por linha (Editar; Definir como matriz/Inativar só em filial ativa; Reativar só em inativa)", async () => {
    loginAs("MESTRE");
    crudApi();
    renderPage();
    await screen.findByText("Filial Norte");
    expect(screen.getByRole("button", { name: /Nova unidade/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Editar" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Definir como matriz" })).toHaveLength(1); // só a filial ATIVA
    expect(screen.getAllByRole("button", { name: "Inativar" })).toHaveLength(1); // matriz não se inativa
    expect(screen.getAllByRole("button", { name: "Reativar" })).toHaveLength(1);
    expect(screen.queryByText(/Somente consulta/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ainda não existe na API/)).not.toBeInTheDocument();
  });

  it("PROFESSOR só visualiza: lista, sem Nova unidade nem ações de escrita (backend: units só view)", async () => {
    loginAs("PROFESSOR");
    crudApi();
    renderPage();
    await screen.findByText("Filial Norte");
    expect(screen.queryByRole("button", { name: /Nova unidade/ })).not.toBeInTheDocument();
    for (const name of ["Editar", "Definir como matriz", "Inativar", "Reativar"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("filtra por situação NO SERVIDOR (status=INACTIVE) e volta à página 1", async () => {
    loginAs("MESTRE");
    const calls = crudApi();
    renderPage();
    await screen.findByText("Filial Norte");
    fireEvent.change(screen.getByLabelText("Filtrar por situação"), { target: { value: "INACTIVE" } });
    await waitFor(() => expect(calls.at(-1)!.query.get("status")).toBe("INACTIVE"));
    expect(calls.at(-1)!.query.get("offset")).toBe("0");
    await waitFor(() => expect(screen.queryByText("Filial Norte")).not.toBeInTheDocument());
    expect(screen.getByText("Filial Antiga")).toBeInTheDocument();
  });

  it("cria: valida o nome e faz POST /units com os campos preenchidos (sem status), avisa e recarrega a lista", async () => {
    loginAs("MESTRE");
    const calls = crudApi();
    renderPage();
    await screen.findByText("Filial Norte");
    fireEvent.click(screen.getByRole("button", { name: /Nova unidade/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText(/mínimo 2 letras/)).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "  Filial Sul  " } });
    fireEvent.change(within(dialog).getByLabelText("Endereço"), { target: { value: "Rua B, 5" } });
    fireEvent.change(within(dialog).getByLabelText("Cidade"), { target: { value: "Salvador" } });
    fireEvent.change(within(dialog).getByLabelText("UF"), { target: { value: "BA" } });
    const gets = calls.filter((c) => c.method === "GET").length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    const post = writes(calls)[0]!;
    expect(post.method).toBe("POST");
    expect(post.path).toBe("/units");
    expect(post.body).toEqual({ name: "Filial Sul", address: "Rua B, 5", city: "Salvador", state: "BA", isMain: false });
    expect(post.body).not.toHaveProperty("status");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Unidade criada."));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThan(gets)); // lista recarregada
  });

  it("cria como matriz: marcar 'Unidade matriz' envia isMain=true; opcionais vazios são omitidos", async () => {
    loginAs("MESTRE");
    const calls = crudApi();
    renderPage();
    await screen.findByText("Filial Norte");
    fireEvent.click(screen.getByRole("button", { name: /Nova unidade/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Nova Sede" } });
    fireEvent.click(within(dialog).getByLabelText("Unidade matriz"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ name: "Nova Sede", isMain: true });
  });

  it("edita: carrega os valores e PATCH só com nome/endereço/cidade/UF (sem isMain/status quando não mudam)", async () => {
    loginAs("MESTRE");
    const calls = crudApi();
    renderPage();
    await screen.findByText("Filial Norte");
    const row = screen.getByText("Filial Norte").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Nome")).toHaveValue("Filial Norte"));
    expect(within(dialog).getByLabelText("UF")).toHaveValue("GO");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Filial Norte 2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({
      method: "PATCH",
      path: "/units/2",
      body: { name: "Filial Norte 2", address: "Av. Norte, 20", city: "Anápolis", state: "GO" },
    });
    expect(writes(calls)[0]!.body).not.toHaveProperty("isMain");
    expect(writes(calls)[0]!.body).not.toHaveProperty("status");
  });

  it("edita: esvaziar endereço, cidade e UF envia null (limpa no servidor)", async () => {
    loginAs("MESTRE");
    const calls = crudApi();
    renderPage();
    await screen.findByText("Filial Norte");
    fireEvent.click(within(screen.getByText("Filial Norte").closest("tr")!).getByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Cidade")).toHaveValue("Anápolis"));
    fireEvent.change(within(dialog).getByLabelText("Endereço"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Cidade"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("UF"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ name: "Filial Norte", address: null, city: null, state: null });
  });

  it("matriz atual: o interruptor de matriz e a situação ficam travados no formulário", async () => {
    loginAs("MESTRE");
    crudApi();
    renderPage();
    await screen.findByText("Filial Norte");
    const matrizRow = screen.getAllByText("Matriz", { selector: "span" })[0]!.closest("tr")!;
    fireEvent.click(within(matrizRow).getByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Nome")).toHaveValue("Matriz"));
    expect(within(dialog).getByLabelText("Unidade matriz")).toBeDisabled();
    expect(within(dialog).getByLabelText("Situação")).toBeDisabled();
    expect(within(dialog).getByText(/marque OUTRA unidade como matriz/)).toBeInTheDocument();
  });

  it("'Definir como matriz' pede confirmação e faz PATCH { isMain: true }", async () => {
    loginAs("MESTRE");
    const calls = crudApi();
    renderPage();
    await screen.findByText("Filial Norte");
    fireEvent.click(screen.getByRole("button", { name: "Definir como matriz" }));
    const alert = await screen.findByRole("alertdialog");
    expect(alert).toHaveTextContent("Filial Norte");
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(within(alert).getByRole("button", { name: "Definir como matriz" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ method: "PATCH", path: "/units/2", body: { isMain: true } });
  });

  it("inativa com confirmação (DELETE /units/:id) e reativa com PATCH { status: 'ACTIVE' }", async () => {
    loginAs("MESTRE");
    const calls = crudApi();
    renderPage();
    await screen.findByText("Filial Norte");
    fireEvent.click(screen.getByRole("button", { name: "Inativar" }));
    const alert = await screen.findByRole("alertdialog");
    expect(alert).toHaveTextContent("histórico");
    fireEvent.click(within(alert).getByRole("button", { name: "Inativar" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ method: "DELETE", path: "/units/2" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Unidade inativada."));

    fireEvent.click(await screen.findByRole("button", { name: "Reativar" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[1]).toMatchObject({ method: "PATCH", path: "/units/3", body: { status: "ACTIVE" } });
  });

  it("erro do servidor (limite do plano) aparece em toast e o formulário continua aberto", async () => {
    loginAs("MESTRE");
    crudApi({ "POST /units": () => json(403, { message: 'Limite de 2 unidade(s) ativa(s) do plano "Pro" atingido.' }) });
    renderPage();
    await screen.findByText("Filial Norte");
    fireEvent.click(screen.getByRole("button", { name: /Nova unidade/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Terceira" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Limite de 2 unidade(s) ativa(s) do plano "Pro" atingido.'));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("erro 409 ao inativar mostra a mensagem e mantém a confirmação aberta", async () => {
    loginAs("MESTRE");
    crudApi({ "DELETE /units/2": () => json(409, { message: "Não é possível inativar a única unidade ativa do grupo." }) });
    renderPage();
    await screen.findByText("Filial Norte");
    fireEvent.click(screen.getByRole("button", { name: "Inativar" }));
    const alert = await screen.findByRole("alertdialog");
    fireEvent.click(within(alert).getByRole("button", { name: "Inativar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Não é possível inativar a única unidade ativa do grupo."));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});

describe("units.ts — schema e payloads", () => {
  const base: Unit = { id: 5, organizationId: 1, name: "Filial", address: "Rua", city: "Goiânia", state: "GO", isMain: false, status: "ACTIVE" };

  it("schema: nome mínimo 2, UF só das 27 siglas (ou vazio)", () => {
    const ok = { name: "Ab", address: "", city: "", state: "", isMain: false, status: "ACTIVE" as const };
    expect(unitSchema.safeParse(ok).success).toBe(true);
    expect(unitSchema.safeParse({ ...ok, name: "A" }).success).toBe(false);
    expect(unitSchema.safeParse({ ...ok, state: "SP" }).success).toBe(true);
    expect(unitSchema.safeParse({ ...ok, state: "XX" }).success).toBe(false);
    expect(unitSchema.safeParse({ ...ok, state: "go" }).success).toBe(false);
  });

  it("criar omite vazios e nunca envia status", () => {
    const empty = { name: " Filial ", address: " ", city: "", state: "", isMain: false, status: "ACTIVE" as const };
    expect(unitToCreatePayload(empty)).toEqual({ name: "Filial", address: undefined, city: undefined, state: undefined, isMain: false });
    expect(unitToCreatePayload(empty)).not.toHaveProperty("status");
  });

  it("editar: vazios viram null; isMain só quando passa a true; status só quando muda", () => {
    const form = unitToForm(base);
    expect(unitToUpdatePayload({ ...form, address: "", city: " ", state: "" }, base)).toEqual({ name: "Filial", address: null, city: null, state: null });
    expect(unitToUpdatePayload({ ...form, isMain: true }, base)).toMatchObject({ isMain: true });
    const main = { ...base, isMain: true };
    expect(unitToUpdatePayload(unitToForm(main), main)).not.toHaveProperty("isMain"); // nunca reenvia o valor igual
    expect(unitToUpdatePayload({ ...form, status: "INACTIVE" }, base)).toMatchObject({ status: "INACTIVE" });
    expect(unitToUpdatePayload(form, base)).not.toHaveProperty("status");
  });

  it("locationOf junta cidade e UF", () => {
    expect(locationOf(base)).toBe("Goiânia / GO");
    expect(locationOf({ ...base, city: null, state: null })).toBe("-");
  });
});
