import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { clearSession, loginAs } from "./login-as";
import { routeTree } from "@/routeTree.gen";
import { saveSession, type AuthUser } from "@/lib/session";
import { computeFirstSteps, countDone, readFirstStepsFlag, writeFirstStepsFlag } from "@/lib/first-steps";

type Call = { method: string; path: string; query: URLSearchParams };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const SUMMARY = {
  students: { active: 0, new30d: 0, inactive: 0 },
  classes: { active: 0 },
  lessonsToday: 0,
  attendance: { last30dPercent: null },
  graduations: { last30d: 0 },
  upcomingEvents: [],
};

/** Estado do grupo no servidor simulado; cada teste muda só o que importa. */
interface World {
  org: Record<string, unknown>;
  units: Array<Record<string, unknown>>;
  classesTotal: number;
  teachersTotal: number;
  studentsTotal: number;
  /** Rotas que devem falhar com 500. */
  failing: string[];
}
const emptyWorld = (): World => ({
  org: { id: 1, name: "Grupo", slug: "g", type: "GROUP", status: "ACTIVE", document: null, email: null, phone: null, city: null, state: null, description: null },
  units: [{ id: 1, organizationId: 1, name: "Matriz", address: null, city: null, state: null, isMain: true, status: "ACTIVE" }],
  classesTotal: 0,
  teachersTotal: 0,
  studentsTotal: 0,
  failing: [],
});

function mockApi(world: World) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const [path = "", search = ""] = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
      const method = init.method ?? "GET";
      calls.push({ method, path, query: new URLSearchParams(search) });
      if (method !== "GET") return Promise.resolve(json(404, { message: "sem rota" }));
      if (world.failing.includes(path)) return Promise.resolve(json(500, { message: "falhou" }));
      const page = (total: number) => json(200, total > 0 ? [{ id: 1 }] : [], { "X-Total-Count": String(total) });
      switch (path) {
        case "/dashboard":
          return Promise.resolve(json(200, SUMMARY));
        case "/organizations":
          return Promise.resolve(json(200, world.org));
        case "/units":
          return Promise.resolve(json(200, world.units, { "X-Total-Count": String(world.units.length) }));
        case "/classes":
          return Promise.resolve(page(world.classesTotal));
        case "/teachers":
          return Promise.resolve(page(world.teachersTotal));
        case "/students":
          return Promise.resolve(page(world.studentsTotal));
        default:
          return Promise.resolve(json(404, { message: `sem rota ${path}` }));
      }
    }),
  );
  return calls;
}

function renderDashboard() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/dashboard"] }),
    context: { queryClient: new QueryClient() },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const ROWS = ["profile", "matriz", "class", "people", "app"] as const;
const card = () => screen.findByTestId("first-steps");
const doneOf = (id: (typeof ROWS)[number]) => screen.getByTestId(`first-step-${id}`).getAttribute("data-done");

beforeEach(() => {
  localStorage.clear();
  loginAs("MESTRE");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
  localStorage.clear();
});

describe("regra dos passos (lib/first-steps)", () => {
  const base = { organization: null, units: null, classesTotal: null, teachersTotal: null, studentsTotal: null, appOpened: false };

  it("nada carregado = nada cumprido", () => {
    expect(countDone(computeFirstSteps(base))).toBe(0);
  });

  it("perfil exige cidade, UF e apresentação (espaços não contam)", () => {
    const profile = (organization: Record<string, string | null>) => computeFirstSteps({ ...base, organization }).profile;
    expect(profile({ city: "Salvador", state: "BA", description: "Grupo de capoeira." })).toBe(true);
    expect(profile({ city: "Salvador", state: "BA", description: "  " })).toBe(false);
    expect(profile({ city: "Salvador", state: null, description: "x" })).toBe(false);
    expect(profile({ city: "", state: "BA", description: "x" })).toBe(false);
  });

  it("Matriz: precisa existir uma unidade principal COM endereço (filial com endereço não vale)", () => {
    const matriz = (units: Array<{ isMain: boolean; address: string | null }>) => computeFirstSteps({ ...base, units }).matriz;
    expect(matriz([{ isMain: true, address: "Rua A, 1" }])).toBe(true);
    expect(matriz([{ isMain: true, address: "  " }])).toBe(false);
    expect(matriz([{ isMain: true, address: null }, { isMain: false, address: "Rua B" }])).toBe(false);
    expect(matriz([])).toBe(false);
  });

  it("pessoas: 1 professor OU 1 aluno; app: só pela marca local", () => {
    expect(computeFirstSteps({ ...base, teachersTotal: 1 }).people).toBe(true);
    expect(computeFirstSteps({ ...base, studentsTotal: 1 }).people).toBe(true);
    expect(computeFirstSteps({ ...base, teachersTotal: 0, studentsTotal: 0 }).people).toBe(false);
    expect(computeFirstSteps({ ...base, appOpened: true }).app).toBe(true);
  });

  it("marcas por usuário em localStorage; indisponível = falso, sem lançar", () => {
    writeFirstStepsFlag(7, "dismissed");
    expect(readFirstStepsFlag(7, "dismissed")).toBe(true);
    expect(readFirstStepsFlag(8, "dismissed")).toBe(false);
    expect(readFirstStepsFlag(7, "app")).toBe(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(readFirstStepsFlag(7, "dismissed")).toBe(false);
    expect(() => writeFirstStepsFlag(7, "app")).not.toThrow();
  });
});

describe("cartão 'Primeiros passos' no dashboard do MESTRE", () => {
  it("grupo recém-criado: 0 de 5, os 5 passos pendentes, barra zerada, links para as telas certas e consultas leves", async () => {
    const calls = mockApi(emptyWorld());
    renderDashboard();
    const el = await card();
    expect(within(el).getByRole("heading", { name: "Primeiros passos" })).toBeInTheDocument();
    expect(screen.getByTestId("first-steps-count")).toHaveTextContent("0 de 5");
    expect(screen.getByRole("progressbar", { name: "Progresso dos primeiros passos" })).toBeInTheDocument();
    for (const id of ROWS) expect(doneOf(id)).toBe("false");

    const href = (name: string) => within(el).getByRole("link", { name }).getAttribute("href");
    expect(href("Abrir configurações")).toBe("/configuracoes");
    expect(href("Abrir unidades")).toBe("/unidades");
    expect(href("Abrir turmas")).toBe("/turmas");
    expect(href("Cadastrar aluno")).toBe("/alunos");
    expect(href("Cadastrar professor")).toBe("/professores");

    // consultas já existentes e leves (limit=1; as unidades vêm numa página de 50 porque o servidor não filtra a Matriz)
    const get = (path: string) => calls.find((c) => c.path === path && c.method === "GET");
    expect(get("/classes")?.query.get("limit")).toBe("1");
    expect(get("/students")?.query.get("limit")).toBe("1");
    expect(get("/teachers")?.query.get("limit")).toBe("1");
    expect(get("/teachers")?.query.get("role")).toBe("PROFESSOR");
    expect(get("/units")?.query.get("limit")).toBe("50");
    expect(get("/organizations")).toBeDefined();
    // dashboard continua abaixo do cartão
    expect(await screen.findByTestId("dashboard-content")).toBeInTheDocument();
  });

  it("1) perfil do grupo: só conta com cidade, UF e apresentação", async () => {
    const world = emptyWorld();
    world.org = { ...world.org, city: "Salvador", state: "BA", description: "Grupo de capoeira fundado em 2001." };
    mockApi(world);
    renderDashboard();
    await card();
    expect(doneOf("profile")).toBe("true");
    expect(doneOf("matriz")).toBe("false");
    expect(screen.getByTestId("first-steps-count")).toHaveTextContent("1 de 5");
  });

  it("1b) perfil incompleto (falta a apresentação) continua pendente", async () => {
    const world = emptyWorld();
    world.org = { ...world.org, city: "Salvador", state: "BA", description: "" };
    mockApi(world);
    renderDashboard();
    await card();
    expect(doneOf("profile")).toBe("false");
  });

  it("2) endereço da Matriz preenchido cumpre o passo", async () => {
    const world = emptyWorld();
    world.units = [{ id: 1, name: "Matriz", address: "Rua do Pelourinho, 10", isMain: true, status: "ACTIVE" }];
    mockApi(world);
    renderDashboard();
    await card();
    expect(doneOf("matriz")).toBe("true");
    expect(screen.getByTestId("first-steps-count")).toHaveTextContent("1 de 5");
  });

  it("3) primeira turma cumpre o passo", async () => {
    const world = emptyWorld();
    world.classesTotal = 1;
    mockApi(world);
    renderDashboard();
    await card();
    expect(doneOf("class")).toBe("true");
    expect(screen.getByTestId("first-steps-count")).toHaveTextContent("1 de 5");
  });

  it.each([
    ["um professor", { teachersTotal: 1 }],
    ["um aluno", { studentsTotal: 3 }],
  ])("4) %s cumpre o passo de pessoas", async (_label, patch) => {
    const world = { ...emptyWorld(), ...patch };
    mockApi(world);
    renderDashboard();
    await card();
    expect(doneOf("people")).toBe("true");
    expect(screen.getByTestId("first-steps-count")).toHaveTextContent("1 de 5");
  });

  it("5) abrir o app dos alunos: link externo seguro; ao clicar o passo é cumprido e a marca fica guardada por usuário", async () => {
    mockApi(emptyWorld());
    renderDashboard();
    await card();
    const link = within(screen.getByTestId("first-step-app")).getByRole("link", { name: /Abrir o app dos alunos/ });
    expect(link).toHaveAttribute("href", "http://localhost:4173");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    // jsdom não navega em <a target=_blank>; o clique só dispara a marca
    fireEvent.click(link);
    await waitFor(() => expect(doneOf("app")).toBe("true"));
    expect(screen.getByTestId("first-steps-count")).toHaveTextContent("1 de 5");
    expect(readFirstStepsFlag(1, "app")).toBe(true);
  });

  it("andamento misto: 3 de 5 e a barra acompanha", async () => {
    const world = emptyWorld();
    world.classesTotal = 2;
    world.studentsTotal = 10;
    world.units = [{ id: 1, name: "Matriz", address: "Rua A", isMain: true, status: "ACTIVE" }];
    mockApi(world);
    renderDashboard();
    await card();
    expect(screen.getByTestId("first-steps-count")).toHaveTextContent("3 de 5");
    const bar = screen.getByRole("progressbar", { name: "Progresso dos primeiros passos" });
    expect(bar).toHaveAttribute("aria-valuenow", "60");
    expect(doneOf("profile")).toBe("false");
    expect(doneOf("app")).toBe("false");
  });

  it("5 de 5: o cartão some sozinho (e o dashboard continua)", async () => {
    const world = emptyWorld();
    world.org = { ...world.org, city: "Salvador", state: "BA", description: "Grupo." };
    world.units = [{ id: 1, name: "Matriz", address: "Rua A", isMain: true, status: "ACTIVE" }];
    world.classesTotal = 1;
    world.teachersTotal = 1;
    writeFirstStepsFlag(1, "app");
    const calls = mockApi(world);
    renderDashboard();
    expect(await screen.findByTestId("dashboard-content")).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.path === "/teachers")).toBe(true));
    await waitFor(() => expect(calls.some((c) => c.path === "/organizations")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId("first-steps")).not.toBeInTheDocument();
  });

  it("Dispensar: some na hora, persiste por usuário e não aparece ao voltar; outro usuário continua vendo", async () => {
    mockApi(emptyWorld());
    const first = renderDashboard();
    await card();
    fireEvent.click(screen.getByRole("button", { name: "Dispensar" }));
    expect(screen.queryByTestId("first-steps")).not.toBeInTheDocument();
    expect(readFirstStepsFlag(1, "dismissed")).toBe(true);
    expect(first.state.location.pathname).toBe("/dashboard");

    // recarregar a página: continua dispensado
    cleanup();
    mockApi(emptyWorld());
    renderDashboard();
    expect(await screen.findByTestId("dashboard-content")).toBeInTheDocument();
    expect(screen.queryByTestId("first-steps")).not.toBeInTheDocument();

    // outro Mestre no mesmo navegador não é afetado
    const other: AuthUser = { id: 2, name: "Outro", email: "o@g.com", userType: "MEMBER", isSuperAdmin: false, organizationId: 1, organizationSlug: "g", role: "MESTRE" };
    saveSession("tok2", other);
    cleanup();
    mockApi(emptyWorld());
    renderDashboard();
    expect(await card()).toBeInTheDocument();
  });

  it.each(["PROFESSOR", "INSTRUTOR"] as const)("%s não vê o cartão e nenhuma consulta dos passos é feita", async (role) => {
    loginAs(role);
    const calls = mockApi(emptyWorld());
    renderDashboard();
    expect(await screen.findByTestId("dashboard-content")).toBeInTheDocument();
    expect(screen.queryByTestId("first-steps")).not.toBeInTheDocument();
    expect(calls.map((c) => c.path).filter((p) => ["/classes", "/teachers", "/students", "/units", "/organizations"].includes(p))).toEqual([]);
  });

  it("localStorage indisponível: o cartão aparece, Dispensar e o passo do app funcionam só na visita e nada quebra", async () => {
    const realGet = Storage.prototype.getItem;
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (key.startsWith("gingapp_first_steps")) throw new Error("SecurityError");
      return realGet.call(this, key);
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith("gingapp_first_steps")) throw new Error("QuotaExceededError");
      realSet.call(this, key, value);
    });
    mockApi(emptyWorld());
    renderDashboard();
    await card();
    fireEvent.click(within(screen.getByTestId("first-step-app")).getByRole("link", { name: /Abrir o app dos alunos/ }));
    await waitFor(() => expect(doneOf("app")).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Dispensar" }));
    expect(screen.queryByTestId("first-steps")).not.toBeInTheDocument();
    expect(screen.getByTestId("dashboard-content")).toBeInTheDocument();
  });

  it("consulta que falha (500) não derruba nada: o passo fica pendente e o resto funciona", async () => {
    const world = emptyWorld();
    world.studentsTotal = 4;
    world.failing = ["/classes"];
    mockApi(world);
    renderDashboard();
    await card();
    expect(doneOf("class")).toBe("false");
    expect(doneOf("people")).toBe("true");
    expect(screen.getByTestId("first-steps-count")).toHaveTextContent("1 de 5");
  });
});
