import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { CertificadosPage } from "@/modules/certificados/certificados-page";
import { toEditPayload, toIssuePayload, type Certificate } from "@/modules/certificados/certificate-utils";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const certs: Certificate[] = [
  { id: 1, studentId: 1, studentGraduationId: null, title: "Workshop Angola", issuedAt: "2024-03-10T00:00:00.000Z", verificationCode: "cabc123", fileUrl: null, student: { id: 1, name: "Ana Souza" } },
  { id: 2, studentId: 2, studentGraduationId: null, title: "Batizado", issuedAt: "2025-06-01T00:00:00.000Z", verificationCode: "cxyz789", fileUrl: "https://x.com/a.pdf", student: { id: 2, name: "Bia Lima" } },
];

type Call = { method: string; path: string; query: URLSearchParams; body: unknown };
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

const STUDENTS = [
  { id: 1, name: "Ana Souza" },
  { id: 2, name: "Bia Lima" },
];

/** Busca no servidor: filtra por q (como o backend) e devolve o total no header. */
const studentsRoute = (c: Call) => {
  const q = (c.query.get("q") ?? "").toLowerCase();
  const rows = STUDENTS.filter((s) => s.name.toLowerCase().includes(q));
  return json(200, rows, { "X-Total-Count": String(rows.length) });
};

const base = () => ({
  "GET /certificates": () => json(200, certs, { "X-Total-Count": String(certs.length) }),
  "GET /students": studentsRoute,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CertificadosPage />
    </QueryClientProvider>,
  );
}

/** Nomes de aluno tambem aparecem nas <option>s dos selects; as asserções olham só a tabela. */
const inTable = {
  findByText: (t: string) => within(screen.getByRole("table")).findByText(t),
  getByText: (t: string) => within(screen.getByRole("table")).getByText(t),
  queryByText: (t: string) => screen.queryByRole("table") ? within(screen.getByRole("table")).queryByText(t) : null,
};
const lastOf = (calls: Call[], path: string) => calls.filter((c) => c.method === "GET" && c.path === path).at(-1)!;
const mutations = (calls: Call[], method: string) => calls.filter((c) => c.method === method);

describe("certificados utils", () => {
  it("emissao omite vazios; edicao manda fileUrl null ao esvaziar e nunca null em title/issuedAt", () => {
    expect(toIssuePayload({ studentId: "2", title: " T ", issuedAt: "", fileUrl: " " })).toEqual({ studentId: 2, title: "T" });
    expect(toEditPayload({ title: " T ", issuedAt: "2025-01-02", fileUrl: "" })).toEqual({
      title: "T",
      issuedAt: "2025-01-02",
      fileUrl: null,
    });
    const keep = toEditPayload({ title: "T", issuedAt: "", fileUrl: " https://x.com/a.pdf " });
    expect(keep).toEqual({ title: "T", fileUrl: "https://x.com/a.pdf" });
    expect(keep).not.toHaveProperty("issuedAt");
  });
});

describe("CertificadosPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("lista no servidor: data sem deslocar o dia, params iniciais sem filtros vazios", async () => {
    const calls = mockApi(base());
    renderPage();
    await inTable.findByText("Ana Souza");
    expect(screen.getByText("10/03/2024")).toBeInTheDocument();
    const list = calls.find((c) => c.path === "/certificates")!;
    expect(list.query.get("limit")).toBe("10");
    expect(list.query.get("offset")).toBe("0");
    for (const k of ["studentId", "from", "to", "q"]) expect(list.query.has(k)).toBe(false);
    expect(screen.getByTestId("table-count")).toHaveTextContent("2 registros");
  });

  it("filtros de aluno e emissao e a busca (codigo) vao ao SERVIDOR", async () => {
    const calls = mockApi({
      ...base(),
      "GET /certificates": (c) => {
        const from = c.query.get("from");
        const q = c.query.get("q");
        const rows = certs.filter(
          (x) => (!from || (x.issuedAt ?? "") >= from) && (!q || x.verificationCode.includes(q)),
        );
        return json(200, rows, { "X-Total-Count": String(rows.length) });
      },
    });
    renderPage();
    await inTable.findByText("Ana Souza");

    fireEvent.change(screen.getByLabelText("Emitido de"), { target: { value: "2025-01-01" } });
    await waitFor(() => expect(inTable.queryByText("Ana Souza")).not.toBeInTheDocument());
    expect(inTable.getByText("Bia Lima")).toBeInTheDocument();
    expect(lastOf(calls, "/certificates").query.get("from")).toBe("2025-01-01");

    fireEvent.change(screen.getByLabelText("Emitido até"), { target: { value: "2025-12-31" } });
    // seletor em modo filtro: busca no servidor e só então escolhe o aluno
    fireEvent.change(screen.getByLabelText("Buscar aluno"), { target: { value: "bia" } });
    await waitFor(() => expect(lastOf(calls, "/students").query.get("q")).toBe("bia"));
    await waitFor(() => expect(within(screen.getByLabelText("Filtrar por aluno")).queryByRole("option", { name: "Ana Souza" })).toBeNull());
    fireEvent.change(screen.getByLabelText("Filtrar por aluno"), { target: { value: "2" } });
    await waitFor(() => expect(lastOf(calls, "/certificates").query.get("studentId")).toBe("2"));
    expect(Object.fromEntries(lastOf(calls, "/certificates").query)).toMatchObject({
      from: "2025-01-01",
      to: "2025-12-31",
      studentId: "2",
      limit: "10",
      offset: "0",
    });

    fireEvent.click(screen.getByText("Limpar"));
    expect(screen.getByLabelText("Filtrar por aluno")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "xyz789" } });
    await waitFor(() => expect(lastOf(calls, "/certificates").query.get("q")).toBe("xyz789"));
    expect(lastOf(calls, "/certificates").query.has("from")).toBe(false);
    expect(lastOf(calls, "/certificates").query.has("studentId")).toBe(false);
    await waitFor(() => expect(inTable.queryByText("Ana Souza")).not.toBeInTheDocument());
    expect(inTable.getByText("Bia Lima")).toBeInTheDocument();
  });

  it("pagina no servidor (total do header) e usa offset", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      ...certs[0]!, id: 100 + i, title: `Cert ${String(i + 1).padStart(2, "0")}`, student: { id: 1, name: `Aluno ${i + 1}` },
    }));
    const calls = mockApi({
      ...base(),
      "GET /certificates": (c) => {
        const offset = Number(c.query.get("offset") ?? 0);
        return json(200, many.slice(offset, offset + Number(c.query.get("limit") ?? 50)), { "X-Total-Count": "25" });
      },
    });
    renderPage();
    expect(await screen.findByText("Cert 01")).toBeInTheDocument();
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Próxima página"));
    expect(await screen.findByText("Cert 11")).toBeInTheDocument();
    expect(lastOf(calls, "/certificates").query.get("offset")).toBe("10");
  });

  it("estados de erro e vazio", async () => {
    mockApi({ ...base(), "GET /certificates": () => json(500, { message: "Falhou." }) });
    renderPage();
    expect(await screen.findByTestId("table-error")).toHaveTextContent("Falhou.");
  });

  it("vazio", async () => {
    mockApi({ ...base(), "GET /certificates": () => json(200, [], { "X-Total-Count": "0" }) });
    renderPage();
    expect(await screen.findByTestId("table-empty")).toHaveTextContent("Nenhum certificado emitido ainda.");
  });

  it("mostra código e link de verificação", async () => {
    mockApi(base());
    renderPage();
    await inTable.findByText("Ana Souza");
    fireEvent.click(within(inTable.getByText("Ana Souza").closest("tr")!).getByText("Verificação"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("cert-code")).toHaveTextContent("cabc123");
    expect(within(dialog).getByTestId("cert-link")).toHaveTextContent(/\/verificar\/cabc123$/);
  });

  it("seletor de aluno: busca no servidor (limit=20, nunca limit=200) e sem aviso de lista parcial", async () => {
    const calls = mockApi(base());
    renderPage();
    await inTable.findByText("Ana Souza");
    const studentCalls = () => calls.filter((c) => c.method === "GET" && c.path === "/students");
    await waitFor(() => expect(studentCalls().length).toBeGreaterThan(0));
    for (const c of studentCalls()) expect(c.query.get("limit")).toBe("20");
    fireEvent.click(screen.getByText("Emitir certificado", { selector: "button" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByTestId("students-truncated")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Buscar aluno"), { target: { value: "bia" } });
    await waitFor(() => expect(studentCalls().at(-1)!.query.get("q")).toBe("bia"));
    expect(studentCalls().at(-1)!.query.get("limit")).toBe("20");
    expect(studentCalls().some((c) => c.query.get("limit") === "200")).toBe(false);
  });

  it("valida e emite (POST /certificates, vazios omitidos)", async () => {
    const calls = mockApi({ ...base(), "POST /certificates": () => json(201, { id: 9 }) });
    renderPage();
    await inTable.findByText("Ana Souza");
    fireEvent.click(screen.getByText("Emitir certificado", { selector: "button" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByTestId("students-truncated")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByText("Emitir"));
    expect(await within(dialog).findByText("Selecione o aluno.")).toBeInTheDocument();
    expect(within(dialog).getByText("Informe o título (mínimo 2 caracteres).")).toBeInTheDocument();
    expect(mutations(calls, "POST")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("Aluno"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: " Roda de formatura " } });
    fireEvent.click(within(dialog).getByText("Emitir"));
    await waitFor(() => expect(mutations(calls, "POST")).toHaveLength(1));
    expect(mutations(calls, "POST")[0]!.body).toEqual({ studentId: 2, title: "Roda de formatura" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Certificado emitido."));
  });

  it("emite para um aluno que NAO esta nos 20 primeiros: acha por busca e o payload leva o studentId dele", async () => {
    const calls = mockApi({
      ...base(),
      "GET /students": (c) =>
        c.query.get("q") === "bia"
          ? json(200, [STUDENTS[1]], { "X-Total-Count": "1" })
          : json(200, [STUDENTS[0]], { "X-Total-Count": "300" }),
      "POST /certificates": () => json(201, { id: 9 }),
    });
    renderPage();
    await inTable.findByText("Ana Souza");
    fireEvent.click(screen.getByText("Emitir certificado", { selector: "button" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("option", { name: "Ana Souza" });
    expect(within(dialog).queryByRole("option", { name: "Bia Lima" })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Buscar aluno"), { target: { value: "bia" } });
    fireEvent.change(await within(dialog).findByRole("option", { name: "Bia Lima" }).then(() => within(dialog).getByLabelText("Aluno")), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Formatura" } });
    fireEvent.click(within(dialog).getByText("Emitir"));
    await waitFor(() => expect(mutations(calls, "POST")).toHaveLength(1));
    expect(mutations(calls, "POST")[0]!.body).toEqual({ studentId: 2, title: "Formatura" });
  });

  it("edita (PATCH sem studentId, fileUrl preservado)", async () => {
    const calls = mockApi({ ...base(), "PATCH /certificates/2": () => json(200, {}) });
    renderPage();
    await inTable.findByText("Bia Lima");
    fireEvent.click(within(inTable.getByText("Bia Lima").closest("tr")!).getByText("Editar"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Batizado 2025" } });
    fireEvent.click(within(dialog).getByText("Salvar"));
    await waitFor(() => expect(mutations(calls, "PATCH")).toHaveLength(1));
    expect(mutations(calls, "PATCH")[0]).toMatchObject({ path: "/certificates/2" });
    expect(mutations(calls, "PATCH")[0]!.body).toEqual({
      title: "Batizado 2025",
      issuedAt: "2025-06-01",
      fileUrl: "https://x.com/a.pdf",
    });
  });

  it("esvaziar o link do arquivo envia fileUrl: null (nunca string vazia)", async () => {
    const calls = mockApi({ ...base(), "PATCH /certificates/2": () => json(200, {}) });
    renderPage();
    await inTable.findByText("Bia Lima");
    fireEvent.click(within(inTable.getByText("Bia Lima").closest("tr")!).getByText("Editar"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Link do arquivo"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByText("Salvar"));
    await waitFor(() => expect(mutations(calls, "PATCH")).toHaveLength(1));
    const body = mutations(calls, "PATCH")[0]!.body as Record<string, unknown>;
    expect(body).toEqual({ title: "Batizado", issuedAt: "2025-06-01", fileUrl: null });
    expect(body["fileUrl"]).not.toBe("");
  });

  it("erro 400 do PATCH e exibido ao usuario", async () => {
    const calls = mockApi({
      ...base(),
      "PATCH /certificates/2": () => json(400, { message: ["fileUrl must be a URL address"] }),
    });
    renderPage();
    await inTable.findByText("Bia Lima");
    fireEvent.click(within(inTable.getByText("Bia Lima").closest("tr")!).getByText("Editar"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("Salvar"));
    await waitFor(() => expect(mutations(calls, "PATCH")).toHaveLength(1));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("fileUrl must be a URL address"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("apaga só depois de confirmar", async () => {
    const calls = mockApi({ ...base(), "DELETE /certificates/1": () => json(200, {}) });
    renderPage();
    await inTable.findByText("Ana Souza");
    fireEvent.click(within(inTable.getByText("Ana Souza").closest("tr")!).getByText("Apagar"));
    expect(mutations(calls, "DELETE")).toHaveLength(0);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByText("Apagar"));
    await waitFor(() => expect(mutations(calls, "DELETE")).toHaveLength(1));
    expect(mutations(calls, "DELETE")[0]!.path).toBe("/certificates/1");
  });
});
