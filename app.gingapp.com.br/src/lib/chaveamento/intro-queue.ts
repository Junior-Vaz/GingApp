import type { IntroEvent } from "./snapshot-diff";

/** Duração da abertura "VS" no telão. */
export const INTRO_MS = 3_500;

/**
 * Fila da abertura "VS": no máximo UMA na tela e UMA esperando. Se chegarem várias de uma vez (ou enquanto uma está na tela),
 * vale a MAIS RECENTE e as velhas são descartadas (o telão nunca fica atrasado em relação ao tatame).
 */
export interface IntroState {
  current: IntroEvent | null;
  pending: IntroEvent | null;
}

export const EMPTY_INTRO: IntroState = { current: null, pending: null };

/** `incoming` na ordem em que o snapshot as trouxe: a última é a mais recente. */
export function enqueueIntros(state: IntroState, incoming: readonly IntroEvent[]): IntroState {
  const newest = incoming[incoming.length - 1];
  if (!newest) return state;
  if (state.current === null) return { current: newest, pending: null };
  return { current: state.current, pending: newest };
}

/** A abertura da tela terminou: entra a que esperava (se houver). */
export function advanceIntro(state: IntroState): IntroState {
  return { current: state.pending, pending: null };
}
