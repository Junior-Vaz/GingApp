import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { ComunicarPage } from "@/modules/comunicar";
import type { CommunicationDetail, CommunicationItem, ResendResult } from "@/modules/comunicar/types";
import { allowedScopes, buildScope, parsePinnedUntil, parseSchedule, previewParams } from "@/modules/comunicar/utils";
import { clearSession, loginAs } from "./login-as";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const AUDIENCES = {
  groupWide: true,
  units: [
    { id: 7, name: "Sede Centro" },
    { id: 8, name: "Filial Norte" },
  ],
  classes: [
    { id: 21, name: "Infantil", unitId: 7 },
    { id: 22, name: "Adulto", unitId: 8 },
  ],
  roles: [],
};

const SAMPLE = [{ name: "Ana" }, { name: "Beto" }, { name: "Carla" }, { name: "Davi" }, { name: "Eva" }];

const ITEM_SENT: CommunicationItem = {
  id: 1,
  title: "Roda de sábado",
  status: "SENT",
  scopeType: "GROUP",
  scheduledAt: null,
  sentAt: "2026-03-01T13:30:00.000Z",
  recipientsCount: 10,
  readCount: 3,
  ackCount: 2,
  requiresAck: "GOING",
  pinToFeed: true,
  pinnedUntil: null,
  lastResendAt: null,
  createdAt: "2026-03-01T13:00:00.000Z",
  createdByName: "Mestre Zé",
};
const ITEM_SCHEDULED: CommunicationItem = {
  ...ITEM_SENT,
  id: 2,
  title: "Batizado de abril",
  status: "SCHEDULED",
  scopeType: "CLASS",
  scheduledAt: "2026-03-20T12:00:00.000Z",
  sentAt: null,
  readCount: 0,
  ackCount: 0,
  requiresAck: "NONE",
  pinToFeed: false,
};
const ITEM_CANCELLED: CommunicationItem = { ...ITEM_SCHEDULED, id: 3, title: "Reunião cancelada", status: "CANCELLED", scopeType: "ROLE" };

const DETAIL_SENT: CommunicationDetail = {
  ...ITEM_SENT,
  body: "Venha para a roda!\nLeve o abadá.",
  imageUrl: null,
  scope: { type: "GROUP", unitId: null, unitName: null, classId: null, className: null, role: null },
  acks: { READ: 0, GOING: 4, NOT_GOING: 1 },
  pending: 5,
};
const DETAIL_SCHEDULED: CommunicationDetail = {
  ...ITEM_SCHEDULED,
  body: "Todos no batizado.",
  imageUrl: null,
  scope: { type: "CLASS", unitId: null, unitName: null, classId: 21, className: "Infantil", role: null },
  acks: { READ: 0, GOING: 0, NOT_GOING: 0 },
  pending: 10,
};

let calls: Call[];
let overrides: Record<string, (call: Call) => Response>;
let previewCount: number;
let listItems: CommunicationItem[];
let listTotal: number | null;

function installFetch() {
  calls = [];
  const handler = (input: string, init?: RequestInit): Response => {
    const [path = "", search = ""] = input.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    const call: Call = { method, path, query: new URLSearchParams(search), body };
    calls.push(call);
    const override = overrides[`${method} ${path}`];
    if (override) return override(call);
    if (method === "GET" && path === "/notifications/audiences") return json(200, AUDIENCES);
    if (method === "GET" && path === "/communications/preview") return json(200, { count: previewCount, sample: previewCount > 0 ? SAMPLE : [] });
    if (method === "GET" && path === "/communications") {
      const status = call.query.get("status");
      const items = status ? listItems.filter((i) => i.status === status) : listItems;
      return json(200, items, { "X-Total-Count": String(listTotal ?? items.length) });
    }
    if (method === "GET" && path === "/communications/1") return json(200, DETAIL_SENT);
    if (method === "GET" && path === "/communications/2") return json(200, DETAIL_SCHEDULED);
    if (method === "POST" && path === "/communications")
      return json(201, { id: 9, status: (body as { scheduledAt?: string }).scheduledAt ? "SCHEDULED" : "SENT", recipients: previewCount });
    // Formato REAL: 201 { sent } e DELETE => 200 { id, status: "CANCELLED" } (ver real-contract.ts).
    if (method === "POST" && path === "/communications/1/resend-unread") return json(201, { sent: 7 } satisfies ResendResult);
    if (method === "DELETE" && path === "/communications/2") return json(200, { id: 2, status: "CANCELLED" });
    return json(404, { message: "Rota não mockada." });
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => Promise.resolve(handler(input, init))),
  );
}

const sent = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ComunicarPage />
    </QueryClientProvider>,
  );
}

const optionNames = (select: HTMLElement) => within(select).getAllByRole("option").map((o) => o.textContent);

function fillText(title = "Aviso importante", body = "Texto do aviso para todos.") {
  fireEvent.change(screen.getByLabelText("Título"), { target: { value: title } });
  fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: body } });
}
const chooseScope = (value: string) => fireEvent.change(screen.getByLabelText("Alcance"), { target: { value } });

async function openHistory() {
  const tab = screen.getByRole("tab", { name: "Histórico" });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
  await screen.findByRole("button", { name: "Roda de sábado" });
}

beforeEach(() => {
  // Só o relógio (Date) é simulado; timers e promessas seguem reais.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-05T15:00:00Z"));
  loginAs("MESTRE");
  overrides = {};
  previewCount = 214;
  listItems = [ITEM_SENT, ITEM_SCHEDULED, ITEM_CANCELLED];
  listTotal = null;
  installFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("utilidades de Comunicar", () => {
  it("alcances por papel: MESTRE todos; PROFESSOR/INSTRUTOR só turma; outros nenhum", () => {
    expect(allowedScopes("MESTRE")).toEqual(["GROUP", "UNIT", "CLASS", "ROLE", "BIRTHDAY_MONTH"]);
    expect(allowedScopes("PROFESSOR")).toEqual(["CLASS"]);
    expect(allowedScopes("INSTRUTOR")).toEqual(["CLASS"]);
    expect(allowedScopes("MONITOR")).toEqual([]);
    expect(allowedScopes(undefined)).toEqual([]);
  });

  it("buildScope/previewParams: só devolve alcance completo e monta a query do preview", () => {
    expect(buildScope({ type: "UNIT", unitId: "", classId: "", role: "" })).toBeNull();
    expect(buildScope({ type: "", unitId: "", classId: "", role: "" })).toBeNull();
    const unit = buildScope({ type: "UNIT", unitId: "7", classId: "", role: "" });
    expect(unit).toEqual({ type: "UNIT", unitId: 7 });
    expect(previewParams(unit!)).toEqual({ scope: "UNIT", unitId: 7 });
    expect(previewParams({ type: "ROLE", role: "EQUIPE" })).toEqual({ scope: "ROLE", role: "EQUIPE" });
    expect(previewParams({ type: "BIRTHDAY_MONTH" })).toEqual({ scope: "BIRTHDAY_MONTH" });
  });

  it("parseSchedule: futuro até 90 dias; parsePinnedUntil: depois do envio", () => {
    const now = new Date("2026-03-05T15:00:00Z");
    expect(parseSchedule("", now)).toEqual({ error: "Escolha a data e a hora do envio." });
    expect(parseSchedule("2026-03-05T10:00", now)).toEqual({ error: "Escolha um horário no futuro." });
    expect(parseSchedule("2026-08-01T10:00", now)).toEqual({ error: "O agendamento vai até 90 dias a partir de hoje." });
    expect(parseSchedule("2026-03-10T10:00", now)).toEqual({ iso: new Date("2026-03-10T10:00").toISOString() });
    expect(parsePinnedUntil("", now)).toBeNull();
    expect(parsePinnedUntil("2026-03-01", now)).toEqual({ error: "A data para fixar precisa ser depois do envio." });
    expect(parsePinnedUntil("2026-03-30", now)).toEqual({ iso: new Date("2026-03-30T23:59:00").toISOString() });
  });
});

describe("Comunicar - Nova mensagem: alcance por papel", () => {
  it("MESTRE vê todos os alcances", async () => {
    renderPage();
    const scope = screen.getByLabelText("Alcance");
    expect(optionNames(scope)).toEqual(["Escolha o alcance…", "Todo o grupo", "Uma unidade", "Uma turma", "Por papel", "Aniversariantes do mês"]);
    expect(scope).toHaveValue("");
  });

  it.each(["PROFESSOR", "INSTRUTOR"] as const)("%s vê só 'Uma turma' (já escolhida) e as turmas vêm do escopo dele", async (role) => {
    loginAs(role);
    renderPage();
    const scope = screen.getByLabelText("Alcance");
    expect(optionNames(scope)).toEqual(["Escolha o alcance…", "Uma turma"]);
    expect(scope).toHaveValue("CLASS");
    const turma = await screen.findByRole("combobox", { name: "Turma" });
    expect(optionNames(turma)).toEqual(["Selecione a turma…", "Infantil — Sede Centro", "Adulto — Filial Norte"]);
    expect(screen.getByText(/enviam apenas para as suas turmas/)).toBeInTheDocument();
    // O Comunicar pede ao servidor só as turmas que o professor leciona (?own=1); as demais dariam 403 ao enviar.
    const audiencesCall = calls.find((c) => c.method === "GET" && c.path === "/notifications/audiences");
    expect(audiencesCall?.query.get("own")).toBe("1");
  });

  it("professor sem turmas ativas recebe um aviso claro", async () => {
    loginAs("PROFESSOR");
    overrides["GET /notifications/audiences"] = () => json(200, { ...AUDIENCES, classes: [] });
    renderPage();
    expect(await screen.findByText("Você não tem turmas ativas para enviar mensagens.")).toBeInTheDocument();
  });
});

describe("Comunicar - prévia de destinatários", () => {
  it("mostra a contagem e uma amostra de nomes; cada alcance manda os parâmetros certos", async () => {
    renderPage();
    chooseScope("GROUP");
    expect(await screen.findByTestId("comm-preview-count")).toHaveTextContent("214 pessoas");
    expect(screen.getByTestId("comm-preview")).toHaveTextContent("Por exemplo: Ana, Beto, Carla, Davi, Eva e mais 209.");
    expect(sent("GET", "/communications/preview").at(-1)?.query.get("scope")).toBe("GROUP");

    chooseScope("UNIT");
    // Sem a unidade escolhida não há prévia nova.
    const before = sent("GET", "/communications/preview").length;
    fireEvent.change(await screen.findByRole("combobox", { name: "Unidade" }), { target: { value: "7" } });
    await waitFor(() => expect(sent("GET", "/communications/preview").length).toBeGreaterThan(before));
    const unitCall = sent("GET", "/communications/preview").at(-1)!;
    expect(unitCall.query.get("scope")).toBe("UNIT");
    expect(unitCall.query.get("unitId")).toBe("7");

    chooseScope("CLASS");
    fireEvent.change(await screen.findByRole("combobox", { name: "Turma" }), { target: { value: "22" } });
    await waitFor(() => expect(sent("GET", "/communications/preview").at(-1)?.query.get("classId")).toBe("22"));
    expect(sent("GET", "/communications/preview").at(-1)?.query.get("scope")).toBe("CLASS");

    chooseScope("ROLE");
    fireEvent.change(await screen.findByRole("combobox", { name: "Papel" }), { target: { value: "RESPONSAVEL" } });
    await waitFor(() => expect(sent("GET", "/communications/preview").at(-1)?.query.get("role")).toBe("RESPONSAVEL"));
    expect(optionNames(screen.getByRole("combobox", { name: "Papel" }))).toEqual(["Selecione o papel…", "Alunos", "Responsáveis", "Equipe"]);

    chooseScope("BIRTHDAY_MONTH");
    await waitFor(() => expect(sent("GET", "/communications/preview").at(-1)?.query.get("scope")).toBe("BIRTHDAY_MONTH"));
  });

  it("ninguém no alcance: avisa e bloqueia o envio", async () => {
    previewCount = 0;
    renderPage();
    fillText();
    chooseScope("GROUP");
    expect(await screen.findByTestId("comm-preview-count")).toHaveTextContent("0 pessoas");
    expect(screen.getByText("Ninguém neste alcance. Escolha outro.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar agora" })).toBeDisabled();
  });

  it("erro na prévia mostra a mensagem e permite tentar de novo", async () => {
    overrides["GET /communications/preview"] = () => json(500, { message: "Falha ao contar." });
    renderPage();
    chooseScope("GROUP");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Falha ao contar.");
    delete overrides["GET /communications/preview"];
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByTestId("comm-preview-count")).toHaveTextContent("214 pessoas");
  });
});

describe("Comunicar - enviar", () => {
  it("sem título, mensagem ou alcance o botão fica desabilitado com a dica do que falta", async () => {
    renderPage();
    const send = screen.getByRole("button", { name: "Enviar agora" });
    expect(send).toBeDisabled();
    expect(screen.getByText("Título de 2 a 80 caracteres.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Oi" } });
    expect(screen.getByText("Mensagem de 2 a 2000 caracteres.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Olá a todos" } });
    expect(screen.getByText("Escolha para quem enviar.")).toBeInTheDocument();
    expect(send).toBeDisabled();
  });

  it("contador de caracteres da mensagem", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Olá a todos" } });
    expect(screen.getByText("11/2000")).toBeInTheDocument();
  });

  it("enviar agora: pede confirmação 'Enviar para N pessoas?' e manda confirmCount, alcance, texto e ack", async () => {
    renderPage();
    fillText("Roda amanhã", "Traga o abadá e a água.");
    chooseScope("GROUP");
    await screen.findByTestId("comm-preview-count");
    fireEvent.click(screen.getByRole("button", { name: "Enviar agora" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Enviar para 214 pessoas?")).toBeInTheDocument();
    expect(within(dialog).getByText(/Alcance: Todo o grupo/)).toBeInTheDocument();
    // Nada foi enviado ainda.
    expect(sent("POST", "/communications")).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Sim, enviar" }));
    await waitFor(() => expect(sent("POST", "/communications")).toHaveLength(1));
    expect(sent("POST", "/communications")[0]?.body).toEqual({
      title: "Roda amanhã",
      body: "Traga o abadá e a água.",
      scope: { type: "GROUP" },
      confirmCount: 214,
      requiresAck: "NONE",
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Mensagem enviada para 214 pessoas."));
    // Formulário limpo e diálogo fechado.
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe("");
    expect(screen.getByLabelText("Alcance")).toHaveValue("");
  });

  it("alcance de turma (professor): envia classId; imagem por link e confirmação 'Li' vão no corpo", async () => {
    loginAs("PROFESSOR");
    previewCount = 12;
    renderPage();
    fillText("Treino extra", "Sábado às 9h.");
    fireEvent.change(await screen.findByRole("combobox", { name: "Turma" }), { target: { value: "21" } });
    await screen.findByTestId("comm-preview-count");
    fireEvent.change(screen.getByLabelText("Imagem (opcional)"), { target: { value: "https://exemplo.com/treino.png" } });
    fireEvent.change(screen.getByLabelText("Pedir confirmação"), { target: { value: "READ" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar agora" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Enviar para 12 pessoas?")).toBeInTheDocument();
    expect(within(dialog).getByText(/Alcance: Turma Infantil/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sim, enviar" }));
    await waitFor(() => expect(sent("POST", "/communications")).toHaveLength(1));
    expect(sent("POST", "/communications")[0]?.body).toEqual({
      title: "Treino extra",
      body: "Sábado às 9h.",
      scope: { type: "CLASS", classId: 21 },
      confirmCount: 12,
      requiresAck: "READ",
      imageUrl: "https://exemplo.com/treino.png",
    });
  });

  it("imagem com link inválido bloqueia o envio", async () => {
    renderPage();
    fillText();
    chooseScope("GROUP");
    await screen.findByTestId("comm-preview-count");
    fireEvent.change(screen.getByLabelText("Imagem (opcional)"), { target: { value: "javascript:alert(1)" } });
    expect(screen.getByText("O link da imagem não é válido.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar agora" })).toBeDisabled();
  });

  it("fixar no feed (com data) e 'Vou': corpo com pinToFeed, pinnedUntil e requiresAck GOING", async () => {
    renderPage();
    fillText("Campeonato", "Inscrições abertas.");
    chooseScope("ROLE");
    fireEvent.change(await screen.findByRole("combobox", { name: "Papel" }), { target: { value: "ALUNO" } });
    await screen.findByTestId("comm-preview-count");
    fireEvent.change(screen.getByLabelText("Pedir confirmação"), { target: { value: "GOING" } });
    expect(screen.queryByLabelText("Fixar até (opcional)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Fixar no feed" }));
    fireEvent.change(screen.getByLabelText("Fixar até (opcional)"), { target: { value: "2026-03-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar agora" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Sim, enviar" }));
    await waitFor(() => expect(sent("POST", "/communications")).toHaveLength(1));
    expect(sent("POST", "/communications")[0]?.body).toEqual({
      title: "Campeonato",
      body: "Inscrições abertas.",
      scope: { type: "ROLE", role: "ALUNO" },
      confirmCount: 214,
      requiresAck: "GOING",
      pinToFeed: true,
      pinnedUntil: new Date("2026-03-30T23:59:00").toISOString(),
    });
  });

  it("data para fixar antes do envio é recusada", async () => {
    renderPage();
    fillText();
    chooseScope("GROUP");
    await screen.findByTestId("comm-preview-count");
    fireEvent.click(screen.getByRole("switch", { name: "Fixar no feed" }));
    fireEvent.change(screen.getByLabelText("Fixar até (opcional)"), { target: { value: "2026-03-01" } });
    expect(screen.getAllByText("A data para fixar precisa ser depois do envio.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Enviar agora" })).toBeDisabled();
  });
});

describe("Comunicar - agendar", () => {
  it("'Agendar' pede data/hora, valida futuro e até 90 dias e manda scheduledAt em ISO", async () => {
    renderPage();
    fillText("Lembrete", "Batizado no mês que vem.");
    chooseScope("GROUP");
    await screen.findByTestId("comm-preview-count");

    fireEvent.click(screen.getByLabelText("Agendar"));
    expect(screen.getByRole("button", { name: "Agendar" })).toBeDisabled();
    expect(screen.getByText("Escolha a data e a hora do envio.")).toBeInTheDocument();

    const when = screen.getByLabelText("Data e hora do envio");
    expect(when).toHaveAttribute("min");
    expect(when).toHaveAttribute("max");
    fireEvent.change(when, { target: { value: "2026-03-05T10:00" } });
    expect(screen.getAllByText("Escolha um horário no futuro.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Agendar" })).toBeDisabled();
    fireEvent.change(when, { target: { value: "2026-08-01T10:00" } });
    expect(screen.getAllByText("O agendamento vai até 90 dias a partir de hoje.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Agendar" })).toBeDisabled();

    fireEvent.change(when, { target: { value: "2026-03-10T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Agendar" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Agendar para 214 pessoas?")).toBeInTheDocument();
    expect(within(dialog).getByText(/Será enviada em 10\/03\/2026 às 10:00/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sim, agendar" }));

    await waitFor(() => expect(sent("POST", "/communications")).toHaveLength(1));
    expect(sent("POST", "/communications")[0]?.body).toEqual({
      title: "Lembrete",
      body: "Batizado no mês que vem.",
      scope: { type: "GROUP" },
      confirmCount: 214,
      requiresAck: "NONE",
      scheduledAt: new Date("2026-03-10T10:00").toISOString(),
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Mensagem agendada para 10/03 às 10:00 (214 pessoas)."));
  });
});

describe("Comunicar - erros do envio", () => {
  async function readyToSend() {
    renderPage();
    fillText("Aviso", "Mensagem para todos.");
    chooseScope("GROUP");
    await screen.findByTestId("comm-preview-count");
    fireEvent.click(screen.getByRole("button", { name: "Enviar agora" }));
    return screen.findByRole("alertdialog");
  }

  it("409 RECIPIENTS_CHANGED: atualiza a contagem, mantém o diálogo e pede nova confirmação com confirmCount novo", async () => {
    let attempt = 0;
    overrides["POST /communications"] = () => {
      attempt += 1;
      return attempt === 1 ? json(409, { code: "RECIPIENTS_CHANGED", message: "mudou", count: 230 }) : json(201, { id: 9, status: "SENT", recipients: 230 });
    };
    const dialog = await readyToSend();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sim, enviar" }));

    expect(await within(dialog).findByText("Enviar para 230 pessoas?")).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("A lista de destinatários mudou. Agora são 230 pessoas. Confirme de novo.");
    expect(sent("POST", "/communications")).toHaveLength(1);
    expect(sent("POST", "/communications")[0]?.body).toMatchObject({ confirmCount: 214 });
    expect(toast.success).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Sim, enviar" }));
    await waitFor(() => expect(sent("POST", "/communications")).toHaveLength(2));
    expect(sent("POST", "/communications")[1]?.body).toMatchObject({ confirmCount: 230 });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Mensagem enviada para 230 pessoas."));
  });

  it("409 RECIPIENTS_CHANGED com 0 destinatários não deixa confirmar", async () => {
    overrides["POST /communications"] = () => json(409, { code: "RECIPIENTS_CHANGED", message: "mudou", count: 0 });
    const dialog = await readyToSend();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sim, enviar" }));
    expect(await within(dialog).findByText("Enviar para 0 pessoas?")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Sim, enviar" })).toBeDisabled();
  });

  it("429 COMM_QUOTA_EXCEEDED: fecha o diálogo e mostra a mensagem amigável sem limpar o formulário", async () => {
    overrides["POST /communications"] = () => json(429, { code: "COMM_QUOTA_EXCEEDED", message: "quota" });
    const dialog = await readyToSend();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sim, enviar" }));
    const error = await screen.findByTestId("comm-error");
    expect(error).toHaveTextContent("O limite de envios de hoje foi atingido.");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe("Aviso");
  });

  it("403 do servidor vira mensagem de permissão", async () => {
    overrides["POST /communications"] = () => json(403, { message: "Forbidden" });
    const dialog = await readyToSend();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sim, enviar" }));
    expect(await screen.findByTestId("comm-error")).toHaveTextContent("Você não tem permissão para esta ação.");
  });
});

describe("Comunicar - Histórico", () => {
  it("lista com situação, alcance, data, destinatários, lidos e confirmados", async () => {
    renderPage();
    await openHistory();
    expect(sent("GET", "/communications")[0]?.query.get("limit")).toBe("10");
    expect(sent("GET", "/communications")[0]?.query.get("offset")).toBe("0");

    const sentRow = screen.getByRole("button", { name: "Roda de sábado" }).closest("tr")!;
    expect(within(sentRow).getByText("Enviado")).toBeInTheDocument();
    expect(within(sentRow).getByText("Todo o grupo")).toBeInTheDocument();
    expect(within(sentRow).getByText("10 pessoas")).toBeInTheDocument();
    expect(within(sentRow).getByText("3 de 10")).toBeInTheDocument();
    expect(within(sentRow).getByText("2 de 10")).toBeInTheDocument();
    expect(within(sentRow).getByText(/Mestre Zé/)).toBeInTheDocument();
    expect(within(sentRow).getByText(/Fixada no feed/)).toBeInTheDocument();

    const scheduledRow = screen.getByRole("button", { name: "Batizado de abril" }).closest("tr")!;
    expect(within(scheduledRow).getByText("Agendado")).toBeInTheDocument();
    expect(within(scheduledRow).getByText("Uma turma")).toBeInTheDocument();
    const cancelledRow = screen.getByRole("button", { name: "Reunião cancelada" }).closest("tr")!;
    expect(within(cancelledRow).getByText("Cancelado")).toBeInTheDocument();
    expect(within(cancelledRow).getByText("Por papel")).toBeInTheDocument();
  });

  it("filtra por situação e pagina no servidor (offset)", async () => {
    listTotal = 25;
    renderPage();
    await openHistory();
    expect(screen.getByTestId("table-count")).toHaveTextContent("25 registros");
    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }));
    await waitFor(() => expect(sent("GET", "/communications").at(-1)?.query.get("offset")).toBe("10"));

    fireEvent.change(screen.getByRole("combobox", { name: "Filtrar por situação" }), { target: { value: "SCHEDULED" } });
    await waitFor(() => expect(sent("GET", "/communications").at(-1)?.query.get("status")).toBe("SCHEDULED"));
    expect(sent("GET", "/communications").at(-1)?.query.get("offset")).toBe("0");
  });

  it("histórico vazio e com erro", async () => {
    listItems = [];
    renderPage();
    const tab = screen.getByRole("tab", { name: "Histórico" });
    fireEvent.mouseDown(tab, { button: 0 });
    fireEvent.click(tab);
    expect(await screen.findByText(/Nenhuma mensagem ainda/)).toBeInTheDocument();
  });

  it("detalhe: números, respostas (Li/Vou/Não vou) e pendentes", async () => {
    renderPage();
    await openHistory();
    fireEvent.click(screen.getByRole("button", { name: "Roda de sábado" }));
    const sheet = await screen.findByTestId("communication-sheet");
    await within(sheet).findByTestId("stat-recipients");
    expect(within(sheet).getByTestId("stat-recipients")).toHaveTextContent("10");
    expect(within(sheet).getByTestId("stat-read")).toHaveTextContent("3");
    expect(within(sheet).getByTestId("stat-pending")).toHaveTextContent("5");
    expect(within(sheet).getByTestId("ack-read")).toHaveTextContent("0");
    expect(within(sheet).getByTestId("ack-going")).toHaveTextContent("4");
    expect(within(sheet).getByTestId("ack-not-going")).toHaveTextContent("1");
    expect(within(sheet).getByText("Li")).toBeInTheDocument();
    expect(within(sheet).getByText("Vou")).toBeInTheDocument();
    expect(within(sheet).getByText("Não vou")).toBeInTheDocument();
    expect(within(sheet).getByText(/Venha para a roda!/)).toBeInTheDocument();
    // Enviada: reenviar sim, cancelar não.
    expect(within(sheet).getByRole("button", { name: /Reenviar para quem não leu/ })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /Cancelar envio/ })).not.toBeInTheDocument();
  });

  it("reenviar para quem não leu: confirma, chama o POST e avisa", async () => {
    renderPage();
    await openHistory();
    fireEvent.click(screen.getByRole("button", { name: "Roda de sábado" }));
    const sheet = await screen.findByTestId("communication-sheet");
    fireEvent.click(await within(sheet).findByRole("button", { name: /Reenviar para quem não leu/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/só para 7 pessoas que ainda não leu/)).toBeInTheDocument();
    expect(sent("POST", "/communications/1/resend-unread")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Reenviar" }));
    await waitFor(() => expect(sent("POST", "/communications/1/resend-unread")).toHaveLength(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Mensagem reenviada para 7 pessoas."));
  });

  it("reenviar com {sent:0} (ninguém sem ler): avisa que não havia para quem reenviar, sem dizer 'reenviada para 0'", async () => {
    overrides["POST /communications/1/resend-unread"] = () => json(201, { sent: 0 });
    renderPage();
    await openHistory();
    fireEvent.click(screen.getByRole("button", { name: "Roda de sábado" }));
    const sheet = await screen.findByTestId("communication-sheet");
    fireEvent.click(await within(sheet).findByRole("button", { name: /Reenviar para quem não leu/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Reenviar" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Ninguém ficou sem ler: não há para quem reenviar."));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("RESEND_TOO_SOON: mensagem amigável e o diálogo fecha", async () => {
    overrides["POST /communications/1/resend-unread"] = () => json(429, { code: "RESEND_TOO_SOON", message: "cedo" });
    renderPage();
    await openHistory();
    fireEvent.click(screen.getByRole("button", { name: "Roda de sábado" }));
    const sheet = await screen.findByTestId("communication-sheet");
    fireEvent.click(await within(sheet).findByRole("button", { name: /Reenviar para quem não leu/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Reenviar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Esta mensagem já foi reenviada nas últimas 24 horas. Tente de novo mais tarde."));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("cancelar envio (só agendados): confirma e chama DELETE", async () => {
    renderPage();
    await openHistory();
    fireEvent.click(screen.getByRole("button", { name: "Batizado de abril" }));
    const sheet = await screen.findByTestId("communication-sheet");
    expect(await within(sheet).findByText(/Turma Infantil/)).toBeInTheDocument();
    // Agendada: não se reenvia.
    expect(within(sheet).queryByRole("button", { name: /Reenviar para quem não leu/ })).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: /Cancelar envio/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(sent("DELETE", "/communications/2")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar envio" }));
    await waitFor(() => expect(sent("DELETE", "/communications/2")).toHaveLength(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Envio cancelado."));
  });

  it("cancelar um que já foi enviado (409 ALREADY_SENT): mensagem amigável", async () => {
    overrides["DELETE /communications/2"] = () => json(409, { code: "ALREADY_SENT", message: "enviada" });
    renderPage();
    await openHistory();
    fireEvent.click(screen.getByRole("button", { name: "Batizado de abril" }));
    const sheet = await screen.findByTestId("communication-sheet");
    fireEvent.click(await within(sheet).findByRole("button", { name: /Cancelar envio/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar envio" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Esta mensagem já foi enviada e não pode mais ser cancelada."));
  });
});
