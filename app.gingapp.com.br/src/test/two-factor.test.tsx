import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { TwoFactorSection } from "@/components/gingapp/two-factor";
import { saveSession, clearSession, getToken, type AuthUser } from "@/lib/session";

// Bloco 2FA do perfil. O backend é simulado pelo contrato (GET /auth/me, /auth/2fa/setup|enable|disable).
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
const QR = "data:image/png;base64,iVBORw0KGgo=";
const SETUP = { secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://totp/GingApp:ana?secret=JBSWY3DPEHPK3PXP", qrCodeDataUrl: QR };
const CODES = ["aaaaa-00001", "aaaaa-00002", "aaaaa-00003", "aaaaa-00004", "aaaaa-00005", "aaaaa-00006", "aaaaa-00007", "aaaaa-00008"];
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

async function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}><TwoFactorSection /></QueryClientProvider>));
  await settle();
}

const button = (text: string) => [...container!.querySelectorAll("button")].find((b) => b.textContent === text);
const click = (text: string) => act(() => button(text)!.click());
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

beforeEach(() => saveSession("tok", USER));
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
  localStorage.clear();
});

describe("2FA no perfil: ativar", () => {
  it("setup mostra QR e segredo; o código ativa e os códigos de recuperação aparecem UMA vez, com aviso e copiar", async () => {
    let enabled = false;
    mockApi({
      "GET /auth/me": () => json(200, { twoFactorEnabled: enabled, recoveryCodesRemaining: enabled ? 8 : 0 }),
      "POST /auth/2fa/setup": () => json(200, SETUP),
      "POST /auth/2fa/enable": () => {
        enabled = true;
        return json(200, { recoveryCodes: CODES });
      },
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await renderSection();
    expect(container!.textContent).not.toContain("Ativada");

    click("Ativar verificação em duas etapas");
    await settle();
    expect(calls.find((c) => c.path === "/auth/2fa/setup")!.body).toBeUndefined(); // sem corpo
    expect(container!.querySelector("img")!.getAttribute("src")).toBe(QR);
    expect(container!.querySelector('[data-testid="two-factor-secret"]')!.textContent).toBe(SETUP.secret);

    type("#twoFactorEnableCode", "123 456");
    submit();
    await settle();
    expect(calls.find((c) => c.path === "/auth/2fa/enable")!.body).toEqual({ code: "123456" });
    const panel = container!.querySelector('[data-testid="two-factor-recovery-codes"]')!;
    expect(panel.textContent).toContain("Guarde agora");
    expect([...panel.querySelectorAll("li")].map((li) => li.textContent)).toEqual(CODES);

    click("Copiar códigos");
    await settle();
    expect(writeText).toHaveBeenCalledWith(CODES.join("\n"));

    click("Já guardei os códigos"); // some para sempre; o estado vira "Ativada"
    await settle();
    expect(container!.querySelector('[data-testid="two-factor-recovery-codes"]')).toBeNull();
    expect(container!.textContent).toContain("Ativada");
    expect(container!.textContent).toContain("Códigos de recuperação restantes: 8");
    expect(getToken()).toBe("tok");
  });

  it("código errado (400) mostra a mensagem e continua no passo do código, sem exibir códigos de recuperação", async () => {
    mockApi({
      "GET /auth/me": () => json(200, { twoFactorEnabled: false, recoveryCodesRemaining: 0 }),
      "POST /auth/2fa/setup": () => json(200, SETUP),
      "POST /auth/2fa/enable": () => json(400, { message: "Código inválido." }),
    });
    await renderSection();
    click("Ativar verificação em duas etapas");
    await settle();
    type("#twoFactorEnableCode", "000000");
    submit();
    await settle();

    expect(container!.querySelector('[role="alert"]')!.textContent).toContain("Código inválido.");
    expect(container!.querySelector("#twoFactorEnableCode")).not.toBeNull();
    expect(container!.querySelector('[data-testid="two-factor-recovery-codes"]')).toBeNull();
  });
});

describe("2FA no perfil: desativar", () => {
  it("ativada: mostra os restantes; senha errada (403) mostra o erro; com senha + código desativa", async () => {
    let attempt = 0;
    let enabled = true;
    mockApi({
      "GET /auth/me": () => json(200, { twoFactorEnabled: enabled, recoveryCodesRemaining: 5 }),
      "POST /auth/2fa/disable": () => {
        if (++attempt === 1) return json(403, { message: "Senha incorreta." });
        enabled = false;
        return json(200, { twoFactorEnabled: false });
      },
    });
    await renderSection();
    expect(container!.textContent).toContain("Ativada");
    expect(container!.textContent).toContain("Códigos de recuperação restantes: 5");

    click("Desativar");
    type("#twoFactorPassword", "errada");
    type("#twoFactorDisableCode", "123456");
    submit();
    await settle();
    expect(container!.querySelector('[role="alert"]')!.textContent).toContain("Senha incorreta.");
    expect(container!.textContent).toContain("Ativada");

    type("#twoFactorPassword", "SenhaForte#2026");
    submit();
    await settle();
    const bodies = calls.filter((c) => c.path === "/auth/2fa/disable").map((c) => c.body);
    expect(bodies[1]).toEqual({ password: "SenhaForte#2026", code: "123456" });
    expect(toastMock.success).toHaveBeenCalledWith("Verificação em duas etapas desativada.");
    expect(container!.textContent).toContain("Ativar verificação em duas etapas");
  });
});
