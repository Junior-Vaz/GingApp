import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { FinanceiroPage } from "@/modules/financeiro/financeiro-page";
import { PixConnectionCard } from "@/modules/financeiro/pix-connection-card";
import { PixDialog } from "@/modules/financeiro/pix-dialog";
import { pixBadgeKind, pixErrorMessage, pixShareText, qrImageSrc, type MercadoPagoStatus, type PixCharge } from "@/modules/financeiro/pix";
import { ApiError } from "@/lib/api";
import { redirectTo } from "@/lib/redirect";
import type { FinanceRecord } from "@/modules/financeiro/finance-utils";
import { clearSession, loginAs } from "./login-as";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/redirect", () => ({ redirectTo: vi.fn() }));

type Call = { method: string; path: string; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/** fetch falso roteado por "METHOD /caminho" (sem prefixo da API nem query); registra as chamadas. */
function mockApi(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = (url.replace(/^https?:\/\/[^/]+\/api/, "").split("?")[0]) ?? "";
      const method = init.method ?? "GET";
      calls.push({ method, path, body: init.body ? JSON.parse(init.body as string) : undefined });
      const handler = routes[`${method} ${path}`];
      return Promise.resolve(handler ? handler(calls.at(-1)!) : json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  return calls;
}

const mp = (o: Partial<MercadoPagoStatus> = {}): MercadoPagoStatus => ({
  provider: "mercadopago",
  available: true,
  oauthAvailable: false,
  mode: null,
  connected: false,
  liveMode: true,
  providerUserId: null,
  connectedAt: null,
  status: "NOT_CONNECTED",
  tokenHint: null,
  publicKey: null,
  hasWebhookSecret: false,
  webhookSecretReadable: true,
  webhookUrl: null,
  lastError: null,
  ...o,
});

const TOKEN = "APP_USR-0000000000000000-super-secreto-123";
/** Senha FICTICIA do Mestre (reautenticacao ao definir/trocar o token). */
const SENHA = "senha-do-mestre-1";
const PASSWORD_LABEL = "Sua senha (para confirmar)";
const WEBHOOK_URL = "https://api.gingapp.com.br/api/payments/mercadopago/webhook";
const connectedMp = (o: Partial<MercadoPagoStatus> = {}) =>
  mp({
    connected: true,
    status: "CONNECTED",
    mode: "MANUAL",
    liveMode: true,
    tokenHint: "9f3a",
    providerUserId: "99",
    connectedAt: "2026-10-05T15:00:00.000Z",
    webhookUrl: WEBHOOK_URL,
    ...o,
  });
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const putCalls = (calls: Call[]) => calls.filter((c) => c.method === "PUT" && c.path === "/payments/mercadopago/credentials");

const CODE = "00020126580014br.gov.bcb.pix0136abc-123";
const charge = (o: Partial<PixCharge> = {}): PixCharge => ({
  financeRecordId: 2,
  amountCents: 20050,
  status: "PENDING",
  qrCode: CODE,
  qrCodeBase64: "iVBORw0KGgo=",
  ticketUrl: "https://www.mercadopago.com.br/ticket/1",
  expiresAt: "2099-01-01T12:30:00.000Z",
  generatedAt: "2098-12-31T12:30:00.000Z",
  ...o,
});

const rec = (o: Partial<FinanceRecord> & { id: number }): FinanceRecord => ({
  studentId: 2,
  student: { id: 2, name: "Bia" },
  unitId: null,
  description: "Mensalidade Bia",
  amountCents: 20050,
  type: "Mensalidade",
  dueDate: "2099-02-10T00:00:00.000Z",
  paidAt: null,
  status: "PENDING",
  ...o,
});

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  loginAs("MESTRE");
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});
afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("Receber por Pix: cartão de conexão (MESTRE)", () => {
  it("servidor sem Mercado Pago (available=false): aviso neutro, sem botão de conectar", async () => {
    mockApi({ "GET /payments/mercadopago/status": () => json(200, mp({ available: false })) });
    wrap(<PixConnectionCard />);
    expect(await screen.findByTestId("pix-unavailable")).toHaveTextContent("Pix automático indisponível neste ambiente");
    expect(screen.queryByRole("button", { name: /Conectar|Salvar/ })).toBeNull();
    expect(screen.queryByTestId("pix-credentials-form")).toBeNull();
  });

  it("desconectado: mostra o formulário de credenciais (campos, ajuda, aviso) e o botão fica desabilitado sem token", async () => {
    mockApi({ "GET /payments/mercadopago/status": () => json(200, mp()) });
    wrap(<PixConnectionCard />);
    const box = await screen.findByTestId("pix-disconnected");
    expect(box).toHaveTextContent("Conectar sua conta Mercado Pago");
    expect(box).toHaveTextContent("O GingApp não recebe nem repassa dinheiro");
    expect(box).toHaveTextContent("Não compartilhe esse token. Ele permite criar cobranças na sua conta.");
    const token = screen.getByLabelText("Access Token de produção");
    expect(token).toHaveAttribute("type", "password");
    expect(token).toHaveAttribute("autocomplete", "off");
    expect(token).toHaveAttribute("spellcheck", "false");
    expect(screen.getByLabelText("Chave pública (opcional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Segredo do webhook (opcional)")).toHaveAttribute("type", "password");
    // M6: senha atual para confirmar (gerenciador de senhas reconhece como senha atual).
    const password = screen.getByLabelText(PASSWORD_LABEL);
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("button", { name: "Salvar e conectar" })).toBeDisabled();
    // mostrar/ocultar
    fireEvent.click(screen.getByRole("button", { name: "Mostrar token" }));
    expect(token).toHaveAttribute("type", "text");
    // passo-a-passo recolhível
    fireEvent.click(screen.getByRole("button", { name: /Onde encontro o Access Token\?/ }));
    expect(await screen.findByText(/os nomes e a posição das opções podem mudar/)).toBeInTheDocument();
    // sem OAuth no servidor: nenhum link secundário
    expect(screen.queryByRole("button", { name: "Conectar por autorização" })).toBeNull();
  });

  it("validação do token: espaços no meio e token curto bloqueiam o botão (sem ecoar o valor)", async () => {
    mockApi({ "GET /payments/mercadopago/status": () => json(200, mp()) });
    wrap(<PixConnectionCard />);
    await screen.findByTestId("pix-disconnected");
    const save = screen.getByRole("button", { name: "Salvar e conectar" });
    type("Access Token de produção", "curto");
    expect(screen.getByText(/parece curto demais/)).toBeInTheDocument();
    expect(save).toBeDisabled();
    type("Access Token de produção", "APP_USR-123456 7890123456789012");
    expect(screen.getByText(/não pode ter espaços/)).toBeInTheDocument();
    expect(save).toBeDisabled();
    type("Access Token de produção", `  ${TOKEN}  `); // espaços nas pontas são aparados
    expect(save).toBeDisabled(); // falta a senha
    type(PASSWORD_LABEL, SENHA);
    expect(save).toBeEnabled();
  });

  it("salvar: PUT /credentials só com os campos preenchidos (trim), toast 'Mercado Pago conectado' e campos limpos", async () => {
    // O PUT devolve o estado ainda desconectado só para dar para conferir que os campos foram esvaziados.
    const calls = mockApi({
      "GET /payments/mercadopago/status": () => json(200, mp()),
      "PUT /payments/mercadopago/credentials": () => json(200, mp()),
    });
    wrap(<PixConnectionCard />);
    await screen.findByTestId("pix-disconnected");
    type("Access Token de produção", `  ${TOKEN} `);
    type("Chave pública (opcional)", " APP_USR-pub-1 ");
    type("Segredo do webhook (opcional)", " seg ");
    type(PASSWORD_LABEL, SENHA);
    fireEvent.click(screen.getByRole("button", { name: "Salvar e conectar" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Mercado Pago conectado"));
    expect(putCalls(calls)).toHaveLength(1);
    expect(putCalls(calls)[0]!.body).toEqual({ accessToken: TOKEN, currentPassword: SENHA, publicKey: "APP_USR-pub-1", webhookSecret: "seg" });
    expect(screen.getByLabelText("Access Token de produção")).toHaveValue("");
    expect(screen.getByLabelText("Chave pública (opcional)")).toHaveValue("");
    expect(screen.getByLabelText("Segredo do webhook (opcional)")).toHaveValue("");
    expect(screen.getByLabelText(PASSWORD_LABEL)).toHaveValue("");
  });

  it("salvar só o token: o PUT não leva chave pública nem segredo; depois o cartão mostra 'Conectado'", async () => {
    let state = mp();
    const calls = mockApi({
      "GET /payments/mercadopago/status": () => json(200, state),
      "PUT /payments/mercadopago/credentials": () => {
        state = connectedMp();
        return json(200, state);
      },
    });
    wrap(<PixConnectionCard />);
    await screen.findByTestId("pix-disconnected");
    type("Access Token de produção", TOKEN);
    type(PASSWORD_LABEL, SENHA);
    fireEvent.click(screen.getByRole("button", { name: "Salvar e conectar" }));
    expect(await screen.findByTestId("pix-connected")).toBeInTheDocument();
    expect(putCalls(calls)[0]!.body).toEqual({ accessToken: TOKEN, currentPassword: SENHA });
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(document.body.textContent).not.toContain(SENHA);
  });

  it("M6: senha incorreta => mensagem amigável e o campo da senha é limpo; 2FA ativo => pede o código e o envia junto", async () => {
    let responses: Array<() => Response> = [];
    const calls = mockApi({
      "GET /payments/mercadopago/status": () => json(200, mp()),
      "PUT /payments/mercadopago/credentials": () => responses.shift()!(),
    });
    wrap(<PixConnectionCard />);
    await screen.findByTestId("pix-disconnected");
    type("Access Token de produção", TOKEN);

    responses = [() => json(403, { message: "x", code: "INVALID_PASSWORD" })];
    type(PASSWORD_LABEL, "errada");
    fireEvent.click(screen.getByRole("button", { name: "Salvar e conectar" }));
    expect(await screen.findByTestId("pix-credentials-error")).toHaveTextContent("Senha incorreta.");
    expect(screen.getByLabelText(PASSWORD_LABEL)).toHaveValue("");
    expect(screen.getByRole("button", { name: "Salvar e conectar" })).toBeDisabled();

    responses = [() => json(403, { message: "x", code: "TWO_FACTOR_REQUIRED" }), () => json(200, connectedMp())];
    type(PASSWORD_LABEL, SENHA);
    fireEvent.click(screen.getByRole("button", { name: "Salvar e conectar" }));
    const code = await screen.findByLabelText("Código do aplicativo autenticador");
    expect(screen.getByTestId("pix-credentials-error")).toHaveTextContent("aplicativo autenticador");
    expect(screen.getByRole("button", { name: "Salvar e conectar" })).toBeDisabled(); // falta o código
    fireEvent.change(code, { target: { value: " 123456 " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar e conectar" }));
    expect(await screen.findByTestId("pix-connected")).toBeInTheDocument();
    expect(putCalls(calls).at(-1)!.body).toEqual({ accessToken: TOKEN, currentPassword: SENHA, twoFactorCode: "123456" });
    expect(document.body.textContent).not.toContain(SENHA);
  });

  it("INVALID_CREDENTIALS: mensagem amigável, sem ecoar o token nem o texto do servidor; formulário segue aberto", async () => {
    mockApi({
      "GET /payments/mercadopago/status": () => json(200, mp()),
      "PUT /payments/mercadopago/credentials": () => json(422, { message: `token ${TOKEN} invalido`, code: "INVALID_CREDENTIALS" }),
    });
    wrap(<PixConnectionCard />);
    await screen.findByTestId("pix-disconnected");
    type("Access Token de produção", TOKEN);
    type(PASSWORD_LABEL, SENHA);
    fireEvent.click(screen.getByRole("button", { name: "Salvar e conectar" }));
    const alert = await screen.findByTestId("pix-credentials-error");
    expect(alert).toHaveTextContent("O Mercado Pago recusou o token");
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Salvar e conectar" })).toBeEnabled();
  });

  it("outros erros do salvar: ACCESS_TOKEN_REQUIRED, PAYMENTS_UNAVAILABLE, MP_ACCOUNT_ERROR, Pix em aberto e erro genérico", async () => {
    let body: Record<string, unknown> = {};
    let status = 400;
    mockApi({
      "GET /payments/mercadopago/status": () => json(200, mp()),
      "PUT /payments/mercadopago/credentials": () => json(status, body),
    });
    wrap(<PixConnectionCard />);
    await screen.findByTestId("pix-disconnected");
    type("Access Token de produção", TOKEN);
    type(PASSWORD_LABEL, SENHA);
    const cases: Array<[number, Record<string, unknown>, string]> = [
      [400, { message: "x", code: "ACCESS_TOKEN_REQUIRED" }, "Informe o Access Token do Mercado Pago."],
      [403, { message: "x", code: "REAUTH_REQUIRED" }, "Digite a sua senha para confirmar."],
      [503, { message: "x", code: "PAYMENTS_UNAVAILABLE" }, "Pagamentos online não estão disponíveis no momento."],
      [409, { message: "x", code: "MP_ACCOUNT_ERROR" }, "Não foi possível usar a conta do Mercado Pago"],
      [409, { message: "x", code: "PIX_OPEN_ACCOUNT_SWITCH" }, "Há Pix em aberto. Aguarde pagarem/expirarem ou cancele-os antes de trocar a conta."],
      [409, { message: "x", code: "OPEN_PIX_BLOCKS_ACCOUNT_CHANGE" }, "Há Pix em aberto."],
      [500, { message: `falha com ${TOKEN}` }, "Não foi possível salvar as credenciais do Mercado Pago. Tente novamente."],
    ];
    for (const [s, b, expected] of cases) {
      status = s;
      body = b;
      fireEvent.click(screen.getByRole("button", { name: "Salvar e conectar" }));
      await waitFor(() => expect(screen.getByTestId("pix-credentials-error")).toHaveTextContent(expected));
      expect(document.body.textContent).not.toContain(TOKEN);
    }
  });

  it("OAuth opcional: com oauthAvailable aparece o link secundário (POST /connect e redireciona); sem ele, não aparece", async () => {
    const calls = mockApi({
      "GET /payments/mercadopago/status": () => json(200, mp({ oauthAvailable: true })),
      "POST /payments/mercadopago/connect": () => json(201, { url: "https://auth.mercadopago.com/oauth?x=1" }),
    });
    wrap(<PixConnectionCard />);
    const box = await screen.findByTestId("pix-disconnected");
    expect(box).toHaveTextContent("Prefere conectar pelo Mercado Pago?");
    fireEvent.click(within(box).getByRole("button", { name: "Conectar por autorização" }));
    await waitFor(() => expect(redirectTo).toHaveBeenCalledWith("https://auth.mercadopago.com/oauth?x=1"));
    expect(calls.filter((c) => c.method === "POST" && c.path === "/payments/mercadopago/connect")).toHaveLength(1);
    expect(putCalls(calls)).toHaveLength(0);
  });

  it("conectado: selo, modo Teste, token terminado em ••••, conta, desde quando e chave pública", async () => {
    mockApi({
      "GET /payments/mercadopago/status": () => json(200, connectedMp({ liveMode: false, publicKey: "APP_USR-pub-1" })),
    });
    wrap(<PixConnectionCard />);
    const box = await screen.findByTestId("pix-connected");
    expect(box).toHaveTextContent("Conectado");
    expect(box).toHaveTextContent("Teste");
    expect(box).toHaveTextContent("terminado em ••••9f3a");
    expect(box).toHaveTextContent(/Conta:\s*99/);
    expect(box).toHaveTextContent("desde 05/10/2026");
    expect(box).toHaveTextContent("APP_USR-pub-1");
    expect(screen.queryByTestId("pix-credentials-form")).toBeNull();
  });

  it("conectado em Produção mostra o selo 'Produção'", async () => {
    mockApi({ "GET /payments/mercadopago/status": () => json(200, connectedMp()) });
    wrap(<PixConnectionCard />);
    expect(await screen.findByTestId("pix-connected")).toHaveTextContent("Produção");
  });

  it("webhook: mostra a URL somente leitura e Copiar escreve na área de transferência", async () => {
    mockApi({ "GET /payments/mercadopago/status": () => json(200, connectedMp()) });
    wrap(<PixConnectionCard />);
    const box = await screen.findByTestId("pix-webhook");
    expect(box).toHaveTextContent("O GingApp envia a URL abaixo em cada Pix: você não precisa cadastrar nada no Mercado Pago");
    expect(box).toHaveTextContent("se a assinatura não conferir, o Pix ainda é confirmado pela consulta ao Mercado Pago");
    const url = within(box).getByLabelText("URL do webhook");
    expect(url).toHaveValue(WEBHOOK_URL);
    expect(url).toHaveAttribute("readonly");
    fireEvent.click(within(box).getByRole("button", { name: /Copiar/ }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(WEBHOOK_URL));
    expect(toast.success).toHaveBeenCalledWith("URL do webhook copiada.");
  });

  it("webhook: definir o segredo envia PUT parcial só com webhookSecret e limpa o campo", async () => {
    const calls = mockApi({
      "GET /payments/mercadopago/status": () => json(200, connectedMp()),
      "PUT /payments/mercadopago/credentials": () => json(200, connectedMp({ hasWebhookSecret: true })),
    });
    wrap(<PixConnectionCard />);
    const box = await screen.findByTestId("pix-webhook");
    expect(within(box).getByRole("button", { name: "Salvar segredo" })).toBeDisabled();
    expect(within(box).queryByText("Segredo configurado")).toBeNull();
    type("Segredo do webhook", "  meu-segredo ");
    fireEvent.click(within(box).getByRole("button", { name: "Salvar segredo" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Segredo do webhook salvo"));
    expect(putCalls(calls)[0]!.body).toEqual({ webhookSecret: "meu-segredo" });
    expect(await within(box).findByText("Segredo configurado")).toBeInTheDocument();
    expect(screen.getByLabelText("Segredo do webhook")).toHaveValue("");
  });

  it("webhook: com segredo configurado mostra o selo e Remover envia webhookSecret vazio", async () => {
    let state = connectedMp({ hasWebhookSecret: true });
    const calls = mockApi({
      "GET /payments/mercadopago/status": () => json(200, state),
      "PUT /payments/mercadopago/credentials": () => {
        state = connectedMp({ hasWebhookSecret: false });
        return json(200, state);
      },
    });
    wrap(<PixConnectionCard />);
    const box = await screen.findByTestId("pix-webhook");
    expect(box).toHaveTextContent("Segredo configurado");
    fireEvent.click(within(box).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Segredo do webhook removido"));
    expect(putCalls(calls)[0]!.body).toEqual({ webhookSecret: "" });
    await waitFor(() => expect(within(box).queryByText("Segredo configurado")).toBeNull());
  });

  it("Trocar token: abre o formulário de atualização e o PUT leva só os campos preenchidos", async () => {
    const calls = mockApi({
      "GET /payments/mercadopago/status": () => json(200, connectedMp()),
      "PUT /payments/mercadopago/credentials": () => json(200, connectedMp({ tokenHint: "zzzz" })),
    });
    wrap(<PixConnectionCard />);
    const box = await screen.findByTestId("pix-connected");
    fireEvent.click(within(box).getByRole("button", { name: "Trocar token" }));
    const form = await screen.findByTestId("pix-credentials-form");
    expect(within(form).getByRole("button", { name: "Salvar novo token" })).toBeDisabled();
    expect(within(form).queryByLabelText(/Segredo do webhook/)).toBeNull();
    type("Novo Access Token de produção", TOKEN);
    expect(within(form).getByRole("button", { name: "Salvar novo token" })).toBeDisabled(); // falta a senha
    type(PASSWORD_LABEL, SENHA);
    fireEvent.click(within(form).getByRole("button", { name: "Salvar novo token" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Token do Mercado Pago atualizado"));
    expect(putCalls(calls)[0]!.body).toEqual({ accessToken: TOKEN, currentPassword: SENHA });
    await waitFor(() => expect(screen.queryByTestId("pix-credentials-form")).toBeNull());
    expect(await screen.findByText(/••••zzzz/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it("Trocar token: Cancelar fecha o formulário sem chamar a API", async () => {
    const calls = mockApi({ "GET /payments/mercadopago/status": () => json(200, connectedMp()) });
    wrap(<PixConnectionCard />);
    const box = await screen.findByTestId("pix-connected");
    fireEvent.click(within(box).getByRole("button", { name: "Trocar token" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(screen.queryByTestId("pix-credentials-form")).toBeNull();
    expect(putCalls(calls)).toHaveLength(0);
  });

  it("Desconectar pede confirmação (Pix em aberto serão cancelados) e só então faz DELETE", async () => {
    const calls = mockApi({
      "GET /payments/mercadopago/status": () => json(200, connectedMp()),
      "DELETE /payments/mercadopago/disconnect": () => json(200, mp()),
    });
    wrap(<PixConnectionCard />);
    const box = await screen.findByTestId("pix-connected");
    fireEvent.click(within(box).getByRole("button", { name: "Desconectar" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("Pix em aberto serão cancelados");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false); // só depois de confirmar
    fireEvent.click(within(confirm).getByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/payments/mercadopago/disconnect")).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Mercado Pago desconectado."));
  });

  it("Desconectar com erro de Pix em aberto: toast amigável e o diálogo permanece", async () => {
    mockApi({
      "GET /payments/mercadopago/status": () => json(200, connectedMp()),
      "DELETE /payments/mercadopago/disconnect": () => json(409, { message: "x", code: "PIX_OPEN" }),
    });
    wrap(<PixConnectionCard />);
    const box = await screen.findByTestId("pix-connected");
    fireEvent.click(within(box).getByRole("button", { name: "Desconectar" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Há Pix em aberto")));
  });

  it.each(["REVOKED", "ERROR"] as const)("%s: avisa para colar o token de novo e mostra o formulário", async (st) => {
    mockApi({ "GET /payments/mercadopago/status": () => json(200, mp({ connected: false, status: st })) });
    wrap(<PixConnectionCard />);
    const box = await screen.findByTestId("pix-broken");
    expect(box).toHaveTextContent("Não foi possível usar sua conta. Cole o token novamente.");
    expect(within(box).getByLabelText("Access Token de produção")).toBeInTheDocument();
    expect(within(box).getByRole("button", { name: "Salvar e conectar" })).toBeDisabled();
  });

  it("B8: em ERROR mostra o motivo curto do servidor e permite Desconectar (com confirmação); REVOKED não", async () => {
    const calls = mockApi({
      "GET /payments/mercadopago/status": () =>
        json(200, mp({ connected: false, status: "ERROR", mode: "MANUAL", lastError: "O Mercado Pago recusou o Access Token do grupo." })),
      "DELETE /payments/mercadopago/disconnect": () => json(200, mp({ status: "REVOKED" })),
    });
    wrap(<PixConnectionCard />);
    const box = await screen.findByTestId("pix-broken");
    expect(within(box).getByTestId("pix-last-error")).toHaveTextContent("Motivo: O Mercado Pago recusou o Access Token do grupo.");
    fireEvent.click(within(box).getByRole("button", { name: "Desconectar" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(within(confirm).getByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/payments/mercadopago/disconnect")).toBe(true));

    cleanup();
    mockApi({ "GET /payments/mercadopago/status": () => json(200, mp({ connected: false, status: "REVOKED" })) });
    wrap(<PixConnectionCard />);
    const revoked = await screen.findByTestId("pix-broken");
    expect(within(revoked).queryByRole("button", { name: "Desconectar" })).toBeNull();
    expect(within(revoked).queryByTestId("pix-last-error")).toBeNull();
  });

  it("B8: Trocar token vem com a chave pública salva; esvaziar o campo envia publicKey vazio (remove)", async () => {
    const calls = mockApi({
      "GET /payments/mercadopago/status": () => json(200, connectedMp({ publicKey: "APP_USR-pub-1" })),
      "PUT /payments/mercadopago/credentials": () => json(200, connectedMp({ publicKey: null })),
    });
    wrap(<PixConnectionCard />);
    const box = await screen.findByTestId("pix-connected");
    expect(box).toHaveTextContent("só os 4 últimos caracteres");
    fireEvent.click(within(box).getByRole("button", { name: "Trocar token" }));
    const form = await screen.findByTestId("pix-credentials-form");
    expect(within(form).getByLabelText("Chave pública (opcional)")).toHaveValue("APP_USR-pub-1");
    type("Chave pública (opcional)", "");
    type("Novo Access Token de produção", TOKEN);
    type(PASSWORD_LABEL, SENHA);
    fireEvent.click(within(form).getByRole("button", { name: "Salvar novo token" }));
    await waitFor(() => expect(putCalls(calls)).toHaveLength(1));
    expect(putCalls(calls)[0]!.body).toEqual({ accessToken: TOKEN, currentPassword: SENHA, publicKey: "" });
  });

  it("B5/A2: conexão OAUTH não oferece segredo próprio; segredo ilegível mostra aviso para colar de novo", async () => {
    mockApi({ "GET /payments/mercadopago/status": () => json(200, connectedMp({ mode: "OAUTH", tokenHint: null })) });
    wrap(<PixConnectionCard />);
    const box = await screen.findByTestId("pix-webhook");
    expect(within(box).queryByLabelText("Segredo do webhook")).toBeNull();

    cleanup();
    mockApi({
      "GET /payments/mercadopago/status": () => json(200, connectedMp({ hasWebhookSecret: true, webhookSecretReadable: false })),
    });
    wrap(<PixConnectionCard />);
    expect(await screen.findByTestId("pix-webhook-unreadable")).toHaveTextContent("Cole o segredo de novo");
  });
});

describe("Receber por Pix: aba só do MESTRE e retorno do OAuth", () => {
  const routes = () => ({
    "GET /finance": () => json(200, [], { "X-Total-Count": "0" }),
    "GET /finance/summary": () => json(200, { paid: 0, pending: 0, overdue: 0, count: 0, paidCount: 0, pendingCount: 0, overdueCount: 0 }),
    "GET /payments/mercadopago/status": () => json(200, mp()),
  });

  it("MESTRE vê a aba e o cartão; PROFESSOR não vê a seção de conexão", async () => {
    mockApi(routes());
    wrap(<FinanceiroPage />);
    const tab = await screen.findByRole("tab", { name: "Receber por Pix" });
    fireEvent.mouseDown(tab);
    expect(await screen.findByTestId("pix-disconnected")).toBeInTheDocument();
    cleanup();

    loginAs("PROFESSOR");
    mockApi(routes());
    wrap(<FinanceiroPage />);
    await screen.findByRole("tab", { name: "Lançamentos" });
    expect(screen.queryByRole("tab", { name: "Receber por Pix" })).toBeNull();
    expect(screen.queryByTestId("pix-connection")).toBeNull();
  });

  it("?mp=ok: toast de sucesso, abre a aba e limpa o parâmetro; ?mp=erro: toast de erro", async () => {
    mockApi(routes());
    window.history.replaceState(null, "", "/financeiro?mp=ok&x=1");
    wrap(<FinanceiroPage />);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Mercado Pago conectado")));
    expect(await screen.findByTestId("pix-disconnected")).toBeInTheDocument();
    expect(window.location.search).toBe("?x=1");
    cleanup();

    window.history.replaceState(null, "", "/financeiro?mp=erro");
    mockApi(routes());
    wrap(<FinanceiroPage />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Não foi possível conectar")));
    expect(window.location.search).toBe("");
  });

  it("?mp=pix-aberto: toast explicando a troca de conta recusada, abre a aba e limpa o parâmetro", async () => {
    mockApi(routes());
    window.history.replaceState(null, "", "/financeiro?mp=pix-aberto");
    wrap(<FinanceiroPage />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("há Pix em aberto da conta atual")));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Não foi possível trocar a conta do Mercado Pago"));
    expect(await screen.findByTestId("pix-disconnected")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });
});

describe("Gerar Pix (diálogo)", () => {
  it("abre com o QR (base64), valor, validade e copia e cola; Copiar escreve o código; link do Mercado Pago", async () => {
    const calls = mockApi({ "POST /finance/2/pix": () => json(201, charge()), "GET /finance/2/pix": () => json(200, charge()) });
    wrap(<PixDialog record={rec({ id: 2 })} onClose={() => {}} pollIntervalMs={10_000} />);
    const dialog = await screen.findByTestId("pix-dialog");
    expect(await within(dialog).findByAltText("QR Code do Pix")).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=");
    expect(within(dialog).getByTestId("pix-amount")).toHaveTextContent(/R\$\s*200,50/);
    expect(within(dialog).getByTestId("pix-expiry")).toHaveTextContent("Válido até");
    expect(within(dialog).getByLabelText("Pix copia e cola")).toHaveValue(CODE);
    expect(within(dialog).getByRole("link", { name: /Abrir no Mercado Pago/ })).toHaveAttribute("href", "https://www.mercadopago.com.br/ticket/1");
    fireEvent.click(within(dialog).getByRole("button", { name: /Copiar código Pix/ }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CODE));
    expect(toast.success).toHaveBeenCalledWith("Código Pix copiado.");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("Enviar ao aluno: sem navigator.share abre o WhatsApp (wa.me) com o texto e o copia e cola", async () => {
    mockApi({ "POST /finance/2/pix": () => json(201, charge()) });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    wrap(<PixDialog record={rec({ id: 2 })} onClose={() => {}} pollIntervalMs={10_000} />);
    fireEvent.click(await screen.findByRole("button", { name: /Enviar ao aluno/ }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    const url = String(open.mock.calls[0]![0]);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(url.slice("https://wa.me/?text=".length));
    expect(text).toContain(CODE);
    expect(text).toContain("Mensalidade Bia");
    open.mockRestore();
  });

  it("polling: quando o GET devolve PAID mostra 'Pagamento confirmado', avisa e refaz as consultas do financeiro", async () => {
    let gets = 0;
    const calls = mockApi({
      "POST /finance/2/pix": () => json(201, charge()),
      "GET /finance/2/pix": () => json(200, ++gets >= 2 ? charge({ status: "PAID" }) : charge()),
      "GET /finance": () => json(200, [], { "X-Total-Count": "0" }),
    });
    wrap(<PixDialog record={rec({ id: 2 })} onClose={() => {}} pollIntervalMs={30} />);
    const paid = await screen.findByTestId("pix-paid", {}, { timeout: 3000 });
    expect(paid).toHaveTextContent("Pagamento confirmado");
    expect(toast.success).toHaveBeenCalledWith("Pagamento confirmado pelo Pix.");
    expect(calls.filter((c) => c.method === "GET" && c.path === "/finance/2/pix").length).toBeGreaterThanOrEqual(2);
    // parou de consultar depois de pago
    const before = calls.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(calls.length).toBe(before);
  });

  it("MP_NOT_CONNECTED: mensagem amigável e atalho para conectar", async () => {
    mockApi({ "POST /finance/2/pix": () => json(409, { message: "mp_not_connected", code: "MP_NOT_CONNECTED" }) });
    const onGoConnect = vi.fn();
    wrap(<PixDialog record={rec({ id: 2 })} onClose={() => {}} onGoConnect={onGoConnect} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("O grupo ainda não conectou o Mercado Pago");
    fireEvent.click(screen.getByRole("button", { name: "Conectar Mercado Pago" }));
    expect(onGoConnect).toHaveBeenCalledTimes(1);
  });

  it("MP_ACCOUNT_ERROR: mensagem para o Mestre e atalho para Reconectar (sem 'Tentar de novo')", async () => {
    mockApi({ "POST /finance/2/pix": () => json(409, { message: "x", code: "MP_ACCOUNT_ERROR" }) });
    const onGoConnect = vi.fn();
    wrap(<PixDialog record={rec({ id: 2 })} onClose={() => {}} onGoConnect={onGoConnect} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("A conta do Mercado Pago do grupo precisa ser reconectada pelo Mestre.");
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reconectar Mercado Pago" }));
    expect(onGoConnect).toHaveBeenCalledTimes(1);
  });

  it("Pix expirado: oferece gerar um novo", async () => {
    mockApi({ "POST /finance/2/pix": () => json(201, charge({ status: "EXPIRED" })) });
    wrap(<PixDialog record={rec({ id: 2 })} onClose={() => {}} />);
    expect(await screen.findByTestId("pix-expired")).toHaveTextContent("expirou");
    expect(screen.getByRole("button", { name: /Gerar novo Pix/ })).toBeInTheDocument();
  });

  it("na lista: 'Gerar Pix' só nos lançamentos em aberto", async () => {
    mockApi({
      "GET /finance": () =>
        json(200, [rec({ id: 1, status: "PAID", description: "Pago" }), rec({ id: 2, description: "Aberto" }), rec({ id: 3, status: "CANCELLED", description: "Cancelado" })], {
          "X-Total-Count": "3",
        }),
      "GET /finance/summary": () => json(200, { paid: 0, pending: 0, overdue: 0, count: 0, paidCount: 0, pendingCount: 0, overdueCount: 0 }),
    });
    wrap(<FinanceiroPage />);
    await screen.findByText("Aberto");
    expect(screen.getAllByRole("button", { name: /Gerar Pix de/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Gerar Pix de Aberto" })).toBeInTheDocument();
  });
});

describe("Selos do Pix e utilitários", () => {
  const at = (o: Partial<FinanceRecord>) => rec({ id: 9, ...o });
  const pix = (status: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED", expiresAt = "2099-01-01T00:00:00.000Z") => ({
    status,
    expiresAt,
    generatedAt: "2098-01-01T00:00:00.000Z",
  });

  it("badge por estado: aguardando / pago via Pix (automático) / expirado / nenhum", () => {
    expect(pixBadgeKind(at({ pix: pix("PENDING") }))).toBe("waiting");
    expect(pixBadgeKind(at({ pix: pix("PENDING", "2020-01-01T00:00:00.000Z") }))).toBe("expired"); // vencido no relógio
    expect(pixBadgeKind(at({ pix: pix("EXPIRED") }))).toBe("expired");
    expect(pixBadgeKind(at({ status: "PAID", paidVia: "PIX_AUTO", pix: pix("PAID") }))).toBe("paid-auto");
    expect(pixBadgeKind(at({ status: "PAID", paidVia: "MANUAL" }))).toBeNull();
    expect(pixBadgeKind(at({ status: "CANCELLED", pix: pix("PENDING") }))).toBeNull();
    expect(pixBadgeKind(at({ pix: null }))).toBeNull();
  });

  it("badges aparecem na linha da lista com o texto certo", async () => {
    mockApi({
      "GET /finance": () =>
        json(
          200,
          [
            rec({ id: 1, description: "A", pix: pix("PENDING") }),
            rec({ id: 2, description: "B", status: "PAID", paidAt: "2099-01-01T00:00:00.000Z", paidVia: "PIX_AUTO", pix: pix("PAID") }),
            rec({ id: 3, description: "C", pix: pix("EXPIRED") }),
          ],
          { "X-Total-Count": "3" },
        ),
      "GET /finance/summary": () => json(200, { paid: 0, pending: 0, overdue: 0, count: 0, paidCount: 0, pendingCount: 0, overdueCount: 0 }),
    });
    wrap(<FinanceiroPage />);
    expect(await screen.findByText("Pix aguardando")).toBeInTheDocument();
    expect(screen.getByText("Pago via Pix (automático)")).toBeInTheDocument();
    expect(screen.getByText("Pix expirado")).toBeInTheDocument();
  });

  it("mensagens de erro por código; qrImageSrc aceita base64 puro ou data URL; texto de envio traz o copia e cola", () => {
    const err = (code: string) => new ApiError("x", 400, code);
    expect(pixErrorMessage(err("PAYER_EMAIL_REQUIRED"))).toBe("Cadastre um e-mail do aluno ou responsável para gerar o Pix.");
    expect(pixErrorMessage(err("ALREADY_PAID"))).toContain("já está pago");
    expect(pixErrorMessage(err("RECORD_NOT_PAYABLE"))).toContain("não pode ser cobrado");
    expect(pixErrorMessage(err("AMOUNT_TOO_LOW"))).toContain("baixo demais");
    expect(pixErrorMessage(err("MP_ACCOUNT_ERROR"))).toBe("A conta do Mercado Pago do grupo precisa ser reconectada pelo Mestre.");
    expect(pixErrorMessage(err("PIX_PENDING_AMOUNT_CHANGED"))).toBe("Há um Pix pendente com o valor anterior; tente de novo em alguns minutos.");
    expect(pixErrorMessage(err("RECORD_CHANGED"))).toBe("O lançamento foi alterado (talvez pago por Pix). Recarregue.");
    expect(pixErrorMessage(err("RECORD_PAID_VIA_PIX"))).toBe("Este lançamento foi pago por Pix. Para desfazer, use Estornar.");
    expect(pixErrorMessage(err("PROVIDER_UNAVAILABLE"))).toBe("O Mercado Pago não respondeu. Tente de novo em instantes.");
    expect(pixErrorMessage(err("PROVIDER_ERROR"))).toBe("O Mercado Pago recusou a operação. Confira a conta conectada do grupo.");
    expect(pixErrorMessage(err("PAYMENTS_UNAVAILABLE"))).toBe("Pagamentos online não estão disponíveis no momento.");
    expect(pixErrorMessage(err("PIX_NOT_FOUND"))).toBe("Nenhum Pix foi gerado para este lançamento.");
    expect(pixErrorMessage(new ApiError("falhou no servidor", 500))).toBe("falhou no servidor");
    expect(pixErrorMessage(new Error("rede"))).toBe("Não foi possível gerar o Pix. Tente novamente.");
    expect(qrImageSrc({ qrCodeBase64: "AAA" })).toBe("data:image/png;base64,AAA");
    expect(qrImageSrc({ qrCodeBase64: "data:image/png;base64,BBB" })).toBe("data:image/png;base64,BBB");
    expect(qrImageSrc({ qrCodeBase64: null })).toBeNull();
    expect(pixShareText("Mensalidade", charge())).toContain(CODE);
  });
});
