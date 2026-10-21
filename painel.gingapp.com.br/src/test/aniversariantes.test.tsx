import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { BirthdaysCard } from "@/components/painel/birthdays-card";
import { AniversariantesPage } from "@/modules/aniversariantes";
import type { BirthdayItem, BirthdaySettings, GreetResult } from "@/modules/aniversariantes/types";
import { defaultGreeting, todaySP, turnsAgeText, whatsappLink } from "@/modules/aniversariantes/utils";
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

const item = (over: Partial<BirthdayItem>): BirthdayItem => ({
  personId: 1,
  studentId: 10,
  userId: 100,
  name: "Ana Souza",
  nickname: null,
  photo: null,
  day: 12,
  month: 3,
  age: null,
  turnsAge: null,
  isMinor: false,
  kind: "STUDENT",
  unitId: 7,
  unitName: "Sede Centro",
  classNames: ["Adulto"],
  phone: null,
  greetedThisYear: false,
  ...over,
});

// "Hoje" simulado = 5 de março (fuso de São Paulo): o mês aberto por padrão é março.
const HOJE = item({ personId: 1, name: "Ana Souza", nickname: "Aninha", day: 5, turnsAge: 30, age: 30, phone: "(11) 99999-8888" });
const MENOR = item({ personId: 2, studentId: 11, userId: null, name: "Beto Lima", day: 9, turnsAge: 12, age: 12, isMinor: true, classNames: ["Infantil"] });
const SEM_IDADE = item({ personId: 3, studentId: null, userId: 300, name: "Carla Dias", day: 20, kind: "GUARDIAN", unitId: null, unitName: null, classNames: [] });
const JA_ENVIADO = item({ personId: 4, name: "Davi Nunes", day: 25, turnsAge: 41, greetedThisYear: true, kind: "STAFF" });

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

const SETTINGS: BirthdaySettings = {
  dailyDigest: true,
  autoGreeting: false,
  autoGreetingMessage: "Parabéns, {nome}! 🎉 A família {grupo} deseja um ótimo dia.",
  autoGreetingHour: 8,
};

let calls: Call[];
let monthItems: BirthdayItem[];
let overrides: Record<string, () => Response>;

function installFetch() {
  calls = [];
  const handler = (input: string, init?: RequestInit): Response => {
    const [path = "", search = ""] = input.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    calls.push({ method, path, query: new URLSearchParams(search), body });
    const override = overrides[`${method} ${path}`];
    if (override) return override();
    if (method === "GET" && path === "/notifications/audiences") return json(200, AUDIENCES);
    if (method === "GET" && path === "/birthdays") {
      const month = Number(new URLSearchParams(search).get("month"));
      return json(200, { items: month === 3 ? monthItems : [], month, total: month === 3 ? monthItems.length : 0 });
    }
    if (method === "GET" && path === "/birthdays/settings") return json(200, SETTINGS);
    if (method === "PUT" && path === "/birthdays/settings") return json(200, body);
    // Formato REAL: greet responde 200 (não 201) com { sent, alreadyGreeted, whatsappUrl } (ver real-contract.ts).
    if (method === "POST" && /^\/birthdays\/\d+\/greet$/.test(path)) return json(200, { sent: true, alreadyGreeted: false, whatsappUrl: null } satisfies GreetResult);
    return json(404, { message: "Rota não mockada." });
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => Promise.resolve(handler(input, init))),
  );
}

const sent = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);
const lastMonth = () => sent("GET", "/birthdays").at(-1)?.query.get("month");

function renderWith(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const card = (name: string) => screen.getByText(name).closest("[data-testid='birthday-item']") as HTMLElement;

beforeEach(() => {
  // Só o relógio (Date) é simulado; timers e promessas seguem reais.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-05T15:00:00Z"));
  loginAs("MESTRE");
  monthItems = [HOJE, MENOR, SEM_IDADE, JA_ENVIADO];
  overrides = {};
  installFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("utilidades de aniversário", () => {
  it("todaySP usa o fuso de São Paulo (madrugada de 6/3 em UTC ainda é 5/3 no Brasil)", () => {
    expect(todaySP(new Date("2026-03-06T01:30:00Z"))).toEqual({ day: 5, month: 3 });
    expect(todaySP(new Date("2026-03-06T04:00:00Z"))).toEqual({ day: 6, month: 3 });
  });

  it("whatsappLink: só dígitos, DDI 55 quando falta, sem número devolve null", () => {
    expect(whatsappLink("(11) 99999-8888", "Oi")).toBe("https://wa.me/5511999998888?text=Oi");
    expect(whatsappLink("+55 11 99999-8888", "Oi")).toBe("https://wa.me/5511999998888?text=Oi");
    expect(whatsappLink("011 3333-4444", "a b&c")).toBe("https://wa.me/551133334444?text=a%20b%26c");
    expect(whatsappLink(null, "Oi")).toBeNull();
    expect(whatsappLink("123", "Oi")).toBeNull();
  });

  it("turnsAgeText: 'faz' até o dia de hoje, 'fez' depois que o aniversário deste ano passou (o backend manda a idade do ano corrente em todo o mês)", () => {
    const today = { day: 5, month: 3 };
    expect(turnsAgeText({ day: 5, turnsAge: 30 }, 3, today)).toBe("faz 30 anos");
    expect(turnsAgeText({ day: 9, turnsAge: 1 }, 3, today)).toBe("faz 1 ano");
    expect(turnsAgeText({ day: 4, turnsAge: 30 }, 3, today)).toBe("fez 30 anos");
    expect(turnsAgeText({ day: 28, turnsAge: 30 }, 2, today)).toBe("fez 30 anos"); // mês anterior
    expect(turnsAgeText({ day: 1, turnsAge: 30 }, 4, today)).toBe("faz 30 anos"); // mês seguinte
    expect(turnsAgeText({ day: 5, turnsAge: null }, 3, today)).toBeNull();
  });

  it("defaultGreeting usa o apelido (ou o primeiro nome) e o nome do grupo", () => {
    expect(defaultGreeting({ name: "Ana Souza", nickname: "Aninha" }, "Capoeira Axé")).toBe(
      "Parabéns, Aninha! 🎉 A família Capoeira Axé deseja um ótimo dia.",
    );
    expect(defaultGreeting({ name: "Beto Lima", nickname: null }, null)).toBe("Parabéns, Beto! 🎉 Toda a nossa família deseja um ótimo dia.");
  });
});

describe("AniversariantesPage - lista do mês", () => {
  it("abre no mês de hoje e mostra foto/nome+apelido, dia, 'faz N anos' só quando vier, selo Menor e selo Hoje", async () => {
    renderWith(<AniversariantesPage />);
    expect(await screen.findByText("Ana Souza")).toBeInTheDocument();
    expect(lastMonth()).toBe("3");
    expect(screen.getByRole("combobox", { name: "Mês" })).toHaveValue("3");
    expect(screen.getByText("4 aniversariantes em março")).toBeInTheDocument();

    const ana = within(card("Ana Souza"));
    expect(ana.getByText("(Aninha)")).toBeInTheDocument();
    expect(ana.getByText("faz 30 anos")).toBeInTheDocument();
    expect(ana.getByText("Hoje")).toBeInTheDocument();
    expect(ana.getByText("Aluno")).toBeInTheDocument();
    expect(ana.getByText("Sede Centro · Adulto")).toBeInTheDocument();
    expect(ana.getByLabelText("Dia 5")).toBeInTheDocument();

    // Quem não tem turnsAge não mostra idade nem "Hoje" fora do dia.
    const carla = within(card("Carla Dias"));
    expect(carla.queryByText(/faz \d+ ano/)).not.toBeInTheDocument();
    expect(carla.queryByText("Hoje")).not.toBeInTheDocument();
    expect(carla.getByText("Responsável")).toBeInTheDocument();
  });

  it("a equipe VÊ a idade do menor e o selo 'Menor' aparece", async () => {
    renderWith(<AniversariantesPage />);
    await screen.findByText("Beto Lima");
    const beto = within(card("Beto Lima"));
    expect(beto.getByText("Menor")).toBeInTheDocument();
    expect(beto.getByText("faz 12 anos")).toBeInTheDocument();
    expect(within(card("Ana Souza")).queryByText("Menor")).not.toBeInTheDocument();
  });

  it("navega pelos meses (anterior/próximo/seletor), dá a volta no ano e volta ao mês atual", async () => {
    renderWith(<AniversariantesPage />);
    await screen.findByText("Ana Souza");

    fireEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    await screen.findByTestId("birthdays-empty");
    expect(lastMonth()).toBe("4");
    expect(screen.getByRole("combobox", { name: "Mês" })).toHaveValue("4");
    expect(screen.getByText("Nenhum aniversariante em abril.")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Mês" }), { target: { value: "1" } });
    await waitFor(() => expect(lastMonth()).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    await waitFor(() => expect(lastMonth()).toBe("12"));
    expect(screen.getByRole("combobox", { name: "Mês" })).toHaveValue("12");
    fireEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    await waitFor(() => expect(lastMonth()).toBe("1"));

    fireEvent.click(screen.getByRole("button", { name: "Voltar para o mês atual" }));
    expect(await screen.findByText("Ana Souza")).toBeInTheDocument();
    expect(lastMonth()).toBe("3");
  });

  it("filtros de unidade e turma vão na consulta; a turma só lista as da unidade escolhida", async () => {
    renderWith(<AniversariantesPage />);
    await screen.findByText("Ana Souza");
    const unit = await screen.findByRole("option", { name: "Sede Centro" });
    expect(unit).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filtrar por unidade" }), { target: { value: "7" } });
    await waitFor(() => expect(sent("GET", "/birthdays").at(-1)?.query.get("unitId")).toBe("7"));
    const classSelect = screen.getByRole("combobox", { name: "Filtrar por turma" });
    expect(within(classSelect).getByRole("option", { name: "Infantil" })).toBeInTheDocument();
    expect(within(classSelect).queryByRole("option", { name: "Adulto" })).not.toBeInTheDocument();

    fireEvent.change(classSelect, { target: { value: "21" } });
    await waitFor(() => expect(sent("GET", "/birthdays").at(-1)?.query.get("classId")).toBe("21"));

    // Trocar de unidade descarta a turma que não pertence a ela.
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrar por unidade" }), { target: { value: "8" } });
    await waitFor(() => expect(sent("GET", "/birthdays").at(-1)?.query.get("classId")).toBeNull());
    expect(sent("GET", "/birthdays").at(-1)?.query.get("unitId")).toBe("8");
  });

  it("estado de erro mostra a mensagem e 'Tentar novamente' refaz a consulta", async () => {
    overrides["GET /birthdays"] = () => json(500, { message: "Falha no servidor." });
    renderWith(<AniversariantesPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Falha no servidor.");
    delete overrides["GET /birthdays"];
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Ana Souza")).toBeInTheDocument();
  });

  it("estado vazio no mês sem aniversariantes", async () => {
    monthItems = [];
    renderWith(<AniversariantesPage />);
    expect(await screen.findByTestId("birthdays-empty")).toHaveTextContent("Nenhum aniversariante em março.");
  });
});

describe("AniversariantesPage - parabéns e WhatsApp", () => {
  it("'Enviar parabéns' abre o diálogo com a mensagem padrão (apelido), aceita edição e chama o POST greet com a mensagem", async () => {
    renderWith(<AniversariantesPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: "Enviar parabéns para Ana Souza" }));

    const dialog = await screen.findByRole("dialog");
    const textarea = within(dialog).getByLabelText("Mensagem") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Parabéns, Aninha! 🎉 Toda a nossa família deseja um ótimo dia.");

    // Modelo troca o texto; depois o gestor edita.
    fireEvent.click(within(dialog).getByRole("button", { name: "Com axé" }));
    expect(textarea.value).toContain("Aninha, hoje o dia é seu!");
    fireEvent.change(textarea, { target: { value: "Feliz aniversário, Aninha! Axé!" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Enviar parabéns" }));
    expect(await within(dialog).findByTestId("greet-sent")).toBeInTheDocument();

    const posts = sent("POST", "/birthdays/1/greet");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ message: "Feliz aniversário, Aninha! Axé!" });
    expect(toast.success).toHaveBeenCalledWith("Parabéns enviado para Ana Souza.");
    // Depois do envio a lista é refeita (para o selo "Já enviado este ano").
    await waitFor(() => expect(sent("GET", "/birthdays").length).toBeGreaterThan(1));
  });

  it("o whatsappUrl devolvido pelo POST tem prioridade sobre o atalho montado no painel", async () => {
    overrides["POST /birthdays/1/greet"] = () =>
      json(200, { sent: true, alreadyGreeted: false, whatsappUrl: "https://wa.me/5511999998888?text=Do%20servidor" });
    renderWith(<AniversariantesPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: "Enviar parabéns para Ana Souza" }));
    const dialog = await screen.findByRole("dialog");
    // Antes do envio: atalho montado aqui, com a mensagem atual.
    const before = within(dialog).getByRole("link", { name: /WhatsApp/ });
    expect(before.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/5511999998888\?text=Par/);

    fireEvent.click(within(dialog).getByRole("button", { name: "Enviar parabéns" }));
    await within(dialog).findByTestId("greet-sent");
    const after = within(dialog).getByRole("link", { name: /WhatsApp/ });
    expect(after).toHaveAttribute("href", "https://wa.me/5511999998888?text=Do%20servidor");
    expect(after).toHaveAttribute("target", "_blank");
    expect(after.getAttribute("rel")).toContain("noopener");
  });

  it("'alreadyGreeted' na resposta mostra 'Já enviado este ano' e não avisa sucesso", async () => {
    overrides["POST /birthdays/1/greet"] = () => json(200, { sent: false, alreadyGreeted: true, whatsappUrl: null });
    renderWith(<AniversariantesPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: "Enviar parabéns para Ana Souza" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Enviar parabéns" }));
    expect(await within(dialog).findByTestId("greet-already")).toHaveTextContent("Já enviado este ano");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("409 ALREADY_GREETED também vira 'Já enviado este ano'", async () => {
    overrides["POST /birthdays/1/greet"] = () => json(409, { code: "ALREADY_GREETED", message: "Já parabenizado." });
    renderWith(<AniversariantesPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: "Enviar parabéns para Ana Souza" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Enviar parabéns" }));
    expect(await within(dialog).findByTestId("greet-already")).toBeInTheDocument();
  });

  it("falha no envio mostra o erro no diálogo e permite tentar de novo", async () => {
    overrides["POST /birthdays/1/greet"] = () => json(500, { message: "Falha ao notificar." });
    renderWith(<AniversariantesPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: "Enviar parabéns para Ana Souza" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Enviar parabéns" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Falha ao notificar.");
    expect(within(dialog).getByRole("button", { name: "Enviar parabéns" })).toBeEnabled();
  });

  it("mensagem acima de 500 caracteres bloqueia o envio", async () => {
    renderWith(<AniversariantesPage />);
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: "Enviar parabéns para Ana Souza" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Mensagem"), { target: { value: "a".repeat(501) } });
    expect(within(dialog).getByRole("button", { name: "Enviar parabéns" })).toBeDisabled();
    expect(within(dialog).getByText("501/500")).toBeInTheDocument();
  });

  it("quem já recebeu este ano mostra 'Já enviado este ano' e não oferece o botão de enviar", async () => {
    renderWith(<AniversariantesPage />);
    await screen.findByText("Davi Nunes");
    const davi = within(card("Davi Nunes"));
    expect(davi.getByTestId("greeted-badge")).toHaveTextContent("Já enviado este ano");
    expect(davi.queryByRole("button", { name: /Enviar parabéns/ })).not.toBeInTheDocument();
  });

  it("sem acesso ao app (userId nulo) o diálogo avisa e o WhatsApp continua disponível", async () => {
    monthItems = [{ ...MENOR, phone: "11988887777" }];
    renderWith(<AniversariantesPage />);
    await screen.findByText("Beto Lima");
    fireEvent.click(screen.getByRole("button", { name: "Enviar parabéns para Beto Lima" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/não tem acesso ao app/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /WhatsApp/ }).getAttribute("href")).toMatch(/^https:\/\/wa\.me\/5511988887777\?text=/);
  });

  it("botão WhatsApp do cartão: link wa.me/55<dígitos> com a mensagem pronta; sem telefone não há botão", async () => {
    renderWith(<AniversariantesPage />);
    await screen.findByText("Ana Souza");
    const link = within(card("Ana Souza")).getByRole("link", { name: "Abrir WhatsApp de Ana Souza" });
    expect(link).toHaveAttribute("href", `https://wa.me/5511999998888?text=${encodeURIComponent("Parabéns, Aninha! 🎉 Toda a nossa família deseja um ótimo dia.")}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(within(card("Carla Dias")).queryByRole("link")).not.toBeInTheDocument();
  });

  it("MONITOR (sem announcements:create) não vê 'Enviar parabéns'", async () => {
    loginAs("MONITOR");
    renderWith(<AniversariantesPage />);
    await screen.findByText("Ana Souza");
    expect(screen.queryByRole("button", { name: /Enviar parabéns/ })).not.toBeInTheDocument();
  });
});

describe("AniversariantesPage - configurações (só MESTRE)", () => {
  it("MESTRE vê o cartão, edita (parabéns automáticos + horário + mensagem) e salva com PUT", async () => {
    renderWith(<AniversariantesPage />);
    const settings = await screen.findByTestId("birthday-settings");
    await within(settings).findByRole("switch", { name: "Resumo diário dos aniversariantes" });
    expect(within(settings).getByRole("switch", { name: "Resumo diário dos aniversariantes" })).toBeChecked();
    const auto = within(settings).getByRole("switch", { name: "Parabéns automáticos" });
    expect(auto).not.toBeChecked();
    // Horário e mensagem só aparecem com os parabéns automáticos ligados.
    expect(within(settings).queryByLabelText("Horário do envio")).not.toBeInTheDocument();
    const save = within(settings).getByRole("button", { name: "Salvar configurações" });
    expect(save).toBeDisabled();

    fireEvent.click(auto);
    fireEvent.change(within(settings).getByLabelText("Horário do envio"), { target: { value: "9" } });
    fireEvent.change(within(settings).getByLabelText("Mensagem"), { target: { value: "Parabéns, {nome}! Axé do {grupo}." } });
    fireEvent.click(within(settings).getByRole("switch", { name: "Resumo diário dos aniversariantes" }));
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(sent("PUT", "/birthdays/settings")).toHaveLength(1));
    expect(sent("PUT", "/birthdays/settings")[0]?.body).toEqual({
      dailyDigest: false,
      autoGreeting: true,
      autoGreetingMessage: "Parabéns, {nome}! Axé do {grupo}.",
      autoGreetingHour: 9,
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Configurações salvas."));
  });

  it("mensagem vazia com os parabéns automáticos ligados bloqueia o salvamento", async () => {
    renderWith(<AniversariantesPage />);
    const settings = await screen.findByTestId("birthday-settings");
    const auto = await within(settings).findByRole("switch", { name: "Parabéns automáticos" });
    fireEvent.click(auto);
    fireEvent.change(within(settings).getByLabelText("Mensagem"), { target: { value: "   " } });
    expect(within(settings).getByRole("button", { name: "Salvar configurações" })).toBeDisabled();
  });

  it.each(["PROFESSOR", "INSTRUTOR"] as const)("%s não vê as configurações e o painel nem consulta /birthdays/settings", async (role) => {
    loginAs(role);
    renderWith(<AniversariantesPage />);
    await screen.findByText("Ana Souza");
    expect(screen.queryByTestId("birthday-settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Configurações")).not.toBeInTheDocument();
    expect(sent("GET", "/birthdays/settings")).toHaveLength(0);
    // O PROFESSOR continua podendo enviar parabéns.
    expect(screen.getByRole("button", { name: "Enviar parabéns para Ana Souza" })).toBeInTheDocument();
  });
});

describe("BirthdaysCard (painel inicial)", () => {
  const SUMMARY = {
    today: [item({ personId: 1, name: "Ana Souza", day: 5 })],
    next7Days: [item({ personId: 2, name: "Beto Lima", day: 7 }), item({ personId: 3, name: "Carla Dias", day: 9 })],
    monthTotal: 6,
    todayTotal: 1,
  };

  it("mostra 'hoje' e 'próximos 7 dias' com a data, o total do mês e o link para a página", async () => {
    overrides["GET /birthdays/summary"] = () => json(200, SUMMARY);
    renderWith(<BirthdaysCard />);
    const today = await screen.findByRole("region", { name: "Aniversariantes de hoje" });
    expect(within(today).getByText("Ana Souza")).toBeInTheDocument();
    const next = screen.getByRole("region", { name: "Aniversariantes dos próximos 7 dias" });
    expect(within(next).getByText("Beto Lima")).toBeInTheDocument();
    expect(within(next).getByText("07/03")).toBeInTheDocument();
    expect(within(next).getByText("09/03")).toBeInTheDocument();
    expect(screen.getByText("6 aniversariantes neste mês")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver todos" })).toHaveAttribute("href", "/aniversariantes");
  });

  it("sem aniversariantes mostra as mensagens vazias; resposta fora do formato não quebra", async () => {
    overrides["GET /birthdays/summary"] = () => json(200, { today: [], next7Days: [], monthTotal: 0, todayTotal: 0 });
    const first = renderWith(<BirthdaysCard />);
    expect(await screen.findByText("Ninguém faz aniversário hoje.")).toBeInTheDocument();
    expect(screen.getByText("Nenhum aniversário nos próximos 7 dias.")).toBeInTheDocument();
    first.unmount();

    overrides["GET /birthdays/summary"] = () => json(200, { students: { active: 1 } });
    renderWith(<BirthdaysCard />);
    expect(await screen.findByText("Ninguém faz aniversário hoje.")).toBeInTheDocument();
  });

  it("limita a lista e avisa quantos faltam; erro mostra 'Tentar novamente'", async () => {
    const many = Array.from({ length: 8 }, (_, i) => item({ personId: 50 + i, name: `Pessoa ${i + 1}`, day: 5 }));
    overrides["GET /birthdays/summary"] = () => json(200, { today: many, next7Days: [], monthTotal: 8, todayTotal: 8 });
    const first = renderWith(<BirthdaysCard />);
    expect(await screen.findByText("Pessoa 5")).toBeInTheDocument();
    expect(screen.queryByText("Pessoa 6")).not.toBeInTheDocument();
    expect(screen.getByText("+3 na página de aniversariantes")).toBeInTheDocument();
    first.unmount();

    overrides["GET /birthdays/summary"] = () => json(500, { message: "x" });
    renderWith(<BirthdaysCard />);
    expect(await screen.findByText("Não foi possível carregar os aniversariantes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });
});
