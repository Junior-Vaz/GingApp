import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SNOOZE_KEYS,
  SNOOZE_MS,
  isSnoozed,
  isSnoozedAt,
  readSnoozedAt,
  useSnooze,
  writeSnoozedAt,
} from "@/lib/snooze";

/** "Agora não" por 3 dias: lógica pura com relógio injetável + o hook (storage em try/catch). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 31, 12, 0, 0);

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("isSnoozedAt (puro)", () => {
  it("3 dias exatos de espera: antes disso dispensado, a partir daí volta", () => {
    expect(SNOOZE_MS).toBe(3 * DAY);
    expect(isSnoozedAt(null, T0)).toBe(false);
    expect(isSnoozedAt(T0, T0)).toBe(true);
    expect(isSnoozedAt(T0, T0 + 2 * DAY + 23 * 3_600_000)).toBe(true);
    expect(isSnoozedAt(T0, T0 + 3 * DAY - 1)).toBe(true);
    expect(isSnoozedAt(T0, T0 + 3 * DAY)).toBe(false);
    expect(isSnoozedAt(T0, T0 + 10 * DAY)).toBe(false);
  });

  it("instante no futuro (relógio mexido) não segura o convite para sempre", () => {
    expect(isSnoozedAt(T0 + 5 * DAY, T0)).toBe(false);
  });
});

describe("storage", () => {
  it("grava e lê o instante; chaves de cada cartão são independentes", () => {
    writeSnoozedAt(SNOOZE_KEYS.install, T0);
    expect(readSnoozedAt(SNOOZE_KEYS.install)).toBe(T0);
    expect(readSnoozedAt(SNOOZE_KEYS.push)).toBeNull();
    expect(isSnoozed(SNOOZE_KEYS.install, T0 + DAY)).toBe(true);
    expect(isSnoozed(SNOOZE_KEYS.push, T0 + DAY)).toBe(false);
    expect(SNOOZE_KEYS.install).not.toBe(SNOOZE_KEYS.push);
  });

  it("valor corrompido é ignorado", () => {
    localStorage.setItem(SNOOZE_KEYS.install, "não-é-número");
    expect(readSnoozedAt(SNOOZE_KEYS.install)).toBeNull();
    expect(isSnoozed(SNOOZE_KEYS.install, T0)).toBe(false);
  });

  it("storage que lança (modo privado/bloqueado) nunca quebra: lê como não dispensado e grava em silêncio", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("cheio");
    });
    expect(readSnoozedAt(SNOOZE_KEYS.install)).toBeNull();
    expect(() => writeSnoozedAt(SNOOZE_KEYS.install, T0)).not.toThrow();
  });
});

describe("useSnooze", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const seen: boolean[] = [];
  let doSnooze: () => void = () => {};

  function Probe({ clock }: { clock: () => number }) {
    const { snoozed, snooze } = useSnooze(SNOOZE_KEYS.install, clock);
    seen.push(snoozed);
    doSnooze = snooze;
    return <span data-snoozed={String(snoozed)} />;
  }
  const mountProbe = (clock: () => number) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Probe clock={clock} />));
  };
  const unmountProbe = () => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
  };
  const state = () => container!.querySelector("span")!.getAttribute("data-snoozed");
  afterEach(() => {
    unmountProbe();
    seen.length = 0;
  });

  it("snooze() grava o instante do relógio injetado e some na hora; remontar antes de 3 dias continua oculto, depois dos 3 dias volta", () => {
    mountProbe(() => T0);
    expect(state()).toBe("false");
    act(() => doSnooze());
    expect(state()).toBe("true");
    expect(localStorage.getItem(SNOOZE_KEYS.install)).toBe(String(T0));

    unmountProbe();
    mountProbe(() => T0 + 2 * DAY);
    expect(state()).toBe("true"); // 2 dias: ainda dispensado

    unmountProbe();
    mountProbe(() => T0 + 3 * DAY + 1);
    expect(state()).toBe("false"); // passou de 3 dias: o cartão volta
  });

  it("mesmo com storage falhando, o convite some nesta visita", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("cheio");
    });
    mountProbe(() => T0);
    act(() => doSnooze());
    expect(state()).toBe("true");
  });
});
