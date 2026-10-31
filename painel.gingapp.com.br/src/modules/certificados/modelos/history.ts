/**
 * Histórico desfazer/refazer do desenho (puro). `push` empilha o estado anterior; edições seguidas com a MESMA
 * `key` em menos de `COALESCE_MS` (ex.: digitar num campo) viram um único passo.
 */

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 1000;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  lastKey: string | null;
  lastAt: number;
}

export function createHistory<T>(initial: T): History<T> {
  return { past: [], present: initial, future: [], lastKey: null, lastAt: 0 };
}

export function pushHistory<T>(
  history: History<T>,
  next: T,
  options: { key?: string; now?: number } = {},
): History<T> {
  if (Object.is(next, history.present)) return history;
  const now = options.now ?? Date.now();
  const key = options.key ?? null;
  if (key !== null && history.lastKey === key && now - history.lastAt < COALESCE_MS && history.past.length > 0) {
    return { ...history, present: next, future: [], lastAt: now };
  }
  return {
    past: [...history.past.slice(-(HISTORY_LIMIT - 1)), history.present],
    present: next,
    future: [],
    lastKey: key,
    lastAt: now,
  };
}

export const canUndo = <T>(history: History<T>): boolean => history.past.length > 0;
export const canRedo = <T>(history: History<T>): boolean => history.future.length > 0;

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    lastKey: null,
    lastAt: 0,
  };
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest, lastKey: null, lastAt: 0 };
}
