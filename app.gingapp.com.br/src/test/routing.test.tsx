import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { routeTree } from "@/routeTree.gen";
import { saveSession } from "@/lib/session";

function makeRouter(path: string) {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: new QueryClient() },
  });
}

describe("guard de rotas", () => {
  beforeEach(() => localStorage.clear());

  it("sem sessão, /jornada redireciona para /login com redirect de volta", async () => {
    const router = makeRouter("/jornada");
    await router.load();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toMatchObject({ redirect: "/jornada" });
  });

  it("com sessão, /jornada é aceita", async () => {
    saveSession("t", {
      id: 1, name: "A", email: "a@b.c", userType: "MEMBER", isSuperAdmin: false,
      organizationId: 1, organizationSlug: "g", role: "ALUNO",
    });
    const router = makeRouter("/jornada");
    await router.load();
    expect(router.state.location.pathname).toBe("/jornada");
  });

  it("páginas públicas de verificação não exigem login", async () => {
    for (const path of ["/verificar/ABC", "/verificar-passaporte/XYZ"]) {
      const router = makeRouter(path);
      await router.load();
      expect(router.state.location.pathname).toBe(path);
    }
  });
});
