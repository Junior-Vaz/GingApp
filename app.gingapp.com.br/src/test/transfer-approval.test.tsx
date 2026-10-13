import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";

// Aprovação pública de transferência (/aprovar-transferencia?token=...): backend mockado via fetch.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PASSWORD = "NovaSenhaForte#9";
const TOKEN = "tok-abc-123";
const SUMMARY_PATH = `/public/transfer-approval/${TOKEN}`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const summary = (over: Record<string, unknown> = {}) => ({
  groupName: "Grupo Semente",
  groupLogoUrl: null,
  sharedOnApproval: ["ATTENDANCE", "GRADUATIONS", "CERTIFICATES"],
  isMinor: false,
  canApproveByLink: true,
  emailRequired: true,
  expiresAt: "2026-12-01T00:00:00.000Z",
  ...over,
});

type Call = { method: string; path: string; body: unknown; auth: string | null };
let calls: Call[] = [];
function mockApi(routes: Record<string, (call: Call) => Response>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "");
      const method = init.method ?? "GET";
      const headers = (init.headers ?? {}) as Record<string, string>;
      const call: Call = {
        method,
        path,
        body: init.body ? JSON.parse(init.body as string) : undefined,
        auth: headers["Authorization"] ?? null,
      };
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

async function mountRoute(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
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
const fillAndSubmit = async (email = "adulto@x.com") => {
  type("#approvalEmail", email);
  type("#approvalNewPassword", PASSWORD);
  type("#approvalConfirmPassword", PASSWORD);
  submit();
  await settle();
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("/aprovar-transferencia (pública)", () => {
  it("feliz: carrega o resumo, cria a senha, aprova e mostra o sucesso (sem login, token fora da URL)", async () => {
    mockApi({
      [`GET ${SUMMARY_PATH}`]: () => json(200, summary()),
      [`POST ${SUMMARY_PATH}/approve`]: () => json(200, { status: "APPROVED", groupName: "Grupo Semente" }),
    });
    const router = await mountRoute(`/aprovar-transferencia?token=${TOKEN}`);
    expect(router.state.location.pathname).toBe("/aprovar-transferencia"); // não redirecionou para o login
    expect(router.history.location.href).toBe("/aprovar-transferencia"); // token saiu da URL

    const text = container!.textContent!;
    expect(text).toContain("Grupo Semente");
    expect(text).toContain("quer receber você");
    expect(text).toContain("Frequência por turma");
    expect(text).toContain("Graduações");
    expect(text).toContain("Certificados");
    expect(text).toContain("matrícula atual será encerrada");
    expect(text.toLowerCase()).not.toContain("mensalidade");

    await fillAndSubmit();

    const approve = calls.find((c) => c.method === "POST")!;
    expect(approve.path).toBe(`${SUMMARY_PATH}/approve`);
    expect(approve.auth).toBeNull();
    expect(approve.body).toEqual({ newPassword: PASSWORD, email: "adulto@x.com" });
    const ok = container!.querySelector('[data-testid="approval-success"]');
    expect(ok?.textContent).toContain("adulto@x.com");
    expect(container!.querySelector('a[href="/login"]:has(button)')).not.toBeNull();
    expect(container!.querySelector("form")).toBeNull();
  });

  it("menor de idade: mostra a mensagem do responsável e NENHUM formulário", async () => {
    mockApi({ [`GET ${SUMMARY_PATH}`]: () => json(200, summary({ isMinor: true, canApproveByLink: false })) });
    await mountRoute(`/aprovar-transferencia?token=${TOKEN}`);
    expect(container!.querySelector('[data-testid="approval-minor"]')?.textContent).toBe(
      "Menores de idade não aprovam por link. O responsável deve entrar no app com o login dele e aprovar em Transferências.",
    );
    expect(container!.querySelector("form")).toBeNull();
  });

  it("token inválido (404): mensagem amigável única e sem formulário", async () => {
    mockApi({
      [`GET ${SUMMARY_PATH}`]: () => json(404, { code: "TRANSFER_APPROVAL_INVALID", message: "not found" }),
    });
    await mountRoute(`/aprovar-transferencia?token=${TOKEN}`);
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain("Este link não é mais válido");
    expect(container!.querySelector("form")).toBeNull();
  });

  it("409 EMAIL_IN_USE: orienta a entrar no app e aprovar em Transferências; sem sucesso", async () => {
    mockApi({
      [`GET ${SUMMARY_PATH}`]: () => json(200, summary()),
      [`POST ${SUMMARY_PATH}/approve`]: () => json(409, { code: "EMAIL_IN_USE", message: "em uso" }),
    });
    await mountRoute(`/aprovar-transferencia?token=${TOKEN}`);
    await fillAndSubmit();
    const alert = container!.querySelector('[role="alert"]')?.textContent ?? "";
    expect(alert).toContain("já tem uma conta");
    expect(alert).toContain("Transferências");
    expect(container!.querySelector('[data-testid="approval-success"]')).toBeNull();
  });

  it("senha fraca nem chama o servidor; recusar pede confirmação e depois chama /decline", async () => {
    mockApi({
      [`GET ${SUMMARY_PATH}`]: () => json(200, summary({ emailRequired: false })),
      [`POST ${SUMMARY_PATH}/decline`]: () => json(200, { status: "DECLINED", groupName: "Grupo Semente" }),
    });
    await mountRoute(`/aprovar-transferencia?token=${TOKEN}`);
    expect(container!.querySelector("#approvalEmail")).toBeNull();
    type("#approvalNewPassword", "curta");
    type("#approvalConfirmPassword", "curta");
    submit();
    expect(container!.textContent).toContain("A nova senha deve ter no mínimo 12 caracteres.");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);

    const buttons = () => Array.from(container!.querySelectorAll("button"));
    act(() => buttons().find((b) => b.textContent === "Recusar")!.click());
    expect(container!.querySelector('[data-testid="decline-confirm"]')).not.toBeNull();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0); // ainda não recusou
    act(() => buttons().find((b) => b.textContent?.includes("Sim, recusar"))!.click());
    await settle();
    expect(calls.find((c) => c.method === "POST")!.path).toBe(`${SUMMARY_PATH}/decline`);
    expect(container!.querySelector('[data-testid="approval-declined"]')).not.toBeNull();
  });
});
