import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, loginAs } from "./login-as";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlunosPage } from "@/modules/alunos/alunos-page";
import { FichaAlunoDialog } from "@/modules/alunos/ficha-aluno-dialog";
import type { Student } from "@/modules/alunos/schema";
import { GraduacoesPage } from "@/modules/graduacoes/graduacoes-page";
import { ProfessoresPage } from "@/modules/professores/professores-page";
import { RoleBadge, RoleBadges } from "@/components/painel/role-badges";
import { canPromote, promotableGroupRoles, sortBadges, topBadge } from "@/lib/staff-roles";
import { CargosGrupo } from "@/modules/professores/cargos-grupo";
import { clickMenuAction, expectMenuAction, queryMenuAction } from "./row-menu";
import { groupRole, INSTRUTOR_BADGE, MESTRE_BADGE, MONITOR_BADGE, PROFESSOR_BADGE } from "./group-roles";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; query: URLSearchParams; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/** fetch falso: roteia por "METHOD /caminho" (sem prefixo da API NEM query) e registra as chamadas. */
function mockApi(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const [path = "", search = ""] = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
      const method = init.method ?? "GET";
      const call: Call = { method, path, query: new URLSearchParams(search), body: init.body ? JSON.parse(init.body as string) : undefined };
      calls.push(call);
      const handler = routes[`${method} ${path}`];
      return Promise.resolve(handler ? handler(call) : json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  return calls;
}

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const posts = (calls: Call[], path: string) => calls.filter((c) => c.method === "POST" && c.path === path);
const openTab = async (name: string) => {
  const tab = await screen.findByRole("tab", { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
};
const TEMP = "Prov@Senha2026x";

const level = (id: number, name: string, order: number, color: string) => ({
  id,
  name,
  order,
  color,
  style: "SOLID" as const,
  colors: [color],
});
const ROXA = level(5, "Roxa", 5, "#7c3aed");
const PRETA = level(9, "Preta", 8, "#111111");

/** Cargo próprio do grupo (não padrão): Contramestre, entre Mestre e Professor, com perfil de acesso Professor. */
const CONTRAMESTRE = {
  id: 5,
  name: "Contramestre",
  slug: "contramestre",
  color: "#BE123C",
  icon: "star",
  accessRole: "PROFESSOR" as const,
  rank: 35,
};
/** GET /group-roles (rank decrescente): Mestre, Contramestre, Professor, Instrutor, Monitor. */
const groupRolesList = () => [
  groupRole(MESTRE_BADGE, { peopleCount: 1 }),
  groupRole(CONTRAMESTRE, { isDefault: false }),
  groupRole(PROFESSOR_BADGE, { peopleCount: 2 }),
  groupRole(INSTRUTOR_BADGE),
  groupRole(MONITOR_BADGE, { peopleCount: 3 }),
];
const groupRolesRoute = { "GET /group-roles": () => json(200, groupRolesList()) };

const team = [
  {
    id: 10,
    role: "MESTRE",
    roles: [MESTRE_BADGE, PROFESSOR_BADGE],
    status: "ACTIVE",
    unitIds: [],
    user: { id: 1, name: "Mestre Bimba", email: "bimba@x.com", phone: null },
    student: { id: 100, status: "ACTIVE", level: PRETA },
  },
  {
    id: 11,
    role: "PROFESSOR",
    roles: [PROFESSOR_BADGE, MONITOR_BADGE],
    status: "ACTIVE",
    unitIds: [],
    user: { id: 2, name: "Pastinha", email: "pastinha@x.com", phone: null },
    student: { id: 101, status: "ACTIVE", level: ROXA },
  },
  {
    id: 12,
    role: "MONITOR",
    roles: [MONITOR_BADGE],
    status: "ACTIVE",
    unitIds: [],
    user: { id: 3, name: "Zé Monitor", email: "ze@x.com", phone: null },
    student: { id: 102, status: "ACTIVE", level: null },
  },
];
const teamRoutes = () => ({ ...groupRolesRoute, "GET /teachers": () => json(200, team, { "X-Total-Count": String(team.length) }) });
const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

beforeEach(() => {
  localStorage.setItem("painel:alunos:view", "table");
  loginAs("MESTRE");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("hierarquia de cargos", () => {
  it("ordena os selos do maior para o menor rank, acha o principal e oferece só cargos ativos acima do atual", () => {
    expect(sortBadges([MONITOR_BADGE, MESTRE_BADGE, CONTRAMESTRE]).map((b) => b.name)).toEqual(["Mestre", "Contramestre", "Monitor"]);
    expect(topBadge([MONITOR_BADGE, INSTRUTOR_BADGE])?.name).toBe("Instrutor");
    expect(topBadge([])).toBeNull();
    const roles = groupRolesList();
    const names = (current: Parameters<typeof promotableGroupRoles>[1]) => promotableGroupRoles(roles, current).map((r) => r.name);
    expect(names([])).toEqual(["Monitor", "Instrutor", "Professor", "Contramestre", "Mestre"]);
    expect(names([MONITOR_BADGE])).toEqual(["Instrutor", "Professor", "Contramestre", "Mestre"]);
    expect(names([PROFESSOR_BADGE, MONITOR_BADGE])).toEqual(["Contramestre", "Mestre"]);
    expect(names([MESTRE_BADGE])).toEqual([]);
    // inativos não são oferecidos; lista ainda não carregada = não promove
    expect(promotableGroupRoles([groupRole(MESTRE_BADGE, { active: false })], [])).toEqual([]);
    expect(canPromote(undefined, [])).toBe(false);
    expect(canPromote(roles, [MONITOR_BADGE])).toBe(true);
  });
});

describe("selo de cargo", () => {
  it("mostra nome, cor (fundo) e ícone; sem cor/ícone vira selo neutro só com o nome", () => {
    const { container, rerender } = render(<RoleBadge badge={MESTRE_BADGE} />);
    const seal = screen.getByText("Mestre").closest("[data-role-badge]") as HTMLElement;
    expect(seal).toHaveAttribute("data-color", "#B45309");
    expect(seal.style.backgroundColor).toBe("rgb(180, 83, 9)");
    expect(seal.querySelector("svg")).not.toBeNull(); // crown
    rerender(<RoleBadge badge={{ name: "Formado", color: null, icon: null }} />);
    const neutral = screen.getByText("Formado").closest("[data-role-badge]") as HTMLElement;
    expect(neutral).not.toHaveAttribute("data-color");
    expect(neutral.style.backgroundColor).toBe("");
    expect(container.querySelector("svg")).toBeNull();
    rerender(<RoleBadge badge={{ name: "Cor clara", color: "#FDE047", icon: "inexistente" }} />);
    const light = screen.getByText("Cor clara").closest("[data-role-badge]") as HTMLElement;
    expect(light.style.color).toBe("rgb(17, 24, 39)"); // texto escuro sobre fundo claro
    expect(light.querySelector("svg")).toBeNull(); // ícone desconhecido não quebra
  });

  it("RoleBadges desenha do maior para o menor rank e nada sem cargos", () => {
    const { container, rerender } = render(<RoleBadges roles={[MONITOR_BADGE, MESTRE_BADGE, CONTRAMESTRE]} />);
    const seals = within(screen.getByTestId("role-badges")).getAllByText(/./);
    expect(seals.map((n) => n.textContent)).toEqual(["Mestre", "Contramestre", "Monitor"]);
    rerender(<RoleBadges roles={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("Equipe: selos, corda e filtro por cargo", () => {
  it("mostra todos os cargos de cada pessoa e a corda do aluno ligado", async () => {
    mockApi(teamRoutes());
    renderPage(<ProfessoresPage />);
    await screen.findByText("Pastinha");
    expect(screen.getByRole("heading", { name: "Equipe" })).toBeInTheDocument();
    const pastinha = within(rowOf("Pastinha"));
    expect(pastinha.getByText("Professor")).toBeInTheDocument();
    expect(pastinha.getByText("Monitor")).toBeInTheDocument();
    expect(pastinha.getByText("Roxa")).toBeInTheDocument();
    expect(pastinha.getByRole("img", { name: /Corda sólida/ })).toBeInTheDocument();
    const bimba = within(rowOf("Mestre Bimba"));
    expect(bimba.getByText("Mestre")).toBeInTheDocument();
    expect(bimba.getByText("Professor")).toBeInTheDocument();
    expect(within(rowOf("Zé Monitor")).queryByRole("img")).toBeNull(); // sem graduação: sem corda
  });

  it("filtro por cargo lista os cargos do grupo e vai ao servidor (?groupRoleId=)", async () => {
    const calls = mockApi(teamRoutes());
    renderPage(<ProfessoresPage />);
    await screen.findByText("Pastinha");
    const filter = screen.getByLabelText("Filtrar por cargo");
    await waitFor(() => expect(within(filter).getAllByRole("option")).toHaveLength(6));
    expect(within(filter).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Todos os cargos",
      "Mestre",
      "Contramestre",
      "Professor",
      "Instrutor",
      "Monitor",
    ]);
    fireEvent.change(filter, { target: { value: String(CONTRAMESTRE.id) } });
    await waitFor(() => expect(calls.filter((c) => c.path === "/teachers").at(-1)!.query.get("groupRoleId")).toBe("5"));
    expect(calls.filter((c) => c.path === "/teachers").at(-1)!.query.has("role")).toBe(false);
  });

  it("criar membro escolhe o perfil de acesso (POST /teachers com o perfil)", async () => {
    const calls = mockApi({ ...teamRoutes(), "POST /teachers": () => json(201, { id: 13 }) });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Pastinha");
    fireEvent.click(screen.getByRole("button", { name: /Novo membro/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(within(dialog).getByLabelText("Perfil de acesso")).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual([
      "MONITOR",
      "INSTRUTOR",
      "PROFESSOR",
      "MESTRE",
    ]);
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Nova Instrutora" } });
    fireEvent.change(within(dialog).getByLabelText("E-mail"), { target: { value: "nova@x.com" } });
    fireEvent.change(within(dialog).getByLabelText("Senha inicial"), { target: { value: "segredo1" } });
    fireEvent.change(within(dialog).getByLabelText("Perfil de acesso"), { target: { value: "INSTRUTOR" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(posts(calls, "/teachers")).toHaveLength(1));
    expect(posts(calls, "/teachers")[0]!.body).toMatchObject({ name: "Nova Instrutora", email: "nova@x.com", role: "INSTRUTOR" });
  });

  it("unidades de atuação e redefinir senha valem para qualquer cargo que não seja Mestre (ex.: Monitor)", async () => {
    mockApi(teamRoutes());
    renderPage(<ProfessoresPage />);
    await screen.findByText("Zé Monitor");
    await expectMenuAction("Unidades de atuação de Zé Monitor");
    await expectMenuAction("Redefinir senha de Zé Monitor");
    expect(queryMenuAction("Unidades de atuação de Mestre Bimba")).toBeNull();
  });
});

describe("Equipe: Promover a… e Revogar cargo", () => {
  it("Promover a… oferece só cargos ativos maiores e chama POST /roles/grant com studentId e groupRoleId", async () => {
    const calls = mockApi({ ...teamRoutes(), "POST /roles/grant": () => json(201, { studentId: 102, userId: 3, roles: [PROFESSOR_BADGE, MONITOR_BADGE], roleKeys: ["professor", "monitor"], accessRole: "PROFESSOR" }) });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Pastinha");
    await clickMenuAction("Promover Pastinha");
    let dialog = await screen.findByRole("dialog", { name: "Promover a…" });
    // Pastinha é Professor (rank 30): acima dele só o Contramestre (35, cargo do grupo) e o Mestre
    await waitFor(() =>
      expect(within(within(dialog).getByLabelText("Novo cargo")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Contramestre", "Mestre"]),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(queryMenuAction("Promover Mestre Bimba")).toBeNull(); // já tem o maior cargo

    await clickMenuAction("Promover Zé Monitor");
    dialog = await screen.findByRole("dialog", { name: "Promover a…" });
    const select = within(dialog).getByLabelText("Novo cargo");
    await waitFor(() =>
      expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Instrutor", "Professor", "Contramestre", "Mestre"]),
    );
    fireEvent.change(select, { target: { value: String(PROFESSOR_BADGE.id) } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Promover$/ }));
    await waitFor(() => expect(posts(calls, "/roles/grant")).toHaveLength(1));
    expect(posts(calls, "/roles/grant")[0]!.body).toEqual({ studentId: 102, groupRoleId: PROFESSOR_BADGE.id });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Zé Monitor agora é Professor."));
  });

  it("Promover a… com cargo próprio do grupo envia o groupRoleId dele e usa o nome no aviso", async () => {
    const calls = mockApi({ ...teamRoutes(), "POST /roles/grant": () => json(201, { studentId: 101, userId: 2, roles: [CONTRAMESTRE], accessRole: "PROFESSOR" }) });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Pastinha");
    await clickMenuAction("Promover Pastinha");
    const dialog = await screen.findByRole("dialog", { name: "Promover a…" });
    await waitFor(() => expect(within(dialog).getByLabelText("Novo cargo")).toHaveValue("5")); // Contramestre vem escolhido
    fireEvent.click(within(dialog).getByRole("button", { name: /Promover$/ }));
    await waitFor(() => expect(posts(calls, "/roles/grant")).toHaveLength(1));
    expect(posts(calls, "/roles/grant")[0]!.body).toEqual({ studentId: 101, groupRoleId: 5 });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pastinha agora é Contramestre."));
  });

  it("LOGIN_REQUIRED: pede e-mail e senha provisória e reenvia o pedido com os dados do acesso", async () => {
    let attempt = 0;
    const calls = mockApi({
      ...teamRoutes(),
      "POST /roles/grant": () =>
        ++attempt === 1
          ? json(400, { statusCode: 400, message: "Esta pessoa ainda não tem login.", code: "LOGIN_REQUIRED" })
          : json(201, { studentId: 102, userId: 9, roles: [INSTRUTOR_BADGE, MONITOR_BADGE], accessRole: "INSTRUTOR" }),
    });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Zé Monitor");
    await clickMenuAction("Promover Zé Monitor");
    const promote = await screen.findByRole("dialog", { name: "Promover a…" });
    await waitFor(() => expect(within(promote).getByLabelText("Novo cargo")).toHaveValue("3"));
    fireEvent.click(within(promote).getByRole("button", { name: /Promover$/ })); // Instrutor (o próximo cargo)
    const access = await screen.findByRole("dialog", { name: "Criar acesso para conceder o cargo" });
    expect(posts(calls, "/roles/grant")[0]!.body).toEqual({ studentId: 102, groupRoleId: 3 });
    expect(within(access).getByLabelText("E-mail de acesso")).toHaveValue("ze@x.com");
    fireEvent.change(within(access).getByLabelText("E-mail de acesso"), { target: { value: "ze.novo@x.com" } });
    fireEvent.change(within(access).getByLabelText("Senha provisória"), { target: { value: TEMP } });
    fireEvent.change(within(access).getByLabelText("Confirmar senha provisória"), { target: { value: TEMP } });
    fireEvent.click(within(access).getByRole("button", { name: "Criar acesso" }));
    await waitFor(() => expect(posts(calls, "/roles/grant")).toHaveLength(2));
    expect(posts(calls, "/roles/grant")[1]!.body).toEqual({ studentId: 102, groupRoleId: 3, email: "ze.novo@x.com", password: TEMP });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Zé Monitor agora é Instrutor."));
  });

  it("409 de negócio (aluno inativo) vira toast em português e mantém o diálogo", async () => {
    mockApi({ ...teamRoutes(), "POST /roles/grant": () => json(409, { message: "x", code: "STUDENT_NOT_ACTIVE" }) });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Zé Monitor");
    await clickMenuAction("Promover Zé Monitor");
    const promote = await screen.findByRole("dialog", { name: "Promover a…" });
    await waitFor(() => expect(within(promote).getByLabelText("Novo cargo")).toHaveValue("3"));
    fireEvent.click(within(promote).getByRole("button", { name: /Promover$/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("A matrícula do aluno precisa estar ativa para receber um cargo."));
    expect(screen.getByRole("dialog", { name: "Promover a…" })).toBeInTheDocument();
  });

  it("Revogar cargo pede confirmação e chama POST /roles/revoke com o cargo escolhido", async () => {
    const calls = mockApi({ ...teamRoutes(), "POST /roles/revoke": () => json(200, { studentId: 101, userId: 2, roles: [MONITOR_BADGE], accessRole: "MONITOR" }) });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Pastinha");
    await clickMenuAction("Revogar cargo de Pastinha");
    const dialog = await screen.findByRole("dialog", { name: "Revogar cargo?" });
    expect(posts(calls, "/roles/revoke")).toHaveLength(0); // só confirma com o clique
    const select = within(dialog).getByLabelText("Cargo a revogar");
    expect(select).toHaveValue(String(PROFESSOR_BADGE.id)); // o cargo de maior rank vem escolhido
    fireEvent.click(within(dialog).getByRole("button", { name: "Revogar cargo" }));
    await waitFor(() => expect(posts(calls, "/roles/revoke")).toHaveLength(1));
    expect(posts(calls, "/roles/revoke")[0]!.body).toEqual({ studentId: 101, groupRoleId: PROFESSOR_BADGE.id });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Cargo de Professor revogado de Pastinha")));
  });

  it("LAST_MESTRE: explica que é o último Mestre e mantém o diálogo aberto", async () => {
    mockApi({ ...teamRoutes(), "POST /roles/revoke": () => json(409, { message: "last", code: "LAST_MESTRE" }) });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Mestre Bimba");
    await clickMenuAction("Revogar cargo de Mestre Bimba");
    const dialog = await screen.findByRole("dialog", { name: "Revogar cargo?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revogar cargo" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("último Mestre")));
    expect(screen.getByRole("dialog", { name: "Revogar cargo?" })).toBeInTheDocument();
  });

  it("só o Mestre vê Promover/Revogar e a aba de sugestões (Professor e Instrutor só leem a equipe)", async () => {
    for (const role of ["PROFESSOR", "INSTRUTOR"] as const) {
      loginAs(role);
      mockApi(teamRoutes());
      const view = renderPage(<ProfessoresPage />);
      await screen.findByText("Pastinha");
      expect(screen.queryByRole("tab", { name: "Sugestões de promoção" })).toBeNull();
      expect(screen.queryByRole("button", { name: /Promover/ })).toBeNull();
      expect(queryMenuAction(/Revogar cargo/)).toBeNull();
      expect(screen.queryByRole("button", { name: /Novo membro/ })).toBeNull();
      view.unmount();
    }
  });
});

describe("Equipe: sugestões de promoção", () => {
  const suggestions = [
    {
      studentId: 7,
      personId: 70,
      name: "Ana Souza",
      photo: null,
      hasLogin: true,
      currentRoles: [MONITOR_BADGE],
      role: INSTRUTOR_BADGE,
      groupRoleId: INSTRUTOR_BADGE.id,
      accessRole: "INSTRUTOR",
      level: ROXA,
      system: { id: 1, name: "Cordas" },
      graduatedAt: "2026-03-10T00:00:00.000Z",
    },
    {
      studentId: 8,
      personId: 80,
      name: "Bia Lima",
      photo: null,
      hasLogin: false,
      currentRoles: [],
      role: MONITOR_BADGE,
      groupRoleId: MONITOR_BADGE.id,
      accessRole: "MONITOR",
      level: level(3, "Azul", 3, "#2563eb"),
      system: { id: 1, name: "Cordas" },
      graduatedAt: "2026-01-05T00:00:00.000Z",
    },
  ];

  it("lista nome, corda atingida e cargo sugerido; Confirmar chama POST /roles/grant", async () => {
    const calls = mockApi({
      ...teamRoutes(),
      "GET /roles/suggestions": () => json(200, suggestions),
      "POST /roles/grant": () => json(201, { studentId: 7, userId: 4, roles: [INSTRUTOR_BADGE, MONITOR_BADGE], accessRole: "INSTRUTOR" }),
    });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Pastinha");
    expect(calls.some((c) => c.path === "/roles/suggestions")).toBe(false); // só carrega ao abrir a aba
    await openTab("Sugestões de promoção");
    const items = await screen.findAllByTestId("suggestion");
    expect(items).toHaveLength(2);
    const ana = within(items[0]!);
    expect(ana.getByText("Ana Souza")).toBeInTheDocument();
    expect(ana.getByText("Roxa")).toBeInTheDocument();
    expect(ana.getByRole("img", { name: /Corda sólida/ })).toBeInTheDocument();
    expect(ana.getAllByText("Instrutor")).toHaveLength(1); // cargo sugerido (selo com a cor do cargo)
    expect(ana.getByText("Instrutor").closest("[data-role-badge]")).toHaveAttribute("data-color", "#047857");
    expect(ana.getByText("Monitor")).toBeInTheDocument(); // cargo atual
    expect(within(items[1]!).getByText("Sem login")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar Instrutor para Ana Souza" }));
    await waitFor(() => expect(posts(calls, "/roles/grant")).toHaveLength(1));
    expect(posts(calls, "/roles/grant")[0]!.body).toEqual({ studentId: 7, groupRoleId: 3 });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ana Souza agora é Instrutor."));
  });

  it("confirmar quem não tem login pede e-mail e senha provisória e reenvia", async () => {
    let attempt = 0;
    const calls = mockApi({
      ...teamRoutes(),
      "GET /roles/suggestions": () => json(200, suggestions),
      "POST /roles/grant": () =>
        ++attempt === 1 ? json(400, { message: "sem login", code: "LOGIN_REQUIRED" }) : json(201, { studentId: 8, userId: 5, roles: [MONITOR_BADGE], accessRole: "MONITOR" }),
    });
    renderPage(<ProfessoresPage />);
    await openTab("Sugestões de promoção");
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar Monitor para Bia Lima" }));
    const access = await screen.findByRole("dialog", { name: "Criar acesso para conceder o cargo" });
    fireEvent.change(within(access).getByLabelText("E-mail de acesso"), { target: { value: "bia@x.com" } });
    fireEvent.change(within(access).getByLabelText("Senha provisória"), { target: { value: TEMP } });
    fireEvent.change(within(access).getByLabelText("Confirmar senha provisória"), { target: { value: TEMP } });
    fireEvent.click(within(access).getByRole("button", { name: "Criar acesso" }));
    await waitFor(() => expect(posts(calls, "/roles/grant")).toHaveLength(2));
    expect(posts(calls, "/roles/grant")[1]!.body).toEqual({ studentId: 8, groupRoleId: 4, email: "bia@x.com", password: TEMP });
  });

  it("vazio e erro", async () => {
    mockApi({ ...teamRoutes(), "GET /roles/suggestions": () => json(200, []) });
    const first = renderPage(<ProfessoresPage />);
    await openTab("Sugestões de promoção");
    expect(await screen.findByTestId("suggestions-empty")).toBeInTheDocument();
    first.unmount();
    mockApi({ ...teamRoutes(), "GET /roles/suggestions": () => json(500, { message: "Falhou." }) });
    renderPage(<ProfessoresPage />);
    await openTab("Sugestões de promoção");
    expect(await screen.findByTestId("suggestions-error")).toHaveTextContent("Falhou.");
  });
});

describe("Graduações: cargos por corda", () => {
  const levels = [level(1, "Crua", 0, "#f5f1e6"), level(2, "Amarela", 1, "#facc15"), level(3, "Roxa", 2, "#7c3aed")].map((l) => ({
    ...l,
    graduationSystemId: 1,
  }));
  const systemsData = [{ id: 1, name: "Cordas", description: null, isActive: true, levels }];
  const rules = {
    systemId: 1,
    rules: [{ groupRoleId: 2, groupRole: { ...PROFESSOR_BADGE, active: true }, role: "PROFESSOR", minLevelOrder: 2, level: levels[2] }],
  };
  const routes = (put?: (call: Call) => Response) => ({
    ...groupRolesRoute,
    "GET /graduations/systems": () => json(200, systemsData),
    "GET /graduations/systems/1/role-rules": () => json(200, rules),
    ...(put ? { "PUT /graduations/systems/1/role-rules": put } : {}),
  });
  const openRules = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Cargos por corda em Cordas" }));
    await screen.findByLabelText("Corda mínima de Professor em Cordas");
  };

  it("mostra uma linha por cargo ativo do grupo (inclusive os próprios), a regra salva e 'Sem regra' nos demais", async () => {
    mockApi(routes());
    renderPage(<GraduacoesPage />);
    await openRules();
    expect(screen.getByLabelText("Corda mínima de Professor em Cordas")).toHaveValue("2");
    expect(screen.getByLabelText("Corda mínima de Mestre em Cordas")).toHaveValue("");
    expect(screen.getByLabelText("Corda mínima de Monitor em Cordas")).toHaveValue("");
    expect(screen.getByLabelText("Corda mínima de Contramestre em Cordas")).toHaveValue(""); // cargo próprio do grupo
    const options = within(screen.getByLabelText("Corda mínima de Monitor em Cordas")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Sem regra", "Crua", "Amarela", "Roxa"]);
    const form = within(screen.getByTestId("role-rules-1"));
    expect(form.getAllByRole("img", { name: /Corda sólida/ })).toHaveLength(1); // a corda do Professor
  });

  it("salvar envia PUT .../role-rules com {groupRoleId, minLevelOrder} só dos cargos com regra", async () => {
    const calls = mockApi(routes(() => json(200, rules)));
    renderPage(<GraduacoesPage />);
    await openRules();
    expect(screen.getByRole("button", { name: "Salvar regras" })).toBeDisabled(); // nada mudou
    fireEvent.change(screen.getByLabelText("Corda mínima de Monitor em Cordas"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Corda mínima de Instrutor em Cordas"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Corda mínima de Contramestre em Cordas"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Corda mínima de Professor em Cordas"), { target: { value: "" } }); // remove a regra
    fireEvent.click(screen.getByRole("button", { name: "Salvar regras" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.path).toBe("/graduations/systems/1/role-rules");
    expect(put.body).toEqual({
      rules: [
        { groupRoleId: 4, minLevelOrder: 0 },
        { groupRoleId: 3, minLevelOrder: 1 },
        { groupRoleId: 5, minLevelOrder: 2 },
      ],
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Regras de cargo por corda salvas."));
  });

  it("erro 400 INVALID_LEVEL_ORDER vira toast em português", async () => {
    mockApi(routes(() => json(400, { message: "x", code: "INVALID_LEVEL_ORDER" })));
    renderPage(<GraduacoesPage />);
    await openRules();
    fireEvent.change(screen.getByLabelText("Corda mínima de Mestre em Cordas"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar regras" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("O nível escolhido não pertence a este sistema de graduação."));
  });

  it("quem não é Mestre só lê: selects desabilitados e sem Salvar", async () => {
    loginAs("PROFESSOR");
    mockApi(routes());
    renderPage(<GraduacoesPage />);
    await openRules();
    expect(screen.getByLabelText("Corda mínima de Professor em Cordas")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Salvar regras" })).toBeNull();
  });
});

describe("Alunos: cargos", () => {
  const students = [
    { id: 1, unitId: null, userId: 50, name: "Ana Souza", birthDate: null, document: null, phone: null, email: "ana@x.com", status: "ACTIVE", joinedAt: null, staffRoles: [MONITOR_BADGE] },
    { id: 2, unitId: null, userId: null, name: "Caio Lima", birthDate: null, document: null, phone: null, email: null, status: "ACTIVE", joinedAt: null, staffRoles: [] },
    { id: 3, unitId: null, userId: 52, name: "Duda Reis", birthDate: null, document: null, phone: null, email: null, status: "ACTIVE", joinedAt: null, staffRoles: [MESTRE_BADGE, PROFESSOR_BADGE] },
  ];
  const routes = () => ({ ...groupRolesRoute, "GET /students": () => json(200, students, { "X-Total-Count": "3" }) });

  it("selos de cargo na lista e filtro 'Cargo' (?groupRoleId=) com os cargos do grupo", async () => {
    const calls = mockApi(routes());
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    expect(within(rowOf("Ana Souza")).getByText("Monitor")).toBeInTheDocument();
    const duda = within(rowOf("Duda Reis"));
    expect(duda.getByText("Mestre")).toBeInTheDocument();
    expect(duda.getByText("Professor")).toBeInTheDocument();
    expect(within(rowOf("Caio Lima")).queryByTestId("role-badges")).toBeNull();
    const filter = screen.getByLabelText("Filtrar por cargo");
    await waitFor(() => expect(within(filter).getAllByRole("option")).toHaveLength(6));
    expect(within(filter).getByRole("option", { name: "Contramestre" })).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: String(PROFESSOR_BADGE.id) } });
    await waitFor(() => expect(calls.filter((c) => c.path === "/students").at(-1)!.query.get("groupRoleId")).toBe("2"));
  });

  it("Promover a… no aluno: só para o Mestre, e oferece os cargos acima do atual", async () => {
    const calls = mockApi({ ...routes(), "POST /roles/grant": () => json(201, { studentId: 1, userId: 50, roles: [INSTRUTOR_BADGE, MONITOR_BADGE], accessRole: "INSTRUTOR" }) });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    await clickMenuAction("Promover Ana Souza");
    const dialog = await screen.findByRole("dialog", { name: "Promover a…" });
    await waitFor(() =>
      expect(within(within(dialog).getByLabelText("Novo cargo")).getAllByRole("option").map((o) => o.textContent)).toEqual([
        "Instrutor",
        "Professor",
        "Contramestre",
        "Mestre",
      ]),
    );
    expect(queryMenuAction("Promover Duda Reis")).toBeNull(); // já é Mestre
    fireEvent.click(within(dialog).getByRole("button", { name: /Promover$/ }));
    await waitFor(() => expect(posts(calls, "/roles/grant")).toHaveLength(1));
    expect(posts(calls, "/roles/grant")[0]!.body).toEqual({ studentId: 1, groupRoleId: 3 });
  });

  it("Professor não vê Promover a…", async () => {
    loginAs("PROFESSOR");
    mockApi(routes());
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    expect(screen.queryByRole("button", { name: /Promover/ })).toBeNull();
  });
});

describe("Ficha: cargos", () => {
  const student: Student = { id: 1, unitId: null, name: "Ana Souza", birthDate: null, document: null, phone: null, email: null, status: "ACTIVE", joinedAt: null };
  const ficha = {
    person: { id: 70, gingappCode: "GING-AAAA-BBBB", name: "Ana Souza", nickname: null, birthDate: null, photo: null, documentMasked: null, documentKind: null },
    enrollments: [
      { studentId: 1, organization: { id: 1, name: "Grupo Axé", logoUrl: null }, unit: null, status: "ACTIVE", since: "2025-01-01T00:00:00.000Z", until: null, isCurrent: true, roles: [PROFESSOR_BADGE, MONITOR_BADGE] },
    ],
    roles: [
      { organization: { id: 1, name: "Grupo Axé" }, role: "PROFESSOR", groupRole: PROFESSOR_BADGE, grantedAt: "2026-02-01T00:00:00.000Z" },
      { organization: { id: 1, name: "Grupo Axé" }, role: "MONITOR", groupRole: MONITOR_BADGE, grantedAt: "2025-06-01T00:00:00.000Z" },
    ],
    graduations: [],
    attendanceByGroup: [],
    certificates: [],
    sharedFromOtherGroups: [],
    scope: "OWN_GROUP",
  };

  it("mostra os cargos da matrícula e a lista de cargos por grupo", async () => {
    mockApi({ "GET /students/1/ficha": () => json(200, ficha) });
    renderPage(<FichaAlunoDialog student={student} onClose={() => {}} />);
    const roles = await screen.findByTestId("ficha-roles");
    expect(within(roles).getByText("Professor").closest("[data-role-badge]")).toHaveAttribute("data-color", "#1D4ED8");
    expect(within(roles).getByText("Monitor")).toBeInTheDocument();
    expect(within(roles).getAllByText("Grupo Axé")).toHaveLength(2);
    expect(within(roles).getByText(/desde 01\/02\/2026/)).toBeInTheDocument();
    expect(screen.getAllByTestId("role-badges")).toHaveLength(1); // selos da matrícula
  });
});

describe("Cargos do grupo", () => {
  it("lista os cargos (selo, perfil de acesso, pessoas, padrão) e o Mestre vê criar/ordenar/editar", async () => {
    mockApi(groupRolesRoute);
    renderPage(<CargosGrupo />);
    const items = await screen.findAllByTestId("group-role");
    expect(items.map((li) => within(li).getAllByText(/./)[0]!.textContent)).toEqual(["Mestre", "Contramestre", "Professor", "Instrutor", "Monitor"]);
    const contra = within(items[1]!);
    expect(contra.getByText("Acesso:").parentElement).toHaveTextContent("Acesso: Professor");
    expect(contra.getByText("0 pessoas")).toBeInTheDocument();
    expect(contra.queryByText("Padrão")).toBeNull(); // cargo próprio do grupo
    expect(within(items[0]!).getByText("Padrão")).toBeInTheDocument();
    expect(within(items[4]!).getByText("3 pessoas")).toBeInTheDocument();
    expect(screen.getByText("5 de 20 cargos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Novo cargo" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Subir Mestre" })).toBeDisabled(); // já é o primeiro
    expect(screen.getByRole("button", { name: "Descer Mestre" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Descer Monitor" })).toBeDisabled(); // já é o último
    expect(screen.getByRole("button", { name: "Editar cargo Contramestre" })).toBeInTheDocument();
  });

  it("quem não é Mestre só lê a lista: sem Novo cargo, ordenar nem editar", async () => {
    loginAs("PROFESSOR");
    mockApi(groupRolesRoute);
    renderPage(<CargosGrupo />);
    await screen.findAllByTestId("group-role");
    expect(screen.getAllByTestId("group-role")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: "Novo cargo" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Subir / })).toBeNull();
    expect(screen.queryByRole("button", { name: /Editar cargo/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Mais ações/ })).toBeNull();
  });

  it("na Equipe, a aba 'Cargos do grupo' é só do Mestre", async () => {
    mockApi(teamRoutes());
    const mestre = renderPage(<ProfessoresPage />);
    await screen.findByText("Pastinha");
    expect(screen.getByRole("tab", { name: "Cargos do grupo" })).toBeInTheDocument();
    mestre.unmount();
    loginAs("PROFESSOR");
    mockApi(teamRoutes());
    renderPage(<ProfessoresPage />);
    await screen.findByText("Pastinha");
    expect(screen.queryByRole("tab", { name: "Cargos do grupo" })).toBeNull();
  });

  it("subir/descer envia PUT /group-roles/reorder com TODOS os ids na nova ordem", async () => {
    const calls = mockApi({ ...groupRolesRoute, "PUT /group-roles/reorder": () => json(200, groupRolesList()) });
    renderPage(<CargosGrupo />);
    fireEvent.click(await screen.findByRole("button", { name: "Subir Instrutor" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1));
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ order: [1, 5, 3, 2, 4] });
  });

  it("novo cargo: perfil em cartões, cor, ícone e POST /group-roles; erro do servidor vira toast com a message", async () => {
    let attempt = 0;
    const calls = mockApi({
      ...groupRolesRoute,
      "POST /group-roles": () =>
        ++attempt === 1
          ? json(409, { statusCode: 409, message: "Já existe um cargo com este nome.", code: "GROUP_ROLE_NAME_TAKEN" })
          : json(201, groupRole(CONTRAMESTRE, { isDefault: false })),
    });
    renderPage(<CargosGrupo />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo cargo" }));
    const dialog = await screen.findByRole("dialog", { name: "Novo cargo" });
    expect(within(dialog).getAllByRole("radio")).toHaveLength(4); // cartões: Mestre, Professor, Instrutor, Monitor
    expect(within(dialog).getByTestId("access-card-MESTRE")).toHaveTextContent(/financeiro, cargos e ocorrências/);
    expect(within(dialog).getByTestId("access-card-PROFESSOR")).toHaveAttribute("aria-checked", "true"); // padrão
    fireEvent.change(within(dialog).getByLabelText("Nome do cargo"), { target: { value: "x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText(/de 2 a 30 caracteres/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText("Nome do cargo"), { target: { value: "Contramestre" } });
    fireEvent.click(within(dialog).getByTestId("access-card-INSTRUTOR"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cor Vermelho" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Ícone star" }));
    expect(within(dialog).getByTestId("cargo-preview")).toHaveTextContent("Contramestre");
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Já existe um cargo com este nome."));
    expect(screen.getByRole("dialog", { name: "Novo cargo" })).toBeInTheDocument(); // continua aberto
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(posts(calls, "/group-roles")).toHaveLength(2));
    expect(posts(calls, "/group-roles")[1]!.body).toEqual({ name: "Contramestre", accessRole: "INSTRUTOR", color: "#BE123C", icon: "star" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Cargo "Contramestre" criado.'));
  });

  it("excluir cargo com gente oferece 'Migrar pessoas para…' e migra antes de excluir", async () => {
    const roles = groupRolesList();
    roles[1] = groupRole(CONTRAMESTRE, { isDefault: false, peopleCount: 2 });
    const calls = mockApi({
      "GET /group-roles": () => json(200, roles),
      "POST /group-roles/5/migrate": () => json(200, { moved: 2, from: { id: 5, name: "Contramestre" }, to: { id: 2, name: "Professor" } }),
      "DELETE /group-roles/5": () => new Response(null, { status: 204 }),
    });
    renderPage(<CargosGrupo />);
    await screen.findAllByTestId("group-role");
    await clickMenuAction("Excluir cargo Contramestre");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("2 pessoas exercem este cargo");
    const select = within(dialog).getByLabelText("Migrar pessoas para…");
    expect(select).toHaveValue("2"); // mesmo perfil de acesso (Professor) e rank mais próximo
    expect(within(select).queryByRole("option", { name: "Contramestre" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Migrar e excluir" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(calls.find((c) => c.path === "/group-roles/5/migrate")!.body).toEqual({ targetGroupRoleId: 2 });
    expect(calls.findIndex((c) => c.method === "POST")).toBeLessThan(calls.findIndex((c) => c.method === "DELETE"));
  });

  it("os cargos padrão não têm 'Excluir' (só renomear/inativar)", async () => {
    mockApi(groupRolesRoute);
    renderPage(<CargosGrupo />);
    await screen.findAllByTestId("group-role");
    await expectMenuAction("Excluir cargo Contramestre");
    expect(queryMenuAction("Excluir cargo Monitor")).toBeNull();
    expect(queryMenuAction("Inativar cargo Monitor")).not.toBeNull();
  });
});
