import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { clearSession, loginAs } from "./login-as";
import { AlunosPage } from "@/modules/alunos/alunos-page";
import { ImportarAlunosDialog } from "@/modules/alunos/importar-alunos-dialog";
import { buildTemplateCsv, parseStudentsCsv, type ImportResult } from "@/modules/alunos/students-import";
import { buildCsv, csvCell, parseCsv } from "@/lib/csv";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

type Call = { method: string; path: string; query: URLSearchParams; body: unknown };
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

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  loginAs("MESTRE");
  // jsdom não implementa download por Blob/âncora.
  URL.createObjectURL = vi.fn(() => "blob:teste");
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("CSV: leitura e escrita", () => {
  it("lê CSV do Excel (BOM, ';', aspas, vírgula/TAB também) e escapa fórmulas na escrita", () => {
    expect(parseCsv('﻿Nome;Obs\r\n"Ana; Souza";"disse ""oi""\nlinha 2"\r\n\r\n')).toEqual([
      ["Nome", "Obs"],
      ["Ana; Souza", 'disse "oi"\nlinha 2'],
    ]);
    expect(parseCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+55 11 9")).toBe("'+55 11 9");
    expect(csvCell(12)).toBe("12");
    expect(buildCsv(["A", "B"], [["x;y", null]])).toBe('﻿A;B\r\n"x;y";\r\n');
  });

  it("parseStudentsCsv reconhece colunas do modelo (sem acento/caixa), numera as linhas e avisa colunas desconhecidas", () => {
    const parsed = parseStudentsCsv(
      "﻿NOME;Data de Nascimento;E-mail;Celular;Situação;Apelido\r\nAna Souza;05/03/2010;ana@x.com;(11) 91234-5678;Ativo;Aninha\r\n;;;;;\r\nBeto;;;;;\r\n",
    );
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toEqual([
      { line: 2, name: "Ana Souza", birthDate: "05/03/2010", email: "ana@x.com", phone: "(11) 91234-5678", status: "Ativo" },
      { line: 3, name: "Beto" },
    ]);
    expect(parsed.ignoredColumns).toEqual(["Apelido"]);
    // o modelo para download se lê de volta
    expect(parseStudentsCsv(buildTemplateCsv()).rows).toHaveLength(2);
  });

  it("recusa arquivo sem coluna Nome, só com cabeçalho ou com mais de 500 linhas", () => {
    expect(parseStudentsCsv("E-mail;Telefone\na@x.com;1").error).toMatch(/coluna "Nome"/);
    expect(parseStudentsCsv("Nome\n").error).toMatch(/não tem linhas/);
    const big = "Nome\n" + Array.from({ length: 501 }, (_, i) => `Aluno ${i}`).join("\n");
    expect(parseStudentsCsv(big).error).toMatch(/máximo é 500/);
  });
});

describe("ImportarAlunosDialog", () => {
  const PREVIEW: ImportResult = {
    dryRun: true,
    total: 3,
    created: 1,
    ignored: 1,
    failed: 1,
    plan: { maxStudents: 50, planName: "Básico", activeStudents: 10, availableSlots: 40 },
    items: [
      { line: 2, name: "Ana Souza", action: "CREATE", messages: [] },
      { line: 3, name: "Beto", action: "IGNORE", messages: ["Já existe um aluno com este e-mail."] },
      { line: 4, name: "", action: "ERROR", messages: ["Nome é obrigatório."] },
    ],
  };

  it("lê o arquivo, valida com dryRun, mostra erros por linha e só grava ao confirmar", async () => {
    const calls = mockApi({
      "POST /students/import": (c) => {
        const body = c.body as { dryRun: boolean };
        return json(200, body.dryRun ? PREVIEW : { ...PREVIEW, dryRun: false });
      },
    });
    const onOpenChange = vi.fn();
    renderWithClient(<ImportarAlunosDialog open onOpenChange={onOpenChange} />);

    const file = new File(["Nome;E-mail\nAna Souza;ana@x.com\nBeto;beto@x.com\n;x@x.com\n"], "alunos.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Arquivo CSV"), { target: { files: [file] } });

    expect(await screen.findByTestId("import-preview")).toBeInTheDocument();
    expect(screen.getByTestId("import-created")).toHaveTextContent("1 a criar");
    expect(screen.getByTestId("import-ignored")).toHaveTextContent("1 já existem");
    expect(screen.getByTestId("import-failed")).toHaveTextContent("1 com erro");
    expect(screen.getByText("Nome é obrigatório.")).toBeInTheDocument();
    expect(screen.getByText(/Plano "Básico": 10 de 50/)).toBeInTheDocument();
    // até aqui só a simulação: nada gravado
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect((calls[0]!.body as { dryRun: boolean; rows: unknown[] }).dryRun).toBe(true);
    expect((calls[0]!.body as { rows: unknown[] }).rows).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Importar 1 aluno" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
    expect((calls[1]!.body as { dryRun: boolean }).dryRun).toBe(false);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("arquivo inválido mostra o erro e não chama o servidor; nada a criar mantém o botão desabilitado", async () => {
    const calls = mockApi({
      "POST /students/import": () => json(200, { ...PREVIEW, created: 0, failed: 3, ignored: 0 }),
    });
    renderWithClient(<ImportarAlunosDialog open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Arquivo CSV"), { target: { files: [new File(["E-mail\na@x.com\n"], "x.csv")] } });
    expect(await screen.findByTestId("import-file-error")).toHaveTextContent(/coluna "Nome"/);
    expect(calls).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Arquivo CSV"), { target: { files: [new File(["Nome\nAna\n"], "ok.csv")] } });
    await screen.findByTestId("import-preview");
    expect(screen.getByRole("button", { name: "Importar 0 alunos" })).toBeDisabled();
  });
});

describe("AlunosPage: importar e exportar", () => {
  it("Mestre vê Importar; Exportar CSV baixa do servidor com os filtros atuais (busca/status)", async () => {
    const calls = mockApi({
      "GET /students": () => json(200, [], { "X-Total-Count": "0" }),
      "GET /units": () => json(200, [], { "X-Total-Count": "0" }),
      "GET /students/export.csv": () => new Response("﻿Nome\r\n", { status: 200, headers: { "Content-Type": "text/csv" } }),
    });
    renderWithClient(<AlunosPage />);
    expect(await screen.findByRole("button", { name: /importar/i })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrar por status" }), { target: { value: "INACTIVE" } });
    fireEvent.click(await screen.findByRole("button", { name: /exportar csv/i }));
    await waitFor(() => expect(calls.some((c) => c.path === "/students/export.csv")).toBe(true));
    const exportCall = calls.find((c) => c.path === "/students/export.csv")!;
    expect(exportCall.query.get("status")).toBe("INACTIVE");
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it("Professor não vê Importar (só o Mestre importa), mas pode exportar; erro do servidor vira toast", async () => {
    clearSession();
    loginAs("PROFESSOR");
    mockApi({
      "GET /students": () => json(200, [], { "X-Total-Count": "0" }),
      "GET /units": () => json(200, [], { "X-Total-Count": "0" }),
      "GET /students/export.csv": () => json(403, { message: "Sem permissão." }),
    });
    renderWithClient(<AlunosPage />);
    const exportButton = await screen.findByRole("button", { name: /exportar csv/i });
    expect(screen.queryByRole("button", { name: /^importar$/i })).not.toBeInTheDocument();
    fireEvent.click(exportButton);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Sem permissão."));
  });
});
