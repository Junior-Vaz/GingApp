import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { clearSession, loginAs } from "./login-as";
import { AlunosPage } from "@/modules/alunos/alunos-page";
import { ImportarAlunosDialog } from "@/modules/alunos/importar-alunos-dialog";
import { isValidCpf, maskCpfInput } from "@/lib/cpf";
import { makeStudentSchema, studentSchema, studentToPayload, studentToUpdatePayload } from "@/modules/alunos/schema";
import { parseStudentsCsv, type ImportResult } from "@/modules/alunos/students-import";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
      const call: Call = {
        method,
        path,
        query: new URLSearchParams(search),
        body: init.body ? JSON.parse(init.body as string) : undefined,
      };
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

const VALID_CPF = "529.982.247-25";
const students = [
  { id: 1, unitId: null, name: "Ana Souza", birthDate: "1990-05-10T00:00:00.000Z", document: null, phone: null, email: null, status: "ACTIVE", joinedAt: null },
];
const base = () => ({
  "GET /students": () => json(200, students, { "X-Total-Count": "1" }),
  "GET /units": () => json(200, [], { "X-Total-Count": "0" }),
});

const PREVIEW = {
  personId: 77,
  name: "Joana Mestra",
  nickname: "Jojo",
  photo: null,
  currentGroups: [{ id: 3, name: "Grupo Outro Axé", logoUrl: null }],
  currentLevel: { name: "Corda Verde e Amarela", style: "BRAIDED", colors: ["#16a34a", "#facc15"] },
};

beforeEach(() => {
  localStorage.setItem("painel:alunos:view", "table");
  loginAs("MESTRE");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

/** Abre "Novo aluno", preenche o nome e salva; devolve o formulário (sheet). */
async function submitNewStudent(name = "Joana Mestra") {
  await screen.findByText("Ana Souza");
  fireEvent.click(screen.getByRole("button", { name: /Novo aluno/ }));
  const sheet = await screen.findByRole("dialog");
  fireEvent.change(within(sheet).getByLabelText("Nome"), { target: { value: name } });
  fireEvent.click(within(sheet).getByRole("button", { name: "Salvar" }));
  return sheet;
}

describe("CPF no schema do aluno", () => {
  it("valida dígitos verificadores, com ou sem máscara, e aceita vazio", () => {
    expect(isValidCpf(VALID_CPF)).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("123")).toBe(false);
    expect(maskCpfInput("52998224725")).toBe(VALID_CPF);

    const ok = { name: "Ab", unitId: "", birthDate: "", document: "", phone: "", email: "", status: "ACTIVE" as const };
    expect(studentSchema.safeParse(ok).success).toBe(true);
    expect(studentSchema.safeParse({ ...ok, document: VALID_CPF }).success).toBe(true);
    expect(studentSchema.safeParse({ ...ok, document: "529.982.247-24" }).success).toBe(false);
  });

  it("CPF do responsável exige CPF válido e data de nascimento", () => {
    const ok = { name: "Ab", unitId: "", birthDate: "", document: "", phone: "", email: "", status: "ACTIVE" as const };
    expect(studentSchema.safeParse({ ...ok, guardianDocument: VALID_CPF }).success).toBe(false);
    expect(studentSchema.safeParse({ ...ok, guardianDocument: VALID_CPF, birthDate: "2015-01-01" }).success).toBe(true);
    expect(studentSchema.safeParse({ ...ok, guardianDocument: "123", birthDate: "2015-01-01" }).success).toBe(false);
    expect(studentToPayload({ ...ok, gingappCode: " ging-7k3q-9xpm " })).toMatchObject({ gingappCode: "GING-7K3Q-9XPM" });
  });

  it("edição: documento (mascarado) não alterado NÃO bloqueia e NÃO é reenviado; alterado, valida e vai no corpo", () => {
    const edit = makeStudentSchema("***.***.***-25");
    const values = { name: "Ab", unitId: "", birthDate: "", document: "", phone: "", email: "", status: "ACTIVE" as const };
    expect(edit.safeParse(values).success).toBe(true);
    expect(studentToUpdatePayload(values, "***.***.***-25")).not.toHaveProperty("document");
    // se o valor mascarado voltar no campo, continua "não alterado": a chave não vai no PATCH
    expect(edit.safeParse({ ...values, document: "***.***.***-25" }).success).toBe(true);
    expect(studentToUpdatePayload({ ...values, document: "***.***.***-25" }, "***.***.***-25")).not.toHaveProperty("document");
    // CPF novo digitado: valida e é enviado
    expect(edit.safeParse({ ...values, document: "529.982.247-24" }).success).toBe(false);
    expect(studentToUpdatePayload({ ...values, document: VALID_CPF }, "***.***.***-25")).toMatchObject({ document: VALID_CPF });
  });
});

describe("Cadastro de aluno: conflitos de pessoa existente", () => {
  it("campo CPF mascarado; CPF inválido bloqueia o envio", async () => {
    const calls = mockApi(base());
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: /Novo aluno/ }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText("Nome"), { target: { value: "Carlos Lima" } });
    fireEvent.change(within(sheet).getByLabelText("CPF"), { target: { value: "52998224724" } });
    expect(within(sheet).getByLabelText("CPF")).toHaveValue("529.982.247-24");
    fireEvent.click(within(sheet).getByRole("button", { name: "Salvar" }));
    expect(await within(sheet).findByText(/CPF inválido/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("PERSON_EXISTS_ELSEWHERE: mostra o preview (nome, apelido, grupo, corda) e NÃO cria nada", async () => {
    const calls = mockApi({
      ...base(),
      "POST /students": () =>
        json(409, {
          statusCode: 409,
          error: "Conflict",
          code: "PERSON_EXISTS_ELSEWHERE",
          message: "Esta pessoa já tem ficha em outro grupo.",
          transferAvailable: false,
          person: PREVIEW,
        }),
    });
    renderPage(<AlunosPage />);
    await submitNewStudent();
    const dialog = await screen.findByRole("dialog", { name: /já tem ficha em outro grupo/i });
    const preview = within(dialog).getByTestId("person-preview");
    expect(preview).toHaveTextContent("Joana Mestra");
    expect(preview).toHaveTextContent("Jojo");
    expect(preview).toHaveTextContent("Grupo Outro Axé");
    expect(preview).toHaveTextContent("Corda Verde e Amarela");
    expect(within(preview).getByRole("img", { name: /trançada/i })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/transferência não está disponível/);
    expect(within(dialog).queryByRole("button", { name: "Solicitar transferência" })).not.toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalledWith("Aluno cadastrado.");
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Fechar" })[0]!);
    await waitFor(() => expect(screen.queryByText(/já tem ficha em outro grupo/i)).not.toBeInTheDocument());
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("POSSIBLE_DUPLICATE: 'Cadastrar mesmo assim' reenvia o MESMO corpo com confirmNew:true", async () => {
    const calls = mockApi({
      ...base(),
      "POST /students": (c) =>
        (c.body as { confirmNew?: boolean }).confirmNew
          ? json(201, { id: 5, name: "Joana Mestra", person: { id: 78, gingappCode: "GING-AAAA-BBBB" } })
          : json(409, {
              statusCode: 409,
              error: "Conflict",
              code: "POSSIBLE_DUPLICATE",
              message: "Encontramos pessoas parecidas.",
              canConfirmNew: true,
              possibleMatches: [PREVIEW],
            }),
    });
    renderPage(<AlunosPage />);
    await submitNewStudent();
    const dialog = await screen.findByRole("dialog", { name: "É a mesma pessoa?" });
    expect(within(dialog).getByTestId("person-preview")).toHaveTextContent("Joana Mestra");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cadastrar mesmo assim" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(2));
    const [first, second] = calls.filter((c) => c.method === "POST");
    expect(first!.body).not.toHaveProperty("confirmNew");
    expect(second!.body).toEqual({ ...(first!.body as object), confirmNew: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Aluno cadastrado."));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("POSSIBLE_DUPLICATE: 'É a mesma pessoa' oferece a transferência e não cria", async () => {
    const calls = mockApi({
      ...base(),
      "POST /students": () =>
        json(409, { code: "POSSIBLE_DUPLICATE", message: "x", canConfirmNew: true, possibleMatches: [PREVIEW] }),
    });
    renderPage(<AlunosPage />);
    await submitNewStudent();
    const dialog = await screen.findByRole("dialog", { name: "É a mesma pessoa?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "É a mesma pessoa" }));
    expect(await screen.findByText(/solicite a transferência/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Solicitar transferência de Joana Mestra" })).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("PERSON_ALREADY_IN_GROUP: avisa e abre o cadastro existente para editar", async () => {
    const calls = mockApi({
      ...base(),
      "POST /students": () =>
        json(409, { code: "PERSON_ALREADY_IN_GROUP", message: "Pessoa já matriculada.", studentId: 9, studentStatus: "INACTIVE" }),
      "GET /students/9": () =>
        json(200, { id: 9, unitId: null, name: "Joana Antiga", birthDate: null, document: null, phone: null, email: null, status: "INACTIVE", joinedAt: null }),
    });
    renderPage(<AlunosPage />);
    await submitNewStudent();
    const dialog = await screen.findByRole("dialog", { name: /já está cadastrada no seu grupo/i });
    expect(dialog).toHaveTextContent("Inativo");
    fireEvent.click(within(dialog).getByRole("button", { name: /Abrir cadastro/ }));
    await waitFor(() => expect(calls.some((c) => c.path === "/students/9")).toBe(true));
    const sheet = await screen.findByRole("dialog", { name: "Editar aluno" });
    await waitFor(() => expect(within(sheet).getByLabelText("Nome")).toHaveValue("Joana Antiga"));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("400 INVALID_CPF do servidor vira toast claro e o formulário continua aberto", async () => {
    mockApi({
      ...base(),
      "POST /students": () => json(400, { code: "INVALID_CPF", message: "CPF inválido." }),
    });
    renderPage(<AlunosPage />);
    await submitNewStudent();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/CPF inválido/)));
    expect(screen.getByRole("dialog", { name: "Novo aluno" })).toBeInTheDocument();
  });

  it("edição: 409 do PATCH mostra a mensagem do backend", async () => {
    mockApi({
      ...base(),
      "PATCH /students/1": () =>
        json(409, { code: "DOCUMENT_BELONGS_TO_OTHER_PERSON", message: "Este CPF pertence a outra pessoa." }),
    });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    const sheet = await screen.findByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText("CPF"), { target: { value: VALID_CPF } });
    expect(within(sheet).queryByLabelText(/CPF do responsável/)).not.toBeInTheDocument(); // só no cadastro
    fireEvent.click(within(sheet).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Este CPF pertence a outra pessoa."));
  });
});

describe("Ficha única do aluno", () => {
  const FICHA = {
    person: {
      id: 10,
      gingappCode: "GING-7K3Q-9XPM",
      name: "Ana Souza",
      nickname: "Aninha",
      birthDate: "1990-05-10T00:00:00.000Z",
      photo: null,
      documentMasked: "***.***.***-25",
      documentKind: "CPF",
    },
    enrollments: [
      { studentId: 1, organization: { id: 1, name: "Ginga Brasil", logoUrl: null }, unit: { id: 7, name: "Sede" }, status: "ACTIVE", since: "2024-02-01T00:00:00.000Z", until: null, isCurrent: true },
    ],
    graduations: [
      { id: 1, studentId: 1, organization: { id: 1, name: "Ginga Brasil" }, graduatedAt: "2025-03-01T00:00:00.000Z", level: { id: 4, name: "Corda Azul", order: 4, color: "#2563eb", style: "SOLID", colors: ["#2563eb"] }, system: { id: 1, name: "Sistema Padrão" } },
    ],
    attendanceByGroup: [{ organization: { id: 1, name: "Ginga Brasil" }, present: 20, absent: 3, total: 23 }],
    certificates: [{ id: 1, title: "Batizado 2025", issuedAt: "2025-03-01T00:00:00.000Z", verificationCode: "ABC123", organization: { id: 1, name: "Ginga Brasil" } }],
    sharedFromOtherGroups: [],
    scope: "OWN_GROUP",
  };

  it("botão Ficha abre o diálogo com o código GingApp, CPF mascarado, matrículas, graduação, presença e certificado", async () => {
    mockApi({ ...base(), "GET /students/1/ficha": () => json(200, FICHA) });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: "Ficha de Ana Souza" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByTestId("ficha-code")).toHaveTextContent("GING-7K3Q-9XPM");
    expect(within(dialog).getByTestId("ficha-document")).toHaveTextContent("***.***.***-25");
    expect(within(dialog).getByRole("button", { name: "Copiar código GingApp" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Ginga Brasil");
    expect(dialog).toHaveTextContent("Corda Azul");
    expect(dialog).toHaveTextContent("20 presenças");
    expect(dialog).toHaveTextContent("Batizado 2025");
  });

  it("seções sem dados mostram o texto de vazio (cargos, graduações, presença, certificados)", async () => {
    mockApi({
      ...base(),
      "GET /students/1/ficha": () =>
        json(200, { ...FICHA, enrollments: [], roles: [], graduations: [], attendanceByGroup: [], certificates: [] }),
    });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: "Ficha de Ana Souza" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByTestId("ficha-code");
    expect(dialog).toHaveTextContent("Nenhum cargo registrado.");
    expect(dialog).toHaveTextContent("Nenhuma graduação registrada.");
    expect(dialog).toHaveTextContent("Nenhuma presença registrada.");
    expect(dialog).toHaveTextContent("Nenhum certificado emitido.");
  });

  it("se a rota falhar, mostra a mensagem de erro no diálogo e a página continua de pé", async () => {
    mockApi({ ...base(), "GET /students/1/ficha": () => json(500, { message: "Falha ao montar a ficha." }) });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: "Ficha de Ana Souza" }));
    expect(await screen.findByTestId("ficha-error")).toHaveTextContent("Falha ao montar a ficha.");
    fireEvent.click(screen.getAllByRole("button", { name: "Fechar" })[0]!);
    await waitFor(() => expect(screen.queryByTestId("ficha-error")).not.toBeInTheDocument());
    expect(screen.getByText("Ana Souza")).toBeInTheDocument();
  });

  it("histórico de outros grupos (compartilhado após transferência): grupo, período, corda, frequência por turma e certificado; matrícula mostra 'até'", async () => {
    const shared = {
      shareId: 1,
      organization: { id: 3, name: "Grupo Antigo Axé", logoUrl: null },
      studentId: 40,
      since: "2022-01-10T00:00:00.000Z",
      until: "2024-01-31T00:00:00.000Z",
      leftReason: "Mudança de cidade",
      sharedAt: "2026-10-01T12:00:00.000Z",
      graduations: [
        { id: 9, graduatedAt: "2023-06-01T00:00:00.000Z", level: { id: 2, name: "Corda Verde e Amarela", order: 2, color: "#16a34a", style: "BRAIDED", colors: ["#16a34a", "#facc15"] }, system: { id: 5, name: "Sistema Antigo" } },
      ],
      attendanceByClass: [{ class: { id: 8, name: "Turma Noite" }, present: 30, absent: 4, total: 34 }],
      certificates: [{ id: 3, title: "Batizado Antigo", issuedAt: "2023-06-01T00:00:00.000Z" }],
    };
    const ficha = {
      ...FICHA,
      enrollments: [
        ...FICHA.enrollments,
        { studentId: 40, organization: { id: 3, name: "Grupo Antigo Axé", logoUrl: null }, unit: null, status: "FORMER", since: "2022-01-10T00:00:00.000Z", until: "2024-01-31T00:00:00.000Z", isCurrent: false },
      ],
      sharedFromOtherGroups: [shared],
    };
    mockApi({ ...base(), "GET /students/1/ficha": () => json(200, ficha) });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: "Ficha de Ana Souza" }));
    const dialog = await screen.findByRole("dialog");
    const section = await within(dialog).findByTestId("ficha-shared");
    expect(section).toHaveTextContent("Histórico de outros grupos (compartilhado após transferência)");
    expect(section).toHaveTextContent("Grupo Antigo Axé");
    expect(section).toHaveTextContent("Mudança de cidade");
    expect(section).toHaveTextContent("Corda Verde e Amarela");
    expect(within(section).getByRole("img", { name: /trançada/i })).toBeInTheDocument();
    expect(section).toHaveTextContent("Turma Noite");
    expect(section).toHaveTextContent("30 presenças");
    expect(section).toHaveTextContent("Batizado Antigo");
    expect(dialog).toHaveTextContent("até 31/01/2024");
  });

  it("sem histórico compartilhado, a seção não aparece", async () => {
    mockApi({ ...base(), "GET /students/1/ficha": () => json(200, FICHA) });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: "Ficha de Ana Souza" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByTestId("ficha-content");
    expect(within(dialog).queryByTestId("ficha-shared")).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("Histórico de outros grupos");
  });
});

describe("Transferência: pedido a partir do cadastro", () => {
  const elsewhere = () =>
    json(409, {
      statusCode: 409,
      error: "Conflict",
      code: "PERSON_EXISTS_ELSEWHERE",
      message: "Esta pessoa já tem ficha em outro grupo.",
      transferAvailable: true,
      transfer: { method: "POST", path: "/api/transfers", body: { personId: 77 } },
      person: PREVIEW,
    });
  const transferView = { id: 31, status: "PENDING_PERSON", direction: "SENT" };

  it("'Solicitar transferência' abre o mini-formulário e envia POST /transfers {personId, note}; sucesso mostra o aviso e fecha tudo", async () => {
    const calls = mockApi({
      ...base(),
      "POST /students": () => elsewhere(),
      "POST /transfers": () => json(201, transferView),
    });
    renderPage(<AlunosPage />);
    await submitNewStudent();
    const dialog = await screen.findByRole("dialog", { name: /já tem ficha em outro grupo/i });
    expect(dialog).toHaveTextContent(/solicite a transferência/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Solicitar transferência" }));

    const form = await screen.findByTestId("transfer-request-form");
    fireEvent.change(within(form).getByLabelText("Observação (opcional)"), { target: { value: "  Combinado na aula  " } });
    fireEvent.click(within(form).getByRole("button", { name: "Enviar pedido" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/transfers")).toBe(true));
    const post = calls.find((c) => c.path === "/transfers")!;
    expect(post.body).toEqual({ personId: 77, note: "Combinado na aula" });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Pedido enviado; a pessoa (ou responsável) precisa aprovar no app."),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // nenhum aluno foi criado: só o POST /students original (409) e o POST /transfers
    expect(calls.filter((c) => c.method === "POST" && c.path === "/students")).toHaveLength(1);
  });

  it("FROM_ORGANIZATION_REQUIRED: deixa escolher o grupo de origem e reenvia com fromOrganizationId", async () => {
    const calls = mockApi({
      ...base(),
      "POST /students": () => elsewhere(),
      "POST /transfers": (c) =>
        (c.body as { fromOrganizationId?: number }).fromOrganizationId
          ? json(200, transferView)
          : json(400, {
              code: "FROM_ORGANIZATION_REQUIRED",
              message: "Informe o grupo de origem.",
              organizations: [
                { id: 3, name: "Grupo Outro Axé" },
                { id: 4, name: "Grupo Terceiro" },
              ],
            }),
    });
    renderPage(<AlunosPage />);
    await submitNewStudent();
    const dialog = await screen.findByRole("dialog", { name: /já tem ficha em outro grupo/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Solicitar transferência" }));
    const form = await screen.findByTestId("transfer-request-form");
    fireEvent.click(within(form).getByRole("button", { name: "Enviar pedido" }));

    const select = await within(form).findByLabelText("Grupo de origem");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Selecione…", "Grupo Outro Axé", "Grupo Terceiro"]);
    fireEvent.click(within(form).getByRole("button", { name: "Enviar pedido" })); // sem escolher: não reenvia
    expect(await within(form).findByText("Escolha o grupo de origem da pessoa.")).toBeInTheDocument();
    expect(calls.filter((c) => c.path === "/transfers")).toHaveLength(1);

    fireEvent.change(select, { target: { value: "4" } });
    fireEvent.click(within(form).getByRole("button", { name: "Enviar pedido" }));
    await waitFor(() => expect(calls.filter((c) => c.path === "/transfers")).toHaveLength(2));
    expect(calls.filter((c) => c.path === "/transfers")[1]!.body).toEqual({ personId: 77, fromOrganizationId: 4 });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Pedido enviado/)));
  });

  it("erro do pedido (409 PERSON_ALREADY_IN_GROUP) aparece no formulário, que continua aberto", async () => {
    mockApi({
      ...base(),
      "POST /students": () => elsewhere(),
      "POST /transfers": () => json(409, { code: "PERSON_ALREADY_IN_GROUP", message: "x", studentId: 9, studentStatus: "ACTIVE" }),
    });
    renderPage(<AlunosPage />);
    await submitNewStudent();
    const dialog = await screen.findByRole("dialog", { name: /já tem ficha em outro grupo/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Solicitar transferência" }));
    const form = await screen.findByTestId("transfer-request-form");
    fireEvent.click(within(form).getByRole("button", { name: "Enviar pedido" }));
    expect(await within(form).findByTestId("transfer-error")).toHaveTextContent(/já está matriculada no seu grupo/);
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("Edição de aluno com CPF mascarado", () => {
  const masked = { id: 1, unitId: null, name: "Ana Souza", birthDate: "1990-05-10T00:00:00.000Z", document: "***.***.***-25", phone: null, email: null, status: "ACTIVE", joinedAt: null };
  const withMasked = () => ({ ...base(), "GET /students": () => json(200, [masked], { "X-Total-Count": "1" }) });

  it("mostra o CPF mascarado somente leitura e NÃO reenvia o documento no PATCH", async () => {
    const calls = mockApi({ ...withMasked(), "PATCH /students/1": () => json(200, {}) });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByTestId("student-document-masked")).toHaveTextContent("***.***.***-25");
    expect(within(sheet).queryByLabelText("CPF")).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).not.toHaveProperty("document");
  });

  it("'Alterar CPF' libera o campo; o CPF novo vai no PATCH", async () => {
    const calls = mockApi({ ...withMasked(), "PATCH /students/1": () => json(200, {}) });
    renderPage(<AlunosPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Alterar CPF" }));
    const input = within(sheet).getByLabelText("CPF");
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "52998224725" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ document: VALID_CPF });
  });
});

describe("Importação: CPF do responsável, código GingApp e possíveis duplicados", () => {
  it("reconhece as colunas novas (com e sem acento / underscore)", () => {
    const parsed = parseStudentsCsv("Nome;CPF do responsável;Código GingApp\nAna;529.982.247-25;GING-7K3Q-9XPM\n");
    expect(parsed.rows).toEqual([{ line: 2, name: "Ana", guardianDocument: "529.982.247-25", gingappCode: "GING-7K3Q-9XPM" }]);
    const snake = parseStudentsCsv("nome,cpf_responsavel,codigo_gingapp\nBeto,52998224725,GING-AAAA-BBBB\n");
    expect(snake.rows[0]).toMatchObject({ guardianDocument: "52998224725", gingappCode: "GING-AAAA-BBBB" });
    expect(snake.ignoredColumns).toEqual([]);
  });

  const DRY: ImportResult = {
    dryRun: true,
    total: 3,
    created: 1,
    ignored: 1,
    failed: 1,
    plan: null,
    items: [
      { line: 2, name: "Ana", action: "CREATE", messages: [] },
      { line: 3, name: "Beto", action: "IGNORE", code: "PERSON_ALREADY_IN_GROUP", messages: ["Já matriculado."] },
      { line: 4, name: "Caio", action: "ERROR", code: "POSSIBLE_DUPLICATE", messages: ["Parece com outra pessoa."] },
    ],
  };

  it("mostra o code por linha e 'Importar mesmo assim os possíveis duplicados' reenvia com confirmNew:true", async () => {
    const calls = mockApi({
      "POST /students/import": (c) => {
        const body = c.body as { dryRun: boolean; confirmNew?: boolean };
        if (body.confirmNew) {
          return json(200, {
            ...DRY,
            dryRun: body.dryRun,
            created: 2,
            failed: 0,
            items: DRY.items.map((i) => (i.line === 4 ? { ...i, action: "CREATE", messages: [] } : i)),
          });
        }
        return json(200, DRY);
      },
    });
    renderPage(<ImportarAlunosDialog open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Arquivo CSV"), {
      target: { files: [new File(["Nome\nAna\nBeto\nCaio\n"], "alunos.csv", { type: "text/csv" })] },
    });
    await screen.findByTestId("import-preview");
    expect(screen.getByTestId("import-code-3")).toHaveTextContent(/Já está cadastrada no seu grupo/);
    expect(screen.getByTestId("import-code-4")).toHaveTextContent(/Possível duplicado/);

    fireEvent.click(screen.getByRole("checkbox", { name: /Importar mesmo assim os possíveis duplicados/ }));
    await waitFor(() => expect(screen.getByTestId("import-created")).toHaveTextContent("2 a criar"));
    const dry = calls.filter((c) => c.method === "POST").at(-1)!;
    expect(dry.body).toMatchObject({ dryRun: true, confirmNew: true });

    fireEvent.click(screen.getByRole("button", { name: "Importar 2 alunos" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const real = calls.filter((c) => c.method === "POST").at(-1)!;
    expect(real.body).toMatchObject({ dryRun: false, confirmNew: true });
  });
});
