import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { EventosPage } from "@/modules/eventos";
import { ChaveamentoPage } from "@/modules/chaveamento";
import { ApiError } from "@/lib/api";
import {
  TOURNAMENT_ERROR_CODES,
  TOURNAMENT_ERROR_MESSAGES,
  chaveamentoErrorMessage,
} from "@/modules/chaveamento/errors";
import { clearSession, loginAs } from "./login-as";
import { mkCategory, mkCompetitor, mkMatch, mkTournament, summaryOf } from "./chaveamento-fixtures";
import { EVENT, errorBody, installFakeBackend, json, newFake, sent, type Fake } from "./chaveamento-server";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

let fake: Fake;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChaveamentoPage eventId={7} />
    </QueryClientProvider>,
  );
}

/** Estado com torneio e uma categoria. */
function withCategory(category: ReturnType<typeof mkCategory>): void {
  fake.category = category;
  fake.tournament = mkTournament({ categories: [summaryOf(category)] });
}

beforeEach(() => {
  loginAs("MESTRE");
  fake = newFake();
  installFakeBackend(fake);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("chaveamento: torneio e categorias", () => {
  it("404 TOURNAMENT_NOT_FOUND mostra o vazio; 'Criar chaveamento' cria e mostra o telão", async () => {
    renderPage();
    expect(await screen.findByTestId("chaveamento-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Criar chaveamento" }));
    expect(await screen.findByTestId("tournament-card")).toBeInTheDocument();
    expect(sent(fake, "POST", "/events/7/tournament")).toHaveLength(1);
    expect(screen.getByTestId("categories-empty")).toBeInTheDocument();
  });

  it("erro de rede mostra a mensagem e 'Tentar de novo' recarrega", async () => {
    fake.overrides["GET /events/7/tournament"] = () => json(500, { message: "Falha geral" });
    renderPage();
    expect(await screen.findByTestId("chaveamento-error")).toBeInTheDocument();
    fake.overrides = {};
    fake.tournament = mkTournament();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByTestId("tournament-card")).toBeInTheDocument();
  });

  it("skeleton enquanto carrega", () => {
    fake.tournament = mkTournament();
    renderPage();
    expect(screen.getByTestId("chaveamento-loading")).toBeInTheDocument();
  });

  it("cria uma categoria (formato, 3º lugar) e abre a aba dela", async () => {
    fake.tournament = mkTournament();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Nova categoria/ }));
    fireEvent.change(screen.getByLabelText("Nome da categoria"), { target: { value: "Adulto até 70 kg" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar categoria" }));
    await waitFor(() => expect(sent(fake, "POST", "/categories")).toHaveLength(1));
    expect(sent(fake, "POST", "/categories")[0]!.body).toEqual({ name: "Adulto até 70 kg", format: "SINGLE_ELIMINATION", thirdPlace: true });
    expect(await screen.findByRole("tab", { name: /Adulto até 70 kg/ })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByTestId("competitors-empty")).toBeInTheDocument();
  });

  it("grupos + mata-mata envia nº de grupos e classificados por grupo", async () => {
    fake.tournament = mkTournament();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Nova categoria/ }));
    fireEvent.change(screen.getByLabelText("Nome da categoria"), { target: { value: "Misto" } });
    fireEvent.change(screen.getByLabelText("Formato"), { target: { value: "GROUPS_KNOCKOUT" } });
    fireEvent.change(screen.getByLabelText("Número de grupos"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Classificados por grupo"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar categoria" }));
    await waitFor(() => expect(sent(fake, "POST", "/categories")).toHaveLength(1));
    expect(sent(fake, "POST", "/categories")[0]!.body).toEqual({
      name: "Misto",
      format: "GROUPS_KNOCKOUT",
      thirdPlace: true,
      groupCount: 4,
      advancePerGroup: 2,
    });
  });

  it("nome repetido: mostra a mensagem do code CATEGORY_NAME_TAKEN dentro do diálogo", async () => {
    fake.tournament = mkTournament();
    fake.overrides["POST /events/7/tournament/categories"] = () => errorBody(409, "CATEGORY_NAME_TAKEN");
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Nova categoria/ }));
    fireEvent.change(screen.getByLabelText("Nome da categoria"), { target: { value: "Repetida" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar categoria" }));
    expect(await screen.findByText(TOURNAMENT_ERROR_MESSAGES.CATEGORY_NAME_TAKEN)).toBeInTheDocument();
  });
});

describe("chaveamento: telão público", () => {
  beforeEach(() => {
    fake.tournament = mkTournament();
  });

  it("mostra o link /ao-vivo/<token>, explica o que expõe e o QR", async () => {
    renderPage();
    const input = await screen.findByLabelText("Link do telão");
    expect((input as HTMLInputElement).value).toMatch(/\/ao-vivo\/tok_abcdefghijklmnopqrstuvwx$/);
    expect(screen.getByTestId("tournament-privacy")).toHaveTextContent(/nomes.*fotos.*autorização/);
    expect(await screen.findByAltText("QR Code do telão")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Abrir em modo TV/ })).toHaveAttribute("href", expect.stringContaining("?tv=1"));
    expect(screen.getByRole("link", { name: /Abrir telão/ })).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("liga o telão (PATCH publicEnabled)", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("switch", { name: "Telão público ligado" }));
    await waitFor(() => expect(sent(fake, "PATCH", "/events/7/tournament")).toHaveLength(1));
    expect(sent(fake, "PATCH", "/events/7/tournament")[0]!.body).toEqual({ publicEnabled: true });
    await waitFor(() => expect(screen.getByRole("switch", { name: "Telão público ligado" })).toHaveAttribute("aria-checked", "true"));
  });

  it("'Gerar novo link' pede confirmação e troca o link", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Gerar novo link/ }));
    expect(await screen.findByText(/param de funcionar na hora/)).toBeInTheDocument();
    expect(sent(fake, "POST", "/rotate-token")).toHaveLength(0);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Gerar novo link" }));
    await waitFor(() => expect(sent(fake, "POST", "/rotate-token")).toHaveLength(1));
    await waitFor(() => expect((screen.getByLabelText("Link do telão") as HTMLInputElement).value).toContain("tok_NOVONOVO"));
  });
});

describe("chaveamento: atletas, sorteio e luta", () => {
  it("adiciona atleta de fora; menor mostra a autorização de foto e adulto não", async () => {
    withCategory(mkCategory());
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Adicionar de fora/ }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Zé Menor" } });
    fireEvent.click(screen.getByLabelText("Maior de idade"));
    expect(screen.queryByLabelText(/Tenho autorização do responsável/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Menor de idade"));
    const auth = screen.getByRole("checkbox", { name: /Tenho autorização do responsável para exibir a foto no telão/ });
    fireEvent.click(auth);
    fireEvent.change(screen.getByLabelText(/Grupo/), { target: { value: "Academia X" } });
    fireEvent.change(screen.getByLabelText(/Semente/), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(sent(fake, "POST", "/competitors")).toHaveLength(1));
    expect(sent(fake, "POST", "/competitors")[0]!.body).toEqual({
      guest: { displayName: "Zé Menor", groupName: "Academia X", ageGroup: "MINOR", seed: 3, photoAuthorized: true },
    });
    expect(await screen.findByTestId("photo-indicator-101")).toHaveTextContent("Foto no telão: sim");
    // cadastro em UM POST: nenhum PATCH de acompanhamento (nem de autorização, nem de semente)
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fake.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("semente fora de 1..128 não chama a API", async () => {
    withCategory(mkCategory());
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Adicionar de fora/ }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Fulano" } });
    fireEvent.change(screen.getByLabelText(/Semente/), { target: { value: "129" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(await screen.findByText(/Semente: informe um número de 1 a 128/)).toBeInTheDocument();
    expect(sent(fake, "POST", "/competitors")).toHaveLength(0);
  });

  it("SEED_TAKEN no cadastro mostra a mensagem do code", async () => {
    withCategory(mkCategory());
    fake.overrides["POST /events/7/tournament/categories/5/competitors"] = () => errorBody(409, "SEED_TAKEN");
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Adicionar de fora/ }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Fulano" } });
    fireEvent.change(screen.getByLabelText(/Semente/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(await screen.findByText(TOURNAMENT_ERROR_MESSAGES.SEED_TAKEN)).toBeInTheDocument();
  });

  it("a foto do atleta de fora NÃO é digitável: não há campo de endereço, só enviar/tirar foto (PhotoPicker)", async () => {
    withCategory(mkCategory());
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Adicionar de fora/ }));
    const dialog = await screen.findByTestId("competitor-dialog");
    expect(within(dialog).getByTestId("photo-picker")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Enviar foto" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Tirar foto/ })).toBeInTheDocument();
    // nenhum campo de texto/URL ligado a foto
    expect(dialog.querySelector("input[type=url]")).toBeNull();
    expect(dialog.querySelector("input[inputmode=url]")).toBeNull();
    expect(within(dialog).queryByPlaceholderText(/https/)).toBeNull();
    expect(within(dialog).queryByLabelText(/endereço/i)).toBeNull();
    // o cadastro sem foto não manda `photoUrl` (o backend real recusa com 400 PHOTO_URL_NOT_ALLOWED)
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Fulano" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(sent(fake, "POST", "/competitors")).toHaveLength(1));
    expect(JSON.stringify(sent(fake, "POST", "/competitors")[0]!.body)).not.toContain("photoUrl");
    expect(sent(fake, "POST", "/photo")).toHaveLength(0); // sem foto escolhida: nada de envio de foto
  });

  it("com menos de 2 atletas o botão Gerar chave fica desabilitado", async () => {
    withCategory(mkCategory({ competitors: [mkCompetitor(101, "Ana")] }));
    renderPage();
    const generate = await screen.findByRole("button", { name: "Gerar chave" });
    expect(generate).toBeDisabled();
    expect(screen.getByText(/São necessários pelo menos 2 atletas/)).toBeInTheDocument();
  });

  it("gera a chave com o modo escolhido; depois 'Sortear de novo' pede confirmação", async () => {
    withCategory(mkCategory({ competitors: [mkCompetitor(101, "Ana"), mkCompetitor(102, "Bia")] }));
    renderPage();
    fireEvent.click(await screen.findByLabelText(/Evitar mesmo grupo/));
    fireEvent.click(screen.getByRole("button", { name: "Gerar chave" }));
    await waitFor(() => expect(sent(fake, "POST", "/generate")).toHaveLength(1));
    expect(sent(fake, "POST", "/generate")[0]!.body).toEqual({ seeding: "AVOID_SAME_GROUP" });
    expect(await screen.findByTestId("bracket")).toBeInTheDocument();
    // já gerada: "Sortear de novo" com confirmação e regenerate:true
    fireEvent.click(screen.getByLabelText(/Evitar mesmo grupo/));
    fireEvent.click(screen.getByRole("button", { name: "Sortear de novo" }));
    expect(sent(fake, "POST", "/generate")).toHaveLength(1);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Sortear de novo" }));
    await waitFor(() => expect(sent(fake, "POST", "/generate")).toHaveLength(2));
    expect(sent(fake, "POST", "/generate")[1]!.body).toEqual({ seeding: "AVOID_SAME_GROUP", regenerate: true });
  });

  it("HAS_RESULTS ao sortear de novo mostra a mensagem do code", async () => {
    withCategory(
      mkCategory({
        status: "RUNNING",
        competitors: [mkCompetitor(101, "Ana"), mkCompetitor(102, "Bia")],
        matches: [mkMatch(50, { slotAId: 101, slotBId: 102, status: "READY" })],
      }),
    );
    fake.overrides["POST /events/7/tournament/categories/5/generate"] = () => errorBody(409, "HAS_RESULTS");
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Sortear de novo" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Sortear de novo" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(TOURNAMENT_ERROR_MESSAGES.HAS_RESULTS));
  });

  it("inicia a luta, registra o vencedor com placar e anuncia o resultado salvo", async () => {
    withCategory(
      mkCategory({
        status: "RUNNING",
        competitors: [mkCompetitor(101, "Ana"), mkCompetitor(102, "Bia")],
        matches: [mkMatch(50, { slotAId: 101, slotBId: 102, status: "READY" })],
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("match-50"));
    const dialog = await screen.findByTestId("match-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Iniciar luta/ }));
    await waitFor(() => expect(sent(fake, "POST", "/matches/50/start")).toHaveLength(1));
    // placar e vencedor
    fireEvent.change(await within(dialog).findByLabelText("Placar de Ana"), { target: { value: "3" } });
    fireEvent.change(within(dialog).getByLabelText("Placar de Bia"), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Vencedor: Ana" }));
    await waitFor(() => expect(sent(fake, "POST", "/matches/50/result")).toHaveLength(1));
    expect(sent(fake, "POST", "/matches/50/result")[0]!.body).toEqual({ winnerId: 101, scoreA: 3, scoreB: 1, resultType: "NORMAL" });
    await waitFor(() => expect(screen.queryByTestId("match-dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("chaveamento-live")).toHaveTextContent("Resultado salvo: Ana venceu Ana contra Bia."));
    // pódio e cartão encerrado (texto + cor)
    expect(await screen.findByTestId("podium")).toHaveTextContent("1º lugar");
    expect(screen.getByTestId("match-50")).toHaveAttribute("data-status", "FINISHED");
  });

  it("placar inválido não chama a API", async () => {
    withCategory(
      mkCategory({
        status: "RUNNING",
        competitors: [mkCompetitor(101, "Ana"), mkCompetitor(102, "Bia")],
        matches: [mkMatch(50, { slotAId: 101, slotBId: 102, status: "LIVE" })],
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("match-50"));
    const dialog = await screen.findByTestId("match-dialog");
    fireEvent.change(within(dialog).getByLabelText("Placar de Ana"), { target: { value: "1000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Vencedor: Ana" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/0 a 999/);
    expect(sent(fake, "POST", "/matches/50/result")).toHaveLength(0);
  });

  it("empate só aparece em lutas de grupo", async () => {
    withCategory(
      mkCategory({
        format: "ROUND_ROBIN",
        status: "RUNNING",
        competitors: [mkCompetitor(101, "Ana"), mkCompetitor(102, "Bia")],
        matches: [
          mkMatch(60, { key: "GROUP-0-1-0", stage: "GROUP", groupIndex: 0, slotAId: 101, slotBId: 102, status: "READY" }),
        ],
        standings: [{ groupIndex: 0, rows: [] }],
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("match-60"));
    const dialog = await screen.findByTestId("match-dialog");
    fireEvent.change(within(dialog).getByLabelText("Tipo de resultado"), { target: { value: "DRAW" } });
    expect(within(dialog).getByRole("button", { name: "Registrar empate" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Vencedor:/ })).not.toBeInTheDocument();
  });

  it("desfaz com confirmação; DEPENDENT_MATCH_PLAYED mostra a mensagem certa", async () => {
    withCategory(
      mkCategory({
        status: "RUNNING",
        competitors: [mkCompetitor(101, "Ana"), mkCompetitor(102, "Bia")],
        matches: [mkMatch(50, { slotAId: 101, slotBId: 102, status: "FINISHED", winnerId: 101, scoreA: 3, scoreB: 1, resultType: "NORMAL" })],
      }),
    );
    fake.overrides["POST /events/7/tournament/matches/50/undo"] = () => errorBody(409, "DEPENDENT_MATCH_PLAYED");
    renderPage();
    fireEvent.click(await screen.findByTestId("match-50"));
    const dialog = await screen.findByTestId("match-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Desfazer/ }));
    expect(sent(fake, "POST", "/undo")).toHaveLength(0); // pede confirmação antes
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Desfazer" }));
    const message = "A próxima luta já começou. Desfaça as lutas seguintes primeiro, na ordem inversa.";
    expect(TOURNAMENT_ERROR_MESSAGES.DEPENDENT_MATCH_PLAYED).toBe(message);
    expect(await within(screen.getByTestId("match-dialog")).findByTestId("match-error")).toHaveTextContent(message);
    expect(toast.error).toHaveBeenCalledWith(message);
  });

  it("desfaz com sucesso: a luta volta a PRONTA", async () => {
    withCategory(
      mkCategory({
        status: "FINISHED",
        competitors: [mkCompetitor(101, "Ana"), mkCompetitor(102, "Bia")],
        matches: [mkMatch(50, { slotAId: 101, slotBId: 102, status: "FINISHED", winnerId: 101, scoreA: 3, scoreB: 1, resultType: "NORMAL" })],
        podium: [{ place: 1, competitorId: 101 }],
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("match-50"));
    fireEvent.click(within(await screen.findByTestId("match-dialog")).getByRole("button", { name: /Desfazer/ }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(sent(fake, "POST", "/matches/50/undo")).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("match-50")).toHaveAttribute("data-status", "READY"));
  });

  it("salva tatame e ordem (PATCH /matches/:id)", async () => {
    withCategory(
      mkCategory({
        status: "RUNNING",
        competitors: [mkCompetitor(101, "Ana"), mkCompetitor(102, "Bia")],
        matches: [mkMatch(50, { slotAId: 101, slotBId: 102, status: "READY" })],
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("match-50"));
    const dialog = await screen.findByTestId("match-dialog");
    fireEvent.change(within(dialog).getByLabelText(/Tatame/), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Ordem de chamada"), { target: { value: "3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar tatame e ordem" }));
    await waitFor(() => expect(sent(fake, "PATCH", "/matches/50")).toHaveLength(1));
    expect(sent(fake, "PATCH", "/matches/50")[0]!.body).toEqual({ mat: 2, queueOrder: 3 });
  });

  it("lutas de folga não têm botão de resultado", async () => {
    withCategory(
      mkCategory({
        status: "RUNNING",
        competitors: [mkCompetitor(101, "Ana"), mkCompetitor(102, "Bia")],
        matches: [mkMatch(51, { slotAId: 101, isBye: true, status: "FINISHED", winnerId: 101 })],
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("match-51"));
    const dialog = await screen.findByTestId("match-dialog");
    expect(within(dialog).getByText(/Folga: este atleta avança automaticamente/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Vencedor:|Iniciar|Desfazer/ })).not.toBeInTheDocument();
  });
});

describe("chaveamento: troca de atletas na 1ª rodada", () => {
  function twoMatches() {
    withCategory(
      mkCategory({
        status: "RUNNING",
        competitors: [101, 102, 103, 104].map((id, i) => mkCompetitor(id, `Atleta ${String(i + 1)}`)),
        matches: [
          mkMatch(70, { round: 1, position: 0, slotAId: 101, slotBId: 102, status: "READY", nextMatchId: 72, nextSlot: "A" }),
          mkMatch(71, { round: 1, position: 1, slotAId: 103, slotBId: 104, status: "READY", nextMatchId: 72, nextSlot: "B" }),
          mkMatch(72, { key: "MAIN-2-0", round: 2, position: 0 }),
        ],
      }),
    );
  }

  it("toca num atleta e depois noutro: PATCH /slots com o atleta do outro lugar", async () => {
    twoMatches();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Trocar atletas/ }));
    fireEvent.click(screen.getByTestId("swap-70-B")); // Atleta 2
    expect(screen.getByTestId("swap-hint")).toHaveTextContent("Selecionado: Atleta 2");
    expect(screen.getByTestId("swap-70-B")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("swap-71-A")); // Atleta 3
    await waitFor(() => expect(sent(fake, "PATCH", "/matches/70/slots")).toHaveLength(1));
    expect(sent(fake, "PATCH", "/matches/70/slots")[0]!.body).toEqual({ slotBId: 103 });
  });

  it("tocar de novo no mesmo atleta cancela a seleção", async () => {
    twoMatches();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Trocar atletas/ }));
    fireEvent.click(screen.getByTestId("swap-70-A"));
    fireEvent.click(screen.getByTestId("swap-70-A"));
    expect(screen.getByTestId("swap-hint")).toHaveTextContent(/Toque num atleta da 1ª rodada/);
    expect(sent(fake, "PATCH", "/slots")).toHaveLength(0);
  });

  it("depois que uma luta começa, a troca some", async () => {
    twoMatches();
    fake.category!.matches[0]!.status = "LIVE";
    renderPage();
    await screen.findByTestId("bracket");
    expect(screen.queryByRole("button", { name: /Trocar atletas/ })).not.toBeInTheDocument();
  });

  it("SWAP_NOT_ALLOWED mostra a mensagem do code", async () => {
    twoMatches();
    fake.overrides["PATCH /events/7/tournament/matches/70/slots"] = () => errorBody(409, "SWAP_NOT_ALLOWED");
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Trocar atletas/ }));
    fireEvent.click(screen.getByTestId("swap-70-A"));
    fireEvent.click(screen.getByTestId("swap-71-B"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(TOURNAMENT_ERROR_MESSAGES.SWAP_NOT_ALLOWED));
  });
});

describe("chaveamento: regra visual da foto", () => {
  it("indicador 'foto no telão' segue photoPublic; foto só em <img> https com no-referrer; autorização só para não adultos", async () => {
    withCategory(
      mkCategory({
        competitors: [
          mkCompetitor(101, "Adulto Com Foto", { photoUrl: "https://exemplo.com/a.png", photoPublic: true, ageGroup: "ADULT" }),
          mkCompetitor(102, "Menor Sem Autorização", { photoUrl: "https://exemplo.com/b.png", photoPublic: false, ageGroup: "MINOR" }),
          mkCompetitor(103, "Menor Autorizado", { photoUrl: "https://exemplo.com/c.png", photoPublic: true, photoAuthorized: true, ageGroup: "MINOR" }),
          mkCompetitor(104, "Foto Maliciosa", { photoUrl: "javascript:alert(1)", ageGroup: "ADULT" }),
        ],
      }),
    );
    renderPage();
    await screen.findByTestId("competitors-list");
    expect(screen.getByTestId("photo-indicator-101")).toHaveTextContent("Foto no telão: sim");
    expect(screen.getByTestId("photo-indicator-102")).toHaveTextContent("Foto no telão: não");
    expect(screen.getByTestId("photo-indicator-103")).toHaveTextContent("Foto no telão: sim");
    expect(screen.getByTestId("photo-indicator-104")).toHaveTextContent("Foto no telão: não");

    const imgs = Array.from(document.querySelectorAll("img")).filter((i) => i.closest("[data-testid=competitors-list]"));
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([
      "https://exemplo.com/a.png",
      "https://exemplo.com/c.png", // lista ordenada por nome: Menor Autorizado vem antes de Menor Sem Autorização
      "https://exemplo.com/b.png",
    ]); // o `javascript:` NUNCA vira src
    for (const img of imgs) {
      expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
      expect(img.getAttribute("alt")).toBe("");
    }

    // a caixa de autorização só aparece ao editar quem não é adulto
    fireEvent.click(screen.getByRole("button", { name: "Editar Menor Sem Autorização" }));
    expect(await screen.findByRole("checkbox", { name: /autorização do responsável/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: /autorização do responsável/ })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Editar Adulto Com Foto" }));
    await screen.findByLabelText("Nome");
    expect(screen.queryByRole("checkbox", { name: /autorização do responsável/ })).not.toBeInTheDocument();
  });

  it("atleta ligado a aluno: edição não oferece nem envia faixa etária nem foto", async () => {
    withCategory(
      mkCategory({
        status: "RUNNING",
        competitors: [mkCompetitor(101, "Aluna Ana", { studentId: 9, ageGroup: "MINOR" }), mkCompetitor(102, "Bia")],
        matches: [mkMatch(50, { slotAId: 101, slotBId: 102, status: "READY" })],
      }),
    );
    renderPage();
    await screen.findByTestId("bracket");
    fireEvent.click(screen.getByText(/Atletas \(2\)/));
    fireEvent.click(await screen.findByRole("button", { name: "Editar Aluna Ana" }));
    await screen.findByLabelText("Nome");
    expect(screen.queryByLabelText(/Foto/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Menor de idade")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /autorização do responsável/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(fake.calls.filter((c) => c.method === "PATCH" && /competitors\/101$/.test(c.path))).toHaveLength(1));
    const body = fake.calls.find((c) => c.method === "PATCH" && /competitors\/101$/.test(c.path))!.body as Record<string, unknown>;
    expect(body).toEqual({ displayName: "Aluna Ana", groupName: null, graduationLabel: null, photoAuthorized: true });
    expect("ageGroup" in body || "photoUrl" in body || "seed" in body).toBe(false);
  });
});

describe("chaveamento: permissão (MONITOR só lê)", () => {
  it("sem botões de escrita e com aviso de somente leitura", async () => {
    loginAs("MONITOR");
    withCategory(
      mkCategory({
        status: "RUNNING",
        competitors: [mkCompetitor(101, "Ana"), mkCompetitor(102, "Bia")],
        matches: [mkMatch(50, { slotAId: 101, slotBId: 102, status: "READY" })],
      }),
    );
    renderPage();
    expect(await screen.findByTestId("readonly-note")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nova categoria/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Gerar novo link/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sortear de novo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Trocar atletas/ })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Telão público ligado" })).toBeDisabled();
    fireEvent.click(screen.getByTestId("match-50"));
    const dialog = await screen.findByTestId("match-dialog");
    expect(within(dialog).getByText(/Somente leitura/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Iniciar|Vencedor:|Desfazer|Salvar/ })).not.toBeInTheDocument();
  });

  it("sem permissão, o vazio não oferece criar", async () => {
    loginAs("MONITOR");
    renderPage();
    expect(await screen.findByTestId("chaveamento-empty")).toHaveTextContent(/Peça a um professor/);
    expect(screen.queryByRole("button", { name: "Criar chaveamento" })).not.toBeInTheDocument();
  });
});

describe("chaveamento: mapa de erros", () => {
  /** Todo `code` listado no briefing e no backend (tournament-rules.ts) precisa de mensagem em português. */
  const EXPECTED_CODES = [
    "TOURNAMENT_NOT_FOUND", "TOURNAMENT_EXISTS", "EVENT_NOT_TOURNAMENT", "EVENT_NOT_FOUND", "CATEGORY_NOT_FOUND",
    "COMPETITOR_NOT_FOUND", "MATCH_NOT_FOUND", "CATEGORY_LIMIT", "CATEGORY_NAME_TAKEN", "CATEGORY_FULL", "NOT_IN_SETUP",
    "COMPETITOR_EXISTS", "SEED_TAKEN", "ALREADY_GENERATED", "HAS_RESULTS", "NOT_ENOUGH_COMPETITORS", "SWAP_NOT_ALLOWED",
    "MATCH_ALREADY_FINISHED", "MATCH_NOT_READY", "MATCH_IS_BYE", "NOTHING_TO_UNDO", "DEPENDENT_MATCH_PLAYED",
    "INCONSISTENT_STATE", "INVALID_GROUP_CONFIG", "INVALID_RESULT", "INVALID_COMPETITOR", "INVALID_PHOTO_URL",
    "PARTICIPANT_NOT_ELIGIBLE", "STUDENT_NOT_ELIGIBLE", "AGE_GROUP_FROM_STUDENT",
    // foto do atleta (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md 6 e 9): TODOS precisam de mensagem acionável
    "PHOTO_URL_NOT_ALLOWED", "PHOTO_FROM_STUDENT", "PHOTO_TOO_LARGE", "PHOTO_TYPE_NOT_ALLOWED", "PHOTO_UNREADABLE",
    "PHOTO_QUOTA", "PHOTO_PROCESSING_UNAVAILABLE", "PHOTO_NOT_FOUND", "PHOTO_FILE_REQUIRED",
    // existem no backend além da lista do briefing:
    "NOT_GENERATED", "TOO_MANY_VIEWERS",
  ];

  it.each(EXPECTED_CODES)("%s tem mensagem em português, e o ApiError com esse code usa a mensagem do mapa", (code) => {
    expect(TOURNAMENT_ERROR_CODES).toContain(code);
    const text = TOURNAMENT_ERROR_MESSAGES[code as keyof typeof TOURNAMENT_ERROR_MESSAGES];
    expect(text.length).toBeGreaterThan(15);
    expect(text).not.toBe(code);
    expect(text).toMatch(/[a-zà-ú]/);
    const error = new ApiError("texto técnico do servidor", 409, code);
    expect(chaveamentoErrorMessage(error)).toBe(text);
  });

  it("o mapa não tem código a mais nem a menos que a lista conhecida", () => {
    expect([...TOURNAMENT_ERROR_CODES].sort()).toEqual([...EXPECTED_CODES].sort());
  });

  it("AGE_GROUP_FROM_STUDENT: texto exato combinado com o backend", () => {
    expect(TOURNAMENT_ERROR_MESSAGES.AGE_GROUP_FROM_STUDENT).toBe(
      "A faixa etária deste atleta vem do cadastro do aluno e não pode ser alterada aqui.",
    );
  });

  it("sem code (validação de DTO) usa o texto do servidor; erro de rede usa o fallback", () => {
    expect(chaveamentoErrorMessage(new ApiError("name: de 1 a 80 caracteres.", 400))).toBe("name: de 1 a 80 caracteres.");
    expect(chaveamentoErrorMessage(new Error("Failed to fetch"), "Sem rede.")).toBe("Sem rede.");
    expect(chaveamentoErrorMessage(new ApiError("Erro 500 ao chamar /x", 500), "Falhou.")).toBe("Falhou.");
    expect(chaveamentoErrorMessage(new ApiError("Forbidden", 403))).toMatch(/permissão/);
  });
});

describe("chaveamento: acesso a partir de Eventos", () => {
  it("só eventos CAMPEONATO têm o botão 'Chaveamento'", async () => {
    const events = [
      { ...EVENT, id: 7, title: "Copa Gingado", type: "CAMPEONATO" },
      { ...EVENT, id: 8, title: "Batizado 2026", type: "BATIZADO" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        const path = input.replace(/^https?:\/\/[^/]+\/api/, "").split("?")[0];
        if (path === "/events") return Promise.resolve(json(200, events, { "X-Total-Count": "2" }));
        return Promise.resolve(json(200, []));
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <EventosPage />
      </QueryClientProvider>,
    );
    const link = await screen.findByRole("link", { name: "Chaveamento de Copa Gingado" });
    expect(link).toHaveAttribute("href", "/eventos/7/chaveamento");
    expect(screen.queryByRole("link", { name: "Chaveamento de Batizado 2026" })).not.toBeInTheDocument();
  });
});
