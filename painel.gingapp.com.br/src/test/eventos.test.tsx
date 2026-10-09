import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { EventosPage } from "@/modules/eventos";
import { clearSession, loginAs } from "./login-as";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// jsdom não tem ResizeObserver (usado pelo Switch do Radix).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const EVENT = {
  id: 7,
  unitId: null,
  title: "Batizado 2026",
  description: "Grande roda",
  date: "2026-11-20T22:00:00.000Z",
  location: "Quadra central",
  isPublic: true,
  type: "BATIZADO",
  stateId: null,
  cityId: null,
  imageUrl: "https://exemplo.com/capa.png",
};

const STUDENTS = [
  { id: 11, name: "Ana Souza" },
  { id: 12, name: "Bruno Lima" },
];

/** O que a busca padrão (GET /units?limit=20) devolve; ALL_UNITS inclui unidades que só aparecem por q ou por id. */
const UNITS = [{ id: 3, name: "Sede" }];
const ALL_UNITS = [...UNITS, { id: 99, name: "Filial Distante" }, { id: 250, name: "Zeta Distante" }];

let calls: Call[];
let events: unknown[];
let participants: unknown[];
let overrides: Record<string, () => Response>;

function installFetch() {
  calls = [];
  const handler = (input: string, init?: RequestInit): Response => {
    const [path = "", search = ""] = input.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    calls.push({ method, path, query: new URLSearchParams(search), body });
    const key = `${method} ${path}`;
    const override = overrides[key];
    if (override) return override();
    if (key === "GET /events") return json(200, events, { "X-Total-Count": String(events.length) });
    if (key === "GET /units") {
      const q = (new URLSearchParams(search).get("q") ?? "").toLowerCase();
      const rows = UNITS.filter((u) => u.name.toLowerCase().includes(q));
      return json(200, rows, { "X-Total-Count": String(rows.length) });
    }
    const unitById = method === "GET" ? /^\/units\/(\d+)$/.exec(path) : null;
    if (unitById) {
      const found = ALL_UNITS.find((u) => u.id === Number(unitById[1]));
      return found ? json(200, found) : json(404, { message: "Unidade não encontrada." });
    }
    if (key === "GET /students") {
      const q = (new URLSearchParams(search).get("q") ?? "").toLowerCase();
      const rows = STUDENTS.filter((s) => s.name.toLowerCase().includes(q));
      return json(200, rows, { "X-Total-Count": String(rows.length) });
    }
    if (key === "GET /rodas/reference/states") return json(200, [{ id: 1, name: "São Paulo", uf: "SP" }]);
    if (key.startsWith("GET /rodas/reference/cities")) return json(200, [{ id: 5, name: "Santos", stateId: 1 }]);
    if (key === "GET /events/7/participants") return json(200, participants);
    if (method === "POST" && path === "/events") return json(201, { ...EVENT, id: 8 });
    if (method === "PATCH" && path === "/events/7") return json(200, EVENT);
    if (method === "DELETE" && path === "/events/7") return new Response(null, { status: 200 });
    if (method === "POST" && path === "/events/7/participants") return json(201, { id: 90 });
    if (method === "PATCH" && path.endsWith("/check-in")) return json(200, { id: 50 });
    if (method === "DELETE" && path.startsWith("/events/7/participants/")) return new Response(null, { status: 200 });
    return json(404, { message: "Rota não mockada." });
  };
  vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => Promise.resolve(handler(input, init))));
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EventosPage />
    </QueryClientProvider>,
  );
}

const sent = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

beforeEach(() => {
  loginAs("MESTRE"); // a UI esconde ações conforme o papel (useCan); os testes de PROFESSOR trocam o papel
  events = [EVENT];
  participants = [
    { id: 50, eventId: 7, studentId: 11, guestName: null, status: "CONFIRMED", student: { id: 11, name: "Ana Souza" } },
    { id: 51, eventId: 7, studentId: null, guestName: "Visitante Zé", status: "ATTENDED", student: null },
  ];
  overrides = {};
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("EventosPage - listagem", () => {
  it("mostra loading e depois a linha com tipo traduzido e badge público", async () => {
    renderPage();
    expect(screen.getAllByTestId("table-loading").length).toBeGreaterThan(0);
    expect(await screen.findByText("Batizado 2026")).toBeInTheDocument();
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Batizado")).toBeInTheDocument();
    expect(table.getAllByText("Público")).toHaveLength(2); // cabeçalho + badge
    expect(screen.getByText("Quadra central")).toBeInTheDocument();
  });

  it("estado vazio", async () => {
    events = [];
    renderPage();
    expect(await screen.findByText("Nenhum evento cadastrado ainda.")).toBeInTheDocument();
  });

  it("estado de erro com mensagem do backend e nova tentativa", async () => {
    overrides["GET /events"] = () => json(403, { message: "Sem permissão para ver eventos." });
    renderPage();
    expect(await screen.findByText("Sem permissão para ver eventos.")).toBeInTheDocument();
    delete overrides["GET /events"];
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Batizado 2026")).toBeInTheDocument();
  });
});

describe("EventosPage - criar / editar / excluir", () => {
  it("valida título e data antes de enviar (nenhum POST)", async () => {
    renderPage();
    await screen.findByText("Batizado 2026");
    fireEvent.click(screen.getByRole("button", { name: /Novo evento/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(/Informe o título do evento/)).toBeInTheDocument();
    expect(screen.getByText("Informe a data do evento.")).toBeInTheDocument();
    expect(sent("POST", "/events")).toHaveLength(0);
  });

  it("rejeita imageUrl inválida", async () => {
    renderPage();
    await screen.findByText("Batizado 2026");
    fireEvent.click(screen.getByRole("button", { name: /Novo evento/ }));
    fireEvent.change(await screen.findByLabelText("Título"), { target: { value: "Festival" } });
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-12-01T19:30" } });
    fireEvent.change(screen.getByLabelText(/Imagem de capa/), { target: { value: "não é url" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Informe uma URL válida (http/https).")).toBeInTheDocument();
    expect(sent("POST", "/events")).toHaveLength(0);
  });

  it("cria evento: payload coerente com o DTO, preview de imagem, toast e refetch", async () => {
    renderPage();
    await screen.findByText("Batizado 2026");
    fireEvent.click(screen.getByRole("button", { name: /Novo evento/ }));
    fireEvent.change(await screen.findByLabelText("Título"), { target: { value: "  Festival de Verão " } });
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "FESTIVAL" } });
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-12-01T19:30" } });
    await screen.findByRole("option", { name: "Sede" });
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "3" } });
    await screen.findByRole("option", { name: "São Paulo (SP)" });
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "1" } });
    await screen.findByRole("option", { name: "Santos" });
    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/Imagem de capa/), { target: { value: "https://exemplo.com/f.jpg" } });
    expect(screen.getByAltText("Pré-visualização da capa")).toHaveAttribute("src", "https://exemplo.com/f.jpg");
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(sent("POST", "/events")).toHaveLength(1));
    const body = sent("POST", "/events")[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      title: "Festival de Verão",
      type: "FESTIVAL",
      unitId: 3,
      stateId: 1,
      cityId: 5,
      isPublic: true,
      imageUrl: "https://exemplo.com/f.jpg",
    });
    expect(body["date"]).toBe(new Date("2026-12-01T19:30").toISOString());
    expect(body).not.toHaveProperty("description");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Evento criado."));
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.path === "/events").length).toBeGreaterThan(1));
  });

  it("edita: carrega valores, envia PATCH em /events/:id", async () => {
    renderPage();
    await screen.findByText("Batizado 2026");
    fireEvent.click(screen.getByRole("button", { name: "Editar Batizado 2026" }));
    const title = await screen.findByLabelText("Título");
    expect(title).toHaveValue("Batizado 2026");
    expect(screen.getByLabelText("Tipo")).toHaveValue("BATIZADO");
    expect(screen.getByAltText("Pré-visualização da capa")).toBeInTheDocument();
    fireEvent.change(title, { target: { value: "Batizado Troca de Cordas" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(sent("PATCH", "/events/7")).toHaveLength(1));
    expect(sent("PATCH", "/events/7")[0]!.body).toMatchObject({ title: "Batizado Troca de Cordas", location: "Quadra central" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Evento atualizado."));
  });

  it("exclui só após confirmar no ConfirmDialog", async () => {
    renderPage();
    await screen.findByText("Batizado 2026");
    fireEvent.click(screen.getByRole("button", { name: "Excluir Batizado 2026" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/participantes cadastrados também serão removidos/)).toBeInTheDocument();
    expect(sent("DELETE", "/events/7")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(sent("DELETE", "/events/7")).toHaveLength(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Evento excluído."));
  });

  it("RBAC: MESTRE vê Excluir; PROFESSOR não (events:delete) mas continua com Editar e Participantes", async () => {
    const mestre = renderPage();
    await screen.findByText("Batizado 2026");
    expect(screen.getByRole("button", { name: "Excluir Batizado 2026" })).toBeInTheDocument();
    mestre.unmount();

    loginAs("PROFESSOR");
    renderPage();
    await screen.findByText("Batizado 2026");
    expect(screen.queryByRole("button", { name: /^Excluir/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Editar Batizado 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Participantes de Batizado 2026" })).toBeInTheDocument();
  });

  it("erro de exclusão vira toast.error e mantém o diálogo", async () => {
    overrides["DELETE /events/7"] = () => json(404, { message: "Evento não encontrado." });
    renderPage();
    await screen.findByText("Batizado 2026");
    fireEvent.click(screen.getByRole("button", { name: "Excluir Batizado 2026" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Evento não encontrado."));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});

describe("EventosPage - lista no servidor", () => {
  it("envia limit/offset sem filtros vazios e mostra o total do header", async () => {
    renderPage();
    await screen.findByText("Batizado 2026");
    const first = calls.find((c) => c.path === "/events")!;
    expect(first.query.get("limit")).toBe("10");
    expect(first.query.get("offset")).toBe("0");
    for (const key of ["q", "type", "from", "to"]) expect(first.query.has(key)).toBe(false);
    expect(screen.getByTestId("table-count")).toHaveTextContent("1 registro");
    expect(screen.queryByTestId("table-limit-warning")).not.toBeInTheDocument();
  });

  it("tipo, from, to e busca (debounce) vão ao servidor; filtro volta à página 1", async () => {
    events = Array.from({ length: 25 }, (_, i) => ({ ...EVENT, id: 100 + i, title: `Evento ${String(i + 1).padStart(2, "0")}` }));
    overrides["GET /events"] = () => json(200, events.slice(0, 10), { "X-Total-Count": "25" });
    renderPage();
    await screen.findByText("Evento 01");
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Próxima página"));
    await waitFor(() => expect(calls.at(-1)!.query.get("offset")).toBe("10"));

    const getEvents = () => calls.filter((c) => c.method === "GET" && c.path === "/events");
    fireEvent.change(screen.getByLabelText("Filtrar por tipo"), { target: { value: "CAMPEONATO" } });
    await waitFor(() => expect(getEvents().at(-1)!.query.get("type")).toBe("CAMPEONATO"));
    expect(getEvents().at(-1)!.query.get("offset")).toBe("0");
    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-11-01" } });
    await waitFor(() => expect(getEvents().at(-1)!.query.get("from")).toBe("2026-11-01"));
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-11-30" } });
    await waitFor(() => expect(getEvents().at(-1)!.query.get("to")).toBe("2026-11-30"));

    const before = getEvents().length;
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "Qu" } });
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "Quadra" } });
    expect(getEvents().length).toBe(before);
    await waitFor(() => expect(getEvents().at(-1)!.query.get("q")).toBe("Quadra"));
    expect(getEvents().filter((c) => c.query.has("q"))).toHaveLength(1);
    expect(getEvents().at(-1)!.query.get("type")).toBe("CAMPEONATO");
  });

  const unitSearches = () => calls.filter((c) => c.method === "GET" && c.path === "/units");

  it("unidades do formulário: busca no servidor com limit=20 (nunca 200) e aviso de refinar quando passa de 20", async () => {
    overrides["GET /units"] = () => json(200, UNITS, { "X-Total-Count": "250" });
    renderPage();
    await screen.findByText("Batizado 2026");
    expect(unitSearches()).toHaveLength(0); // só carrega ao abrir o formulário
    fireEvent.click(screen.getByRole("button", { name: /Novo evento/ }));
    await screen.findByRole("option", { name: "Sede" });
    expect(unitSearches()).toHaveLength(1);
    expect(unitSearches()[0]!.query.get("limit")).toBe("20");
    expect(unitSearches()[0]!.query.has("q")).toBe(false);
    expect(await screen.findByTestId("unit-picker-status")).toHaveTextContent("Mostrando 20 de 250 unidades");
    expect(screen.queryByTestId("aux-limit-notice")).not.toBeInTheDocument();
  });

  it("cria evento com unidade além do teto: busca com debounce (q) e o POST leva unitId numérico", async () => {
    overrides["GET /units"] = (() => {
      let first = true;
      return () => {
        // 1ª chamada (sem q): só a Sede; as seguintes casam por q
        if (first) {
          first = false;
          return json(200, UNITS, { "X-Total-Count": "251" });
        }
        return json(200, [ALL_UNITS[2]], { "X-Total-Count": "1" });
      };
    })();
    renderPage();
    await screen.findByText("Batizado 2026");
    fireEvent.click(screen.getByRole("button", { name: /Novo evento/ }));
    fireEvent.change(await screen.findByLabelText("Título"), { target: { value: "Festival" } });
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-12-01T19:30" } });
    await screen.findByRole("option", { name: "Sede" });
    fireEvent.change(screen.getByLabelText("Buscar unidade"), { target: { value: "ze" } });
    fireEvent.change(screen.getByLabelText("Buscar unidade"), { target: { value: "zeta" } });
    expect(unitSearches().filter((c) => c.query.has("q"))).toHaveLength(0); // dentro do debounce
    await screen.findByRole("option", { name: "Zeta Distante" });
    expect(unitSearches().filter((c) => c.query.has("q"))).toHaveLength(1);
    expect(unitSearches().at(-1)!.query.get("q")).toBe("zeta");
    expect(unitSearches().at(-1)!.query.get("limit")).toBe("20");
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(sent("POST", "/events")).toHaveLength(1));
    expect(sent("POST", "/events")[0]!.body).toMatchObject({ title: "Festival", unitId: 250 });
  });

  it("cria evento sem escolher unidade: opção vazia 'Nenhuma' e unitId omitido", async () => {
    renderPage();
    await screen.findByText("Batizado 2026");
    fireEvent.click(screen.getByRole("button", { name: /Novo evento/ }));
    fireEvent.change(await screen.findByLabelText("Título"), { target: { value: "Sem unidade" } });
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-12-01T19:30" } });
    await screen.findByRole("option", { name: "Sede" });
    expect(screen.getByRole("option", { name: "Nenhuma" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(sent("POST", "/events")).toHaveLength(1));
    expect(sent("POST", "/events")[0]!.body).not.toHaveProperty("unitId");
  });

  it("edita evento cuja unidade está FORA dos 20 resultados: resolve por GET /units/:id e o PATCH mantém o unitId", async () => {
    events = [{ ...EVENT, unitId: 99 }];
    renderPage();
    await screen.findByText("Batizado 2026");
    fireEvent.click(screen.getByRole("button", { name: "Editar Batizado 2026" }));
    await screen.findByLabelText("Título");
    const select = screen.getByLabelText("Unidade") as HTMLSelectElement;
    await waitFor(() => expect(select.selectedOptions[0]).toHaveTextContent("Filial Distante"));
    expect(select).toHaveValue("99");
    expect(calls.filter((c) => c.path === "/units/99")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(sent("PATCH", "/events/7")).toHaveLength(1));
    expect(sent("PATCH", "/events/7")[0]!.body).toMatchObject({ unitId: 99 });
  });

  it("erro ao buscar unidades aparece no seletor e não bloqueia o formulário", async () => {
    overrides["GET /units"] = () => json(500, { message: "Banco fora." });
    renderPage();
    await screen.findByText("Batizado 2026");
    fireEvent.click(screen.getByRole("button", { name: /Novo evento/ }));
    expect(await screen.findByText("Banco fora.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Mesmo assim" } });
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-12-01T19:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(sent("POST", "/events")).toHaveLength(1));
  });
});

describe("EventosPage - limpar campos opcionais (null no PATCH)", () => {
  const FULL = { ...EVENT, unitId: 3, stateId: 1, cityId: 5 };

  async function openEdit() {
    events = [FULL];
    renderPage();
    await screen.findByText("Batizado 2026");
    fireEvent.click(screen.getByRole("button", { name: "Editar Batizado 2026" }));
    await screen.findByLabelText("Título");
    await waitFor(() => expect(screen.getByLabelText("Unidade")).toHaveValue("3"));
    await waitFor(() => expect(screen.getByLabelText("Cidade")).toHaveValue("5"));
  }

  it("esvaziar descrição, local, unidade, estado, cidade e imagem envia null em cada um", async () => {
    await openEdit();
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "  " } });
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "" } }); // zera a cidade junto
    fireEvent.change(screen.getByLabelText(/Imagem de capa/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(sent("PATCH", "/events/7")).toHaveLength(1));
    const body = sent("PATCH", "/events/7")[0]!.body as Record<string, unknown>;
    for (const key of ["description", "location", "unitId", "stateId", "cityId", "imageUrl"]) {
      expect(body, key).toHaveProperty(key, null);
    }
    expect(body["imageUrl"]).not.toBe("");
    // obrigatórios nunca vão null
    expect(body).toMatchObject({ title: "Batizado 2026", type: "BATIZADO", isPublic: true });
    expect(body["date"]).toEqual(expect.any(String));
  });

  it("sem esvaziar, mantém os valores (não manda null)", async () => {
    await openEdit();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(sent("PATCH", "/events/7")).toHaveLength(1));
    expect(sent("PATCH", "/events/7")[0]!.body).toMatchObject({
      description: "Grande roda", location: "Quadra central", unitId: 3, stateId: 1, cityId: 5, imageUrl: "https://exemplo.com/capa.png",
    });
  });

  it("erro 400 do PATCH aparece em toast e mantém o formulário aberto", async () => {
    overrides["PATCH /events/7"] = () => json(400, { message: ["imageUrl must be a URL address"] });
    await openEdit();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("imageUrl must be a URL address"));
    expect(screen.getByLabelText("Título")).toBeInTheDocument();
  });
});

describe("EventosPage - participantes", () => {
  async function openParticipants() {
    renderPage();
    await screen.findByText("Batizado 2026");
    fireEvent.click(screen.getByRole("button", { name: "Participantes de Batizado 2026" }));
    return screen.findByRole("dialog");
  }

  it("lista aluno e convidado com situação", async () => {
    const dialog = await openParticipants();
    expect(await within(dialog).findByText("Ana Souza", { selector: "span" })).toBeInTheDocument();
    expect(within(dialog).getByText("Visitante Zé")).toBeInTheDocument();
    expect(within(dialog).getByText("Confirmado", { selector: "div" })).toBeInTheDocument();
    expect(within(dialog).getByText("Compareceu", { selector: "div" })).toBeInTheDocument();
    // check-in só aparece para quem ainda não foi marcado ATTENDED
    expect(within(dialog).getByRole("button", { name: "Check-in de Ana Souza" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Check-in de Visitante Zé" })).toBeNull();
  });

  it("valida aluno/convidado e inscreve convidado (POST sem studentId)", async () => {
    const dialog = await openParticipants();
    await within(dialog).findByText("Visitante Zé");
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));
    expect(await within(dialog).findByText("Selecione um aluno.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByLabelText("Convidado"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));
    expect(await within(dialog).findByText(/Informe o nome do convidado/)).toBeInTheDocument();
    expect(sent("POST", "/events/7/participants")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("Nome do convidado"), { target: { value: " Mestre Bimba " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(sent("POST", "/events/7/participants")).toHaveLength(1));
    expect(sent("POST", "/events/7/participants")[0]!.body).toEqual({ guestName: "Mestre Bimba", status: "CONFIRMED" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Participante adicionado."));
  });

  const studentCalls = () => calls.filter((c) => c.method === "GET" && c.path === "/students");

  it("inscreve aluno (studentId numérico) escolhido no seletor com busca no servidor (limit=20, sem limit=200)", async () => {
    const dialog = await openParticipants();
    await within(dialog).findByRole("option", { name: "Ana Souza" });
    expect(studentCalls()).toHaveLength(1);
    expect(studentCalls()[0]!.query.get("limit")).toBe("20");
    expect(studentCalls()[0]!.query.has("q")).toBe(false);
    expect(within(dialog).queryByTestId("students-truncated")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Aluno"), { target: { value: "11" } });
    fireEvent.change(within(dialog).getByLabelText("Situação"), { target: { value: "INVITED" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(sent("POST", "/events/7/participants")).toHaveLength(1));
    expect(sent("POST", "/events/7/participants")[0]!.body).toEqual({ studentId: 11, status: "INVITED" });
    // depois de adicionar, o seletor volta a "Selecione…"
    await waitFor(() => expect(within(dialog).getByLabelText("Aluno")).toHaveValue(""));
  });

  it("busca o aluno no servidor (q=bru) e inscreve quem só aparece na busca", async () => {
    const dialog = await openParticipants();
    await within(dialog).findByRole("option", { name: "Ana Souza" });
    fireEvent.change(within(dialog).getByLabelText("Buscar aluno"), { target: { value: "bru" } });
    await waitFor(() => expect(studentCalls().at(-1)!.query.get("q")).toBe("bru"));
    expect(await within(dialog).findByRole("option", { name: "Bruno Lima" })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).queryByRole("option", { name: "Ana Souza" })).toBeNull());
    const last = studentCalls().at(-1)!;
    expect(last.query.get("limit")).toBe("20");
    fireEvent.change(within(dialog).getByLabelText("Aluno"), { target: { value: "12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(sent("POST", "/events/7/participants")).toHaveLength(1));
    expect(sent("POST", "/events/7/participants")[0]!.body).toEqual({ studentId: 12, status: "CONFIRMED" });
  });

  it("check-in faz PATCH e remover pede confirmação antes do DELETE", async () => {
    const dialog = await openParticipants();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Check-in de Ana Souza" }));
    await waitFor(() => expect(sent("PATCH", "/events/7/participants/50/check-in")).toHaveLength(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Presença confirmada."));

    fireEvent.click(within(dialog).getByRole("button", { name: "Remover Visitante Zé" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(sent("DELETE", "/events/7/participants/51")).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(sent("DELETE", "/events/7/participants/51")).toHaveLength(1));
  });

  it("falha ao carregar participantes mostra erro; sem participantes mostra vazio", async () => {
    overrides["GET /events/7/participants"] = () => json(500, { message: "Falha interna." });
    const dialog = await openParticipants();
    expect(await within(dialog).findByText("Falha interna.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });

  it("lista vazia de participantes", async () => {
    participants = [];
    const dialog = await openParticipants();
    expect(await within(dialog).findByText("Nenhum participante ainda.")).toBeInTheDocument();
  });
});
