import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { routeTree } from "@/routeTree.gen";
import { NAV_ITEMS, navItemsFor } from "@/lib/nav";
import { TOKEN_STORAGE_KEY, USER_STORAGE_KEY, saveSession, type AuthUser } from "@/lib/session";
import { login, PANEL_FORBIDDEN_MESSAGE, safeRedirect } from "@/lib/auth";

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

  it("MESTRE e PROFESSOR entram em /alunos", async () => {
    for (const role of ["MESTRE", "PROFESSOR"] as const) {
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

  it("todas as 15 rotas do menu existem na árvore", async () => {
    expect(NAV_ITEMS).toHaveLength(15);
    saveSession("t", makeUser("MESTRE"));
    for (const item of NAV_ITEMS) {
      const router = makeRouter(item.to);
      await router.load();
      expect(router.state.location.pathname).toBe(item.to);
    }
  });
});

describe("menu por papel", () => {
  it("MESTRE vê 15 itens; PROFESSOR não vê Unidades/Configurações", () => {
    expect(navItemsFor("MESTRE")).toHaveLength(15);
    const labels = navItemsFor("PROFESSOR").map((i) => i.label);
    expect(labels).toHaveLength(13);
    expect(labels).not.toContain("Unidades");
    expect(labels).not.toContain("Configurações");
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
