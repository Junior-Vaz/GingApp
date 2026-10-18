import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { SubmissionsTab } from "@/modules/formularios/submissions-tab";
import {
  availableActions,
  formatAnswer,
  formatPhone,
} from "@/modules/formularios/submission-utils";
import { clearSession, loginAs } from "./login-as";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string>;
}

const LINK = "https://app.gingapp.com.br/i/campeonato-varjao";

const SUMMARY = {
  total: 5,
  byStatus: { PENDING: 2, CONFIRMED: 2, WAITLIST: 1, REJECTED: 0, CANCELLED: 0 },
  paymentPending: 2,
  paymentConfirmed: 2,
  paidCents: 5000,
  spotsLeft: 10,
};

/** Linha REAL de GET /event-forms/:id/submissions (telefone só com dígitos). */
const item = (over: Record<string, unknown>) => ({
  protocol: "INS-0000",
  status: "PENDING",
  paymentStatus: "PENDING",
  email: null,
  phone: null,
  createdAt: "2026-10-10T15:30:00.000Z",
  hasFiles: false,
  summary: null,
  ...over,
});

const SUBS = [
  item({ id: "s1", protocol: "INS-7K3Q", name: "Ana Souza", hasFiles: true }),
  item({
    id: "s2",
    protocol: "INS-AAAA",
    name: "Bruno Lima",
    status: "CONFIRMED",
    paymentStatus: "CONFIRMED",
  }),
  item({
    id: "s3",
    protocol: "INS-BBBB",
    name: "Carla Dias",
    status: "WAITLIST",
    paymentStatus: "NOT_REQUIRED",
  }),
];

/** Detalhe REAL (conferido contra o backend): CPF já mascarado, telefone em dígitos, FILE = lista de anexos. */
const detail = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  formId: "f1",
  protocol: "INS-7K3Q",
  status: "PENDING",
  paymentStatus: "PENDING",
  name: "Ana Souza",
  email: "ana@exemplo.com",
  phone: "61999990000",
  document: "***.***.***-25",
  consentAt: "2026-10-10T15:30:00.000Z",
  consentVersion: 1,
  reviewedAt: null,
  anonymizedAt: null,
  suggestedStudent: null,
  filesRestricted: false,
  createdAt: "2026-10-10T15:30:00.000Z",
  updatedAt: "2026-10-10T15:30:00.000Z",
  reviewNote: null,
  internalNote: "Ligar para confirmar",
  answers: [
    { fieldKey: "f_nome", label: "Nome completo", type: "SHORT_TEXT", archived: false, value: "Ana Souza" },
    { fieldKey: "f_nasc", label: "Nascimento", type: "DATE", archived: false, value: "1990-05-17" },
    {
      fieldKey: "f_modal",
      label: "Modalidades",
      type: "MULTI_CHOICE",
      archived: false,
      value: ["Angola", "Regional"],
    },
    { fieldKey: "f_termo", label: "Aceito o termo", type: "CONSENT", archived: false, value: true },
    { fieldKey: "f_vazio", label: "Apelido", type: "SHORT_TEXT", archived: false, value: null },
    {
      fieldKey: "f_comp",
      label: "Comprovante de pagamento",
      type: "FILE",
      archived: false,
      value: [{ fileId: "file1", originalName: "pix.png", mimeType: "image/png" }],
    },
  ],
  files: [
    {
      id: "file1",
      fieldKey: "f_comp",
      originalName: "pix.png",
      mimeType: "image/png",
      sizeBytes: 204800,
    },
  ],
  timeline: [
    { at: "2026-10-10T15:30:00.000Z", action: "SUBMITTED", by: null, userId: null },
    { at: "2026-10-11T09:00:00.000Z", action: "PAYMENT_CONFIRMED", by: "Mestre Zé", userId: 2422 },
  ],
  ...over,
});

/** Detalhe depois de `POST /anonymize`: dados pessoais, respostas e anexos removidos; protocolo e histórico ficam. */
const anonymizedDetail = () =>
  detail({
    name: "Inscrição anonimizada",
    email: null,
    phone: null,
    document: null,
    anonymizedAt: "2026-10-18T12:00:00.000Z",
    internalNote: null,
    answers: [],
    files: [],
  });

let anonymizedNow = false;
let calls: Call[];
let subs: Record<string, unknown>[];
let overrides: Record<string, () => Response | Promise<Response>>;
let totalHeader: string | null;
let noHeader = false;
const writeText = vi.fn().mockResolvedValue(undefined);

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function installFetch() {
  calls = [];
  const handler = (input: string, init?: RequestInit): Response | Promise<Response> => {
    const [path = "", search = ""] = input.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    const query = new URLSearchParams(search);
    calls.push({
      method,
      path,
      query,
      body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const override = overrides[`${method} ${path}`];
    if (override) return override();
    if (method === "GET" && path === "/event-forms/f1/summary") return json(200, SUMMARY);
    if (method === "GET" && path === "/event-forms/f1/submissions") {
      const q = (query.get("q") ?? "").toLowerCase();
      const rows = subs.filter(
        (s) =>
          (!query.get("status") || s["status"] === query.get("status")) &&
          (!query.get("paymentStatus") || s["paymentStatus"] === query.get("paymentStatus")) &&
          (!q || String(s["name"]).toLowerCase().includes(q)),
      );
      // Formato REAL desta rota: objeto { items, total, limit, offset } (+ X-Total-Count), NÃO um array.
      const total = totalHeader ?? String(rows.length);
      const page = {
        items: rows,
        total: Number(total),
        limit: Number(query.get("limit") ?? 50),
        offset: Number(query.get("offset") ?? 0),
      };
      return json(200, page, noHeader ? {} : { "X-Total-Count": total });
    }
    if (method === "GET" && path === "/event-forms/f1/submissions/s1")
      return json(200, anonymizedNow ? anonymizedDetail() : detail());
    if (method === "GET" && path === "/event-forms/f1/submissions/s1/files/file1") {
      return new Response(new Blob(["png"], { type: "image/png" }), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    }
    if (method === "GET" && path === "/event-forms/f1/submissions/export.csv") {
      return new Response("nome;protocolo\r\n", {
        status: 200,
        headers: { "Content-Type": "text/csv" },
      });
    }
    if (method === "POST" && path === "/event-forms/f1/submissions/s1/anonymize") {
      anonymizedNow = true;
      return json(200, anonymizedDetail());
    }
    if (
      method === "POST" &&
      /^\/event-forms\/f1\/submissions\/s1\/(confirm-payment|approve|reject|cancel|waitlist|promote)$/.test(
        path,
      )
    ) {
      return json(201, { ok: true });
    }
    if (method === "PATCH" && path === "/event-forms/f1/submissions/s1")
      return json(200, { ok: true });
    return json(404, { message: "Rota não mockada." });
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => Promise.resolve(handler(input, init))),
  );
}

const sent = (method: string, path: string) =>
  calls.filter((c) => c.method === method && c.path === path);
const listCalls = () => sent("GET", "/event-forms/f1/submissions");

function renderTab(props: { readOnly?: boolean; published?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SubmissionsTab
        formId="f1"
        link={LINK}
        readOnly={props.readOnly ?? false}
        published={props.published ?? true}
      />
    </QueryClientProvider>,
  );
}

async function openDetail(name = "Ana Souza") {
  renderTab();
  fireEvent.click(await screen.findByRole("button", { name: `Abrir inscrição de ${name}` }));
  return screen.findByTestId("submission-sheet");
}

beforeEach(() => {
  loginAs("MESTRE");
  subs = [...SUBS];
  anonymizedNow = false;
  overrides = {};
  totalHeader = null;
  noHeader = false;
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  URL.createObjectURL = vi.fn(() => "blob:mock-1");
  URL.revokeObjectURL = vi.fn();
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  clearSession();
});

describe("Inscrições - resumo e lista", () => {
  it("cartões: total, pendentes, confirmadas, pagas (com valor) e vagas restantes", async () => {
    renderTab();
    const summary = await screen.findByTestId("submissions-summary");
    await waitFor(() => expect(within(summary).getAllByTestId("stat-card")).toHaveLength(5));
    const cards = within(summary)
      .getAllByTestId("stat-card")
      .map((c) => c.textContent);
    expect(cards[0]).toMatch(/Total.*5/);
    expect(cards[1]).toMatch(/Pendentes.*2.*2 aguardando pagamento/);
    expect(cards[2]).toMatch(/Confirmadas.*2.*1 na lista de espera/);
    expect(cards[3]).toMatch(/Pagas.*2.*R\$\s*50,00/);
    expect(cards[4]).toMatch(/Vagas restantes.*10/);
  });

  it("vagas ilimitadas aparecem como 'Sem limite'", async () => {
    overrides["GET /event-forms/f1/summary"] = () => json(200, { ...SUMMARY, spotsLeft: null });
    renderTab();
    expect(await screen.findByText("Sem limite")).toBeInTheDocument();
  });

  it("lista nome, protocolo, data, situação, pagamento e ícone de comprovante", async () => {
    renderTab();
    expect(await screen.findByText("Ana Souza")).toBeInTheDocument();
    const table = within(screen.getByRole("table"));
    expect(table.getByText("INS-7K3Q")).toBeInTheDocument();
    expect(table.getAllByText("Pendente").length).toBeGreaterThan(0);
    expect(table.getByText("Confirmada")).toBeInTheDocument();
    expect(table.getByText("Lista de espera")).toBeInTheDocument();
    expect(table.getByText("Pagamento pendente")).toBeInTheDocument();
    expect(table.getByText("Pago")).toBeInTheDocument();
    expect(table.getAllByText("Com anexo")).toHaveLength(1); // só a Ana enviou arquivo
    expect(table.getAllByText(/10\/10\/2026/).length).toBeGreaterThan(0);
  });

  it("filtros de situação, pagamento e busca (com debounce) vão ao servidor; filtro volta à página 1", async () => {
    totalHeader = "35";
    renderTab();
    await screen.findByText("Ana Souza");
    const first = listCalls()[0]!;
    expect(first.query.get("limit")).toBe("10");
    expect(first.query.get("offset")).toBe("0");
    for (const key of ["q", "status", "paymentStatus"]) expect(first.query.has(key)).toBe(false);
    expect(screen.getByText("Página 1 de 4")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Próxima página"));
    await waitFor(() => expect(listCalls().at(-1)!.query.get("offset")).toBe("10"));

    fireEvent.change(screen.getByLabelText("Filtrar por situação"), {
      target: { value: "PENDING" },
    });
    await waitFor(() => expect(listCalls().at(-1)!.query.get("status")).toBe("PENDING"));
    expect(listCalls().at(-1)!.query.get("offset")).toBe("0");
    fireEvent.change(screen.getByLabelText("Filtrar por pagamento"), {
      target: { value: "CONFIRMED" },
    });
    await waitFor(() => expect(listCalls().at(-1)!.query.get("paymentStatus")).toBe("CONFIRMED"));

    const before = listCalls().length;
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "an" } });
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "ana" } });
    expect(listCalls().length).toBe(before); // dentro do debounce
    await waitFor(() => expect(listCalls().at(-1)!.query.get("q")).toBe("ana"));
    expect(listCalls().filter((c) => c.query.has("q"))).toHaveLength(1);
    expect(listCalls().at(-1)!.query.get("status")).toBe("PENDING");
    expect(listCalls().at(-1)!.query.get("paymentStatus")).toBe("CONFIRMED");
  });

  it("filtro sem resultado mostra mensagem de filtros; sem nenhuma inscrição mostra o estado vazio com 'Copiar link'", async () => {
    subs = [];
    const first = renderTab();
    const empty = await screen.findByTestId("submissions-empty");
    expect(
      within(empty).getByText("Nenhuma inscrição ainda. Compartilhe o link!"),
    ).toBeInTheDocument();
    expect(within(empty).getByText(LINK)).toBeInTheDocument();
    fireEvent.click(within(empty).getByRole("button", { name: "Copiar link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
    first.unmount();

    subs = [...SUBS];
    renderTab();
    await screen.findByText("Ana Souza");
    fireEvent.change(screen.getByLabelText("Filtrar por situação"), {
      target: { value: "REJECTED" },
    });
    expect(await screen.findByText("Nenhuma inscrição com esses filtros.")).toBeInTheDocument();
    expect(screen.queryByTestId("submissions-empty")).toBeNull();
  });

  it("rascunho sem inscrições orienta a publicar antes de divulgar o link (e não oferece copiar o link provisório)", async () => {
    subs = [];
    renderTab({ published: false });
    expect(await screen.findByText(/Publique o formulário/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copiar link" })).toBeNull();
  });

  it("a lista vem como { items, total, limit, offset }: itens e total aparecem (total do corpo se faltar o header)", async () => {
    noHeader = true;
    totalHeader = "35"; // sem header X-Total-Count o total sai de `total` do corpo
    renderTab();
    expect(await screen.findByText("Ana Souza")).toBeInTheDocument();
    expect(screen.getByText("Bruno Lima")).toBeInTheDocument();
    expect(screen.getByText("Página 1 de 4")).toBeInTheDocument();
  });

  it("a lista continua aceitando um array simples (tolerância), com o total no header", async () => {
    overrides["GET /event-forms/f1/submissions"] = () =>
      json(200, SUBS, { "X-Total-Count": "3" });
    renderTab();
    expect(await screen.findByText("Ana Souza")).toBeInTheDocument();
    expect(screen.getByText("Carla Dias")).toBeInTheDocument();
  });

  it("só envia à lista os parâmetros que o backend aceita (limit, offset, q, status, paymentStatus)", async () => {
    renderTab();
    await screen.findByText("Ana Souza");
    fireEvent.change(screen.getByLabelText("Filtrar por situação"), {
      target: { value: "PENDING" },
    });
    await waitFor(() => expect(listCalls().at(-1)!.query.get("status")).toBe("PENDING"));
    const accepted = new Set(["limit", "offset", "q", "status", "paymentStatus"]);
    for (const call of listCalls())
      for (const key of call.query.keys()) expect(accepted.has(key)).toBe(true);
  });

  it("erro na lista tem 'Tentar novamente'; erro no resumo também", async () => {
    overrides["GET /event-forms/f1/submissions"] = () => json(500, { message: "Lista fora." });
    overrides["GET /event-forms/f1/summary"] = () => json(500, { message: "Resumo fora." });
    renderTab();
    expect(await screen.findByText("Lista fora.")).toBeInTheDocument();
    expect(await screen.findByText("Resumo fora.")).toBeInTheDocument();
    delete overrides["GET /event-forms/f1/submissions"];
    delete overrides["GET /event-forms/f1/summary"];
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Ana Souza")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(screen.getAllByTestId("stat-card")).toHaveLength(5));
  });
});

describe("Inscrições - detalhe", () => {
  it("mostra respostas (rótulo → valor), documento mascarado, contatos, histórico e nota interna", async () => {
    const sheet = await openDetail();
    expect(await within(sheet).findByText("ana@exemplo.com")).toBeInTheDocument();
    expect(within(sheet).getByText("***.***.***-25")).toBeInTheDocument();
    expect(within(sheet).getByText("(61) 99999-0000")).toBeInTheDocument();
    const answers = within(sheet).getAllByTestId("submission-answer");
    const asText = answers.map((a) => a.textContent);
    expect(asText).toContain("Nome completoAna Souza");
    expect(asText).toContain("Nascimento17/05/1990");
    expect(asText).toContain("ModalidadesAngola, Regional");
    expect(asText).toContain("Aceito o termoAceito");
    expect(asText).toContain("Apelido—");
    const timeline = within(sheet).getAllByTestId("submission-timeline-entry");
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toHaveTextContent("Inscrição enviada");
    expect(timeline[1]).toHaveTextContent("Pagamento confirmado");
    expect(timeline[1]).toHaveTextContent("Mestre Zé");
    expect(within(sheet).getByLabelText("Nota interna")).toHaveValue("Ligar para confirmar");
    expect(within(sheet).getByText("Protocolo", { exact: false })).toBeInTheDocument();
  });

  it("'Ver comprovante' baixa o arquivo com a sessão (Authorization) e mostra a imagem inline", async () => {
    const sheet = await openDetail();
    expect(await within(sheet).findByText("pix.png")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Ver comprovante pix.png" }));
    const viewer = await screen.findByTestId("file-viewer");
    const image = await within(viewer).findByAltText("Comprovante: pix.png");
    expect(image).toHaveAttribute("src", "blob:mock-1");
    const fileCall = sent("GET", "/event-forms/f1/submissions/s1/files/file1");
    expect(fileCall).toHaveLength(1);
    expect(fileCall[0]!.headers["Authorization"]).toBe("Bearer tok");
    expect(within(viewer).getByRole("link", { name: /Abrir em outra aba/ })).toHaveAttribute(
      "href",
      "blob:mock-1",
    );
    expect(within(viewer).getByRole("link", { name: /Baixar/ })).toHaveAttribute(
      "download",
      "pix.png",
    );
  });

  const fileDetail = (originalName: string, mimeType: string) => () =>
    json(
      200,
      detail({
        files: [{ id: "file1", fieldKey: "f_comp", originalName, mimeType, sizeBytes: 1048576 }],
      }),
    );
  const lastBlobType = () =>
    (URL.createObjectURL as unknown as { mock: { calls: [Blob][] } }).mock.calls.at(-1)![0].type;

  it("PDF NÃO é embutido (nenhum iframe): só 'Abrir em outra aba' e 'Baixar', com o blob tipado como PDF", async () => {
    overrides["GET /event-forms/f1/submissions/s1"] = fileDetail(
      "comprovante.pdf",
      "application/pdf",
    );
    overrides["GET /event-forms/f1/submissions/s1/files/file1"] = () =>
      new Response(new Blob(["%PDF"], { type: "application/pdf" }), { status: 200 });
    const sheet = await openDetail();
    fireEvent.click(
      await within(sheet).findByRole("button", { name: "Ver comprovante comprovante.pdf" }),
    );
    const viewer = await screen.findByTestId("file-viewer");
    expect(await within(viewer).findByTestId("file-no-preview")).toHaveTextContent("PDF");
    expect(viewer.querySelector("iframe, object, embed")).toBeNull();
    const open = within(viewer).getByRole("link", { name: /Abrir em outra aba/ });
    expect(open).toHaveAttribute("href", "blob:mock-1");
    expect(open).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(lastBlobType()).toBe("application/pdf");
  });

  it("tipo fora da lista segura (HTML/SVG disfarçado) vira binário opaco: sem pré-visualização e sem 'Abrir em outra aba'", async () => {
    overrides["GET /event-forms/f1/submissions/s1"] = fileDetail("comprovante.html", "text/html");
    overrides["GET /event-forms/f1/submissions/s1/files/file1"] = () =>
      new Response(new Blob(["<script>alert(1)</script>"], { type: "text/html" }), {
        status: 200,
      });
    const sheet = await openDetail();
    fireEvent.click(
      await within(sheet).findByRole("button", { name: "Ver comprovante comprovante.html" }),
    );
    const viewer = await screen.findByTestId("file-viewer");
    expect(await within(viewer).findByTestId("file-no-preview")).toHaveTextContent("Baixar");
    expect(viewer.querySelector("iframe, object, embed, img")).toBeNull();
    expect(within(viewer).queryByRole("link", { name: /Abrir em outra aba/ })).toBeNull();
    expect(within(viewer).getByRole("link", { name: /Baixar/ })).toBeInTheDocument();
    expect(lastBlobType()).toBe("application/octet-stream");
  });

  it("falha ao baixar o comprovante: 403 mostra 'Somente o Mestre…' e 'Tentar de novo' recarrega", async () => {
    overrides["GET /event-forms/f1/submissions/s1/files/file1"] = () =>
      json(403, { message: "Sem acesso." });
    const sheet = await openDetail();
    fireEvent.click(await within(sheet).findByRole("button", { name: "Ver comprovante pix.png" }));
    const viewer = await screen.findByTestId("file-viewer");
    expect(await within(viewer).findByRole("alert")).toHaveTextContent(
      "Somente o Mestre pode ver os comprovantes.",
    );
    delete overrides["GET /event-forms/f1/submissions/s1/files/file1"];
    fireEvent.click(within(viewer).getByRole("button", { name: "Tentar de novo" }));
    expect(await within(viewer).findByAltText("Comprovante: pix.png")).toBeInTheDocument();
  });

  it("erro ao abrir o detalhe mostra a mensagem e permite tentar de novo", async () => {
    overrides["GET /event-forms/f1/submissions/s1"] = () =>
      json(404, { message: "Inscrição sumiu." });
    const sheet = await openDetail();
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Inscrição não encontrada.");
    delete overrides["GET /event-forms/f1/submissions/s1"];
    fireEvent.click(within(sheet).getByRole("button", { name: "Tentar de novo" }));
    expect(await within(sheet).findByText("ana@exemplo.com")).toBeInTheDocument();
  });

  it("nota interna: só habilita 'Salvar nota' ao mudar e envia PATCH { internalNote }", async () => {
    const sheet = await openDetail();
    const note = await within(sheet).findByLabelText("Nota interna");
    const save = within(sheet).getByRole("button", { name: "Salvar nota" });
    expect(save).toBeDisabled();
    fireEvent.change(note, { target: { value: "Pagou em dinheiro" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(sent("PATCH", "/event-forms/f1/submissions/s1")).toHaveLength(1));
    expect(sent("PATCH", "/event-forms/f1/submissions/s1")[0]!.body).toEqual({
      internalNote: "Pagou em dinheiro",
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Nota salva."));
  });
});

describe("Inscrições - ações", () => {
  const post = (action: string) => sent("POST", `/event-forms/f1/submissions/s1/${action}`);

  it("inscrição pendente com pagamento pendente oferece as ações certas e cada uma chama a rota certa", async () => {
    const sheet = await openDetail();
    const group = await within(sheet).findByRole("group", { name: "Ações da inscrição" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      "Confirmar pagamento",
      "Aprovar",
      "Lista de espera",
      "Recusar",
      "Cancelar inscrição",
    ]);

    fireEvent.click(within(group).getByRole("button", { name: "Confirmar pagamento" }));
    await waitFor(() => expect(post("confirm-payment")).toHaveLength(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pagamento confirmado."));

    // o estado otimista esconde botões por um instante; espera a tela reagir antes de cada clique
    fireEvent.click(await within(sheet).findByRole("button", { name: "Aprovar" }));
    await waitFor(() => expect(post("approve")).toHaveLength(1));
    fireEvent.click(await within(sheet).findByRole("button", { name: "Lista de espera" }));
    await waitFor(() => expect(post("waitlist")).toHaveLength(1));
  });

  it("Recusar pede o motivo (opcional) e envia { reason }; sem motivo o corpo vai vazio", async () => {
    const sheet = await openDetail();
    fireEvent.click(await within(sheet).findByRole("button", { name: "Recusar" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(post("reject")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText("Motivo (opcional)"), {
      target: { value: " Sem vaga " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Recusar inscrição" }));
    await waitFor(() => expect(post("reject")).toHaveLength(1));
    expect(post("reject")[0]!.body).toEqual({ reason: "Sem vaga" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    fireEvent.click(await within(sheet).findByRole("button", { name: "Recusar" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Recusar inscrição",
      }),
    );
    await waitFor(() => expect(post("reject")).toHaveLength(2));
    expect(post("reject")[1]!.body).toEqual({});
  });

  it("Cancelar inscrição pede confirmação antes do POST", async () => {
    const sheet = await openDetail();
    fireEvent.click(await within(sheet).findByRole("button", { name: "Cancelar inscrição" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(post("cancel")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(post("cancel")).toHaveLength(0);

    fireEvent.click(within(sheet).getByRole("button", { name: "Cancelar inscrição" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Cancelar inscrição",
      }),
    );
    await waitFor(() => expect(post("cancel")).toHaveLength(1));
  });

  it("lista de espera: oferece Promover (e Recusar/Cancelar); formulário arquivado não tem ações", () => {
    expect(
      availableActions({ status: "WAITLIST", paymentStatus: "NOT_REQUIRED" }).map((a) => a.action),
    ).toEqual(["promote", "reject", "cancel"]);
    expect(
      availableActions({ status: "CONFIRMED", paymentStatus: "CONFIRMED" }).map((a) => a.action),
    ).toEqual(["cancel"]);
    expect(availableActions({ status: "REJECTED", paymentStatus: "PENDING" })).toEqual([]);
    expect(availableActions({ status: "CANCELLED", paymentStatus: "NOT_REQUIRED" })).toEqual([]);
  });

  it("Promover chama POST /promote", async () => {
    overrides["GET /event-forms/f1/submissions/s1"] = () =>
      json(200, detail({ status: "WAITLIST", paymentStatus: "NOT_REQUIRED" }));
    const sheet = await openDetail();
    fireEvent.click(await within(sheet).findByRole("button", { name: "Promover" }));
    await waitFor(() => expect(post("promote")).toHaveLength(1));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Inscrição promovida da lista de espera."),
    );
  });

  it("atualização otimista: o badge muda na hora e volta atrás se o servidor recusar", async () => {
    let release: (r: Response) => void = () => undefined;
    overrides["POST /event-forms/f1/submissions/s1/approve"] = () =>
      new Promise<Response>((resolve) => (release = resolve));
    const sheet = await openDetail();
    // a folha aberta esconde a tabela da árvore de acessibilidade (aria-hidden): busca as linhas mesmo assim
    const row = (await screen.findAllByRole("row", { hidden: true })).find((r) =>
      within(r).queryByText("INS-7K3Q"),
    )!;
    expect(within(row).getByText("Pendente")).toBeInTheDocument();
    fireEvent.click(await within(sheet).findByRole("button", { name: "Aprovar" }));
    await waitFor(() => expect(within(row).getByText("Confirmada")).toBeInTheDocument()); // antes da resposta
    release(json(409, { message: "Evento lotado." }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Evento lotado."));
    await waitFor(() => expect(within(row).getByText("Pendente")).toBeInTheDocument());
  });

  it("depois de uma ação, lista, resumo e detalhe são buscados de novo", async () => {
    const sheet = await openDetail();
    await within(sheet).findByText("ana@exemplo.com");
    const lists = listCalls().length;
    const summaries = sent("GET", "/event-forms/f1/summary").length;
    const details = sent("GET", "/event-forms/f1/submissions/s1").length;
    fireEvent.click(within(sheet).getByRole("button", { name: "Confirmar pagamento" }));
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(lists));
    await waitFor(() =>
      expect(sent("GET", "/event-forms/f1/summary").length).toBeGreaterThan(summaries),
    );
    await waitFor(() =>
      expect(sent("GET", "/event-forms/f1/submissions/s1").length).toBeGreaterThan(details),
    );
  });

  it("formulário arquivado: o detalhe abre sem botões de ação e a nota fica só leitura", async () => {
    renderTab({ readOnly: true });
    fireEvent.click(await screen.findByRole("button", { name: "Abrir inscrição de Ana Souza" }));
    const sheet = await screen.findByTestId("submission-sheet");
    expect(await within(sheet).findByText("ana@exemplo.com")).toBeInTheDocument();
    expect(within(sheet).queryByRole("group", { name: "Ações da inscrição" })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "Salvar nota" })).toBeNull();
    expect(within(sheet).getByLabelText("Nota interna")).toBeDisabled();
    // ver o comprovante continua possível
    expect(
      within(sheet).getByRole("button", { name: "Ver comprovante pix.png" }),
    ).toBeInTheDocument();
  });
});

describe("Inscrições - exportar CSV", () => {
  it("baixa pelo fetch autenticado e entrega como arquivo, COM os filtros atuais (status, paymentStatus, q)", async () => {
    const clicked: string[] = [];
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      (tag: string, options?: ElementCreationOptions) => {
        const element = originalCreate(tag, options);
        if (tag === "a")
          element.click = () => clicked.push((element as HTMLAnchorElement).download);
        return element;
      },
    );
    renderTab();
    await screen.findByText("Ana Souza");
    fireEvent.change(screen.getByLabelText("Filtrar por situação"), {
      target: { value: "PENDING" },
    });
    await waitFor(() => expect(listCalls().at(-1)!.query.get("status")).toBe("PENDING"));
    fireEvent.change(screen.getByLabelText("Filtrar por pagamento"), {
      target: { value: "PENDING" },
    });
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: " ana " } });
    await waitFor(() => expect(listCalls().at(-1)!.query.get("q")).toBe("ana"));
    // o rótulo diz que o arquivo respeita o filtro da tela
    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV (filtro atual)" }));
    await waitFor(() =>
      expect(sent("GET", "/event-forms/f1/submissions/export.csv")).toHaveLength(1),
    );
    const call = sent("GET", "/event-forms/f1/submissions/export.csv")[0]!;
    expect(Object.fromEntries(call.query)).toEqual({
      status: "PENDING",
      paymentStatus: "PENDING",
      q: "ana",
    }); // sem paginação/ordenação: o arquivo traz tudo que casa com o filtro
    expect(call.headers["Authorization"]).toBe("Bearer tok");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Arquivo CSV gerado."));
    expect(clicked.some((name) => /^inscricoes-\d{4}-\d{2}-\d{2}\.csv$/.test(name))).toBe(true);
  });

  it("sem filtro nenhum, o CSV vai sem parâmetros", async () => {
    renderTab();
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: /Exportar CSV/ }));
    await waitFor(() =>
      expect(sent("GET", "/event-forms/f1/submissions/export.csv")).toHaveLength(1),
    );
    expect([...sent("GET", "/event-forms/f1/submissions/export.csv")[0]!.query.keys()]).toEqual([]);
  });

  it("403 na exportação vira a mensagem amigável 'Somente o Mestre…'; outro erro mantém a do servidor", async () => {
    overrides["GET /event-forms/f1/submissions/export.csv"] = () =>
      json(403, { message: "Forbidden resource" });
    renderTab();
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: /Exportar CSV/ }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Somente o Mestre pode exportar as inscrições em CSV."),
    );
    overrides["GET /event-forms/f1/submissions/export.csv"] = () =>
      json(500, { message: "Banco fora." });
    fireEvent.click(screen.getByRole("button", { name: /Exportar CSV/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Banco fora."));
  });
});

describe("Inscrições - papel (só o Mestre vê comprovante, CSV e confirma pagamento)", () => {
  beforeEach(() => {
    clearSession();
    loginAs("PROFESSOR");
  });
  const post = (action: string) => sent("POST", `/event-forms/f1/submissions/s1/${action}`);

  it("PROFESSOR não vê 'Exportar CSV'", async () => {
    renderTab();
    await screen.findByText("Ana Souza");
    expect(screen.queryByRole("button", { name: /Exportar CSV/ })).toBeNull();
  });

  it("PROFESSOR: sem 'Confirmar pagamento' nem 'Ver comprovante'; vê a nota 'Somente o Mestre vê comprovantes' (filesRestricted)", async () => {
    // o servidor manda `files` vazio e `filesRestricted: true` para quem não é Mestre
    overrides["GET /event-forms/f1/submissions/s1"] = () =>
      json(200, detail({ files: [], filesRestricted: true }));
    const sheet = await openDetail();
    const group = await within(sheet).findByRole("group", { name: "Ações da inscrição" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Aprovar", "Lista de espera", "Recusar", "Cancelar inscrição"]);
    expect(within(sheet).queryByRole("button", { name: /Ver comprovante/ })).toBeNull();
    expect(within(sheet).getByTestId("files-restricted")).toHaveTextContent(
      "Somente o Mestre vê comprovantes.",
    );
    // aprovar continua funcionando
    fireEvent.click(within(group).getByRole("button", { name: "Aprovar" }));
    await waitFor(() => expect(post("approve")).toHaveLength(1));
  });

  it("mesmo que o servidor mande os anexos, o PROFESSOR não ganha o botão de ver comprovante", async () => {
    const sheet = await openDetail();
    expect(await within(sheet).findByText("pix.png")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /Ver comprovante/ })).toBeNull();
    expect(within(sheet).getByTestId("files-restricted")).toBeInTheDocument();
  });

  it("MESTRE (filesRestricted false): tem o botão de ver comprovante e nenhuma nota de restrição", async () => {
    clearSession();
    loginAs("MESTRE");
    const sheet = await openDetail();
    expect(
      await within(sheet).findByRole("button", { name: "Ver comprovante pix.png" }),
    ).toBeInTheDocument();
    expect(within(sheet).queryByTestId("files-restricted")).toBeNull();
  });

  it("403 ao confirmar pagamento (papel mudou no servidor) mostra a mensagem do Mestre", async () => {
    clearSession();
    loginAs("MESTRE");
    overrides["POST /event-forms/f1/submissions/s1/confirm-payment"] = () =>
      json(403, { message: "Forbidden resource" });
    const sheet = await openDetail();
    fireEvent.click(await within(sheet).findByRole("button", { name: "Confirmar pagamento" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Somente o Mestre pode confirmar pagamentos."),
    );
  });
});

describe("Inscrições - vínculo com o aluno do mesmo CPF", () => {
  const post = (action: string) => sent("POST", `/event-forms/f1/submissions/s1/${action}`);
  beforeEach(() => {
    overrides["GET /event-forms/f1/submissions/s1"] = () =>
      json(200, detail({ suggestedStudent: { id: 42, name: "Ana Souza Lima" } }));
  });

  it("mostra a faixa 'Este CPF pertence ao aluno…'; sem marcar nada, o diálogo abre com o checkbox DESMARCADO e o POST vai sem corpo", async () => {
    const sheet = await openDetail();
    expect(await within(sheet).findByTestId("student-suggestion")).toHaveTextContent(
      "Este CPF pertence ao aluno Ana Souza Lima. Vincular à ficha dele?",
    );
    fireEvent.click(within(sheet).getByRole("button", { name: "Aprovar" }));
    const dialog = await screen.findByRole("alertdialog");
    const box = within(dialog).getByRole("checkbox", { name: "Vincular ao aluno Ana Souza Lima" });
    expect(box).not.toBeChecked();
    expect(post("approve")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Aprovar" }));
    await waitFor(() => expect(post("approve")).toHaveLength(1));
    expect(post("approve")[0]!.body).toBeUndefined();
  });

  it("marcar o checkbox no diálogo de 'Confirmar pagamento' envia { linkStudentId }", async () => {
    const sheet = await openDetail();
    fireEvent.click(await within(sheet).findByRole("button", { name: "Confirmar pagamento" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Vincular ao aluno/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar pagamento" }));
    await waitFor(() => expect(post("confirm-payment")).toHaveLength(1));
    expect(post("confirm-payment")[0]!.body).toEqual({ linkStudentId: 42 });
  });

  it("o botão 'Vincular' da faixa pré-marca o checkbox; 'Desfazer' tira a marca", async () => {
    const sheet = await openDetail();
    const banner = await within(sheet).findByTestId("student-suggestion");
    fireEvent.click(within(banner).getByRole("button", { name: /Vincular/ }));
    expect(banner).toHaveTextContent("Vínculo marcado");
    fireEvent.click(within(sheet).getByRole("button", { name: "Aprovar" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("checkbox", { name: /Vincular ao aluno/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Aprovar" }));
    await waitFor(() => expect(post("approve")).toHaveLength(1));
    expect(post("approve")[0]!.body).toEqual({ linkStudentId: 42 });
  });

  it("sem suggestedStudent: nenhuma faixa e a ação vai direto, sem diálogo", async () => {
    overrides["GET /event-forms/f1/submissions/s1"] = () => json(200, detail());
    const sheet = await openDetail();
    await within(sheet).findByRole("button", { name: "Aprovar" });
    expect(within(sheet).queryByTestId("student-suggestion")).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "Aprovar" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(post("approve")).toHaveLength(1));
  });
});

describe("Inscrições - anonimizar", () => {
  const post = (action: string) => sent("POST", `/event-forms/f1/submissions/s1/${action}`);

  it("MESTRE: exige digitar APAGAR, explica o que some e depois mostra o selo 'Anonimizada' com as ações desabilitadas", async () => {
    const sheet = await openDetail();
    fireEvent.click(await within(sheet).findByRole("button", { name: "Anonimizar inscrição" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "Remove nome, contatos, respostas e comprovantes; mantém o protocolo e a contagem. Não pode ser desfeito.",
    );
    const confirm = within(dialog).getByRole("button", { name: "Anonimizar definitivamente" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "apagar" } });
    expect(confirm).toBeEnabled();
    expect(post("anonymize")).toHaveLength(0);
    fireEvent.click(confirm);
    await waitFor(() => expect(post("anonymize")).toHaveLength(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Inscrição anonimizada."));
    expect(await within(sheet).findByTestId("anonymized-badge")).toHaveTextContent("Anonimizada");
    expect(within(sheet).getByTestId("anonymized-notice")).toBeInTheDocument();
    for (const button of within(
      within(sheet).getByRole("group", { name: "Ações da inscrição" }),
    ).getAllByRole("button"))
      expect(button).toBeDisabled();
    expect(within(sheet).queryByRole("button", { name: "Anonimizar inscrição" })).toBeNull();
    expect(within(sheet).getByLabelText("Nota interna")).toBeDisabled();
    expect(within(sheet).queryByRole("button", { name: /Ver comprovante/ })).toBeNull();
  });

  it("403 na anonimização mostra a mensagem do Mestre e o diálogo continua aberto", async () => {
    overrides["POST /event-forms/f1/submissions/s1/anonymize"] = () =>
      json(403, { message: "Forbidden resource" });
    const sheet = await openDetail();
    fireEvent.click(await within(sheet).findByRole("button", { name: "Anonimizar inscrição" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "APAGAR" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Anonimizar definitivamente" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Somente o Mestre pode anonimizar inscrições."),
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("o PROFESSOR não vê 'Anonimizar inscrição'", async () => {
    clearSession();
    loginAs("PROFESSOR");
    const sheet = await openDetail();
    await within(sheet).findByText("ana@exemplo.com");
    expect(within(sheet).queryByRole("button", { name: "Anonimizar inscrição" })).toBeNull();
  });
});

describe("Inscrições - aviso de retenção em modo de teste", () => {
  const retention = (mode: string) => () =>
    json(200, { ...SUMMARY, retention: { mode, months: 12 } });

  it("dry-run: o MESTRE vê o aviso discreto com o número de meses", async () => {
    overrides["GET /event-forms/f1/summary"] = retention("dry-run");
    renderTab();
    expect(await screen.findByTestId("retention-dry-run")).toHaveTextContent(
      "A limpeza automática de dados (retenção de 12 meses) está em modo de teste neste servidor e ainda não apaga nada. Fale com quem administra o servidor.",
    );
  });

  it("modo 'true', 'false' ou ausente: sem aviso", async () => {
    overrides["GET /event-forms/f1/summary"] = retention("true");
    const first = renderTab();
    await waitFor(() => expect(screen.getAllByTestId("stat-card")).toHaveLength(5));
    expect(screen.queryByTestId("retention-dry-run")).toBeNull();
    first.unmount();
    overrides["GET /event-forms/f1/summary"] = retention("false");
    const second = renderTab();
    await waitFor(() => expect(screen.getAllByTestId("stat-card")).toHaveLength(5));
    expect(screen.queryByTestId("retention-dry-run")).toBeNull();
    second.unmount();
    delete overrides["GET /event-forms/f1/summary"];
    renderTab();
    await waitFor(() => expect(screen.getAllByTestId("stat-card")).toHaveLength(5));
    expect(screen.queryByTestId("retention-dry-run")).toBeNull();
  });

  it("dry-run: o PROFESSOR não vê o aviso (é assunto de quem administra)", async () => {
    clearSession();
    loginAs("PROFESSOR");
    overrides["GET /event-forms/f1/summary"] = retention("dry-run");
    renderTab();
    await waitFor(() => expect(screen.getAllByTestId("stat-card")).toHaveLength(5));
    expect(screen.queryByTestId("retention-dry-run")).toBeNull();
  });
});

describe("Inscrições - sem link público", () => {
  it("publicUrl null (link = null) com formulário aberto: estado vazio orienta a publicar e não oferece copiar", async () => {
    subs = [];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SubmissionsTab formId="f1" link={null} readOnly={false} published />
      </QueryClientProvider>,
    );
    const empty = await screen.findByTestId("submissions-empty");
    expect(within(empty).getByText(/Publique o formulário/)).toBeInTheDocument();
    expect(within(empty).queryByRole("button", { name: "Copiar link" })).toBeNull();
  });
});

describe("formatAnswer", () => {
  it("formata data, lista, aceite, booleano e vazio", () => {
    expect(formatAnswer({ type: "DATE", value: "2026-01-09" })).toBe("09/01/2026");
    expect(formatAnswer({ type: "MULTI_CHOICE", value: ["A", "B"] })).toBe("A, B");
    expect(formatAnswer({ type: "CONSENT", value: true })).toBe("Aceito");
    expect(formatAnswer({ type: "CONSENT", value: false })).toBe("Não aceito");
    expect(formatAnswer({ type: "NUMBER", value: 0 })).toBe("0");
    expect(formatAnswer({ type: "SHORT_TEXT", value: null })).toBe("—");
    expect(formatAnswer({ type: "MULTI_CHOICE", value: [] })).toBe("—");
  });

  it("anexo (FILE) vem do servidor como lista { fileId, originalName, mimeType } e vira o nome do arquivo", () => {
    expect(
      formatAnswer({
        type: "FILE",
        value: [{ fileId: 21, originalName: "comprovante.png", mimeType: "image/png" }],
      }),
    ).toBe("comprovante.png");
    expect(formatAnswer({ type: "FILE", value: null })).toBe("—");
  });

  it("telefone sai em dígitos do servidor e aparece com máscara", () => {
    expect(formatPhone("62999991001")).toBe("(62) 99999-1001");
    expect(formatPhone("6233334444")).toBe("(62) 3333-4444");
    expect(formatPhone("+55 62 99999-1001")).toBe("+55 62 99999-1001");
    expect(formatAnswer({ type: "PHONE", value: "62999991001" })).toBe("(62) 99999-1001");
  });
});
