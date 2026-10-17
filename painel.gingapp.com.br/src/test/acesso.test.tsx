import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, loginAs } from "./login-as";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlunosPage } from "@/modules/alunos/alunos-page";
import { LINKED_MESSAGE } from "@/modules/alunos/acesso-api";
import {
  emptyGuardianForm,
  guardianSchema,
  guardianToPayload,
  guardianToUpdatePayload,
} from "@/modules/alunos/responsaveis";
import { ProfessoresPage } from "@/modules/professores/professores-page";
import {
  createAccountPayload,
  createAccountSchema,
  provisionalPasswordIssue,
  resetPasswordSchema,
} from "@/lib/provisional-password";
import { clickMenuAction, expectMenuAction, queryMenuAction } from "./row-menu";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; query: URLSearchParams; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/** fetch falso: roteia por "METHOD /caminho" (sem prefixo da API NEM query) e registra as chamadas. */
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

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const TEMP = "Prov@Senha2026x";
const students = [
  { id: 1, unitId: null, userId: 50, name: "Ana Souza", birthDate: "1990-05-10T00:00:00.000Z", document: null, phone: "11999", email: "ana@x.com", status: "ACTIVE", joinedAt: null },
  { id: 2, unitId: null, userId: null, name: "José Álvaro", birthDate: null, document: null, phone: null, email: "j@x.com", status: "ACTIVE", joinedAt: null },
];
const account = { userId: 50, name: "Ana Souza", email: "ana@x.com", status: "ACTIVE", role: "ALUNO", mustChangePassword: true };
const guardianNoAccess = {
  id: 5, studentId: 2, name: "Maria Mãe", relationship: "Mãe", phone: "1188", email: "maria@x.com",
  consentPublicProfile: false, hasAccount: false, account: null,
};
const guardianWithAccess = {
  id: 6, studentId: 2, name: "Paulo Pai", relationship: "Pai", phone: null, email: null,
  consentPublicProfile: true, hasAccount: true, account: { userId: 70, email: "paulo@x.com", mustChangePassword: false },
};
const base = () => ({ "GET /students": () => json(200, students, { "X-Total-Count": String(students.length) }) });

beforeEach(() => {
  localStorage.setItem("painel:alunos:view", "table"); // estes testes cobrem a visão em tabela (o padrão novo é cards)
  loginAs("MESTRE");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("schemas de acesso / senha provisória", () => {
  it("segue a política: 12+ caracteres, sem Dev@12345", () => {
    expect(provisionalPasswordIssue(TEMP)).toBeNull();
    expect(provisionalPasswordIssue("curta")).toMatch(/mínimo 12/);
    expect(provisionalPasswordIssue("xxDEV@12345xx")).toMatch(/padrão de desenvolvimento/);
  });
  it("redefinir exige senha, política e confirmação igual", () => {
    expect(resetPasswordSchema.safeParse({ newPassword: TEMP, confirmPassword: TEMP }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ newPassword: "", confirmPassword: "" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ newPassword: "curta", confirmPassword: "curta" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ newPassword: TEMP, confirmPassword: TEMP + "x" }).success).toBe(false);
  });
  it("criar acesso: e-mail obrigatório; senha opcional (vincular) mas, se vier, segue a política", () => {
    const ok = { email: "a@b.com", password: "", confirmPassword: "" };
    expect(createAccountSchema.safeParse(ok).success).toBe(true);
    expect(createAccountSchema.safeParse({ ...ok, email: "" }).success).toBe(false);
    expect(createAccountSchema.safeParse({ ...ok, email: "x" }).success).toBe(false);
    expect(createAccountSchema.safeParse({ ...ok, password: "curta", confirmPassword: "curta" }).success).toBe(false);
    expect(createAccountSchema.safeParse({ ...ok, password: TEMP, confirmPassword: "outra" }).success).toBe(false);
    expect(createAccountPayload(ok)).toEqual({ email: "a@b.com" });
    expect(createAccountPayload({ email: " a@b.com ", password: TEMP, confirmPassword: TEMP })).toEqual({ email: "a@b.com", password: TEMP });
  });
  it("responsável: nunca envia consentimento; null limpa opcionais; senha só com createAccount", () => {
    const v = { ...emptyGuardianForm, name: " Maria ", relationship: " Mãe ", email: "m@x.com" };
    expect(guardianSchema.safeParse(v).success).toBe(true);
    expect(guardianSchema.safeParse({ ...v, name: "M" }).success).toBe(false);
    expect(guardianSchema.safeParse({ ...v, createAccount: true, email: "" }).success).toBe(false);
    expect(guardianSchema.safeParse({ ...v, createAccount: true, password: "curta", confirmPassword: "curta" }).success).toBe(false);
    const payload = guardianToPayload({ ...v, createAccount: true, password: TEMP, confirmPassword: TEMP });
    expect(payload).toEqual({ name: "Maria", relationship: "Mãe", phone: undefined, email: "m@x.com", createAccount: true, password: TEMP });
    expect("consentPublicProfile" in payload).toBe(false);
    expect(guardianToPayload({ ...v, password: TEMP, confirmPassword: TEMP }).password).toBeUndefined();
    expect(guardianToUpdatePayload({ ...v, relationship: "", email: "" })).toEqual({ name: "Maria", relationship: null, phone: null, email: null });
  });
});

describe("AlunosPage - acesso do aluno", () => {
  it("coluna Acesso diferencia quem já tem login", async () => {
    mockApi(base());
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    const table = screen.getByRole("table");
    expect(within(table).getByText("Com acesso")).toBeInTheDocument();
    expect(within(table).getAllByText("Sem acesso")).toHaveLength(1);
  });

  it("sem conta: cria o acesso com e-mail do cadastro + senha provisória (POST /students/:id/account)", async () => {
    const calls = mockApi({
      ...base(),
      "GET /students/2/account": () => json(200, { hasAccount: false }),
      "POST /students/2/account": () => json(201, { studentId: 2, linkedExistingUser: false, account: { ...account, userId: 51 } }),
    });
    renderPage(<AlunosPage />);
    await screen.findByText("José Álvaro");
    await clickMenuAction("Acesso de José Álvaro");
    expect(await screen.findByTestId("sem-acesso")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Definir senha manualmente/ })); // "Criar acesso" é o clique único (ver acesso-rapido.test)

    const dialog = await screen.findByRole("dialog", { name: "Criar acesso do aluno" });
    expect(within(dialog).getByLabelText("E-mail de acesso")).toHaveValue("j@x.com"); // vem do cadastro do aluno
    // senha fraca e confirmação diferente bloqueiam o envio
    fireEvent.change(within(dialog).getByLabelText("Senha provisória"), { target: { value: "curta" } });
    fireEvent.change(within(dialog).getByLabelText("Confirmar senha provisória"), { target: { value: "outra" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar acesso" }));
    expect(await within(dialog).findByText(/no mínimo 12/)).toBeInTheDocument();
    expect(within(dialog).getByText("A confirmação não é igual à senha.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText("Senha provisória"), { target: { value: TEMP } });
    fireEvent.change(within(dialog).getByLabelText("Confirmar senha provisória"), { target: { value: TEMP } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar acesso" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      path: "/students/2/account",
      body: { email: "j@x.com", password: TEMP },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Acesso do aluno criado."));
  });

  it("e-mail que já era usuário: avisa que foi apenas vinculado (sem senha no corpo)", async () => {
    const calls = mockApi({
      ...base(),
      "GET /students/2/account": () => json(200, { hasAccount: false }),
      "POST /students/2/account": () => json(201, { studentId: 2, linkedExistingUser: true, account }),
    });
    renderPage(<AlunosPage />);
    await screen.findByText("José Álvaro");
    await clickMenuAction("Acesso de José Álvaro");
    fireEvent.click(await screen.findByRole("button", { name: /Definir senha manualmente/ }));
    const dialog = await screen.findByRole("dialog", { name: "Criar acesso do aluno" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar acesso" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(LINKED_MESSAGE));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ email: "j@x.com" });
  });

  it("erro do servidor (409) vira toast e o diálogo continua aberto", async () => {
    mockApi({
      ...base(),
      "GET /students/2/account": () => json(200, { hasAccount: false }),
      "POST /students/2/account": () => json(409, { message: "Este aluno já tem uma conta de acesso." }),
    });
    renderPage(<AlunosPage />);
    await screen.findByText("José Álvaro");
    await clickMenuAction("Acesso de José Álvaro");
    fireEvent.click(await screen.findByRole("button", { name: /Definir senha manualmente/ }));
    const dialog = await screen.findByRole("dialog", { name: "Criar acesso do aluno" });
    fireEvent.change(within(dialog).getByLabelText("Senha provisória"), { target: { value: TEMP } });
    fireEvent.change(within(dialog).getByLabelText("Confirmar senha provisória"), { target: { value: TEMP } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar acesso" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Este aluno já tem uma conta de acesso."));
    expect(screen.getByRole("dialog", { name: "Criar acesso do aluno" })).toBeInTheDocument();
  });

  it("com conta: mostra o login e a troca pendente; redefine a senha (POST /students/:id/reset-password)", async () => {
    const calls = mockApi({
      ...base(),
      "GET /students/1/account": () => json(200, { hasAccount: true, account }),
      "POST /students/1/reset-password": () => new Response(null, { status: 204 }),
    });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    await clickMenuAction("Acesso de Ana Souza");
    const info = await screen.findByTestId("com-acesso");
    expect(within(info).getByText("ana@x.com")).toBeInTheDocument();
    expect(within(info).getByText("Troca de senha pendente")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Definir manualmente/ })); // "Gerar nova senha fácil" é o clique único (ver acesso-rapido.test)

    const dialog = await screen.findByRole("dialog", { name: "Redefinir senha do aluno" });
    fireEvent.change(within(dialog).getByLabelText("Senha provisória"), { target: { value: TEMP } });
    fireEvent.change(within(dialog).getByLabelText("Confirmar senha provisória"), { target: { value: TEMP } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Redefinir senha" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ path: "/students/1/reset-password", body: { newPassword: TEMP } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Senha redefinida")));
  });

  it("PROFESSOR também vê as ações (students:edit); a senha NUNCA aparece no DOM do aluno listado", async () => {
    loginAs("PROFESSOR");
    mockApi(base());
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    await expectMenuAction("Acesso de Ana Souza");
    await expectMenuAction("Responsáveis de Ana Souza");
    expect(document.body.textContent).not.toContain("passwordHash");
  });
});

describe("AlunosPage - responsáveis", () => {
  const guardianRoutes = (list: unknown[] = [guardianNoAccess, guardianWithAccess]) => ({
    ...base(),
    "GET /students/2/guardians": () => json(200, list),
  });

  it("lista responsáveis; consentimento do perfil público é somente leitura", async () => {
    mockApi(guardianRoutes());
    renderPage(<AlunosPage />);
    await screen.findByText("José Álvaro");
    await clickMenuAction("Responsáveis de José Álvaro");
    const maria = await screen.findByTestId("responsavel-5");
    expect(within(maria).getByText("Maria Mãe")).toBeInTheDocument();
    expect(within(maria).getByText("Sem acesso")).toBeInTheDocument();
    expect(within(maria).getByText(/não concedido/)).toBeInTheDocument();
    const paulo = screen.getByTestId("responsavel-6");
    expect(within(paulo).getByText("Com acesso")).toBeInTheDocument();
    expect(within(paulo).getByText(/concedido/)).toBeInTheDocument();
    expect(within(paulo).getByText("E-mail de acesso: paulo@x.com")).toBeInTheDocument();
    // nenhum controle para editar o consentimento
    expect(screen.queryByLabelText(/consentimento/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("estado vazio", async () => {
    mockApi(guardianRoutes([]));
    renderPage(<AlunosPage />);
    await screen.findByText("José Álvaro");
    await clickMenuAction("Responsáveis de José Álvaro");
    expect(await screen.findByTestId("sem-responsaveis")).toBeInTheDocument();
  });

  it("adiciona responsável criando o acesso (POST /students/:id/guardians com createAccount)", async () => {
    const calls = mockApi({
      ...guardianRoutes([]),
      "POST /students/2/guardians": () => json(201, { guardian: guardianWithAccess, linkedExistingUser: false }),
    });
    renderPage(<AlunosPage />);
    await screen.findByText("José Álvaro");
    await clickMenuAction("Responsáveis de José Álvaro");
    await screen.findByTestId("sem-responsaveis");
    fireEvent.click(screen.getByRole("button", { name: /Adicionar responsável/ }));

    const dialog = await screen.findByRole("dialog", { name: "Novo responsável" });
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Paulo Pai" } });
    fireEvent.change(within(dialog).getByLabelText("Parentesco"), { target: { value: "Pai" } });
    fireEvent.change(within(dialog).getByLabelText("E-mail"), { target: { value: "paulo@x.com" } });
    expect(within(dialog).queryByLabelText("Senha provisória")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.change(await within(dialog).findByLabelText("Senha provisória"), { target: { value: TEMP } });
    fireEvent.change(within(dialog).getByLabelText("Confirmar senha provisória"), { target: { value: TEMP } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.path).toBe("/students/2/guardians");
    expect(post.body).toEqual({ name: "Paulo Pai", relationship: "Pai", email: "paulo@x.com", createAccount: true, password: TEMP });
    expect(Object.keys(post.body as object)).not.toContain("consentPublicProfile");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Responsável cadastrado."));
  });

  it("senha fraca com 'criar acesso' bloqueia o envio", async () => {
    const calls = mockApi(guardianRoutes([]));
    renderPage(<AlunosPage />);
    await screen.findByText("José Álvaro");
    await clickMenuAction("Responsáveis de José Álvaro");
    await screen.findByTestId("sem-responsaveis");
    fireEvent.click(screen.getByRole("button", { name: /Adicionar responsável/ }));
    const dialog = await screen.findByRole("dialog", { name: "Novo responsável" });
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Paulo Pai" } });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.change(await within(dialog).findByLabelText("Senha provisória"), { target: { value: "Dev@12345" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText("Informe o e-mail para criar o acesso.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("edita (PATCH com null nos opcionais esvaziados) e remove (DELETE) após confirmar", async () => {
    const calls = mockApi({
      ...guardianRoutes(),
      "PATCH /students/2/guardians/5": () => json(200, guardianNoAccess),
      "DELETE /students/2/guardians/6": () => new Response(null, { status: 204 }),
    });
    renderPage(<AlunosPage />);
    await screen.findByText("José Álvaro");
    await clickMenuAction("Responsáveis de José Álvaro");
    await screen.findByTestId("responsavel-5");

    fireEvent.click(screen.getByRole("button", { name: "Editar Maria Mãe" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar responsável" });
    await waitFor(() => expect(within(dialog).getByLabelText("Nome")).toHaveValue("Maria Mãe"));
    fireEvent.change(within(dialog).getByLabelText("Telefone"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({
      path: "/students/2/guardians/5",
      body: { name: "Maria Mãe", relationship: "Mãe", phone: null, email: "maria@x.com" },
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Editar responsável" })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Remover Paulo Pai" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/será despublicado/)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(calls.find((c) => c.method === "DELETE")!.path).toBe("/students/2/guardians/6");
  });

  it("criar acesso e redefinir senha de um responsável existente", async () => {
    const calls = mockApi({
      ...guardianRoutes(),
      "POST /students/2/guardians/5/account": () => json(201, { guardian: guardianWithAccess, linkedExistingUser: false }),
      "POST /students/2/guardians/6/reset-password": () => new Response(null, { status: 204 }),
    });
    renderPage(<AlunosPage />);
    await screen.findByText("José Álvaro");
    await clickMenuAction("Responsáveis de José Álvaro");
    await screen.findByTestId("responsavel-5");
    expect(screen.queryByRole("button", { name: "Criar acesso de Paulo Pai" })).not.toBeInTheDocument(); // já tem
    expect(screen.queryByRole("button", { name: "Redefinir senha de Maria Mãe" })).not.toBeInTheDocument(); // ainda não tem

    fireEvent.click(screen.getByRole("button", { name: "Criar acesso de Maria Mãe" }));
    const create = await screen.findByRole("dialog", { name: "Criar acesso do responsável" });
    expect(within(create).getByLabelText("E-mail de acesso")).toHaveValue("maria@x.com");
    fireEvent.change(within(create).getByLabelText("Senha provisória"), { target: { value: TEMP } });
    fireEvent.change(within(create).getByLabelText("Confirmar senha provisória"), { target: { value: TEMP } });
    fireEvent.click(within(create).getByRole("button", { name: "Criar acesso" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      path: "/students/2/guardians/5/account",
      body: { email: "maria@x.com", password: TEMP },
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Criar acesso do responsável" })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha de Paulo Pai" }));
    const reset = await screen.findByRole("dialog", { name: "Redefinir senha do responsável" });
    fireEvent.change(within(reset).getByLabelText("Senha provisória"), { target: { value: TEMP } });
    fireEvent.change(within(reset).getByLabelText("Confirmar senha provisória"), { target: { value: TEMP } });
    fireEvent.click(within(reset).getByRole("button", { name: "Redefinir senha" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(2));
    expect(calls.filter((c) => c.method === "POST")[1]).toMatchObject({
      path: "/students/2/guardians/6/reset-password",
      body: { newPassword: TEMP },
    });
  });
});

describe("ProfessoresPage - redefinir senha", () => {
  const teachers = [
    { id: 10, role: "MESTRE", status: "ACTIVE", user: { id: 1, name: "Mestre Bimba", email: "bimba@x.com", phone: null } },
    { id: 11, role: "PROFESSOR", status: "ACTIVE", user: { id: 2, name: "Pastinha", email: "pastinha@x.com", phone: null } },
    { id: 12, role: "PROFESSOR", status: "INACTIVE", user: { id: 3, name: "Inativo", email: "i@x.com", phone: null } },
  ];
  const routes = () => ({ "GET /teachers": () => json(200, teachers, { "X-Total-Count": "3" }) });

  it("só aparece para PROFESSOR ativo (Mestre e inativo não) e envia POST /teachers/:id/reset-password", async () => {
    const calls = mockApi({ ...routes(), "POST /teachers/11/reset-password": () => new Response(null, { status: 204 }) });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Pastinha");
    await expectMenuAction("Redefinir senha de Pastinha");
    expect(queryMenuAction(/Redefinir senha de (?!Pastinha)/)).toBeNull(); // Mestre e inativo não têm a ação
    await clickMenuAction("Redefinir senha de Pastinha");

    const dialog = await screen.findByRole("dialog", { name: "Redefinir senha do membro da equipe" });
    fireEvent.change(within(dialog).getByLabelText("Senha provisória"), { target: { value: "curta" } });
    fireEvent.change(within(dialog).getByLabelText("Confirmar senha provisória"), { target: { value: "curta" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Redefinir senha" }));
    expect(await within(dialog).findByText(/no mínimo 12/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText("Senha provisória"), { target: { value: TEMP } });
    fireEvent.change(within(dialog).getByLabelText("Confirmar senha provisória"), { target: { value: TEMP } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Redefinir senha" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ path: "/teachers/11/reset-password", body: { newPassword: TEMP } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Senha redefinida")));
  });

  it("PROFESSOR (sem teachers:edit) não vê a ação", async () => {
    loginAs("PROFESSOR");
    mockApi(routes());
    renderPage(<ProfessoresPage />);
    await screen.findByText("Pastinha");
    expect(queryMenuAction(/Redefinir senha de/)).toBeNull();
  });

  it("erro 403/409 do servidor vira toast", async () => {
    mockApi({
      ...routes(),
      "POST /teachers/11/reset-password": () => json(409, { message: "Esta conta também pertence a outro grupo; a senha só pode ser alterada pelo próprio usuário." }),
    });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Pastinha");
    await clickMenuAction("Redefinir senha de Pastinha");
    const dialog = await screen.findByRole("dialog", { name: "Redefinir senha do membro da equipe" });
    fireEvent.change(within(dialog).getByLabelText("Senha provisória"), { target: { value: TEMP } });
    fireEvent.change(within(dialog).getByLabelText("Confirmar senha provisória"), { target: { value: TEMP } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Redefinir senha" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("outro grupo")));
  });
});
