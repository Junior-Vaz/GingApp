import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { clearSession, loginAs } from "./login-as";
import { AlunosPage } from "@/modules/alunos/alunos-page";
import { LINKED_MESSAGE } from "@/modules/alunos/acesso-api";
import { clickMenuAction } from "./row-menu";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

type Call = { method: string; path: string; query: URLSearchParams; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function mockApi(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const [path = "", search = ""] = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
      const method = init.method ?? "GET";
      const call: Call = { method, path, query: new URLSearchParams(search), body: init.body ? JSON.parse(init.body as string) : undefined };
      calls.push(call);
      const handler = routes[`${method} ${path}`];
      return Promise.resolve(handler ? handler(call) : json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  return calls;
}

let client: QueryClient;
function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AlunosPage />
    </QueryClientProvider>,
  );
}

const PASSWORD = "Berimbau-Axe-4821";
const students = [
  { id: 1, unitId: null, userId: 50, name: "Ana Souza", birthDate: null, document: null, phone: "11999998888", email: "ana@x.com", status: "ACTIVE", joinedAt: null },
  { id: 2, unitId: null, userId: null, name: "José Álvaro", birthDate: null, document: null, phone: "(11) 98888-7777", email: "j@x.com", status: "ACTIVE", joinedAt: null },
  { id: 3, unitId: null, userId: null, name: "Maria Sem Email", birthDate: null, document: null, phone: null, email: null, status: "ACTIVE", joinedAt: null },
];
const account = { userId: 50, name: "Ana Souza", email: "ana@x.com", status: "ACTIVE", role: "ALUNO", mustChangePassword: true };
const base = () => ({ "GET /students": () => json(200, students, { "X-Total-Count": String(students.length) }) });
const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");

beforeEach(() => {
  localStorage.setItem("painel:alunos:view", "table");
  vi.stubEnv("VITE_APP_URL", "https://app.gingapp.com.br");
  loginAs("MESTRE");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  clearSession();
});

async function openAccess(name: string) {
  renderPage();
  await screen.findByText(name);
  await clickMenuAction(`Acesso de ${name}`);
  return screen.findByRole("dialog", { name: "Acesso do aluno" });
}

describe("Acesso do aluno: criar acesso em um clique", () => {
  it("usa o e-mail do cadastro, NÃO pede senha, envia só {email} e mostra o cartão com a senha do servidor", async () => {
    const calls = mockApi({
      ...base(),
      "GET /students/2/account": () => json(200, { hasAccount: false }),
      "POST /students/2/account": () =>
        json(201, { studentId: 2, linkedExistingUser: false, account: { ...account, userId: 51, email: "j@x.com" }, temporaryPassword: PASSWORD }),
    });
    const dialog = await openAccess("José Álvaro");
    await within(dialog).findByTestId("sem-acesso");
    expect(within(dialog).getByText("j@x.com")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Senha provisória/)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/E-mail do aluno/)).not.toBeInTheDocument(); // e-mail já existe: não pergunta

    fireEvent.click(within(dialog).getByRole("button", { name: /Criar acesso/ }));
    const card = await screen.findByTestId("credentials-card");
    expect(posts(calls)).toHaveLength(1);
    expect(posts(calls)[0]).toMatchObject({ path: "/students/2/account", body: { email: "j@x.com" } });
    expect(Object.keys(posts(calls)[0]!.body as object)).toEqual(["email"]); // nenhuma senha enviada
    expect(within(card).getByText("Acesso criado")).toBeInTheDocument();
    expect(within(card).getByTestId("credentials-email")).toHaveTextContent("j@x.com");
    expect(within(card).getByTestId("credentials-password")).toHaveTextContent(PASSWORD);
    expect(within(card).getByRole("link", { name: "Enviar por WhatsApp" })).toHaveAttribute(
      "href",
      expect.stringContaining("https://wa.me/5511988887777?text="),
    );
  });

  it("a senha NÃO fica no DOM depois de fechar (nem ao reabrir o diálogo) nem no cache de mutações", async () => {
    mockApi({
      ...base(),
      "GET /students/2/account": () => json(200, { hasAccount: false }),
      "POST /students/2/account": () =>
        json(201, { studentId: 2, linkedExistingUser: false, account: { ...account, userId: 51, email: "j@x.com" }, temporaryPassword: PASSWORD }),
    });
    const dialog = await openAccess("José Álvaro");
    await within(dialog).findByTestId("sem-acesso");
    fireEvent.click(within(dialog).getByRole("button", { name: /Criar acesso/ }));
    const card = await screen.findByTestId("credentials-card");
    expect(document.body.textContent).toContain(PASSWORD);
    // nenhuma mutação guarda a senha na resposta
    expect(JSON.stringify(client.getMutationCache().getAll().map((m) => m.state.data))).not.toContain(PASSWORD);

    fireEvent.click(within(card).getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Acesso do aluno" })).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain(PASSWORD);

    // reabre: o cartão não volta
    await clickMenuAction("Acesso de José Álvaro");
    await screen.findByRole("dialog", { name: "Acesso do aluno" });
    expect(screen.queryByTestId("credentials-card")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(PASSWORD);
  });

  it("aluno sem e-mail: pede só o e-mail (botão desabilitado até ser válido) e envia {email}", async () => {
    const calls = mockApi({
      ...base(),
      "GET /students/3/account": () => json(200, { hasAccount: false }),
      "POST /students/3/account": () =>
        json(201, { studentId: 3, linkedExistingUser: false, account: { ...account, userId: 52, email: "maria@x.com" }, temporaryPassword: PASSWORD }),
    });
    const dialog = await openAccess("Maria Sem Email");
    const input = await within(dialog).findByLabelText(/E-mail do aluno/);
    const create = within(dialog).getByRole("button", { name: /Criar acesso/ });
    expect(create).toBeDisabled();
    fireEvent.change(input, { target: { value: "xx" } });
    expect(create).toBeDisabled();
    fireEvent.change(input, { target: { value: "maria@x.com" } });
    expect(create).toBeEnabled();
    fireEvent.click(create);
    const card = await screen.findByTestId("credentials-card");
    expect(posts(calls)[0]).toMatchObject({ path: "/students/3/account", body: { email: "maria@x.com" } });
    // sem telefone: o WhatsApp deixa escolher o contato
    expect(within(card).getByRole("link", { name: "Enviar por WhatsApp" })).toHaveAttribute("href", expect.stringContaining("https://wa.me/?text="));
  });

  it("e-mail que já era usuário (LINKED): avisa e NÃO mostra cartão", async () => {
    mockApi({
      ...base(),
      "GET /students/2/account": () => json(200, { hasAccount: false }),
      "POST /students/2/account": () => json(201, { studentId: 2, linkedExistingUser: true, account }),
    });
    const dialog = await openAccess("José Álvaro");
    await within(dialog).findByTestId("sem-acesso");
    fireEvent.click(within(dialog).getByRole("button", { name: /Criar acesso/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(LINKED_MESSAGE));
    expect(screen.queryByTestId("credentials-card")).not.toBeInTheDocument();
  });

  it("servidor sem senha na resposta vira erro claro (nada de cartão vazio); erro 409 vira toast", async () => {
    let answer: () => Response = () => json(201, { studentId: 2, linkedExistingUser: false, account });
    mockApi({
      ...base(),
      "GET /students/2/account": () => json(200, { hasAccount: false }),
      "POST /students/2/account": () => answer(),
    });
    const dialog = await openAccess("José Álvaro");
    await within(dialog).findByTestId("sem-acesso");
    fireEvent.click(within(dialog).getByRole("button", { name: /Criar acesso/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("não devolveu a senha provisória")));
    expect(screen.queryByTestId("credentials-card")).not.toBeInTheDocument();

    answer = () => json(409, { message: "Este aluno já tem uma conta de acesso." });
    fireEvent.click(within(dialog).getByRole("button", { name: /Criar acesso/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Este aluno já tem uma conta de acesso."));
    expect(screen.queryByTestId("credentials-card")).not.toBeInTheDocument();
  });
});

describe("Acesso do aluno: gerar nova senha fácil", () => {
  const withAccount = (reset: () => Response) => ({
    ...base(),
    "GET /students/1/account": () => json(200, { hasAccount: true, account }),
    "POST /students/1/reset-password": reset,
  });

  it("pede confirmação ('sessões abertas serão encerradas'), só então gera (corpo sem senha) e mostra o cartão", async () => {
    const calls = mockApi(withAccount(() => json(201, { temporaryPassword: PASSWORD })));
    const dialog = await openAccess("Ana Souza");
    await within(dialog).findByTestId("com-acesso");
    fireEvent.click(within(dialog).getByRole("button", { name: /Gerar nova senha fácil/ }));

    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("As sessões abertas serão encerradas");
    expect(posts(calls)).toHaveLength(0); // nada antes de confirmar
    fireEvent.click(within(confirm).getByRole("button", { name: "Gerar nova senha" }));

    const card = await screen.findByTestId("credentials-card");
    expect(posts(calls)).toHaveLength(1);
    expect(posts(calls)[0]).toMatchObject({ path: "/students/1/reset-password", body: {} });
    expect(within(card).getByText("Nova senha gerada")).toBeInTheDocument();
    expect(within(card).getByTestId("credentials-email")).toHaveTextContent("ana@x.com");
    expect(within(card).getByTestId("credentials-password")).toHaveTextContent(PASSWORD);
    expect(JSON.stringify(client.getMutationCache().getAll().map((m) => m.state.data))).not.toContain(PASSWORD);

    fireEvent.click(within(card).getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Acesso do aluno" })).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain(PASSWORD);
  });

  it("Cancelar na confirmação não chama o servidor", async () => {
    const calls = mockApi(withAccount(() => json(201, { temporaryPassword: PASSWORD })));
    const dialog = await openAccess("Ana Souza");
    await within(dialog).findByTestId("com-acesso");
    fireEvent.click(within(dialog).getByRole("button", { name: /Gerar nova senha fácil/ }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(posts(calls)).toHaveLength(0);
    expect(screen.queryByTestId("credentials-card")).not.toBeInTheDocument();
  });

  it("erro do servidor vira toast e a confirmação continua aberta para nova tentativa", async () => {
    mockApi(withAccount(() => json(409, { message: "Esta conta também pertence a outro grupo." })));
    const dialog = await openAccess("Ana Souza");
    await within(dialog).findByTestId("com-acesso");
    fireEvent.click(within(dialog).getByRole("button", { name: /Gerar nova senha fácil/ }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Gerar nova senha" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Esta conta também pertence a outro grupo."));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.queryByTestId("credentials-card")).not.toBeInTheDocument();
  });

  it("resposta sem senha (servidor antigo) avisa para usar 'Definir manualmente'", async () => {
    mockApi(withAccount(() => new Response(null, { status: 204 })));
    const dialog = await openAccess("Ana Souza");
    await within(dialog).findByTestId("com-acesso");
    fireEvent.click(within(dialog).getByRole("button", { name: /Gerar nova senha fácil/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Gerar nova senha" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Definir manualmente")));
    expect(screen.queryByTestId("credentials-card")).not.toBeInTheDocument();
  });

  it("'Definir manualmente' continua disponível (diálogo antigo, com senha e confirmação)", async () => {
    const calls = mockApi(withAccount(() => new Response(null, { status: 204 })));
    const dialog = await openAccess("Ana Souza");
    await within(dialog).findByTestId("com-acesso");
    fireEvent.click(within(dialog).getByRole("button", { name: /Definir manualmente/ }));
    const manual = await screen.findByRole("dialog", { name: "Redefinir senha do aluno" });
    fireEvent.change(within(manual).getByLabelText("Senha provisória"), { target: { value: "Prov@Senha2026x" } });
    fireEvent.change(within(manual).getByLabelText("Confirmar senha provisória"), { target: { value: "Prov@Senha2026x" } });
    fireEvent.click(within(manual).getByRole("button", { name: "Redefinir senha" }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]).toMatchObject({ path: "/students/1/reset-password", body: { newPassword: "Prov@Senha2026x" } });
  });
});
