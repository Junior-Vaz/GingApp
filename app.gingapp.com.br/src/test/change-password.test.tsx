import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { ChangePasswordSection } from "@/components/gingapp/change-password";
import { api, setUnauthorizedHandler } from "@/lib/api";
import { newPasswordRules, passwordByteLength, validateChangePassword } from "@/lib/password";
import {
  ACTIVE_STUDENT_KEY_PREFIX,
  TOKEN_STORAGE_KEY,
  USER_STORAGE_KEY,
  clearSession,
  getStoredStudentId,
  getToken,
  replaceToken,
  saveSession,
  setStoredStudentId,
  type AuthUser,
} from "@/lib/session";

// Sem @testing-library/dom (peer ausente no lockfile): react-dom + act bastam.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER: AuthUser = {
  id: 7,
  name: "Responsável",
  email: "resp@x.com",
  userType: "MEMBER",
  isSuperAdmin: false,
  organizationId: 1,
  organizationSlug: "g",
  role: "RESPONSAVEL",
};
const CURRENT = "SenhaAtual#2024";
const NEXT = "NovaSenhaForte#9";

type Call = { method: string; path: string; body: unknown; auth: string | null };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
let calls: Call[] = [];

function mockApi(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
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

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <ChangePasswordSection />
      </QueryClientProvider>,
    );
  });
}

const button = (name: string) =>
  [...container!.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent) === name) as
    | HTMLButtonElement
    | undefined;
const field = (id: string) => container!.querySelector<HTMLInputElement>(`#${id}`)!;
function type(id: string, value: string) {
  const el = field(id);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function fill(current: string, next: string, confirm: string) {
  type("currentPassword", current);
  type("newPassword", next);
  type("confirmPassword", confirm);
}
const click = (name: string) => act(() => button(name)!.click());
const submit = () =>
  act(() => {
    container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
function open() {
  renderSection();
  click("Alterar senha");
}

beforeEach(() => {
  saveSession("tok", USER);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setUnauthorizedHandler(null);
  clearSession();
  localStorage.clear();
});

describe("regras da senha nova (espelham o backend)", () => {
  const errors = (next: string, current = CURRENT, confirm = next) =>
    validateChangePassword({ currentPassword: current, newPassword: next, confirmPassword: confirm });

  it("12 caracteres é o mínimo", () => {
    expect(errors("a".repeat(11)).newPassword).toMatch(/mínimo 12/);
    expect(errors("a".repeat(12))).toEqual({});
  });

  it("72 BYTES UTF-8 é o máximo (não 72 caracteres)", () => {
    expect(errors("a".repeat(72))).toEqual({});
    expect(errors("a".repeat(73)).newPassword).toMatch(/máximo 72 bytes/);
    expect(passwordByteLength("ç".repeat(37))).toBe(74);
    expect(errors("ç".repeat(37)).newPassword).toMatch(/máximo 72 bytes/);
    expect(errors("ç".repeat(36))).toEqual({});
  });

  it("recusa nova igual à atual e a senha padrão de dev (qualquer caixa, embutida)", () => {
    expect(errors(CURRENT).newPassword).toMatch(/diferente da atual/);
    expect(errors("Dev@12345").newPassword).toBeDefined();
    expect(errors("xxxDEV@12345xxxxx").newPassword).toMatch(/padrão de desenvolvimento/);
    expect(newPasswordRules("xxxdev@12345xxx", CURRENT).find((r) => r.id === "forbidden")?.ok).toBe(false);
  });

  it("confirmação precisa ser IGUAL; campos vazios são recusados; senhas não são aparadas", () => {
    expect(errors(NEXT, CURRENT, NEXT + "x").confirmPassword).toMatch(/confirmação/);
    expect(validateChangePassword({ currentPassword: "", newPassword: "", confirmPassword: "" })).toEqual({
      currentPassword: "Informe a senha atual.",
      newPassword: "Informe a nova senha.",
      confirmPassword: "Confirme a nova senha.",
    });
    expect(errors(" ".repeat(12))).toEqual({});
  });
});

describe("replaceToken", () => {
  it("troca só o token: mantém o usuário e a escolha do dependente (seletor)", () => {
    setStoredStudentId(USER.id, 12);
    const userBefore = localStorage.getItem(USER_STORAGE_KEY);
    replaceToken("novo");
    expect(getToken()).toBe("novo");
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe("novo");
    expect(localStorage.getItem(USER_STORAGE_KEY)).toBe(userBefore);
    expect(getStoredStudentId(USER.id)).toBe(12);
    expect(localStorage.getItem(`${ACTIVE_STUDENT_KEY_PREFIX}${USER.id}`)).toBe("12");
  });

  it("sem sessão guardada não cria sessão pela metade", () => {
    clearSession();
    replaceToken("novo");
    expect(getToken()).toBeNull();
  });
});

describe("ChangePasswordSection (perfil)", () => {
  it("sucesso: POST {currentPassword,newPassword}, grava o NOVO token, mantém o seletor, limpa os campos e avisa", async () => {
    setStoredStudentId(USER.id, 12);
    mockApi({ "POST /auth/change-password": () => json(200, { accessToken: "novo-token" }) });
    open();
    fill(CURRENT, NEXT, NEXT);
    submit();
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/auth/change-password", auth: "Bearer tok" });
    expect(calls[0]!.body).toEqual({ currentPassword: CURRENT, newPassword: NEXT }); // sem confirmPassword
    expect(getToken()).toBe("novo-token");
    expect(localStorage.getItem(USER_STORAGE_KEY)).not.toBeNull(); // continua logado
    expect(getStoredStudentId(USER.id)).toBe(12); // seletor de dependente intacto
    expect(toastMock.success).toHaveBeenCalledWith("Senha alterada. Você continua conectado.");
    // formulário fechado e sem senhas no DOM; reabrir mostra os campos vazios
    expect(container!.querySelector("input")).toBeNull();
    click("Alterar senha");
    expect(field("currentPassword").value).toBe("");
    expect(field("newPassword").value).toBe("");
    expect(field("confirmPassword").value).toBe("");
  });

  it("400 'Senha atual incorreta.': mostra a mensagem, NÃO desloga, mantém token e campos preenchidos", async () => {
    mockApi({ "POST /auth/change-password": () => json(400, { message: "Senha atual incorreta." }) });
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    open();
    fill("errada-errada-1", NEXT, NEXT);
    submit();
    await settle();

    expect(toastMock.error).toHaveBeenCalledWith("Senha atual incorreta.");
    expect(getToken()).toBe("tok");
    expect(localStorage.getItem(USER_STORAGE_KEY)).not.toBeNull();
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(field("newPassword").value).toBe(NEXT); // continua no formulário para corrigir
  });

  it("400 de política com message ARRAY: junta as mensagens", async () => {
    mockApi({
      "POST /auth/change-password": () =>
        json(400, { message: ["newPassword deve ter no mínimo 12 caracteres.", "newPassword não pode ser a senha padrão de desenvolvimento."] }),
    });
    open();
    fill(CURRENT, NEXT, NEXT);
    submit();
    await settle();
    expect(toastMock.error).toHaveBeenCalledWith(
      "newPassword deve ter no mínimo 12 caracteres. newPassword não pode ser a senha padrão de desenvolvimento.",
    );
    expect(getToken()).toBe("tok");
  });

  it("429 vira mensagem amigável; 409 mostra a do backend; token intacto", async () => {
    let status = 429;
    mockApi({
      "POST /auth/change-password": () =>
        status === 429
          ? json(429, { message: "ThrottlerException: Too Many Requests" })
          : json(409, { message: "A senha foi alterada em outra sessão. Tente novamente." }),
    });
    open();
    fill(CURRENT, NEXT, NEXT);
    submit();
    await settle();
    expect(toastMock.error).toHaveBeenCalledWith("Muitas tentativas de troca de senha. Aguarde um minuto e tente novamente.");
    status = 409;
    submit();
    await settle();
    expect(toastMock.error).toHaveBeenCalledWith("A senha foi alterada em outra sessão. Tente novamente.");
    expect(getToken()).toBe("tok");
  });

  it("401 de verdade (sessão inválida) encerra a sessão", async () => {
    mockApi({ "POST /auth/change-password": () => json(401, { message: "Unauthorized" }) });
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    open();
    fill(CURRENT, NEXT, NEXT);
    submit();
    await settle();
    expect(onUnauthorized).toHaveBeenCalled();
    expect(getToken()).toBeNull();
  });

  it("200 sem accessToken: não finge sucesso (sessão encerrada, erro mostrado)", async () => {
    mockApi({ "POST /auth/change-password": () => json(200, {}) });
    open();
    fill(CURRENT, NEXT, NEXT);
    submit();
    await settle();
    expect(toastMock.error).toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
  });

  it("confirmação diferente: erro no campo e NENHUMA chamada ao servidor", async () => {
    mockApi({ "POST /auth/change-password": () => json(200, { accessToken: "x" }) });
    open();
    fill(CURRENT, NEXT, NEXT + "!");
    submit();
    await settle();
    expect(container!.textContent).toContain("A confirmação não é igual à nova senha.");
    expect(calls).toHaveLength(0);
    expect(getToken()).toBe("tok");
  });

  it("nova igual à atual / curta / padrão de dev: erro e nenhuma chamada", async () => {
    mockApi({ "POST /auth/change-password": () => json(200, { accessToken: "x" }) });
    open();
    fill(CURRENT, CURRENT, CURRENT);
    submit();
    expect(container!.textContent).toContain("A nova senha deve ser diferente da atual.");
    fill(CURRENT, "curta", "curta");
    submit();
    expect(container!.textContent).toContain("A nova senha deve ter no mínimo 12 caracteres.");
    fill(CURRENT, "Dev@12345Dev@", "Dev@12345Dev@");
    submit();
    expect(container!.textContent).toContain("A nova senha não pode ser a senha padrão de desenvolvimento.");
    expect(calls).toHaveLength(0);
  });

  it("lista de requisitos acompanha a digitação e mostrar/ocultar alterna o tipo do campo", () => {
    open();
    const item = (text: string) =>
      [...container!.querySelectorAll("li")].find((li) => li.textContent === text) as HTMLLIElement;
    type("newPassword", "curta");
    expect(item("No mínimo 12 caracteres").getAttribute("data-ok")).toBe("false");
    type("newPassword", NEXT);
    expect(item("No mínimo 12 caracteres").getAttribute("data-ok")).toBe("true");
    expect(item("No máximo 72 bytes (UTF-8)").getAttribute("data-ok")).toBe("true");

    expect(field("newPassword").type).toBe("password");
    click("Mostrar nova senha");
    expect(field("newPassword").type).toBe("text");
    click("Ocultar nova senha");
    expect(field("newPassword").type).toBe("password");
  });
});

describe("401 obsoleto (token trocado durante a chamada)", () => {
  it("um 401 de requisição feita com o token ANTIGO não derruba a sessão que já tem o token novo", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    mockApi({
      "GET /students": () => {
        replaceToken("novo-token"); // a troca de senha termina enquanto esta chamada (com "tok") está em voo
        return json(401, { message: "Unauthorized" });
      },
    });
    await expect(api.get("/students")).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBe("novo-token");
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("401 com o token atual continua encerrando a sessão", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    mockApi({ "GET /students": () => json(401, { message: "Unauthorized" }) });
    await expect(api.get("/students")).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
