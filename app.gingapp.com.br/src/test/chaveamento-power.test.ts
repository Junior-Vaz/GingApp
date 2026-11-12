import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_LIVE_STATE, LiveConnection, POLL_BACKOFF_MAX_MS, POLL_INTERVAL_MS, SSE_OPEN_TIMEOUT_MS, SSE_RETRY_MS, type LiveState } from "@/lib/chaveamento/connection";
import { category, comp, match, snapshot } from "./chaveamento-fixtures";
import { MockEventSource, lastSource } from "./chaveamento-mocks";

/**
 * Bateria e dados de quem acompanha por horas: aba oculta e aparelho offline não pedem NADA (EventSource fechado, nenhum timer
 * de pé), e ao voltar a conexão faz uma consulta imediata com If-None-Match e reabre o SSE. Timers falsos + mocks de
 * `document.visibilityState` e `navigator.onLine`.
 */

const body = (revision: number): string => JSON.stringify(snapshot(revision, [category(1, { competitors: [comp(1), comp(2)], matches: [match(10, { slotAId: 1, slotBId: 2, status: "LIVE" })] })]));
const ok = (text: string, etag = '"a"') => new Response(text, { status: 200, headers: { ETag: etag } });

let visibility: "visible" | "hidden" = "visible";
let online = true;
function setVisibility(next: "visible" | "hidden"): void {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}
function setOnline(next: boolean): void {
  online = next;
  window.dispatchEvent(new Event(next ? "online" : "offline"));
}

interface Harness {
  states: LiveState[];
  connection: LiveConnection;
  fetchMock: ReturnType<typeof vi.fn>;
  last: () => LiveState;
}

function setup(responses: Array<() => Response | Promise<Response>> = []): Harness {
  const states: LiveState[] = [];
  let call = 0;
  const fetchMock = vi.fn(async (..._args: unknown[]) => {
    const next = responses[Math.min(call, responses.length - 1)] ?? (() => new Response("{}", { status: 404 }));
    call += 1;
    return next();
  });
  vi.stubGlobal("fetch", fetchMock);
  const connection = new LiveConnection("tok123", (s) => states.push(s));
  return { states, connection, fetchMock, last: () => states[states.length - 1] ?? INITIAL_LIVE_STATE };
}

/** Deixa as promessas do fetch (e do .text()) resolverem. */
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  online = true;
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (document as { visibilityState?: unknown }).visibilityState;
  delete (navigator as { onLine?: unknown }).onLine;
});

describe("chaveamento (bateria): aba oculta pausa tudo e ao voltar ressincroniza", () => {
  it("SSE aberto + ocultar: fecha o EventSource, zera os timers e não pede mais nada, nem em horas", async () => {
    const h = setup();
    h.connection.start();
    lastSource().emit("open");
    lastSource().emit("snapshot", body(1));
    expect(h.last().status).toBe("live");
    const source = lastSource();

    setVisibility("hidden");
    expect(source.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000); // 6 horas oculto
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(1);
    expect(h.last().snapshot?.revision).toBe(1); // o último placar continua guardado

    setVisibility("visible");
    expect(MockEventSource.instances).toHaveLength(2); // reabriu o SSE
    expect(h.fetchMock).toHaveBeenCalledTimes(1); // e já consultou (resync imediato)
    h.connection.stop();
  });

  it("consulta de volta ao primeiro plano manda If-None-Match e um 304 não mexe no placar", async () => {
    const h = setup([() => ok(body(1), '"etag-1"'), () => new Response(null, { status: 304 })]);
    h.connection.start();
    lastSource().emit("error"); // SSE caiu: vai para a consulta
    await flush();
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(h.last().status).toBe("polling");
    const seqBefore = h.last().seq;

    setVisibility("hidden");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await flush();
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    const init = h.fetchMock.mock.calls[1]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["If-None-Match"]).toBe('"etag-1"');
    expect(h.last().seq).toBe(seqBefore); // 304: nenhum render novo
    h.connection.stop();
  });

  it("consulta em andamento é abortada ao ocultar (nenhuma resposta tardia mexe no estado)", async () => {
    let signal: AbortSignal | undefined;
    const h = setup();
    h.fetchMock.mockImplementation(async (_url: unknown, init?: unknown) => {
      signal = (init as RequestInit).signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    h.connection.start();
    lastSource().emit("error");
    await flush();
    expect(signal?.aborted).toBe(false);
    setVisibility("hidden");
    expect(signal?.aborted).toBe(true);
    h.connection.stop();
  });

  it("aberta em segundo plano (já oculta): não abre nada até aparecer", async () => {
    visibility = "hidden";
    const h = setup();
    h.connection.start();
    expect(MockEventSource.instances).toHaveLength(0);
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    setVisibility("visible");
    expect(MockEventSource.instances).toHaveLength(1);
    h.connection.stop();
  });

  it("ocultar durante a tentativa de abrir o SSE cancela o prazo de 8 s e a reabertura de 30 s", async () => {
    const h = setup();
    h.connection.start();
    expect(vi.getTimerCount()).toBe(1); // prazo do SSE abrir
    setVisibility("hidden");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(SSE_OPEN_TIMEOUT_MS + SSE_RETRY_MS + 1000);
    expect(h.fetchMock).not.toHaveBeenCalled();
    h.connection.stop();
  });

  it("stop() tira os ouvintes de visibilidade e de rede (nada vaza depois de sair da página)", () => {
    const addDoc = vi.spyOn(document, "addEventListener");
    const removeDoc = vi.spyOn(document, "removeEventListener");
    const h = setup();
    h.connection.start();
    expect(addDoc).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    h.connection.stop();
    expect(removeDoc).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    const before = MockEventSource.instances.length;
    setVisibility("hidden");
    setVisibility("visible");
    setOnline(false);
    setOnline(true);
    expect(MockEventSource.instances).toHaveLength(before);
  });
});

describe("chaveamento (bateria): offline mantém o último placar e ressincroniza ao voltar", () => {
  it("offline: fecha o SSE, para a consulta, marca offline e NÃO apaga o snapshot; online: consulta na hora", async () => {
    const h = setup([() => ok(body(2), '"b"')]);
    h.connection.start();
    lastSource().emit("open");
    lastSource().emit("snapshot", body(1));
    const source = lastSource();

    setOnline(false);
    expect(source.closed).toBe(true);
    expect(h.last().offline).toBe(true);
    expect(h.last().status).toBe("reconnecting");
    expect(h.last().snapshot?.revision).toBe(1); // continua mostrando o último placar
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(h.fetchMock).not.toHaveBeenCalled();

    setOnline(true);
    expect(h.last().offline).toBe(false);
    expect(MockEventSource.instances).toHaveLength(2);
    await flush();
    expect(h.fetchMock).toHaveBeenCalledTimes(1); // resync imediato
    expect(h.last().snapshot?.revision).toBe(2);
    h.connection.stop();
  });

  it("começar offline não pede nada; o `online` abre tudo", async () => {
    online = false;
    const h = setup();
    h.connection.start();
    expect(h.last().offline).toBe(true);
    expect(MockEventSource.instances).toHaveLength(0);
    expect(h.fetchMock).not.toHaveBeenCalled();
    setOnline(true);
    expect(MockEventSource.instances).toHaveLength(1);
    h.connection.stop();
  });

  it("oculta E offline: voltar a aparecer sem rede continua sem pedir; a rede volta e então sincroniza", async () => {
    const h = setup([() => ok(body(1))]);
    h.connection.start();
    lastSource().emit("open");
    lastSource().emit("snapshot", body(1));
    setOnline(false);
    setVisibility("hidden");
    setVisibility("visible");
    expect(MockEventSource.instances).toHaveLength(1);
    expect(h.fetchMock).not.toHaveBeenCalled();
    setOnline(true);
    expect(MockEventSource.instances).toHaveLength(2);
    h.connection.stop();
  });

  it("campeonato indisponível continua final: voltar ao primeiro plano não reabre nada", async () => {
    const h = setup([() => new Response("{}", { status: 404 })]);
    h.connection.start();
    lastSource().emit("closed", JSON.stringify({ reason: "token-rotated" }));
    expect(h.last().status).toBe("unavailable");
    setVisibility("hidden");
    setVisibility("visible");
    setOnline(false);
    setOnline(true);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(h.fetchMock).not.toHaveBeenCalled();
    h.connection.stop();
  });
});

describe("chaveamento (dados): consulta que falha recua de 3 s até 30 s", () => {
  it("3 s, 6 s, 12 s, 24 s, 30 s, 30 s... e volta a 3 s no primeiro sucesso", async () => {
    const fail = () => Promise.reject(new TypeError("Failed to fetch"));
    const h = setup([fail, fail, fail, fail, fail, fail, () => ok(body(1)), () => new Response(null, { status: 304 })]);
    h.connection.start();
    lastSource().emit("error");
    await flush();
    expect(h.fetchMock).toHaveBeenCalledTimes(1); // falha 1

    const steps: number[] = [];
    let expected = 1;
    for (const wait of [6_000, 12_000, 24_000, POLL_BACKOFF_MAX_MS, POLL_BACKOFF_MAX_MS]) {
      // um milissegundo antes do prazo: ainda não consultou; no prazo: consultou
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(h.fetchMock).toHaveBeenCalledTimes(expected);
      await vi.advanceTimersByTimeAsync(1);
      expected += 1;
      expect(h.fetchMock).toHaveBeenCalledTimes(expected);
      steps.push(wait);
    }
    expect(steps).toEqual([6_000, 12_000, 24_000, 30_000, 30_000]);
    expect(h.last().status).toBe("reconnecting");

    // 7ª consulta (a que o teste manda dar certo) vem 30 s depois; a seguinte, só 3 s depois
    await vi.advanceTimersByTimeAsync(POLL_BACKOFF_MAX_MS);
    expect(h.fetchMock).toHaveBeenCalledTimes(7);
    expect(h.last().status).toBe("polling");
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    expect(h.fetchMock).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.fetchMock).toHaveBeenCalledTimes(8);
    h.connection.stop();
  });

  it("voltar ao primeiro plano zera o recuo (consulta imediata mesmo depois de muitas falhas)", async () => {
    const fail = () => Promise.reject(new TypeError("Failed to fetch"));
    const h = setup([fail, fail, fail, () => ok(body(1))]);
    h.connection.start();
    lastSource().emit("error");
    await flush();
    await vi.advanceTimersByTimeAsync(6_000 + 12_000);
    expect(h.fetchMock).toHaveBeenCalledTimes(3);
    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(h.fetchMock).toHaveBeenCalledTimes(4);
    expect(h.last().status).toBe("polling");
    h.connection.stop();
  });
});
