import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// AppShell isolado: roteador, sessão e consultas viram stubs; o que importa aqui é o <main> da troca de rota.
let pathname = "/aulas";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, className, onClick }: { children: React.ReactNode; to: string; className?: string; onClick?: () => void }) => (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) => select({ location: { pathname } }),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("@/lib/install", () => ({ useInstall: () => ({ installed: true, platform: "android", canPrompt: false, promptInstall: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({ logout: vi.fn() }));
vi.mock("@/lib/session", () => ({ useSessionUser: () => ({ name: "Aluno", organizationSlug: "grupo" }) }));
vi.mock("@/lib/feed", () => ({ useFeedSettings: () => ({ data: { enabled: false } }) }));
vi.mock("@/lib/queries", () => ({
  useMyIdentity: () => ({ name: "Aluno", photo: null, groupName: null, groupLogoUrl: null }),
  useMyStudent: () => ({ students: [], student: null, selectStudent: vi.fn() }),
  useMyUnit: () => null,
  usePassport: () => ({ data: undefined }),
  usePendingTransferCount: () => 0,
  useUnreadCount: () => ({ data: 0 }),
}));
vi.mock("@/components/gingapp/avatar", () => ({ Avatar: () => <span /> }));
vi.mock("@/components/gingapp/feed/quick-post-fab", () => ({ QuickPostFab: () => null }));
vi.mock("@/components/gingapp/onboarding/install-guide", () => ({ InstallHelp: () => null }));

const { AppShell } = await import("@/components/gingapp/app-shell");

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const render = () => act(() => root!.render(<AppShell><p data-testid="page">conteúdo</p></AppShell>));

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("AppShell: transição entre páginas", () => {
  it("o <main> leva a classe de entrada e o conteúdo da página continua no DOM", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    pathname = "/aulas";
    render();
    const main = container.querySelector("main")!;
    expect(main.className).toContain("main-content");
    expect(main.className).toContain("page-enter");
    expect(main.querySelector("[data-testid=page]")!.textContent).toBe("conteúdo");
    expect(main.getAttribute("aria-hidden")).toBeNull();
    expect(main.hidden).toBe(false);
  });

  it("trocar a rota remonta o <main> (reinicia a animação); a mesma rota não remonta", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    pathname = "/aulas";
    render();
    const first = container.querySelector("main")!;
    render();
    expect(container.querySelector("main")).toBe(first);
    pathname = "/frequencia";
    render();
    const second = container.querySelector("main")!;
    expect(second).not.toBe(first);
    expect(second.className).toContain("page-enter");
  });
});
