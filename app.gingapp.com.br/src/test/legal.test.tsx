import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { TermsGate } from "@/components/gingapp/legal";
import { getUser, saveSession, type AuthUser } from "@/lib/session";

// E10: tela bloqueante de aceite dos termos + páginas públicas /termos e /privacidade.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
const DOC = {
  type: "terms",
  title: "Termos de Uso do GingApp",
  version: "2026-10-11.1",
  updatedAt: "2026-10-11",
  notice: "MODELO — revisar com assessoria jurídica antes de publicar.",
  sections: [{ heading: "1. Aceitação", paragraphs: ["Texto da seção um."] }],
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

let calls: { method: string; path: string; body: unknown }[] = [];
function mockApi(routes: Record<string, () => Response>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "");
      const method = init.method ?? "GET";
      calls.push({ method, path, body: init.body ? JSON.parse(init.body as string) : undefined });
      const handler = routes[`${method} ${path}`];
      return handler ? handler() : json(404, { message: `sem rota ${method} ${path}` });
    }),
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

function mount(node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>));
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.unstubAllGlobals();
});

describe("TermsGate (aceite bloqueante)", () => {
  it("aceite pendente: bloqueia até marcar o checkbox; aceitar envia a versão vigente e libera", async () => {
    saveSession("tok", { ...USER, termsAcceptanceRequired: true });
    mockApi({
      "GET /legal": () => json(200, { version: "2026-10-11.1" }),
      "POST /auth/accept-terms": () => json(200, { termsAcceptanceRequired: false }),
    });
    mount(<TermsGate />);
    await settle();

    expect(container!.querySelector('[data-testid="terms-gate"]')).not.toBeNull();
    const accept = [...container!.querySelectorAll("button")].find((b) => b.textContent?.includes("Aceitar e continuar"))!;
    expect(accept.disabled).toBe(true);

    act(() => container!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(accept.disabled).toBe(false);
    act(() => accept.click());
    await settle();

    expect(calls.find((c) => c.path === "/auth/accept-terms")?.body).toEqual({ version: "2026-10-11.1" });
    expect(container!.querySelector('[data-testid="terms-gate"]')).toBeNull();
    expect(getUser()?.termsAcceptanceRequired).toBe(false);
  });

  it("não aparece com o aceite em dia nem enquanto a senha provisória está pendente; erro do servidor mantém o bloqueio", async () => {
    saveSession("tok", { ...USER, termsAcceptanceRequired: false });
    mockApi({});
    mount(<TermsGate />);
    await settle();
    expect(container!.querySelector('[data-testid="terms-gate"]')).toBeNull();
    act(() => root?.unmount());

    saveSession("tok", { ...USER, termsAcceptanceRequired: true, mustChangePassword: true });
    mount(<TermsGate />);
    await settle();
    expect(container!.querySelector('[data-testid="terms-gate"]')).toBeNull();
    act(() => root?.unmount());

    saveSession("tok", { ...USER, termsAcceptanceRequired: true });
    mockApi({
      "GET /legal": () => json(200, { version: "2026-10-11.1" }),
      "POST /auth/accept-terms": () => json(409, { message: "Os termos foram atualizados." }),
    });
    mount(<TermsGate />);
    await settle();
    act(() => container!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    act(() => [...container!.querySelectorAll("button")].find((b) => b.textContent?.includes("Aceitar"))!.click());
    await settle();
    expect(container!.querySelector('[data-testid="terms-gate"]')).not.toBeNull();
    expect(getUser()?.termsAcceptanceRequired).toBe(true);
  });

  it("sessão antiga (flag desconhecida) consulta /auth/me uma vez e passa a exigir o aceite", async () => {
    saveSession("tok", USER);
    mockApi({
      "GET /auth/me": () => json(200, { termsAcceptanceRequired: true, currentTermsVersion: "2026-10-11.1", acceptedTermsVersion: null }),
      "GET /legal": () => json(200, { version: "2026-10-11.1" }),
    });
    mount(<TermsGate />);
    await settle();
    expect(calls.filter((c) => c.path === "/auth/me")).toHaveLength(1);
    expect(container!.querySelector('[data-testid="terms-gate"]')).not.toBeNull();
  });
});

describe("páginas públicas /termos e /privacidade", () => {
  it("abrem sem login, mostram o aviso de MODELO e o texto vindo da API", async () => {
    mockApi({
      "GET /legal/terms": () => json(200, DOC),
      "GET /legal/privacy": () => json(200, { ...DOC, type: "privacy", title: "Política de Privacidade do GingApp" }),
    });
    for (const [path, title] of [
      ["/termos", "Termos de Uso do GingApp"],
      ["/privacidade", "Política de Privacidade do GingApp"],
    ]) {
      const router = createRouter({
        routeTree,
        history: createMemoryHistory({ initialEntries: [path!] }),
        context: { queryClient: new QueryClient() },
      });
      await router.load();
      expect(router.state.location.pathname).toBe(path);
      mount(<RouterProvider router={router} />);
      await settle();
      expect(container!.textContent).toContain(title);
      expect(container!.querySelector('[data-testid="legal-notice"]')?.textContent).toMatch(/MODELO — revisar com assessoria jurídica/);
      expect(container!.textContent).toContain("Texto da seção um.");
      act(() => root?.unmount());
      container?.remove();
    }
  });

  it("a tela de login traz os links para os dois documentos", async () => {
    mockApi({});
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/login"] }),
      context: { queryClient: new QueryClient() },
    });
    await router.load();
    mount(<RouterProvider router={router} />);
    await settle();
    const links = [...container!.querySelectorAll('[data-testid="legal-links"] a')].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/termos", "/privacidade"]);
  });
});
