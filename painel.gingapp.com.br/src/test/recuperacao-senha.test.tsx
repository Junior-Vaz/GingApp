import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { clearSession, loginAs } from "./login-as";
import { routeTree } from "@/routeTree.gen";
import { AlunosPage } from "@/modules/alunos/alunos-page";
import { CertificadosPage } from "@/modules/certificados/certificados-page";
import type { Certificate } from "@/modules/certificados/certificate-utils";

vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

type Call = { method: string; path: string; query: URLSearchParams; body: unknown; auth: string | null };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/** fetch falso roteado por "METHOD /caminho" (sem prefixo da API nem query); registra as chamadas. */
function mockApi(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const [path = "", search = ""] = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
      const method = init.method ?? "GET";
      const headers = (init.headers ?? {}) as Record<string, string>;
      const call: Call = {
        method,
        path,
        query: new URLSearchParams(search),
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

/** Renderiza a rota REAL (routeTree) numa história em memória; devolve o router para inspecionar a URL. */
function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: new QueryClient() },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const NEXT = "NovaSenhaForte#9";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  clearSession();
});

describe("/esqueci-senha", () => {
  it("envia o e-mail e mostra SEMPRE a mensagem neutra", async () => {
    const calls = mockApi({ "POST /auth/forgot-password": () => json(202, { message: "qualquer" }) });
    renderAt("/esqueci-senha");
    fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: " ana@x.com " } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar link" }));

    const message = await screen.findByTestId("forgot-neutral");
    expect(message).toHaveTextContent("Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/auth/forgot-password", body: { email: "ana@x.com" } });
  });
});

describe("/redefinir-senha", () => {
  it("envia token + nova senha, REMOVE o token da URL e mostra o sucesso com link para o login", async () => {
    const calls = mockApi({ "POST /auth/reset-password": () => json(200, { message: "ok" }) });
    const router = renderAt("/redefinir-senha?token=tok-abc");
    const field = await screen.findByLabelText("Nova senha");
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("token", "tok-abc"));
    expect(router.state.location.pathname).toBe("/redefinir-senha");

    fireEvent.change(field, { target: { value: NEXT } });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), { target: { value: NEXT } });
    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));

    expect(await screen.findByTestId("reset-success")).toHaveTextContent("Senha redefinida com sucesso");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/auth/reset-password", body: { token: "tok-abc", newPassword: NEXT } });
    expect(screen.getByRole("link", { name: "Ir para o login" })).toBeInTheDocument();
  });

  it("400 do servidor: mostra a mensagem do backend", async () => {
    mockApi({ "POST /auth/reset-password": () => json(400, { message: "Link inválido ou expirado." }) });
    renderAt("/redefinir-senha?token=velho");
    fireEvent.change(await screen.findByLabelText("Nova senha"), { target: { value: NEXT } });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), { target: { value: NEXT } });
    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Link inválido ou expirado.");
    expect(screen.queryByTestId("reset-success")).not.toBeInTheDocument();
  });

  it("sem token na URL: erro amigável e nenhuma chamada", async () => {
    const calls = mockApi({});
    renderAt("/redefinir-senha");
    expect(await screen.findByTestId("reset-missing-token")).toHaveTextContent("Solicite um novo link");
    expect(calls).toHaveLength(0);
  });

  it("senha curta ou confirmação diferente: erro no campo e nenhuma chamada", async () => {
    const calls = mockApi({});
    renderAt("/redefinir-senha?token=tok");
    fireEvent.change(await screen.findByLabelText("Nova senha"), { target: { value: "curta" } });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), { target: { value: "outra" } });
    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));
    expect(await screen.findByText("A nova senha deve ter no mínimo 12 caracteres.")).toBeInTheDocument();
    expect(screen.getByText("A confirmação não é igual à nova senha.")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});

describe("login: link 'Esqueci minha senha'", () => {
  it("visível só quando capabilities.passwordResetByEmail=true", async () => {
    mockApi({ "GET /auth/capabilities": () => json(200, { passwordResetByEmail: true }) });
    renderAt("/login");
    const link = await screen.findByRole("link", { name: "Esqueci minha senha" });
    expect(link).toHaveAttribute("href", "/esqueci-senha");
  });

  it("oculto com passwordResetByEmail=false", async () => {
    const calls = mockApi({ "GET /auth/capabilities": () => json(200, { passwordResetByEmail: false }) });
    renderAt("/login");
    await screen.findByRole("button", { name: "Entrar" });
    await waitFor(() => expect(calls.some((c) => c.path === "/auth/capabilities")).toBe(true));
    await act(async () => {});
    expect(screen.queryByText("Esqueci minha senha")).not.toBeInTheDocument();
  });

  it("oculto quando a consulta falha (o login continua funcionando)", async () => {
    mockApi({ "GET /auth/capabilities": () => json(500, { message: "fora do ar" }) });
    renderAt("/login");
    await screen.findByRole("button", { name: "Entrar" });
    await act(async () => {});
    expect(screen.queryByText("Esqueci minha senha")).not.toBeInTheDocument();
  });
});

describe("certificados: Baixar PDF", () => {
  const cert: Certificate = {
    id: 7, studentId: 1, studentGraduationId: null, title: "Workshop Angola", issuedAt: "2024-03-10T00:00:00.000Z",
    verificationCode: "cabc123", fileUrl: null, student: { id: 1, name: "Ana Souza" },
  };
  const base = () => ({ "GET /certificates": () => json(200, [cert], { "X-Total-Count": "1" }) });

  beforeEach(() => loginAs("MESTRE")); // token "tok"

  it("faz GET autenticado como blob e dispara o download certificado-<codigo>.pdf", async () => {
    const calls = mockApi({
      ...base(),
      "GET /certificates/7/pdf": () => new Response(new Blob(["%PDF-1.4"], { type: "application/pdf" }), { status: 200 }),
    });
    const createObjectURL = vi.fn(() => "blob:pdf");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });

    renderPage(<CertificadosPage />);
    const row = (await screen.findByText("Ana Souza")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Baixar PDF" }));

    await waitFor(() => expect(clicked).toEqual(["certificado-cabc123.pdf"]));
    const pdf = calls.find((c) => c.path === "/certificates/7/pdf")!;
    expect(pdf).toMatchObject({ method: "GET", auth: "Bearer tok" });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    await waitFor(() => expect(within(row).getByRole("button", { name: "Baixar PDF" })).toBeEnabled());
  });

  it("falha do servidor vira toast de erro e o botão volta ao normal", async () => {
    mockApi({ ...base(), "GET /certificates/7/pdf": () => json(404, { message: "Certificado não encontrado." }) });
    renderPage(<CertificadosPage />);
    const row = (await screen.findByText("Ana Souza")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Baixar PDF" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Certificado não encontrado."));
    expect(within(row).getByRole("button", { name: "Baixar PDF" })).toBeEnabled();
  });
});

describe("alunos: convite por e-mail", () => {
  const student = { id: 2, unitId: null, userId: null, name: "José Álvaro", birthDate: null, document: null, phone: null, email: "j@x.com", status: "ACTIVE", joinedAt: null };
  const account = { userId: 51, name: "José Álvaro", email: "j@x.com", status: "ACTIVE", role: "ALUNO", mustChangePassword: false };
  const routes = (inviteSent: boolean, capabilities = true) => ({
    "GET /students": () => json(200, [student], { "X-Total-Count": "1" }),
    "GET /students/2/account": () => json(200, { hasAccount: false }),
    "GET /auth/capabilities": () => json(200, { passwordResetByEmail: capabilities }),
    "POST /students/2/account": () => json(201, { studentId: 2, linkedExistingUser: false, account, inviteSent }),
  });

  async function openCreate() {
    renderPage(<AlunosPage />);
    await screen.findByText("José Álvaro");
    fireEvent.click(screen.getByRole("button", { name: "Acesso de José Álvaro" })); // modo cards (padrão): a ação é um botão
    fireEvent.click(await screen.findByRole("button", { name: /Criar acesso/ }));
    return screen.findByRole("dialog", { name: "Criar acesso do aluno" });
  }
  const invite = "Enviar convite por e-mail (a pessoa define a própria senha)";

  beforeEach(() => loginAs("MESTRE"));

  it("marcado: sem campos de senha, envia {email, sendInvite:true} e avisa quando o e-mail não saiu", async () => {
    const calls = mockApi(routes(false));
    const dialog = await openCreate();
    fireEvent.click(await within(dialog).findByLabelText(invite));
    expect(within(dialog).queryByLabelText("Senha provisória")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar acesso" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ email: "j@x.com", sendInvite: true });
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "Acesso criado, mas o e-mail não pôde ser enviado; use 'Esqueci minha senha' ou defina uma senha provisória.",
        expect.anything(),
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("sem capabilities (e-mail desligado): nenhuma opção de convite e o fluxo da senha provisória segue igual", async () => {
    mockApi(routes(false, false));
    const dialog = await openCreate();
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).endsWith("/auth/capabilities"))).toBe(true));
    await act(async () => {});
    expect(within(dialog).queryByLabelText(invite)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Senha provisória")).toBeInTheDocument();
  });
});
