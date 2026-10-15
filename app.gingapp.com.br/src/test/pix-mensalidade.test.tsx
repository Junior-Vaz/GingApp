import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { FinancialPage } from "@/components/gingapp/pages";
import { PixSheet } from "@/components/gingapp/pix-sheet";
import { ApiError } from "@/lib/api";
import { canPayWithPix, pixBadgeKind, pixErrorMessage, qrImageSrc, type PixCharge } from "@/lib/pix";
import type { FinancialRecord } from "@/lib/queries";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/** fetch falso roteado por "METHOD /caminho" (sem prefixo da API nem query); registra as chamadas. */
function mockApi(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?")[0] ?? "";
      const method = init.method ?? "GET";
      calls.push({ method, path });
      const handler = routes[`${method} ${path}`];
      // Rotas que o teste não conhece (ex.: /students/me do escopo do aluno) respondem vazio, como no pagination.test.
      return Promise.resolve(handler ? handler() : json(200, []));
    }),
  );
  return calls;
}

const CODE = "00020126580014br.gov.bcb.pix0136xyz-789";
const charge = (o: Partial<PixCharge> = {}): PixCharge => ({
  financeRecordId: 1,
  amountCents: 15000,
  status: "PENDING",
  qrCode: CODE,
  qrCodeBase64: "iVBORw0KGgo=",
  ticketUrl: null,
  expiresAt: "2099-01-01T12:30:00.000Z",
  generatedAt: "2098-12-31T12:30:00.000Z",
  ...o,
});

const rec = (o: Partial<FinancialRecord> & { id: number }): FinancialRecord => ({
  description: `Mensalidade ${o.id}`,
  amountCents: 15000,
  type: "MENSALIDADE",
  dueDate: "2099-12-10T00:00:00.000Z",
  paidAt: null,
  status: "PENDING",
  ...o,
});

const pix = (status: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED", expiresAt = "2099-01-01T00:00:00.000Z") => ({
  status,
  expiresAt,
  generatedAt: "2098-01-01T00:00:00.000Z",
});

const SUMMARY = { openCents: 30000, openCount: 2, overdueCents: 15000, overdueCount: 1, paidCents: 30000, paidCount: 2, oldestOpenDueDate: "2020-01-10T00:00:00.000Z" };

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

function renderWith(ui: ReactNode, client = makeClient()) {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => root!.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>));
  return client;
}

const waitFor = (assertion: () => void, timeout = 3000) => act(async () => void (await vi.waitFor(assertion, { timeout })));
const sleep = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
/** Os diálogos vão para um portal no body: procura no documento inteiro. */
const byTestId = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const byLabel = (label: string) => document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const buttonText = (name: RegExp) => [...document.body.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""));
const text = () => (document.body.textContent ?? "").replace(/\s/g, " ");
const click = (el: Element | null | undefined) => {
  expect(el, "elemento para clicar").toBeTruthy();
  return act(async () => (el as HTMLElement).click());
};

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Pagar com Pix na tela de financeiro do aluno", () => {
  const list = [
    rec({ id: 1, pix: pix("PENDING") }), // em aberto, Pix aguardando
    rec({ id: 2, dueDate: "2020-01-10T00:00:00.000Z" }), // atrasado
    rec({ id: 3, status: "PAID", paidAt: "2025-01-02T00:00:00.000Z", paidVia: "PIX_AUTO", pix: pix("PAID") }),
    rec({ id: 4, status: "PAID", paidAt: "2025-01-02T00:00:00.000Z", paidVia: "MANUAL" }),
    rec({ id: 5, status: "CANCELLED" }),
  ];
  const financeRoutes = () => ({
    "GET /finance/me": () => json(200, list, { "X-Total-Count": String(list.length) }),
    "GET /finance/me/summary": () => json(200, SUMMARY),
  });

  it("botão só nos lançamentos em aberto/atrasados; selos 'Pix aguardando' e 'Pago via Pix'", async () => {
    mockApi(financeRoutes());
    renderWith(<FinancialPage />);
    await waitFor(() => expect(text()).toContain("Mensalidade 5"));
    const labels = [...document.body.querySelectorAll("button[aria-label$='com Pix']")].map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Pagar Mensalidade 1 com Pix", "Pagar Mensalidade 2 com Pix"]);
    const badges = [...document.body.querySelectorAll("tbody .badge")].map((b) => b.textContent);
    expect(badges.filter((b) => b === "Pix aguardando")).toHaveLength(1);
    expect(badges.filter((b) => b === "Pago via Pix")).toHaveLength(1);
  });

  it("abre a folha com QR, valor, instruções e copia e cola; Copiar escreve o código", async () => {
    const calls = mockApi({ ...financeRoutes(), "POST /finance/me/1/pix": () => json(201, charge()), "GET /finance/me/1/pix": () => json(200, charge()) });
    renderWith(<FinancialPage />);
    await waitFor(() => expect(byLabel("Pagar Mensalidade 1 com Pix")).toBeTruthy());
    await click(byLabel("Pagar Mensalidade 1 com Pix"));
    await waitFor(() => expect(byTestId("pix-sheet")?.querySelector("img[alt='QR Code do Pix']")).toBeTruthy());
    const sheet = byTestId("pix-sheet")!;
    expect(sheet.querySelector("img[alt='QR Code do Pix']")).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=");
    expect(byTestId("pix-amount")?.textContent?.replace(/\s/g, " ")).toMatch(/R\$\s*150,00/);
    expect(byTestId("pix-steps")).toHaveTextContent("Pix Copia e Cola");
    expect(sheet.querySelector<HTMLInputElement>("#pix-code")!.value).toBe(CODE);
    await click(buttonText(/Copiar código Pix/));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CODE));
    expect(calls.filter((c) => c.method === "POST" && c.path === "/finance/me/1/pix")).toHaveLength(1);
  });

  it("pelos detalhes da cobrança em atraso também dá para pagar com Pix", async () => {
    mockApi({ ...financeRoutes(), "POST /finance/me/2/pix": () => json(201, charge({ financeRecordId: 2 })) });
    renderWith(<FinancialPage />);
    await waitFor(() => expect(byLabel("Ver Mensalidade 2")).toBeTruthy());
    await click(byLabel("Ver Mensalidade 2"));
    await waitFor(() => expect(buttonText(/^\s*Pagar com Pix\s*$/)).toBeTruthy());
    await click(buttonText(/^\s*Pagar com Pix\s*$/));
    await waitFor(() => expect(byTestId("pix-sheet")).toBeTruthy());
  });

  it("nos detalhes de uma cobrança paga não há 'Pagar com Pix' e aparece 'Pago via Pix' quando automático", async () => {
    mockApi(financeRoutes());
    renderWith(<FinancialPage />);
    await waitFor(() => expect(byLabel("Ver Mensalidade 3")).toBeTruthy());
    await click(byLabel("Ver Mensalidade 3"));
    await waitFor(() => expect(text()).toContain("Detalhes da cobrança"));
    expect(buttonText(/^\s*Pagar com Pix\s*$/)).toBeUndefined();
    const detailLines = [...document.body.querySelectorAll("[role='dialog'] p")].map((p) => p.textContent);
    expect(detailLines).toContain("Pago via Pix");
  });
});

describe("PixSheet", () => {
  const openRecord = rec({ id: 1 });

  it("polling: ao virar PAID mostra 'Pagamento confirmado', avisa e refaz o financeiro", async () => {
    let gets = 0;
    const calls = mockApi({
      "POST /finance/me/1/pix": () => json(201, charge()),
      "GET /finance/me/1/pix": () => json(200, ++gets >= 2 ? charge({ status: "PAID" }) : charge()),
    });
    const client = makeClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderWith(<PixSheet record={openRecord} onClose={() => {}} pollIntervalMs={30} />, client);
    await waitFor(() => expect(byTestId("pix-paid")).toBeTruthy());
    expect(byTestId("pix-paid")).toHaveTextContent("Pagamento confirmado");
    expect(toast.success).toHaveBeenCalledWith("Pagamento confirmado!");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["finance"] });
    expect(calls.filter((c) => c.method === "GET" && c.path === "/finance/me/1/pix").length).toBeGreaterThanOrEqual(2);
    await sleep(60);
    const before = calls.length;
    await sleep(150);
    expect(calls.length).toBe(before); // parou de consultar depois de pago
  });

  it("fechar a folha para o polling", async () => {
    const calls = mockApi({ "POST /finance/me/1/pix": () => json(201, charge()), "GET /finance/me/1/pix": () => json(200, charge()) });
    const client = renderWith(<PixSheet record={openRecord} onClose={() => {}} pollIntervalMs={30} />);
    await waitFor(() => expect(byTestId("pix-waiting")).toBeTruthy());
    await waitFor(() => expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThanOrEqual(1));
    renderWith(<PixSheet record={null} onClose={() => {}} pollIntervalMs={30} />, client);
    await sleep(100); // deixa um GET em voo terminar
    const before = calls.length;
    await sleep(200);
    expect(calls.length).toBe(before);
  });

  it("MP_NOT_CONNECTED: mensagem amigável para o aluno", async () => {
    mockApi({ "POST /finance/me/1/pix": () => json(409, { message: "x", code: "MP_NOT_CONNECTED" }) });
    renderWith(<PixSheet record={openRecord} onClose={() => {}} />);
    await waitFor(() => expect(text()).toContain("O grupo ainda não está recebendo por Pix. Fale com o seu Mestre."));
  });

  it("MP_ACCOUNT_ERROR: mesma orientação ao aluno (sem expor a conta do Mercado Pago)", async () => {
    mockApi({ "POST /finance/me/1/pix": () => json(409, { message: "x", code: "MP_ACCOUNT_ERROR" }) });
    renderWith(<PixSheet record={openRecord} onClose={() => {}} />);
    await waitFor(() => expect(text()).toContain("O grupo ainda não está recebendo por Pix. Fale com o seu Mestre."));
  });

  it("Pix expirado: oferece gerar um novo", async () => {
    mockApi({ "POST /finance/me/1/pix": () => json(201, charge({ status: "EXPIRED" })) });
    renderWith(<PixSheet record={openRecord} onClose={() => {}} />);
    await waitFor(() => expect(byTestId("pix-expired")).toBeTruthy());
    expect(byTestId("pix-expired")).toHaveTextContent("expirou");
    expect(buttonText(/Gerar novo Pix/)).toBeTruthy();
  });
});

describe("utilitários do Pix", () => {
  it("mensagens por código, imagem do QR e regras de selo/botão", () => {
    const err = (code: string) => new ApiError("x", 400, code);
    expect(pixErrorMessage(err("PAYER_EMAIL_REQUIRED"))).toBe("Cadastre um e-mail do aluno ou responsável para gerar o Pix.");
    expect(pixErrorMessage(err("ALREADY_PAID"))).toContain("já está paga");
    expect(pixErrorMessage(err("RECORD_NOT_PAYABLE"))).toContain("não pode ser paga");
    expect(pixErrorMessage(err("AMOUNT_TOO_LOW"))).toContain("baixo demais");
    expect(pixErrorMessage(err("MP_NOT_CONNECTED"))).toBe(pixErrorMessage(err("MP_ACCOUNT_ERROR")));
    expect(pixErrorMessage(err("PIX_PENDING_AMOUNT_CHANGED"))).toContain("Pix pendente com o valor anterior");
    expect(pixErrorMessage(err("PROVIDER_UNAVAILABLE"))).toContain("Tente de novo em instantes");
    expect(pixErrorMessage(err("PAYMENTS_UNAVAILABLE"))).toContain("não estão disponíveis");
    expect(pixErrorMessage(err("PIX_NOT_FOUND"))).toContain("Nenhum Pix");
    expect(pixErrorMessage(new Error("rede"))).toBe("Não foi possível gerar o Pix. Tente novamente.");
    expect(qrImageSrc({ qrCodeBase64: "AAA" })).toBe("data:image/png;base64,AAA");
    expect(qrImageSrc({ qrCodeBase64: undefined })).toBeNull();

    expect(pixBadgeKind({ status: "PENDING", pix: pix("PENDING") })).toBe("waiting");
    expect(pixBadgeKind({ status: "PENDING", pix: pix("PENDING", "2020-01-01T00:00:00.000Z") })).toBeNull(); // vencido no relógio
    expect(pixBadgeKind({ status: "PENDING", pix: pix("EXPIRED") })).toBeNull();
    expect(pixBadgeKind({ status: "PAID", paidVia: "PIX_AUTO" })).toBe("paid-auto");
    expect(pixBadgeKind({ status: "PAID", paidVia: "MANUAL" })).toBeNull();
    expect(canPayWithPix("PENDING")).toBe(true);
    expect(canPayWithPix("OVERDUE")).toBe(true);
    expect(canPayWithPix("PAID")).toBe(false);
    expect(canPayWithPix("CANCELLED")).toBe(false);
  });
});
