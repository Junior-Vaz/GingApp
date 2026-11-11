import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ConfettiCanvas } from "@/components/chaveamento/confetti-canvas";
import { PAGE_ROTATE_MS } from "@/components/chaveamento/bracket-view";
import { Podium } from "@/components/chaveamento/podium";
import { INTRO_MS } from "@/lib/chaveamento/intro-queue";
import { CHAMPION_MS } from "@/lib/chaveamento/use-broadcast-events";
import type { PublicCompetitor, PublicSnapshot } from "@/lib/chaveamento/types";
import { buildKnockout, category, comp, match, snapshot } from "./chaveamento-fixtures";
import { MockEventSource } from "./chaveamento-mocks";
import { cleanupMounted, feed, mountLive, setReducedMotion } from "./chaveamento-dom";
import { REAL_GROUPS_FINISHED, REAL_GROUPS_RUNNING, REAL_SINGLE_FINISHED, REAL_SINGLE_RUNNING } from "./real-contract-chaveamento";

/** Testes de tela do refino visual: propositalmente com timeouts generosos (instáveis sob a carga do gate completo). */
const LONG = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  setReducedMotion(false);
});
afterEach(() => {
  cleanupMounted();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setReducedMotion(false);
});

const intro = (host: HTMLElement): HTMLElement | null => host.ownerDocument.querySelector<HTMLElement>("[data-testid=cv-vs-intro]");
const tick = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** 4 lutas da 1ª rodada + final; `live` = ids das lutas AO VIVO (as outras ficam READY). */
const fights = (rev: number, live: number[]): PublicSnapshot =>
  snapshot(rev, [
    category(1, {
      name: "Adulto até 70 kg",
      competitors: [1, 2, 3, 4, 5, 6, 7, 8].map((id) => comp(id, { name: `Atleta ${id}`, group: id % 2 === 0 ? "Ginga Sul" : "Maré Viva" })),
      matches: [
        ...[0, 1, 2, 3].map((p) =>
          match(10 + p, { key: `MAIN-1-${p}`, round: 1, position: p, slotAId: p * 2 + 1, slotBId: p * 2 + 2, nextMatchId: 20 + Math.floor(p / 2), nextSlot: p % 2 === 0 ? "A" : "B", status: live.includes(10 + p) ? "LIVE" : "READY", mat: live.includes(10 + p) ? String(p + 1) : null }),
        ),
        match(20, { key: "MAIN-2-0", round: 2, position: 0, nextMatchId: 30, nextSlot: "A" }),
        match(21, { key: "MAIN-2-1", round: 2, position: 1, nextMatchId: 30, nextSlot: "B" }),
        match(30, { key: "MAIN-3-0", round: 3, position: 0 }),
      ],
    }),
  ]);

describe("telão: abertura VS (só no telão, só na transição, com fila)", () => {
  it("primeiro snapshot não abre nada; READY -> LIVE abre por INTRO_MS e some; mostra atletas, fase e tatame", async () => {
    const m = mountLive("tok", true);
    feed(fights(1, [10])); // já chegou com luta ao vivo: só o estado inicial
    expect(intro(m.host)).toBeNull();
    feed(fights(2, [10, 11])); // a luta 11 começou agora
    const overlay = intro(m.host);
    expect(overlay).not.toBeNull();
    expect(overlay!.getAttribute("data-match-id")).toBe("11");
    const text = overlay!.textContent ?? "";
    expect(text).toContain("Atleta 3");
    expect(text).toContain("Atleta 4");
    expect(text).toContain("Quartas de final");
    expect(text).toContain("Tatame 2");
    expect(overlay!.getAttribute("aria-label")).toBe("Luta começando: Atleta 3 contra Atleta 4");
    await tick(INTRO_MS - 1);
    expect(intro(m.host)).not.toBeNull();
    await tick(1);
    expect(intro(m.host)).toBeNull();
    feed(fights(3, [10, 11])); // mesmo conteúdo: nada novo
    expect(intro(m.host)).toBeNull();
  }, LONG);

  it("fila: várias de uma vez mostram só a mais recente; uma espera por vez e a mais nova substitui a velha", async () => {
    const m = mountLive("tok", true);
    feed(fights(1, []));
    feed(fights(2, [10, 11])); // duas começaram juntas: vale a mais recente (11)
    expect(intro(m.host)!.getAttribute("data-match-id")).toBe("11");
    feed(fights(3, [10, 11, 12])); // 12 espera
    feed(fights(4, [10, 11, 12, 13])); // 13 substitui 12
    expect(intro(m.host)!.getAttribute("data-match-id")).toBe("11");
    await tick(INTRO_MS);
    expect(intro(m.host)!.getAttribute("data-match-id")).toBe("13"); // a 12 foi descartada
    await tick(INTRO_MS);
    expect(intro(m.host)).toBeNull();
  }, LONG);

  it("fora do telão e com movimento reduzido não há abertura (só a faixa AGORA)", () => {
    const normal = mountLive("tok", false);
    feed(fights(1, []));
    feed(fights(2, [10]));
    expect(intro(normal.host)).toBeNull();
    expect(normal.host.querySelector("[data-testid=cv-now-live]")).not.toBeNull();
    cleanupMounted();

    setReducedMotion(true);
    MockEventSource.instances = [];
    const calm = mountLive("tok", true);
    feed(fights(1, []));
    feed(fights(2, [10]));
    expect(intro(calm.host)).toBeNull();
    expect(calm.host.querySelector("[data-testid=cv-now-live]")).not.toBeNull();
  }, LONG);

  it("desmontar no meio da abertura cancela o timer (nenhum timer sobra)", async () => {
    const m = mountLive("tok", true);
    feed(fights(1, []));
    feed(fights(2, [10]));
    expect(intro(m.host)).not.toBeNull();
    m.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await tick(INTRO_MS * 3); // nada dispara depois de desmontar
  }, LONG);
});

/* ------------------------------------------------ campeão e pódio ------------------------------------------------ */

const decided = (rev: number, status: "RUNNING" | "FINISHED", thirdPlace = true): PublicSnapshot =>
  snapshot(rev, [
    category(1, {
      name: "Peso Pena",
      status,
      thirdPlace,
      competitors: [comp(1, { name: "Ana Souza", group: "Ginga Sul", graduation: "Azul" }), comp(2, { name: "Bia Lima" }), comp(3, { name: "Cris Rocha" }), comp(4, { name: "Duda Melo" })],
      matches: [match(10, { slotAId: 1, slotBId: 2, status: status === "FINISHED" ? "FINISHED" : "LIVE", winnerId: status === "FINISHED" ? 1 : null })],
      podium:
        status === "FINISHED"
          ? [{ place: 1, competitorId: 1 }, { place: 2, competitorId: 2 }, { place: 3, competitorId: 3 }, ...(thirdPlace ? [] : [{ place: 3 as const, competitorId: 4 }])]
          : [],
    }),
  ]);

const overlay = (host: HTMLElement): HTMLElement | null => host.ownerDocument.querySelector<HTMLElement>("[data-testid=cv-champion-overlay]");

describe("telão: tela de campeão (só na TRANSIÇÃO para FINISHED) e pódio permanente", () => {
  it("transição: overlay com o campeão + confete por CHAMPION_MS; depois o pódio permanente fica", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const m = mountLive("tok", true);
    feed(decided(1, "RUNNING"));
    expect(overlay(m.host)).toBeNull();
    feed(decided(2, "FINISHED"));
    const o = overlay(m.host);
    expect(o).not.toBeNull();
    expect(o!.textContent).toContain("CAMPEÃO");
    expect(o!.textContent).toContain("Ana Souza");
    expect(o!.textContent).toContain("2º lugar");
    expect(o!.textContent).toContain("Bia Lima");
    expect(o!.textContent).toContain("3º lugar");
    expect(m.host.querySelector("[data-testid=cv-confetti]")).not.toBeNull();
    expect(CHAMPION_MS).toBeGreaterThanOrEqual(10_000);
    expect(CHAMPION_MS).toBeLessThanOrEqual(14_000);
    await tick(CHAMPION_MS - 1);
    expect(overlay(m.host)).not.toBeNull();
    await tick(1);
    expect(overlay(m.host)).toBeNull();
    expect(m.host.querySelector("[data-testid=cv-confetti]")).toBeNull();
    expect(m.host.querySelector("[data-testid=cv-podium]")).not.toBeNull(); // pódio permanente
    expect(m.host.querySelectorAll(".cv-step")).toHaveLength(3);
    // nenhum aviso do React (ex.: duas filhas com a mesma key entre a tela de campeão e o confete)
    expect(errors.mock.calls.filter((call) => String(call[0]).includes("same key"))).toEqual([]);
  }, LONG);

  it("primeira carga já encerrada: pódio direto, sem tela de campeão e sem confete", () => {
    const m = mountLive("tok", true);
    feed(decided(1, "FINISHED"));
    expect(overlay(m.host)).toBeNull();
    expect(m.host.querySelector("[data-testid=cv-confetti]")).toBeNull();
    expect(m.host.querySelector("[data-testid=cv-podium]")).not.toBeNull();
    feed(decided(2, "FINISHED")); // revisão nova, mesmo estado: continua sem comemorar
    expect(overlay(m.host)).toBeNull();
  }, LONG);

  it("movimento reduzido: sem overlay, sem confete, pódio estático; fora do telão: faixa do campeão no topo e sem overlay", () => {
    setReducedMotion(true);
    const calm = mountLive("tok", true);
    feed(decided(1, "RUNNING"));
    feed(decided(2, "FINISHED"));
    expect(overlay(calm.host)).toBeNull();
    expect(calm.host.querySelector("[data-testid=cv-confetti]")).toBeNull();
    expect(calm.host.querySelector("[data-testid=cv-podium]")?.getAttribute("data-motion")).toBe("off");
    cleanupMounted();

    setReducedMotion(false);
    MockEventSource.instances = [];
    const normal = mountLive("tok", false);
    feed(decided(1, "RUNNING"));
    expect(normal.host.querySelector("[data-testid=cv-champion-banner]")).toBeNull();
    feed(decided(2, "FINISHED"));
    expect(overlay(normal.host)).toBeNull();
    expect(normal.host.querySelector("[data-testid=cv-champion-banner]")?.textContent).toContain("Ana Souza");
    expect(normal.host.querySelector("[data-testid=cv-confetti]")).not.toBeNull();
  }, LONG);

  it("desmontar durante a comemoração cancela os timers", async () => {
    const m = mountLive("tok", true);
    feed(decided(1, "RUNNING"));
    feed(decided(2, "FINISHED"));
    expect(overlay(m.host)).not.toBeNull();
    m.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await tick(CHAMPION_MS * 2);
  }, LONG);
});

describe("telão com os snapshots REAIS do backend", () => {
  it("mata-mata real: primeira carga sem comemorar; running -> finished abre a tela de campeão com o campeão do JSON real", () => {
    const first = mountLive("tok", true);
    feed(JSON.stringify(REAL_SINGLE_FINISHED));
    expect(overlay(first.host)).toBeNull();
    expect(first.host.querySelector("[data-testid=cv-podium]")).not.toBeNull();
    cleanupMounted();

    MockEventSource.instances = [];
    const live = mountLive("tok", true);
    feed(JSON.stringify(REAL_SINGLE_RUNNING));
    expect(overlay(live.host)).toBeNull();
    feed(JSON.stringify(REAL_SINGLE_FINISHED));
    expect(overlay(live.host)?.textContent).toContain("Atleta 1"); // campeão (competitorId 2579) no JSON real
    expect(live.host.querySelector("[data-testid=cv-confetti]")).not.toBeNull();
  }, LONG);

  it("grupos reais: classificação + mata-mata renderizam; classificados marcados só depois do mata-mata sorteado", () => {
    const m = mountLive("tok", true);
    feed(JSON.stringify(REAL_GROUPS_RUNNING));
    expect(m.host.querySelector("[data-testid=cv-standings]")).not.toBeNull();
    expect(m.host.querySelectorAll(".cv-q")).toHaveLength(0);
    cleanupMounted();
    MockEventSource.instances = [];
    const done = mountLive("tok", false);
    feed(JSON.stringify(REAL_GROUPS_FINISHED));
    expect(done.host.querySelectorAll(".cv-q").length).toBe(4); // 2 por grupo chegaram às semifinais
  }, LONG);
});

describe("pódio: 1º/2º/3º e dois 3º lugares", () => {
  const people: PublicCompetitor[] = [1, 2, 3, 4].map((id) => comp(id, { name: `Atleta ${id}`, group: "Ginga Sul" }));
  const byId = new Map(people.map((p) => [p.id, p]));
  const render = (podium: Array<{ place: 1 | 2 | 3; competitorId: number }>, reducedMotion = false) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<Podium podium={podium} byId={byId} reducedMotion={reducedMotion} tv={false} />));
    return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
  };

  it("ordem 2º, 1º, 3º com medalha e texto do lugar (nunca só cor)", () => {
    const view = render([{ place: 1, competitorId: 1 }, { place: 2, competitorId: 2 }, { place: 3, competitorId: 3 }]);
    const steps = [...view.host.querySelectorAll<HTMLElement>(".cv-step")];
    expect(steps.map((s) => s.getAttribute("data-place"))).toEqual(["2", "1", "3"]);
    expect(steps.map((s) => s.textContent)).toEqual([expect.stringContaining("Atleta 2"), expect.stringContaining("Atleta 1"), expect.stringContaining("Atleta 3")]);
    expect(view.host.textContent).toContain("1º lugar");
    expect(view.host.textContent).toContain("2º lugar");
    expect(view.host.querySelectorAll("svg.cv-step-medal")).toHaveLength(3);
    view.unmount();
  });

  it("sem disputa de 3º: dois terceiros lugares lado a lado", () => {
    const view = render([{ place: 1, competitorId: 1 }, { place: 2, competitorId: 2 }, { place: 3, competitorId: 3 }, { place: 3, competitorId: 4 }]);
    const steps = [...view.host.querySelectorAll<HTMLElement>(".cv-step")];
    expect(steps.map((s) => s.getAttribute("data-place"))).toEqual(["2", "1", "3", "3"]);
    expect(view.host.querySelectorAll("svg.cv-step-medal")).toHaveLength(4);
    view.unmount();
  });

  it("pódio vazio não desenha nada; movimento reduzido marca data-motion=off", () => {
    const empty = render([]);
    expect(empty.host.querySelector("[data-testid=cv-podium]")).toBeNull();
    empty.unmount();
    const calm = render([{ place: 1, competitorId: 1 }], true);
    expect(calm.host.querySelector("[data-testid=cv-podium]")?.getAttribute("data-motion")).toBe("off");
    calm.unmount();
  });
});

/* ------------------------------------------------ confete: rAF cancelado ------------------------------------------------ */

describe("confete em canvas: requestAnimationFrame cancelado ao desmontar e com a aba oculta", () => {
  const setVisibility = (state: "visible" | "hidden"): void => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  afterEach(() => {
    Reflect.deleteProperty(document, "visibilityState");
  });

  function setup() {
    const ctx = { clearRect: vi.fn(), setTransform: vi.fn(), fillRect: vi.fn(), fillStyle: "" };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
    let nextId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      nextId += 1;
      frames.set(nextId, cb);
      return nextId;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const run = (now: number): void => {
      const [id, cb] = [...frames.entries()][0]!;
      frames.delete(id);
      cb(now);
    };
    return { ctx, frames, cancel, run };
  }
  const mount = (durationMs: number) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<ConfettiCanvas durationMs={durationMs} />));
    return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
  };

  it("desenha no máximo 150 partículas por quadro e o laço termina sozinho quando acaba o tempo", () => {
    const t = setup();
    const view = mount(500);
    expect(t.frames.size).toBe(1);
    let now = 16;
    t.run(now);
    expect(t.ctx.fillRect.mock.calls.length).toBeGreaterThan(0);
    expect(t.ctx.fillRect.mock.calls.length).toBeLessThanOrEqual(150);
    let peak = 0;
    for (let i = 0; i < 600 && t.frames.size > 0; i += 1) {
      t.ctx.fillRect.mockClear();
      now += 50;
      t.run(now);
      peak = Math.max(peak, t.ctx.fillRect.mock.calls.length);
    }
    expect(peak).toBeLessThanOrEqual(150);
    expect(t.frames.size).toBe(0); // terminou: nenhum quadro agendado
    expect(t.ctx.clearRect).toHaveBeenCalled();
    view.unmount();
  }, LONG);

  it("desmontar cancela o quadro agendado", () => {
    const t = setup();
    const view = mount(5000);
    expect(t.frames.size).toBe(1);
    view.unmount();
    expect(t.cancel).toHaveBeenCalled();
    expect(t.frames.size).toBe(0);
  });

  it("aba oculta cancela o quadro; ao reaparecer volta a animar", () => {
    const t = setup();
    const view = mount(5000);
    t.run(16);
    expect(t.frames.size).toBe(1);
    setVisibility("hidden");
    expect(t.frames.size).toBe(0);
    expect(t.cancel).toHaveBeenCalled();
    setVisibility("visible");
    expect(t.frames.size).toBe(1);
    view.unmount();
    expect(t.frames.size).toBe(0);
  });

  it("sem suporte a canvas (getContext nulo) não anima nem agenda nada", () => {
    const t = setup();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const view = mount(1000);
    expect(t.frames.size).toBe(0);
    view.unmount();
  });
});

/* ------------------------------------------------ chave grande no telão ------------------------------------------------ */

describe("telão: chave grande em páginas, com zoom na luta ao vivo", () => {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const originalH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  beforeEach(() => {
    // jsdom não tem layout: só a seção da chave "mede" 1870 x 600 (a área útil de um telão 1080p).
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return (this as HTMLElement).classList.contains("cv-bracket") ? 1870 : 0; } });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return (this as HTMLElement).classList.contains("cv-bracket") ? 600 : 0; } });
  });
  afterEach(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, "clientWidth", original);
    if (originalH) Object.defineProperty(HTMLElement.prototype, "clientHeight", originalH);
  });

  const sixteen = (rev: number, liveMatchId: number | null): PublicSnapshot => {
    const { competitors, matches } = buildKnockout(16, { thirdPlace: true });
    return snapshot(rev, [category(1, { name: "Livre", competitors, matches: matches.map((x) => (x.id === liveMatchId ? { ...x, status: "LIVE" as const, mat: "1" } : x)) })]);
  };
  const pager = (host: HTMLElement): string => host.querySelector("[data-testid=cv-pager]")?.textContent ?? "";
  const visible = (host: HTMLElement): number[] => [...host.querySelectorAll<HTMLElement>("[data-testid=cv-match]")].map((c) => Number(c.getAttribute("data-match-id")));

  it("sem luta ao vivo gira entre as páginas; com luta ao vivo fica na página dela (sem encolher a chave)", async () => {
    const { matches } = buildKnockout(16, { thirdPlace: true });
    const lower = matches.find((x) => x.round === 1 && x.position === 6)!; // metade de baixo
    const m = mountLive("tok", true);
    feed(sixteen(1, null));
    expect(pager(m.host)).toContain("Parte superior");
    expect(visible(m.host).length).toBeLessThan(matches.length); // só uma parte da chave na tela
    expect(m.host.querySelector<HTMLElement>(".cv-stage-inner")!.style.transform).not.toContain("scale(0.15");
    await tick(PAGE_ROTATE_MS);
    expect(pager(m.host)).toContain("Parte inferior");
    await tick(PAGE_ROTATE_MS);
    expect(pager(m.host)).toContain("Fase final");

    feed(sixteen(2, lower.id)); // luta ao vivo na metade de baixo: o telão vai direto para lá
    expect(pager(m.host)).toContain("Parte inferior");
    expect(visible(m.host)).toContain(lower.id);
    await tick(PAGE_ROTATE_MS * 3); // só uma página em foco: não gira
    expect(pager(m.host)).toContain("Parte inferior");
    m.unmount();
    expect(vi.getTimerCount()).toBe(0);
  }, LONG);

  it("chave pequena (8 atletas) cabe inteira: sem indicador de página", () => {
    const { competitors, matches } = buildKnockout(8, { thirdPlace: true });
    const m = mountLive("tok", true);
    feed(snapshot(1, [category(1, { competitors, matches })]));
    expect(m.host.querySelector("[data-testid=cv-pager]")).toBeNull();
    expect(visible(m.host)).toHaveLength(matches.length);
  }, LONG);
});
