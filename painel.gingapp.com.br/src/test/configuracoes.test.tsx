import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfiguracoesPage } from "@/modules/configuracoes/configuracoes-page";
import { usagePercent } from "@/modules/configuracoes/plan";
import { organizationSchema, organizationToForm, organizationToPayload } from "@/modules/configuracoes/org-schema";
import { toast } from "sonner";
import { clearSession, loginAs } from "./login-as";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const ORG = { id: 1, name: "Ginga Brasil", slug: "ginga-brasil", type: "GROUP", status: "ACTIVE", document: "12.345.678/0001-90", email: "contato@gb.com", phone: null };
const SUB = { id: 1, status: "ACTIVE", currentPeriodEnd: "2026-11-15T00:00:00.000Z", plan: { id: 1, name: "Pro", priceCents: 9900, maxStudents: 50, maxUnits: 2 } };
const dashboard = (active: number) => ({
  students: { active, new30d: 1, inactive: 0 }, classes: { active: 1 }, lessonsToday: 0,
  finance: { pendingCount: 0, pendingCents: 0, overdueCount: 0, overdueCents: 0 },
  attendance: { last30dPercent: null }, graduations: { last30d: 0 }, upcomingEvents: [],
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConfiguracoesPage />
    </QueryClientProvider>,
  );
}

function stub(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn((url: string) => {
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    return Promise.resolve(key ? routes[key]!() : json(404, { message: "?" }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("usagePercent", () => {
  it("calcula o percentual, limita em 100 e trata ilimitado", () => {
    expect(usagePercent(25, 50)).toBe(50);
    expect(usagePercent(80, 50)).toBe(100);
    expect(usagePercent(5, null)).toBeNull();
  });
});

describe("ConfiguracoesPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    clearSession();
  });

  it("mostra a organização (objeto) e o plano com uso vindo do dashboard", async () => {
    const fetchMock = stub({
      "/organizations": () => json(200, ORG),
      "/subscriptions/me": () => json(200, SUB),
      "/dashboard": () => json(200, dashboard(30)),
    });
    renderPage();
    expect(await screen.findByText("Ginga Brasil")).toBeInTheDocument();
    expect(screen.getByText("12.345.678/0001-90")).toBeInTheDocument();
    expect(await screen.findByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Ativa")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("plan-usage")).toHaveTextContent("30 / 50"));
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/students"))).toBe(false);
  });

  it("aceita lista (usuário PLATFORM) e avisa limite atingido", async () => {
    stub({
      "/organizations": () => json(200, [ORG]),
      "/subscriptions/me": () => json(200, SUB),
      "/dashboard": () => json(200, dashboard(50)),
    });
    renderPage();
    expect(await screen.findByText("Ginga Brasil")).toBeInTheDocument();
    expect(await screen.findByText(/Limite de alunos do plano atingido/)).toBeInTheDocument();
  });

  it("sem assinatura mostra mensagem; erro da API mostra alerta", async () => {
    stub({
      "/organizations": () => json(403, { message: "Sem acesso." }),
      "/subscriptions/me": () => new Response("null", { status: 200 }),
      "/dashboard": () => json(200, dashboard(3)),
    });
    renderPage();
    expect(await screen.findByText(/Nenhuma assinatura ativa/)).toBeInTheDocument();
    expect(await screen.findByText("Sem acesso.")).toBeInTheDocument();
  });
});

type ApiCall = { method: string; path: string; body: unknown };

/** fetch falso por "METHOD /caminho": registra as chamadas e devolve a organização editável. */
function mockOrg(org: Record<string, unknown> = ORG, overrides: Record<string, () => Response> = {}) {
  const calls: ApiCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?")[0] ?? "";
      const method = init.method ?? "GET";
      calls.push({ method, path, body: init.body ? (JSON.parse(init.body as string) as unknown) : undefined });
      const key = `${method} ${path}`;
      const routes: Record<string, () => Response> = {
        "GET /organizations": () => json(200, org),
        "GET /subscriptions/me": () => json(200, SUB),
        "GET /dashboard": () => json(200, dashboard(3)),
        "PATCH /organizations/me": () => json(200, { ...org, name: "Atualizado" }),
        ...overrides,
      };
      return Promise.resolve(routes[key]?.() ?? json(404, { message: `sem rota ${key}` }));
    }),
  );
  return calls;
}
const patches = (calls: ApiCall[]) => calls.filter((c) => c.method === "PATCH");

const FULL_ORG = {
  ...ORG,
  logo: "https://cdn.example.com/logo.png",
  description: "Capoeira desde 1998",
  history: "Fundado por Mestre João.\nCresceu em Goiânia.",
  foundedYear: 1998,
  city: "Goiânia",
  state: "GO",
  website: "https://ginga.example.com",
  socialLinks: { instagram: "https://instagram.com/ginga" },
};

describe("ConfiguracoesPage — editar dados do grupo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    clearSession();
  });

  it("MESTRE vê o botão de edição; o texto 'edição não disponível' sumiu; mostra os novos campos", async () => {
    loginAs("MESTRE");
    mockOrg(FULL_ORG);
    renderPage();
    expect(await screen.findByText("Ginga Brasil")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Editar dados do grupo/ })).toBeInTheDocument();
    expect(screen.queryByText(/ainda não esta disponível|ainda não está disponível/)).not.toBeInTheDocument();
    expect(screen.getByText("1998")).toBeInTheDocument();
    expect(screen.getByText("Goiânia / GO")).toBeInTheDocument();
    expect(screen.getByText("https://ginga.example.com")).toHaveAttribute("href", "https://ginga.example.com");
    expect(screen.getByText("https://instagram.com/ginga")).toBeInTheDocument();
    expect(screen.getByText("Capoeira desde 1998")).toBeInTheDocument();
    expect(screen.getByText(/alterados pela equipe GingApp/)).toBeInTheDocument();
  });

  it("PROFESSOR (e sem sessão) só lê: sem botão de edição", async () => {
    loginAs("PROFESSOR");
    mockOrg(FULL_ORG);
    const first = renderPage();
    expect(await screen.findByText("Ginga Brasil")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar dados do grupo/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Somente o Mestre do grupo pode editar/)).toBeInTheDocument();
    first.unmount();
    clearSession();
    mockOrg(FULL_ORG);
    renderPage();
    expect(await screen.findByText("Ginga Brasil")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar dados do grupo/ })).not.toBeInTheDocument();
  });

  it("abre com os valores atuais; salvar faz PATCH /organizations/me com TUDO (sem slug/status), avisa e recarrega", async () => {
    loginAs("MESTRE");
    const calls = mockOrg(FULL_ORG);
    renderPage();
    await screen.findByText("Ginga Brasil");
    fireEvent.click(screen.getByRole("button", { name: /Editar dados do grupo/ }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Nome do grupo")).toHaveValue("Ginga Brasil"));
    expect(within(dialog).getByLabelText("Ano de fundação")).toHaveValue("1998");
    expect(within(dialog).getByLabelText("UF")).toHaveValue("GO");
    expect(within(dialog).getByLabelText("Instagram")).toHaveValue("https://instagram.com/ginga");
    expect(within(dialog).queryByLabelText(/slug|Identificador/i)).not.toBeInTheDocument(); // imutável: sem campo

    fireEvent.change(within(dialog).getByLabelText("Nome do grupo"), { target: { value: "  Ginga Brasil Capoeira  " } });
    fireEvent.change(within(dialog).getByLabelText("Telefone"), { target: { value: "+55 (62) 3333-4444" } });
    fireEvent.change(within(dialog).getByLabelText("YouTube"), { target: { value: "https://youtube.com/@ginga" } });
    fireEvent.change(within(dialog).getByLabelText("Instagram"), { target: { value: "" } });
    const gets = calls.filter((c) => c.method === "GET").length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(patches(calls)).toHaveLength(1));
    expect(patches(calls)[0]).toMatchObject({ path: "/organizations/me" });
    expect(patches(calls)[0]!.body).toEqual({
      name: "Ginga Brasil Capoeira",
      document: "12.345.678/0001-90",
      email: "contato@gb.com",
      phone: "+55 (62) 3333-4444",
      description: "Capoeira desde 1998",
      history: "Fundado por Mestre João.\nCresceu em Goiânia.",
      foundedYear: 1998,
      city: "Goiânia",
      state: "GO",
      website: "https://ginga.example.com",
      logo: "https://cdn.example.com/logo.png",
      paymentInstructions: null,
      socialLinks: { youtube: "https://youtube.com/@ginga" },
    });
    expect(patches(calls)[0]!.body).not.toHaveProperty("slug");
    expect(patches(calls)[0]!.body).not.toHaveProperty("status");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Dados do grupo atualizados."));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.path === "/organizations").length).toBeGreaterThan(1));
    expect(gets).toBeGreaterThan(0);
  });

  it("esvaziar campos envia null (limpa no servidor); sem redes sociais => socialLinks null", async () => {
    loginAs("MESTRE");
    const calls = mockOrg(FULL_ORG);
    renderPage();
    await screen.findByText("Ginga Brasil");
    fireEvent.click(screen.getByRole("button", { name: /Editar dados do grupo/ }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Cidade")).toHaveValue("Goiânia"));
    for (const label of ["Documento (CNPJ/CPF)", "E-mail", "Apresentação", "História do grupo", "Ano de fundação", "Cidade", "Site", "Instagram"]) {
      fireEvent.change(within(dialog).getByLabelText(label), { target: { value: "" } });
    }
    fireEvent.change(within(dialog).getByLabelText("UF"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(patches(calls)).toHaveLength(1));
    expect(patches(calls)[0]!.body).toEqual({
      name: "Ginga Brasil",
      document: null,
      email: null,
      phone: null,
      description: null,
      history: null,
      foundedYear: null,
      city: null,
      state: null,
      website: null,
      logo: "https://cdn.example.com/logo.png",
      paymentInstructions: null,
      socialLinks: null,
    });
  });

  it("valida no cliente (nome, e-mail, ano, link) e NÃO chama a API enquanto houver erro", async () => {
    loginAs("MESTRE");
    const calls = mockOrg(FULL_ORG);
    renderPage();
    await screen.findByText("Ginga Brasil");
    fireEvent.click(screen.getByRole("button", { name: /Editar dados do grupo/ }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Nome do grupo")).toHaveValue("Ginga Brasil"));
    fireEvent.change(within(dialog).getByLabelText("Nome do grupo"), { target: { value: "A" } });
    fireEvent.change(within(dialog).getByLabelText("E-mail"), { target: { value: "nao-e-email" } });
    fireEvent.change(within(dialog).getByLabelText("Ano de fundação"), { target: { value: "1700" } });
    fireEvent.change(within(dialog).getByLabelText("Site"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText(/mínimo 2 letras/)).toBeInTheDocument();
    expect(within(dialog).getByText("Informe um e-mail válido.")).toBeInTheDocument();
    expect(within(dialog).getByText("O ano deve estar entre 1800 e 2100.")).toBeInTheDocument();
    expect(within(dialog).getByText(/Site: informe um link completo/)).toBeInTheDocument();
    expect(patches(calls)).toHaveLength(0);
  });

  it("erro do servidor aparece em toast e o formulário continua aberto", async () => {
    loginAs("MESTRE");
    mockOrg(FULL_ORG, { "PATCH /organizations/me": () => json(400, { message: "state deve ser a sigla de uma UF brasileira (ex.: GO, SP, RJ)." }) });
    renderPage();
    await screen.findByText("Ginga Brasil");
    fireEvent.click(screen.getByRole("button", { name: /Editar dados do grupo/ }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Nome do grupo")).toHaveValue("Ginga Brasil"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("state deve ser a sigla de uma UF brasileira (ex.: GO, SP, RJ)."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("org-schema", () => {
  it("organizationToForm/Payload: organização sem perfil novo vira formulário vazio e payload todo null", () => {
    const form = organizationToForm({ ...ORG, type: "GROUP" });
    expect(form).toMatchObject({ name: "Ginga Brasil", phone: "", foundedYear: "", state: "", website: "", instagram: "" });
    expect(organizationToPayload(form)).toEqual({
      name: "Ginga Brasil", document: "12.345.678/0001-90", email: "contato@gb.com", phone: null, description: null, history: null,
      foundedYear: null, city: null, state: null, website: null, logo: null, paymentInstructions: null, socialLinks: null,
    });
  });

  it("schema: documento CPF/CNPJ, telefone, ano 1800..2100, UF e links http(s)", () => {
    const ok = organizationToForm({ ...ORG, type: "GROUP" });
    expect(organizationSchema.safeParse(ok).success).toBe(true);
    expect(organizationSchema.safeParse({ ...ok, document: "123" }).success).toBe(false);
    expect(organizationSchema.safeParse({ ...ok, document: "12345678901" }).success).toBe(true);
    expect(organizationSchema.safeParse({ ...ok, phone: "abc" }).success).toBe(false);
    expect(organizationSchema.safeParse({ ...ok, foundedYear: "1799" }).success).toBe(false);
    expect(organizationSchema.safeParse({ ...ok, foundedYear: "2101" }).success).toBe(false);
    expect(organizationSchema.safeParse({ ...ok, foundedYear: "2000" }).success).toBe(true);
    expect(organizationSchema.safeParse({ ...ok, state: "XX" }).success).toBe(false);
    for (const bad of ["ftp://x.com/a", "javascript:alert(1)", "grupo.com.br", "/img/logo.png", "https://sem-ponto"]) {
      expect(organizationSchema.safeParse({ ...ok, logo: bad }).success, bad).toBe(false);
    }
    expect(organizationSchema.safeParse({ ...ok, logo: "https://cdn.example.com/a.png", website: "http://grupo.com.br" }).success).toBe(true);
  });
});
