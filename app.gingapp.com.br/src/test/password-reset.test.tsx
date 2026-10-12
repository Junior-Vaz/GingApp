import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { JourneyPage } from "@/components/gingapp/journey";
import { saveSession } from "@/lib/session";

// Recuperação de senha por e-mail + PDF do certificado (backend mockado via fetch).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NEUTRAL = "Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.";
const NEW_PASSWORD = "NovaSenhaForte#9";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

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

beforeEach(() => localStorage.clear());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("/esqueci-senha", () => {
  it("depois de enviar mostra a mensagem NEUTRA (e envia só o e-mail, sem token)", async () => {
    mockApi({ "POST /auth/forgot-password": () => json(202, { message: "qualquer coisa do servidor" }) });
    await mountRoute("/esqueci-senha");
    type("#forgot-email", " aluno@x.com ");
    submit();
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/auth/forgot-password", auth: null });
    expect(calls[0]!.body).toEqual({ email: "aluno@x.com" });
    expect(container!.querySelector('[data-testid="forgot-neutral"]')?.textContent).toBe(NEUTRAL);
    expect(container!.textContent).not.toContain("qualquer coisa do servidor");
    expect(container!.querySelector("form")).toBeNull();
  });
});

describe("/redefinir-senha", () => {
  it("envia token + nova senha, remove o token da URL (replace) e mostra o sucesso com link para o login", async () => {
    mockApi({ "POST /auth/reset-password": () => json(200, { message: "ok" }) });
    const router = await mountRoute("/redefinir-senha?token=tok-123");
    expect(router.state.location.search).toEqual({}); // token saiu da URL
    expect(router.history.location.href).toBe("/redefinir-senha");

    type("#resetNewPassword", NEW_PASSWORD);
    type("#resetConfirmPassword", NEW_PASSWORD);
    submit();
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/auth/reset-password" });
    expect(calls[0]!.body).toEqual({ token: "tok-123", newPassword: NEW_PASSWORD });
    expect(container!.querySelector('[data-testid="reset-success"]')).not.toBeNull();
    expect(container!.querySelector('a[href="/login"]:has(button)')).not.toBeNull();
  });

  it("400 do backend mostra a mensagem dele; senha curta nem chama o servidor; sem token mostra erro amigável", async () => {
    mockApi({ "POST /auth/reset-password": () => json(400, { message: "Link inválido ou expirado." }) });
    await mountRoute("/redefinir-senha?token=velho");
    type("#resetNewPassword", "curta");
    type("#resetConfirmPassword", "curta");
    submit();
    expect(container!.textContent).toContain("A nova senha deve ter no mínimo 12 caracteres.");
    expect(calls).toHaveLength(0);

    type("#resetNewPassword", NEW_PASSWORD);
    type("#resetConfirmPassword", NEW_PASSWORD);
    submit();
    await settle();
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe("Link inválido ou expirado.");
    expect(container!.querySelector('[data-testid="reset-success"]')).toBeNull();

    act(() => root?.unmount());
    container?.remove();
    await mountRoute("/redefinir-senha");
    expect(container!.textContent).toContain("Este link de redefinição está incompleto.");
    expect(container!.querySelector("form")).toBeNull();
  });
});

describe("link 'Esqueci minha senha' no login", () => {
  const link = () => container!.querySelector('[data-testid="forgot-link"]');

  it("visível só quando /auth/capabilities devolve passwordResetByEmail=true", async () => {
    mockApi({ "GET /auth/capabilities": () => json(200, { passwordResetByEmail: true }) });
    await mountRoute("/login");
    expect(link()?.getAttribute("href")).toBe("/esqueci-senha");
  });

  it("oculto quando é false ou quando a consulta falha (login segue funcionando)", async () => {
    mockApi({ "GET /auth/capabilities": () => json(200, { passwordResetByEmail: false }) });
    await mountRoute("/login");
    expect(link()).toBeNull();
    expect(container!.querySelector("form")).not.toBeNull();
    act(() => root?.unmount());
    container?.remove();

    mockApi({ "GET /auth/capabilities": () => json(500, { message: "erro" }) });
    await mountRoute("/login");
    expect(link()).toBeNull();
    expect(container!.querySelector("form")).not.toBeNull();
  });
});

describe("Baixar PDF do certificado", () => {
  it("faz GET autenticado em /certificates/:id/pdf como blob e baixa certificado-<id>.pdf; falha mostra erro", async () => {
    saveSession("tok", {
      id: 1, name: "A", email: "a@b.c", userType: "MEMBER", isSuperAdmin: false,
      organizationId: 1, organizationSlug: "g", role: "ALUNO",
    });
    let pdfStatus = 200;
    mockApi({
      "GET /students/me": () => json(200, [{ id: 5, name: "Aluno" }]),
      "GET /graduations/students/5": () => json(200, []),
      "GET /certificates/me": () =>
        json(200, [{ id: 42, studentId: 5, title: "Certificado de Batizado", issuedAt: null, verificationCode: "ABC" }]),
      "GET /certificates/42/pdf": () =>
        pdfStatus === 200
          ? new Response(new Blob(["%PDF-1.4"], { type: "application/pdf" }), { status: 200 })
          : json(404, { message: "Certificado não encontrado." }),
    });
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<QueryClientProvider client={queryClient}><JourneyPage /></QueryClientProvider>));
    await settle();

    const button = () =>
      [...container!.querySelectorAll("button")].find((b) => b.textContent?.includes("Baixar PDF")) as HTMLButtonElement;
    act(() => button().click());
    await settle();

    const pdfCall = calls.find((c) => c.path === "/certificates/42/pdf")!;
    expect(pdfCall).toMatchObject({ method: "GET", auth: "Bearer tok" });
    expect(clicked).toEqual(["certificado-42.pdf"]);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    expect(container!.querySelector('[role="alert"]')).toBeNull();

    pdfStatus = 404;
    act(() => button().click());
    await settle();
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe("Certificado não encontrado.");
    expect(clicked).toHaveLength(1);
    expect(button().disabled).toBe(false);
  });
});
