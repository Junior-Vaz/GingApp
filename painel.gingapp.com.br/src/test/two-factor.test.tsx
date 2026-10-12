import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { clearSession, loginAs } from "./login-as";
import { TwoFactorButton } from "@/components/painel/two-factor-dialog";
import { ACTION_OPTIONS, actionLabel } from "@/modules/atividade/atividade-api";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; body: unknown };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const CODES = ["aaaaa-11111", "bbbbb-22222", "ccccc-33333", "ddddd-44444", "eeeee-55555", "fffff-66666", "ggggg-77777", "hhhhh-88888"];
const SETUP = { secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://totp/GingApp:m", qrCodeDataUrl: "data:image/png;base64,AAAA" };

/** Contrato simulado do backend de 2FA: `me` é mutável para refletir ativar/desativar. */
function mockApi(opts: { enabled: boolean; routes?: Record<string, (call: Call) => Response> }) {
  const state = { twoFactorEnabled: opts.enabled, recoveryCodesRemaining: opts.enabled ? 6 : 0 };
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "");
      const call: Call = { method: init.method ?? "GET", path, body: init.body ? JSON.parse(init.body as string) : undefined };
      calls.push(call);
      const key = `${call.method} ${path}`;
      if (key === "GET /auth/me") return Promise.resolve(json(200, { id: 1, role: "MESTRE", ...state }));
      if (key === "POST /auth/2fa/setup") return Promise.resolve(json(201, SETUP));
      if (key === "POST /auth/2fa/enable" && !opts.routes?.[key]) {
        state.twoFactorEnabled = true;
        state.recoveryCodesRemaining = 8;
        return Promise.resolve(json(201, { recoveryCodes: CODES }));
      }
      const handler = opts.routes?.[key];
      return Promise.resolve(handler ? handler(call) : json(404, { message: `sem rota ${key}` }));
    }),
  );
  return calls;
}

async function openDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TwoFactorButton />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Verificação em duas etapas" }));
  return screen.findByRole("dialog");
}

beforeEach(() => loginAs("MESTRE"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("Verificação em duas etapas (card)", () => {
  it("desativada: Ativar -> QR + segredo -> código -> mostra os 8 códigos de recuperação uma vez", async () => {
    const calls = mockApi({ enabled: false });
    const dialog = await openDialog();
    expect(await within(dialog).findByText("Desativada")).toBeInTheDocument();
    expect(within(dialog).getByTestId("two-factor-hint")).toHaveTextContent("Recomendado: ative a verificação em duas etapas");

    fireEvent.click(within(dialog).getByRole("button", { name: "Ativar" }));
    expect(await within(dialog).findByAltText("QR code para o app autenticador")).toHaveAttribute("src", SETUP.qrCodeDataUrl);
    expect(within(dialog).getByTestId("two-factor-secret")).toHaveTextContent(SETUP.secret);

    fireEvent.change(within(dialog).getByLabelText("Código de 6 dígitos"), { target: { value: "123456" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar e ativar" }));

    const codes = await within(dialog).findByTestId("recovery-codes");
    CODES.forEach((code) => expect(within(codes).getByText(code)).toBeInTheDocument());
    expect(within(codes).getByRole("alert")).toHaveTextContent("Guarde agora");
    expect(calls.find((c) => c.path === "/auth/2fa/enable")?.body).toEqual({ code: "123456" });
    expect(calls.find((c) => c.path === "/auth/2fa/setup")?.body).toBeUndefined();

    // "Já guardei": os códigos somem e o estado passa a Ativada
    fireEvent.click(within(dialog).getByRole("button", { name: "Já guardei os códigos" }));
    expect(await within(dialog).findByText("Ativada")).toBeInTheDocument();
    expect(within(dialog).queryByText(CODES[0]!)).not.toBeInTheDocument();
  });

  it("código errado ao ativar (400): mostra a mensagem e continua no passo do código", async () => {
    mockApi({ enabled: false, routes: { "POST /auth/2fa/enable": () => json(400, { message: "Código incorreto." }) } });
    const dialog = await openDialog();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Ativar" }));
    fireEvent.change(await within(dialog).findByLabelText("Código de 6 dígitos"), { target: { value: "000000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar e ativar" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Código incorreto.");
    expect(within(dialog).queryByTestId("recovery-codes")).not.toBeInTheDocument();
  });

  it("ativada: mostra restantes e desativa com senha + código; senha errada (403) mostra o erro", async () => {
    let attempt = 0;
    const calls = mockApi({
      enabled: true,
      routes: {
        "POST /auth/2fa/disable": () => (attempt++ === 0 ? json(403, { message: "Senha incorreta." }) : json(201, { twoFactorEnabled: false })),
      },
    });
    const dialog = await openDialog();
    expect(await within(dialog).findByText("Ativada")).toBeInTheDocument();
    expect(within(dialog).getByTestId("recovery-remaining")).toHaveTextContent("6");

    fireEvent.change(within(dialog).getByLabelText("Senha atual"), { target: { value: "errada" } });
    fireEvent.change(within(dialog).getByLabelText("Código de 6 dígitos"), { target: { value: "123456" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Desativar verificação" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Senha incorreta.");

    fireEvent.change(within(dialog).getByLabelText("Senha atual"), { target: { value: "SenhaAtual#2024" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Desativar verificação" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Verificação em duas etapas desativada."));
    expect(calls.filter((c) => c.path === "/auth/2fa/disable")[1]?.body).toEqual({ password: "SenhaAtual#2024", code: "123456" });
  });
});

describe("rótulos de auditoria do 2FA", () => {
  it("traduz os códigos novos e os inclui no filtro de ação", () => {
    expect(actionLabel("TWO_FACTOR_ENABLE")).toBe("Verificação em duas etapas ativada");
    expect(actionLabel("CERTIFICATE_ISSUE")).toBe("Certificado emitido");
    expect(ACTION_OPTIONS.some((option) => option.value === "AUDIT_PURGE")).toBe(true);
  });
});
