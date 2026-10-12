import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckinPage } from "@/components/gingapp/checkin";
import { normalizeCheckinInput, parseCheckinToken } from "@/lib/checkin";
import { clearSession } from "@/lib/session";

/**
 * Check-in por QR: o aluno digita (ou le) o codigo e toca em "Confirmar presença". O app extrai tipo/id do
 * token e chama o endpoint certo (evento: /events/<id>/checkin-self; aula: /attendance/self-checkin),
 * sempre com o aluno ativo, e mostra o sucesso ou a mensagem do servidor.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Call {
  path: string;
  method: string;
  body: string | null;
}
interface Reply {
  body: unknown;
  status?: number;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let calls: Call[] = [];

function mockApi(checkin: (call: Call) => Reply) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input).replace(/^.*\/api/, "http://x")).pathname;
      const call: Call = { path, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null };
      calls.push(call);
      if (path === "/students/me") {
        return new Response(JSON.stringify([{ id: 5, userId: 7, unitId: 1, name: "Ana", photo: null, coverPhoto: null, socialLinks: null, joinedAt: null }]));
      }
      if (call.method === "POST") {
        const reply = checkin(call);
        return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
      }
      return new Response("[]");
    }),
  );
}
const posts = () => calls.filter((c) => c.method === "POST");

function render(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>));
}

const text = () => (container?.textContent ?? "").replace(/\u00a0/g, " ");
const waitFor = (assertion: () => void) => act(async () => void (await vi.waitFor(assertion, { timeout: 3000 })));
const button = (name: RegExp) => [...container!.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""));
const input = () => container!.querySelector<HTMLInputElement>("input")!;

async function typeCode(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function confirm() {
  // O botao so habilita depois que o aluno ativo (/students/me) foi carregado.
  await waitFor(() => expect(button(/Confirmar presença/)!.disabled).toBe(false));
  await act(async () => button(/Confirmar presença/)!.click());
}

beforeEach(() => {
  clearSession();
  localStorage.clear();
  localStorage.setItem(
    "mb_user",
    JSON.stringify({ id: 7, name: "Ana", email: "a@x", userType: "MEMBER", isSuperAdmin: false, organizationSlug: "x", organizationId: 1, role: "ALUNO" }),
  );
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("token de check-in", () => {
  it("aceita o token ou a URL inteira, normaliza caixa/espacos e extrai tipo + id", () => {
    expect(parseCheckinToken(" e12-k7qx m3pa2b ")).toEqual({ token: "E12-K7QXM3PA2B", kind: "EVENTO", id: 12 });
    expect(parseCheckinToken("https://app.gingapp.com.br/checkin?token=l7-abc1234567")).toEqual({
      token: "L7-ABC1234567",
      kind: "AULA",
      id: 7,
    });
    expect(normalizeCheckinInput("https://x/checkin?foo=1&token=E3-ZZ&bar=2")).toBe("E3-ZZ");
    expect(parseCheckinToken("X12-ABC")).toBeNull();
    expect(parseCheckinToken("E-ABC")).toBeNull();
    expect(parseCheckinToken("")).toBeNull();
  });
});

describe("Tela de check-in", () => {
  it("token de evento: POST /events/12/checkin-self só com token + studentId do aluno ativo e mostra 'Presença confirmada!'", async () => {
    mockApi(() => ({ body: { participantId: 3, studentId: 5, status: "ATTENDED", alreadyCheckedIn: false } }));
    render(<CheckinPage />);
    await waitFor(() => expect(calls.some((c) => c.path === "/students/me")).toBe(true));
    await typeCode("e12-k7qxm3pa2b");
    await confirm();
    await waitFor(() => expect(text()).toContain("Presença confirmada!"));
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.path).toBe("/events/12/checkin-self");
    expect(JSON.parse(posts()[0]!.body!)).toEqual({ token: "E12-K7QXM3PA2B", studentId: 5 });
  });

  it("já tinha feito check-in: mostra o aviso (não 'Presença confirmada!')", async () => {
    mockApi(() => ({ body: { participantId: 3, studentId: 5, status: "ATTENDED", alreadyCheckedIn: true } }));
    render(<CheckinPage initialToken="E12-K7QXM3PA2B" />);
    expect(input().value).toBe("E12-K7QXM3PA2B"); // vindo de ?token=, mas NADA e enviado sem o toque
    expect(posts()).toHaveLength(0);
    await confirm();
    await waitFor(() => expect(text()).toContain("Você já tinha feito check-in"));
    expect(text()).not.toContain("Presença confirmada!");
  });

  it("409 do servidor: mostra a mensagem dele e não mostra sucesso", async () => {
    mockApi(() => ({ status: 409, body: { statusCode: 409, message: "O check-in abre às 18:00." } }));
    render(<CheckinPage />);
    await typeCode("E12-K7QXM3PA2B");
    await confirm();
    await waitFor(() => expect(text()).toContain("O check-in abre às 18:00."));
    expect(text()).not.toContain("Presença confirmada!");
  });

  it("token de aula: POST /attendance/self-checkin", async () => {
    mockApi(() => ({ body: { lessonId: 7, studentId: 5, present: true, alreadyCheckedIn: false } }));
    render(<CheckinPage />);
    await typeCode("https://app.gingapp.com.br/checkin?token=L7-ABC1234567");
    await confirm();
    await waitFor(() => expect(text()).toContain("Presença confirmada!"));
    expect(posts()[0]!.path).toBe("/attendance/self-checkin");
    expect(JSON.parse(posts()[0]!.body!)).toEqual({ token: "L7-ABC1234567", studentId: 5 });
  });

  it("código inválido: avisa sem chamar a API", async () => {
    mockApi(() => ({ body: {} }));
    render(<CheckinPage />);
    await typeCode("qualquer coisa");
    await confirm();
    expect(text()).toContain("Código inválido");
    expect(posts()).toHaveLength(0);
  });

  it("sem BarcodeDetector: avisa que a câmera não está disponível e o campo de digitar continua funcionando", async () => {
    expect((window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector).toBeUndefined();
    mockApi(() => ({ body: { participantId: 3, studentId: 5, status: "ATTENDED", alreadyCheckedIn: false } }));
    render(<CheckinPage />);
    expect(text()).toContain("não está disponível");
    expect(button(/Ler QR code/)).toBeUndefined();
    await typeCode("E1-ABCDEFGHIJ");
    await confirm();
    await waitFor(() => expect(text()).toContain("Presença confirmada!"));
  });

  it("com BarcodeDetector e câmera: oferece 'Ler QR code'", () => {
    vi.stubGlobal("BarcodeDetector", class {});
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
    mockApi(() => ({ body: {} }));
    try {
      render(<CheckinPage />);
      expect(button(/Ler QR code/)).toBeTruthy();
    } finally {
      Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });
});
