import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { TOKEN_STORAGE_KEY } from "@/lib/session";
import {
  APPLICATION_TOKEN_STORAGE_KEY,
  CLAIMED_ROLES,
  CLAIMED_ROLE_LABEL,
  GROUP_APPLICATION_UFS,
  INSTAGRAM_MAX_LENGTH,
  groupApplicationSchema,
  emptyGroupApplicationForm,
  passwordStrength,
  readApplicationToken,
  toGroupApplicationPayload,
} from "@/lib/group-application";

type Call = { method: string; path: string; url: string; body: unknown; headers: Record<string, string>; cache: RequestCache | undefined };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const TOKEN = "Tk_9aB3-xYz0123456789abcdefghijklmnopqrstu";

/** fetch falso: registra método, caminho, corpo, cabeçalhos e `cache` de cada chamada; `handler` decide a resposta. */
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
        cache: init.cache,
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

const VALID_PASSWORD = "Frase longa e segura 2026";

/** Preenche o formulário com dados válidos (só os obrigatórios), sem enviar. */
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

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("lib/group-application", () => {
  it("cargos com rótulos em português e as 27 UFs; o cargo informado não é papel", () => {
    expect(CLAIMED_ROLES).toEqual(["MESTRE", "CONTRAMESTRE", "PROFESSOR", "INSTRUTOR", "MONITOR", "OUTRO"]);
    expect(CLAIMED_ROLE_LABEL.CONTRAMESTRE).toBe("Contramestre");
    expect(CLAIMED_ROLE_LABEL.OUTRO).toBe("Outro");
    expect(GROUP_APPLICATION_UFS).toHaveLength(27);
    expect(GROUP_APPLICATION_UFS).toContain("BA");
  });

  it("senha: 12 a 72 bytes (UTF-8), nunca aparada; espaços contam", () => {
    const base = { ...emptyGroupApplicationForm, applicantName: "Maria", email: "m@e.com", claimedRole: "OUTRO", groupName: "Grupo", city: "Rio", state: "RJ", adult: true, acceptTerms: true };
    const passwordIssue = (password: string) =>
      groupApplicationSchema.safeParse({ ...base, password }).error?.issues.find((issue) => issue.path[0] === "password")?.message;
    expect(passwordIssue("a".repeat(11))).toMatch(/no mínimo 12 caracteres/);
    expect(passwordIssue("a".repeat(12))).toBeUndefined();
    expect(passwordIssue(" ".repeat(12))).toBeUndefined(); // espaços não são aparados
    expect(passwordIssue("a".repeat(72))).toBeUndefined();
    expect(passwordIssue("a".repeat(73))).toMatch(/no máximo 72 bytes/);
    expect(passwordIssue("é".repeat(37))).toMatch(/no máximo 72 bytes/); // 37 x 2 bytes = 74
    expect(passwordIssue("Dev@12345abcdef")).toMatch(/senha padrão/);
  });

  it("instagram no schema: vazio ou @/usuário/link sem espaços passam; espaço ou comprimento absurdo não (rigor é do servidor)", () => {
    const base = { ...emptyGroupApplicationForm, applicantName: "Maria", email: "m@e.com", claimedRole: "OUTRO", groupName: "Grupo", city: "Rio", state: "RJ", password: "Frase longa e segura 2026", adult: true, acceptTerms: true };
    const issue = (instagram: string) =>
      groupApplicationSchema.safeParse({ ...base, instagram }).error?.issues.find((i) => i.path[0] === "instagram")?.message;
    for (const ok of ["", "   ", "@meugrupo", "meugrupo", "instagram.com/meugrupo", "https://www.instagram.com/meugrupo/?igsh=x"]) {
      expect(issue(ok)).toBeUndefined();
    }
    expect(issue("meu grupo")).toBe("Informe o Instagram como @usuario ou o link do perfil.");
    expect(issue("@meu\tgrupo")).toBe("Informe o Instagram como @usuario ou o link do perfil.");
    expect(issue("a".repeat(INSTAGRAM_MAX_LENGTH))).toBeUndefined();
    expect(issue("a".repeat(INSTAGRAM_MAX_LENGTH + 1))).toBe("Informe o Instagram como @usuario ou o link do perfil.");
  });

  it("payload: instagram só entra quando preenchido (aparado)", () => {
    const values = { ...emptyGroupApplicationForm, applicantName: "Maria", email: "m@e.com", claimedRole: "MESTRE", groupName: "G", city: "Rio", state: "RJ", password: "Frase longa e segura 2026", adult: true, acceptTerms: true };
    expect(toGroupApplicationPayload(values)).not.toHaveProperty("instagram");
    expect(toGroupApplicationPayload({ ...values, instagram: "  " })).not.toHaveProperty("instagram");
    expect(toGroupApplicationPayload({ ...values, instagram: " @meugrupo " }).instagram).toBe("@meugrupo");
  });

  it("força da senha é só dica (fraca/boa/forte)", () => {
    expect(passwordStrength("").level).toBe(0);
    expect(passwordStrength("curta").label).toBe("Fraca");
    expect(passwordStrength("somenteletrasminusculas").label).toBe("Fraca");
    expect(passwordStrength("letrasenumero12").label).toBe("Boa");
    expect(passwordStrength("Frase Longa E Segura 2026!").label).toBe("Forte");
  });

  it("payload: opcionais vazios são omitidos e nada é enviado a mais que o contrato", () => {
    const payload = toGroupApplicationPayload({
      ...emptyGroupApplicationForm,
      applicantName: "  Maria  ",
      email: " m@e.com ",
      claimedRole: "MESTRE",
      groupName: "G",
      city: "Rio",
      state: "RJ",
      password: " senha com espaços ",
      adult: true,
      acceptTerms: true,
    });
    expect(payload).toEqual({
      applicantName: "Maria",
      email: "m@e.com",
      password: " senha com espaços ",
      claimedRole: "MESTRE",
      groupName: "G",
      city: "Rio",
      state: "RJ",
      acceptTerms: true,
      adult: true,
      website: "",
    });
  });
});

describe("/comecar (página pública)", () => {
  it("abre sem login com título, 3 passos, benefícios, FAQ e links legais", async () => {
    const calls = mockApi(() => json(404, {}));
    const router = renderAt("/comecar");
    expect(await screen.findByRole("heading", { level: 1, name: "Leve seu grupo para o GingApp — é gratuito" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/comecar");
    const steps = within(screen.getByRole("heading", { name: "Como funciona" }).closest("section")!).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent("Faça o pedido");
    expect(steps[1]).toHaveTextContent("A equipe confere e aprova");
    expect(steps[1]).toHaveTextContent("sem prazo prometido");
    expect(steps[2]).toHaveTextContent("Entre no painel e siga o passo a passo");
    expect(screen.getByRole("heading", { name: "O que seu grupo ganha" })).toBeInTheDocument();
    expect(screen.getByText("É mesmo gratuito?")).toBeInTheDocument();
    expect(screen.getByText(/peça ao Mestre do seu grupo para cadastrar você em Professores/i)).toBeInTheDocument();
    const links = [...screen.getByTestId("legal-links").querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/termos", "/privacidade"]);
    expect(screen.queryByTestId("track-saved")).not.toBeInTheDocument();
    // a página não chama a API ao abrir
    expect(calls).toHaveLength(0);
  });

  it("formulário vazio: mostra as mensagens de cada campo e NÃO chama a API", async () => {
    const calls = mockApi(() => json(201, { statusToken: TOKEN, status: "PENDING" }));
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    submit();
    expect(await screen.findByText("Informe o seu nome.")).toBeInTheDocument();
    expect(screen.getByText("Informe o e-mail.")).toBeInTheDocument();
    expect(screen.getByText("Escolha o seu cargo.")).toBeInTheDocument();
    expect(screen.getByText("Informe o nome do grupo.")).toBeInTheDocument();
    expect(screen.getByText("Informe a cidade.")).toBeInTheDocument();
    expect(screen.getByText("Escolha a UF.")).toBeInTheDocument();
    expect(screen.getByText("Crie uma senha.")).toBeInTheDocument();
    expect(screen.getByText("Confirme que você tem 18 anos ou mais.")).toBeInTheDocument();
    expect(screen.getByText("É preciso aceitar os Termos de Uso e a Política de Privacidade.")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("validações de campo: e-mail, telefone, alunos, senha curta/longa", async () => {
    const calls = mockApi(() => json(201, { statusToken: TOKEN, status: "PENDING" }));
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    fillRequired();
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "sem-arroba" } });
    fireEvent.change(screen.getByLabelText("Telefone (opcional)"), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("Quantos alunos, mais ou menos? (opcional)"), { target: { value: "100001" } });
    fireEvent.change(screen.getByLabelText("Crie uma senha"), { target: { value: "curta" } });
    fireEvent.change(screen.getByLabelText("Seu nome"), { target: { value: "M" } });
    submit();
    expect(await screen.findByText("E-mail inválido.")).toBeInTheDocument();
    expect(screen.getByText(/Telefone inválido/)).toBeInTheDocument();
    expect(screen.getByText(/Informe um número inteiro de 0 a 100000/)).toBeInTheDocument();
    expect(screen.getByText("A senha deve ter no mínimo 12 caracteres.")).toBeInTheDocument();
    expect(screen.getByText(/precisa ter ao menos 2 letras/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Crie uma senha"), { target: { value: "a".repeat(73) } });
    submit();
    expect(await screen.findByText("A senha deve ter no máximo 72 bytes (UTF-8).")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("envia o corpo EXATO do contrato (sem opcionais), sem Authorization, e mostra 'Pedido recebido' com o token só no path", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "jwt-da-sessao"); // sessão aberta no navegador: a rota pública não pode levá-la
    const calls = mockApi(() => json(201, { statusToken: TOKEN, status: "PENDING" }));
    const router = renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    fillRequired();
    submit();

    expect(await screen.findByTestId("application-received")).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/public/group-applications");
    expect(call.body).toEqual({
      applicantName: "Maria Souza",
      email: "maria@exemplo.com",
      password: VALID_PASSWORD,
      claimedRole: "CONTRAMESTRE",
      groupName: "Capoeira Raiz",
      city: "Salvador",
      state: "BA",
      acceptTerms: true,
      adult: true,
      website: "",
    });
    expect(Object.keys(call.headers).map((key) => key.toLowerCase())).not.toContain("authorization");

    // explica o que acontece agora e leva ao acompanhamento (token no PATH, nunca em query)
    expect(screen.getByRole("heading", { name: "Pedido recebido" })).toBeInTheDocument();
    expect(screen.getByText(/Ainda não existe conta nem grupo/)).toBeInTheDocument();
    expect(screen.getByText(/Se esse e-mail já tem cadastro/)).toBeInTheDocument();
    const track = screen.getByRole("link", { name: "Acompanhar meu pedido" });
    expect(track).toHaveAttribute("href", `/comecar/acompanhar/${TOKEN}`);
    expect(router.state.location.search).toEqual({});
    expect(router.state.location.href).not.toContain(TOKEN);
    expect(router.state.location.href).not.toContain("maria@exemplo.com");
    expect(call.url).not.toContain("?");

    // token guardado como conveniência; e-mail e senha NUNCA
    expect(localStorage.getItem(APPLICATION_TOKEN_STORAGE_KEY)).toBe(TOKEN);
    const stored = JSON.stringify({ ...localStorage });
    expect(stored).not.toContain(VALID_PASSWORD);
    expect(stored).not.toContain("maria@exemplo.com");
  });

  it("envia também os opcionais preenchidos (telefone, alunos como número, mensagem) e o cargo OUTRO", async () => {
    const calls = mockApi(() => json(201, { statusToken: TOKEN, status: "PENDING" }));
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    fillRequired();
    fireEvent.change(screen.getByLabelText("Seu cargo"), { target: { value: "OUTRO" } });
    fireEvent.change(screen.getByLabelText("Telefone (opcional)"), { target: { value: "(71) 91234-5678" } });
    fireEvent.change(screen.getByLabelText("Quantos alunos, mais ou menos? (opcional)"), { target: { value: " 45 " } });
    fireEvent.change(screen.getByLabelText("Conte sobre o grupo (opcional)"), { target: { value: " Treinamos no Pelourinho. " } });
    submit();
    await screen.findByTestId("application-received");
    expect(calls[0]!.body).toEqual({
      applicantName: "Maria Souza",
      email: "maria@exemplo.com",
      phone: "(71) 91234-5678",
      password: VALID_PASSWORD,
      claimedRole: "OUTRO",
      groupName: "Capoeira Raiz",
      city: "Salvador",
      state: "BA",
      estimatedStudents: 45,
      message: "Treinamos no Pelourinho.",
      acceptTerms: true,
      adult: true,
      website: "",
    });
  });

  it("Instagram (opcional): rótulo e dica do contrato; vazio é omitido do corpo", async () => {
    const calls = mockApi(() => json(201, { statusToken: TOKEN, status: "PENDING" }));
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    const field = screen.getByLabelText("Instagram do grupo (opcional)");
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("autocomplete", "off");
    expect(screen.getByText("Ajuda a equipe a conferir seu pedido. Ex.: @meugrupo ou o link do perfil")).toBeInTheDocument();

    fillRequired();
    fireEvent.change(field, { target: { value: "   " } }); // só espaços = vazio
    submit();
    await screen.findByTestId("application-received");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).not.toHaveProperty("instagram");
  });

  it("Instagram preenchido é enviado como digitado (aparado): o servidor é quem normaliza para o handle", async () => {
    const calls = mockApi(() => json(201, { statusToken: TOKEN, status: "PENDING" }));
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    fillRequired();
    fireEvent.change(screen.getByLabelText("Instagram do grupo (opcional)"), {
      target: { value: " https://www.instagram.com/Capoeira.Raiz/?igsh=abc " },
    });
    submit();
    await screen.findByTestId("application-received");
    expect((calls[0]!.body as { instagram?: string }).instagram).toBe("https://www.instagram.com/Capoeira.Raiz/?igsh=abc");

    // e o handle simples também
    const handle = mockApi(() => json(201, { statusToken: TOKEN, status: "PENDING" }));
    cleanup();
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    fillRequired();
    fireEvent.change(screen.getByLabelText("Instagram do grupo (opcional)"), { target: { value: "@meugrupo" } });
    submit();
    await screen.findByTestId("application-received");
    expect((handle[0]!.body as { instagram?: string }).instagram).toBe("@meugrupo");
  });

  it("Instagram com espaço no meio não é enviado: mostra a mensagem do contrato", async () => {
    const calls = mockApi(() => json(201, { statusToken: TOKEN, status: "PENDING" }));
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    fillRequired();
    fireEvent.change(screen.getByLabelText("Instagram do grupo (opcional)"), { target: { value: "meu grupo" } });
    submit();
    expect(await screen.findByText("Informe o Instagram como @usuario ou o link do perfil.")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("honeypot: campo 'website' fora da vista (não display:none), fora do foco e dos leitores de tela, vazio no envio", async () => {
    const calls = mockApi(() => json(201, { statusToken: TOKEN, status: "PENDING" }));
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    const wrapper = screen.getByTestId("honeypot");
    expect(wrapper).toHaveAttribute("aria-hidden", "true");
    expect(wrapper.style.position).toBe("absolute");
    expect(wrapper.style.left).toBe("-10000px");
    expect(wrapper.style.display).not.toBe("none");
    const input = wrapper.querySelector("input")!;
    expect(input).toHaveAttribute("name", "website");
    expect(input).toHaveAttribute("tabindex", "-1");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input.value).toBe("");
    // fora da árvore de acessibilidade: nenhum textbox "website"
    expect(screen.queryByRole("textbox", { name: /site/i })).not.toBeInTheDocument();

    fillRequired();
    submit();
    await screen.findByTestId("application-received");
    expect((calls[0]!.body as { website: string }).website).toBe("");
  });

  it("honeypot preenchido por robô chega ao servidor como foi preenchido (ele descarta em silêncio); o front não finge sucesso", async () => {
    const calls = mockApi(() => json(201, { statusToken: TOKEN, status: "PENDING" }));
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    fillRequired();
    fireEvent.change(screen.getByTestId("honeypot").querySelector("input")!, { target: { value: "http://spam.example" } });
    submit();
    await screen.findByTestId("application-received");
    expect((calls[0]!.body as { website: string }).website).toBe("http://spam.example");
  });

  it("erro 400: mostra a mensagem do servidor em role=alert, mantém os dados e não grava token", async () => {
    mockApi(() => json(400, { message: ["Cidade inválida.", "Senha fraca."] }));
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    fillRequired();
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Cidade inválida. Senha fraca.");
    expect(screen.queryByTestId("application-received")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nome do grupo")).toHaveValue("Capoeira Raiz");
    expect(screen.getByRole("button", { name: "Enviar pedido" })).toBeEnabled();
    expect(localStorage.getItem(APPLICATION_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("erro 429: texto amigável; 500: serviço indisponível; falha de rede: verifique a conexão", async () => {
    const answers = [json(429, { message: "ThrottlerException: Too Many Requests" }), json(500, { message: "boom" })];
    mockApi(() => {
      const next = answers.shift();
      if (next) return next;
      throw new TypeError("Failed to fetch");
    });
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    fillRequired();
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Muitos pedidos deste dispositivo. Aguarde um pouco e tente novamente.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Throttler");

    submit();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("O serviço está indisponível no momento"));

    submit();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Verifique sua conexão"));
    expect(screen.queryByTestId("application-received")).not.toBeInTheDocument();
  });

  it("localStorage indisponível não quebra o envio: o botão de acompanhar continua na tela de sucesso", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    mockApi(() => json(201, { statusToken: TOKEN, status: "PENDING" }));
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    expect(screen.queryByTestId("track-saved")).not.toBeInTheDocument();
    fillRequired();
    submit();
    expect(await screen.findByTestId("application-received")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acompanhar meu pedido" })).toHaveAttribute("href", `/comecar/acompanhar/${TOKEN}`);
    expect(readApplicationToken()).toBeNull();
  });

  it("com token salvo de um pedido anterior, o link 'Acompanhar meu pedido' aparece no topo", async () => {
    localStorage.setItem(APPLICATION_TOKEN_STORAGE_KEY, TOKEN);
    mockApi(() => json(404, {}));
    renderAt("/comecar");
    const banner = await screen.findByTestId("track-saved");
    expect(within(banner).getByRole("link", { name: "Acompanhar meu pedido" })).toHaveAttribute("href", `/comecar/acompanhar/${TOKEN}`);
  });

  it("token salvo com formato inválido (lixo no storage) é ignorado", async () => {
    localStorage.setItem(APPLICATION_TOKEN_STORAGE_KEY, "<script>alert(1)</script>");
    mockApi(() => json(404, {}));
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    expect(screen.queryByTestId("track-saved")).not.toBeInTheDocument();
  });

  it("senha: mostrar/ocultar, requisitos ao vivo e dica de força", async () => {
    mockApi(() => json(404, {}));
    renderAt("/comecar");
    const password = await screen.findByLabelText("Crie uma senha");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    fireEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(password).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Ocultar senha" }));
    expect(password).toHaveAttribute("type", "password");

    const hints = screen.getByTestId("password-hints");
    expect(within(hints).getByText("No mínimo 12 caracteres").closest("li")).toHaveAttribute("data-ok", "false");
    fireEvent.change(password, { target: { value: "Frase Longa E Segura 2026!" } });
    expect(within(hints).getByText("No mínimo 12 caracteres").closest("li")).toHaveAttribute("data-ok", "true");
    expect(screen.getByTestId("password-strength")).toHaveTextContent("Força: Forte");
  });

  it("os links dos termos abrem em outra aba (não perdem o formulário) e o cabeçalho leva ao login", async () => {
    mockApi(() => json(404, {}));
    renderAt("/comecar");
    await screen.findByRole("button", { name: "Enviar pedido" });
    const terms = screen.getByRole("checkbox", { name: /Termos de Uso/ }).closest("div")!.querySelector('a[href="/termos"]')!;
    expect(terms).toHaveAttribute("target", "_blank");
    expect(terms).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getAllByRole("link", { name: "Entrar" })[0]).toHaveAttribute("href", "/login");
  });
});

describe("/comecar/acompanhar/$token", () => {
  const base = { groupName: "Capoeira Raiz", createdAt: "2026-11-05T14:00:00.000Z", decidedAt: null, rejectionReason: null, loginUrl: null };

  it("Em análise: consulta pelo PATH, sem Authorization (mesmo com sessão aberta) e sem query", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "jwt-da-sessao");
    const calls = mockApi(() => json(200, { ...base, status: "PENDING" }));
    renderAt(`/comecar/acompanhar/${TOKEN}`);
    expect(await screen.findByTestId("status-pending")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Em análise" })).toBeInTheDocument();
    expect(screen.getByText("Capoeira Raiz")).toBeInTheDocument();
    expect(screen.getByText(/05\/11\/2026/)).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.path).toBe(`/public/group-applications/${TOKEN}`);
    expect(calls[0]!.url).not.toContain("?");
    expect(calls[0]!.cache).toBe("no-store");
    expect(Object.keys(calls[0]!.headers).map((key) => key.toLowerCase())).not.toContain("authorization");
    expect(screen.queryByRole("link", { name: "Entrar no painel" })).not.toBeInTheDocument();
  });

  it("Aprovado: botão 'Entrar no painel' leva a /login (ignora loginUrl externo)", async () => {
    mockApi(() =>
      json(200, { ...base, status: "APPROVED", decidedAt: "2026-11-06T10:00:00.000Z", loginUrl: "https://painel.exemplo.com/login" }),
    );
    renderAt(`/comecar/acompanhar/${TOKEN}`);
    expect(await screen.findByTestId("status-approved")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Aprovado" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Entrar no painel" })).toHaveAttribute("href", "/login");
  });

  it("Não aprovado: mostra o motivo e o botão 'Fazer novo pedido' leva a /comecar", async () => {
    mockApi(() =>
      json(200, {
        ...base,
        status: "REJECTED",
        decidedAt: "2026-11-06T10:00:00.000Z",
        rejectionReason: "Não conseguimos confirmar o grupo. Envie mais detalhes no novo pedido.",
      }),
    );
    renderAt(`/comecar/acompanhar/${TOKEN}`);
    expect(await screen.findByTestId("status-rejected")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Não aprovado" })).toBeInTheDocument();
    expect(screen.getByTestId("rejection-reason")).toHaveTextContent("Não conseguimos confirmar o grupo.");
    expect(screen.getByRole("link", { name: "Fazer novo pedido" })).toHaveAttribute("href", "/comecar");
  });

  it("Expirado: mensagem própria e novo pedido", async () => {
    mockApi(() => json(200, { ...base, status: "EXPIRED" }));
    renderAt(`/comecar/acompanhar/${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "Pedido expirado" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fazer novo pedido" })).toHaveAttribute("href", "/comecar");
  });

  it("404: 'Pedido não encontrado' com link para /comecar e a dica de Entrar / Esqueci minha senha", async () => {
    mockApi(() => json(404, { message: "Pedido não encontrado." }));
    renderAt(`/comecar/acompanhar/${TOKEN}`);
    expect(await screen.findByTestId("status-not-found")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pedido não encontrado" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fazer um pedido" })).toHaveAttribute("href", "/comecar");
    expect(screen.getByText(/Esqueci minha senha/)).toBeInTheDocument();
  });

  it("falha de rede/429: não é 'não encontrado'; permite tentar de novo", async () => {
    let attempts = 0;
    mockApi(() => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("Failed to fetch");
      return json(200, { ...base, status: "PENDING" });
    });
    renderAt(`/comecar/acompanhar/${TOKEN}`);
    expect(await screen.findByTestId("status-error")).toBeInTheDocument();
    expect(screen.queryByTestId("status-not-found")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByTestId("status-pending")).toBeInTheDocument();
  });

  it("a resposta do servidor nunca traz dados pessoais e a tela não os inventa", async () => {
    mockApi(() => json(200, { ...base, status: "PENDING" }));
    renderAt(`/comecar/acompanhar/${TOKEN}`);
    await screen.findByTestId("status-pending");
    expect(document.body.textContent).not.toMatch(/@/);
  });
});
