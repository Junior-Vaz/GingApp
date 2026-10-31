import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { routeTree } from "@/routeTree.gen";
import { ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { CertificadosPage } from "@/modules/certificados/certificados-page";
import { CertificadosTabs } from "@/modules/certificados/certificados-tabs";
import { TemplateEditorPage, TemplatesPage } from "@/modules/certificados/modelos";
import { LeaveGuard } from "@/modules/formularios";
import { blankLayout, toWireLayout } from "@/modules/certificados/modelos/layout-utils";
import type {
  CertificatePreset,
  CertificateTemplate,
  CertificateTemplateSummary,
  TextEl,
} from "@/modules/certificados/modelos/types";
import { toIssuePayload } from "@/modules/certificados/certificate-utils";
import { clearSession, loginAs } from "./login-as";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// jsdom 20 não tem PointerEvent: um MouseEvent com pointerId serve para o editor (mouse e toque usam o mesmo caminho).
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/** fetch falso roteado por "METHOD /caminho"; registra as chamadas (corpo JSON, ou "FormData" nos envios de arquivo). */
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
        body: init.body instanceof FormData ? "FormData" : init.body ? JSON.parse(init.body as string) : undefined,
      };
      calls.push(call);
      const handler = routes[`${method} ${path}`];
      return Promise.resolve(handler ? handler(call) : json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  return calls;
}
const sent = (calls: Call[], method: string, path?: string) =>
  calls.filter((c) => c.method === method && (path === undefined || c.path === path));

// ------------------------------------------------------------------ fixtures

const SUMMARIES: CertificateTemplateSummary[] = [
  { id: 1, name: "Clássico do grupo", purpose: "GRADUACAO", isDefault: true, orientation: "landscape", updatedAt: "2026-03-10T12:00:00.000Z" },
  { id: 2, name: "Batizado 2026", purpose: "BATIZADO", isDefault: false, orientation: "portrait", updatedAt: "2026-04-01T12:00:00.000Z" },
  { id: 3, name: "Geral", purpose: "OUTRO", isDefault: true, orientation: "landscape", updatedAt: "2026-04-02T12:00:00.000Z" },
];
const PRESETS: CertificatePreset[] = [
  { key: "classico", name: "Clássico", purpose: "GRADUACAO", layout: blankLayout() },
  { key: "moderno", name: "Moderno", purpose: "OUTRO", layout: blankLayout("portrait") },
];

const detailOf = (summary: CertificateTemplateSummary, layout = blankLayout(summary.orientation)): CertificateTemplate => ({
  id: summary.id,
  name: summary.name,
  purpose: summary.purpose,
  isDefault: summary.isDefault,
  layout,
  createdAt: "2026-03-01T12:00:00.000Z",
  updatedAt: summary.updatedAt,
});

/** Rotas de leitura comuns (lista, presets e cada detalhe). */
const readRoutes = () => ({
  "GET /certificate-templates": () => json(200, SUMMARIES),
  "GET /certificate-templates/presets": () => json(200, PRESETS),
  ...Object.fromEntries(SUMMARIES.map((s) => [`GET /certificate-templates/${String(s.id)}`, () => json(200, detailOf(s))])),
});

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

// ------------------------------------------------------------------ lista

describe("TemplatesPage (aba Modelos)", () => {
  beforeEach(() => loginAs("MESTRE"));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    clearSession();
  });

  function renderList(onOpen = vi.fn()) {
    render(
      <QueryClientProvider client={client()}>
        <TemplatesPage onOpen={onOpen} />
      </QueryClientProvider>,
    );
    return onOpen;
  }

  it("lista cards com nome, uso, selo Padrão e miniatura desenhada pelo canvas (GET do modelo)", async () => {
    const calls = mockApi(readRoutes());
    renderList();
    const card1 = await screen.findByTestId("template-card-1");
    expect(within(card1).getByText("Clássico do grupo")).toBeInTheDocument();
    expect(within(card1).getByText("Graduação")).toBeInTheDocument();
    expect(within(card1).getByTestId("default-badge")).toHaveTextContent("Padrão");
    const card2 = screen.getByTestId("template-card-2");
    expect(within(card2).getByText("Batizado 2026")).toBeInTheDocument();
    expect(within(card2).queryByTestId("default-badge")).toBeNull();
    // a lista vem sem o desenho: cada miniatura busca o modelo e usa o MESMO canvas em modo leitura
    await waitFor(() => expect(within(card1).getByTestId("certificate-sheet")).toBeInTheDocument());
    expect(await within(card2).findByTestId("certificate-sheet")).toHaveAttribute("data-orientation", "portrait");
    expect(sent(calls, "GET", "/certificate-templates/1")).toHaveLength(1);
    // modo leitura: nada de botões de elemento nem alças
    expect(within(card1).queryByRole("button", { name: /^Texto/ })).toBeNull();
  });

  it("estados de carregando, erro (com tentar de novo) e vazio", async () => {
    mockApi({ "GET /certificate-templates": () => json(500, { message: "Falhou feio." }) });
    const view = render(
      <QueryClientProvider client={client()}>
        <TemplatesPage onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("templates-error")).toHaveTextContent("Falhou feio.");
    view.unmount();
    vi.unstubAllGlobals();
    mockApi({ "GET /certificate-templates": () => json(200, []) });
    renderList();
    expect(await screen.findByTestId("templates-empty")).toHaveTextContent("Nenhum modelo ainda.");
  });

  it("duplicar chama POST /duplicate; definir padrão chama POST /default (e fica desabilitado no que já é padrão)", async () => {
    const calls = mockApi({
      ...readRoutes(),
      "POST /certificate-templates/2/duplicate": () => json(201, detailOf({ ...SUMMARIES[1]!, id: 9, name: "Batizado 2026 (cópia)" })),
      "POST /certificate-templates/2/default": () => json(200, { ...detailOf(SUMMARIES[1]!), isDefault: true }),
    });
    renderList();
    await screen.findByTestId("template-card-2");
    expect(screen.getByRole("button", { name: "Definir Clássico do grupo como padrão de Graduação" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Duplicar Batizado 2026" }));
    await waitFor(() => expect(sent(calls, "POST", "/certificate-templates/2/duplicate")).toHaveLength(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Modelo duplicado."));

    fireEvent.click(screen.getByRole("button", { name: "Definir Batizado 2026 como padrão de Batizado" }));
    await waitFor(() => expect(sent(calls, "POST", "/certificate-templates/2/default")).toHaveLength(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Modelo definido como padrão de “Batizado”."));
  });

  it("excluir só depois de confirmar", async () => {
    const calls = mockApi({ ...readRoutes(), "DELETE /certificate-templates/2": () => new Response(null, { status: 204 }) });
    renderList();
    await screen.findByTestId("template-card-2");
    fireEvent.click(screen.getByRole("button", { name: "Excluir Batizado 2026" }));
    expect(sent(calls, "DELETE")).toHaveLength(0);
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/certificados já emitidos com ele não mudam/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(sent(calls, "DELETE")).toHaveLength(1));
    expect(sent(calls, "DELETE")[0]!.path).toBe("/certificate-templates/2");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Modelo excluído."));
  });

  it("excluir o padrão avisa que o grupo volta ao modelo clássico", async () => {
    mockApi(readRoutes());
    renderList();
    await screen.findByTestId("template-card-1");
    fireEvent.click(screen.getByRole("button", { name: "Excluir Clássico do grupo" }));
    expect(await within(await screen.findByRole("alertdialog")).findByText(/padrão de “Graduação”/)).toBeInTheDocument();
  });

  it("novo modelo a partir de um modelo pronto: POST com presetKey e abre o editor", async () => {
    const calls = mockApi({
      ...readRoutes(),
      "POST /certificate-templates": () => json(201, detailOf({ ...SUMMARIES[0]!, id: 9, name: "Moderno", purpose: "OUTRO", isDefault: false })),
    });
    const onOpen = renderList();
    await screen.findByTestId("template-card-1");
    fireEvent.click(screen.getByRole("button", { name: "Novo modelo" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("radio", { name: "Moderno" }));
    expect(within(dialog).getByLabelText("Nome do modelo")).toHaveValue("Moderno");
    expect(within(dialog).getByLabelText("Usado em")).toHaveValue("OUTRO");
    fireEvent.change(within(dialog).getByLabelText("Nome do modelo"), { target: { value: "Moderno do grupo" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar modelo" }));
    await waitFor(() => expect(sent(calls, "POST", "/certificate-templates")).toHaveLength(1));
    expect(sent(calls, "POST", "/certificate-templates")[0]!.body).toEqual({
      name: "Moderno do grupo",
      purpose: "OUTRO",
      presetKey: "moderno",
    });
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(9));
  });

  it("novo modelo em branco envia um desenho válido (1 QR e {codigo}) e valida o nome", async () => {
    const calls = mockApi({
      ...readRoutes(),
      "POST /certificate-templates": () => json(201, detailOf({ ...SUMMARIES[0]!, id: 10, isDefault: false })),
    });
    renderList();
    await screen.findByTestId("template-card-1");
    fireEvent.click(screen.getByRole("button", { name: "Novo modelo" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome do modelo"), { target: { value: "  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar modelo" }));
    expect(await within(dialog).findByText("Informe o nome do modelo.")).toBeInTheDocument();
    expect(sent(calls, "POST")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("Nome do modelo"), { target: { value: "Em branco" } });
    fireEvent.change(within(dialog).getByLabelText("Usado em"), { target: { value: "EVENTO" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar modelo" }));
    await waitFor(() => expect(sent(calls, "POST", "/certificate-templates")).toHaveLength(1));
    const body = sent(calls, "POST", "/certificate-templates")[0]!.body as { name: string; purpose: string; layout: { elements: { type: string; text?: string }[] } };
    expect(body).toMatchObject({ name: "Em branco", purpose: "EVENTO" });
    expect(body).not.toHaveProperty("presetKey");
    expect(body.layout.elements.filter((e) => e.type === "qr")).toHaveLength(1);
    expect(body.layout.elements.some((e) => e.type === "text" && /\{codigo\}/.test(e.text ?? ""))).toBe(true);
  });

  it("limite de 30 modelos (409 TEMPLATE_LIMIT) mostra mensagem amigável", async () => {
    mockApi({
      ...readRoutes(),
      "POST /certificate-templates": () => json(409, { code: "TEMPLATE_LIMIT", message: "Limite." }),
    });
    renderList();
    await screen.findByTestId("template-card-1");
    fireEvent.click(screen.getByRole("button", { name: "Novo modelo" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar modelo" }));
    expect(await within(dialog).findByText(/já tem 30 modelos/)).toBeInTheDocument();
  });

  it("INSTRUTOR só visualiza: sem Novo modelo nem ações", async () => {
    clearSession();
    loginAs("INSTRUTOR");
    mockApi(readRoutes());
    renderList();
    await screen.findByTestId("template-card-1");
    expect(screen.queryByRole("button", { name: "Novo modelo" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Duplicar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Excluir/ })).toBeNull();
    expect(screen.getByText(/Somente o Mestre e o Professor criam e editam modelos/)).toBeInTheDocument();
  });

  it("PROFESSOR cria e edita modelos (contrato §7)", async () => {
    clearSession();
    loginAs("PROFESSOR");
    mockApi(readRoutes());
    renderList();
    await screen.findByTestId("template-card-1");
    expect(screen.getByRole("button", { name: "Novo modelo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluir Batizado 2026" })).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ editor

describe("TemplateEditorPage", () => {
  beforeEach(() => {
    loginAs("MESTRE");
    URL.createObjectURL = vi.fn(() => "blob:preview-1");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    clearSession();
    window.innerWidth = 1024;
  });

  const UPLOAD = "/api/uploads/0a1b2c3d-1111-2222-3333-444455556666.png";

  async function renderEditor(extra: Record<string, (c: Call) => Response> = {}) {
    const calls = mockApi({ ...readRoutes(), ...extra });
    const onBack = vi.fn();
    const onDirtyChange = vi.fn();
    render(
      <QueryClientProvider client={client()}>
        <TemplateEditorPage templateId={1} onBack={onBack} onDirtyChange={onDirtyChange} />
      </QueryClientProvider>,
    );
    await screen.findByTestId("template-editor");
    return { calls, onBack, onDirtyChange };
  }

  const el = (id: string) => screen.getByTestId(`el-${id}`);
  const select = (id: string) => fireEvent.pointerDown(el(id), { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
  const editText = (value: string) =>
    fireEvent.change(screen.getByRole("textbox", { name: "Conteúdo do texto" }), { target: { value } });

  it("carrega o modelo na folha proporcional, com elementos selecionáveis por teclado e rótulos", async () => {
    await renderEditor();
    const sheet = screen.getByTestId("certificate-sheet");
    expect(sheet).toHaveAttribute("data-orientation", "landscape");
    expect(sheet.style.aspectRatio.replace(/\s/g, "")).toBe("842/595");
    const text = el("texto-principal");
    expect(text).toHaveAttribute("role", "button");
    expect(text).toHaveAttribute("tabindex", "0");
    expect(text).toHaveAttribute("aria-label", "Texto 1: {aluno}");
    expect(el("qr-verificacao")).toHaveAttribute("aria-label", "QR Code 3 (obrigatório, não pode ser removido)");
    // o texto da prévia usa os dados de exemplo
    expect(within(text).getByText("Maria da Silva Santos")).toBeInTheDocument();
    // nada selecionado: painel da página (orientação, fundo)
    expect(screen.getByTestId("page-panel")).toBeInTheDocument();
    expect(screen.getByText(/O PDF gerado pelo servidor é a/)).toBeInTheDocument();

    fireEvent.focus(text);
    expect(text).toHaveAttribute("data-selected", "true");
    expect(text).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Texto 1" })).toBeInTheDocument();
    // alças do elemento selecionado
    for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) expect(screen.getByTestId(`handle-${handle}`)).toBeInTheDocument();
  });

  it("selecionar um elemento e editar o texto atualiza a folha e marca Alterações não salvas", async () => {
    const { onDirtyChange } = await renderEditor();
    expect(screen.queryByTestId("unsaved-indicator")).toBeNull();
    select("texto-principal");
    editText("Certificamos que {aluno} — {grupo}");
    expect(within(el("texto-principal")).getByText("Certificamos que Maria da Silva Santos — Seu grupo")).toBeInTheDocument();
    expect(screen.getByTestId("unsaved-indicator")).toHaveTextContent("Alterações não salvas");
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  });

  it("chips de variáveis inserem no texto", async () => {
    await renderEditor();
    select("texto-principal");
    editText("Olá ");
    fireEvent.click(screen.getByRole("button", { name: /^Inserir \{titulo\}/ }));
    expect(screen.getByRole("textbox", { name: "Conteúdo do texto" })).toHaveValue("Olá {titulo}");
    expect(within(el("texto-principal")).getByText("Olá Batizado e troca de corda")).toBeInTheDocument();
  });

  it("setas movem 1% e Shift+seta move 5% (teclado)", async () => {
    await renderEditor();
    const text = el("texto-principal");
    expect(text.style.left).toBe("10%");
    fireEvent.keyDown(text, { key: "ArrowRight" });
    expect(text.style.left).toBe("11%");
    fireEvent.keyDown(text, { key: "ArrowDown", shiftKey: true });
    expect(text.style.top).toBe("45%");
    fireEvent.keyDown(text, { key: "ArrowLeft" });
    expect(text.style.left).toBe("10%");
    // nunca sai da página
    for (let i = 0; i < 30; i++) fireEvent.keyDown(text, { key: "ArrowRight", shiftKey: true });
    expect(text.style.left).toBe("20%"); // x + w (80) <= 100
    // Alt+setas muda o tamanho
    fireEvent.keyDown(text, { key: "ArrowLeft", altKey: true });
    expect(text.style.width).toBe("79%");
  });

  it("Delete remove o texto, mas o QR Code nunca some", async () => {
    await renderEditor();
    fireEvent.keyDown(el("qr-verificacao"), { key: "Delete" });
    expect(screen.getByTestId("el-qr-verificacao")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/QR Code é obrigatório/));
    expect(screen.queryByTestId("unsaved-indicator")).toBeNull();
    // o botão Excluir também fica desabilitado para o QR
    select("qr-verificacao");
    expect(screen.getByRole("button", { name: "Excluir elemento" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Duplicar elemento" })).toBeDisabled();
    expect(screen.getByTestId("qr-locked")).toHaveTextContent(/não removê-lo/);

    fireEvent.keyDown(el("texto-principal"), { key: "Delete" });
    expect(screen.queryByTestId("el-texto-principal")).toBeNull();
    expect(screen.getByTestId("unsaved-indicator")).toBeInTheDocument();
  });

  it("desfazer e refazer (botões e Ctrl+Z / Ctrl+Y)", async () => {
    await renderEditor();
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeDisabled();
    fireEvent.keyDown(el("texto-principal"), { key: "ArrowRight", shiftKey: true });
    expect(el("texto-principal").style.left).toBe("15%");
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    expect(el("texto-principal").style.left).toBe("10%");
    expect(screen.queryByTestId("unsaved-indicator")).toBeNull(); // voltou ao estado salvo
    fireEvent.click(screen.getByRole("button", { name: "Refazer" }));
    expect(el("texto-principal").style.left).toBe("15%");
    fireEvent.keyDown(el("texto-principal"), { key: "z", ctrlKey: true });
    expect(el("texto-principal").style.left).toBe("10%");
    fireEvent.keyDown(el("texto-principal"), { key: "y", ctrlKey: true });
    expect(el("texto-principal").style.left).toBe("15%");
  });

  it("arrastar com ponteiro move o elemento, acende a guia de centro e entra no histórico", async () => {
    await renderEditor();
    const sheet = screen.getByTestId("certificate-sheet");
    sheet.getBoundingClientRect = () =>
      ({ width: 1000, height: 707, left: 0, top: 0, right: 1000, bottom: 707, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const text = el("texto-principal");
    // vertical: continua centralizado em x (10 + 80/2 = 50) -> guia vertical em 50%
    fireEvent.pointerDown(text, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(text, { pointerId: 1, clientX: 100, clientY: 130 });
    expect(screen.getByTestId("guide-x")).toBeInTheDocument();
    fireEvent.pointerUp(text, { pointerId: 1, clientX: 100, clientY: 130 });
    expect(screen.queryByTestId("guide-x")).toBeNull();
    expect(Number.parseFloat(text.style.top)).toBeGreaterThan(40);
    expect(text.style.left).toBe("10%");
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeEnabled();

    // horizontal: +5% de 1000px = 15%, e a borda direita (95%) gruda na borda direita do QR (95,5%): +0,5
    fireEvent.pointerDown(text, { pointerId: 2, button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(text, { pointerId: 2, clientX: 250, clientY: 200 });
    expect(screen.getByTestId("guide-x")).toBeInTheDocument();
    fireEvent.pointerUp(text, { pointerId: 2, clientX: 250, clientY: 200 });
    expect(text.style.left).toBe("15.5%");
  });

  it("redimensionar pela alça (canto inferior direito) e snap na borda da página", async () => {
    await renderEditor();
    const sheet = screen.getByTestId("certificate-sheet");
    sheet.getBoundingClientRect = () =>
      ({ width: 1000, height: 707, left: 0, top: 0, right: 1000, bottom: 707, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    select("texto-principal");
    const handle = screen.getByTestId("handle-e");
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 900, clientY: 300 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 895, clientY: 300 }); // -0.5% -> grudar em 100? (borda direita 89.5)
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600, clientY: 300 }); // -30%
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 600, clientY: 300 });
    // x=10, largura 80 -> 50 (borda direita em 60, sem guia próxima)
    expect(el("texto-principal").style.width).toBe("50%");
    expect(el("texto-principal").style.left).toBe("10%");
  });

  it("propriedades do texto: fonte sem negrito/itálico desabilita os botões e desliga as flags", async () => {
    await renderEditor();
    select("texto-principal");
    fireEvent.click(screen.getByRole("button", { name: "Negrito" }));
    expect(screen.getByRole("button", { name: "Negrito" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("Fonte"), { target: { value: "cinzel" } });
    expect(screen.getByRole("button", { name: "Itálico" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Negrito" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Fonte"), { target: { value: "greatvibes" } });
    expect(screen.getByRole("button", { name: "Negrito" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Negrito" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Esta fonte não tem negrito nem itálico.")).toBeInTheDocument();
    // fonte sem negrito: a flag é ignorada na prévia (nada de negrito sintético), como no PDF
    expect(within(el("texto-principal")).getByText("Maria da Silva Santos").style.fontWeight).toBe("400");
  });

  it("cor do QR clara demais é recusada com mensagem", async () => {
    await renderEditor();
    select("qr-verificacao");
    fireEvent.change(screen.getByLabelText("Cor escura do QR (código hexadecimal)"), { target: { value: "#FFFFFF" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/Cor clara demais/);
    expect(screen.queryByTestId("unsaved-indicator")).toBeNull();
    fireEvent.change(screen.getByLabelText("Cor escura do QR (código hexadecimal)"), { target: { value: "#1f2937" } });
    expect(screen.getByTestId("unsaved-indicator")).toBeInTheDocument();
  });

  it("salvar envia PATCH com name, purpose e o layout só com as chaves do contrato", async () => {
    const saved = detailOf(SUMMARIES[0]!);
    const { calls, onDirtyChange } = await renderEditor({ "PATCH /certificate-templates/1": () => json(200, saved) });
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled(); // nada alterado
    select("texto-principal");
    editText("Certificamos {aluno}");
    fireEvent.change(screen.getByLabelText("Cor do texto (código hexadecimal)"), { target: { value: "#aa0000" } });
    fireEvent.change(screen.getByLabelText("Nome do modelo"), { target: { value: "  Clássico 2027 " } });
    fireEvent.change(screen.getByLabelText("Usado em"), { target: { value: "EVENTO" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(sent(calls, "PATCH")).toHaveLength(1));
    const patch = sent(calls, "PATCH")[0]!;
    expect(patch.path).toBe("/certificate-templates/1");
    const expected = toWireLayout(blankLayout());
    const main = expected.elements.find((e) => e.id === "texto-principal") as TextEl;
    main.text = "Certificamos {aluno}";
    main.color = "#AA0000";
    expect(patch.body).toEqual({ name: "Clássico 2027", purpose: "EVENTO", layout: expected });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Modelo salvo."));
    await waitFor(() => expect(screen.queryByTestId("unsaved-indicator")).toBeNull());
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  it("não salva desenho inválido (sem {codigo}/{link}) e lista as pendências", async () => {
    const { calls } = await renderEditor({ "PATCH /certificate-templates/1": () => json(200, {}) });
    select("texto-verificacao");
    editText("Sem variável de verificação");
    expect(screen.getByTestId("issues")).toHaveTextContent(/\{codigo\} ou \{link\}/);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Corrija antes de salvar.*\{codigo\} ou \{link\}/));
    expect(sent(calls, "PATCH")).toHaveLength(0);
    editText("Variável desconhecida {nome} {codigo}");
    expect(screen.getByTestId("issues")).toHaveTextContent(/variável desconhecida \{nome\}/);
    fireEvent.click(within(screen.getByTestId("issues")).getByRole("button", { name: /variável desconhecida/ }));
    expect(el("texto-verificacao")).toHaveAttribute("data-selected", "true");
  });

  it("erro 400 do servidor aparece na tela e o aviso de não salvo continua", async () => {
    const { calls } = await renderEditor({
      "PATCH /certificate-templates/1": () => json(400, { message: ["Texto 1: variável desconhecida {x}."] }),
    });
    select("texto-principal");
    editText("{aluno} ok");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByTestId("server-error")).toHaveTextContent("Texto 1: variável desconhecida {x}.");
    expect(sent(calls, "PATCH")).toHaveLength(1);
    expect(screen.getByTestId("unsaved-indicator")).toBeInTheDocument();
  });

  it("nome vazio bloqueia o salvamento", async () => {
    const { calls } = await renderEditor();
    fireEvent.change(screen.getByLabelText("Nome do modelo"), { target: { value: " " } });
    expect(screen.getByRole("alert")).toHaveTextContent("Informe o nome do modelo.");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(sent(calls, "PATCH")).toHaveLength(0);
  });

  it("Pré-visualizar PDF chama o endpoint com o layout, abre o PDF num quadro e libera o blob ao fechar", async () => {
    const { calls } = await renderEditor({
      "POST /certificate-templates/preview": () =>
        new Response(new Blob(["%PDF-1.4 teste"], { type: "application/pdf" }), { status: 200, headers: { "Content-Type": "application/pdf" } }),
    });
    select("texto-principal");
    editText("Prévia de {aluno} {codigo}"); // vale o desenho ATUAL (mesmo sem salvar)
    fireEvent.click(screen.getByRole("button", { name: "Pré-visualizar PDF" }));
    const frame = await screen.findByTestId("pdf-frame");
    expect(frame).toHaveAttribute("src", "blob:preview-1");
    expect(frame).toHaveAttribute("title", "PDF do certificado (pré-visualização)");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob;
    expect(blobArg.type).toBe("application/pdf");
    const call = sent(calls, "POST", "/certificate-templates/preview")[0]!;
    const layout = (call.body as { layout: { elements: TextEl[] } }).layout;
    expect(Object.keys(call.body as object)).toEqual(["layout"]);
    expect(layout.elements.find((e) => e.id === "texto-principal")!.text).toBe("Prévia de {aluno} {codigo}");
    expect(screen.getByRole("link", { name: /Abrir em nova aba/ })).toHaveAttribute("href", "blob:preview-1");
    expect(screen.getByText(/Este PDF é a referência final/, { exact: false })).toBeInTheDocument();

    // há dois "Fechar" (o X do diálogo e o botão do rodapé): usa o do rodapé
    fireEvent.click(screen.getAllByRole("button", { name: "Fechar" }).find((b) => b.textContent === "Fechar")!);
    await waitFor(() => expect(screen.queryByTestId("pdf-frame")).toBeNull());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
  });

  it("falha na pré-visualização (429) mostra mensagem e não abre quadro", async () => {
    await renderEditor({ "POST /certificate-templates/preview": () => json(429, { message: "Too Many Requests" }) });
    fireEvent.click(screen.getByRole("button", { name: "Pré-visualizar PDF" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Muitas pré-visualizações/)));
    expect(screen.queryByTestId("pdf-frame")).toBeNull();
  });

  it("imagem: envia pelo upload (/uploads) e salva só a referência; logo do grupo troca a origem", async () => {
    const { calls } = await renderEditor({
      "POST /uploads": () => json(201, { url: UPLOAD }),
      "PATCH /certificate-templates/1": () => json(200, detailOf(SUMMARIES[0]!)),
    });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar imagem" }));
    expect(screen.getByRole("heading", { name: "Imagem 4" })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("image-file-input"), {
      target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(sent(calls, "POST", "/uploads")).toHaveLength(1));
    expect(sent(calls, "POST", "/uploads")[0]!.body).toBe("FormData");
    await screen.findByRole("button", { name: "Trocar imagem" });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(sent(calls, "PATCH")).toHaveLength(1));
    const layout = (sent(calls, "PATCH")[0]!.body as { layout: { elements: { type: string; ref?: string | null; useGroupLogo?: boolean }[] } }).layout;
    expect(layout.elements.at(-1)).toMatchObject({ type: "image", ref: UPLOAD, useGroupLogo: false });

    fireEvent.click(screen.getByRole("switch", { name: "Usar o logo do grupo" }));
    expect(screen.queryByTestId("image-picker")).toBeNull();
    expect(screen.getByText(/O grupo ainda não tem logo/)).toBeInTheDocument();
  });

  it("respeita os limites ao adicionar (QR único, 40 elementos)", async () => {
    await renderEditor();
    expect(screen.queryByRole("button", { name: "Adicionar QR Code" })).toBeNull();
    for (let i = 0; i < 37; i++) fireEvent.click(screen.getByRole("button", { name: "Adicionar retângulo" }));
    expect(screen.getAllByTestId(/^el-/)).toHaveLength(40);
    vi.mocked(toast.error).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar texto" }));
    expect(toast.error).toHaveBeenCalledWith("O modelo já tem o máximo de 40 elementos.");
    expect(screen.getAllByTestId(/^el-/)).toHaveLength(40);
  });

  it("duplicar e ordem frente/trás atuam no elemento selecionado", async () => {
    await renderEditor();
    select("texto-principal");
    fireEvent.click(screen.getByRole("button", { name: "Duplicar elemento" }));
    const ids = () => screen.getAllByTestId(/^el-/).map((n) => n.getAttribute("data-testid"));
    expect(ids()).toHaveLength(4);
    expect(ids()[0]).toBe("el-texto-principal");
    expect(ids()[1]).not.toBe("el-texto-verificacao"); // a cópia entra logo acima do original
    fireEvent.click(screen.getByRole("button", { name: "Enviar para trás" }));
    expect(ids()[0]).toBe(ids().find((i) => i !== "el-texto-principal" && i !== "el-texto-verificacao" && i !== "el-qr-verificacao"));
    fireEvent.click(screen.getByRole("button", { name: "Trazer para a frente" }));
    expect(ids().at(-1)).toBe(ids().find((i) => i !== "el-texto-principal" && i !== "el-texto-verificacao" && i !== "el-qr-verificacao"));
  });

  it("orientação retrato muda a proporção da folha e a página tem fundo editável", async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Retrato" }));
    const sheet = screen.getByTestId("certificate-sheet");
    expect(sheet).toHaveAttribute("data-orientation", "portrait");
    expect(sheet.style.aspectRatio.replace(/\s/g, "")).toBe("595/842");
    fireEvent.change(screen.getByLabelText("Cor de fundo (código hexadecimal)"), { target: { value: "#f5f0e6" } });
    expect(sheet.style.backgroundColor).toBeTruthy();
    expect(screen.getByTestId("unsaved-indicator")).toBeInTheDocument();
  });

  it("tela pequena (< 768px): avisa para editar no computador e não mostra o editor", async () => {
    window.innerWidth = 500;
    mockApi(readRoutes());
    render(
      <QueryClientProvider client={client()}>
        <TemplateEditorPage templateId={1} onBack={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("mobile-notice")).toHaveTextContent("abra o painel no computador");
    expect(screen.queryByTestId("template-editor")).toBeNull();
    expect(screen.getByTestId("certificate-sheet")).toBeInTheDocument(); // só visualização
  });

  it("modelo inexistente (404) mostra erro com tentar de novo", async () => {
    mockApi({ "GET /certificate-templates/1": () => json(404, { message: "Not Found" }) });
    render(
      <QueryClientProvider client={client()}>
        <TemplateEditorPage templateId={1} onBack={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId("editor-error")).toHaveTextContent("Modelo não encontrado.");
  });
});

// ------------------------------------------------------------------ emissão

describe("emissão com seletor de modelo", () => {
  beforeEach(() => loginAs("MESTRE"));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    clearSession();
  });

  const base = () => ({
    ...readRoutes(),
    "GET /certificates": () => json(200, [], { "X-Total-Count": "0" }),
    "GET /students": () => json(200, [{ id: 2, name: "Bia Lima" }], { "X-Total-Count": "1" }),
    "POST /certificates": () => json(201, { id: 9 }),
  });

  async function openIssue() {
    render(
      <QueryClientProvider client={client()}>
        <CertificadosPage />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Emitir certificado" }));
    return screen.findByRole("dialog");
  }

  it("o modelo padrão do grupo vem selecionado (sem templateId) e mostra a miniatura do padrão", async () => {
    const calls = mockApi(base());
    const dialog = await openIssue();
    const select = within(dialog).getByLabelText("Modelo do certificado") as HTMLSelectElement;
    await within(dialog).findByRole("option", { name: "Modelo padrão do grupo (Geral)" });
    expect(select).toHaveValue("");
    await waitFor(() => expect(within(within(dialog).getByTestId("issue-template-preview")).getByTestId("certificate-sheet")).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText("Aluno"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Formatura" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Emitir" }));
    await waitFor(() => expect(sent(calls, "POST", "/certificates")).toHaveLength(1));
    expect(sent(calls, "POST", "/certificates")[0]!.body).toEqual({ studentId: 2, title: "Formatura" });
  });

  it("escolher um modelo envia templateId no POST /certificates", async () => {
    const calls = mockApi(base());
    const dialog = await openIssue();
    await within(dialog).findByRole("option", { name: "Batizado 2026 — Batizado" });
    expect(within(dialog).getByRole("option", { name: "Clássico do grupo — Graduação (padrão)" })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Modelo do certificado"), { target: { value: "2" } });
    await waitFor(() => expect(within(within(dialog).getByTestId("issue-template-preview")).getByTestId("certificate-sheet")).toHaveAttribute("data-orientation", "portrait"));
    fireEvent.change(within(dialog).getByLabelText("Aluno"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Batizado de março" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Emitir" }));
    await waitFor(() => expect(sent(calls, "POST", "/certificates")).toHaveLength(1));
    expect(sent(calls, "POST", "/certificates")[0]!.body).toEqual({ studentId: 2, title: "Batizado de março", templateId: 2 });
  });

  it("toIssuePayload: templateId vazio/ausente não vai; id numérico vai como número", () => {
    const common = { studentId: "2", title: "T", issuedAt: "", fileUrl: "" };
    expect(toIssuePayload({ ...common })).toEqual({ studentId: 2, title: "T" });
    expect(toIssuePayload({ ...common, templateId: "" })).toEqual({ studentId: 2, title: "T" });
    expect(toIssuePayload({ ...common, templateId: "7" })).toEqual({ studentId: 2, title: "T", templateId: 7 });
  });
});

describe("aviso ao sair do editor com alterações não salvas", () => {
  it("o LeaveGuard (compartilhado com Formulários) bloqueia a navegação e mostra o texto do modelo", async () => {
    function Home() {
      const navigate = useNavigate();
      return (
        <>
          <LeaveGuard dirty description="Você tem alterações no modelo de certificado que ainda não foram salvas." />
          <button onClick={() => void navigate({ to: "/outra" } as never)}>Ir para outra</button>
        </>
      );
    }
    const root = createRootRoute();
    const home = createRoute({ getParentRoute: () => root, path: "/", component: Home });
    const other = createRoute({ getParentRoute: () => root, path: "/outra", component: () => <p>Outra página</p> });
    const router = createRouter({
      routeTree: root.addChildren([home, other]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router as never} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ir para outra" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Você tem alterações no modelo de certificado que ainda não foram salvas.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(router.state.location.pathname).toBe("/");
  });
});

// ------------------------------------------------------------------ abas e rotas

describe("abas Certificados | Modelos", () => {
  it("mostra os dois links com a aba ativa marcada (aria-current)", async () => {
    const root = createRootRoute({ component: () => <CertificadosTabs active="modelos" /> });
    const a = createRoute({ getParentRoute: () => root, path: "/certificados", component: () => null });
    const b = createRoute({ getParentRoute: () => root, path: "/certificados/modelos", component: () => null });
    const router = createRouter({
      routeTree: root.addChildren([a, b]),
      history: createMemoryHistory({ initialEntries: ["/certificados/modelos"] }),
    });
    render(<RouterProvider router={router as never} />);
    const certificados = await screen.findByRole("link", { name: "Certificados" });
    const modelos = screen.getByRole("link", { name: "Modelos" });
    expect(certificados).toHaveAttribute("href", "/certificados");
    expect(modelos).toHaveAttribute("href", "/certificados/modelos");
    expect(modelos).toHaveAttribute("aria-current", "page");
    expect(certificados).not.toHaveAttribute("aria-current");
  });
});

describe("rotas /certificados/modelos e /certificados/modelos/$id (guarda)", () => {
  const makeRouter = (path: string) =>
    createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: [path] }),
      context: { queryClient: new QueryClient() },
    });
  const login = (role: Parameters<typeof loginAs>[0]) => {
    clearSession();
    loginAs(role);
  };
  afterEach(() => {
    clearSession();
    vi.clearAllMocks();
  });

  it("MESTRE e PROFESSOR abrem a lista e o editor", async () => {
    for (const role of ["MESTRE", "PROFESSOR"] as const) {
      login(role);
      for (const path of ["/certificados/modelos", "/certificados/modelos/12"]) {
        const router = makeRouter(path);
        await router.load();
        expect(router.state.location.pathname).toBe(path);
      }
    }
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("INSTRUTOR vê a lista, mas o editor o devolve à lista com aviso", async () => {
    login("INSTRUTOR");
    const list = makeRouter("/certificados/modelos");
    await list.load();
    expect(list.state.location.pathname).toBe("/certificados/modelos");
    expect(toast.error).not.toHaveBeenCalled();
    const editor = makeRouter("/certificados/modelos/12");
    await editor.load();
    expect(editor.state.location.pathname).toBe("/certificados/modelos");
    expect(toast.error).toHaveBeenCalledWith("Somente o Mestre e o Professor editam modelos de certificado.");
  });

  it("MONITOR (sem certificados) é levado à tela inicial dele com aviso", async () => {
    login("MONITOR");
    for (const path of ["/certificados/modelos", "/certificados/modelos/12"]) {
      vi.mocked(toast.error).mockClear();
      const router = makeRouter(path);
      await router.load();
      expect(router.state.location.pathname).toBe("/alunos");
      expect(toast.error).toHaveBeenCalledWith(ROUTE_FORBIDDEN_MESSAGE);
    }
  });

  it("sem sessão, vai para o login com ?redirect", async () => {
    clearSession();
    const router = makeRouter("/certificados/modelos/12");
    await router.load();
    expect(router.state.location.pathname).toBe("/login");
  });
});
