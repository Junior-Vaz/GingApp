import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
} from "@tanstack/react-router";
import { toast } from "sonner";
import {
  addField,
  allFields,
  fromDefinition,
  moveField,
  newFieldKey,
  removeField,
  toPayload,
  validateDraft,
} from "@/modules/formularios/builder";
import { FormEditorPage, LeaveGuard } from "@/modules/formularios";
import type { FormDefinition } from "@/modules/formularios/types";
import { clearSession, loginAs } from "./login-as";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const field = (over: Record<string, unknown>) => ({
  sectionId: "s-a",
  helpText: null,
  required: false,
  options: null,
  validation: null,
  showIf: null,
  mapsTo: null,
  ...over,
});

const baseDefinition = (): Record<string, unknown> => ({
  id: "f1",
  slug: "campeonato-varjao",
  slugLocked: false, // rascunho: o slug é provisório até a 1ª publicação
  title: "Campeonato do Varjão",
  intro: "Venha jogar capoeira!",
  bannerUrl: "https://exemplo.com/banner.png",
  status: "DRAFT",
  eventId: 7,
  eventTitle: "Campeonato 2026",
  opensAt: null,
  closesAt: null,
  maxSubmissions: null,
  allowWaitlist: false,
  paymentMode: "NONE",
  priceCents: null, // o backend real devolve null quando gratuito
  pixKey: null,
  pixKeyType: null,
  pixBeneficiary: null,
  requireApproval: true,
  confirmationMessage: null,
  consentText: "Autorizo o uso dos meus dados.",
  consentVersion: 1,
  retentionMonths: 12,
  publicUrl: null, // o backend só devolve o link depois da 1ª publicação
  sections: [
    { id: "s-a", title: "Dados do competidor", description: null },
    { id: "s-b", title: "Termos", description: null },
  ],
  fields: [
    field({
      key: "f_nome0001",
      type: "SHORT_TEXT",
      label: "Nome completo",
      required: true,
      mapsTo: "name",
    }),
    field({
      key: "f_cat00002",
      type: "SINGLE_CHOICE",
      label: "Categoria",
      required: true,
      options: ["Adulto", "Infantil"],
    }),
    field({
      key: "f_resp0003",
      type: "SHORT_TEXT",
      label: "Responsável",
      showIf: { fieldKey: "f_cat00002", equals: "Infantil" },
    }),
    field({
      key: "f_termo004",
      sectionId: "s-b",
      type: "CONSENT",
      label: "Aceito o termo",
      required: true,
    }),
  ],
});

const EVENTS = [{ id: 7, title: "Campeonato 2026" }];
const PUBLIC_URL = "https://app.gingapp.com.br/i/campeonato-varjao";

let calls: Call[];
let definition: Record<string, unknown>;
let overrides: Record<string, () => Response>;
const writeText = vi.fn().mockResolvedValue(undefined);

/** Simula o servidor: o PUT devolve a definição montada a partir do corpo, com ids para as seções novas. */
function echo(body: Record<string, unknown>): Record<string, unknown> {
  const sections = (
    body["sections"] as { id?: string; title: string; description: string | null }[]
  ).map((s, i) => ({
    id: s.id ?? `novo-s${String(i)}`,
    title: s.title,
    description: s.description,
  }));
  const fields = (body["fields"] as ({ sectionIndex: number } & Record<string, unknown>)[]).map(
    ({ sectionIndex, ...rest }) => ({
      ...rest,
      sectionId: sections[sectionIndex]!.id,
    }),
  );
  return { ...definition, ...body, sections, fields };
}

function installFetch() {
  calls = [];
  const handler = (input: string, init?: RequestInit): Response => {
    const [path = "", search = ""] = input.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    calls.push({ method, path, query: new URLSearchParams(search), body });
    const override = overrides[`${method} ${path}`];
    if (override) return override();
    if (method === "GET" && path === "/event-forms/f1") return json(200, definition);
    if (method === "PUT" && path === "/event-forms/f1") {
      definition = echo(body as Record<string, unknown>);
      return json(200, definition);
    }
    if (method === "POST" && path === "/event-forms/f1/open") {
      // 1ª publicação: o servidor troca o slug provisório pelo definitivo e trava (slugLocked)
      definition = {
        ...definition,
        status: "OPEN",
        slug: "campeonato-varjao-k3q9x",
        slugLocked: true,
        publicUrl: "https://app.gingapp.com.br/i/campeonato-varjao-k3q9x",
      };
      return json(200, definition);
    }
    if (method === "POST" && path === "/event-forms/f1/close") {
      definition = { ...definition, status: "CLOSED" };
      return json(200, definition);
    }
    if (method === "GET" && path === "/events") return json(200, EVENTS, { "X-Total-Count": "1" });
    return json(404, { message: "Rota não mockada." });
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => Promise.resolve(handler(input, init))),
  );
}

const sent = (method: string, path: string) =>
  calls.filter((c) => c.method === method && c.path === path);
const puts = () => sent("PUT", "/event-forms/f1");
const lastPut = () =>
  puts().at(-1)!.body as {
    fields: Record<string, unknown>[];
    sections: Record<string, unknown>[];
  } & Record<string, unknown>;

const onBack = vi.fn();
const onDirtyChange = vi.fn();

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FormEditorPage formId="f1" onBack={onBack} onDirtyChange={onDirtyChange} />
    </QueryClientProvider>,
  );
}

const openTab = (name: RegExp | string) => {
  const tab = screen.getByRole("tab", { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
};

async function loaded() {
  renderEditor();
  await screen.findByText("Nome completo");
}

const fieldRow = (label: string) => screen.getByText(label, { selector: "p" }).closest("li")!;

beforeEach(() => {
  loginAs("MESTRE");
  definition = baseDefinition();
  overrides = {};
  onBack.mockClear();
  onDirtyChange.mockClear();
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("Editor - carregamento", () => {
  it("mostra título, situação, banner, seções e campos; nada a salvar no início", async () => {
    await loaded();
    expect(
      screen.getByRole("heading", { level: 1, name: "Campeonato do Varjão" }),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId("editor-bar")).getByText("Rascunho")).toBeInTheDocument();
    expect(screen.getByTestId("editor-banner")).toHaveAttribute(
      "src",
      "https://exemplo.com/banner.png",
    );
    expect(screen.getAllByTestId("builder-section")).toHaveLength(2);
    expect(screen.getAllByTestId("builder-field")).toHaveLength(4);
    expect(screen.getByTestId("builder-counters")).toHaveTextContent(
      "4 de 60 campos · 2 de 12 seções · 0 de 5 envios de arquivo",
    );
    expect(screen.queryByTestId("unsaved-indicator")).toBeNull();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(
      within(fieldRow("Responsável")).getByText(/Só se “Categoria” = Infantil/),
    ).toBeInTheDocument();
    expect(within(fieldRow("Nome completo")).getByText("Ficha: Nome")).toBeInTheDocument();
  });

  it("erro ao carregar mostra a mensagem e 'Tentar de novo'", async () => {
    overrides["GET /event-forms/f1"] = () => json(404, { message: "Não existe." });
    renderEditor();
    expect(await screen.findByTestId("editor-error")).toHaveTextContent(
      "Formulário não encontrado",
    );
    delete overrides["GET /event-forms/f1"];
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Nome completo")).toBeInTheDocument();
  });
});

describe("Editor - construtor de campos", () => {
  it("adiciona um campo (key estável), edita rótulo/validação e salva com PUT usando sectionIndex", async () => {
    await loaded();
    fireEvent.click(screen.getAllByRole("button", { name: "Adicionar campo" })[0]!);
    const picker = await screen.findByTestId("field-type-picker");
    // os 13 tipos, com nome em português
    for (const name of [
      "Texto curto",
      "Texto longo",
      "Número",
      "E-mail",
      "Telefone",
      "CPF",
      "Data",
      "Escolha única",
      "Múltipla escolha",
      "Lista suspensa",
      "Aceite de termo",
      "Envio de arquivo",
      "Texto informativo",
    ]) {
      expect(within(picker).getByRole("button", { name })).toBeInTheDocument();
    }
    fireEvent.click(within(picker).getByRole("button", { name: "Número" }));

    const sheet = await screen.findByTestId("field-sheet");
    const label = within(sheet).getByLabelText("Rótulo (a pergunta)");
    expect(label).toHaveValue("Número");
    fireEvent.change(label, { target: { value: "Idade" } });
    fireEvent.change(within(sheet).getByLabelText("Valor mínimo"), { target: { value: "5" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Concluir" }));

    expect(await screen.findByTestId("unsaved-indicator")).toBeInTheDocument();
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    expect(screen.getByTestId("builder-counters")).toHaveTextContent("5 de 60 campos");

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    const body = lastPut();
    expect(body.fields.map((f) => f["label"])).toEqual([
      "Nome completo",
      "Categoria",
      "Responsável",
      "Idade",
      "Aceito o termo",
    ]);
    expect(body.fields[3]).toEqual({
      key: expect.stringMatching(/^f_[a-z0-9]{8}$/),
      sectionIndex: 0,
      type: "NUMBER",
      label: "Idade",
      helpText: null,
      required: false,
      options: null,
      validation: { min: 5 },
      showIf: null,
      mapsTo: null,
    });
    // as chaves existentes não mudam; seções vão com id; o termo está na 2ª seção
    expect(body.fields.filter((_, i) => i !== 3).map((f) => f["key"])).toEqual([
      "f_nome0001",
      "f_cat00002",
      "f_resp0003",
      "f_termo004",
    ]);
    expect(body.fields[4]!["sectionIndex"]).toBe(1);
    expect(body.sections).toEqual([
      { id: "s-a", title: "Dados do competidor", description: null },
      { id: "s-b", title: "Termos", description: null },
    ]);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Formulário salvo."));
    await waitFor(() => expect(screen.queryByTestId("unsaved-indicator")).toBeNull());

    // a chave gerada continua a mesma depois de salvar e de mexer de novo
    const newKey = body.fields[3]!["key"];
    fireEvent.click(screen.getByRole("button", { name: "Descer Idade" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    // era o último da seção 1: "descer" o leva para o começo da seção 2 (a ordem geral não muda)
    expect(lastPut().fields.map((f) => f["label"])).toEqual([
      "Nome completo",
      "Categoria",
      "Responsável",
      "Idade",
      "Aceito o termo",
    ]);
    expect(lastPut().fields[3]!["key"]).toBe(newKey);
    expect(lastPut().fields[3]!["sectionIndex"]).toBe(1);
  });

  it("reordena com ↑ ↓, passa o campo para a seção vizinha e troca de seção pelo seletor", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Descer Nome completo" }));
    fireEvent.click(screen.getByRole("button", { name: "Subir Aceito o termo" })); // 1º da seção 2 -> fim da seção 1
    expect(screen.getByRole("button", { name: "Subir Categoria" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(lastPut().fields.map((f) => [f["label"], f["sectionIndex"]])).toEqual([
      ["Categoria", 0],
      ["Nome completo", 0],
      ["Responsável", 0],
      ["Aceito o termo", 0],
    ]);

    // pelo painel do campo: seção
    fireEvent.click(screen.getByRole("button", { name: "Editar Aceito o termo" }));
    const sheet = await screen.findByTestId("field-sheet");
    fireEvent.change(within(sheet).getByLabelText("Seção"), { target: { value: "s1" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Concluir" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(lastPut().fields.at(-1)).toMatchObject({ label: "Aceito o termo", sectionIndex: 1 });
  });

  it("os botões das pontas ficam desabilitados (primeiro campo não sobe, último não desce)", async () => {
    await loaded();
    expect(screen.getByRole("button", { name: "Subir Nome completo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Descer Aceito o termo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Descer Nome completo" })).toBeEnabled();
  });

  it("duplica o campo (nova key, mapeamento zerado) e remove com aviso de que as respostas são preservadas", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Duplicar Nome completo" }));
    expect(screen.getAllByTestId("builder-field")).toHaveLength(5);
    expect(screen.getByText("Nome completo (cópia)", { selector: "p" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remover Nome completo (cópia)" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(
      within(confirm).getByText(/respostas já recebidas para este campo são preservadas/),
    ).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Remover" }));
    await waitFor(() =>
      expect(screen.queryByText("Nome completo (cópia)", { selector: "p" })).toBeNull(),
    );
    expect(screen.getAllByTestId("builder-field")).toHaveLength(4);
    // nada foi enviado ao servidor até salvar
    expect(puts()).toHaveLength(0);
  });

  it("duplicar não repete o mapeamento 'Nome' e a key é nova", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Duplicar Nome completo" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    const [original, copy] = lastPut().fields;
    expect(original).toMatchObject({ key: "f_nome0001", mapsTo: "name" });
    expect(copy).toMatchObject({ label: "Nome completo (cópia)", mapsTo: null });
    expect(copy!["key"]).toMatch(/^f_[a-z0-9]{8}$/);
    expect(copy!["key"]).not.toBe("f_nome0001");
  });

  it("remover o campo de que outro depende limpa a condição do dependente", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Remover Categoria" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(
      within(confirm).getByText(/1 campo\(s\) que dependiam dele passam a aparecer sempre/),
    ).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(screen.queryByText("Categoria", { selector: "p" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(lastPut().fields.find((f) => f["key"] === "f_resp0003")).toMatchObject({ showIf: null });
  });

  it("edita opções: adicionar, renomear e reordenar; o painel mostra os limites", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Editar Categoria" }));
    const sheet = await screen.findByTestId("field-sheet");
    expect(within(sheet).getByText(/2 de 40/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Adicionar opção" }));
    fireEvent.change(within(sheet).getByLabelText("Opção 3"), { target: { value: "Master" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Subir opção 3" }));
    expect(within(sheet).getByLabelText("Opção 2")).toHaveValue("Master");
    expect(within(sheet).getByLabelText("Opção 3")).toHaveValue("Infantil");
    expect(within(sheet).getByRole("button", { name: "Subir opção 1" })).toBeDisabled();
    fireEvent.click(within(sheet).getByRole("button", { name: "Concluir" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(lastPut().fields[1]!["options"]).toEqual(["Adulto", "Master", "Infantil"]);
  });

  it("remover uma opção usada na condição bloqueia o salvamento com mensagem clara", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Editar Categoria" }));
    const sheet = await screen.findByTestId("field-sheet");
    fireEvent.click(within(sheet).getByRole("button", { name: "Remover opção 2" })); // some "Infantil" e ficam 1 opção
    fireEvent.click(within(sheet).getByRole("button", { name: "Adicionar opção" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Concluir" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(
      await screen.findByText(/o valor “Infantil” da condição não existe mais nas opções/),
    ).toBeInTheDocument();
    expect(puts()).toHaveLength(0);
  });

  it("define a condição 'mostrar só se' escolhendo o campo anterior e o valor", async () => {
    await loaded();
    fireEvent.click(screen.getAllByRole("button", { name: "Adicionar campo" })[0]!);
    fireEvent.click(
      within(await screen.findByTestId("field-type-picker")).getByRole("button", {
        name: "Texto curto",
      }),
    );
    const sheet = await screen.findByTestId("field-sheet");
    fireEvent.change(within(sheet).getByLabelText("Rótulo (a pergunta)"), {
      target: { value: "Nome do mestre" },
    });
    // só campos ANTERIORES: Nome, Categoria e Responsável
    const condition = within(sheet).getByLabelText("Mostrar este campo");
    expect(within(condition).getAllByRole("option")).toHaveLength(4);
    fireEvent.change(condition, { target: { value: "f_cat00002" } });
    fireEvent.change(within(sheet).getByLabelText("Valor que libera o campo"), {
      target: { value: "Adulto" },
    });
    // mapeia para a ficha: 'Nome' já está em uso
    expect(within(sheet).getByRole("option", { name: "Nome (já usado)" })).toBeDisabled();
    fireEvent.change(within(sheet).getByLabelText("Este campo é"), {
      target: { value: "teacher" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Concluir" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(lastPut().fields[3]).toMatchObject({
      label: "Nome do mestre",
      showIf: { fieldKey: "f_cat00002", equals: "Adulto" },
      mapsTo: "teacher",
    });
  });

  it("condição que aponta para campo que passou a vir depois bloqueia o salvamento", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Subir Responsável" })); // fica acima de Categoria
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(
      await screen.findByText(/a condição precisa apontar para um campo que vem antes dele/),
    ).toBeInTheDocument();
    expect(puts()).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith("Corrija 1 ponto antes de salvar.");
  });

  it("seção: adicionar, renomear e remover (confirma quando tem campos)", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar seção" }));
    expect(screen.getAllByTestId("builder-section")).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("Título da seção 3"), {
      target: { value: "Pagamento" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remover seção 2" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(
      within(confirm).getByText(/“Termos” e os 1 campo\(s\) dela saem do formulário/),
    ).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Remover seção" }));
    await waitFor(() => expect(screen.getAllByTestId("builder-section")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(lastPut().sections).toEqual([
      { id: "s-a", title: "Dados do competidor", description: null },
      { title: "Pagamento", description: null }, // seção nova: sem id
    ]);
    expect(lastPut().fields).toHaveLength(3);
  });

  it("respeita os limites: 60 campos desabilita 'Adicionar campo'; mais de 5 envios de arquivo é recusado", async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      field({
        key: `f_${String(i).padStart(8, "0")}`,
        type: i < 6 ? "FILE" : "SHORT_TEXT",
        label: `Campo ${String(i + 1)}`,
      }),
    );
    definition = { ...baseDefinition(), fields: many };
    renderEditor();
    await screen.findByText("Campo 1", { selector: "p" });
    expect(screen.getByTestId("builder-counters")).toHaveTextContent("60 de 60 campos");
    for (const button of screen.getAllByRole("button", { name: "Adicionar campo" }))
      expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "Duplicar Campo 1" })).toBeDisabled();

    openTab(/^Configurações/);
    fireEvent.change(screen.getByLabelText("Título do formulário"), {
      target: { value: "Outro título" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(
      await screen.findByText("Use no máximo 5 campos de envio de arquivo."),
    ).toBeInTheDocument();
    expect(puts()).toHaveLength(0);
  });
});

describe("Editor - salvar e erros", () => {
  it("VALIDATION do servidor mostra a mensagem no campo e a geral na aba certa, e mantém as alterações", async () => {
    overrides["PUT /event-forms/f1"] = () =>
      json(400, {
        code: "VALIDATION",
        message: "Dados inválidos",
        // Formato REAL: objeto { <key do campo | nome da configuração>: mensagem }
        fields: { f_nome0001: "Esse rótulo já existe.", title: "Título proibido." },
      });
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Editar Nome completo" }));
    const sheet = await screen.findByTestId("field-sheet");
    fireEvent.change(within(sheet).getByLabelText("Rótulo (a pergunta)"), {
      target: { value: "Nome" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Concluir" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(await within(fieldRow("Nome")).findByText("Esse rótulo já existe.")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Alguns dados estão inválidos"),
    );
    expect(screen.getByTestId("unsaved-indicator")).toBeInTheDocument();
    openTab(/^Configurações/);
    expect(await screen.findByText("Título proibido.")).toBeInTheDocument();
  });

  it("validação do cliente: título vazio não envia nada e leva à aba Configurações", async () => {
    await loaded();
    openTab(/^Configurações/);
    fireEvent.change(await screen.findByLabelText("Título do formulário"), {
      target: { value: " " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(
      await screen.findByText("Informe o título do formulário (mínimo 2 caracteres)."),
    ).toBeInTheDocument();
    expect(puts()).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith("Corrija 1 ponto antes de salvar.");
  });

  it("erro genérico no PUT vira toast e mantém 'não salvo'", async () => {
    overrides["PUT /event-forms/f1"] = () => json(500, { message: "Banco fora." });
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Descer Nome completo" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Banco fora."));
    expect(screen.getByTestId("unsaved-indicator")).toBeInTheDocument();
  });
});

describe("Editor - configurações", () => {
  it("Pix manual exige valor, chave e favorecido; mostra a prévia; salva os campos de pagamento", async () => {
    await loaded();
    openTab(/^Configurações/);
    expect(await screen.findByRole("radio", { name: /^Sem pagamento/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /^Pix manual/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(
      await screen.findByText("Pix manual: Informe o valor em reais, ex.: 25,00."),
    ).toBeInTheDocument();
    expect(screen.getByText("Pix manual: informe a chave Pix.")).toBeInTheDocument();
    expect(screen.getByText("Pix manual: informe o nome do favorecido.")).toBeInTheDocument();
    expect(puts()).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Valor da inscrição (R$)"), {
      target: { value: "25,00" },
    });
    fireEvent.change(screen.getByLabelText("Tipo da chave Pix"), { target: { value: "EMAIL" } });
    fireEvent.change(screen.getByLabelText("Chave Pix"), { target: { value: "pix@grupo.com.br" } });
    fireEvent.change(screen.getByLabelText("Nome do favorecido"), {
      target: { value: "Grupo de Capoeira" },
    });
    const preview = screen.getByTestId("pix-preview");
    expect(preview).toHaveTextContent(/R\$\s*25,00/);
    expect(preview).toHaveTextContent("Chave Pix (E-mail): pix@grupo.com.br");
    expect(preview).toHaveTextContent("Favorecido: Grupo de Capoeira");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(lastPut()).toMatchObject({
      paymentMode: "PIX_MANUAL",
      priceCents: 2500,
      pixKey: "pix@grupo.com.br",
      pixKeyType: "EMAIL",
      pixBeneficiary: "Grupo de Capoeira",
    });
  });

  it("Pix automático está desabilitado com o rótulo 'Em breve'", async () => {
    await loaded();
    openTab(/^Configurações/);
    const auto = await screen.findByRole("radio", { name: /^Pix automático/ });
    expect(auto).toBeDisabled();
    expect(screen.getByText("Em breve")).toBeInTheDocument();
  });

  it("período, vagas, lista de espera, aprovação, mensagem, termo e retenção vão no PUT; vazios viram null", async () => {
    await loaded();
    openTab(/^Configurações/);
    fireEvent.change(await screen.findByLabelText("Abre em"), {
      target: { value: "2026-11-01T08:00" },
    });
    fireEvent.change(screen.getByLabelText("Encerra em"), {
      target: { value: "2026-11-15T23:59" },
    });
    fireEvent.change(screen.getByLabelText("Limite de inscrições"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("switch", { name: "Aceitar lista de espera" }));
    fireEvent.click(screen.getByRole("switch", { name: "Eu aprovo cada inscrição" }));
    fireEvent.change(screen.getByLabelText("Mensagem de confirmação"), {
      target: { value: "Nos vemos lá!" },
    });
    fireEvent.change(screen.getByLabelText("Texto do termo de consentimento"), {
      target: { value: "Termo novo." },
    });
    fireEvent.change(screen.getByLabelText("Guardar os dados por (meses)"), {
      target: { value: "6" },
    });
    fireEvent.change(screen.getByLabelText("Texto de apresentação"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Banner"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    const body = lastPut();
    expect(body).toMatchObject({
      maxSubmissions: 100,
      allowWaitlist: true,
      requireApproval: false,
      confirmationMessage: "Nos vemos lá!",
      consentText: "Termo novo.",
      retentionMonths: 6,
      intro: null,
      bannerUrl: null,
      eventId: 7,
      paymentMode: "NONE",
      priceCents: 0,
      pixKey: null,
    });
    expect(body["opensAt"]).toBe(new Date("2026-11-01T08:00").toISOString());
    expect(body["closesAt"]).toBe(new Date("2026-11-15T23:59").toISOString());
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("slug");
    expect(body).not.toHaveProperty("publicUrl");
    expect(body).not.toHaveProperty("id");
  });

  it("encerramento antes da abertura e vagas inválidas são recusados no cliente", async () => {
    await loaded();
    openTab(/^Configurações/);
    fireEvent.change(await screen.findByLabelText("Abre em"), {
      target: { value: "2026-11-15T08:00" },
    });
    fireEvent.change(screen.getByLabelText("Encerra em"), {
      target: { value: "2026-11-01T08:00" },
    });
    fireEvent.change(screen.getByLabelText("Limite de inscrições"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(
      await screen.findByText("O encerramento precisa ser depois da abertura."),
    ).toBeInTheDocument();
    expect(screen.getByText(/número de vagas inteiro, de 1 em diante/)).toBeInTheDocument();
    expect(puts()).toHaveLength(0);
  });
});

describe("Editor - publicar, fechar, link e QR Code", () => {
  it("Publicar pede confirmação e chama POST /open; depois mostra 'Aberto' e o botão Fechar", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(sent("POST", "/event-forms/f1/open")).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole("button", { name: "Publicar" }));
    await waitFor(() => expect(sent("POST", "/event-forms/f1/open")).toHaveLength(1));
    expect(puts()).toHaveLength(0); // nada a salvar
    expect(await within(screen.getByTestId("editor-bar")).findByText("Aberto")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Fechar inscrições" })).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Formulário aberto para inscrições.");
  });

  it("Publicar com alterações salva antes (PUT, depois POST /open)", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Descer Nome completo" }));
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(
      within(confirm).getByText(/as alterações não salvas são salvas antes/),
    ).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Publicar" }));
    await waitFor(() => expect(sent("POST", "/event-forms/f1/open")).toHaveLength(1));
    const order = calls
      .filter(
        (c) => (c.method === "PUT" || c.method === "POST") && c.path.startsWith("/event-forms/f1"),
      )
      .map((c) => c.method);
    expect(order).toEqual(["PUT", "POST"]);
  });

  it("não publica se o salvamento falhar na validação do cliente", async () => {
    await loaded();
    openTab(/^Configurações/);
    fireEvent.change(await screen.findByLabelText("Título do formulário"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Publicar" }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(sent("POST", "/event-forms/f1/open")).toHaveLength(0);
  });

  it("formulário aberto: Fechar inscrições pede confirmação e chama POST /close", async () => {
    definition = { ...baseDefinition(), status: "OPEN" };
    await loaded();
    expect(screen.queryByRole("button", { name: "Publicar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fechar inscrições" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Fechar inscrições" }));
    await waitFor(() => expect(sent("POST", "/event-forms/f1/close")).toHaveLength(1));
    expect(await screen.findByRole("button", { name: "Reabrir" })).toBeInTheDocument();
  });

  it("publicUrl null: Copiar link e QR Code ficam desabilitados com a dica 'Publique o formulário…' e o link não é mostrado", async () => {
    await loaded();
    const copy = screen.getByRole("button", { name: "Copiar link" });
    const qr = screen.getByRole("button", { name: "QR Code" });
    expect(copy).toBeDisabled();
    expect(qr).toBeDisabled();
    expect(copy).toHaveAttribute("title", "Publique o formulário para gerar o link");
    expect(qr).toHaveAttribute("title", "Publique o formulário para gerar o link");
    expect(screen.getByTestId("link-provisional")).toHaveTextContent(/criados quando você publica/);
    expect(screen.queryByText(/app\.gingapp\.com\.br\/i\/campeonato-varjao/)).toBeNull();
    fireEvent.click(copy);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("FORM_HAS_CONFIRMED (409) ao trocar o evento mostra a mensagem amigável", async () => {
    overrides["PUT /event-forms/f1"] = () =>
      json(409, { code: "FORM_HAS_CONFIRMED", message: "Tem confirmadas." });
    await loaded();
    openTab(/^Configurações/);
    fireEvent.change(await screen.findByLabelText("Evento"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Este formulário já tem inscrições confirmadas: não é possível trocar o evento.",
      ),
    );
    expect(screen.getByTestId("unsaved-indicator")).toBeInTheDocument();
  });

  it("Pix manual: avisa que a chave Pix fica visível a todos enquanto o formulário estiver aberto", async () => {
    await loaded();
    openTab(/^Configurações/);
    expect(screen.queryByText(/A chave Pix fica visível a todos/)).toBeNull();
    fireEvent.click(await screen.findByRole("radio", { name: /^Pix manual/ }));
    expect(
      screen.getByText(
        "A chave Pix fica visível a todos enquanto o formulário estiver aberto. Prefira uma chave aleatória.",
      ),
    ).toBeInTheDocument();
  });

  it("depois de publicar, o link passa a ser o DEFINITIVO devolvido pelo servidor (o slug muda na 1ª publicação)", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/O link definitivo é criado agora/)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Publicar" }));
    expect(
      await screen.findByText("https://app.gingapp.com.br/i/campeonato-varjao-k3q9x"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copiar link" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("https://app.gingapp.com.br/i/campeonato-varjao-k3q9x"),
    );
    expect(toast.success).toHaveBeenCalledWith("Link copiado.");
  });

  it("Publicar recusado pelo servidor (VALIDATION com fields) mostra o que falta e leva à aba certa", async () => {
    overrides["POST /event-forms/f1/open"] = () =>
      json(400, {
        statusCode: 400,
        error: "Bad Request",
        code: "VALIDATION",
        message: "O formulário ainda não pode ser publicado.",
        fields: { priceCents: "Informe o valor da inscrição.", pixKey: "Informe a chave Pix." },
      });
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Publicar" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Informe o valor da inscrição. Informe a chave Pix.",
      ),
    );
    expect(await screen.findByText("Informe o valor da inscrição.")).toBeInTheDocument();
    expect(screen.getByText("Informe a chave Pix.")).toBeInTheDocument();
  });

  it("formulário encerrado: Copiar link avisa que só aceita inscrições enquanto estiver aberto", async () => {
    definition = { ...baseDefinition(), status: "CLOSED", slugLocked: true, publicUrl: PUBLIC_URL };
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Copiar link" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("https://app.gingapp.com.br/i/campeonato-varjao"),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Link copiado. Ele só aceita inscrições enquanto o formulário estiver aberto.",
    );
  });

  it("QR Code: imagem, baixar PNG e compartilhar no WhatsApp com texto pronto", async () => {
    definition = { ...baseDefinition(), status: "OPEN", slugLocked: true, publicUrl: PUBLIC_URL };
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "QR Code" }));
    const dialog = await screen.findByTestId("qr-dialog");
    const image = await within(dialog).findByAltText("QR Code do formulário Campeonato do Varjão");
    expect(image.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    const download = within(dialog).getByRole("link", { name: /Baixar PNG/ });
    expect(download).toHaveAttribute("download", "qr-inscricao-campeonato-varjao.png");
    expect(download.getAttribute("href")).toMatch(/^data:image\/png/);
    const whats = within(dialog).getByRole("link", { name: "Compartilhar no WhatsApp" });
    const href = whats.getAttribute("href")!;
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(href.split("?text=")[1]!);
    expect(text).toContain("Campeonato do Varjão");
    expect(text).toContain("https://app.gingapp.com.br/i/campeonato-varjao");
    expect(within(dialog).getByLabelText("Link público")).toHaveValue(
      "https://app.gingapp.com.br/i/campeonato-varjao",
    );
  });

  it("voltar chama onBack", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Voltar para a lista de formulários" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("Editor - prévia e somente leitura", () => {
  it("'Ver como o inscrito vê' mostra banner, texto, seções, campos e a condição, inclusive do que não foi salvo", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Descer Nome completo" }));
    fireEvent.click(screen.getByRole("button", { name: "Ver como o inscrito vê" }));
    const preview = await screen.findByTestId("preview-dialog");
    expect(
      within(preview).getByRole("heading", { name: "Campeonato do Varjão" }),
    ).toBeInTheDocument();
    expect(within(preview).getByText("Venha jogar capoeira!")).toBeInTheDocument();
    expect(within(preview).getByAltText("Banner do formulário")).toBeInTheDocument();
    expect(within(preview).getByRole("heading", { name: "Termos" })).toBeInTheDocument();
    expect(within(preview).getByText("Infantil")).toBeInTheDocument();
    expect(
      within(preview).getByText(/Aparece só se “Categoria” for “Infantil”/),
    ).toBeInTheDocument();
    expect(within(preview).getByText("Autorizo o uso dos meus dados.")).toBeInTheDocument();
    const labels = within(preview)
      .getAllByText(/Nome completo|Categoria$/, { selector: "p" })
      .map((p) => p.textContent?.trim());
    expect(labels[0]).toMatch(/^Categoria/); // a nova ordem (Nome desceu)
  });

  it("formulário arquivado é somente leitura: sem salvar/publicar/adicionar e com aviso", async () => {
    definition = { ...baseDefinition(), status: "ARCHIVED" };
    await loaded();
    expect(screen.getByTestId("readonly-notice")).toBeInTheDocument();
    expect(within(screen.getByTestId("editor-bar")).getByText("Arquivado")).toBeInTheDocument();
    for (const name of [
      "Salvar",
      "Publicar",
      "Fechar inscrições",
      "Copiar link",
      "QR Code",
      "Adicionar seção",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("button", { name: "Adicionar campo" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remover/ })).toBeNull();
    // ainda dá para ver o campo, mas os controles ficam desabilitados
    fireEvent.click(screen.getByRole("button", { name: "Ver Nome completo" }));
    const sheet = await screen.findByTestId("field-sheet");
    expect(within(sheet).getByLabelText("Rótulo (a pergunta)")).toBeDisabled();
    expect(within(sheet).queryByRole("button", { name: "Remover" })).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "Concluir" }));
    openTab(/^Configurações/);
    expect(await screen.findByLabelText("Título do formulário")).toBeDisabled();
    expect(puts()).toHaveLength(0);
  });
});

describe("builder (funções puras)", () => {
  const draft = () => fromDefinition(baseDefinition() as unknown as FormDefinition);

  it("newFieldKey gera 'f_' + 8 caracteres e não repete as existentes", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 200; i++) keys.add(newFieldKey(keys));
    expect(keys.size).toBe(200);
    for (const key of keys) expect(key).toMatch(/^f_[a-z0-9]{8}$/);
  });

  it("toPayload usa sectionIndex e preserva as keys; seções existentes levam o id", () => {
    const payload = toPayload(draft());
    expect(payload.fields.map((f) => [f.key, f.sectionIndex])).toEqual([
      ["f_nome0001", 0],
      ["f_cat00002", 0],
      ["f_resp0003", 0],
      ["f_termo004", 1],
    ]);
    expect(payload.sections.map((s) => s.id)).toEqual(["s-a", "s-b"]);
  });

  it("addField respeita a ordem e removeField limpa condições penduradas", () => {
    const d = draft();
    const added = addField(d, d.sections[0]!.cid, "FILE");
    expect(allFields(added.draft)).toHaveLength(5);
    expect(allFields(added.draft).map((f) => f.key)).toContain(added.key);
    const without = removeField(d, "f_cat00002");
    expect(allFields(without).find((f) => f.key === "f_resp0003")?.showIf).toBeNull();
  });

  it("moveField não mexe quando está na ponta do formulário", () => {
    const d = draft();
    expect(moveField(d, "f_nome0001", -1)).toBe(d);
    expect(allFields(moveField(d, "f_termo004", -1)).at(3)?.key).toBe("f_termo004");
  });

  it("validateDraft: opções, mapeamento duplicado e limites", () => {
    const d = draft();
    expect(validateDraft(d)).toEqual([]);
    const broken = {
      ...d,
      sections: d.sections.map((s, i) =>
        i === 0
          ? {
              ...s,
              fields: s.fields.map((f) =>
                f.key === "f_cat00002"
                  ? { ...f, options: ["A", "a"] }
                  : f.key === "f_resp0003"
                    ? { ...f, mapsTo: "name" as const, showIf: null }
                    : f,
              ),
            }
          : s,
      ),
    };
    const messages = validateDraft(broken).map((i) => i.message);
    expect(messages).toContain('"Categoria": há opções repetidas.');
    expect(
      messages.some((m) => m.includes('o mapeamento "Nome" já foi usado em "Nome completo"')),
    ).toBe(true);
  });
});

describe("aviso ao sair com alterações não salvas (LeaveGuard)", () => {
  function renderGuard(dirty: boolean) {
    function Home() {
      const navigate = useNavigate();
      return (
        <>
          <LeaveGuard dirty={dirty} />
          {/* rota de teste fora da árvore registrada: o cast evita o tipo estrito do roteador do painel */}
          <button onClick={() => void navigate({ to: "/outra" } as never)}>Ir para outra</button>
          <p>Página inicial</p>
        </>
      );
    }
    const root = createRootRoute();
    const home = createRoute({ getParentRoute: () => root, path: "/", component: Home });
    const other = createRoute({
      getParentRoute: () => root,
      path: "/outra",
      component: () => <p>Outra página</p>,
    });
    const router = createRouter({
      routeTree: root.addChildren([home, other]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router as never} />);
    return router;
  }

  it("pergunta antes de sair; 'Continuar editando' fica; 'Sair sem salvar' navega", async () => {
    const router = renderGuard(true);
    fireEvent.click(await screen.findByRole("button", { name: "Ir para outra" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Sair sem salvar?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(router.state.location.pathname).toBe("/");

    fireEvent.click(screen.getByRole("button", { name: "Ir para outra" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Sair sem salvar",
      }),
    );
    expect(await screen.findByText("Outra página")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/outra");
  });

  it("sem alterações navega direto, sem perguntar", async () => {
    const router = renderGuard(false);
    fireEvent.click(await screen.findByRole("button", { name: "Ir para outra" }));
    expect(await screen.findByText("Outra página")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(router.state.location.pathname).toBe("/outra");
  });
});
