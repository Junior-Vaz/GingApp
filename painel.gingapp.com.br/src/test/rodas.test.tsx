import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { RodasPage } from "@/modules/rodas";
import { saveSession, clearSession, type AuthUser } from "@/lib/session";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const USER: AuthUser = {
  id: 1,
  name: "Mestre",
  email: "m@x.com",
  userType: "MEMBER",
  isSuperAdmin: false,
  organizationId: 10,
  organizationSlug: "grupo",
  role: "MESTRE",
};

const base = {
  communityId: null,
  stateId: null,
  cityId: null,
  description: null,
  location: null,
  imageUrl: null,
};
const OWN = { ...base, id: 1, organizationId: 10, title: "Roda de Sábado", date: "2026-11-20T22:00:00.000Z", location: "Praça", stateId: 1, imageUrl: "https://exemplo.com/r.png" };
const OTHER = { ...base, id: 2, organizationId: 99, title: "Roda Alheia", date: "2026-11-21T22:00:00.000Z" };

let calls: Call[];
let rodas: unknown[];
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
    if (key === "GET /rodas") return json(200, rodas, { "X-Total-Count": String(rodas.length) });
    if (key === "GET /rodas/reference/states") return json(200, [{ id: 1, name: "São Paulo", uf: "SP" }]);
    if (key === "GET /rodas/reference/cities") return json(200, [{ id: 5, name: "Santos", stateId: 1 }]);
    if (key === "GET /rodas/1/participants" || key === "GET /rodas/2/participants") return json(200, participants);
    if (method === "POST" && path === "/rodas") return json(201, { ...OWN, id: 3 });
    if (method === "PATCH" && path === "/rodas/1") return json(200, OWN);
    if (method === "DELETE" && path === "/rodas/1") return json(200, { success: true });
    if (method === "DELETE" && path.startsWith("/rodas/1/participants/")) return json(200, { success: true });
    return json(404, { message: "Rota não mockada." });
  };
  vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => Promise.resolve(handler(input, init))));
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RodasPage />
    </QueryClientProvider>,
  );
}

const sent = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

beforeEach(() => {
  saveSession("tok", USER);
  rodas = [OWN, OTHER];
  participants = [
    { id: 30, rodaId: 1, userId: 5, studentId: null, guestName: null, status: "CONFIRMED", user: { id: 5, name: "Bia" }, student: null },
  ];
  overrides = {};
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("RodasPage - listagem e dono", () => {
  it("lista com estado traduzido; só a roda da própria organização tem Editar/Excluir", async () => {
    renderPage();
    expect(screen.getAllByTestId("table-loading").length).toBeGreaterThan(0);
    expect(await screen.findByText("Roda de Sábado")).toBeInTheDocument();
    expect(await screen.findByText("São Paulo")).toBeInTheDocument();
    expect(screen.getByText("Roda Alheia")).toBeInTheDocument();
    expect(screen.getByText("Outra organização")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar Roda de Sábado" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar Roda Alheia" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Excluir Roda Alheia" })).toBeNull();
  });

  it("RBAC: MESTRE vê Excluir na roda própria; PROFESSOR não (rodas:delete) mas continua com Editar", async () => {
    const mestre = renderPage();
    await screen.findByText("Roda de Sábado");
    expect(screen.getByRole("button", { name: "Excluir Roda de Sábado" })).toBeInTheDocument();
    mestre.unmount();

    saveSession("tok", { ...USER, role: "PROFESSOR" });
    renderPage();
    await screen.findByText("Roda de Sábado");
    expect(screen.queryByRole("button", { name: /^Excluir/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Editar Roda de Sábado" })).toBeInTheDocument();
  });

  it("estado vazio e estado de erro", async () => {
    rodas = [];
    renderPage();
    expect(await screen.findByText("Nenhuma roda cadastrada ainda.")).toBeInTheDocument();
  });

  it("erro de listagem mostra mensagem e permite tentar de novo", async () => {
    overrides["GET /rodas"] = () => json(500, { message: "Falha ao listar rodas." });
    renderPage();
    expect(await screen.findByText("Falha ao listar rodas.")).toBeInTheDocument();
    delete overrides["GET /rodas"];
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Roda de Sábado")).toBeInTheDocument();
  });
});

describe("RodasPage - criar / editar / excluir", () => {
  it("valida título e data", async () => {
    renderPage();
    await screen.findByText("Roda de Sábado");
    fireEvent.click(screen.getByRole("button", { name: /Nova roda/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(/Informe o título/)).toBeInTheDocument();
    expect(screen.getByText("Informe a data e a hora.")).toBeInTheDocument();
    expect(sent("POST", "/rodas")).toHaveLength(0);
  });

  it("cria com estado -> cidade encadeados e imagem; cidade zera ao trocar o estado", async () => {
    renderPage();
    await screen.findByText("Roda de Sábado");
    fireEvent.click(screen.getByRole("button", { name: /Nova roda/ }));
    fireEvent.change(await screen.findByLabelText("Título"), { target: { value: "Roda de Natal" } });
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-12-24T18:00" } });
    expect(screen.getByLabelText("Cidade")).toBeDisabled();
    await screen.findByRole("option", { name: "São Paulo (SP)" });
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "1" } });
    await screen.findByRole("option", { name: "Santos" });
    expect(calls.some((c) => c.path === "/rodas/reference/cities" && c.query.get("stateId") === "1")).toBe(true);
    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/Imagem de capa/), { target: { value: "https://exemplo.com/n.jpg" } });
    expect(screen.getByAltText("Pré-visualização da capa")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(sent("POST", "/rodas")).toHaveLength(1));
    const body = sent("POST", "/rodas")[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ title: "Roda de Natal", stateId: 1, cityId: 5, imageUrl: "https://exemplo.com/n.jpg" });
    expect(body["date"]).toBe(new Date("2026-12-24T18:00").toISOString());
    expect(body).not.toHaveProperty("location");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Roda criada."));
  });

  it("imageUrl inválida bloqueia o envio", async () => {
    renderPage();
    await screen.findByText("Roda de Sábado");
    fireEvent.click(screen.getByRole("button", { name: /Nova roda/ }));
    fireEvent.change(await screen.findByLabelText("Título"), { target: { value: "Roda X" } });
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-12-24T18:00" } });
    fireEvent.change(screen.getByLabelText(/Imagem de capa/), { target: { value: "ftp://x" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Informe uma URL válida (http/https).")).toBeInTheDocument();
    expect(sent("POST", "/rodas")).toHaveLength(0);
  });

  it("edita a roda própria via PATCH /rodas/:id", async () => {
    renderPage();
    await screen.findByText("Roda de Sábado");
    fireEvent.click(screen.getByRole("button", { name: "Editar Roda de Sábado" }));
    const title = await screen.findByLabelText("Título");
    expect(title).toHaveValue("Roda de Sábado");
    expect(screen.getByLabelText("Local")).toHaveValue("Praça");
    await waitFor(() => expect(screen.getByLabelText("Estado")).toHaveValue("1"));
    fireEvent.change(title, { target: { value: "Roda de Sábado à noite" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(sent("PATCH", "/rodas/1")).toHaveLength(1));
    expect(sent("PATCH", "/rodas/1")[0]!.body).toMatchObject({ title: "Roda de Sábado à noite", location: "Praça", stateId: 1 });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Roda atualizada."));
  });

  it("exclui só após confirmar", async () => {
    renderPage();
    await screen.findByText("Roda de Sábado");
    fireEvent.click(screen.getByRole("button", { name: "Excluir Roda de Sábado" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(sent("DELETE", "/rodas/1")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(sent("DELETE", "/rodas/1")).toHaveLength(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Roda excluída."));
  });

  it("erro 403 do backend na exclusão vira toast", async () => {
    overrides["DELETE /rodas/1"] = () => json(403, { message: "Roda não organizada por esta organização." });
    renderPage();
    await screen.findByText("Roda de Sábado");
    fireEvent.click(screen.getByRole("button", { name: "Excluir Roda de Sábado" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Roda não organizada por esta organização."));
  });
});

describe("RodasPage - lista no servidor", () => {
  it("envia limit/offset, mostra o total global e mantém o selo da outra organização sem ações de edição", async () => {
    renderPage();
    await screen.findByText("Roda de Sábado");
    const first = calls.find((c) => c.path === "/rodas")!;
    expect(first.query.get("limit")).toBe("10");
    expect(first.query.get("offset")).toBe("0");
    for (const key of ["q", "stateId", "cityId"]) expect(first.query.has(key)).toBe(false);
    expect(screen.getByTestId("table-count")).toHaveTextContent("2 registros");
    expect(screen.queryByTestId("table-limit-warning")).not.toBeInTheDocument();
    // roda de outra organização: selo, participantes (leitura), mas NUNCA Editar/Excluir
    expect(screen.getByText("Outra organização")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Participantes de Roda Alheia" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar Roda Alheia" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Excluir Roda Alheia" })).toBeNull();
  });

  it("estado, cidade e busca (debounce) vão ao servidor; trocar o estado limpa a cidade", async () => {
    renderPage();
    await screen.findByText("Roda de Sábado");
    const getRodas = () => calls.filter((c) => c.method === "GET" && c.path === "/rodas");
    expect(screen.getByLabelText("Filtrar por cidade")).toBeDisabled();
    await screen.findByRole("option", { name: "São Paulo (SP)" });
    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "1" } });
    await waitFor(() => expect(getRodas().at(-1)!.query.get("stateId")).toBe("1"));
    await screen.findByRole("option", { name: "Santos" });
    fireEvent.change(screen.getByLabelText("Filtrar por cidade"), { target: { value: "5" } });
    await waitFor(() => expect(getRodas().at(-1)!.query.get("cityId")).toBe("5"));
    expect(getRodas().at(-1)!.query.get("stateId")).toBe("1");
    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "" } });
    await waitFor(() => expect(getRodas().at(-1)!.query.has("stateId")).toBe(false));
    expect(getRodas().at(-1)!.query.has("cityId")).toBe(false);

    const before = getRodas().length;
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "Pr" } });
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "Praça" } });
    expect(getRodas().length).toBe(before);
    await waitFor(() => expect(getRodas().at(-1)!.query.get("q")).toBe("Praça"));
    expect(getRodas().filter((c) => c.query.has("q"))).toHaveLength(1);
  });

  it("pagina no servidor com o total do header (offset da página 2)", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...OTHER, id: 200 + i, title: `Roda ${String(i + 1).padStart(2, "0")}` }));
    overrides["GET /rodas"] = () => json(200, many.slice(0, 10), { "X-Total-Count": "25" });
    renderPage();
    await screen.findByText("Roda 01");
    expect(screen.getByTestId("table-count")).toHaveTextContent("25 registros");
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Próxima página"));
    await waitFor(() => expect(calls.at(-1)!.query.get("offset")).toBe("10"));
  });
});

describe("RodasPage - limpar campos opcionais (null no PATCH)", () => {
  const FULL = { ...OWN, description: "Roda aberta", cityId: 5 };

  async function openEdit() {
    rodas = [FULL, OTHER];
    renderPage();
    await screen.findByText("Roda de Sábado");
    fireEvent.click(screen.getByRole("button", { name: "Editar Roda de Sábado" }));
    await screen.findByLabelText("Título");
    await waitFor(() => expect(screen.getByLabelText("Cidade")).toHaveValue("5"));
  }

  it("esvaziar descrição, local, estado, cidade e imagem envia null em cada um", async () => {
    await openEdit();
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: " " } });
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "" } }); // zera a cidade junto
    fireEvent.change(screen.getByLabelText(/Imagem de capa/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(sent("PATCH", "/rodas/1")).toHaveLength(1));
    const body = sent("PATCH", "/rodas/1")[0]!.body as Record<string, unknown>;
    for (const key of ["description", "location", "stateId", "cityId", "imageUrl"]) {
      expect(body, key).toHaveProperty(key, null);
    }
    expect(body["imageUrl"]).not.toBe("");
    expect(body).toMatchObject({ title: "Roda de Sábado" });
    expect(body["date"]).toEqual(expect.any(String));
    expect(body).not.toHaveProperty("communityId"); // sem campo no painel: não mexe
  });

  it("erro 400 do PATCH aparece em toast e mantém o formulário aberto", async () => {
    overrides["PATCH /rodas/1"] = () => json(400, { message: "imageUrl must be a URL address" });
    await openEdit();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("imageUrl must be a URL address"));
    expect(screen.getByLabelText("Título")).toBeInTheDocument();
  });
});

describe("RodasPage - participantes", () => {
  it("dono vê a lista e remove com confirmação (DELETE /rodas/:id/participants/:pid)", async () => {
    renderPage();
    await screen.findByText("Roda de Sábado");
    fireEvent.click(screen.getByRole("button", { name: "Participantes de Roda de Sábado" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Bia")).toBeInTheDocument();
    expect(within(dialog).getByText("Confirmado")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remover" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(sent("DELETE", "/rodas/1/participants/30")).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(sent("DELETE", "/rodas/1/participants/30")).toHaveLength(1));
  });

  it("roda de outra organização: lista, mas sem botão Remover", async () => {
    participants = [{ id: 31, rodaId: 2, userId: 6, studentId: null, guestName: null, status: "CONFIRMED", user: { id: 6, name: "Caio" }, student: null }];
    renderPage();
    await screen.findByText("Roda Alheia");
    fireEvent.click(screen.getByRole("button", { name: "Participantes de Roda Alheia" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Caio")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Remover" })).toBeNull();
  });

  it("lista vazia", async () => {
    participants = [];
    renderPage();
    await screen.findByText("Roda de Sábado");
    fireEvent.click(screen.getByRole("button", { name: "Participantes de Roda de Sábado" }));
    expect(await screen.findByText("Ninguém confirmou presença ainda.")).toBeInTheDocument();
  });
});
