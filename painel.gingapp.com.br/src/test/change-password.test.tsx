import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { clearSession, loginAs } from "./login-as";
import { ChangePasswordButton } from "@/components/painel/change-password-dialog";
import { api, setUnauthorizedHandler } from "@/lib/api";
import { changePasswordSchema, newPasswordRules, passwordByteLength } from "@/lib/password";
import { TOKEN_STORAGE_KEY, USER_STORAGE_KEY, getToken } from "@/lib/session";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; body: unknown; auth: string | null };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

/** fetch falso: roteia por "METHOD /caminho" e registra as chamadas (corpo e header Authorization). */
function mockApi(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
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
      return Promise.resolve(handler ? handler(call) : json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  return calls;
}

function renderButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChangePasswordButton />
    </QueryClientProvider>,
  );
}

const CURRENT = "SenhaAtual#2024";
const NEXT = "NovaSenhaForte#9";

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Alterar senha" }));
  return screen.findByRole("dialog");
}

function fill(dialog: HTMLElement, current: string, next: string, confirm: string) {
  fireEvent.change(within(dialog).getByLabelText("Senha atual"), { target: { value: current } });
  fireEvent.change(within(dialog).getByLabelText("Nova senha"), { target: { value: next } });
  fireEvent.change(within(dialog).getByLabelText("Confirmar nova senha"), { target: { value: confirm } });
}
const submit = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole("button", { name: "Alterar senha" }));

beforeEach(() => {
  loginAs("MESTRE"); // token "tok"
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
  setUnauthorizedHandler(null);
});

describe("regras da senha nova (espelham o backend)", () => {
  const ok = (next: string, current = CURRENT, confirm = next) =>
    changePasswordSchema.safeParse({ currentPassword: current, newPassword: next, confirmPassword: confirm });

  it("12 caracteres é o mínimo", () => {
    expect(ok("a".repeat(11)).success).toBe(false);
    expect(ok("a".repeat(12)).success).toBe(true);
  });

  it("72 BYTES UTF-8 é o máximo (não 72 caracteres)", () => {
    expect(ok("a".repeat(72)).success).toBe(true);
    expect(ok("a".repeat(73)).success).toBe(false);
    const multibyte = "ç".repeat(37); // 37 caracteres, 74 bytes
    expect(multibyte.length).toBe(37);
    expect(passwordByteLength(multibyte)).toBe(74);
    expect(ok(multibyte).success).toBe(false);
    expect(ok("ç".repeat(36)).success).toBe(true); // 72 bytes
  });

  it("recusa nova igual à atual", () => {
    const result = ok(CURRENT);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("diferente da atual");
  });

  it("recusa a senha padrão de dev em qualquer caixa e embutida", () => {
    expect(ok("Dev@12345").success).toBe(false);
    expect(ok("xxxDEV@12345xxxxx").success).toBe(false);
    expect(newPasswordRules("xxxdev@12345xxx", CURRENT).find((r) => r.id === "forbidden")?.ok).toBe(false);
  });

  it("exige confirmação IGUAL à nova", () => {
    const result = ok(NEXT, CURRENT, NEXT + "x");
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("confirmação");
    expect(ok(NEXT).success).toBe(true);
  });

  it("não apara espaços: senha só de espaços tem tamanho real", () => {
    expect(ok(" ".repeat(12)).success).toBe(true);
  });
});

describe("ChangePasswordButton / diálogo Alterar senha", () => {
  it("sucesso: POST com {currentPassword,newPassword}, grava o NOVO token, mantém o usuário, toast e fecha", async () => {
    const calls = mockApi({ "POST /auth/change-password": () => json(200, { accessToken: "novo-token" }) });
    renderButton();
    const dialog = await openDialog();
    fill(dialog, CURRENT, NEXT, NEXT);
    submit(dialog);

    await waitFor(() => expect(getToken()).toBe("novo-token"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/auth/change-password", auth: "Bearer tok" });
    expect(calls[0]!.body).toEqual({ currentPassword: CURRENT, newPassword: NEXT }); // sem confirmPassword
    expect(localStorage.getItem(USER_STORAGE_KEY)).not.toBeNull(); // continua logado
    expect(toast.success).toHaveBeenCalledWith("Senha alterada. Você continua conectado.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // chamadas seguintes já usam o token novo
    mockApi({ "GET /students": () => json(200, []) });
    await api.get("/students");
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].headers.Authorization).toBe("Bearer novo-token");
  });

  it("reabrir o diálogo mostra os campos vazios (nenhuma senha sobra)", async () => {
    mockApi({ "POST /auth/change-password": () => json(200, { accessToken: "novo-token" }) });
    renderButton();
    let dialog = await openDialog();
    fill(dialog, CURRENT, NEXT, NEXT);
    submit(dialog);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    dialog = await openDialog();
    expect(within(dialog).getByLabelText("Senha atual")).toHaveValue("");
    expect(within(dialog).getByLabelText("Nova senha")).toHaveValue("");
    expect(within(dialog).getByLabelText("Confirmar nova senha")).toHaveValue("");
  });

  it("400 'Senha atual incorreta.': mostra a mensagem, NÃO desloga, mantém o token e o diálogo aberto", async () => {
    mockApi({ "POST /auth/change-password": () => json(400, { message: "Senha atual incorreta." }) });
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    renderButton();
    const dialog = await openDialog();
    fill(dialog, "errada-errada-1", NEXT, NEXT);
    submit(dialog);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Senha atual incorreta."));
    expect(getToken()).toBe("tok");
    expect(localStorage.getItem(USER_STORAGE_KEY)).not.toBeNull();
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("400 de política com message ARRAY: junta as mensagens", async () => {
    mockApi({
      "POST /auth/change-password": () =>
        json(400, { message: ["newPassword deve ter no mínimo 12 caracteres.", "newPassword não pode ser a senha padrão de desenvolvimento."] }),
    });
    renderButton();
    const dialog = await openDialog();
    fill(dialog, CURRENT, NEXT, NEXT);
    submit(dialog);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "newPassword deve ter no mínimo 12 caracteres. newPassword não pode ser a senha padrão de desenvolvimento.",
      ),
    );
    expect(getToken()).toBe("tok");
  });

  it("429 vira mensagem amigável; 409 mostra a mensagem do backend; token intacto nos dois", async () => {
    let status = 429;
    mockApi({
      "POST /auth/change-password": () =>
        status === 429 ? json(429, { message: "ThrottlerException: Too Many Requests" }) : json(409, { message: "A senha foi alterada em outra sessão. Tente novamente." }),
    });
    renderButton();
    const dialog = await openDialog();
    fill(dialog, CURRENT, NEXT, NEXT);
    submit(dialog);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Muitas tentativas de troca de senha. Aguarde um minuto e tente novamente."),
    );
    status = 409;
    submit(dialog);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("A senha foi alterada em outra sessão. Tente novamente."));
    expect(getToken()).toBe("tok");
  });

  it("401 de verdade (sessão inválida) encerra a sessão", async () => {
    mockApi({ "POST /auth/change-password": () => json(401, { message: "Unauthorized" }) });
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    renderButton();
    const dialog = await openDialog();
    fill(dialog, CURRENT, NEXT, NEXT);
    submit(dialog);
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalled());
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("200 sem accessToken: não finge sucesso (sessão encerrada, erro mostrado)", async () => {
    mockApi({ "POST /auth/change-password": () => json(200, {}) });
    renderButton();
    const dialog = await openDialog();
    fill(dialog, CURRENT, NEXT, NEXT);
    submit(dialog);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("confirmação diferente: erro no campo e NENHUMA chamada ao servidor", async () => {
    const calls = mockApi({ "POST /auth/change-password": () => json(200, { accessToken: "x" }) });
    renderButton();
    const dialog = await openDialog();
    fill(dialog, CURRENT, NEXT, NEXT + "!");
    submit(dialog);
    expect(await within(dialog).findByText("A confirmação não é igual à nova senha.")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    expect(getToken()).toBe("tok");
  });

  it("nova igual à atual / curta / padrão de dev: erro no campo e nenhuma chamada", async () => {
    const calls = mockApi({ "POST /auth/change-password": () => json(200, { accessToken: "x" }) });
    renderButton();
    const dialog = await openDialog();
    fill(dialog, CURRENT, CURRENT, CURRENT);
    submit(dialog);
    expect(await within(dialog).findByText("A nova senha deve ser diferente da atual.")).toBeInTheDocument();
    fill(dialog, CURRENT, "curta", "curta");
    submit(dialog);
    expect((await within(dialog).findAllByText("A nova senha deve ter no mínimo 12 caracteres.")).length).toBeGreaterThan(0);
    fill(dialog, CURRENT, "Dev@12345Dev@", "Dev@12345Dev@");
    submit(dialog);
    expect(await within(dialog).findByText("A nova senha não pode ser a senha padrão de desenvolvimento.")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("lista de requisitos acompanha a digitação", async () => {
    renderButton();
    const dialog = await openDialog();
    const list = within(dialog).getByTestId("password-requirements");
    const item = (text: RegExp) => within(list).getByText(text).closest("li")!;
    fireEvent.change(within(dialog).getByLabelText("Nova senha"), { target: { value: "curta" } });
    expect(item(/No mínimo 12 caracteres/)).toHaveAttribute("data-ok", "false");
    fireEvent.change(within(dialog).getByLabelText("Nova senha"), { target: { value: NEXT } });
    expect(item(/No mínimo 12 caracteres/)).toHaveAttribute("data-ok", "true");
    expect(item(/No máximo 72 bytes/)).toHaveAttribute("data-ok", "true");
  });

  it("mostrar/ocultar senha alterna o tipo do campo", async () => {
    renderButton();
    const dialog = await openDialog();
    const field = within(dialog).getByLabelText("Nova senha");
    expect(field).toHaveAttribute("type", "password");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mostrar nova senha" }));
    expect(field).toHaveAttribute("type", "text");
    fireEvent.click(within(dialog).getByRole("button", { name: "Ocultar nova senha" }));
    expect(field).toHaveAttribute("type", "password");
  });
});

describe("401 obsoleto (token trocado durante a chamada)", () => {
  it("um 401 de requisição feita com o token ANTIGO não derruba a sessão que já tem o token novo", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    mockApi({
      "GET /students": async () => {
        // a troca de senha termina enquanto esta chamada (feita com "tok") está em voo
        const { replaceToken } = await import("@/lib/session");
        replaceToken("novo-token");
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
