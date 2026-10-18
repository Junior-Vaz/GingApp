import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { routeTree } from "@/routeTree.gen";
import { toast } from "sonner";
import { NAV_ITEMS, ROUTE_FORBIDDEN_MESSAGE, canAccessRoute, homeFor, navItemsFor } from "@/lib/nav";
import { TOKEN_STORAGE_KEY, USER_STORAGE_KEY, roleCan, saveSession, type AuthUser } from "@/lib/session";
import { login, PANEL_FORBIDDEN_MESSAGE, safeRedirect } from "@/lib/auth";

vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeUser(role: AuthUser["role"], userType: AuthUser["userType"] = "MEMBER"): AuthUser {
  return {
    id: 1,
    name: "Fulano",
    email: "f@g.com",
    userType,
    isSuperAdmin: false,
    organizationId: 1,
    organizationSlug: "grupo",
    role,
  };
}

function makeRouter(path: string) {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: new QueryClient() },
  });
}

describe("guard de rotas", () => {
  beforeEach(() => localStorage.clear());

  it("sem sessão, /alunos vai para /login com ?redirect", async () => {
    const router = makeRouter("/alunos");
    await router.load();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toMatchObject({ redirect: "/alunos" });
  });

  it("sem sessão, / também termina no login", async () => {
    const router = makeRouter("/");
    await router.load();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("MESTRE, PROFESSOR, INSTRUTOR e MONITOR entram em /alunos", async () => {
    for (const role of ["MESTRE", "PROFESSOR", "INSTRUTOR", "MONITOR"] as const) {
      localStorage.clear();
      saveSession("t", makeUser(role));
      const router = makeRouter("/alunos");
      await router.load();
      expect(router.state.location.pathname).toBe("/alunos");
    }
  });

  it("/ com sessão vai para /dashboard; /login com sessão também", async () => {
    saveSession("t", makeUser("MESTRE"));
    for (const path of ["/", "/login"]) {
      const router = makeRouter(path);
      await router.load();
      expect(router.state.location.pathname).toBe("/dashboard");
    }
  });

  it("token de ALUNO/RESPONSAVEL no storage é barrado e a sessão é limpa", async () => {
    for (const role of ["ALUNO", "RESPONSAVEL"] as const) {
      saveSession("t", makeUser(role));
      const router = makeRouter("/dashboard");
      await router.load();
      expect(router.state.location.pathname).toBe("/login");
      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
      expect(localStorage.getItem(USER_STORAGE_KEY)).toBeNull();
    }
  });

  it("PROFESSOR em /financeiro: vai para /dashboard com aviso, mantém a sessão (não é deslogado)", async () => {
    saveSession("t", makeUser("PROFESSOR"));
    vi.mocked(toast.error).mockClear();
    const router = makeRouter("/financeiro");
    await router.load();
    expect(router.state.location.pathname).toBe("/dashboard");
    expect(toast.error).toHaveBeenCalledWith(ROUTE_FORBIDDEN_MESSAGE);
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe("t");
    expect(localStorage.getItem(USER_STORAGE_KEY)).not.toBeNull();
  });

  it("MESTRE entra em /financeiro sem aviso; PROFESSOR continua entrando nas demais rotas (ex.: /alunos, /relatorios)", async () => {
    saveSession("t", makeUser("MESTRE"));
    vi.mocked(toast.error).mockClear();
    const mestre = makeRouter("/financeiro");
    await mestre.load();
    expect(mestre.state.location.pathname).toBe("/financeiro");
    expect(toast.error).not.toHaveBeenCalled();

    localStorage.clear();
    saveSession("t", makeUser("PROFESSOR"));
    for (const path of ["/alunos", "/relatorios", "/dashboard"]) {
      const router = makeRouter(path);
      await router.load();
      expect(router.state.location.pathname).toBe(path);
    }
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each(["/unidades", "/configuracoes"])(
    "PROFESSOR abrindo %s por URL direta: vai para /dashboard com aviso e mantém a sessão; MESTRE entra sem aviso",
    async (path) => {
      localStorage.clear();
      saveSession("t", makeUser("PROFESSOR"));
      vi.mocked(toast.error).mockClear();
      const prof = makeRouter(path);
      await prof.load();
      expect(prof.state.location.pathname).toBe("/dashboard");
      expect(toast.error).toHaveBeenCalledWith(ROUTE_FORBIDDEN_MESSAGE);
      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe("t");
      expect(localStorage.getItem(USER_STORAGE_KEY)).not.toBeNull();

      localStorage.clear();
      saveSession("t", makeUser("MESTRE"));
      vi.mocked(toast.error).mockClear();
      const mestre = makeRouter(path);
      await mestre.load();
      expect(mestre.state.location.pathname).toBe(path);
      expect(toast.error).not.toHaveBeenCalled();
    },
  );

  it("INSTRUTOR entra em Dashboard, Equipe, Certificados e Ranking; em Financeiro/Unidades vai à tela inicial com aviso", async () => {
    saveSession("t", makeUser("INSTRUTOR"));
    vi.mocked(toast.error).mockClear();
    for (const path of ["/dashboard", "/professores", "/certificados", "/ranking", "/graduacoes"]) {
      const router = makeRouter(path);
      await router.load();
      expect(router.state.location.pathname).toBe(path);
    }
    expect(toast.error).not.toHaveBeenCalled();
    for (const path of ["/financeiro", "/unidades", "/configuracoes"]) {
      const router = makeRouter(path);
      await router.load();
      expect(router.state.location.pathname).toBe("/dashboard");
    }
    expect(toast.error).toHaveBeenCalledWith(ROUTE_FORBIDDEN_MESSAGE);
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe("t");
  });

  it("MONITOR: / e /login vão para /alunos (sem Dashboard); Dashboard, Equipe, Certificados e Financeiro levam a /alunos com aviso, sem deslogar", async () => {
    saveSession("t", makeUser("MONITOR"));
    for (const path of ["/", "/login"]) {
      const router = makeRouter(path);
      await router.load();
      expect(router.state.location.pathname).toBe("/alunos");
    }
    for (const path of ["/dashboard", "/professores", "/certificados", "/financeiro"]) {
      vi.mocked(toast.error).mockClear();
      const router = makeRouter(path);
      await router.load();
      expect(router.state.location.pathname).toBe("/alunos");
      expect(toast.error).toHaveBeenCalledWith(ROUTE_FORBIDDEN_MESSAGE);
    }
    for (const path of ["/alunos", "/turmas", "/aulas", "/frequencia", "/graduacoes", "/ranking", "/relatorios", "/eventos", "/rodas", "/comunicados"]) {
      vi.mocked(toast.error).mockClear();
      const router = makeRouter(path);
      await router.load();
      expect(router.state.location.pathname).toBe(path);
      expect(toast.error).not.toHaveBeenCalled();
    }
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe("t");
  });

  it("roleCan espelha a matriz do seed: MESTRE tudo; PROFESSOR sem delete, teachers só view, finance nada", () => {
    const resources = ["students", "classes", "lessons", "attendance", "graduations", "events", "rodas", "announcements", "certificates"] as const;
    const actions = ["view", "create", "edit", "delete"] as const;
    for (const r of [...resources, "teachers", "finance"] as const) {
      for (const a of actions) expect(roleCan("MESTRE", r, a)).toBe(true);
    }
    for (const r of resources) {
      expect(roleCan("PROFESSOR", r, "view")).toBe(true);
      expect(roleCan("PROFESSOR", r, "create")).toBe(true);
      expect(roleCan("PROFESSOR", r, "edit")).toBe(true);
      expect(roleCan("PROFESSOR", r, "delete")).toBe(false);
    }
    expect(actions.map((a) => roleCan("PROFESSOR", "teachers", a))).toEqual([true, false, false, false]);
    expect(actions.map((a) => roleCan("PROFESSOR", "finance", a))).toEqual([false, false, false, false]);
    // unidades (E02): MESTRE tudo; PROFESSOR só view (espelha o override `units` de permission-matrix.ts)
    for (const a of actions) expect(roleCan("MESTRE", "units", a)).toBe(true);
    expect(actions.map((a) => roleCan("PROFESSOR", "units", a))).toEqual([true, false, false, false]);
    // INSTRUTOR: como PROFESSOR, mas graduações e certificados só leitura; equipe/unidades só leitura; sem financeiro
    for (const r of resources) expect(roleCan("INSTRUTOR", r, "view")).toBe(true);
    for (const r of ["students", "classes", "lessons", "attendance", "events", "rodas", "announcements"] as const) {
      expect(actions.map((a) => roleCan("INSTRUTOR", r, a))).toEqual([true, true, true, false]);
    }
    for (const r of ["graduations", "certificates", "teachers", "units"] as const) {
      expect(actions.map((a) => roleCan("INSTRUTOR", r, a))).toEqual([true, false, false, false]);
    }
    expect(actions.map((a) => roleCan("INSTRUTOR", "finance", a))).toEqual([false, false, false, false]);
    // MONITOR: só leitura + chamada; sem financeiro, equipe, dashboard e certificados
    for (const r of ["students", "classes", "lessons", "graduations", "events", "rodas", "announcements", "units"] as const) {
      expect(actions.map((a) => roleCan("MONITOR", r, a))).toEqual([true, false, false, false]);
    }
    expect(actions.map((a) => roleCan("MONITOR", "attendance", a))).toEqual([true, true, true, false]);
    for (const r of ["finance", "teachers", "dashboard", "certificates"] as const) {
      expect(actions.map((a) => roleCan("MONITOR", r, a))).toEqual([false, false, false, false]);
    }
    // sem sessão / papéis do app: nega (falha fechada)
    for (const role of [undefined, "ALUNO", "RESPONSAVEL"] as const) expect(roleCan(role, "students", "view")).toBe(false);
  });

  it("/checkin/:kind/:id (fora do menu): sem sessão vai ao login com ?redirect; com sessão resolve kind e id nos params", async () => {
    const anon = makeRouter("/checkin/evento/7");
    await anon.load();
    expect(anon.state.location.pathname).toBe("/login");
    expect(anon.state.location.search).toMatchObject({ redirect: "/checkin/evento/7" });

    for (const [role, path, kind, id] of [
      ["MESTRE", "/checkin/evento/7", "evento", "7"],
      ["PROFESSOR", "/checkin/aula/12", "aula", "12"],
    ] as const) {
      localStorage.clear();
      saveSession("t", makeUser(role));
      const router = makeRouter(path);
      await router.load();
      expect(router.state.location.pathname).toBe(path);
      expect(router.state.matches.at(-1)?.params).toEqual({ kind, id });
    }
  });

  it("todas as 19 rotas do menu existem na árvore", async () => {
    expect(NAV_ITEMS).toHaveLength(19);
    saveSession("t", makeUser("MESTRE"));
    for (const item of NAV_ITEMS) {
      const router = makeRouter(item.to);
      await router.load();
      expect(router.state.location.pathname).toBe(item.to);
    }
  });
});

describe("menu por papel", () => {
  it("MESTRE vê 19 itens (com Financeiro, Transferências, Ranking, Formulários e Atividade do grupo); PROFESSOR não vê Financeiro/Transferências/Unidades/Configurações/Atividade", () => {
    const mestre = navItemsFor("MESTRE").map((i) => i.label);
    expect(mestre).toHaveLength(19);
    expect(mestre).toContain("Formulários");
    expect(mestre).toContain("Transferências");
    expect(mestre).toContain("Financeiro");
    expect(mestre).toContain("Atividade do grupo");
    const labels = navItemsFor("PROFESSOR").map((i) => i.label);
    expect(labels).toHaveLength(14);
    expect(labels).toContain("Formulários");
    expect(labels).not.toContain("Financeiro");
    expect(labels).not.toContain("Transferências");
    expect(labels).not.toContain("Unidades");
    expect(labels).not.toContain("Configurações");
    expect(labels).not.toContain("Atividade do grupo");
    expect(labels).toContain("Dashboard");
    expect(labels).toContain("Ranking");
    expect(mestre).toContain("Ranking");
    expect(navItemsFor(undefined).map((i) => i.label)).not.toContain("Financeiro");
  });

  it("INSTRUTOR vê o mesmo menu do PROFESSOR (14); MONITOR vê 10 (sem Dashboard, Equipe, Certificados, Formulários, Financeiro etc.)", () => {
    const professor = navItemsFor("PROFESSOR").map((i) => i.label);
    const instrutor = navItemsFor("INSTRUTOR").map((i) => i.label);
    expect(instrutor).toEqual(professor);
    expect(instrutor).toHaveLength(14);
    expect(instrutor).toContain("Equipe");
    expect(instrutor).not.toContain("Financeiro");
    const monitor = navItemsFor("MONITOR").map((i) => i.label);
    expect(monitor).toEqual([
      "Alunos",
      "Turmas",
      "Aulas",
      "Frequência",
      "Graduações",
      "Ranking",
      "Eventos",
      "Rodas",
      "Comunicados",
      "Relatórios",
    ]);
    expect(navItemsFor("MESTRE").map((i) => i.label)).toContain("Equipe");
    expect(navItemsFor("MESTRE").map((i) => i.label)).not.toContain("Professores");
  });

  it("homeFor: Dashboard, ou /alunos para quem não tem Dashboard (MONITOR)", () => {
    expect(homeFor("MESTRE")).toBe("/dashboard");
    expect(homeFor("PROFESSOR")).toBe("/dashboard");
    expect(homeFor("INSTRUTOR")).toBe("/dashboard");
    expect(homeFor("MONITOR")).toBe("/alunos");
    expect(homeFor(undefined)).toBe("/dashboard");
  });

  it("canAccessRoute: /financeiro só MESTRE; rota sem restrição ou fora do menu é livre", () => {
    expect(canAccessRoute("MESTRE", "/financeiro")).toBe(true);
    expect(canAccessRoute("PROFESSOR", "/financeiro")).toBe(false);
    expect(canAccessRoute(undefined, "/financeiro")).toBe(false);
    expect(canAccessRoute("PROFESSOR", "/alunos")).toBe(true);
    expect(canAccessRoute("PROFESSOR", "/rota-fora-do-menu")).toBe(true);
  });
});

describe("login", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  const stubLogin = (user: AuthUser) =>
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ accessToken: "jwt", user }), { status: 201 })),
    );

  it("MESTRE: grava gestao_token/gestao_user (e não as chaves do app)", async () => {
    stubLogin(makeUser("MESTRE"));
    await login({ email: " m@g.com ", password: "x" });
    expect(localStorage.getItem("gestao_token")).toBe("jwt");
    expect(localStorage.getItem("mb_token")).toBeNull();
  });

  it.each(["INSTRUTOR", "MONITOR"] as const)("%s: o painel aceita o login e grava a sessão", async (role) => {
    stubLogin(makeUser(role));
    const user = await login({ email: "x@g.com", password: "x" });
    expect(user).toMatchObject({ role });
    expect(localStorage.getItem("gestao_token")).toBe("jwt");
  });

  it("safeRedirect sem destino leva ao Dashboard, ou a /alunos para o MONITOR", () => {
    saveSession("t", makeUser("MONITOR"));
    expect(safeRedirect(undefined)).toBe("/alunos");
    expect(safeRedirect("/turmas")).toBe("/turmas");
    localStorage.clear();
    saveSession("t", makeUser("INSTRUTOR"));
    expect(safeRedirect(undefined)).toBe("/dashboard");
  });

  it("ALUNO: rejeita com mensagem e não grava sessão", async () => {
    stubLogin(makeUser("ALUNO"));
    await expect(login({ email: "a@g.com", password: "x" })).rejects.toThrow(PANEL_FORBIDDEN_MESSAGE);
    expect(localStorage.getItem("gestao_token")).toBeNull();
  });

  it("envia organizationSlug só quando informado", async () => {
    stubLogin(makeUser("PROFESSOR"));
    await login({ email: "p@g.com", password: "x", organizationSlug: " grupo " });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, string>;
    expect(body).toEqual({ email: "p@g.com", password: "x", organizationSlug: "grupo" });
  });

  it("safeRedirect bloqueia open redirect", () => {
    expect(safeRedirect("/alunos?x=1")).toBe("/alunos?x=1");
    expect(safeRedirect("//evil.com")).toBe("/dashboard");
    expect(safeRedirect("https://evil.com")).toBe("/dashboard");
    expect(safeRedirect(undefined)).toBe("/dashboard");
  });
});
