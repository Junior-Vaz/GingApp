import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { setUnauthorizedHandler } from "@/lib/api";
import { TOKEN_STORAGE_KEY, getToken, type AuthUser } from "@/lib/session";

type Call = { method: string; path: string; body: unknown };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const MESTRE: AuthUser = {
  id: 1,
  name: "Mestre",
  email: "m@g.com",
  userType: "MEMBER",
  isSuperAdmin: false,
  organizationId: 1,
  organizationSlug: "g",
  role: "MESTRE",
};

/** Contrato simulado: login -> desafio (2FA ligado); /auth/2fa/verify decidido por cada teste. */
function mockApi(verify: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "");
      const call: Call = {
        method: init.method ?? "GET",
        path,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      };
      calls.push(call);
      if (call.method === "POST" && path === "/auth/login") {
        return Promise.resolve(json(200, { twoFactorRequired: true, challengeToken: "ch-1" }));
      }
      if (call.method === "POST" && path === "/auth/2fa/verify") return Promise.resolve(verify(call));
      return Promise.resolve(json(404, { message: "sem rota" }));
    }),
  );
  return calls;
}

function renderLogin() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/login"] }),
    context: { queryClient: new QueryClient() },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** Primeiro passo: e-mail + senha; devolve o campo do código já visível (2º passo). */
async function passFirstStep() {
  fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: "m@g.com" } });
  fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "SenhaAtual#2024" } });
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
  return screen.findByLabelText("Código de 6 dígitos");
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
  setUnauthorizedHandler(null);
});

describe("login com verificação em duas etapas", () => {
  it("desafio -> código de 6 dígitos -> sessão gravada igual ao login normal e entra no painel", async () => {
    const calls = mockApi(() => json(200, { accessToken: "jwt-2fa", user: MESTRE }));
    const router = renderLogin();
    const field = await passFirstStep();

    // nada é gravado antes da verificação
    expect(getToken()).toBeNull();
    fireEvent.change(field, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar" }));

    await waitFor(() => expect(getToken()).toBe("jwt-2fa"));
    expect(calls.find((c) => c.path === "/auth/2fa/verify")?.body).toEqual({ challengeToken: "ch-1", code: "123456" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
  });

  it("código errado (400): mostra a mensagem, continua no 2º passo, não grava sessão nem trata como sessão expirada", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    const calls = mockApi(() => json(400, { message: "Código de verificação incorreto." }));
    renderLogin();
    await passFirstStep();

    fireEvent.click(screen.getByRole("button", { name: "Usar código de recuperação" }));
    fireEvent.change(screen.getByLabelText("Código de recuperação"), { target: { value: "abcde-12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Código de verificação incorreto.");
    expect(calls.find((c) => c.path === "/auth/2fa/verify")?.body).toEqual({
      challengeToken: "ch-1",
      recoveryCode: "abcde-12345",
    });
    expect(screen.getByRole("button", { name: "Verificar" })).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("desafio expirado (400): volta ao primeiro passo mostrando a mensagem", async () => {
    mockApi(() => json(400, { message: "O desafio expirou. Entre novamente." }));
    renderLogin();
    const field = await passFirstStep();
    fireEvent.change(field, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar" }));

    expect(await screen.findByRole("button", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("O desafio expirou. Entre novamente.");
    expect(screen.queryByLabelText("Código de 6 dígitos")).not.toBeInTheDocument();
    expect(getToken()).toBeNull();
  });
});
