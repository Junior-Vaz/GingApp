import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }, Toaster: () => null }));
vi.mock("@/components/gingapp/push-bridge", () => ({ PushBridge: () => null }));

import { routeTree } from "@/routeTree.gen";
import { saveSession } from "@/lib/session";
import { $, $$, buttonByLabel, cleanup, click, makePost, makeSettings, mockFeedApi, mount, settle, until } from "./feed-fixtures";

/** Navegação: a aba "Grupo" está no menu do app e na Home, e a rota /feed renderiza a página dentro do shell. */

function makeRouter(path: string) {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
  });
}

beforeEach(() => {
  localStorage.clear();
  saveSession("t", {
    id: 1, name: "Ana Souza", email: "a@b.c", userType: "MEMBER", isSuperAdmin: false,
    organizationId: 1, organizationSlug: "g", role: "ALUNO",
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("aba Grupo na navegação", () => {
  it("/feed abre a página Grupo dentro do shell (com o ponto de encaixe do topo)", async () => {
    mockFeedApi({ pages: { "": { items: [makePost({ id: 3 })], nextCursor: null } } });
    const router = makeRouter("/feed");
    await mount(<RouterProvider router={router} />);
    await until(() => $("[data-testid=feed-page]") !== null, "página do feed");
    expect($("[data-testid=feed-top-slot]")).not.toBeNull();
    expect(router.state.location.pathname).toBe("/feed");
    await until(() => $$("[data-testid=post-card]").length === 1, "post");
  });

  it("o menu do app lista 'Grupo' apontando para /feed (a barra inferior continua com 6 itens)", async () => {
    mockFeedApi();
    await mount(<RouterProvider router={makeRouter("/feed")} />);
    await until(() => buttonByLabel("Abrir menu") !== undefined, "botão do menu");
    expect($$("nav[aria-label='Navegação inferior'] a")).toHaveLength(6);
    click(buttonByLabel("Abrir menu"));
    await settle();
    const link = $$("[role=dialog] nav a").find((anchor) => anchor.textContent?.includes("Grupo"));
    expect(link?.getAttribute("href")).toBe("/feed");
    // na rota ativa o item fica destacado no menu lateral/menu
    expect($$("nav[aria-label='Menu principal'] a.active").map((anchor) => anchor.textContent)).toContain("Grupo");
  });

  it("a Home tem o atalho para o Grupo", async () => {
    mockFeedApi();
    await mount(<RouterProvider router={makeRouter("/")} />);
    await until(() => $("[data-testid=home-feed-shortcut]") !== null, "atalho na Home");
    expect($("[data-testid=home-feed-shortcut]")?.getAttribute("href")).toBe("/feed");
  });

  it("feed DESLIGADO no grupo: sem atalho na Home e sem 'Grupo' no menu; a rota /feed segue explicando", async () => {
    const state = mockFeedApi({ settings: makeSettings({ enabled: false }) });
    await mount(<RouterProvider router={makeRouter("/")} />);
    await until(() => state.calls.some((call) => call.path === "/feed/settings"), "configuracao do feed pedida");
    await settle();
    expect($("[data-testid=home-feed-shortcut]")).toBeNull();
    click(buttonByLabel("Abrir menu"));
    await settle();
    expect($$("[role=dialog] nav a").some((anchor) => anchor.textContent?.includes("Grupo"))).toBe(false);
    expect($$("nav[aria-label='Menu principal'] a").some((anchor) => anchor.getAttribute("href") === "/feed")).toBe(false);
  });

  it("enquanto a configuracao do feed carrega (ou falha), 'Grupo' fica oculto", async () => {
    mockFeedApi({ respond: (call) => (call.path === "/feed/settings" ? new Promise<Response>(() => {}) : undefined) });
    await mount(<RouterProvider router={makeRouter("/")} />);
    await settle();
    expect($("[data-testid=home-feed-shortcut]")).toBeNull();
    expect($$("nav[aria-label='Menu principal'] a").some((anchor) => anchor.getAttribute("href") === "/feed")).toBe(false);
  });

  it("feed desligado: quem chega por link em /feed ve a mensagem 'feed desligado'", async () => {
    mockFeedApi({ settings: makeSettings({ enabled: false }) });
    await mount(<RouterProvider router={makeRouter("/feed")} />);
    await until(() => $("[data-testid=feed-disabled]") !== null, "mensagem de feed desligado");
    expect($("[data-testid=composer]")).toBeNull();
  });
});
