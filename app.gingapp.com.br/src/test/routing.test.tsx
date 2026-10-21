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

  it("sem sessão, /feed (Grupo) redireciona para /login com redirect de volta", async () => {
    const router = makeRouter("/feed");
    await router.load();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toMatchObject({ redirect: "/feed" });
  });

  it("com sessão, /feed (Grupo) é aceita e a rota traz o título da página", async () => {
    saveSession("t", {
      id: 1, name: "A", email: "a@b.c", userType: "MEMBER", isSuperAdmin: false,
      organizationId: 1, organizationSlug: "g", role: "ALUNO",
    });
    const router = makeRouter("/feed");
    await router.load();
    expect(router.state.location.pathname).toBe("/feed");
    const titles = router.state.matches.flatMap((match) => (match.meta ?? []).map((meta) => (meta as { title?: string } | undefined)?.title));
    expect(titles).toContain("Grupo — GingApp");
  });

  it("páginas públicas de verificação não exigem login", async () => {
    for (const path of ["/verificar/ABC", "/verificar-passaporte/XYZ", "/esqueci-senha"]) {
      const router = makeRouter(path);
      await router.load();
      expect(router.state.location.pathname).toBe(path);
    }
  });

  it("inscrição pública /i/<slug> não exige login (nem com ?consultar=1)", async () => {
    for (const [path, search] of [["/i/campeonato", {}], ["/i/campeonato?consultar=1", { consultar: 1 }]] as const) {
      const router = makeRouter(path);
      await router.load();
      expect(router.state.location.pathname).toBe("/i/campeonato");
      expect(router.state.location.search).toMatchObject(search);
    }
  });

  it("redefinição de senha é pública: /redefinir-senha?token=... não redireciona para o login", async () => {
    const router = makeRouter("/redefinir-senha?token=abc");
    await router.load();
    expect(router.state.location.pathname).toBe("/redefinir-senha");
    expect(router.state.location.search).toMatchObject({ token: "abc" });
  });

  it("aprovação de transferência é pública: /aprovar-transferencia?token=... não redireciona para o login", async () => {
    const router = makeRouter("/aprovar-transferencia?token=abc");
    await router.load();
    expect(router.state.location.pathname).toBe("/aprovar-transferencia");
    expect(router.state.location.search).toMatchObject({ token: "abc" });
  });
});
