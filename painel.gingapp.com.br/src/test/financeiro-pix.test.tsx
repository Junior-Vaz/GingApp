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
  connected: false,
  liveMode: true,
  providerUserId: null,
  connectedAt: null,
  status: "NOT_CONNECTED",
  ...o,
});

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
    expect(await screen.findByTestId("pix-unavailable")).toHaveTextContent("Pix automático ainda não está habilitado neste ambiente");
    expect(screen.queryByRole("button", { name: /Conectar/ })).toBeNull();
  });

  it("desconectado: explica em 3 linhas; Conectar faz POST /connect e redireciona o navegador para a url", async () => {
    const calls = mockApi({
      "GET /payments/mercadopago/status": () => json(200, mp()),
      "POST /payments/mercadopago/connect": () => json(201, { url: "https://auth.mercadopago.com/oauth?x=1" }),
    });
    wrap(<PixConnectionCard />);
    const box = await screen.findByTestId("pix-disconnected");
    expect(within(box).getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(within(box).getByRole("button", { name: /Conectar Mercado Pago/ }));
    await waitFor(() => expect(redirectTo).toHaveBeenCalledWith("https://auth.mercadopago.com/oauth?x=1"));
    expect(calls.filter((c) => c.method === "POST" && c.path === "/payments/mercadopago/connect")).toHaveLength(1);
  });

  it("conectado: selo, modo Teste, desde quando; Desconectar pede confirmação e faz DELETE", async () => {
    const calls = mockApi({
      "GET /payments/mercadopago/status": () =>
        json(200, mp({ connected: true, status: "CONNECTED", liveMode: false, connectedAt: "2026-10-05T15:00:00.000Z", providerUserId: "99" })),
      "DELETE /payments/mercadopago/disconnect": () => new Response(null, { status: 204 }),
    });
    wrap(<PixConnectionCard />);
    const box = await screen.findByTestId("pix-connected");
    expect(box).toHaveTextContent("Conectado");
    expect(box).toHaveTextContent("Teste");
    expect(box).toHaveTextContent("desde 05/10/2026");
    fireEvent.click(within(box).getByRole("button", { name: "Desconectar" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false); // só depois de confirmar
    fireEvent.click(within(confirm).getByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/payments/mercadopago/disconnect")).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Mercado Pago desconectado."));
  });

  it("revogado: avisa e oferece Reconectar", async () => {
    mockApi({ "GET /payments/mercadopago/status": () => json(200, mp({ connected: false, status: "REVOKED" })) });
    wrap(<PixConnectionCard />);
    const box = await screen.findByTestId("pix-broken");
    expect(box).toHaveTextContent("revogado");
    expect(within(box).getByRole("button", { name: /Reconectar Mercado Pago/ })).toBeInTheDocument();
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
