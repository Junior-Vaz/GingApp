import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { navItemsFor } from "@/lib/nav";
import { EventosPage } from "@/modules/eventos";
import { FormulariosPage } from "@/modules/formularios";
import { clearSession, loginAs } from "./login-as";
import { clickMenuAction } from "./row-menu";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const navigate = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const FORM = {
  id: "f1",
  slug: "campeonato-varjao",
  title: "1º Campeonato do Varjão",
  eventId: 7,
  eventTitle: "Campeonato 2026",
  status: "OPEN",
  paymentMode: "PIX_MANUAL",
  priceCents: 2500,
  submissionsCount: 95,
  pendingCount: 3,
  confirmedCount: 80,
  opensAt: null,
  closesAt: null,
  publicUrl: "https://app.gingapp.com.br/i/campeonato-varjao",
  createdAt: "2026-10-01T12:00:00.000Z",
};
const FORM_DRAFT = {
  ...FORM,
  id: "f2",
  slug: "batizado",
  title: "Batizado de Verão",
  eventId: null,
  eventTitle: null,
  status: "DRAFT",
  paymentMode: "NONE",
  priceCents: null, // o backend real devolve null (não 0) quando gratuito
  submissionsCount: 0,
  pendingCount: 0,
  confirmedCount: 0,
  publicUrl: null, // o backend só devolve o link depois da 1ª publicação
};
const EVENTS = [
  {
    id: 7,
    title: "Campeonato 2026",
    type: "CAMPEONATO",
    date: "2026-11-20T22:00:00.000Z",
    location: "Quadra",
    isPublic: true,
    unitId: null,
    description: null,
    stateId: null,
    cityId: null,
    imageUrl: null,
  },
  {
    id: 8,
    title: "Roda de Natal",
    type: "ENCONTRO",
    date: "2026-12-20T22:00:00.000Z",
    location: "Praça",
    isPublic: true,
    unitId: null,
    description: null,
    stateId: null,
    cityId: null,
    imageUrl: null,
  },
];

let calls: Call[];
let forms: unknown[];
let totalHeader: string | null;
let overrides: Record<string, () => Response>;
const writeText = vi.fn().mockResolvedValue(undefined);

function installFetch() {
  calls = [];
  const handler = (input: string, init?: RequestInit): Response => {
    const [path = "", search = ""] = input.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    calls.push({ method, path, query: new URLSearchParams(search), body });
    const override = overrides[`${method} ${path}`];
    if (override) return override();
    if (method === "GET" && path === "/event-forms") {
      const filtered = new URLSearchParams(search).get("eventId") === "8" ? [] : forms;
      return json(200, filtered, { "X-Total-Count": totalHeader ?? String(filtered.length) });
    }
    if (method === "GET" && path === "/event-forms/templates")
      return json(404, { message: "sem modelos" });
    if (method === "GET" && path === "/events") return json(200, EVENTS, { "X-Total-Count": "2" });
    if (method === "POST" && path === "/event-forms")
      return json(201, { id: "novo-1", title: "x", sections: [], fields: [] });
    if (method === "POST" && /^\/event-forms\/[^/]+\/(duplicate|archive)$/.test(path))
      return json(201, { id: "f9" });
    if (method === "DELETE" && path === "/event-forms/f2")
      return new Response(null, { status: 200 });
    return json(404, { message: "Rota não mockada." });
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => Promise.resolve(handler(input, init))),
  );
}

const sent = (method: string, path: string) =>
  calls.filter((c) => c.method === method && c.path === path);
const listCalls = () => sent("GET", "/event-forms");

function renderWith(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  loginAs("MESTRE");
  forms = [FORM, FORM_DRAFT];
  totalHeader = null;
  overrides = {};
  navigate.mockClear();
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("FormulariosPage - lista", () => {
  it("mostra título, evento, situação, inscrições com pendentes em destaque, valor e link", async () => {
    renderWith(<FormulariosPage />);
    expect(await screen.findByText("1º Campeonato do Varjão")).toBeInTheDocument();
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Campeonato 2026")).toBeInTheDocument();
    expect(table.getByText("Avulso")).toBeInTheDocument();
    expect(table.getByText("Aberto")).toBeInTheDocument();
    expect(table.getByText("Rascunho")).toBeInTheDocument();
    expect(table.getByText("95 inscrições")).toBeInTheDocument();
    expect(table.getByText("3 pendentes")).toBeInTheDocument();
    expect(table.getByText(/25,00/)).toBeInTheDocument();
    expect(table.getByText("Grátis")).toBeInTheDocument();
    expect(table.getByText("app.gingapp.com.br/i/campeonato-varjao")).toBeInTheDocument();
  });

  it("estado vazio e erro com 'Tentar novamente'", async () => {
    forms = [];
    const first = renderWith(<FormulariosPage />);
    expect(await screen.findByText(/Nenhum formulário ainda/)).toBeInTheDocument();
    first.unmount();

    forms = [FORM];
    overrides["GET /event-forms"] = () => json(500, { message: "Banco fora." });
    renderWith(<FormulariosPage />);
    expect(await screen.findByText("Banco fora.")).toBeInTheDocument();
    delete overrides["GET /event-forms"];
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("1º Campeonato do Varjão")).toBeInTheDocument();
  });

  it("filtros de situação e evento, busca e página vão ao servidor (limit/offset, sem vazios)", async () => {
    totalHeader = "25";
    renderWith(<FormulariosPage />);
    await screen.findByText("1º Campeonato do Varjão");
    const first = listCalls()[0]!;
    expect(first.query.get("limit")).toBe("10");
    expect(first.query.get("offset")).toBe("0");
    for (const key of ["q", "status", "eventId"]) expect(first.query.has(key)).toBe(false);

    fireEvent.click(screen.getByLabelText("Próxima página"));
    await waitFor(() => expect(listCalls().at(-1)!.query.get("offset")).toBe("10"));

    fireEvent.change(screen.getByLabelText("Filtrar por situação"), { target: { value: "OPEN" } });
    await waitFor(() => expect(listCalls().at(-1)!.query.get("status")).toBe("OPEN"));
    expect(listCalls().at(-1)!.query.get("offset")).toBe("0");

    await screen.findByRole("option", { name: "Roda de Natal" });
    fireEvent.change(screen.getByLabelText("Filtrar por evento"), { target: { value: "7" } });
    await waitFor(() => expect(listCalls().at(-1)!.query.get("eventId")).toBe("7"));
    expect(listCalls().at(-1)!.query.get("status")).toBe("OPEN");

    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "varjão" } });
    await waitFor(() => expect(listCalls().at(-1)!.query.get("q")).toBe("varjão"));
  });
});

describe("FormulariosPage - novo formulário a partir de um modelo", () => {
  it("envia título, evento e modelo escolhidos e abre o editor do formulário criado", async () => {
    renderWith(<FormulariosPage />);
    await screen.findByText("1º Campeonato do Varjão");
    fireEvent.click(screen.getByRole("button", { name: /Novo formulário/ }));
    const dialog = await screen.findByRole("dialog");
    // sem /templates no servidor: usa os cinco modelos embutidos
    for (const name of [
      "Campeonato",
      "Batizado / troca de corda",
      "Curso / oficina",
      "Roda / encontro",
      "Inscrição simples",
    ]) {
      expect(within(dialog).getByRole("radio", { name })).toBeInTheDocument();
    }
    await within(dialog).findByRole("option", { name: "Campeonato 2026" });
    fireEvent.change(within(dialog).getByLabelText("Evento (opcional)"), {
      target: { value: "7" },
    });
    // título vem sugerido a partir do evento escolhido
    expect(within(dialog).getByLabelText("Título")).toHaveValue("Inscrições — Campeonato 2026");
    fireEvent.change(within(dialog).getByLabelText("Título"), {
      target: { value: "  Campeonato do Varjão " },
    });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Campeonato" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar formulário" }));

    await waitFor(() => expect(sent("POST", "/event-forms")).toHaveLength(1));
    expect(sent("POST", "/event-forms")[0]!.body).toEqual({
      title: "Campeonato do Varjão",
      template: "CAMPEONATO",
      eventId: 7,
    });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/formularios/$formId",
        params: { formId: "novo-1" },
      }),
    );
  });

  it("avulso: não envia eventId; título curto bloqueia o envio", async () => {
    renderWith(<FormulariosPage />);
    await screen.findByText("1º Campeonato do Varjão");
    fireEvent.click(screen.getByRole("button", { name: /Novo formulário/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar formulário" }));
    expect(await within(dialog).findByText(/Informe o título do formulário/)).toBeInTheDocument();
    expect(sent("POST", "/event-forms")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("Título"), {
      target: { value: "Curso de berimbau" },
    });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Curso / oficina" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar formulário" }));
    await waitFor(() => expect(sent("POST", "/event-forms")).toHaveLength(1));
    expect(sent("POST", "/event-forms")[0]!.body).toEqual({
      title: "Curso de berimbau",
      template: "CURSO",
    });
  });

  it("usa os modelos do servidor quando GET /templates responde", async () => {
    overrides["GET /event-forms/templates"] = () =>
      json(200, [{ key: "RODA", name: "Roda aberta", description: "Do servidor" }]);
    renderWith(<FormulariosPage />);
    await screen.findByText("1º Campeonato do Varjão");
    fireEvent.click(screen.getByRole("button", { name: /Novo formulário/ }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("radio", { name: "Roda aberta" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("radio", { name: "Campeonato" })).toBeNull();
  });
});

describe("FormulariosPage - ações da linha", () => {
  it("abrir editor navega; copiar link copia a URL pública", async () => {
    renderWith(<FormulariosPage />);
    await screen.findByText("1º Campeonato do Varjão");
    fireEvent.click(screen.getByRole("button", { name: "Abrir editor de Batizado de Verão" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/formularios/$formId", params: { formId: "f2" } });
    fireEvent.click(screen.getByRole("button", { name: "Copiar link de 1º Campeonato do Varjão" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("https://app.gingapp.com.br/i/campeonato-varjao"),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Link copiado."));
  });

  it("publicUrl null (rascunho): Copiar link fica desabilitado com a dica 'Publique o formulário…' e não copia nada", async () => {
    renderWith(<FormulariosPage />);
    await screen.findByText("Batizado de Verão");
    expect(screen.getByText("Link criado ao publicar")).toBeInTheDocument();
    expect(screen.queryByText(/\/i\/batizado/)).toBeNull();
    const copy = screen.getByRole("button", { name: "Copiar link de Batizado de Verão" });
    expect(copy).toBeDisabled();
    expect(copy).toHaveAttribute("title", "Publique o formulário para gerar o link");
    fireEvent.click(copy);
    expect(writeText).not.toHaveBeenCalled();
    // o publicado continua com link habilitado
    expect(screen.getByText("app.gingapp.com.br/i/campeonato-varjao")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copiar link de 1º Campeonato do Varjão" }),
    ).toBeEnabled();
  });

  it("duplicar chama POST /duplicate; arquivar pede confirmação antes do POST /archive", async () => {
    renderWith(<FormulariosPage />);
    await screen.findByText("1º Campeonato do Varjão");
    await clickMenuAction("Duplicar 1º Campeonato do Varjão");
    await waitFor(() => expect(sent("POST", "/event-forms/f1/duplicate")).toHaveLength(1));

    await clickMenuAction("Arquivar 1º Campeonato do Varjão");
    const confirm = await screen.findByRole("alertdialog");
    expect(sent("POST", "/event-forms/f1/archive")).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole("button", { name: "Arquivar" }));
    await waitFor(() => expect(sent("POST", "/event-forms/f1/archive")).toHaveLength(1));
  });

  it("excluir exige digitar EXCLUIR; envia DELETE", async () => {
    renderWith(<FormulariosPage />);
    await screen.findByText("Batizado de Verão");
    await clickMenuAction("Excluir Batizado de Verão");
    const strong = await screen.findByRole("alertdialog");
    const confirmButton = within(strong).getByRole("button", { name: "Excluir definitivamente" });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(within(strong).getByRole("textbox"), { target: { value: "excluir" } });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);
    await waitFor(() => expect(sent("DELETE", "/event-forms/f2")).toHaveLength(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Formulário excluído."));
  });

  it("FORM_HAS_SUBMISSIONS (409) na exclusão oferece arquivar no lugar", async () => {
    overrides["DELETE /event-forms/f2"] = () =>
      json(409, { code: "FORM_HAS_SUBMISSIONS", message: "Tem inscrições." });
    renderWith(<FormulariosPage />);
    await screen.findByText("Batizado de Verão");
    await clickMenuAction("Excluir Batizado de Verão");
    const strong = await screen.findByRole("alertdialog");
    fireEvent.change(within(strong).getByRole("textbox"), { target: { value: "EXCLUIR" } });
    fireEvent.click(within(strong).getByRole("button", { name: "Excluir definitivamente" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Arquive-o")),
    );
    const offer = await screen.findByRole("alertdialog");
    expect(within(offer).getByText("Arquivar formulário?")).toBeInTheDocument();
    fireEvent.click(within(offer).getByRole("button", { name: "Arquivar" }));
    await waitFor(() => expect(sent("POST", "/event-forms/f2/archive")).toHaveLength(1));
  });
});

describe("Eventos - botão 'Formulário de inscrição'", () => {
  const eventRow = { ...EVENTS[0], id: 7 };
  function renderEventos() {
    overrides["GET /events"] = () => json(200, [eventRow], { "X-Total-Count": "1" });
    return renderWith(<EventosPage />);
  }

  it("abre o formulário que já existe para o evento", async () => {
    renderEventos();
    await screen.findByText("Campeonato 2026");
    fireEvent.click(
      screen.getByRole("button", { name: "Formulário de inscrição de Campeonato 2026" }),
    );
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/formularios/$formId",
        params: { formId: "f1" },
      }),
    );
    expect(listCalls().at(-1)!.query.get("eventId")).toBe("7");
  });

  it("sem formulário: abre 'Novo formulário' já ligado ao evento e cria com o modelo", async () => {
    forms = [];
    renderEventos();
    await screen.findByText("Campeonato 2026");
    fireEvent.click(
      screen.getByRole("button", { name: "Formulário de inscrição de Campeonato 2026" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Campeonato 2026", { selector: "strong" })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Evento (opcional)")).toBeNull();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Batizado / troca de corda" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar formulário" }));
    await waitFor(() => expect(sent("POST", "/event-forms")).toHaveLength(1));
    expect(sent("POST", "/event-forms")[0]!.body).toEqual({
      title: "Inscrições — Campeonato 2026",
      template: "BATIZADO",
      eventId: 7,
    });
  });

  it("MONITOR (só leitura) não vê o botão", async () => {
    loginAs("MONITOR");
    renderEventos();
    await screen.findByText("Campeonato 2026");
    expect(screen.queryByRole("button", { name: /Formulário de inscrição/ })).toBeNull();
  });
});

describe("menu 'Formulários' por papel", () => {
  it("aparece para quem gerencia eventos; o MONITOR e quem não é do painel não veem", () => {
    for (const role of ["MESTRE", "PROFESSOR", "INSTRUTOR"] as const) {
      expect(navItemsFor(role).map((i) => i.label)).toContain("Formulários");
    }
    expect(navItemsFor("MONITOR").map((i) => i.label)).not.toContain("Formulários");
    expect(navItemsFor("ALUNO").map((i) => i.label)).not.toContain("Formulários");
    expect(navItemsFor(undefined).map((i) => i.label)).not.toContain("Formulários");
  });
});
