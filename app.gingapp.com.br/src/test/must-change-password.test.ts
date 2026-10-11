import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { routeTree } from "@/routeTree.gen";
import { getUser, replaceToken, saveSession, type AuthUser } from "@/lib/session";

const USER: AuthUser = {
  id: 1,
  name: "Aluno",
  email: "a@b.c",
  userType: "MEMBER",
  isSuperAdmin: false,
  organizationId: 1,
  organizationSlug: "g",
  role: "ALUNO",
};

function makeRouter(path: string) {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: new QueryClient() },
  });
}

describe("troca de senha obrigatória (senha provisória definida pelo mestre)", () => {
  beforeEach(() => localStorage.clear());

  it("com mustChangePassword, qualquer rota do app leva ao /perfil", async () => {
    saveSession("t", { ...USER, mustChangePassword: true });
    for (const path of ["/", "/jornada", "/financeiro"]) {
      const router = makeRouter(path);
      await router.load();
      expect(router.state.location.pathname).toBe("/perfil");
    }
  });

  it("o /perfil continua acessível (é onde a senha é trocada)", async () => {
    saveSession("t", { ...USER, mustChangePassword: true });
    const router = makeRouter("/perfil");
    await router.load();
    expect(router.state.location.pathname).toBe("/perfil");
  });

  it("sem a flag (ou false) nada é redirecionado", async () => {
    saveSession("t", { ...USER, mustChangePassword: false });
    const router = makeRouter("/jornada");
    await router.load();
    expect(router.state.location.pathname).toBe("/jornada");
  });

  it("depois da troca da própria senha (replaceToken) a flag é limpa e o app volta a abrir", async () => {
    saveSession("t", { ...USER, mustChangePassword: true });
    replaceToken("novo-token");
    expect(getUser()?.mustChangePassword).toBe(false);
    const router = makeRouter("/jornada");
    await router.load();
    expect(router.state.location.pathname).toBe("/jornada");
  });
});
