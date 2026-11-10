import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Avatar } from "@/components/chaveamento/avatar";
import { colorForId } from "@/lib/chaveamento/colors";
import { ADVANCE_MS, ADVANCE_REDUCED_MS } from "@/components/chaveamento/bracket-view";
import { Route } from "@/routes/ao-vivo.$token";
import { parseTvSearch } from "@/lib/chaveamento/search";
import { ROTATION_MS } from "@/lib/chaveamento/hooks";
import type { PublicSnapshot } from "@/lib/chaveamento/types";
import { category, comp, match, snapshot } from "./chaveamento-fixtures";
import { MockEventSource, lastSource } from "./chaveamento-mocks";
import { cleanupMounted, click, feed, mountLive, selectedTab, setReducedMotion, tabs } from "./chaveamento-dom";
import { REAL_GROUPS_RUNNING, REAL_ROUNDROBIN_RUNNING } from "./real-contract-chaveamento";

/** Testes de tela: propositalmente com timeouts generosos (instáveis sob a carga do gate completo). */
const LONG = 60_000;
const PHOTO = "/api/uploads/aaaaaaaa-aaaa-4aaa-8aaa-000000000002.webp";

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

/** Duas lutas READY + final: terminar a luta 10 faz o vencedor 1 correr para a final (luta 12, lado A). */
const bracket = (rev: number, finished: boolean): PublicSnapshot =>
  snapshot(rev, [
    category(1, {
      name: "Adulto até 70 kg",
      competitors: [comp(1, { name: "Ana Souza", group: "Grupo X" }), comp(2, { name: "Bia Lima" }), comp(3, { name: "Cris Rocha" }), comp(4, { name: "Duda Melo" })],
      matches: [
        match(10, { key: "MAIN-1-0", round: 1, position: 0, slotAId: 1, slotBId: 2, nextMatchId: 12, nextSlot: "A", status: finished ? "FINISHED" : "READY", winnerId: finished ? 1 : null, scoreA: finished ? 5 : null, scoreB: finished ? 2 : null }),
        match(11, { key: "MAIN-1-1", round: 1, position: 1, slotAId: 3, slotBId: 4, nextMatchId: 12, nextSlot: "B", status: "READY" }),
        match(12, { key: "MAIN-2-0", round: 2, position: 0, slotAId: finished ? 1 : null }),
      ],
    }),
  ]);

const threeCategories = (liveIn: number | null = null, rev = 1): PublicSnapshot =>
  snapshot(
    rev,
    [1, 2, 3].map((id) =>
      category(id, {
        name: `Cat ${id}`,
        competitors: [comp(id * 10 + 1), comp(id * 10 + 2)],
        matches: [match(id * 100, { slotAId: id * 10 + 1, slotBId: id * 10 + 2, status: liveIn === id ? "LIVE" : "READY", nextMatchId: null })],
      }),
    ),
  );

describe("chaveamento: foto nula => iniciais (regra de privacidade na tela)", () => {
  it("photoUrl null: nenhuma <img>, iniciais coloridas e estáveis por id", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<Avatar id={7} name="Ana Souza" photoUrl={null} />));
    expect(host.querySelectorAll("img").length).toBe(0);
    expect(host.textContent).toBe("AS");
    const bg = (host.querySelector("[data-testid=cv-avatar]") as HTMLElement).style.background;
    expect(bg).not.toBe("");
    expect(colorForId(7)).toBe(colorForId(7));
    expect(new Set([1, 2, 3, 4, 5].map(colorForId)).size).toBeGreaterThan(3);
    act(() => root.unmount());
    host.remove();
  });

  it("com foto: <img> com alt vazio e sem referrer; se quebrar (onError) cai para as iniciais; trocar a foto tenta de novo", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<Avatar id={7} name="Ana Souza" photoUrl={PHOTO} />));
    const img = host.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toContain(PHOTO);
    expect(img!.getAttribute("alt")).toBe("");
    expect(img!.getAttribute("referrerpolicy")).toBe("no-referrer");
    act(() => {
      img!.dispatchEvent(new Event("error"));
    });
    expect(host.querySelectorAll("img").length).toBe(0);
    expect(host.textContent).toBe("AS");
    act(() => root.render(<Avatar id={7} name="Ana Souza" photoUrl="https://cdn.exemplo.com/outra.jpg" />));
    expect(host.querySelectorAll("img").length).toBe(1);
    act(() => root.unmount());
    host.remove();
  });

  it("na tela inteira: sem photoUrl nenhum <img> existe; com foto real todas as <img> saem sem referrer e com alt vazio", () => {
    mountLive("tok", false);
    feed(bracket(1, false));
    expect(document.querySelectorAll("img").length).toBe(0);
    cleanupMounted();

    MockEventSource.instances = [];
    const m = mountLive("tok", false);
    feed(JSON.stringify(REAL_ROUNDROBIN_RUNNING));
    const images = [...m.host.querySelectorAll("img")];
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) {
      expect(img.getAttribute("alt")).toBe("");
      expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    }
  }, LONG);
});

describe("chaveamento: estados da página", () => {
  it("carregando: esqueleto; depois do snapshot, a chave", () => {
    const m = mountLive();
    expect(m.host.querySelector("[data-testid=cv-loading]")).not.toBeNull();
    expect(m.host.querySelector("[aria-busy=true]")).not.toBeNull();
    feed(bracket(1, false));
    expect(m.host.querySelector("[data-testid=cv-loading]")).toBeNull();
    expect(m.host.textContent).toContain("Campeonato Teste");
    expect(m.host.querySelectorAll("[data-testid=cv-match]").length).toBe(3);
  }, LONG);

  it("`closed`: texto genérico, sem motivo, sem dados do campeonato e sem tentar reconectar", async () => {
    const m = mountLive();
    feed(bracket(1, false));
    act(() => lastSource().emit("closed", JSON.stringify({ reason: "token-rotated" })));
    const text = m.host.textContent ?? "";
    expect(text).toContain("Este campeonato não está disponível");
    expect(text).not.toMatch(/token|rotacion|desligad|Campeonato Teste|Ana Souza/i);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(MockEventSource.instances).toHaveLength(1);
  }, LONG);

  it("404 pela consulta também mostra o texto genérico", async () => {
    const m = mountLive();
    act(() => lastSource().emit("error"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(m.host.querySelector("[data-testid=cv-unavailable]")).not.toBeNull();
  }, LONG);

  it("categoria sem lutas: 'Chave ainda não sorteada'", () => {
    const m = mountLive();
    feed(snapshot(1, [category(1, { name: "Pesado", status: "SETUP" })]));
    expect(m.host.textContent).toContain("Chave ainda não sorteada");
  }, LONG);

  it("indicador AO VIVO vira 'Reconectando…' quando o SSE cai e a consulta falha", async () => {
    const m = mountLive();
    feed(bracket(1, false));
    expect(m.host.querySelector("[data-testid=cv-status]")?.getAttribute("data-status")).toBe("live");
    expect(m.host.querySelector("[data-testid=cv-status]")?.textContent).toContain("AO VIVO");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 500 })));
    act(() => lastSource().emit("error"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(m.host.querySelector("[data-testid=cv-status]")?.textContent).toContain("Reconectando");
    expect(m.host.textContent).toContain("Ana Souza"); // a chave continua na tela
  }, LONG);

  it("abas: aria-selected, tablist e troca de categoria por toque", () => {
    const m = mountLive();
    feed(threeCategories());
    expect(m.host.querySelector('[role="tablist"]')).not.toBeNull();
    expect(selectedTab(m.host)).toBe("Cat 1");
    click(tabs(m.host)[2]!);
    expect(selectedTab(m.host)).toBe("Cat 3");
  }, LONG);

  it("nenhum dado de atleta vai para localStorage/sessionStorage e a página não carrega analytics", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const m = mountLive();
    feed(JSON.stringify(REAL_GROUPS_RUNNING));
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(m.host.querySelector("script")).toBeNull();
  }, LONG);

  it("rota: noindex + referrer none no <head> e `?tv=1` ligando o modo telão", () => {
    const head = Route.options.head!({} as never) as { meta: Array<Record<string, string>> };
    expect(head.meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(head.meta).toContainEqual({ name: "referrer", content: "no-referrer" });
    expect(parseTvSearch({ tv: 1 })).toEqual({ tv: 1 });
    expect(parseTvSearch({ tv: "1" })).toEqual({ tv: 1 });
    expect(parseTvSearch({ tv: "0" })).toEqual({});
    expect(parseTvSearch({})).toEqual({});
  });
});

describe("chaveamento: acessibilidade (aria-live só para mudanças)", () => {
  it("o primeiro snapshot não anuncia nada; a luta que termina é anunciada com o vencedor", () => {
    const m = mountLive();
    feed(bracket(1, true)); // já chega com a luta 10 terminada: é só o estado inicial
    const live = m.host.querySelector("[data-testid=cv-announcer]")!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("");
    feed(bracket(2, true)); // mesmo conteúdo, revisão nova: nada mudou
    expect(live.textContent).toBe("");

    cleanupMounted();
    MockEventSource.instances = [];
    const m2 = mountLive();
    feed(bracket(1, false));
    feed(bracket(2, true));
    const text = m2.host.querySelector("[data-testid=cv-announcer]")!.textContent ?? "";
    expect(text).toContain("Ana Souza venceu");
    expect(text).toContain("Adulto até 70 kg");
  }, LONG);

  it("cada cartão tem descrição em texto da luta (não depende de cor)", () => {
    const m = mountLive();
    feed(bracket(1, false));
    feed(bracket(2, true));
    const card = m.host.querySelector('[data-match-id="10"]')!;
    expect(card.getAttribute("aria-label")).toMatch(/Ana Souza contra Bia Lima, terminou, placar 5 a 2\. Ana Souza venceu\./);
  }, LONG);
});

describe("chaveamento: animação do vencedor e prefers-reduced-motion", () => {
  it("snapshot com luta terminada: o vencedor corre pela linha até a próxima luta (< 1 s) e depois some", async () => {
    const m = mountLive();
    feed(bracket(1, false));
    expect(m.host.querySelector("[data-testid=cv-winner-chip]")).toBeNull(); // primeiro snapshot não anima
    expect(m.host.querySelector("path.cv-link-run")).toBeNull();
    feed(bracket(2, true));
    expect(m.host.querySelectorAll("[data-testid=cv-winner-chip]").length).toBe(1);
    expect(m.host.querySelectorAll('path.cv-link-run[data-motion="on"]').length).toBe(1);
    expect(m.host.querySelector('[data-match-id="12"]')?.getAttribute("data-highlight")).toBe("advanced");
    expect(m.host.querySelectorAll('[data-motion="on"]').length).toBeGreaterThan(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADVANCE_MS + 300);
    });
    expect(m.host.querySelector("[data-testid=cv-winner-chip]")).toBeNull();
    expect(m.host.querySelector("path.cv-link-run")).toBeNull();
    expect(m.host.querySelector('[data-match-id="12"]')?.getAttribute("data-highlight")).toBeNull();
    expect(ADVANCE_MS).toBeLessThanOrEqual(1000);
  }, LONG);

  it("um snapshot sem resultado novo no meio da animação não a interrompe", async () => {
    const m = mountLive();
    feed(bracket(1, false));
    feed(bracket(2, true));
    feed({ ...bracket(3, true), serverTime: "2026-11-10T13:00:00.000Z", organizationName: "Grupo Teste 2" });
    expect(m.host.querySelectorAll("[data-testid=cv-winner-chip]").length).toBe(1);
  }, LONG);

  it("prefers-reduced-motion: NENHUM movimento (sem avatar correndo, sem motion), só destaque de cor/borda", async () => {
    setReducedMotion(true);
    const m = mountLive();
    feed(bracket(1, false));
    expect(m.host.querySelectorAll('[data-motion="on"]').length).toBe(0);
    feed(bracket(2, true));
    expect(m.host.querySelector("[data-testid=cv-winner-chip]")).toBeNull();
    expect(m.host.querySelectorAll('[data-motion="on"]').length).toBe(0);
    expect(m.host.querySelectorAll('path.cv-link-run[data-motion="off"]').length).toBe(1);
    expect(m.host.querySelector('[data-match-id="12"]')?.getAttribute("data-highlight")).toBe("advanced");
    // nenhum estilo inline de transformação/opacidade inicial vindo da biblioteca de animação
    for (const el of m.host.querySelectorAll<HTMLElement>(".cv-pos")) {
      expect(el.style.transform).toBe("");
      expect(el.style.opacity).toBe("");
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADVANCE_REDUCED_MS + 100);
    });
    expect(m.host.querySelector("path.cv-link-run")).toBeNull();
  }, LONG);

  it("confete do pódio só quando a categoria TERMINA ao vivo, e nunca com movimento reduzido", () => {
    const finished = (rev: number, status: "RUNNING" | "FINISHED"): PublicSnapshot =>
      snapshot(rev, [
        category(1, {
          name: "Final",
          status,
          competitors: [comp(1, { name: "Ana" }), comp(2, { name: "Bia" })],
          matches: [match(10, { slotAId: 1, slotBId: 2, status: status === "FINISHED" ? "FINISHED" : "LIVE", winnerId: status === "FINISHED" ? 1 : null })],
          podium: status === "FINISHED" ? [{ place: 1, competitorId: 1 }, { place: 2, competitorId: 2 }] : [],
        }),
      ]);
    const m = mountLive();
    feed(finished(1, "FINISHED")); // já chegou terminada: pódio sem confete
    expect(m.host.querySelector("[data-testid=cv-podium]")).not.toBeNull();
    expect(m.host.querySelector("[data-testid=cv-confetti]")).toBeNull();
    cleanupMounted();

    MockEventSource.instances = [];
    const live = mountLive();
    feed(finished(1, "RUNNING"));
    feed(finished(2, "FINISHED"));
    expect(live.host.querySelector("[data-testid=cv-confetti]")).not.toBeNull();
    cleanupMounted();

    setReducedMotion(true);
    MockEventSource.instances = [];
    const calm = mountLive();
    feed(finished(1, "RUNNING"));
    feed(finished(2, "FINISHED"));
    expect(calm.host.querySelector("[data-testid=cv-podium]")).not.toBeNull();
    expect(calm.host.querySelector("[data-testid=cv-confetti]")).toBeNull();
  }, LONG);
});

describe("chaveamento: modo telão (?tv=1)", () => {
  it("rodízio a cada 20 s; tocar numa aba pausa; 'Retomar rodízio' volta", async () => {
    const m = mountLive("tok", true);
    feed(threeCategories());
    expect(m.host.querySelector("[data-tv='1']")).not.toBeNull();
    expect(selectedTab(m.host)).toBe("Cat 1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROTATION_MS - 1);
    });
    expect(selectedTab(m.host)).toBe("Cat 1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(selectedTab(m.host)).toBe("Cat 2");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROTATION_MS);
    });
    expect(selectedTab(m.host)).toBe("Cat 3");

    click(tabs(m.host)[0]!); // toque do usuário
    expect(selectedTab(m.host)).toBe("Cat 1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROTATION_MS * 5);
    });
    expect(selectedTab(m.host)).toBe("Cat 1"); // pausado
    const resume = [...m.host.querySelectorAll("button")].find((b) => b.textContent?.includes("Retomar rodízio"));
    click(resume ?? null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROTATION_MS);
    });
    expect(selectedTab(m.host)).toBe("Cat 2");
  }, LONG);

  it("sem `tv` não há rodízio nenhum", async () => {
    const m = mountLive("tok", false);
    feed(threeCategories());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROTATION_MS * 3);
    });
    expect(selectedTab(m.host)).toBe("Cat 1");
  }, LONG);

  it("prioriza a categoria com luta AO VIVO: abre nela e salta para onde uma luta começa", async () => {
    const m = mountLive("tok", true);
    feed(threeCategories(2));
    expect(selectedTab(m.host)).toContain("Cat 2");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROTATION_MS * 2);
    });
    expect(selectedTab(m.host)).toContain("Cat 2"); // só ela tem luta ao vivo: o rodízio fica nela

    cleanupMounted();
    MockEventSource.instances = [];
    const m2 = mountLive("tok", true);
    feed(threeCategories(null, 1));
    expect(selectedTab(m2.host)).toBe("Cat 1");
    feed(threeCategories(3, 2)); // uma luta da categoria 3 começou agora
    expect(selectedTab(m2.host)).toContain("Cat 3");
  }, LONG);

  it("faixa AGORA no tatame N com os dois lados e PRÓXIMAS", () => {
    const s = snapshot(1, [
      category(1, {
        competitors: [comp(1, { name: "Ana" }), comp(2, { name: "Bia" }), comp(3, { name: "Cris" }), comp(4, { name: "Duda" })],
        matches: [
          match(1, { slotAId: 1, slotBId: 2, status: "LIVE", mat: "3" }),
          match(2, { slotAId: 3, slotBId: 4, status: "READY", queueOrder: 1, mat: "3" }),
        ],
      }),
    ]);
    const m = mountLive("tok", true);
    feed(s);
    const now = m.host.querySelector("[data-testid=cv-now-live]")!;
    expect(now.textContent).toContain("AGORA");
    expect(now.textContent).toContain("no tatame 3");
    expect(now.textContent).toContain("Ana");
    expect(now.textContent).toContain("Bia");
    expect(m.host.querySelector("[data-testid=cv-now-next]")?.textContent).toContain("Cris");
    expect(m.host.textContent).toContain("PRÓXIMAS");
  }, LONG);

  it("Wake Lock: pede a tela acesa, pede de novo ao voltar a ficar visível, libera ao sair; erro não derruba a página", async () => {
    const released: number[] = [];
    let n = 0;
    const request = vi.fn(async () => {
      const id = (n += 1);
      const sentinel = { released: false, release: vi.fn(async () => { sentinel.released = true; released.push(id); }) };
      return sentinel;
    });
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
    const m = mountLive("tok", true);
    feed(threeCategories());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(request).toHaveBeenCalledWith("screen");
    expect(request).toHaveBeenCalledTimes(1);

    // o navegador solta o bloqueio ao esconder a aba; ao voltar, a página pede de novo
    released.length = 0;
    const lock = (await request.mock.results[0]!.value) as { released: boolean };
    lock.released = true;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(request).toHaveBeenCalledTimes(2);

    m.unmount();
    expect(released.length).toBeGreaterThan(0);

    request.mockRejectedValue(new Error("NotAllowedError"));
    MockEventSource.instances = [];
    mountLive("tok", true);
    feed(threeCategories());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(document.body.textContent).toContain("Cat 1");

    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });
    cleanupMounted();
    MockEventSource.instances = [];
    mountLive("tok", true);
    feed(threeCategories());
    expect(document.body.textContent).toContain("Cat 1");
    Reflect.deleteProperty(navigator, "wakeLock");
  }, LONG);

  it("tela cheia: o botão chama requestFullscreen e um erro do navegador não vaza", async () => {
    const request = vi.fn(async () => {
      throw new Error("recusado");
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: request });
    const m = mountLive("tok", true);
    feed(threeCategories());
    const button = [...m.host.querySelectorAll("button")].find((b) => b.textContent?.includes("Tela cheia"));
    expect(button).toBeDefined();
    click(button ?? null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(request).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
  }, LONG);

  it("cursor some após inatividade no modo telão (e volta ao mexer)", async () => {
    const m = mountLive("tok", true);
    feed(threeCategories());
    const root = m.host.querySelector(".cv-root")!;
    expect(root.getAttribute("data-idle")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(root.getAttribute("data-idle")).toBe("1");
    act(() => {
      window.dispatchEvent(new Event("pointermove"));
    });
    expect(root.getAttribute("data-idle")).toBeNull();
  }, LONG);
});
