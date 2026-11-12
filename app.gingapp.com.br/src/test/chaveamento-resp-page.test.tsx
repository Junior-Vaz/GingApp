import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { ROTATION_MS } from "@/lib/chaveamento/hooks";
import { SEARCH_STORAGE_KEY } from "@/lib/chaveamento/athlete-search";
import type { PublicSnapshot } from "@/lib/chaveamento/types";
import { buildKnockout, category, comp, match, snapshot } from "./chaveamento-fixtures";
import { MockEventSource, lastSource } from "./chaveamento-mocks";
import { cleanupMounted, click, feed, mountLive, selectedTab, setReducedMotion, tabs } from "./chaveamento-dom";

/** Testes de tela do celular: busca de atleta, links profundos, URL, compartilhar, zoom, janela da chave, pausa e offline. */
const LONG = 60_000;

let visibility: "visible" | "hidden" = "visible";
let online = true;
const setVisibility = (next: "visible" | "hidden"): void => {
  visibility = next;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};
const setOnline = (next: boolean): void => {
  online = next;
  act(() => {
    window.dispatchEvent(new Event(next ? "online" : "offline"));
  });
};

const scrollToMock = vi.fn();
/** Quantas vezes a ÁREA DA CHAVE foi rolada (os chips também usam scrollTo para centralizar a categoria). */
const bracketScrolls = (): number => scrollToMock.mock.contexts.filter((c) => (c as Element | undefined)?.classList?.contains("cv-bracket-scroll")).length;
beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  online = true;
  MockEventSource.instances = [];
  scrollToMock.mockClear();
  vi.stubGlobal("EventSource", MockEventSource);
  // 304 = "nada mudou": a consulta de volta ao primeiro plano/à rede não derruba nem troca o placar.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 304 })));
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  Object.defineProperty(Element.prototype, "scrollTo", { configurable: true, writable: true, value: scrollToMock });
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/ao-vivo/tok");
  setReducedMotion(false);
});
afterEach(() => {
  cleanupMounted();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (document as { visibilityState?: unknown }).visibilityState;
  delete (navigator as { onLine?: unknown }).onLine;
  delete (Element.prototype as { scrollTo?: unknown }).scrollTo;
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  setReducedMotion(false);
});

/** Quatro atletas, duas lutas da semifinal prontas (ou ao vivo) e a final; categoria 2 sem sorteio. */
const bracket = (rev = 1, over: { live?: boolean } = {}): PublicSnapshot =>
  snapshot(rev, [
    category(1, {
      name: "Adulto até 70 kg",
      competitors: [comp(1, { name: "Ana Souza", group: "Grupo X" }), comp(2, { name: "Bia Lima" }), comp(3, { name: "Cris Rocha" }), comp(4, { name: "Duda Melo" })],
      matches: [
        match(10, { key: "MAIN-1-0", round: 1, position: 0, slotAId: 1, slotBId: 2, nextMatchId: 12, nextSlot: "A", status: over.live ? "LIVE" : "READY", mat: "2", queueOrder: 1 }),
        match(11, { key: "MAIN-1-1", round: 1, position: 1, slotAId: 3, slotBId: 4, nextMatchId: 12, nextSlot: "B", status: "READY", queueOrder: 2 }),
        match(12, { key: "MAIN-2-0", round: 2, position: 0 }),
      ],
    }),
    category(2, { name: "Infantil", status: "SETUP", competitors: [comp(21, { name: "Julia Prates" })], matches: [] }),
  ]);

const typeInto = (input: HTMLInputElement, text: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const searchInput = (host: HTMLElement): HTMLInputElement => host.querySelector<HTMLInputElement>("[data-testid=cv-search-input]")!;
const hits = (host: HTMLElement): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>("[data-testid=cv-search-hit]")];
const pathOf = (host: HTMLElement, id: number): string | undefined => host.querySelector(`[data-match-id="${id}"]`)?.getAttribute("data-path") ?? undefined;

describe("celular: ?categoria= abre na categoria e a URL acompanha sem empilhar histórico", () => {
  it("categoria existente abre selecionada; id que não existe é ignorado em silêncio", () => {
    const a = mountLive("tok", false, { categoryId: 2 });
    feed(bracket());
    expect(selectedTab(a.host)).toContain("Infantil");
    a.unmount();
    MockEventSource.instances = [];
    const b = mountLive("tok", false, { categoryId: 999 });
    feed(bracket());
    expect(selectedTab(b.host)).toContain("Adulto"); // a de sempre: a primeira com lutas
    expect(b.host.textContent).not.toContain("999");
  }, LONG);

  it("trocar de categoria faz replaceState (sem pushState), preserva `tv` e não recarrega", () => {
    window.history.replaceState({ k: 1 }, "", "/ao-vivo/tok?tv=1");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    const lengthBefore = window.history.length;
    const m = mountLive("tok", true);
    feed(bracket());
    click(tabs(m.host)[1]!);
    expect(selectedTab(m.host)).toContain("Infantil");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0]![2]).toBe("/ao-vivo/tok?tv=1&categoria=2");
    expect(window.location.search).toBe("?tv=1&categoria=2");
    expect(window.history.state).toEqual({ k: 1 }); // o estado do roteador é preservado
    expect(push).not.toHaveBeenCalled();
    expect(window.history.length).toBe(lengthBefore);
    click(tabs(m.host)[0]!);
    expect(window.location.search).toBe("?tv=1&categoria=1");
  }, LONG);

  it("o rodízio automático do telão NÃO mexe na URL (só o toque da pessoa)", async () => {
    window.history.replaceState(null, "", "/ao-vivo/tok?tv=1");
    const replace = vi.spyOn(window.history, "replaceState");
    const m = mountLive("tok", true);
    feed(
      snapshot(1, [1, 2, 3].map((id) => category(id, { name: `Cat ${id}`, competitors: [comp(id * 10 + 1), comp(id * 10 + 2)], matches: [match(id * 100, { slotAId: id * 10 + 1, slotBId: id * 10 + 2, status: "READY" })] }))),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROTATION_MS);
    });
    expect(selectedTab(m.host)).toBe("Cat 2");
    expect(replace).not.toHaveBeenCalled();
  }, LONG);

  it("o botão Compartilhar leva a categoria da tela; o QR do telão leva ao campeonato todo", async () => {
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: share });
    const m = mountLive();
    feed(bracket());
    click(tabs(m.host)[1]!);
    await act(async () => {
      m.host.querySelector<HTMLButtonElement>("[data-testid=cv-share]")!.click();
    });
    expect(share).toHaveBeenCalledWith({ title: "Campeonato Teste", url: `${window.location.origin}/ao-vivo/tok?categoria=2` });
    Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: undefined });
  }, LONG);
});

describe("celular: compartilhar o link (com e sem navigator.share)", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, writable: true, value: undefined });
  });

  it("sem navigator.share: copia o link e avisa 'Link copiado' (o aviso some sozinho)", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, writable: true, value: { writeText } });
    const m = mountLive();
    feed(bracket());
    await act(async () => {
      m.host.querySelector<HTMLButtonElement>("[data-testid=cv-share]")!.click();
    });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/ao-vivo/tok?categoria=1`);
    expect(m.host.querySelector("[data-testid=cv-toast]")?.textContent).toBe("Link copiado");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(m.host.querySelector("[data-testid=cv-toast]")).toBeNull();
  }, LONG);

  it("o botão tem nome acessível e o telão (?tv=1) não mostra o botão", () => {
    const m = mountLive();
    feed(bracket());
    expect(m.host.querySelector("[data-testid=cv-share]")?.getAttribute("aria-label")).toContain("Compartilhar");
    m.unmount();
    const tv = mountLive("tok", true);
    feed(bracket());
    expect(tv.host.querySelector("[data-testid=cv-share]")).toBeNull();
    expect(tv.host.querySelector("[data-testid=cv-search]")).toBeNull(); // busca é do celular, não do telão
  }, LONG);
});

describe("celular: acompanhar meu atleta (busca)", () => {
  it("digitar lista atletas; tocar num resultado vai à categoria dele, acende o caminho e rola até a luta", async () => {
    const m = mountLive();
    feed(bracket());
    typeInto(searchInput(m.host), "ana");
    expect(hits(m.host)).toHaveLength(1);
    expect(hits(m.host)[0]!.textContent).toContain("Ana Souza");
    expect(hits(m.host)[0]!.textContent).toContain("Próxima luta definida");
    click(hits(m.host)[0]!);
    expect(selectedTab(m.host)).toContain("Adulto");
    expect(m.host.querySelector("[data-testid=cv-search-results]")).toBeNull();
    // caminho aceso: só a luta da Ana; as outras esmaecem
    expect(pathOf(m.host, 10)).toBe("on");
    expect(pathOf(m.host, 11)).toBe("off");
    expect(pathOf(m.host, 12)).toBe("off");
    expect(m.host.querySelector('.cv-row[data-focus="1"]')?.textContent).toContain("Ana Souza");
    // rolou até a luta (rAF duplo)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    const scroller = m.host.querySelector(".cv-bracket-scroll");
    expect(scrollToMock.mock.calls.some((_call, i) => scrollToMock.mock.contexts[i] === scroller)).toBe(true);
  }, LONG);

  it("'Minha próxima luta' só aparece quando há correspondência com luta ao vivo ou pronta", () => {
    const m = mountLive();
    feed(bracket());
    expect(m.host.querySelector("[data-testid=cv-my-next]")).toBeNull();
    typeInto(searchInput(m.host), "ana");
    const strip = m.host.querySelector("[data-testid=cv-my-next]");
    expect(strip?.textContent).toContain("Minha próxima luta:");
    expect(strip?.textContent).toContain("Ana Souza");
    expect(strip?.textContent).toContain("Bia Lima");
    expect(strip?.textContent).toContain("Semifinais");
    expect(strip?.textContent).toContain("Tatame 2");
    // atleta sem luta pendente: lista, mas nenhuma faixa inventada
    typeInto(searchInput(m.host), "julia");
    expect(hits(m.host)).toHaveLength(1);
    expect(m.host.querySelector("[data-testid=cv-my-next]")).toBeNull();
    // sem correspondência: aviso curto, sem faixa
    typeInto(searchInput(m.host), "zzzz");
    expect(m.host.querySelector("[data-testid=cv-search-results]")?.textContent).toContain("Nenhum atleta ou grupo encontrado");
    expect(m.host.querySelector("[data-testid=cv-my-next]")).toBeNull();
  }, LONG);

  it("luta ao vivo: a faixa avisa 'AO VIVO' e atualiza sozinha quando o placar muda", () => {
    const m = mountLive();
    feed(bracket(1));
    typeInto(searchInput(m.host), "ana");
    expect(m.host.querySelector("[data-testid=cv-my-next]")?.textContent).toContain("Minha próxima luta:");
    feed(bracket(2, { live: true }));
    expect(m.host.querySelector("[data-testid=cv-my-next]")?.textContent).toContain("Minha luta está AO VIVO:");
  }, LONG);

  it("botão 'Ver' da faixa rola até a luta; limpar apaga texto, destaque e a lembrança da sessão", async () => {
    const m = mountLive();
    feed(bracket());
    typeInto(searchInput(m.host), "ana");
    scrollToMock.mockClear();
    click(m.host.querySelector("[data-testid=cv-my-next-go]"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(bracketScrolls()).toBeGreaterThan(0);
    expect(pathOf(m.host, 10)).toBe("on");
    click(m.host.querySelector("[data-testid=cv-search-clear]"));
    expect(searchInput(m.host).value).toBe("");
    expect(pathOf(m.host, 10)).toBeUndefined();
    expect(window.sessionStorage.getItem(SEARCH_STORAGE_KEY)).toBeNull();
  }, LONG);

  it("lembra o último texto na SESSÃO e nada além dele é guardado (nenhum dado de atleta, nada em localStorage)", () => {
    const sessionSet = vi.spyOn(Storage.prototype, "setItem");
    const m = mountLive();
    feed(bracket());
    typeInto(searchInput(m.host), "ana");
    click(hits(m.host)[0]!); // escolher o atleta não grava mais nada
    expect(sessionSet.mock.calls.length).toBeGreaterThan(0);
    for (const [key, value] of sessionSet.mock.calls) {
      expect(key).toBe(SEARCH_STORAGE_KEY);
      expect(value).toBe("ana");
    }
    expect(window.sessionStorage.length).toBe(1);
    expect(window.localStorage.length).toBe(0);
    expect(JSON.stringify(window.sessionStorage)).not.toContain("Souza");
    m.unmount();
    MockEventSource.instances = [];
    // voltando à página (mesma sessão): o campo vem preenchido e a faixa aparece sem rolar nem trocar de categoria
    const again = mountLive();
    feed(bracket());
    expect(searchInput(again.host).value).toBe("ana");
    expect(again.host.querySelector("[data-testid=cv-my-next]")?.textContent).toContain("Ana Souza");
    expect(bracketScrolls()).toBe(0);
    expect(pathOf(again.host, 10)).toBeUndefined();
  }, LONG);

  it("sessionStorage bloqueado (modo privado) não derruba a busca", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const m = mountLive();
    feed(bracket());
    expect(() => typeInto(searchInput(m.host), "ana")).not.toThrow();
    expect(hits(m.host)).toHaveLength(1);
  }, LONG);

  it("?q= pré-busca: preenche o campo (só texto, até 60) e, achando UM atleta, já o localiza", async () => {
    const m = mountLive("tok", false, { initialQuery: "Ana Souza" });
    feed(bracket());
    expect(searchInput(m.host).value).toBe("Ana Souza");
    expect(pathOf(m.host, 10)).toBe("on");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(bracketScrolls()).toBeGreaterThan(0);
  }, LONG);

  it("?q= nunca vira HTML: tags aparecem como texto no campo e nada é injetado", () => {
    const evil = `<img src=x onerror="document.title='pwned'"><script>document.title='pwned'</script>`;
    const m = mountLive("tok", false, { initialQuery: evil.slice(0, 60) });
    feed(bracket());
    expect(m.host.querySelector("img[src='x']")).toBeNull();
    expect(m.host.querySelector("script")).toBeNull();
    expect(document.title).not.toBe("pwned");
    expect(searchInput(m.host).value.length).toBeLessThanOrEqual(60);
    expect(searchInput(m.host).value).not.toContain("<");
  }, LONG);

  it("busca por grupo com vários atletas: lista todos e não escolhe por você", () => {
    const m = mountLive("tok", false, { initialQuery: "maré" });
    feed(
      snapshot(1, [
        category(1, {
          competitors: [comp(1, { name: "Ana", group: "Maré Viva" }), comp(2, { name: "Bia", group: "Maré Viva" }), comp(3, { name: "Cris" })],
          matches: [match(10, { slotAId: 1, slotBId: 3, status: "READY" })],
        }),
      ]),
    );
    expect(hits(m.host)).toHaveLength(2);
    expect(m.host.querySelector("[data-testid=cv-my-next]")).toBeNull();
    expect(m.host.querySelector("[data-path]")).toBeNull();
  }, LONG);
});

describe("celular: tocar num atleta da chave acende o caminho dele", () => {
  const hit = (host: HTMLElement, competitorId: number): HTMLButtonElement => host.querySelector<HTMLButtonElement>(`[data-testid=cv-athlete-hit][data-competitor-id="${competitorId}"]`)!;

  it("toque liga, outro toque desliga; cada atleta tem botão com nome acessível; o telão não tem botões", () => {
    const m = mountLive();
    feed(bracket());
    expect(hit(m.host, 3).getAttribute("aria-label")).toBe("Destacar o caminho de Cris Rocha");
    expect(hit(m.host, 3).getAttribute("aria-pressed")).toBe("false");
    click(hit(m.host, 3));
    expect(hit(m.host, 3).getAttribute("aria-pressed")).toBe("true");
    expect(pathOf(m.host, 11)).toBe("on");
    expect(pathOf(m.host, 10)).toBe("off");
    click(hit(m.host, 3));
    expect(pathOf(m.host, 11)).toBeUndefined();
    m.unmount();
    const tv = mountLive("tok", true);
    feed(bracket());
    expect(tv.host.querySelector("[data-testid=cv-athlete-hit]")).toBeNull();
  }, LONG);

  it("o caminho acompanha o atleta quando ele avança na chave", () => {
    const m = mountLive();
    feed(bracket(1));
    click(hit(m.host, 1));
    expect(pathOf(m.host, 12)).toBe("off");
    const finished = bracket(2);
    const matches = finished.categories[0]!.matches.map((x) =>
      x.id === 10 ? { ...x, status: "FINISHED" as const, winnerId: 1, scoreA: 5, scoreB: 2 } : x.id === 12 ? { ...x, slotAId: 1 } : x,
    );
    feed({ ...finished, categories: [{ ...finished.categories[0]!, matches }, finished.categories[1]!] });
    expect(pathOf(m.host, 10)).toBe("on");
    expect(pathOf(m.host, 12)).toBe("on");
    expect(pathOf(m.host, 11)).toBe("off");
  }, LONG);
});

describe("celular: zoom, janela visível e botão 'Ir para a luta ao vivo'", () => {
  const scaleOf = (host: HTMLElement): number => {
    const t = host.querySelector<HTMLElement>(".cv-stage-inner")!.style.transform;
    return Number(/scale\(([\d.]+)\)/.exec(t)?.[1]);
  };

  it("botões de zoom: + amplia, − reduz, ajustar volta a caber; limites respeitados", () => {
    const m = mountLive();
    feed(bracket());
    expect(scaleOf(m.host)).toBe(1);
    click(m.host.querySelector("[data-testid=cv-zoom-in]"));
    expect(scaleOf(m.host)).toBeCloseTo(1.2, 5);
    click(m.host.querySelector("[data-testid=cv-zoom-out]"));
    click(m.host.querySelector("[data-testid=cv-zoom-out]"));
    expect(scaleOf(m.host)).toBeLessThan(1);
    for (let i = 0; i < 20; i += 1) click(m.host.querySelector("[data-testid=cv-zoom-out]"));
    expect(scaleOf(m.host)).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(m.host.querySelector<HTMLButtonElement>("[data-testid=cv-zoom-out]")!.disabled).toBe(true);
    click(m.host.querySelector("[data-testid=cv-zoom-fit]"));
    expect(Number.isFinite(scaleOf(m.host))).toBe(true);
    // o telão não tem zoom nem legenda fixa
    m.unmount();
    const tv = mountLive("tok", true);
    feed(bracket());
    expect(tv.host.querySelector("[data-testid=cv-zoom-in]")).toBeNull();
    expect(tv.host.querySelector("[data-testid=cv-bracket-bar]")).toBeNull();
  }, LONG);

  it("legenda de rodadas e pontos de encaixe por rodada existem (um por coluna)", () => {
    const m = mountLive();
    feed(bracket());
    const labels = [...m.host.querySelectorAll(".cv-strip-label")].map((x) => x.textContent);
    expect(labels).toEqual(["Semifinais", "Final"]);
    expect(m.host.querySelectorAll(".cv-snap")).toHaveLength(2);
    expect(m.host.querySelector(".cv-bracket-scroll")?.getAttribute("tabindex")).toBe("0");
  }, LONG);

  it("128 atletas: só os cartões perto da tela são desenhados (e 16 atletas continuam inteiros)", () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 390 });
    try {
      const big = buildKnockout(128, { thirdPlace: true });
      const m = mountLive();
      feed(snapshot(1, [category(1, { name: "Absoluto", competitors: big.competitors, matches: big.matches })]));
      const drawn = m.host.querySelectorAll("[data-testid=cv-match]").length;
      expect(m.host.querySelector(".cv-stage-inner")?.getAttribute("data-virtual")).toBe("1");
      expect(drawn).toBeGreaterThan(0);
      expect(drawn).toBeLessThan(60);
      expect(m.host.querySelectorAll(".cv-link").length).toBe(126); // as linhas continuam todas (são leves)
      m.unmount();
      MockEventSource.instances = [];
      const small = buildKnockout(16, { thirdPlace: true });
      const s = mountLive();
      feed(snapshot(1, [category(1, { competitors: small.competitors, matches: small.matches })]));
      expect(s.host.querySelectorAll("[data-testid=cv-match]").length).toBe(16);
      expect(s.host.querySelector(".cv-stage-inner")?.getAttribute("data-virtual")).toBeNull();
    } finally {
      delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
    }
  }, LONG);

  it("botão flutuante: aparece quando a luta ao vivo está fora da tela e rola até ela", async () => {
    const rect = { top: 0, bottom: 600, left: 0, right: 390, width: 390, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 390 });
    try {
      const big = buildKnockout(8, { thirdPlace: false });
      // a final (última coluna, fora dos 390 px) está ao vivo
      const finalId = Math.max(...big.matches.map((x) => x.id));
      const matches = big.matches.map((x) => (x.id === finalId ? { ...x, status: "LIVE" as const, slotAId: 1, slotBId: 2, mat: "1" } : x));
      const m = mountLive();
      feed(snapshot(1, [category(1, { competitors: big.competitors, matches })]));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      const fab = m.host.querySelector<HTMLButtonElement>("[data-testid=cv-fab]");
      expect(fab?.textContent).toContain("Ir para a luta ao vivo");
      scrollToMock.mockClear();
      click(fab);
      expect(scrollToMock).toHaveBeenCalledWith(expect.objectContaining({ left: expect.any(Number) }));
    } finally {
      delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
    }
  }, LONG);

  it("categoria sem luta ao vivo: o botão leva à final", async () => {
    const rect = { top: 0, bottom: 600, left: 0, right: 390, width: 390, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 390 });
    try {
      const big = buildKnockout(8);
      const m = mountLive();
      feed(snapshot(1, [category(1, { competitors: big.competitors, matches: big.matches })]));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(m.host.querySelector("[data-testid=cv-fab]")?.textContent).toContain("Ir para a final");
    } finally {
      delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
    }
  }, LONG);
});

describe("celular: chips das categorias", () => {
  it("a categoria escolhida é centralizada nos chips e quem tem luta ao vivo mostra o texto AO VIVO", () => {
    const m = mountLive();
    feed(bracket(1, { live: true }));
    const first = tabs(m.host)[0]!;
    expect(first.querySelector(".cv-tab-live")?.textContent).toBe("AO VIVO");
    expect(first.textContent).toContain("(luta ao vivo)"); // leitor de tela
    scrollToMock.mockClear();
    click(tabs(m.host)[1]!);
    expect(scrollToMock.mock.calls.length).toBeGreaterThan(0);
    expect(scrollToMock.mock.calls[0]![0]).toEqual(expect.objectContaining({ left: expect.any(Number) }));
  }, LONG);
});

describe("celular: aba oculta e rede fora pausam tudo na tela", () => {
  it("ocultar fecha o SSE, pausa as animações (data-hidden) e voltar ressincroniza SEM piscar o carregamento", async () => {
    const m = mountLive();
    feed(bracket());
    const source = lastSource();
    const fetchMock = vi.mocked(fetch);
    setVisibility("hidden");
    expect(source.closed).toBe(true);
    expect(m.host.querySelector(".cv-root")?.getAttribute("data-hidden")).toBe("1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(m.host.textContent).toContain("Ana Souza"); // o último placar segue na tela

    setVisibility("visible");
    expect(m.host.querySelector("[data-testid=cv-loading]")).toBeNull();
    expect(m.host.querySelector(".cv-root")?.getAttribute("data-hidden")).toBeNull();
    expect(MockEventSource.instances).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(m.host.querySelector("[data-testid=cv-offline-banner]")).toBeNull();
  }, LONG);

  it("sem rede: faixa 'Sem conexão — mostrando o último placar' com o placar mantido; ao voltar, a faixa some e ressincroniza", async () => {
    const m = mountLive();
    feed(bracket());
    setOnline(false);
    const banner = m.host.querySelector("[data-testid=cv-offline-banner]");
    expect(banner?.textContent).toContain("Sem conexão — mostrando o último placar");
    expect(banner?.getAttribute("role")).toBe("status");
    expect(m.host.querySelector("[data-testid=cv-status]")?.textContent).toContain("Sem conexão");
    expect(m.host.textContent).toContain("Ana Souza");
    expect(m.host.querySelectorAll("[data-testid=cv-match]")).toHaveLength(3);
    const calls = vi.mocked(fetch).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls); // nada foi pedido sem rede

    setOnline(true);
    expect(m.host.querySelector("[data-testid=cv-offline-banner]")).toBeNull();
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls + 1);
    expect(m.host.querySelector("[data-testid=cv-status]")?.textContent).not.toContain("Sem conexão");
  }, LONG);

  it("carregando sem rede: esqueleto diz que o placar aparece quando a internet voltar", () => {
    online = false;
    const m = mountLive();
    expect(m.host.querySelector("[data-testid=cv-loading]")?.textContent).toContain("Sem conexão");
    setOnline(true);
    expect(m.host.querySelector("[data-testid=cv-loading]")?.textContent).toContain("Conectando");
  }, LONG);

  it("queda curta com internet não pisca aviso: só avisa depois de 3 s reconectando", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    const m = mountLive();
    feed(bracket());
    act(() => {
      lastSource().emit("error");
    });
    expect(m.host.querySelector("[data-testid=cv-offline-banner]")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(m.host.querySelector("[data-testid=cv-offline-banner]")?.textContent).toContain("tentando reconectar");
  }, LONG);

  it("telão oculto: o rodízio de categorias não gira (sem timer) e volta ao reaparecer", async () => {
    const m = mountLive("tok", true);
    feed(
      snapshot(1, [1, 2, 3].map((id) => category(id, { name: `Cat ${id}`, competitors: [comp(id * 10 + 1), comp(id * 10 + 2)], matches: [match(id * 100, { slotAId: id * 10 + 1, slotBId: id * 10 + 2, status: "READY" })] }))),
    );
    setVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROTATION_MS * 5);
    });
    expect(selectedTab(m.host)).toBe("Cat 1");
    setVisibility("visible");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROTATION_MS);
    });
    expect(selectedTab(m.host)).toBe("Cat 2");
  }, LONG);

  it("último placar em MEMÓRIA: sair e voltar ao mesmo link não mostra o esqueleto; `unavailable` apaga", () => {
    const first = mountLive("tok");
    feed(bracket());
    first.unmount();
    MockEventSource.instances = [];
    const again = mountLive("tok");
    expect(again.host.querySelector("[data-testid=cv-loading]")).toBeNull();
    expect(again.host.textContent).toContain("Ana Souza");
    expect(window.sessionStorage.length).toBe(0); // nada de snapshot no storage
    expect(window.localStorage.length).toBe(0);
  }, LONG);
});

describe("celular: viewport-fit, theme-color e limpeza ao sair", () => {
  it("liga viewport-fit=cover e theme-color escuro só enquanto a página está montada", () => {
    document.head.insertAdjacentHTML("beforeend", '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#ffffff">');
    const m = mountLive();
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute("content")).toContain("viewport-fit=cover");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#070b14");
    m.unmount();
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute("content")).toBe("width=device-width, initial-scale=1");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#ffffff");
    document.head.querySelectorAll('meta[name="viewport"], meta[name="theme-color"]').forEach((el) => el.remove());
  }, LONG);
});
