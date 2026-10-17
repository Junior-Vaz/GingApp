import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { clearSession, loginAs } from "./login-as";
import { AlunosPage } from "@/modules/alunos/alunos-page";
import { studentToCreatePayload, emptyStudentForm, isValidEmail } from "@/modules/alunos/schema";

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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AlunosPage />
    </QueryClientProvider>,
  );
}

const PASSWORD = "Berimbau-Axe-4821";
const students = [
  { id: 1, unitId: null, name: "Ana Souza", birthDate: null, document: null, phone: null, email: null, status: "ACTIVE", joinedAt: null },
];
const classes = [
  { id: 10, unitId: null, name: "Capoeira Infantil", status: "ACTIVE" },
  { id: 11, unitId: 7, name: "Capoeira Adulto", status: "ACTIVE", unit: { id: 7, name: "Sede Centro" } },
];
const units = [{ id: 7, name: "Sede Centro" }];
const created = (access?: unknown) => json(201, { id: 3, unitId: null, name: "Carlos Lima", phone: "(11) 99999-8888", email: "carlos@x.com", status: "ACTIVE", ...(access ? { access } : {}) });
const createdAccess = { status: "CREATED", email: "carlos@x.com", temporaryPassword: PASSWORD, mustChangePassword: true };

const base = () => ({
  "GET /students": () => json(200, students, { "X-Total-Count": "1" }),
  "GET /classes": () => json(200, classes, { "X-Total-Count": "2" }),
  "GET /units": (c: Call) => {
    const q = (c.query.get("q") ?? "").toLowerCase();
    const found = units.filter((u) => u.name.toLowerCase().includes(q));
    return json(200, found, { "X-Total-Count": String(found.length) });
  },
  "GET /units/7": () => json(200, units[0]),
});

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

/** Abre "Novo aluno" e espera a lista de turmas carregar. */
async function openNew() {
  await screen.findByText("Ana Souza");
  fireEvent.click(screen.getByRole("button", { name: /Novo aluno/ }));
  const sheet = await screen.findByRole("dialog", { name: "Novo aluno" });
  await within(sheet).findByRole("checkbox", { name: /Capoeira Infantil/ });
  return sheet;
}
const type = (sheet: HTMLElement, label: string, value: string) =>
  fireEvent.change(within(sheet).getByLabelText(label), { target: { value } });
const post = (calls: Call[]) => calls.filter((c) => c.method === "POST" && c.path === "/students");

describe("schema do cadastro rápido", () => {
  it("studentToCreatePayload: só manda classIds e createAccess quando há; campos vazios somem", () => {
    const values = { ...emptyStudentForm, name: " Carlos ", email: "c@x.com" };
    expect(studentToCreatePayload(values, { createAccess: false, classIds: [] })).toEqual({ name: "Carlos", email: "c@x.com", status: "ACTIVE" });
    expect(studentToCreatePayload(values, { createAccess: true, classIds: [10, 11] })).toMatchObject({
      name: "Carlos",
      email: "c@x.com",
      createAccess: true,
      classIds: [10, 11],
    });
  });
  it("isValidEmail", () => {
    expect(isValidEmail("a@b.com")).toBe(true);
    expect(isValidEmail(" a@b.com ")).toBe(true);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("xx")).toBe(false);
  });
});

describe("Novo aluno enxuto", () => {
  it("bloco principal visível, 'Mais dados' recolhido (mostra/oculta) e foco automático no Nome", async () => {
    mockApi(base());
    renderPage();
    const sheet = await openNew();
    await waitFor(() => expect(within(sheet).getByLabelText("Nome")).toHaveFocus());
    for (const label of ["Nome", "WhatsApp / Telefone", "E-mail", "Nascimento"]) {
      expect(within(sheet).getByLabelText(label)).toBeVisible();
    }
    expect(within(sheet).getByRole("group", { name: /Turma\(s\)/ })).toBeInTheDocument();
    expect(within(sheet).getByRole("switch", { name: /Criar acesso ao app agora/ })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Cadastrar" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Cadastrar e novo" })).toBeInTheDocument();

    const more = within(sheet).getByRole("button", { name: "Mais dados" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    for (const label of ["CPF", "Código GingApp (se a pessoa já tem)", "Mensalidade (R$)", "Unidade"]) {
      expect(within(sheet).queryByLabelText(label)).not.toBeInTheDocument();
    }
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(within(sheet).getByLabelText("CPF")).toBeVisible();
    expect(within(sheet).getByLabelText("CPF do responsável (para criança sem CPF)")).toBeVisible();
    expect(within(sheet).getByLabelText("Código GingApp (se a pessoa já tem)")).toBeVisible();
    expect(within(sheet).getByLabelText("Mensalidade (R$)")).toBeVisible(); // MESTRE tem finance:edit
    expect(within(sheet).getByLabelText("Unidade")).toBeVisible();
    fireEvent.click(more);
    expect(within(sheet).queryByLabelText("CPF")).not.toBeInTheDocument();
  });

  it("Mensalidade/vencimento só aparecem em 'Mais dados' para quem tem finance:edit", async () => {
    loginAs("PROFESSOR");
    mockApi(base());
    renderPage();
    const sheet = await openNew();
    fireEvent.click(within(sheet).getByRole("button", { name: "Mais dados" }));
    expect(within(sheet).getByLabelText("CPF")).toBeVisible();
    expect(within(sheet).queryByLabelText("Mensalidade (R$)")).not.toBeInTheDocument();
  });

  it("interruptor desabilitado (com dica) sem e-mail válido; liga sozinho quando o e-mail é válido", async () => {
    mockApi(base());
    renderPage();
    const sheet = await openNew();
    const toggle = within(sheet).getByRole("switch", { name: /Criar acesso ao app agora/ });
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
    expect(within(sheet).getByText("Informe um e-mail para criar o acesso.")).toBeInTheDocument();
    type(sheet, "E-mail", "xx");
    expect(toggle).toBeDisabled();
    type(sheet, "E-mail", "carlos@x.com");
    expect(toggle).toBeEnabled();
    expect(toggle).toBeChecked(); // ligado por padrão
    expect(within(sheet).queryByText("Informe um e-mail para criar o acesso.")).not.toBeInTheDocument();
  });

  it("envia createAccess:true + classIds + só os campos preenchidos", async () => {
    const calls = mockApi({ ...base(), "POST /students": () => created() });
    renderPage();
    const sheet = await openNew();
    type(sheet, "Nome", "Carlos Lima");
    type(sheet, "WhatsApp / Telefone", "(11) 99999-8888");
    type(sheet, "E-mail", "carlos@x.com");
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Capoeira Infantil/ }));
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Capoeira Adulto/ }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Cadastrar" }));
    await waitFor(() => expect(post(calls)).toHaveLength(1));
    const body = post(calls)[0]!.body as Record<string, unknown>;
    expect(body).toEqual({
      name: "Carlos Lima",
      phone: "(11) 99999-8888",
      email: "carlos@x.com",
      status: "ACTIVE",
      classIds: [10, 11],
      createAccess: true,
    });
    // sem acesso na resposta: só o toast simples e o sheet fecha
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Aluno cadastrado."));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("interruptor desligado: não manda createAccess; sem turma, não manda classIds", async () => {
    const calls = mockApi({ ...base(), "POST /students": () => created() });
    renderPage();
    const sheet = await openNew();
    type(sheet, "Nome", "Carlos Lima");
    type(sheet, "E-mail", "carlos@x.com");
    fireEvent.click(within(sheet).getByRole("switch", { name: /Criar acesso ao app agora/ }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Cadastrar" }));
    await waitFor(() => expect(post(calls)).toHaveLength(1));
    expect(post(calls)[0]!.body).toEqual({ name: "Carlos Lima", email: "carlos@x.com", status: "ACTIVE" });
  });

  it("erro de validação em campo recolhido (CPF) abre 'Mais dados' e não envia", async () => {
    const calls = mockApi(base());
    renderPage();
    const sheet = await openNew();
    type(sheet, "Nome", "Carlos Lima");
    fireEvent.click(within(sheet).getByRole("button", { name: "Mais dados" }));
    type(sheet, "CPF", "52998224724"); // dígito verificador errado
    fireEvent.click(within(sheet).getByRole("button", { name: "Mais dados" })); // recolhe com o CPF inválido preenchido
    expect(within(sheet).queryByLabelText("CPF")).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Cadastrar" }));
    expect(await within(sheet).findByText(/CPF inválido/)).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Mais dados" })).toHaveAttribute("aria-expanded", "true");
    expect(post(calls)).toHaveLength(0);
  });
});

describe("Acesso criado: cartão de credenciais", () => {
  it("CREATED mostra login, senha, copiar, WhatsApp com 55+dígitos e o aviso; Concluir fecha e a senha some do DOM", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mockApi({ ...base(), "POST /students": () => created(createdAccess) });
    renderPage();
    const sheet = await openNew();
    type(sheet, "Nome", "Carlos Lima");
    type(sheet, "E-mail", "carlos@x.com");
    fireEvent.click(within(sheet).getByRole("button", { name: "Cadastrar" }));

    const card = await screen.findByTestId("credentials-card");
    await waitFor(() => expect(card).toHaveFocus());
    expect(within(card).getByText("Aluno cadastrado")).toBeInTheDocument();
    expect(within(card).getByText("Carlos Lima")).toBeInTheDocument();
    expect(within(card).getByTestId("credentials-email")).toHaveTextContent("carlos@x.com");
    expect(within(card).getByTestId("credentials-password")).toHaveTextContent(PASSWORD);
    expect(within(card).getByText(/Anote agora: a senha não será mostrada de novo/)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Aluno cadastrado.");
    // o formulário foi substituído pelo cartão (nada de "Cadastrar" por cima)
    expect(within(sheet).queryByLabelText("Nome")).not.toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Copiar senha" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PASSWORD));
    fireEvent.click(within(card).getByRole("button", { name: "Copiar login e senha" }));
    const message = `App GingApp: https://app.gingapp.com.br — Login: carlos@x.com — Senha provisória: ${PASSWORD} (você troca no primeiro acesso)`;
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(message));
    // telefone do aluno "(11) 99999-8888" -> wa.me/5511999998888
    expect(within(card).getByRole("link", { name: "Enviar por WhatsApp" })).toHaveAttribute(
      "href",
      `https://wa.me/5511999998888?text=${encodeURIComponent(message)}`,
    );

    fireEvent.click(within(card).getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain(PASSWORD);
  });

  it("'Cadastrar e novo' com CREATED: mostra o cartão ANTES de limpar; 'Cadastrar outro' limpa só a pessoa e mantém turma, unidade e interruptor", async () => {
    const calls = mockApi({ ...base(), "POST /students": () => created(createdAccess) });
    renderPage();
    const sheet = await openNew();
    fireEvent.click(within(sheet).getByRole("button", { name: "Mais dados" }));
    await within(sheet).findByRole("option", { name: "Sede Centro" });
    type(sheet, "Unidade", "7");
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Capoeira Infantil/ }));
    type(sheet, "Nome", "Carlos Lima");
    type(sheet, "WhatsApp / Telefone", "11999998888");
    type(sheet, "E-mail", "carlos@x.com");
    type(sheet, "Nascimento", "2010-02-03");
    fireEvent.click(within(sheet).getByRole("button", { name: "Cadastrar e novo" }));

    const card = await screen.findByTestId("credentials-card");
    expect(within(card).getByTestId("credentials-password")).toHaveTextContent(PASSWORD); // antes de limpar
    expect(post(calls)).toHaveLength(1);
    expect(post(calls)[0]!.body).toMatchObject({ unitId: 7, classIds: [10], createAccess: true, birthDate: "2010-02-03" });

    fireEvent.click(within(card).getByRole("button", { name: "Cadastrar outro" }));
    await waitFor(() => expect(screen.queryByTestId("credentials-card")).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain(PASSWORD);
    const again = screen.getByRole("dialog", { name: "Novo aluno" });
    const nome = within(again).getByLabelText("Nome");
    expect(nome).toHaveValue("");
    await waitFor(() => expect(nome).toHaveFocus());
    expect(within(again).getByLabelText("WhatsApp / Telefone")).toHaveValue("");
    expect(within(again).getByLabelText("E-mail")).toHaveValue("");
    expect(within(again).getByLabelText("Nascimento")).toHaveValue("");
    expect(within(again).getByRole("checkbox", { name: /Capoeira Infantil/ })).toBeChecked(); // turma mantida
    expect(within(again).getByLabelText("Unidade")).toHaveValue("7"); // unidade mantida ("Mais dados" continua aberto)
    type(again, "E-mail", "outro@x.com");
    expect(within(again).getByRole("switch", { name: /Criar acesso ao app agora/ })).toBeChecked(); // interruptor mantido
  });

  it("'Cadastrar e novo' sem acesso: limpa direto (sheet continua aberto) mantendo turma e unidade", async () => {
    const calls = mockApi({ ...base(), "POST /students": () => created() });
    renderPage();
    const sheet = await openNew();
    fireEvent.click(within(sheet).getByRole("button", { name: "Mais dados" }));
    await within(sheet).findByRole("option", { name: "Sede Centro" });
    type(sheet, "Unidade", "7");
    type(sheet, "CPF", "52998224725");
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Capoeira Adulto/ }));
    type(sheet, "Nome", "Carlos Lima");
    type(sheet, "WhatsApp / Telefone", "11999998888");
    fireEvent.click(within(sheet).getByRole("button", { name: "Cadastrar e novo" }));

    await waitFor(() => expect(post(calls)).toHaveLength(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Aluno cadastrado."));
    const nome = within(sheet).getByLabelText("Nome");
    await waitFor(() => expect(nome).toHaveValue(""));
    await waitFor(() => expect(nome).toHaveFocus());
    expect(within(sheet).getByLabelText("WhatsApp / Telefone")).toHaveValue("");
    expect(within(sheet).getByLabelText("CPF")).toHaveValue(""); // CPF é da pessoa: limpa
    expect(within(sheet).getByRole("checkbox", { name: /Capoeira Adulto/ })).toBeChecked();
    expect(within(sheet).getByLabelText("Unidade")).toHaveValue("7");
    expect(screen.getByRole("dialog", { name: "Novo aluno" })).toBeInTheDocument();
  });

  it("LINKED: aviso de que o e-mail já tem login, sem cartão e sem senha", async () => {
    mockApi({ ...base(), "POST /students": () => created({ status: "LINKED", email: "carlos@x.com" }) });
    renderPage();
    const sheet = await openNew();
    type(sheet, "Nome", "Carlos Lima");
    type(sheet, "E-mail", "carlos@x.com");
    fireEvent.click(within(sheet).getByRole("button", { name: "Cadastrar" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Aluno cadastrado.",
        expect.objectContaining({ description: "Este e-mail já tem login no GingApp: o aluno entra com a senha que já tem." }),
      ),
    );
    expect(screen.queryByTestId("credentials-card")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it.each([
    ["SKIPPED_NO_EMAIL", undefined, "Sem e-mail, o acesso ao app não foi criado."],
    ["SKIPPED_NO_PERMISSION", "Seu cargo não cria acessos.", "Seu cargo não cria acessos."],
    ["FAILED", "Falha no servidor de e-mail.", "Falha no servidor de e-mail."],
  ])("%s: avisa com o motivo (aluno cadastrado mesmo assim) e oferece 'Criar acesso depois'", async (status, reason, expected) => {
    mockApi({
      ...base(),
      "POST /students": () => created({ status, ...(reason ? { reason } : {}) }),
      "GET /students/3/account": () => json(200, { hasAccount: false }),
    });
    renderPage();
    const sheet = await openNew();
    type(sheet, "Nome", "Carlos Lima");
    type(sheet, "E-mail", "carlos@x.com");
    fireEvent.click(within(sheet).getByRole("button", { name: "Cadastrar" }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    const [message, options] = vi.mocked(toast.warning).mock.calls[0]!;
    expect(message).toContain("Aluno cadastrado");
    expect(message).toContain(expected);
    expect(screen.queryByTestId("credentials-card")).not.toBeInTheDocument();

    // atalho "Criar acesso depois" abre o diálogo de acesso do aluno recém-cadastrado
    const action = (options as { action: { label: string; onClick: () => void } }).action;
    expect(action.label).toBe("Criar acesso depois");
    action.onClick();
    expect(await screen.findByRole("dialog", { name: "Acesso do aluno" })).toBeInTheDocument();
  });

  it("possível duplicado + 'Cadastrar mesmo assim' reenvia com confirmNew e createAccess, e mostra o cartão", async () => {
    const calls = mockApi({
      ...base(),
      "POST /students": (c) =>
        (c.body as { confirmNew?: boolean }).confirmNew
          ? created(createdAccess)
          : json(409, {
              code: "POSSIBLE_DUPLICATE",
              message: "Encontramos pessoas parecidas.",
              canConfirmNew: true,
              possibleMatches: [{ personId: 77, name: "Carlos Lima Jr", currentGroups: [], currentLevel: null }],
            }),
    });
    renderPage();
    const sheet = await openNew();
    type(sheet, "Nome", "Carlos Lima");
    type(sheet, "E-mail", "carlos@x.com");
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Capoeira Infantil/ }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Cadastrar" }));
    const dialog = await screen.findByRole("dialog", { name: "É a mesma pessoa?" });
    expect(screen.queryByTestId("credentials-card")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cadastrar mesmo assim" }));
    await waitFor(() => expect(post(calls)).toHaveLength(2));
    const [first, second] = post(calls);
    expect(second!.body).toEqual({ ...(first!.body as object), confirmNew: true });
    expect(second!.body).toMatchObject({ createAccess: true, classIds: [10] });
    const card = await screen.findByTestId("credentials-card");
    expect(within(card).getByTestId("credentials-password")).toHaveTextContent(PASSWORD);
  });

  it("falha 400 do servidor mantém o formulário preenchido e sem cartão", async () => {
    mockApi({ ...base(), "POST /students": () => json(400, { message: "Limite de alunos do plano atingido." }) });
    renderPage();
    const sheet = await openNew();
    type(sheet, "Nome", "Carlos Lima");
    fireEvent.click(within(sheet).getByRole("button", { name: "Cadastrar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Limite de alunos do plano atingido."));
    expect(within(sheet).getByLabelText("Nome")).toHaveValue("Carlos Lima");
    expect(screen.queryByTestId("credentials-card")).not.toBeInTheDocument();
  });
});
