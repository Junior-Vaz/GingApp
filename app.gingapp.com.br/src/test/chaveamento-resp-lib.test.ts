import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { athletePathMatchIds, athleteStateLabel, MAX_QUERY_LENGTH, normalizeText, sanitizeQuery, searchAthletes } from "@/lib/chaveamento/athlete-search";
import { computeBracketLayout } from "@/lib/chaveamento/bracket-layout";
import { cardsInWindow, clampZoom, fitWidthScale, isOutsideWindow, quantizeWindow, scrollLeftToCenter, ZOOM_MAX, ZOOM_MIN } from "@/lib/chaveamento/bracket-window";
import { POLL_BACKOFF_MAX_MS, POLL_INTERVAL_MS, pollDelayAfter } from "@/lib/chaveamento/connection";
import { parseLiveSearch } from "@/lib/chaveamento/live-search";
import { parseTvSearch } from "@/lib/chaveamento/search";
import { withCategoryParam } from "@/lib/chaveamento/url-state";
import { shareLink } from "@/lib/chaveamento/share";
import { buildKnockout, category, comp, match, snapshot } from "./chaveamento-fixtures";

/** Testes das peças puras do celular: busca de atleta, links profundos, janela da chave, compartilhar e recuo da consulta. */

const twoFights = (over: { live?: boolean } = {}) =>
  snapshot(1, [
    category(1, {
      name: "Adulto até 70 kg",
      competitors: [comp(1, { name: "João Pedro da Conceição", group: "Maré Viva" }), comp(2, { name: "Bia Lima", group: "Axé Nagô" }), comp(3, { name: "Cris Rocha", group: "Maré Viva" }), comp(4, { name: "Duda Melo" })],
      matches: [
        match(10, { key: "MAIN-1-0", round: 1, position: 0, slotAId: 1, slotBId: 2, nextMatchId: 12, nextSlot: "A", status: over.live ? "LIVE" : "READY", mat: "2", queueOrder: 1 }),
        match(11, { key: "MAIN-1-1", round: 1, position: 1, slotAId: 3, slotBId: 4, nextMatchId: 12, nextSlot: "B", status: "READY", queueOrder: 2 }),
        match(12, { key: "MAIN-2-0", round: 2, position: 0 }),
      ],
    }),
    category(2, { name: "Infantil", competitors: [comp(21, { name: "Joana Prates", group: "Ginga Sul" })], matches: [] }),
  ]);

describe("chaveamento (celular): texto de busca só texto", () => {
  it("tira controles, < >, colapsa espaços e corta em 60 caracteres (por caractere, não por byte)", () => {
    expect(sanitizeQuery("  Maria \u0000 \n\t  Souza  ")).toBe("Maria Souza");
    expect(sanitizeQuery("<img src=x onerror=alert(1)>")).toBe("img src=x onerror=alert(1)");
    expect(sanitizeQuery("‮evil​")).toBe("evil");
    const long = "a".repeat(200);
    expect(sanitizeQuery(long)).toHaveLength(MAX_QUERY_LENGTH);
    const emojis = "🥋".repeat(100);
    expect(Array.from(sanitizeQuery(emojis))).toHaveLength(MAX_QUERY_LENGTH);
  });

  it("número vira texto; qualquer outro tipo some", () => {
    expect(sanitizeQuery(123)).toBe("123");
    expect(sanitizeQuery(Number.NaN)).toBe("");
    expect(sanitizeQuery(null)).toBe("");
    expect(sanitizeQuery({ a: 1 })).toBe("");
    expect(sanitizeQuery(["x"])).toBe("");
  });

  it("normalização: sem acento e sem diferença de caixa", () => {
    expect(normalizeText("  JOÃO   Çarvalho ")).toBe("joao carvalho");
  });
});

describe("chaveamento (celular): ?categoria= e ?q= da URL", () => {
  it("tv continua valendo; categoria só aceita inteiro positivo; q é sanitizado", () => {
    expect(parseLiveSearch({})).toEqual({});
    expect(parseLiveSearch({ tv: "1", categoria: "801", q: "maria" })).toEqual({ tv: 1, categoria: 801, q: "maria" });
    expect(parseLiveSearch({ tv: 1, categoria: 7 })).toEqual({ tv: 1, categoria: 7 });
    expect(parseLiveSearch({ categoria: "abc" })).toEqual({});
    expect(parseLiveSearch({ categoria: "-3" })).toEqual({});
    expect(parseLiveSearch({ categoria: 0 })).toEqual({});
    expect(parseLiveSearch({ categoria: "1.5" })).toEqual({});
    expect(parseLiveSearch({ categoria: "99999999999999" })).toEqual({});
    expect(parseLiveSearch({ categoria: ["1", "2"] })).toEqual({});
    expect(parseLiveSearch({ q: 123 })).toEqual({ q: "123" });
    expect(parseLiveSearch({ q: "   " })).toEqual({});
    expect(parseLiveSearch({ q: "x".repeat(500) }).q).toHaveLength(60);
    // compatibilidade: a leitura antiga do ?tv=1 segue igual
    expect(parseTvSearch({ tv: 1 })).toEqual({ tv: 1 });
  });

  it("withCategoryParam troca só a categoria e preserva tv, q e o #", () => {
    expect(withCategoryParam("https://app.test/ao-vivo/tok", 5)).toBe("/ao-vivo/tok?categoria=5");
    expect(withCategoryParam("https://app.test/ao-vivo/tok?tv=1", 5)).toBe("/ao-vivo/tok?tv=1&categoria=5");
    expect(withCategoryParam("https://app.test/ao-vivo/tok?categoria=2&tv=1&q=ana#topo", 9)).toBe("/ao-vivo/tok?categoria=9&tv=1&q=ana#topo");
    expect(withCategoryParam("isto não é url", 3)).toBe("isto não é url");
  });
});

describe("chaveamento (celular): busca de atleta ou grupo", () => {
  it("acha por nome ou grupo, sem acento e sem caixa; exige 2 letras; começa-por vem antes", () => {
    const snap = twoFights();
    expect(searchAthletes(snap, "")).toEqual([]);
    expect(searchAthletes(snap, "j")).toEqual([]);
    expect(searchAthletes(snap, "joao").map((h) => h.competitor.id)).toEqual([1]);
    expect(searchAthletes(snap, "JOAO PEDRO").map((h) => h.competitor.id)).toEqual([1]);
    expect(searchAthletes(snap, "mare viva").map((h) => h.competitor.id)).toEqual([1, 3]);
    expect(searchAthletes(snap, "jo").map((h) => h.competitor.id)).toEqual([1, 21]); // João (categoria 1) e Joana (categoria 2)
    // quem COMEÇA pelo texto vem antes de quem só contém
    const ranked = searchAthletes(snap, "ia").map((h) => h.competitor.name);
    expect(ranked).toEqual(["Bia Lima"]);
    expect(searchAthletes(snap, "xyz nada")).toEqual([]);
  });

  it("estado do atleta: ao vivo > próxima > aguardando > sem luta; só dados do snapshot", () => {
    const next = searchAthletes(twoFights(), "joao")[0]!;
    expect(next.state).toBe("next");
    expect(next.match?.id).toBe(10);
    expect(next.opponent?.name).toBe("Bia Lima");
    expect(next.stageLabel).toBe("Semifinais");
    expect(next.targetMatchId).toBe(10);
    expect(athleteStateLabel(next)).toBe("Próxima luta definida");

    const live = searchAthletes(twoFights({ live: true }), "joao")[0]!;
    expect(live.state).toBe("live");
    expect(athleteStateLabel(live)).toBe("Luta ao vivo agora");

    const none = searchAthletes(twoFights(), "joana")[0]!;
    expect(none.state).toBe("none");
    expect(none.match).toBeNull();
    expect(none.targetMatchId).toBeNull();
    expect(athleteStateLabel(none)).toBe("Sem luta pendente");

    // o atleta que só tem a final pela frente: aguarda a luta anterior, mas a tela sabe para onde rolar
    const snap = snapshot(1, [
      category(1, {
        competitors: [comp(1, { name: "Ana" }), comp(2, { name: "Bia" })],
        matches: [match(10, { round: 2, slotAId: 1, slotBId: 2, status: "PENDING" })],
      }),
    ]);
    const waiting = searchAthletes(snap, "ana")[0]!;
    expect(waiting.state).toBe("waiting");
    expect(waiting.targetMatchId).toBe(10);
    expect(waiting.match).toBeNull();
  });

  it("limita a lista e nunca explode com texto estranho", () => {
    const many = snapshot(1, [category(1, { competitors: Array.from({ length: 50 }, (_, i) => comp(i + 1, { name: `Atleta ${i}` })), matches: [] })]);
    expect(searchAthletes(many, "atleta")).toHaveLength(8);
    expect(searchAthletes(many, "atleta", 3)).toHaveLength(3);
    expect(() => searchAthletes(many, "(((* [ \\ ^$")).not.toThrow();
  });

  it("caminho do atleta = as lutas em que ele aparece", () => {
    const ids = athletePathMatchIds(
      [
        { id: 1, slotAId: 7, slotBId: 8 },
        { id: 2, slotAId: 7, slotBId: 9 },
        { id: 3, slotAId: 10, slotBId: 11 },
      ],
      7,
    );
    expect([...ids]).toEqual([1, 2]);
    expect(athletePathMatchIds([], 7).size).toBe(0);
  });
});

describe("chaveamento (celular): janela visível da chave (128 atletas sem travar)", () => {
  const { matches } = buildKnockout(128);
  const layout = computeBracketLayout(matches);

  it("só os cartões perto da tela entram; a janela anda em degraus", () => {
    expect(layout.cards.length).toBe(127);
    const win = quantizeWindow({ x0: -100, x1: 500, y0: 0, y1: 900 });
    expect(win).toEqual({ x0: 0, x1: 720, y0: 0, y1: 960 });
    const drawn = cardsInWindow(layout.cards, win);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(40);
    expect(drawn.every((c) => c.x <= win.x1 && c.y <= win.y1)).toBe(true);
    expect(cardsInWindow(layout.cards, null)).toHaveLength(127);
  });

  it("rolar para baixo troca os cartões; o conjunto muda só ao cruzar um degrau", () => {
    const a = quantizeWindow({ x0: 0, x1: 400, y0: 10, y1: 800 });
    const b = quantizeWindow({ x0: 0, x1: 400, y0: 60, y1: 850 });
    expect(a).toEqual(b);
    const c = quantizeWindow({ x0: 0, x1: 400, y0: 3000, y1: 3800 });
    const ids = (w: typeof a) => new Set(cardsInWindow(layout.cards, w).map((x) => x.matchId));
    expect([...ids(c)].some((id) => ids(a).has(id))).toBe(false);
  });

  it("scrollLeft centraliza o cartão e respeita os limites", () => {
    const card = { x: 12, w: 276 };
    expect(scrollLeftToCenter(card, 1, 390, 1308)).toBe(0); // já está no começo
    expect(scrollLeftToCenter({ x: 984, w: 276 }, 1, 390, 1308)).toBe(918); // última coluna: encosta no fim
    expect(scrollLeftToCenter({ x: 336, w: 276 }, 1, 390, 1308)).toBe(Math.round(336 + 138 - 195));
    expect(scrollLeftToCenter({ x: 5000, w: 276 }, 1, 390, 1308)).toBe(918);
  });

  it("fora da janela = mostrar 'Ir para a luta ao vivo'", () => {
    const win = { x0: 0, x1: 390, y0: 0, y1: 800 };
    expect(isOutsideWindow({ x: 12, y: 100, w: 276, h: 96 }, win)).toBe(false);
    expect(isOutsideWindow({ x: 12, y: 2000, w: 276, h: 96 }, win)).toBe(true);
    expect(isOutsideWindow({ x: 700, y: 100, w: 276, h: 96 }, win)).toBe(true);
  });

  it("zoom e 'ajustar à largura' ficam em limites legíveis", () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(50)).toBe(ZOOM_MAX);
    expect(fitWidthScale(2352, 390)).toBeCloseTo(0.3, 5); // 128 atletas: nunca menor que o mínimo
    expect(fitWidthScale(1308, 1308)).toBe(1);
    expect(fitWidthScale(0, 390)).toBe(1);
  });
});

describe("chaveamento (celular): recuo da consulta 3 s -> 30 s", () => {
  it("dobra a cada falha e trava no teto; sem falha é o intervalo normal", () => {
    expect(pollDelayAfter(0)).toBe(POLL_INTERVAL_MS);
    expect([1, 2, 3, 4, 5, 6, 50].map(pollDelayAfter)).toEqual([6_000, 12_000, 24_000, POLL_BACKOFF_MAX_MS, POLL_BACKOFF_MAX_MS, POLL_BACKOFF_MAX_MS, POLL_BACKOFF_MAX_MS]);
  });
});

describe("chaveamento (celular): compartilhar o link", () => {
  const payload = { title: "Copa Teste", url: "https://app.test/ao-vivo/tok?categoria=1" };
  const original = { share: (navigator as { share?: unknown }).share, clipboard: (navigator as { clipboard?: unknown }).clipboard };
  beforeEach(() => {
    Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, writable: true, value: undefined });
  });
  afterEach(() => {
    Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: original.share });
    Object.defineProperty(navigator, "clipboard", { configurable: true, writable: true, value: original.clipboard });
    vi.restoreAllMocks();
  });

  it("com navigator.share: abre a folha do aparelho com título e link", async () => {
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: share });
    await expect(shareLink(payload)).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: "Copa Teste", url: payload.url });
  });

  it("cancelar a folha não copia nada", async () => {
    const share = vi.fn(async () => {
      throw Object.assign(new Error("cancelado"), { name: "AbortError" });
    });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: share });
    Object.defineProperty(navigator, "clipboard", { configurable: true, writable: true, value: { writeText } });
    await expect(shareLink(payload)).resolves.toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("sem navigator.share: copia o link; share que falha por outro motivo também cai na cópia", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, writable: true, value: { writeText } });
    await expect(shareLink(payload)).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(payload.url);

    Object.defineProperty(navigator, "share", {
      configurable: true,
      writable: true,
      value: vi.fn(async () => {
        throw new Error("NotAllowedError");
      }),
    });
    writeText.mockClear();
    await expect(shareLink(payload)).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("sem Clipboard API usa a cópia antiga; se nada funcionar devolve 'failed' sem lançar", async () => {
    const exec = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, writable: true, value: exec });
    await expect(shareLink(payload)).resolves.toBe("copied");
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull(); // o campo temporário não fica na página

    exec.mockReturnValue(false);
    await expect(shareLink(payload)).resolves.toBe("failed");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      writable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error("negado");
        }),
      },
    });
    await expect(shareLink(payload)).resolves.toBe("failed");
  });
});
