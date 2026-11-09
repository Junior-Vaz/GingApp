import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { Route as ConfirmRoute } from "@/routes/comecar_.confirmar.$token";
import { TOKEN_STORAGE_KEY } from "@/lib/session";
import { APPLICATION_TOKEN_STORAGE_KEY } from "@/lib/group-application";

/**
 * Confirmação do e-mail do solicitante (docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md, seção 4): tela "Pedido recebido" nos 2 modos,
 * reenvio, página /comecar/confirmar/$token e estado UNVERIFIED no acompanhamento.
 */
type Call = { method: string; path: string; url: string; body: unknown; headers: Record<string, string> };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const noContent = () => new Response(null, { status: 204 });

const TOKEN = "Tk_9aB3-xYz0123456789abcdefghijklmnopqrstu";
const VERIFY_TOKEN = "Vf_7cD1-qRs9876543210zyxwvutsrqponmlkjihg";
const VALID_PASSWORD = "Frase longa e segura 2026";

function mockApi(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const call: Call = {
        method: init.method ?? "GET",
        path: url.replace(/^https?:\/\/[^/]+\/api/, ""),
        url,
        body: init.body ? JSON.parse(init.body as string) : undefined,
        headers: (init.headers ?? {}) as Record<string, string>,
      };
      calls.push(call);
      return Promise.resolve(handler(call));
    }),
  );
  return calls;
}

function renderAt(path: string) {
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

function fillRequired() {
  fireEvent.change(screen.getByLabelText("Seu nome"), { target: { value: "Maria Souza" } });
  fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "maria@exemplo.com" } });
  fireEvent.change(screen.getByLabelText("Seu cargo"), { target: { value: "CONTRAMESTRE" } });
  fireEvent.change(screen.getByLabelText("Nome do grupo"), { target: { value: "Capoeira Raiz" } });
  fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Salvador" } });
  fireEvent.change(screen.getByLabelText("UF"), { target: { value: "BA" } });
  fireEvent.change(screen.getByLabelText("Crie uma senha"), { target: { value: VALID_PASSWORD } });
  fireEvent.click(screen.getByRole("checkbox", { name: /18 anos/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Termos de Uso/ }));
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Enviar pedido" }));
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();
const noAuthorization = (call: Call) => expect(Object.keys(call.headers).map((key) => key.toLowerCase())).not.toContain("authorization");

const statusBase = { groupName: "Capoeira Raiz", createdAt: "2026-11-05T14:00:00.000Z", decidedAt: null, rejectionReason: null, loginUrl: null };
const unverified = (extra: Record<string, unknown> = {}) => ({
  ...statusBase,
  status: "UNVERIFIED",
  emailVerification: "PENDING",
  canResend: true,
  resendAvailableAt: null,
  ...extra,
});

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("/comecar: tela 'Pedido recebido' conforme emailVerification", () => {
  /** POST devolve `post`; GET de status devolve `status` (a tela busca canResend/resendAvailableAt ali). */
  function setup(post: Record<string, unknown>, status: () => Response = () => json(200, unverified({ resendAvailableAt: inMs(4.5 * 60_000), canResend: false }))) {
    return mockApi((call) => {
      if (call.method === "POST" && call.path === "/public/group-applications") return json(201, post);
      if (call.method === "GET") return status();
      return json(404, {});
    });
  }

  it("PENDING (e-mail ligado): pede para confirmar o e-mail, vale 24 horas, spam, e o Reenviar fica desabilitado até resendAvailableAt", async () => {
    const calls = setup({ statusToken: TOKEN, status: "UNVERIFIED", emailVerification: "PENDING" });
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    fillRequired();
    submit();

    const received = await screen.findByTestId("application-received");
    expect(received).toHaveAttribute("data-email-verification", "PENDING");
    const box = screen.getByTestId("email-confirmation");
    expect(box).toHaveTextContent("Enviamos um e-mail para confirmar seu endereço.");
    expect(box).toHaveTextContent("Abra o link (vale 24 horas) para o pedido entrar na fila de análise. Confira o spam.");
    const resend = within(box).getByRole("button", { name: "Reenviar e-mail" });
    await waitFor(() => expect(screen.getByTestId("resend-hint")).toHaveTextContent(/Você poderá reenviar em 4:(29|30)/));
    expect(resend).toBeDisabled();
    expect(screen.getByTestId("resend-hint")).toHaveTextContent("até 3 reenvios");

    // continua explicando o que acontece e levando ao acompanhamento
    expect(screen.getByText(/Ainda não existe conta nem grupo/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acompanhar meu pedido" })).toHaveAttribute("href", `/comecar/acompanhar/${TOKEN}`);
    expect(screen.getByText(/Se esse e-mail já tem cadastro/)).toBeInTheDocument();

    // o POST foi um só, depois a consulta de status (GET, pelo token no PATH, sem Authorization)
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /public/group-applications", `GET /public/group-applications/${TOKEN}`]);
    noAuthorization(calls[1]!);
  });

  it("SKIPPED (envio de e-mail desligado): texto atual, sem pedir confirmação, sem botão de reenvio e sem consulta extra", async () => {
    const calls = setup({ statusToken: TOKEN, status: "PENDING", emailVerification: "SKIPPED" });
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    fillRequired();
    submit();

    const received = await screen.findByTestId("application-received");
    expect(received).toHaveAttribute("data-email-verification", "SKIPPED");
    expect(screen.queryByTestId("email-confirmation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reenviar e-mail" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Enviamos um e-mail/)).not.toBeInTheDocument();
    expect(screen.getByText(/Obrigado! A equipe do GingApp vai conferir/)).toBeInTheDocument();
    expect(screen.getByText(/Ainda não existe conta nem grupo/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acompanhar meu pedido" })).toHaveAttribute("href", `/comecar/acompanhar/${TOKEN}`);
    expect(calls).toHaveLength(1);
  });

  it("resposta antiga sem emailVerification (contrato anterior) cai no texto atual", async () => {
    const calls = setup({ statusToken: TOKEN, status: "PENDING" });
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    fillRequired();
    submit();
    expect(await screen.findByTestId("application-received")).toHaveAttribute("data-email-verification", "SKIPPED");
    expect(screen.queryByTestId("email-confirmation")).not.toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  async function openPending(status: () => Response) {
    const calls = setup({ statusToken: TOKEN, status: "UNVERIFIED", emailVerification: "PENDING" }, status);
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    fillRequired();
    submit();
    await screen.findByTestId("email-confirmation");
    return calls;
  }

  it("Reenviar habilitado (sem espera): POST no path do token de acompanhamento, sem corpo e sem Authorization; depois relê o status e desabilita", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "jwt-da-sessao");
    let statusReads = 0;
    const calls = mockApi((call) => {
      if (call.method === "POST" && call.path === "/public/group-applications") return json(201, { statusToken: TOKEN, status: "UNVERIFIED", emailVerification: "PENDING" });
      if (call.method === "POST" && call.path === `/public/group-applications/${TOKEN}/resend`) return noContent();
      statusReads += 1;
      // 1ª leitura: pode reenviar. 2ª (depois do reenvio): espera de 5 minutos.
      return json(200, statusReads === 1 ? unverified() : unverified({ canResend: false, resendAvailableAt: inMs(5 * 60_000) }));
    });
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    fillRequired();
    submit();
    await screen.findByTestId("email-confirmation");
    const resend = screen.getByRole("button", { name: "Reenviar e-mail" });
    await waitFor(() => expect(resend).toBeEnabled());
    expect(screen.getByTestId("resend-hint")).toHaveTextContent("até 3 vezes");

    fireEvent.click(resend);
    expect(await screen.findByText(/Pedimos o reenvio/)).toBeInTheDocument();
    const post = calls.find((c) => c.path.endsWith("/resend"))!;
    expect(post.method).toBe("POST");
    expect(post.path).toBe(`/public/group-applications/${TOKEN}/resend`);
    expect(post.body).toBeUndefined();
    expect(post.url).not.toContain("?");
    noAuthorization(post);

    await waitFor(() => expect(screen.getByRole("button", { name: "Reenviar e-mail" })).toBeDisabled());
    expect(screen.getByTestId("resend-hint")).toHaveTextContent(/Você poderá reenviar em 4:(5\d|60|59)|5:00/);
    expect(calls.filter((c) => c.path.endsWith("/resend"))).toHaveLength(1);
  });

  it("a espera termina sozinha: o botão volta a habilitar quando resendAvailableAt passa", async () => {
    await openPending(() => json(200, unverified({ canResend: false, resendAvailableAt: inMs(1500) })));
    const resend = screen.getByRole("button", { name: "Reenviar e-mail" });
    await waitFor(() => expect(screen.getByTestId("resend-hint")).toHaveTextContent(/Você poderá reenviar em 0:0\d/));
    expect(resend).toBeDisabled();
    await waitFor(() => expect(resend).toBeEnabled(), { timeout: 4000 });
    expect(screen.getByTestId("resend-hint")).not.toHaveTextContent("Você poderá reenviar em");
  }, 10_000);

  it("limite de 3 reenvios atingido (canResend false sem resendAvailableAt): desabilitado com a explicação", async () => {
    await openPending(() => json(200, unverified({ canResend: false, resendAvailableAt: null })));
    await waitFor(() => expect(screen.getByTestId("resend-hint")).toHaveTextContent("Você já usou os 3 reenvios deste pedido"));
    expect(screen.getByRole("button", { name: "Reenviar e-mail" })).toBeDisabled();
  });

  it("erro 429 com a mensagem do negócio em português: mostra a mensagem do servidor em role=alert e relê o status", async () => {
    let statusReads = 0;
    const calls = mockApi((call) => {
      if (call.method === "POST" && call.path === "/public/group-applications") return json(201, { statusToken: TOKEN, status: "UNVERIFIED", emailVerification: "PENDING" });
      if (call.path.endsWith("/resend")) return json(429, { message: "Aguarde 5 minutos entre os reenvios." });
      statusReads += 1;
      return json(200, statusReads === 1 ? unverified() : unverified({ canResend: false, resendAvailableAt: inMs(5 * 60_000) }));
    });
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    fillRequired();
    submit();
    await screen.findByTestId("email-confirmation");
    const resend = screen.getByRole("button", { name: "Reenviar e-mail" });
    await waitFor(() => expect(resend).toBeEnabled());
    fireEvent.click(resend);
    expect(await screen.findByRole("alert")).toHaveTextContent("Aguarde 5 minutos entre os reenvios.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Reenviar e-mail" })).toBeDisabled());
    expect(calls.filter((c) => c.path.endsWith("/resend"))).toHaveLength(1);
  });

  it("erro 429 genérico do limitador (inglês) vira texto amigável em português; 500 e falha de rede também", async () => {
    const answers = [
      () => json(429, { message: "ThrottlerException: Too Many Requests" }),
      () => json(500, { message: "boom" }),
      () => {
        throw new TypeError("Failed to fetch");
      },
    ];
    mockApi((call) => {
      if (call.method === "POST" && call.path === "/public/group-applications") return json(201, { statusToken: TOKEN, status: "UNVERIFIED", emailVerification: "PENDING" });
      if (call.path.endsWith("/resend")) return answers.shift()!();
      return json(200, unverified());
    });
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    fillRequired();
    submit();
    await screen.findByTestId("email-confirmation");
    const click = async () => {
      await waitFor(() => expect(screen.getByRole("button", { name: "Reenviar e-mail" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Reenviar e-mail" }));
    };
    await click();
    expect(await screen.findByRole("alert")).toHaveTextContent("Muitos reenvios seguidos. Aguarde um pouco e tente novamente.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Throttler");
    await click();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("O serviço está indisponível no momento"));
    await click();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Verifique sua conexão"));
  });

  it("pedido que o servidor não reconhece pelo token (404, ex.: e-mail que já tinha conta): o reenvio continua neutro", async () => {
    const calls = mockApi((call) => {
      if (call.method === "POST" && call.path === "/public/group-applications") return json(201, { statusToken: TOKEN, status: "UNVERIFIED", emailVerification: "PENDING" });
      if (call.path.endsWith("/resend")) return noContent();
      return json(404, { message: "Pedido não encontrado." });
    });
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    fillRequired();
    submit();
    await screen.findByTestId("email-confirmation");
    const resend = screen.getByRole("button", { name: "Reenviar e-mail" });
    await waitFor(() => expect(resend).toBeEnabled());
    fireEvent.click(resend);
    expect(await screen.findByText(/Pedimos o reenvio/)).toBeInTheDocument();
    expect(calls.filter((c) => c.path.endsWith("/resend"))).toHaveLength(1);
  });

  it("se o e-mail já foi confirmado em outra aba, a tela diz isso e não oferece reenviar", async () => {
    await openPending(() => json(200, { ...statusBase, status: "PENDING", emailVerification: "VERIFIED" }));
    expect(await screen.findByTestId("resend-already-confirmed")).toHaveTextContent("Seu e-mail já foi confirmado");
    expect(screen.queryByRole("button", { name: "Reenviar e-mail" })).not.toBeInTheDocument();
  });
});

describe("/comecar/confirmar/$token", () => {
  it("abre SEM chamar a API (nunca confirma ao abrir): só mostra o botão 'Confirmar meu e-mail'", async () => {
    const calls = mockApi(() => json(200, { status: "PENDING" }));
    const router = renderAt(`/comecar/confirmar/${VERIFY_TOKEN}`);
    expect(await screen.findByRole("button", { name: "Confirmar meu e-mail" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "Confirme seu e-mail" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/comecar/confirmar/${VERIFY_TOKEN}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls).toHaveLength(0);
    expect(screen.queryByTestId("confirm-success")).not.toBeInTheDocument();
    expect(screen.queryByTestId("confirm-invalid")).not.toBeInTheDocument();
  });

  it("noindex e referrer no-referrer, como a página de acompanhamento", () => {
    const meta = (ConfirmRoute.options.head as () => { meta: Record<string, string>[] })().meta;
    expect(meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(meta).toContainEqual({ name: "referrer", content: "no-referrer" });
  });

  it("clique: POST /public/group-applications/confirm com { token }, sem Authorization e sem query; sucesso com link para acompanhar (token salvo)", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "jwt-da-sessao");
    localStorage.setItem(APPLICATION_TOKEN_STORAGE_KEY, TOKEN);
    const calls = mockApi(() => json(200, { status: "PENDING" }));
    const router = renderAt(`/comecar/confirmar/${VERIFY_TOKEN}`);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar meu e-mail" }));

    expect(await screen.findByTestId("confirm-success")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "E-mail confirmado!" })).toBeInTheDocument();
    expect(screen.getByText(/Seu pedido entrou na fila de análise/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acompanhar meu pedido" })).toHaveAttribute("href", `/comecar/acompanhar/${TOKEN}`);
    expect(screen.queryByRole("button", { name: "Confirmar meu e-mail" })).not.toBeInTheDocument();

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/public/group-applications/confirm");
    expect(call.body).toEqual({ token: VERIFY_TOKEN });
    expect(call.url).not.toContain("?");
    expect(call.url).not.toContain(VERIFY_TOKEN);
    noAuthorization(call);
    expect(router.state.location.search).toEqual({});
  });

  it("sucesso sem token de acompanhamento salvo (outro aparelho): sem link quebrado, só a orientação", async () => {
    mockApi(() => json(200, { status: "PENDING" }));
    renderAt(`/comecar/confirmar/${VERIFY_TOKEN}`);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar meu e-mail" }));
    await screen.findByTestId("confirm-success");
    expect(screen.queryByRole("link", { name: "Acompanhar meu pedido" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Acompanhar meu pedido");
  });

  it("carregando: o botão fica desabilitado ('Confirmando…') e um segundo clique não duplica o POST", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = mockApi(() => gate.then(() => json(200, { status: "PENDING" })));
    renderAt(`/comecar/confirmar/${VERIFY_TOKEN}`);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar meu e-mail" }));
    const busy = await screen.findByRole("button", { name: /Confirmando/ });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(calls).toHaveLength(1);
    release();
    expect(await screen.findByTestId("confirm-success")).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  it("404 (link inválido, vencido ou já usado): mensagem uniforme, link para /comecar e, havendo token salvo, para acompanhar", async () => {
    localStorage.setItem(APPLICATION_TOKEN_STORAGE_KEY, TOKEN);
    mockApi(() => json(404, { message: "Link inválido ou vencido." }));
    renderAt(`/comecar/confirmar/${VERIFY_TOKEN}`);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar meu e-mail" }));
    expect(await screen.findByTestId("confirm-invalid")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Link inválido ou vencido" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voltar ao cadastro" })).toHaveAttribute("href", "/comecar");
    expect(screen.getByRole("link", { name: "Acompanhar meu pedido" })).toHaveAttribute("href", `/comecar/acompanhar/${TOKEN}`);
    expect(screen.queryByTestId("confirm-success")).not.toBeInTheDocument();
  });

  it("404 sem token salvo: link para /comecar e orientação para pedir novo e-mail pelo acompanhamento", async () => {
    mockApi(() => json(404, { message: "Link inválido ou vencido." }));
    renderAt(`/comecar/confirmar/${VERIFY_TOKEN}`);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar meu e-mail" }));
    await screen.findByTestId("confirm-invalid");
    expect(screen.queryByRole("link", { name: "Acompanhar meu pedido" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voltar ao cadastro" })).toHaveAttribute("href", "/comecar");
  });

  it("falha de rede, 429 e 500 NÃO viram 'link inválido': mostram o erro e deixam tentar de novo até dar certo", async () => {
    const answers = [
      () => {
        throw new TypeError("Failed to fetch");
      },
      () => json(429, { message: "ThrottlerException: Too Many Requests" }),
      () => json(500, { message: "boom" }),
      () => json(200, { status: "PENDING" }),
    ];
    mockApi(() => answers.shift()!());
    renderAt(`/comecar/confirmar/${VERIFY_TOKEN}`);
    const click = async () => fireEvent.click(await screen.findByRole("button", { name: "Confirmar meu e-mail" }));

    await click();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Verifique sua conexão"));
    expect(screen.queryByTestId("confirm-invalid")).not.toBeInTheDocument();
    await click();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Muitas tentativas deste dispositivo"));
    expect(screen.getByRole("alert")).not.toHaveTextContent("Throttler");
    await click();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("O serviço está indisponível no momento"));
    await click();
    expect(await screen.findByTestId("confirm-success")).toBeInTheDocument();
  });
});

describe("/comecar/acompanhar/$token: estado UNVERIFIED", () => {
  it("mostra 'Falta confirmar seu e-mail' com reenviar, sem e-mail nem dados pessoais, e sem Authorization", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "jwt-da-sessao");
    const calls = mockApi(() => json(200, unverified()));
    renderAt(`/comecar/acompanhar/${TOKEN}`);
    expect(await screen.findByTestId("status-unverified")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Falta confirmar seu e-mail" })).toBeInTheDocument();
    expect(screen.getByText("Capoeira Raiz")).toBeInTheDocument();
    expect(screen.getByText(/Enviamos um e-mail para o endereço informado/)).toBeInTheDocument();
    expect(screen.getByText(/vale 24 horas/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Em análise" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reenviar e-mail" })).toBeEnabled());
    expect(document.body.textContent).not.toMatch(/@/);
    // uma única consulta (o reenvio compartilha a mesma), sem Authorization
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe(`/public/group-applications/${TOKEN}`);
    noAuthorization(calls[0]!);
  });

  it("reenviar a partir do acompanhamento: POST no path do token e a tela relê o status (agora com espera)", async () => {
    let reads = 0;
    const calls = mockApi((call) => {
      if (call.path.endsWith("/resend")) return noContent();
      reads += 1;
      return json(200, reads === 1 ? unverified() : unverified({ canResend: false, resendAvailableAt: inMs(5 * 60_000) }));
    });
    renderAt(`/comecar/acompanhar/${TOKEN}`);
    await screen.findByTestId("status-unverified");
    const resend = screen.getByRole("button", { name: "Reenviar e-mail" });
    await waitFor(() => expect(resend).toBeEnabled());
    fireEvent.click(resend);
    expect(await screen.findByText(/Pedimos o reenvio/)).toBeInTheDocument();
    expect(screen.getByTestId("status-unverified")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reenviar e-mail" })).toBeDisabled());
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET /public/group-applications/${TOKEN}`,
      `POST /public/group-applications/${TOKEN}/resend`,
      `GET /public/group-applications/${TOKEN}`,
    ]);
  });

  it("com espera ativa o botão vem desabilitado com a contagem; sem reenvios restantes, explica o limite", async () => {
    mockApi(() => json(200, unverified({ canResend: false, resendAvailableAt: inMs(3 * 60_000) })));
    renderAt(`/comecar/acompanhar/${TOKEN}`);
    await screen.findByTestId("status-unverified");
    expect(screen.getByRole("button", { name: "Reenviar e-mail" })).toBeDisabled();
    expect(screen.getByTestId("resend-hint")).toHaveTextContent(/Você poderá reenviar em (2:59|3:00)/);
  });

  it("limite atingido no acompanhamento", async () => {
    mockApi(() => json(200, unverified({ canResend: false, resendAvailableAt: null })));
    renderAt(`/comecar/acompanhar/${TOKEN}`);
    await screen.findByTestId("status-unverified");
    expect(screen.getByRole("button", { name: "Reenviar e-mail" })).toBeDisabled();
    expect(screen.getByTestId("resend-hint")).toHaveTextContent("Você já usou os 3 reenvios deste pedido");
  });

  it("PENDING com emailVerification SKIPPED/VERIFIED continua 'Em análise' (sem bloco de reenvio)", async () => {
    for (const emailVerification of ["SKIPPED", "VERIFIED"]) {
      mockApi(() => json(200, { ...statusBase, status: "PENDING", emailVerification }));
      renderAt(`/comecar/acompanhar/${TOKEN}`);
      expect(await screen.findByTestId("status-pending")).toBeInTheDocument();
      expect(screen.queryByTestId("resend-box")).not.toBeInTheDocument();
      expect(screen.queryByTestId("status-unverified")).not.toBeInTheDocument();
      cleanup();
    }
  });
});
