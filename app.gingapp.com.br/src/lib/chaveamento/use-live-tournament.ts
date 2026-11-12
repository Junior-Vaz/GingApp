import { useEffect, useState } from "react";
import { INITIAL_LIVE_STATE, LiveConnection, type LiveState } from "./connection";
import type { PublicSnapshot } from "./types";

/**
 * Último snapshot PÚBLICO de cada link visto nesta sessão do app, só em MEMÓRIA (nada vai para storage): quem sai e volta
 * ao telão (troca de aba/rota) vê o último placar na hora em vez do esqueleto, e a conexão atualiza por cima. Poucas
 * entradas; a mais antiga sai primeiro. `unavailable` apaga a do link.
 */
const MAX_CACHED = 3;
const lastSnapshots = new Map<string, PublicSnapshot>();

function remember(token: string, snapshot: PublicSnapshot): void {
  lastSnapshots.delete(token);
  lastSnapshots.set(token, snapshot);
  while (lastSnapshots.size > MAX_CACHED) {
    const oldest = lastSnapshots.keys().next().value;
    if (oldest === undefined) break;
    lastSnapshots.delete(oldest);
  }
}

/** Para os testes: esquece o cache em memória. */
export function clearLiveCache(): void {
  lastSnapshots.clear();
}

const initialFor = (token: string): LiveState => {
  const cached = lastSnapshots.get(token) ?? null;
  return cached ? { ...INITIAL_LIVE_STATE, snapshot: cached } : INITIAL_LIVE_STATE;
};

/**
 * Snapshot ao vivo do torneio público. Abre a conexão ao montar e a LIMPA por inteiro ao desmontar (EventSource,
 * timers, ouvintes e consulta em andamento). Trocar o token reinicia tudo do zero.
 */
export function useLiveTournament(token: string): LiveState {
  const [state, setState] = useState<LiveState>(() => initialFor(token));
  useEffect(() => {
    setState(initialFor(token));
    const connection = new LiveConnection(token, (next) => {
      if (next.snapshot) remember(token, next.snapshot);
      else if (next.status === "unavailable") lastSnapshots.delete(token);
      setState(next);
    });
    connection.start();
    return () => connection.stop();
  }, [token]);
  return state;
}
