import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { getUser, saveSession, type AuthUser } from "@/lib/session";

// E10: aceite bloqueante dos termos, páginas públicas /termos e /privacidade e troca de senha obrigatória.
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

const USER: AuthUser = {
  id: 1,
  name: "Mestre",
  email: "m@x.com",
  userType: "MEMBER",
  isSuperAdmin: false,
  organizationId: 1,
  organizationSlug: "g",
  role: "MESTRE",
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
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "");
      const method = init.method ?? "GET";
      calls.push({ method, path, body: init.body ? JSON.parse(init.body as string) : undefined });
      const handler = routes[`${method} ${path}`];
      return Promise.resolve(handler ? handler() : json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
}

function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: new QueryClient() },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("painel: aceite dos termos", () => {
  it("aceite pendente bloqueia o painel até marcar e aceitar; envia a versão vigente e libera", async () => {
    saveSession("tok", { ...USER, termsAcceptanceRequired: true });
    mockApi({
      "GET /legal": () => json(200, { version: "2026-10-11.1" }),
      "POST /auth/accept-terms": () => json(200, { termsAcceptanceRequired: false }),
    });
    renderAt("/configuracoes");
    const gate = await screen.findByTestId("terms-gate");
    const accept = screen.getByRole("button", { name: /Aceitar e continuar/ });
    expect(gate).toBeTruthy();
    expect((accept as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect((accept as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(accept);

    await waitFor(() => expect(screen.queryByTestId("terms-gate")).toBeNull());
    expect(calls.find((c) => c.path === "/auth/accept-terms")?.body).toEqual({ version: "2026-10-11.1" });
    expect(getUser()?.termsAcceptanceRequired).toBe(false);
  });

  it("aceite em dia: sem tela bloqueante", async () => {
    saveSession("tok", { ...USER, termsAcceptanceRequired: false });
    mockApi({});
    renderAt("/configuracoes");
    await screen.findByRole("button", { name: "Meus dados" }); // o painel abriu
    expect(screen.queryByTestId("terms-gate")).toBeNull();
  });
});

describe("painel: troca de senha obrigatória (mustChangePassword)", () => {
  it("com a flag, só aparece a tela de troca (nenhuma chamada de dados) e trocar a senha limpa a flag e abre o painel", async () => {
    saveSession("tok", { ...USER, mustChangePassword: true });
    mockApi({ "POST /auth/change-password": () => json(200, { accessToken: "novo" }) });
    renderAt("/alunos");
    expect(await screen.findByTestId("must-change-password")).toBeTruthy();
    expect(calls.filter((c) => c.path.startsWith("/students"))).toHaveLength(0);
    // o diálogo de troca de senha existente abre sozinho
    const current = await screen.findByLabelText("Senha atual");
    fireEvent.change(current, { target: { value: "Provisoria#2026ab" } });
    fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: "NovaSenhaForte#9xy" } });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), { target: { value: "NovaSenhaForte#9xy" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Alterar senha/ }).at(-1)!);
    await waitFor(() => expect(screen.queryByTestId("must-change-password")).toBeNull());
    expect(getUser()?.mustChangePassword).toBe(false);
    expect(calls.find((c) => c.path === "/auth/change-password")?.body).toMatchObject({ currentPassword: "Provisoria#2026ab" });
  });
});

describe("painel: páginas públicas", () => {
  it("/termos e /privacidade abrem sem login, com aviso de MODELO e texto da API; login traz os links", async () => {
    mockApi({
      "GET /legal/terms": () => json(200, DOC),
      "GET /legal/privacy": () => json(200, { ...DOC, type: "privacy", title: "Política de Privacidade do GingApp" }),
    });
    const terms = renderAt("/termos");
    expect(await screen.findByText("Termos de Uso do GingApp")).toBeTruthy();
    expect(screen.getByTestId("legal-notice").textContent).toMatch(/MODELO — revisar com assessoria jurídica/);
    expect(screen.getByText("Texto da seção um.")).toBeTruthy();
    terms.unmount();

    const privacy = renderAt("/privacidade");
    expect(await screen.findByText("Política de Privacidade do GingApp")).toBeTruthy();
    privacy.unmount();

    renderAt("/login");
    const links = (await screen.findByTestId("legal-links")).querySelectorAll("a");
    expect([...links].map((a) => a.getAttribute("href"))).toEqual(["/termos", "/privacidade"]);
  });
});
