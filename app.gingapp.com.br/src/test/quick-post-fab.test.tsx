import { afterEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const routerState = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: routerState.pathname } }),
}));

import { QuickPostFab } from "@/components/gingapp/feed/quick-post-fab";
import { $, cleanup, click, makeSettings, mockFeedApi, mount, settle, until } from "./feed-fixtures";

/** Botão flutuante "Nova publicação": só com feed ligado + permissão de postar, e some na própria página do Grupo. */

afterEach(() => {
  cleanup();
  routerState.pathname = "/";
  localStorage.clear();
});

const fab = () => $("[data-testid=post-fab]");

describe("QuickPostFab", () => {
  it("aparece com o feed ligado e abre a folha de criação ao tocar", async () => {
    mockFeedApi({ settings: makeSettings({ enabled: true, canPost: true }) });
    await mount(<QuickPostFab />);
    await until(() => fab() !== null, "botão flutuante");
    expect(fab()?.getAttribute("aria-label")).toBe("Nova publicação");
    expect($("#composer-body")).toBeNull();
    click(fab());
    await until(() => $("#composer-body") !== null, "folha de criação");
  });

  it("não aparece com o feed desligado, sem permissão de postar ou na página do Grupo", async () => {
    mockFeedApi({ settings: makeSettings({ enabled: false }) });
    await mount(<QuickPostFab />);
    await settle(120);
    expect(fab()).toBeNull();
    cleanup();

    mockFeedApi({ settings: makeSettings({ enabled: true, canPost: false }) });
    await mount(<QuickPostFab />);
    await settle(120);
    expect(fab()).toBeNull();
    cleanup();

    routerState.pathname = "/feed";
    mockFeedApi({ settings: makeSettings({ enabled: true, canPost: true }) });
    await mount(<QuickPostFab />);
    await settle(120);
    expect(fab()).toBeNull();
  });
});
