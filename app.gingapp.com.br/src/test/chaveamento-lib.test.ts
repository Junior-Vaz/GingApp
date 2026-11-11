import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { INITIAL_LIVE_STATE, LiveConnection, POLL_INTERVAL_MS, SSE_OPEN_TIMEOUT_MS, SSE_RETRY_MS, signatureOf, type LiveState } from "@/lib/chaveamento/connection";
import { useLiveTournament } from "@/lib/chaveamento/use-live-tournament";
import { announcementFor, diffSnapshots } from "@/lib/chaveamento/snapshot-diff";
import { computeBracketLayout, fitScale, roundLabel } from "@/lib/chaveamento/bracket-layout";
import { nextRotationCategoryId, pickInitialCategoryId, selectNowPlaying } from "@/lib/chaveamento/selectors";
import { parsePublicSnapshot } from "@/lib/chaveamento/parse";
import type { PublicSnapshot } from "@/lib/chaveamento/types";
import { buildKnockout, category, comp, match, snapshot } from "./chaveamento-fixtures";
import { MockEventSource } from "./chaveamento-mocks";
import { REAL_SINGLE_RUNNING } from "./real-contract-chaveamento";

/** Testes pesados de propósito generosos (timeouts altos): instáveis sob a carga do gate completo. */
const LONG = 60_000;

const lastSource = (): MockEventSource => MockEventSource.instances[MockEventSource.instances.length - 1]!;

/** Snapshot sintético de uma luta READY (A x B) ou FINISHED, serializado como o servidor manda. */
function body(revision: number, finished = false, serverTime = "2026-11-10T12:00:00.000Z"): string {
  const snap = snapshot(
    revision,
    [
      category(1, {
        competitors: [comp(1), comp(2), comp(3), comp(4)],
        matches: [
          match(10, { round: 1, position: 0, slotAId: 1, slotBId: 2, nextMatchId: 12, nextSlot: "A", status: finished ? "FINISHED" : "READY", winnerId: finished ? 1 : null }),
          match(11, { round: 1, position: 1, slotAId: 3, slotBId: 4, nextMatchId: 12, nextSlot: "B", status: "READY" }),
          match(12, { round: 2, position: 0, slotAId: finished ? 1 : null }),
        ],
      }),
    ],
    { serverTime },
  );
  return JSON.stringify(snap);
}

interface Harness {
  states: LiveState[];
  connection: LiveConnection;
  fetchMock: ReturnType<typeof vi.fn>;
  last: () => LiveState;
}

function setup(handlers: Array<() => Response | Promise<Response>> = []): Harness {
  const states: LiveState[] = [];
  let index = 0;
  const fetchMock = vi.fn(async () => {
    const handler = handlers[Math.min(index, handlers.length - 1)];
    index += 1;
    if (!handler) throw new Error("sem handler");
    return handler();
  });
  vi.stubGlobal("fetch", fetchMock);
  const connection = new LiveConnection("tok123", (s) => states.push(s));
  return { states, connection, fetchMock, last: () => states[states.length - 1] ?? INITIAL_LIVE_STATE };
}

const ok = (text: string, etag = '"1-abc"') => () => new Response(text, { status: 200, headers: { ETag: etag } });
const notModified = () => new Response(null, { status: 304 });
const status = (code: number) => () => new Response(JSON.stringify({ statusCode: code, code: code === 404 ? "TOURNAMENT_NOT_FOUND" : "TOO_MANY_VIEWERS" }), { status: code });

beforeEach(() => {
  vi.useFakeTimers();
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("chaveamento: máquina de conexão (SSE -> consulta 3 s com ETag)", () => {
  it("SSE abre e entrega snapshot: status live, sem nenhuma consulta", async () => {
    const h = setup([ok(body(5))]);
    h.connection.start();
    expect(MockEventSource.instances).toHaveLength(1);
    expect(lastSource().url).toMatch(/\/public\/tournaments\/tok123\/stream$/);
    expect(h.last().status).toBe("reconnecting");
    lastSource().emit("open");
    expect(h.last().status).toBe("live");
    lastSource().emit("snapshot", body(5));
    expect(h.last().snapshot?.revision).toBe(5);
    expect(h.last().diff?.initial).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.fetchMock).not.toHaveBeenCalled();
    h.connection.stop();
  }, LONG);

  it("não abre em 8 s: fecha o SSE e passa a consultar com If-None-Match; 304 mantém o estado", async () => {
    const h = setup([ok(body(7), '"7-aaaa"'), notModified, notModified]);
    h.connection.start();
    const first = lastSource();
    await vi.advanceTimersByTimeAsync(SSE_OPEN_TIMEOUT_MS - 1);
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(first.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(first.closed).toBe(true);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    const firstInit = h.fetchMock.mock.calls[0]![1] as RequestInit;
    expect((firstInit.headers as Record<string, string>)["If-None-Match"]).toBeUndefined();
    expect(h.last().status).toBe("polling");
    expect(h.last().snapshot?.revision).toBe(7);

    const snapshotRef = h.last().snapshot;
    const emitted = h.states.length;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    const secondInit = h.fetchMock.mock.calls[1]![1] as RequestInit;
    expect((secondInit.headers as Record<string, string>)["If-None-Match"]).toBe('"7-aaaa"');
    expect(h.states.length).toBe(emitted); // 304: nada muda, nenhum render novo
    expect(h.last().snapshot).toBe(snapshotRef);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(h.fetchMock).toHaveBeenCalledTimes(3);
    expect(h.last().status).toBe("polling");
    h.connection.stop();
  }, LONG);

  it("erro do SSE (ex.: 503 TOO_MANY_VIEWERS) cai para consulta na hora", async () => {
    const h = setup([ok(body(3))]);
    h.connection.start();
    lastSource().emit("error");
    expect(lastSource().closed).toBe(true);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.last().status).toBe("polling");
    h.connection.stop();
  }, LONG);

  it("durante a consulta tenta reabrir o SSE a cada 30 s; quando abre, a consulta para", async () => {
    const h = setup([ok(body(1)), notModified]);
    h.connection.start();
    lastSource().emit("error");
    await vi.advanceTimersByTimeAsync(0);
    expect(MockEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(SSE_RETRY_MS);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(h.last().status).toBe("polling"); // a consulta não para enquanto o SSE novo não abre
    const calls = h.fetchMock.mock.calls.length;
    expect(calls).toBeGreaterThan(5);

    // 2ª tentativa falha de novo: segue consultando e agenda a 3ª.
    lastSource().emit("error");
    await vi.advanceTimersByTimeAsync(SSE_RETRY_MS);
    expect(MockEventSource.instances).toHaveLength(3);

    // 3ª abre: vira live e NENHUMA consulta nova acontece.
    lastSource().emit("open");
    expect(h.last().status).toBe("live");
    const afterOpen = h.fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.fetchMock.mock.calls.length).toBe(afterOpen);
    expect(MockEventSource.instances).toHaveLength(3);
    h.connection.stop();
  }, LONG);

  it("`closed` (token rotacionado): indisponível, sem snapshot antigo e sem reconectar", async () => {
    const h = setup([ok(body(1))]);
    h.connection.start();
    lastSource().emit("open");
    lastSource().emit("snapshot", body(1));
    expect(h.last().snapshot).not.toBeNull();
    lastSource().emit("closed", JSON.stringify({ reason: "token-rotated" }));
    expect(h.last().status).toBe("unavailable");
    expect(h.last().snapshot).toBeNull();
    expect(lastSource().closed).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  }, LONG);

  it("`closed` sem motivo legível também é indisponível (o app não decide pelo motivo)", async () => {
    const h = setup([ok(body(1))]);
    h.connection.start();
    lastSource().emit("closed", "lixo");
    expect(h.last().status).toBe("unavailable");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(MockEventSource.instances).toHaveLength(1);
  }, LONG);

  it("`closed` por teto de 6 h ou reinício do servidor é passageiro: reavalia pela consulta (404 => indisponível)", async () => {
    const h = setup([status(404)]);
    h.connection.start();
    lastSource().emit("open");
    lastSource().emit("snapshot", body(1));
    lastSource().emit("closed", JSON.stringify({ reason: "max-duration" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(h.last().status).toBe("unavailable");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances).toHaveLength(1);
  }, LONG);

  it("404 na consulta: indisponível e para tudo", async () => {
    const h = setup([status(404)]);
    h.connection.start();
    lastSource().emit("error");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.last().status).toBe("unavailable");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  }, LONG);

  it("503 e erro de rede na consulta: reconnecting, e continua tentando a cada 3 s até voltar", async () => {
    const h = setup([status(503), () => Promise.reject(new Error("rede")), ok(body(2))]);
    h.connection.start();
    lastSource().emit("error");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.last().status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(h.last().status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(h.last().status).toBe("polling");
    expect(h.last().snapshot?.revision).toBe(2);
    h.connection.stop();
  }, LONG);

  it("revisão MAIS ANTIGA é ignorada; mesmo corpo repetido (só muda serverTime) não gera render; mesma revisão com conteúdo novo entra", async () => {
    const h = setup([ok(body(5))]);
    h.connection.start();
    lastSource().emit("open");
    lastSource().emit("snapshot", body(5));
    const afterFirst = h.states.length;
    lastSource().emit("snapshot", body(4, true));
    expect(h.last().snapshot?.revision).toBe(5);
    expect(h.states.length).toBe(afterFirst);
    lastSource().emit("snapshot", body(5, false, "2026-11-10T12:00:09.000Z"));
    expect(h.states.length).toBe(afterFirst);
    expect(signatureOf(body(5))).toBe(signatureOf(body(5, false, "2030-01-01T00:00:00.000Z")));
    lastSource().emit("snapshot", body(5, true)); // ex.: foto autorizada no meio do evento muda sem subir revision
    expect(h.states.length).toBe(afterFirst + 1);
    lastSource().emit("snapshot", "{isso nao e json");
    lastSource().emit("snapshot", JSON.stringify({ revision: "x" }));
    expect(h.states.length).toBe(afterFirst + 1);
    h.connection.stop();
  }, LONG);

  it("stop() fecha o EventSource, cancela timers e a consulta em andamento (nada acontece depois)", async () => {
    const h = setup([() => new Promise<Response>(() => undefined)]);
    h.connection.start();
    lastSource().emit("error"); // consulta pendurada + retry agendado
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    h.connection.stop();
    expect(vi.getTimerCount()).toBe(0);
    const emitted = h.states.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(h.states.length).toBe(emitted);

    const h2 = setup([ok(body(1))]);
    MockEventSource.instances = [];
    h2.connection.start();
    const source = lastSource();
    h2.connection.stop();
    expect(source.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  }, LONG);

  it("sem EventSource no navegador: vai direto para a consulta", async () => {
    vi.stubGlobal("EventSource", undefined);
    const h = setup([ok(body(1))]);
    h.connection.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.last().status).toBe("polling");
    h.connection.stop();
  }, LONG);

  it("useLiveTournament: desmontar limpa EventSource e timers; trocar o token reinicia", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let current: LiveState = INITIAL_LIVE_STATE;
    function Probe({ token }: { token: string }) {
      current = useLiveTournament(token);
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(createElement(Probe, { token: "aaa" })));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(current.status).toBe("reconnecting");
    act(() => root.render(createElement(Probe, { token: "bbb" })));
    expect(MockEventSource.instances[0]!.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(lastSource().url).toContain("/bbb/stream");
    act(() => lastSource().emit("open"));
    expect(current.status).toBe("live");
    act(() => root.unmount());
    expect(lastSource().closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  }, LONG);
});

/* ------------------------------------------------ snapshot-diff ------------------------------------------------ */

const two = (rev: number, over: { m10?: Partial<ReturnType<typeof match>>; cat?: Partial<ReturnType<typeof category>> } = {}): PublicSnapshot =>
  snapshot(rev, [
    category(1, {
      competitors: [comp(1, { name: "Ana" }), comp(2, { name: "Bia" }), comp(3), comp(4)],
      matches: [
        match(10, { round: 1, position: 0, slotAId: 1, slotBId: 2, nextMatchId: 12, nextSlot: "A", status: "READY", ...over.m10 }),
        match(11, { round: 1, position: 1, slotAId: 3, slotBId: 4, nextMatchId: 12, nextSlot: "B", status: "READY" }),
        match(12, { round: 2, position: 0 }),
      ],
      ...over.cat,
    }),
  ]);

describe("chaveamento: snapshot-diff", () => {
  it("primeiro snapshot NÃO anima nem anuncia, mesmo cheio de lutas terminadas", () => {
    const first = two(5, { m10: { status: "FINISHED", winnerId: 1 } });
    const diff = diffSnapshots(null, first);
    expect(diff).toMatchObject({ initial: true, stale: false, finished: [], started: [], categoriesFinished: [] });
    expect(announcementFor(diff)).toBe("");
  });

  it("detecta a luta que virou FINISHED, o vencedor e quem avançou para qual luta/lado", () => {
    const diff = diffSnapshots(two(5), two(6, { m10: { status: "FINISHED", winnerId: 1, scoreA: 3, scoreB: 1 } }));
    expect(diff.initial).toBe(false);
    expect(diff.finished).toHaveLength(1);
    expect(diff.finished[0]).toMatchObject({
      categoryId: 1,
      matchId: 10,
      winnerId: 1,
      winnerName: "Ana",
      nextMatchId: 12,
      nextSlot: "A",
      advancedCompetitorId: 1,
      scoreA: 3,
      scoreB: 1,
    });
    expect(announcementFor(diff)).toContain("Ana venceu");
  });

  it("detecta luta que virou LIVE e categoria que terminou", () => {
    const diff = diffSnapshots(two(5), two(6, { m10: { status: "LIVE", mat: "2" }, cat: { status: "FINISHED" } }));
    expect(diff.started).toEqual([{ categoryId: 1, matchId: 10, mat: "2" }]);
    expect(diff.categoriesFinished).toEqual([1]);
    expect(diff.finished).toEqual([]);
  });

  it("folga (isBye) nunca anima; luta que já estava FINISHED não repete; luta nova não conta", () => {
    const withBye = (finished: boolean): PublicSnapshot =>
      snapshot(finished ? 6 : 5, [
        category(1, {
          competitors: [comp(1), comp(2)],
          matches: [match(10, { slotAId: 1, isBye: true, status: finished ? "FINISHED" : "READY", winnerId: finished ? 1 : null, nextMatchId: 11, nextSlot: "A" })],
        }),
      ]);
    expect(diffSnapshots(withBye(false), withBye(true)).finished).toEqual([]);
    const done = two(6, { m10: { status: "FINISHED", winnerId: 1 } });
    expect(diffSnapshots(done, two(7, { m10: { status: "FINISHED", winnerId: 1 } })).finished).toEqual([]);
    const brandNew = snapshot(6, [category(9, { matches: [match(90, { status: "FINISHED", winnerId: 1 })] })]);
    expect(diffSnapshots(two(5), brandNew).finished).toEqual([]);
  });

  it("empate de grupo: terminou sem vencedor, nada avança", () => {
    const base = (finished: boolean) =>
      snapshot(finished ? 6 : 5, [
        category(1, {
          format: "ROUND_ROBIN",
          competitors: [comp(1), comp(2)],
          matches: [match(10, { stage: "GROUP", slotAId: 1, slotBId: 2, status: finished ? "FINISHED" : "READY", resultType: finished ? "DRAW" : null })],
        }),
      ]);
    const diff = diffSnapshots(base(false), base(true));
    expect(diff.finished[0]).toMatchObject({ winnerId: null, advancedCompetitorId: null });
    expect(announcementFor(diff)).toMatch(/empatada/);
  });

  it("revisão antiga é ignorada por inteiro", () => {
    const diff = diffSnapshots(two(9), two(8, { m10: { status: "FINISHED", winnerId: 1 } }));
    expect(diff).toMatchObject({ stale: true, initial: false, finished: [], started: [] });
    expect(announcementFor(diff)).toBe("");
  });

  it("com snapshots REAIS: terminar a luta pronta do mata-mata real gera exatamente 1 evento", () => {
    const before = parsePublicSnapshot(REAL_SINGLE_RUNNING)!;
    const after = structuredClone(before);
    after.revision += 1;
    const cat = after.categories[0]!;
    const ready = cat.matches.find((m) => m.status === "READY" && m.slotAId !== null && m.slotBId !== null)!;
    ready.status = "FINISHED";
    ready.winnerId = ready.slotAId;
    const diff = diffSnapshots(before, after);
    expect(diff.finished).toHaveLength(1);
    expect(diff.finished[0]!.advancedCompetitorId).toBe(ready.slotAId);
    expect(diff.finished[0]!.nextMatchId).toBe(ready.nextMatchId);
  });
});

/* ------------------------------------------------ bracket-layout ------------------------------------------------ */

describe("chaveamento: bracket-layout (geometria pura)", () => {
  it("N = 2..128: nenhum cartão sobrepõe outro, todos os conectores ligam lutas que existem e tudo cabe no desenho", () => {
    for (let n = 2; n <= 128; n += 1) {
      const { matches } = buildKnockout(n, { thirdPlace: true });
      const layout = computeBracketLayout(matches);
      const ids = new Set(matches.map((m) => m.id));
      expect(layout.cards.length, `n=${n}`).toBe(matches.length);
      for (const card of layout.cards) {
        expect(card.x, `n=${n}`).toBeGreaterThanOrEqual(0);
        expect(card.y, `n=${n}`).toBeGreaterThanOrEqual(0);
        expect(card.x + card.w, `n=${n}`).toBeLessThanOrEqual(layout.width);
        expect(card.y + card.h, `n=${n}`).toBeLessThanOrEqual(layout.height);
      }
      for (let i = 0; i < layout.cards.length; i += 1) {
        for (let j = i + 1; j < layout.cards.length; j += 1) {
          const a = layout.cards[i]!;
          const b = layout.cards[j]!;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          if (overlap) throw new Error(`n=${n}: cartões ${a.matchId} e ${b.matchId} se sobrepõem`);
        }
      }
      const mainWithNext = matches.filter((m) => m.stage === "MAIN" && m.nextMatchId !== null);
      expect(layout.connectors.length, `n=${n}`).toBe(mainWithNext.length);
      for (const c of layout.connectors) {
        expect(ids.has(c.fromMatchId), `n=${n}`).toBe(true);
        expect(ids.has(c.toMatchId), `n=${n}`).toBe(true);
        expect(c.x2).toBeGreaterThan(c.x1);
        expect(c.d.startsWith(`M ${c.x1} ${c.y1} H `)).toBe(true);
      }
      // colunas = número de rodadas; 3º lugar (N >= 4) fica na coluna da final, abaixo dela
      const rounds = Math.ceil(Math.log2(n));
      expect(layout.columns.length, `n=${n}`).toBe(rounds);
      if (n >= 4) {
        const final = layout.cards.find((c) => c.stage === "MAIN" && c.round === rounds)!;
        expect(layout.third?.x).toBe(final.x);
        expect(layout.third!.y).toBeGreaterThan(final.y + final.h);
      } else {
        expect(layout.third).toBeNull();
      }
    }
  }, LONG);

  it("cada luta fica centrada entre as duas que a alimentam (quando não há colisão)", () => {
    const { matches } = buildKnockout(8);
    const layout = computeBracketLayout(matches);
    const byId = new Map(layout.cards.map((c) => [c.matchId, c]));
    const final = layout.cards.find((c) => c.round === 3)!;
    const feeders = matches.filter((m) => m.nextMatchId === final.matchId).map((m) => byId.get(m.id)!);
    const mid = feeders.reduce((s, f) => s + f.y + f.h / 2, 0) / feeders.length;
    expect(final.y + final.h / 2).toBeCloseTo(mid, 5);
  });

  it("lado A/B da luta seguinte decide a altura em que o conector encosta", () => {
    const { matches } = buildKnockout(4);
    const layout = computeBracketLayout(matches);
    const toFinal = layout.connectors.filter((c) => c.toMatchId === matches.find((m) => m.round === 2)!.id);
    const a = toFinal.find((c) => c.nextSlot === "A")!;
    const b = toFinal.find((c) => c.nextSlot === "B")!;
    expect(a.y2).toBeLessThan(b.y2);
  });

  it("rótulos das rodadas e função de ajuste à tela", () => {
    expect(roundLabel(4, 4)).toBe("Final");
    expect(roundLabel(3, 4)).toBe("Semifinais");
    expect(roundLabel(2, 4)).toBe("Quartas de final");
    expect(roundLabel(1, 4)).toBe("Oitavas de final");
    expect(roundLabel(1, 7)).toBe("1ª rodada");
    expect(roundLabel(2, 7)).toBe("32 avos de final");
    expect(roundLabel(1, 6)).toBe("1ª rodada");
    expect(roundLabel(1, 5)).toBe("16 avos de final");
    expect(roundLabel(1, 3)).toBe("Quartas de final");
    expect(fitScale({ width: 1000, height: 500 }, { width: 500, height: 500 })).toBe(0.5);
    expect(fitScale({ width: 100, height: 100 }, { width: 5000, height: 5000 })).toBe(1.6);
    expect(fitScale({ width: 100000, height: 100 }, { width: 100, height: 100 })).toBe(0.15);
    expect(fitScale({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1);
  });

  it("sem lutas MAIN: layout vazio e sem erro", () => {
    const layout = computeBracketLayout([]);
    expect(layout.cards).toEqual([]);
    expect(layout.connectors).toEqual([]);
  });
});

/* ------------------------------------------------ seleções / rodízio ------------------------------------------------ */

describe("chaveamento: rodízio do modo telão e fila", () => {
  const cats = (liveIds: number[]): PublicSnapshot =>
    snapshot(
      1,
      [1, 2, 3, 4].map((id) =>
        category(id, id === 4 ? {} : { matches: [match(id * 10, { status: liveIds.includes(id) ? "LIVE" : "READY", slotAId: 1, slotBId: 2 })] }),
      ),
    );

  it("sem luta ao vivo gira entre as categorias COM lutas (pula as não sorteadas) e dá a volta", () => {
    const s = cats([]);
    expect(nextRotationCategoryId(s, 1)).toBe(2);
    expect(nextRotationCategoryId(s, 3)).toBe(1);
    expect(nextRotationCategoryId(s, 4)).toBe(1);
    expect(nextRotationCategoryId(s, null)).toBe(1);
  });

  it("prioriza só as categorias com luta ao vivo", () => {
    const s = cats([2, 3]);
    expect(nextRotationCategoryId(s, 1)).toBe(2);
    expect(nextRotationCategoryId(s, 2)).toBe(3);
    expect(nextRotationCategoryId(s, 3)).toBe(2);
    expect(pickInitialCategoryId(s)).toBe(2);
    expect(pickInitialCategoryId(cats([]))).toBe(1);
    expect(nextRotationCategoryId(snapshot(1, []), null)).toBeNull();
  });

  it("AGORA (todas as categorias, por tatame) e PRÓXIMAS (ordem de chamada; folga e atleta a definir ficam fora)", () => {
    const s = snapshot(1, [
      category(1, {
        competitors: [comp(1), comp(2), comp(3), comp(4), comp(5)],
        matches: [
          match(1, { status: "LIVE", slotAId: 1, slotBId: 2, mat: "2" }),
          match(2, { status: "READY", slotAId: 3, slotBId: 4, queueOrder: 5 }),
          match(3, { status: "READY", slotAId: 1, slotBId: 5, queueOrder: 2 }),
          match(4, { status: "READY", slotAId: 5, slotBId: null }),
          match(5, { status: "READY", slotAId: 5, isBye: true }),
        ],
      }),
      category(2, { competitors: [comp(7), comp(8)], matches: [match(9, { status: "LIVE", slotAId: 7, slotBId: 8, mat: "1" })] }),
    ]);
    const now = selectNowPlaying(s);
    expect(now.live.map((e) => e.match.id)).toEqual([9, 1]); // tatame 1 antes do 2
    expect(now.next.map((e) => e.match.id)).toEqual([3, 2]);
  });
});
