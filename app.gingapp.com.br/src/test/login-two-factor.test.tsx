import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { getToken, getUser, type AuthUser } from "@/lib/session";

// Login com 2FA (segundo passo). O backend é simulado pelo contrato: POST /auth/login responde
// { twoFactorRequired, challengeToken } e POST /auth/2fa/verify responde o AuthResponse normal.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER: AuthUser = {
  id: 7,
  name: "Ana",
  email: "ana@x.com",
  userType: "MEMBER",
  isSuperAdmin: false,
  organizationId: 1,
  organizationSlug: "g",
  role: "ALUNO",
};
const CHALLENGE = { twoFactorRequired: true, challengeToken: "desafio-1" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

type Call = { method: string; path: string; body: unknown };
let calls: Call[] = [];
function mockApi(routes: Record<string, (call: Call) => Response>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "");
      const method = init.method ?? "GET";
      const call: Call = { method, path, body: init.body ? JSON.parse(init.body as string) : undefined };
      calls.push(call);
      const handler = routes[`${method} ${path}`];
      return handler ? handler(call) : json(404, { message: `sem rota ${method} ${path}` });
    }),
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

async function mountLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/login?redirect=/termos"] }),
    context: { queryClient },
  });
  await router.load();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>));
  await settle();
  return router;
}

function type(selector: string, value: string) {
  const el = container!.querySelector<HTMLInputElement>(selector)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const submit = () =>
  act(() => {
    container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
const clickText = (text: string) =>
  act(() => {
    [...container!.querySelectorAll("button")].find((b) => b.textContent === text)!.click();
  });

/** E-mail + senha enviados: com o desafio, a tela passa ao segundo passo. */
async function loginUntilChallenge() {
  type("#email", "ana@x.com");
  type("#password", "SenhaForte#2026");
  submit();
  await settle();
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("login com verificação em duas etapas", () => {
  it("senha correta mostra o 2º passo SEM sessão; o código 6 dígitos conclui o login e segue o redirect", async () => {
    mockApi({
      "POST /auth/login": () => json(200, CHALLENGE),
      "POST /auth/2fa/verify": () => json(200, { accessToken: "tok-2fa", user: USER }),
    });
    const router = await mountLogin();
    await loginUntilChallenge();

    expect(getToken()).toBeNull(); // o desafio não é sessão
    expect(container!.textContent).toContain("Verificação em duas etapas");
    expect(container!.textContent).toContain("Código de 6 dígitos");
    expect(container!.textContent).toContain("Usar código de recuperação");
    expect(container!.querySelector("#password")).toBeNull();

    type("#totpCode", "12ab34 56"); // só dígitos
    expect((container!.querySelector("#totpCode") as HTMLInputElement).value).toBe("123456");
    submit();
    await settle();

    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain("POST /auth/2fa/verify");
    expect(calls.find((c) => c.path === "/auth/2fa/verify")!.body).toEqual({ challengeToken: "desafio-1", code: "123456" });
    expect(getToken()).toBe("tok-2fa");
    expect(getUser()?.email).toBe("ana@x.com");
    expect(router.state.location.pathname).toBe("/termos");
  });

  it("código errado (400): mostra a mensagem, continua no 2º passo e aceita o código de recuperação depois", async () => {
    let attempt = 0;
    mockApi({
      "POST /auth/login": () => json(200, CHALLENGE),
      "POST /auth/2fa/verify": () =>
        ++attempt === 1 ? json(400, { message: "Código inválido." }) : json(200, { accessToken: "tok-rec", user: USER }),
    });
    await mountLogin();
    await loginUntilChallenge();

    type("#totpCode", "000000");
    submit();
    await settle();
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe("Código inválido.");
    expect(container!.querySelector("#totpCode")).not.toBeNull(); // segue no 2º passo
    expect(getToken()).toBeNull();

    clickText("Usar código de recuperação");
    type("#recoveryCode", " abcde-12345 ");
    submit();
    await settle();
    expect(calls.filter((c) => c.path === "/auth/2fa/verify")[1]!.body).toEqual({
      challengeToken: "desafio-1",
      recoveryCode: "abcde-12345",
    });
    expect(getToken()).toBe("tok-rec");
  });

  it("desafio expirado (400) volta ao passo do e-mail e senha com a mensagem", async () => {
    mockApi({
      "POST /auth/login": () => json(200, CHALLENGE),
      "POST /auth/2fa/verify": () => json(400, { message: "Desafio expirado. Entre novamente." }),
    });
    await mountLogin();
    await loginUntilChallenge();

    type("#totpCode", "123456");
    submit();
    await settle();

    expect(container!.querySelector("#password")).not.toBeNull();
    expect(container!.querySelector("#totpCode")).toBeNull();
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe("Desafio expirado. Entre novamente.");
    expect(getToken()).toBeNull();
  });
});
