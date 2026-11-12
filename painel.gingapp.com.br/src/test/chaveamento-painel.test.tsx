import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChaveamentoPage } from "@/modules/chaveamento";
import { AnnouncerProvider } from "@/modules/chaveamento/announcer";
import { BracketView } from "@/modules/chaveamento/bracket-view";
import { collectDesk, matchesFilter } from "@/modules/chaveamento/desk";
import { competitorMap, pathMatchIds, authorizationText } from "@/modules/chaveamento/helpers";
import { QuickUndoProvider, UndoBar } from "@/modules/chaveamento/quick-undo";
import { QUICK_UNDO_MS, useQuickUndo } from "@/modules/chaveamento/quick-undo-context";
import { clearSession, loginAs } from "./login-as";
import { buildBracket, mkCategory, mkCompetitor, mkMatch, mkTournament, summaryOf } from "./chaveamento-fixtures";
import { installFakeBackend, json, newFake, sent, type Fake } from "./chaveamento-server";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let fake: Fake;
const originalMatchMedia = window.matchMedia;

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function renderPage() {
  return render(
    <QueryClientProvider client={client()}>
      <ChaveamentoPage eventId={7} />
    </QueryClientProvider>,
  );
}
function reduceMotion(on: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: on && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

const ANA = mkCompetitor(101, "Ana", { groupName: "Academia A" });
const BIA = mkCompetitor(102, "Bia", { groupName: "Academia B" });
const CAIO = mkCompetitor(103, "Caio", { groupName: "Academia A" });
const DUDA = mkCompetitor(104, "Duda", { groupName: "Academia C" });
const EVA = mkCompetitor(201, "Eva");
const FABI = mkCompetitor(202, "Fabi");

/** Duas categorias em andamento: Adulto (1 pronta no tatame 2, 1 ao vivo no tatame 1) e Infantil (1 pronta no tatame 1, 1ª da fila). */
function twoCategories() {
  const adulto = mkCategory({
    id: 5,
    name: "Adulto",
    position: 0,
    status: "RUNNING",
    competitors: [ANA, BIA, CAIO, DUDA],
    matches: [
      mkMatch(50, { slotAId: 101, slotBId: 102, status: "READY", queueOrder: 2, mat: 2 }),
      mkMatch(51, { key: "MAIN-1-1", position: 1, slotAId: 103, slotBId: 104, status: "LIVE", mat: 1 }),
    ],
  });
  const infantil = mkCategory({
    id: 6,
    name: "Infantil",
    position: 1,
    status: "RUNNING",
    competitors: [EVA, FABI],
    matches: [mkMatch(60, { slotAId: 201, slotBId: 202, status: "READY", queueOrder: 1, mat: 1 })],
  });
  fake.category = adulto;
  fake.tournament = mkTournament({ categories: [summaryOf(adulto), summaryOf(infantil)] });
  fake.overrides["GET /events/7/tournament/categories/6"] = () => json(200, infantil);
  return { adulto, infantil };
}

function oneLive() {
  const category = mkCategory({
    status: "RUNNING",
    competitors: [ANA, BIA],
    matches: [mkMatch(50, { slotAId: 101, slotBId: 102, status: "LIVE", mat: 1 })],
  });
  fake.category = category;
  fake.tournament = mkTournament({ categories: [summaryOf(category)] });
  return category;
}

beforeEach(() => {
  loginAs("MESTRE");
  fake = newFake();
  installFakeBackend(fake);
  reduceMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.matchMedia = originalMatchMedia;
  clearSession();
});

describe("mesa de controle: derivação pura", () => {
  it("ordena as próximas por ordem de chamada, depois tatame; ignora folga, categoria que não está em andamento e luta sem os 2 atletas", () => {
    const a = mkCategory({
      id: 1,
      position: 0,
      status: "RUNNING",
      matches: [
        mkMatch(1, { slotAId: 1, slotBId: 2, status: "READY", queueOrder: 5, mat: 1 }),
        mkMatch(2, { slotAId: 1, slotBId: 2, status: "READY", queueOrder: null, mat: 1 }),
        mkMatch(3, { slotAId: 1, slotBId: null, status: "READY" }),
        mkMatch(4, { slotAId: 1, slotBId: null, isBye: true, status: "FINISHED" }),
        mkMatch(5, { slotAId: 1, slotBId: 2, status: "LIVE", mat: 0 }),
      ],
    });
    const b = mkCategory({ id: 2, position: 1, status: "RUNNING", matches: [mkMatch(6, { slotAId: 3, slotBId: 4, status: "READY", queueOrder: 1, mat: 2 })] });
    const setup = mkCategory({ id: 3, position: 2, status: "SETUP", matches: [mkMatch(7, { slotAId: 3, slotBId: 4, status: "READY" })] });
    const desk = collectDesk([a, b, setup]);
    expect(desk.next.map((e) => e.match.id)).toEqual([6, 1, 2]); // fila 1, fila 5, sem fila por último
    expect(desk.live.map((e) => e.match.id)).toEqual([5]);
    expect(desk.mats).toEqual([1, 2]);
    expect(desk.hasNoMat).toBe(true); // a luta 5 está com tatame 0 = sem tatame
  });

  it("filtro por tatame: número, 'sem tatame' e todos", () => {
    const m = (mat: number | null) => mkMatch(1, { mat });
    expect(matchesFilter(m(2), "all")).toBe(true);
    expect(matchesFilter(m(2), 2)).toBe(true);
    expect(matchesFilter(m(2), 1)).toBe(false);
    expect(matchesFilter(m(null), "none")).toBe(true);
    expect(matchesFilter(m(0), "none")).toBe(true);
    expect(matchesFilter(m(3), "none")).toBe(false);
  });

  it("caminho do atleta: todas as lutas em que ele aparece (e nenhuma de outros)", () => {
    const matches = [
      mkMatch(1, { slotAId: 1, slotBId: 2 }),
      mkMatch(2, { slotAId: 3, slotBId: 4 }),
      mkMatch(3, { slotAId: 1, slotBId: 3 }),
      mkMatch(4, { stage: "THIRD_PLACE", slotAId: 2, slotBId: 4 }),
    ];
    expect([...pathMatchIds(matches, 1)]).toEqual([1, 3]);
    expect([...pathMatchIds(matches, 4)].sort()).toEqual([2, 4]);
    expect(pathMatchIds(matches, null).size).toBe(0);
  });

  it("selo de autorização: adulto não precisa; menor mostra sim/não", () => {
    expect(authorizationText({ ageGroup: "ADULT", photoAuthorized: false })).toMatch(/não se aplica/);
    expect(authorizationText({ ageGroup: "MINOR", photoAuthorized: false })).toBe("Autorização do responsável: não");
    expect(authorizationText({ ageGroup: "UNKNOWN", photoAuthorized: true })).toBe("Autorização do responsável: sim");
  });
});

describe("mesa de controle: tela", () => {
  it("mostra ao vivo e próximas de TODAS as categorias; a fila vem ordenada e a 1ª é a 'Próxima luta'", async () => {
    twoCategories();
    renderPage();
    const desk = await screen.findByTestId("control-desk");
    await within(desk).findByTestId("desk-next-60");
    const items = within(screen.getByTestId("desk-next-list")).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-testid"))).toEqual(["desk-next-60", "desk-next-50"]);
    expect(within(items[0]!).getByText("Próxima luta")).toBeInTheDocument();
    expect(within(desk).getByTestId("desk-live-51")).toBeInTheDocument();
    expect(screen.getByTestId("desk-live-count")).toHaveTextContent("1");
    expect(screen.getByTestId("desk-next-count")).toHaveTextContent("2");
  });

  it("filtro por tatame: Tatame 2 só mostra a luta do tatame 2; 'Todos' volta", async () => {
    twoCategories();
    renderPage();
    await screen.findByTestId("desk-next-60");
    const group = screen.getByRole("radiogroup", { name: "Filtrar por tatame" });
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Todos os tatames", "Tatame 1", "Tatame 2"]);
    fireEvent.click(within(group).getByRole("radio", { name: "Tatame 2" }));
    expect(screen.getByRole("radio", { name: "Tatame 2" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("desk-next-60")).not.toBeInTheDocument();
    expect(screen.getByTestId("desk-next-50")).toBeInTheDocument();
    expect(screen.getByTestId("desk-live-empty")).toHaveTextContent(/Tatame 2/);
    fireEvent.click(screen.getByRole("radio", { name: "Todos os tatames" }));
    expect(screen.getByTestId("desk-next-60")).toBeInTheDocument();
  });

  it("'Iniciar luta' na próxima chama POST /start e a luta vira ao vivo na mesa", async () => {
    const { infantil } = twoCategories();
    fake.overrides["POST /events/7/tournament/matches/60/start"] = () =>
      json(200, { ...infantil, matches: [{ ...infantil.matches[0]!, status: "LIVE" }] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar luta: Eva contra Fabi" }));
    await waitFor(() => expect(sent(fake, "POST", "/matches/60/start")).toHaveLength(1));
    expect(await screen.findByTestId("desk-live-60")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("chaveamento-live")).toHaveTextContent("Luta iniciada: Eva contra Fabi."));
  });

  it("MONITOR vê a mesa, mas sem botões de iniciar nem de vencedor", async () => {
    loginAs("MONITOR");
    twoCategories();
    renderPage();
    await screen.findByTestId("desk-next-60");
    expect(screen.getByTestId("desk-live-51")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Iniciar luta/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Vencedor:/ })).not.toBeInTheDocument();
  });

  it("luta ao vivo: botões gigantes de vencedor com placar +/−; o placar vai no resultado", async () => {
    oneLive();
    renderPage();
    const card = await screen.findByTestId("desk-live-50");
    fireEvent.click(within(card).getByRole("button", { name: "Aumentar placar de Ana" }));
    fireEvent.click(within(card).getByRole("button", { name: "Aumentar placar de Ana" }));
    fireEvent.click(within(card).getByRole("button", { name: "Aumentar placar de Bia" }));
    fireEvent.click(within(card).getByRole("button", { name: "Diminuir placar de Bia" }));
    fireEvent.click(within(card).getByRole("button", { name: "Diminuir placar de Bia" })); // não passa de 0
    expect(within(card).getByLabelText("Placar de Ana")).toHaveValue("2");
    expect(within(card).getByLabelText("Placar de Bia")).toHaveValue("0");
    fireEvent.click(within(card).getByRole("button", { name: "Vencedor: Ana" }));
    await waitFor(() => expect(sent(fake, "POST", "/matches/50/result")).toHaveLength(1));
    expect(sent(fake, "POST", "/matches/50/result")[0]!.body).toEqual({ winnerId: 101, scoreA: 2, scoreB: 0, resultType: "NORMAL" });
  });

  it("W.O. fica no menu secundário e o botão de vencedor passa a dizer 'por W.O.'", async () => {
    oneLive();
    renderPage();
    const card = await screen.findByTestId("desk-live-50");
    expect(within(card).getByText(/W\.O\., desclassificação ou empate/)).toBeInTheDocument();
    fireEvent.change(within(card).getByLabelText("Tipo de resultado"), { target: { value: "WALKOVER" } });
    expect(within(card).getAllByText("VENCEU POR W.O.")).toHaveLength(2);
    fireEvent.click(within(card).getByRole("button", { name: "Vencedor: Bia" }));
    await waitFor(() => expect(sent(fake, "POST", "/matches/50/result")).toHaveLength(1));
    expect(sent(fake, "POST", "/matches/50/result")[0]!.body).toMatchObject({ winnerId: 102, resultType: "WALKOVER" });
  });
});

describe("atalhos de teclado (desktop)", () => {
  it("A dá a vitória ao lado A na luta ao vivo em foco", async () => {
    oneLive();
    renderPage();
    await screen.findByTestId("desk-live-50");
    fireEvent.keyDown(document.body, { key: "a" });
    await waitFor(() => expect(sent(fake, "POST", "/matches/50/result")).toHaveLength(1));
    expect(sent(fake, "POST", "/matches/50/result")[0]!.body).toMatchObject({ winnerId: 101 });
  });

  it("B dá a vitória ao lado B", async () => {
    oneLive();
    renderPage();
    await screen.findByTestId("desk-live-50");
    fireEvent.keyDown(document.body, { key: "B" });
    await waitFor(() => expect(sent(fake, "POST", "/matches/50/result")).toHaveLength(1));
    expect(sent(fake, "POST", "/matches/50/result")[0]!.body).toMatchObject({ winnerId: 102 });
  });

  it("U sem a janela do desfazer rápido pede confirmação (não desfaz sozinho)", async () => {
    oneLive();
    renderPage();
    await screen.findByTestId("desk-live-50");
    fireEvent.keyDown(document.body, { key: "u" });
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(/Desfazer o início da luta/);
    expect(sent(fake, "POST", "/undo")).toHaveLength(0);
  });

  it("I inicia a próxima luta da fila", async () => {
    const { infantil } = twoCategories();
    fake.overrides["POST /events/7/tournament/matches/60/start"] = () => json(200, { ...infantil, matches: [{ ...infantil.matches[0]!, status: "LIVE" }] });
    renderPage();
    await screen.findByTestId("desk-next-60");
    fireEvent.keyDown(document.body, { key: "i" });
    await waitFor(() => expect(sent(fake, "POST", "/matches/60/start")).toHaveLength(1));
  });

  it("não dispara enquanto a pessoa digita, com Ctrl ou com um diálogo aberto", async () => {
    oneLive();
    renderPage();
    const card = await screen.findByTestId("desk-live-50");
    const input = within(card).getByLabelText("Placar de Ana");
    fireEvent.keyDown(input, { key: "a" });
    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    fireEvent.click(within(card).getByRole("button", { name: /Desfazer início da luta/ }));
    await screen.findByRole("alertdialog");
    fireEvent.keyDown(document.body, { key: "b" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent(fake, "POST", "/matches/50/result")).toHaveLength(0);
  });
});

describe("desfazer rápido", () => {
  it("registrar o vencedor mostra 'Resultado registrado · DESFAZER'; DESFAZER desfaz na hora, sem confirmação", async () => {
    oneLive();
    renderPage();
    fireEvent.click(within(await screen.findByTestId("desk-live-50")).getByRole("button", { name: "Vencedor: Ana" }));
    const bar = await screen.findByTestId("undo-bar");
    expect(bar).toHaveTextContent("Resultado registrado");
    expect(bar).toHaveTextContent("Ana venceu");
    fireEvent.click(within(bar).getByRole("button", { name: /DESFAZER/ }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(sent(fake, "POST", "/matches/50/undo")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId("undo-bar")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("chaveamento-live")).toHaveTextContent(/Resultado desfeito|Luta desfeita/));
  });

  it("U desfaz na hora enquanto a barra existe", async () => {
    oneLive();
    renderPage();
    fireEvent.click(within(await screen.findByTestId("desk-live-50")).getByRole("button", { name: "Vencedor: Bia" }));
    await screen.findByTestId("undo-bar");
    fireEvent.keyDown(document.body, { key: "u" });
    await waitFor(() => expect(sent(fake, "POST", "/matches/50/undo")).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("a janela dura ~10 s (fake timers) e um novo resultado reinicia a contagem", () => {
    vi.useFakeTimers();
    function Offer() {
      const quick = useQuickUndo();
      return (
        <button onClick={() => quick.offer({ matchId: 1, categoryId: 1, label: "Ana venceu" })}>oferecer</button>
      );
    }
    render(
      <QueryClientProvider client={client()}>
        <AnnouncerProvider>
          <QuickUndoProvider>
            <Offer />
            <UndoBar eventId={7} />
          </QuickUndoProvider>
        </AnnouncerProvider>
      </QueryClientProvider>,
    );
    expect(QUICK_UNDO_MS).toBe(10_000);
    expect(screen.queryByTestId("undo-bar")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("oferecer"));
    expect(screen.getByTestId("undo-bar")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(9_000));
    expect(screen.getByTestId("undo-bar")).toBeInTheDocument();
    // outro resultado reinicia a janela
    fireEvent.click(screen.getByText("oferecer"));
    act(() => void vi.advanceTimersByTime(9_000));
    expect(screen.getByTestId("undo-bar")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1_100));
    expect(screen.queryByTestId("undo-bar")).not.toBeInTheDocument();
  });

  it("passada a janela, desfazer pela ação rápida volta a pedir confirmação", async () => {
    // Luta já encerrada: não há barra (a janela passou); o desfazer exige confirmação.
    const category = mkCategory({
      status: "FINISHED",
      competitors: [ANA, BIA],
      matches: [mkMatch(50, { slotAId: 101, slotBId: 102, status: "FINISHED", winnerId: 101, scoreA: 3, scoreB: 1, resultType: "NORMAL" })],
      podium: [{ place: 1, competitorId: 101 }],
    });
    fake.category = category;
    fake.tournament = mkTournament({ categories: [summaryOf(category)] });
    renderPage();
    fireEvent.click(await screen.findByTestId("match-50"));
    expect(screen.queryByTestId("undo-bar")).not.toBeInTheDocument();
    fireEvent.click(within(await screen.findByTestId("match-dialog")).getByRole("button", { name: /Desfazer/ }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(/Desfazer o resultado/);
    expect(sent(fake, "POST", "/undo")).toHaveLength(0);
  });

  it("resultado salvo pela ação rápida também abre a barra", async () => {
    oneLive();
    renderPage();
    fireEvent.click(await screen.findByTestId("match-50"));
    const dialog = await screen.findByTestId("match-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Vencedor: Bia" }));
    expect(await screen.findByTestId("undo-bar")).toHaveTextContent("Bia venceu");
  });
});

describe("chave: caminho do atleta e cartões", () => {
  it("tocar no avatar realça o caminho (chip + lutas de fora esmaecem); Limpar volta ao normal", () => {
    const matches = buildBracket(4).map((m, i) => (i === 0 ? { ...m, slotAId: 101, slotBId: 102 } : i === 1 ? { ...m, slotAId: 103, slotBId: 104 } : m));
    const competitors = competitorMap({ competitors: [ANA, BIA, CAIO, DUDA] });
    render(<BracketView matches={matches} competitors={competitors} onSelectMatch={() => undefined} />);
    expect(screen.queryByTestId("path-chip")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Destacar o caminho de Ana" }));
    expect(screen.getByTestId("path-chip")).toHaveTextContent("Caminho de Ana");
    expect(screen.getByTestId("path-chip")).toHaveTextContent("1 luta");
    // a luta de Caio x Duda fica esmaecida; a de Ana não
    expect(screen.getByTestId(`match-${String(matches[1]!.id)}`).parentElement).toHaveClass("opacity-35");
    expect(screen.getByTestId(`match-${String(matches[0]!.id)}`).parentElement).not.toHaveClass("opacity-35");
    fireEvent.click(screen.getByRole("button", { name: "Limpar o destaque do caminho" }));
    expect(screen.queryByTestId("path-chip")).not.toBeInTheDocument();
    expect(screen.getByTestId(`match-${String(matches[1]!.id)}`).parentElement).not.toHaveClass("opacity-35");
  });

  it("nomes das rodadas em português nos cabeçalhos fixos, com progresso", () => {
    const competitors = competitorMap({ competitors: [ANA, BIA] });
    render(<BracketView matches={buildBracket(8)} competitors={competitors} onSelectMatch={() => undefined} />);
    const header = screen.getByTestId("bracket-header");
    expect(header).toHaveTextContent("Quartas de final");
    expect(header).toHaveTextContent("Semifinais");
    expect(header).toHaveTextContent("Final");
    expect(header).toHaveTextContent("0/4");
    expect(header.className).toContain("sticky");
  });

  it("toque na luta abre a ação rápida; a luta ao vivo mostra o selo AO VIVO em texto", async () => {
    oneLive();
    renderPage();
    const card = await screen.findByTestId("match-50");
    expect(card).toHaveTextContent("AO VIVO");
    expect(card).toHaveAttribute("data-status", "LIVE");
    fireEvent.click(card);
    expect(await screen.findByTestId("match-dialog")).toBeInTheDocument();
  });
});

describe("atletas: selos, contadores, busca e edição em linha", () => {
  function setup(competitors = [
    mkCompetitor(101, "Ana", { seed: 1 }),
    mkCompetitor(102, "Bia", { ageGroup: "MINOR", photoAuthorized: false }),
    mkCompetitor(103, "Caio", { ageGroup: "MINOR", photoAuthorized: true, photoPublic: true }),
  ]) {
    const category = mkCategory({ competitors });
    fake.category = category;
    fake.tournament = mkTournament({ categories: [summaryOf(category)] });
    return category;
  }

  it("selos de foto no telão e de autorização do responsável por atleta", async () => {
    setup();
    renderPage();
    await screen.findByTestId("competitors-list");
    expect(screen.getByTestId("photo-indicator-101")).toHaveTextContent("Foto no telão: não");
    expect(screen.getByTestId("auth-indicator-101")).toHaveTextContent(/não se aplica/);
    expect(screen.getByTestId("auth-indicator-102")).toHaveTextContent("Autorização do responsável: não");
    expect(screen.getByTestId("auth-indicator-103")).toHaveTextContent("Autorização do responsável: sim");
    expect(screen.getByTestId("photo-indicator-103")).toHaveTextContent("Foto no telão: sim");
  });

  it("contador 'N atletas · M com semente' (e menores sem autorização)", async () => {
    setup();
    renderPage();
    expect(await screen.findByTestId("competitors-counter")).toHaveTextContent("3 atletas · 1 com semente · 1 sem autorização do responsável");
  });

  it("busca só aparece com 6+ atletas e filtra por nome ou academia", async () => {
    const six = ["Ana", "Bia", "Caio", "Duda", "Eva", "Fabi"].map((n, i) => mkCompetitor(101 + i, n, { groupName: i === 4 ? "Raiz Forte" : "Outro" }));
    setup(six);
    renderPage();
    const search = await screen.findByLabelText("Buscar atleta");
    fireEvent.change(search, { target: { value: "raiz" } });
    expect(within(screen.getByTestId("competitors-list")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByTestId("competitor-105")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByTestId("competitors-no-match")).toBeInTheDocument();
  });

  it("com poucos atletas não há busca", async () => {
    setup();
    renderPage();
    await screen.findByTestId("competitors-list");
    expect(screen.queryByLabelText("Buscar atleta")).not.toBeInTheDocument();
  });

  it("edição em linha: nome, grupo e semente num PATCH só; Esc cancela", async () => {
    setup();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edição rápida de Ana" }));
    const row = screen.getByTestId("competitor-quick-101");
    fireEvent.change(within(row).getByLabelText("Nome"), { target: { value: "Ana Maria" } });
    fireEvent.change(within(row).getByLabelText("Grupo / academia"), { target: { value: "Raiz" } });
    fireEvent.change(within(row).getByLabelText("Semente"), { target: { value: "2" } });
    fireEvent.click(within(row).getByRole("button", { name: /Salvar/ }));
    await waitFor(() => expect(fake.calls.filter((c) => c.method === "PATCH" && /competitors\/101$/.test(c.path))).toHaveLength(1));
    expect(fake.calls.find((c) => c.method === "PATCH")!.body).toEqual({ displayName: "Ana Maria", groupName: "Raiz", seed: 2 });
    await waitFor(() => expect(screen.queryByTestId("competitor-quick-101")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Edição rápida de Bia" }));
    fireEvent.keyDown(within(screen.getByTestId("competitor-quick-102")).getByLabelText("Nome"), { key: "Escape" });
    expect(screen.queryByTestId("competitor-quick-102")).not.toBeInTheDocument();
  });

  it("MONITOR não tem edição em linha", async () => {
    loginAs("MONITOR");
    setup();
    renderPage();
    await screen.findByTestId("competitors-list");
    expect(screen.queryByRole("button", { name: /Edição rápida/ })).not.toBeInTheDocument();
  });

  it("importar em lote: 'Selecionar todos' e contador de selecionados", async () => {
    setup();
    fake.participants = [
      { id: 1, eventId: 7, studentId: 9, guestName: null, status: "CONFIRMED", student: { id: 9, name: "Zeca" } },
      { id: 2, eventId: 7, studentId: null, guestName: "Yara", status: "ATTENDED", student: null },
    ];
    fake.overrides["GET /events/7/participants"] = () => json(200, fake.participants);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Adicionar do evento/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Selecionar todos" }));
    expect(within(dialog).getByText(/2 de 2 disponíveis selecionado/)).toBeInTheDocument();
  });
});

describe("sorteio: cerimônia e pré-visualização", () => {
  function readyToDraw() {
    const category = mkCategory({ competitors: [ANA, BIA] });
    fake.category = category;
    fake.tournament = mkTournament({ categories: [summaryOf(category)] });
  }

  it("com animação: a cerimônia aparece depois de gerar e 'Pular' a encerra", async () => {
    readyToDraw();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Gerar chave" }));
    const ceremony = await screen.findByTestId("draw-ceremony");
    expect(ceremony).toHaveTextContent(/Sorteando a chave/);
    fireEvent.click(within(ceremony).getByRole("button", { name: /Pular/ }));
    expect(screen.queryByTestId("draw-ceremony")).not.toBeInTheDocument();
    expect(await screen.findByTestId("bracket")).toBeInTheDocument();
  });

  it("com prefers-reduced-motion: sem cerimônia nenhuma (a chave aparece direto)", async () => {
    reduceMotion(true);
    readyToDraw();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Gerar chave" }));
    expect(await screen.findByTestId("bracket")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(screen.queryByTestId("draw-ceremony")).not.toBeInTheDocument();
  });

  it("a cerimônia dura menos de 2 s e some sozinha", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { CEREMONY_TOTAL_MS } = await import("@/modules/chaveamento/draw-ceremony");
    expect(CEREMONY_TOTAL_MS).toBeLessThanOrEqual(2000);
    const { DrawCeremony } = await import("@/modules/chaveamento/draw-ceremony");
    const done = vi.fn();
    render(<DrawCeremony athletes={[ANA, BIA]} onDone={done} />);
    expect(done).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(CEREMONY_TOTAL_MS + 10));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("'Sortear de novo' mostra o sorteio atual (será substituído) antes de confirmar", async () => {
    const category = mkCategory({
      status: "RUNNING",
      competitors: [ANA, BIA],
      matches: [mkMatch(50, { slotAId: 101, slotBId: 102, status: "READY" })],
    });
    fake.category = category;
    fake.tournament = mkTournament({ categories: [summaryOf(category)] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Sortear de novo" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByTestId("draw-preview")).toHaveTextContent("Ana x Bia");
    expect(dialog).toHaveTextContent("Sorteio atual (será substituído)");
  });
});

describe("estados vazios com passos", () => {
  it("sem torneio, sem categorias e sem atletas mostram 'Adicione atletas → Sorteie a chave → Inicie as lutas'", async () => {
    const { unmount } = renderPage();
    const empty = await screen.findByTestId("chaveamento-empty");
    expect(within(empty).getByTestId("steps-guide")).toHaveTextContent(/Adicione atletas.*Sorteie a chave.*Inicie as lutas/);
    unmount();

    fake.tournament = mkTournament();
    const second = renderPage();
    expect(within(await screen.findByTestId("categories-empty")).getByTestId("steps-guide")).toBeInTheDocument();
    second.unmount();

    const category = mkCategory();
    fake.category = category;
    fake.tournament = mkTournament({ categories: [summaryOf(category)] });
    renderPage();
    expect(within(await screen.findByTestId("competitors-empty")).getByTestId("steps-guide")).toBeInTheDocument();
  });

  it("mesa sem luta ao vivo e sem luta pronta explica o que esperar", async () => {
    const category = mkCategory({
      status: "RUNNING",
      competitors: [ANA, BIA],
      matches: [mkMatch(50, { slotAId: 101, slotBId: null, status: "PENDING" })],
    });
    fake.category = category;
    fake.tournament = mkTournament({ categories: [summaryOf(category)] });
    renderPage();
    expect(await screen.findByTestId("desk-live-empty")).toBeInTheDocument();
    expect(screen.getByTestId("desk-next-empty")).toHaveTextContent(/quando os dois atletas estiverem definidos/);
  });
});

describe("telão: cartão, modo TV e pré-visualização", () => {
  it("'Abrir telão' e 'Abrir em modo TV' (?tv=1) abrem em outra aba sem vazar o painel", async () => {
    fake.tournament = mkTournament({ publicEnabled: true });
    renderPage();
    const open = await screen.findByRole("link", { name: /Abrir telão/ });
    const tv = screen.getByRole("link", { name: /Abrir em modo TV/ });
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");
    expect(tv.getAttribute("href")).toMatch(/\/ao-vivo\/tok_abcdefghijklmnopqrstuvwx\?tv=1$/);
    expect(tv).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("a pré-visualização só carrega quando pedida, só com o telão ligado, e é um iframe isolado (sandbox, sem referrer)", async () => {
    fake.tournament = mkTournament({ publicEnabled: true });
    renderPage();
    await screen.findByTestId("tournament-card");
    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Mostrar pré-visualização/ }));
    const frame = (await screen.findByTitle(/Pré-visualização do telão/)) as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toMatch(/\/ao-vivo\/tok_abcdefghijklmnopqrstuvwx\?tv=1$/);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    fireEvent.click(screen.getByRole("button", { name: /Ocultar pré-visualização/ }));
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("telão desligado: botão da pré-visualização desabilitado e nenhum iframe", async () => {
    fake.tournament = mkTournament({ publicEnabled: false });
    renderPage();
    await screen.findByTestId("tournament-card");
    expect(screen.getByRole("button", { name: /Mostrar pré-visualização/ })).toBeDisabled();
    expect(screen.getByText(/Ligue o telão para ver a pré-visualização/)).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("não inventa 'pessoas assistindo': o backend não fornece esse dado", async () => {
    fake.tournament = mkTournament({ publicEnabled: true });
    renderPage();
    await screen.findByTestId("tournament-card");
    expect(document.body.textContent).not.toMatch(/assistindo agora|espectadores|pessoas assistindo/i);
  });
});

describe("campos que não devem aparecer na tela", () => {
  it("dados internos (nota da luta, ids de aluno/participante, semente do sorteio) não são renderizados; foto maliciosa nunca vira src", async () => {
    const category = mkCategory({
      status: "RUNNING",
      drawSeed: 987654321,
      competitors: [
        mkCompetitor(101, "Ana", { studentId: 424242, eventParticipantId: 535353, photoUrl: "javascript:alert(1)", photoAuthorizedAt: "2026-11-10T00:00:00.000Z" }),
        mkCompetitor(102, "Bia"),
      ],
      matches: [mkMatch(50, { slotAId: 101, slotBId: 102, status: "LIVE", note: "NOTA-INTERNA-SECRETA" })],
    });
    fake.category = category;
    fake.tournament = mkTournament({ publicEnabled: true, categories: [summaryOf(category)] });
    renderPage();
    await screen.findByTestId("desk-live-50");
    fireEvent.click(screen.getByTestId("match-50"));
    await screen.findByTestId("match-dialog");
    const html = document.body.innerHTML;
    for (const secret of ["NOTA-INTERNA-SECRETA", "424242", "535353", "987654321", "javascript:alert(1)"]) {
      expect(html, secret).not.toContain(secret);
    }
    expect(document.querySelectorAll("img[src^='javascript']")).toHaveLength(0);
  });
});
