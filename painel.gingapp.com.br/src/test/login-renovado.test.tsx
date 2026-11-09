import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { getToken, type AuthUser } from "@/lib/session";

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

/** fetch falso do login: `onLogin` decide a resposta; capabilities configurável. */
function mockApi(opts: { resetByEmail?: boolean; onLogin?: (call: Call) => Response | Promise<Response> } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "");
      const call: Call = { method: init.method ?? "GET", path, body: init.body ? JSON.parse(init.body as string) : undefined };
      calls.push(call);
      if (path === "/auth/capabilities") return Promise.resolve(json(200, { passwordResetByEmail: opts.resetByEmail === true }));
      if (call.method === "POST" && path === "/auth/login") {
        return Promise.resolve(opts.onLogin ? opts.onLogin(call) : json(200, { accessToken: "jwt-1", user: MESTRE }));
      }
      return Promise.resolve(json(404, { message: "sem rota" }));
    }),
  );
  return calls;
}

function renderLogin(path = "/login") {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
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

async function fillAndSubmit(email = "m@g.com", password = "SenhaAtual#2024") {
  fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Senha"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("login renovado", () => {
  it("foco automático no e-mail, autocomplete correto e título da tela", async () => {
    mockApi();
    renderLogin();
    const email = await screen.findByLabelText("E-mail");
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "username");
    const password = screen.getByLabelText("Senha");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("heading", { level: 1, name: "Entrar no painel" })).toBeInTheDocument();
  });

  it("senha com mostrar/ocultar (botão nomeado, aria-pressed) sem alterar o valor digitado", async () => {
    mockApi();
    renderLogin();
    const password = await screen.findByLabelText("Senha");
    fireEvent.change(password, { target: { value: "Segredo#12345" } });
    const show = screen.getByRole("button", { name: "Mostrar senha" });
    expect(show).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(show);
    expect(password).toHaveAttribute("type", "text");
    expect(password).toHaveValue("Segredo#12345");
    const hide = screen.getByRole("button", { name: "Ocultar senha" });
    expect(hide).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(hide);
    expect(password).toHaveAttribute("type", "password");
  });

  it("aviso de Caps Lock: aparece com a tecla ligada na senha e some ao desligar ou sair do campo", async () => {
    mockApi();
    renderLogin();
    const password = await screen.findByLabelText("Senha");
    expect(screen.queryByTestId("caps-lock-warning")).not.toBeInTheDocument();

    fireEvent.keyDown(password, { key: "A", modifierCapsLock: true });
    const warning = await screen.findByTestId("caps-lock-warning");
    expect(warning).toHaveAttribute("role", "status");
    expect(warning).toHaveTextContent("Caps Lock está ligado");

    fireEvent.keyUp(password, { key: "CapsLock", modifierCapsLock: false });
    await waitFor(() => expect(screen.queryByTestId("caps-lock-warning")).not.toBeInTheDocument());

    fireEvent.keyDown(password, { key: "A", modifierCapsLock: true });
    await screen.findByTestId("caps-lock-warning");
    fireEvent.blur(password);
    await waitFor(() => expect(screen.queryByTestId("caps-lock-warning")).not.toBeInTheDocument());
  });

  it("bloco 'Ainda não usa o GingApp?' com botão 'Cadastrar meu grupo' que abre /comecar", async () => {
    mockApi();
    const router = renderLogin();
    const block = await screen.findByTestId("signup-block");
    expect(within(block).getByText("Ainda não usa o GingApp?")).toBeInTheDocument();
    const link = within(block).getByRole("link", { name: "Cadastrar meu grupo" });
    expect(link).toHaveAttribute("href", "/comecar");
    fireEvent.click(link);
    await waitFor(() => expect(router.state.location.pathname).toBe("/comecar"));
    expect(await screen.findByRole("heading", { level: 1, name: /Leve seu grupo para o GingApp/ })).toBeInTheDocument();
  });

  it("'Esqueci minha senha' fica na linha do rótulo da senha (mais visível) só com e-mail ligado, com alvo de toque >= 44 px", async () => {
    mockApi({ resetByEmail: true });
    renderLogin();
    const link = await screen.findByRole("link", { name: "Esqueci minha senha" });
    expect(link).toHaveAttribute("href", "/esqueci-senha");
    expect(link.className).toContain("min-h-11");
    // mesma linha do rótulo "Senha"
    const row = link.parentElement!;
    expect(within(row).getByText("Senha")).toBeInTheDocument();
  });

  it("links legais continuam exatamente /termos e /privacidade", async () => {
    mockApi();
    renderLogin();
    const links = (await screen.findByTestId("legal-links")).querySelectorAll("a");
    expect([...links].map((a) => a.getAttribute("href"))).toEqual(["/termos", "/privacidade"]);
  });

  it("layout: painel de benefícios (desktop) com 4 itens e a marca; no celular a marca fica no cartão; animação respeita reduced-motion", async () => {
    mockApi();
    renderLogin();
    const aside = await screen.findByTestId("login-benefits");
    expect(aside.className).toContain("hidden");
    expect(aside.className).toContain("lg:flex");
    expect(within(aside).getAllByRole("listitem")).toHaveLength(4);
    expect(within(aside).getByAltText("GingApp")).toBeInTheDocument();
    expect(screen.getByText("Painel de gestão do grupo", { selector: "p.text-sm.text-muted-foreground" })).toBeInTheDocument();
    const animated = document.querySelectorAll(".animate-in");
    expect(animated.length).toBeGreaterThan(0);
    animated.forEach((el) => expect(el.className).toContain("motion-reduce:animate-none"));
  });

  it("erro do servidor: role=alert ligado ao campo da senha (aria-describedby / aria-invalid) e o botão volta ao normal", async () => {
    mockApi({ onLogin: () => json(401, { message: "E-mail ou senha incorretos." }) });
    renderLogin();
    await fillAndSubmit();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("E-mail ou senha incorretos.");
    const password = screen.getByLabelText("Senha");
    expect(alert.id).toBe("login-error");
    expect(password.getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
    expect(getToken()).toBeNull();
  });

  it("estado de carregando: botão desabilitado, 'Entrando…' e aria-busy enquanto a API responde", async () => {
    let release: (response: Response) => void = () => {};
    mockApi({ onLogin: () => new Promise<Response>((resolve) => (release = resolve)) });
    renderLogin();
    await fillAndSubmit();
    const busy = await screen.findByRole("button", { name: "Entrando…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    await act(async () => release(json(200, { accessToken: "jwt-1", user: MESTRE })));
    await waitFor(() => expect(getToken()).toBe("jwt-1"));
  });

  it("Enter envia: o botão é type=submit dentro do mesmo <form> e o envio faz POST /auth/login com o corpo de sempre", async () => {
    const calls = mockApi();
    const router = renderLogin();
    const email = await screen.findByLabelText("E-mail");
    fireEvent.change(email, { target: { value: " m@g.com " } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: " SenhaAtual#2024" } });
    const button = screen.getByRole("button", { name: "Entrar" });
    expect(button).toHaveAttribute("type", "submit");
    const form = email.closest("form")!;
    expect(button.closest("form")).toBe(form);
    expect(form.contains(screen.getByLabelText("Senha"))).toBe(true);
    fireEvent.submit(form);
    await waitFor(() => expect(getToken()).toBe("jwt-1"));
    expect(calls.find((c) => c.path === "/auth/login")?.body).toEqual({ email: "m@g.com", password: " SenhaAtual#2024" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
  });

  it.each([
    ["/login?redirect=/alunos", "/alunos"],
    ["/login?redirect=//evil.com", "/dashboard"],
    ["/login?redirect=https://evil.com", "/dashboard"],
  ])("safeRedirect continua valendo: %s termina em %s", async (start, expected) => {
    mockApi();
    const router = renderLogin(start);
    await fillAndSubmit();
    await waitFor(() => expect(router.state.location.pathname).toBe(expected));
  });

  it("organizationSlug: erro de múltiplos grupos mostra 'Código do grupo' e o reenvio leva o slug", async () => {
    const answers = [
      json(400, { message: "Informe organizationSlug: há múltiplas organizações para este e-mail." }),
      json(200, { accessToken: "jwt-1", user: MESTRE }),
    ];
    const calls = mockApi({ onLogin: () => answers.shift()! });
    renderLogin();
    expect(screen.queryByLabelText("Código do grupo")).not.toBeInTheDocument();
    await fillAndSubmit();
    const slug = await screen.findByLabelText("Código do grupo");
    expect(screen.getByRole("alert")).toHaveTextContent("organizationSlug");
    fireEvent.change(slug, { target: { value: "ginga-brasil" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(getToken()).toBe("jwt-1"));
    const logins = calls.filter((c) => c.path === "/auth/login");
    expect(logins[0]!.body).toEqual({ email: "m@g.com", password: "SenhaAtual#2024" });
    expect(logins[1]!.body).toEqual({ email: "m@g.com", password: "SenhaAtual#2024", organizationSlug: "ginga-brasil" });
  });

  it("'Pertenço a mais de um grupo' continua abrindo o campo do código do grupo", async () => {
    mockApi();
    renderLogin();
    fireEvent.click(await screen.findByRole("button", { name: "Pertenço a mais de um grupo" }));
    expect(await screen.findByLabelText("Código do grupo")).toBeInTheDocument();
  });

  it("2FA intacto: o bloco de cadastro some no 2º passo e volta ao tocar em Voltar", async () => {
    mockApi({ onLogin: () => json(200, { twoFactorRequired: true, challengeToken: "ch-1" }) });
    renderLogin();
    await fillAndSubmit();
    expect(await screen.findByLabelText("Código de 6 dígitos")).toBeInTheDocument();
    expect(screen.queryByTestId("signup-block")).not.toBeInTheDocument();
    expect(getToken()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(await screen.findByTestId("signup-block")).toBeInTheDocument();
    expect(screen.getByLabelText("Senha")).toHaveValue("");
  });
});
